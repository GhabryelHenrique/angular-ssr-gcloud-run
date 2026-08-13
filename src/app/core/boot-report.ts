/**
 * The shape of a cold start, as measured by the process that paid for it.
 *
 * Framework-free on purpose: `src/boot/startup.ts` produces these objects in
 * plain Node, the Angular components consume them, and neither side has to
 * know about the other.
 */

/** Which startup profile the process was launched with. */
export type BootProfile = 'off' | 'realistic' | 'heavy';

/**
 * One measured step of the startup sequence.
 *
 * `kind` matters more than it looks: I/O stages are latency you can overlap or
 * cache away, CPU stages are work the machine genuinely has to do. Cloud Run's
 * `--cpu-boost` only helps the second kind.
 */
export interface BootStage {
  id: string;
  label: string;
  kind: 'io' | 'cpu';
  /** `eager` runs before the port opens; `lazy` is billed to the first request. */
  when: 'eager' | 'lazy';
  durationMs: number;
  detail: string;
}

export interface BootReport {
  profile: BootProfile;
  stages: readonly BootStage[];
  /** Work completed before the server started listening. */
  eagerMs: number;
  /** Work the first request had to wait for, after the port was already open. */
  lazyMs: number;
  /** `eagerMs + lazyMs`. */
  totalMs: number;
  /** Time from process start to the port opening, including Node's own boot. */
  processReadyMs: number;
  /** How many SKUs the boot-time index ended up holding. */
  indexedSkus: number;
  /** False until the first request has paid for the lazy stages. */
  warm: boolean;
}

/** An empty report, for the client-only paths where no server measured one. */
export function emptyBootReport(): BootReport {
  return {
    profile: 'off',
    stages: [],
    eagerMs: 0,
    lazyMs: 0,
    totalMs: 0,
    processReadyMs: 0,
    indexedSkus: 0,
    warm: true,
  };
}

/** `1284` -> `1.28 s`, `19` -> `19 ms`. Used wherever a duration is displayed. */
export function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${Math.round(ms)} ms`;
}
