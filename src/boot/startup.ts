/**
 * The startup sequence, measured stage by stage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 *
 * A hello-world SSR container boots in a few hundred milliseconds, which makes
 * cold starts look like a non-problem — right up until the application is real.
 * Real applications load configuration from a secret store, derive or verify
 * keys, build caches and open connection pools before they can answer anything.
 *
 * This module does those four things for real (two of them as measured
 * simulations of network latency, which is stated in each stage's `detail`),
 * so the demo's cold start behaves like a production cold start instead of a
 * toy one. Nothing here is a blanket `sleep` bolted onto the request path: the
 * cost is paid once per process, exactly like the thing it stands in for.
 *
 * It is also the reason `--min-instances 1` stops sounding like a micro
 * optimisation and starts looking like the difference between a 2 second first
 * visit and a 20 millisecond one.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { scryptSync } from 'node:crypto';
import type { BootProfile, BootReport, BootStage } from '../app/core/boot-report';
import { buildInventory, type InventoryIndex } from './inventory';

/** What a profile decides. Every field is individually overridable, see below. */
interface BootPlan {
  /** Simulated round trips to Secret Manager / Parameter Store. */
  secretsMs: number;
  /** How many signing keys to derive. Real scrypt, real CPU. */
  keyDerivations: number;
  /** scrypt's cost parameter. 2^15 costs roughly 60-120 ms per key. */
  scryptCost: number;
  /** SKUs to materialise and index. */
  inventorySize: number;
  /** Simulated database handshake, paid by the FIRST request, not by boot. */
  poolConnectMs: number;
}

/**
 * Three profiles, because one number cannot serve every audience.
 *
 * `off` restores the original hello-world behaviour and is what the concurrency
 * script uses — that test is about throughput, not startup.
 */
const PROFILES: Record<BootProfile, BootPlan> = {
  off: {
    secretsMs: 0,
    keyDerivations: 0,
    scryptCost: 1 << 12,
    inventorySize: 1_200,
    poolConnectMs: 0,
  },
  realistic: {
    secretsMs: 220,
    keyDerivations: 2,
    scryptCost: 1 << 15,
    inventorySize: 24_000,
    poolConnectMs: 350,
  },
  heavy: {
    secretsMs: 900,
    keyDerivations: 6,
    scryptCost: 1 << 15,
    inventorySize: 60_000,
    poolConnectMs: 1_400,
  },
};

function readProfile(): BootProfile {
  const raw = (process.env['BOOT_PROFILE'] ?? 'realistic').toLowerCase();
  return raw === 'off' || raw === 'heavy' || raw === 'realistic' ? raw : 'realistic';
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const profile = readProfile();
const preset = PROFILES[profile];

/** The profile's values, with per-variable overrides applied on top. */
const plan: BootPlan = {
  secretsMs: readNumber('BOOT_SECRETS_MS', preset.secretsMs),
  keyDerivations: readNumber('BOOT_KEY_DERIVATIONS', preset.keyDerivations),
  scryptCost: preset.scryptCost,
  inventorySize: readNumber('INVENTORY_SIZE', preset.inventorySize),
  poolConnectMs: readNumber('DB_POOL_CONNECT_MS', preset.poolConnectMs),
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stages: BootStage[] = [];
let index: InventoryIndex | null = null;
let processReadyMs = 0;
let connecting: Promise<void> | null = null;
let warm = false;

/**
 * Runs one stage, records what it cost, and returns whatever it produced.
 *
 * `describe` gets the last word on the detail string, so a stage can report
 * numbers it only learns by running — the index cannot say how many tokens it
 * holds until it has built them.
 */
async function stage<T>(
  descriptor: Omit<BootStage, 'durationMs'>,
  work: () => T | Promise<T>,
  describe?: (result: T) => string,
): Promise<T> {
  const startedAt = performance.now();
  const result = await work();

  stages.push({
    ...descriptor,
    detail: describe ? describe(result) : descriptor.detail,
    durationMs: Math.round(performance.now() - startedAt),
  });

  return result;
}

/**
 * Everything the process must have in memory before it can serve anything.
 *
 * Called at module scope and awaited before `listen`, which mirrors how a
 * container behaves under Cloud Run: the port stays closed until the work is
 * done, so the platform's startup probe — and the demo's stopwatch — sees the
 * full cost as "time until the instance was ready".
 */
export const startup: Promise<void> = (async () => {
  await stage(
    {
      id: 'runtime-config',
      label: 'Load runtime configuration',
      kind: 'io',
      when: 'eager',
      detail: `simulated ${plan.secretsMs} ms of secret-store round trips`,
    },
    () => sleep(plan.secretsMs),
  );

  await stage(
    {
      id: 'signing-keys',
      label: 'Derive signing keys',
      kind: 'cpu',
      when: 'eager',
      detail: `${plan.keyDerivations} real scrypt derivations, N=${plan.scryptCost}`,
    },
    () => {
      for (let i = 0; i < plan.keyDerivations; i++) {
        // Genuine CPU work, not a timer: this is the stage `--cpu-boost` helps
        // with, and the reason a cold start costs more on a throttled vCPU.
        scryptSync(`session-key-${i}`, 'angular-ssr-cloud-run', 64, {
          N: plan.scryptCost,
          r: 8,
          p: 1,
          maxmem: 256 * 1024 * 1024,
        });
      }
    },
  );

  index = await stage(
    {
      id: 'inventory-index',
      label: 'Build the product index',
      kind: 'cpu',
      when: 'eager',
      detail: `${plan.inventorySize.toLocaleString('en-US')} SKUs, inverted index`,
    },
    () => buildInventory(plan.inventorySize),
    (built) =>
      `${built.skus.length.toLocaleString('en-US')} SKUs · ` +
      `${built.tokenCount.toLocaleString('en-US')} tokens · ` +
      `${built.postingCount.toLocaleString('en-US')} postings`,
  );

  processReadyMs = Math.round(process.uptime() * 1000);
})();

/**
 * The work the first request pays for, after the port is already open.
 *
 * Connection pools are the classic example: the container is "ready" as far as
 * the platform is concerned, the health check passes, and then the first real
 * visitor still waits for a TLS handshake to the database. Splitting it out
 * from the eager stages is what lets the demo show that a cold start is not one
 * number but two, in different places.
 */
export function ensureWarm(): Promise<void> {
  // Caching the promise, not a boolean: requests that arrive while the pool is
  // still connecting must wait for the same handshake rather than skip past it
  // — which is exactly how a real pool behaves under a burst of cold traffic.
  connecting ??= (async () => {
    await stage(
      {
        id: 'db-pool',
        label: 'Open the connection pool',
        kind: 'io',
        when: 'lazy',
        detail: `simulated ${plan.poolConnectMs} ms handshake, paid by request #1`,
      },
      () => sleep(plan.poolConnectMs),
    );

    warm = true;
  })();

  return connecting;
}

/** The index built at boot. Throws if called before `startup` resolved. */
export function inventory(): InventoryIndex {
  if (!index) {
    throw new Error('inventory() called before startup finished');
  }
  return index;
}

export function bootReport(): BootReport {
  const eagerMs = stages
    .filter((entry) => entry.when === 'eager')
    .reduce((sum, entry) => sum + entry.durationMs, 0);
  const lazyMs = stages
    .filter((entry) => entry.when === 'lazy')
    .reduce((sum, entry) => sum + entry.durationMs, 0);

  return {
    profile,
    stages: [...stages],
    eagerMs,
    lazyMs,
    totalMs: eagerMs + lazyMs,
    processReadyMs,
    indexedSkus: index?.skus.length ?? 0,
    warm,
  };
}
