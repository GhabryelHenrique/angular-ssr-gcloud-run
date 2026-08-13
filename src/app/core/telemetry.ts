import {
  Injectable,
  REQUEST_CONTEXT,
  TransferState,
  computed,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';
import { emptyBootReport, type BootReport } from './boot-report';
import type { CatalogSlice, Product } from './catalog-data';

/**
 * What the server measured about the request currently being rendered.
 */
export interface RequestTelemetry {
  /** Identifies the Node process. Changes whenever a new container starts. */
  instanceId: string;
  /** How many requests this process has served, including the current one. */
  requestNumber: number;
  /** True only on the very first request of a fresh process — the cold start. */
  coldStart: boolean;
  /** How long the process has been running. */
  uptimeMs: number;
  /** Requests being processed by this instance at this exact moment. */
  inFlight: number;
  /** Highest concurrency this instance has observed since it started. */
  peakInFlight: number;
  /** Port the server listens on. On Cloud Run this comes from `PORT`. */
  port: string;
  /** `K_SERVICE` on Cloud Run; empty when running locally. */
  service: string;
  /** `K_REVISION` on Cloud Run; empty when running locally. */
  revision: string;
  /** Where the process is running, inferred from the environment. */
  platform: 'cloud-run' | 'local';
  /** Artificial data delay from `RENDER_DELAY_MS`, used to simulate slow APIs. */
  renderDelayMs: number;
  /** `Date.now()` when request handling began — the baseline for render timing. */
  handleStartMs: number;
  /** What this process paid to become able to answer at all. */
  boot: BootReport;
  /** Milliseconds this request itself spent waiting for lazy startup work. */
  warmupWaitMs: number;
  /** What the very first render of this process cost. `null` while it runs. */
  firstRenderMs: number | null;
  /** Mean render time of the warm requests served so far. */
  warmRenderAvgMs: number | null;
  /** How many warm renders that mean is based on. */
  warmSamples: number;
}

/**
 * Per-request data that the server injects into every render.
 *
 * `server.ts` builds this object for each request and passes it to
 * `angularApp.handle(req, context)`. Inside Angular it arrives through the
 * `REQUEST_CONTEXT` injection token.
 *
 * It is grouped rather than flat because two different stores read it — the
 * telemetry bar wants `telemetry`, the catalog wants `catalog` — and each one
 * transfers only its own slice to the client. Flattening it would ship the
 * whole object twice inside the HTML.
 */
export interface ServerRenderContext {
  telemetry: RequestTelemetry;
  /** Search results the server already resolved against its boot-time index. */
  catalog: CatalogSlice;
  /** The product for `/product/:id`, resolved server-side. `null` elsewhere. */
  product: Product | null;
}

/** Telemetry shaped for display, with the derived values the UI needs. */
export interface TelemetryView extends RequestTelemetry {
  /** ISO timestamp of the moment the server rendered this page. */
  renderedAt: string;
  /** Milliseconds between the start of request handling and this service booting. */
  renderMs: number;
}

const TELEMETRY_KEY = makeStateKey<TelemetryView>('ssr-telemetry');

/**
 * Carries server-side telemetry across hydration.
 *
 * `REQUEST_CONTEXT` only exists during SSR — in the browser it is `null`.
 * Without care, the telemetry bar would go blank the moment JavaScript took
 * over. `TransferState` is the bridge: the server writes the values, Angular
 * serializes them alongside the HTML, and the client reads them back without
 * paying for a second round trip.
 *
 * This is the standard pattern for any server-only value that the UI must keep
 * showing after hydration — `CatalogStore` uses it a second time, for the
 * search results.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryStore {
  private readonly transferState = inject(TransferState);
  private readonly requestContext = inject(REQUEST_CONTEXT, {
    optional: true,
  }) as ServerRenderContext | null;

  private readonly state = signal<TelemetryView | null>(this.resolve());

  /** Telemetry for the current render, or `null` on a client-only route. */
  readonly telemetry = this.state.asReadonly();

  /** Becomes true once the bundle has taken over in the browser. */
  readonly hydrated = signal(false);

  readonly renderOrigin = computed(() => {
    if (!this.state()) {
      return 'browser (CSR)';
    }
    return this.hydrated() ? 'server · hydrated' : 'server (SSR)';
  });

  /** The startup cost this instance paid, or an empty report on a CSR route. */
  readonly boot = computed<BootReport>(() => this.state()?.boot ?? emptyBootReport());

  /**
   * What the visitor actually waited for, end to end on the server.
   *
   * On a warm request this is just the render. On a cold one it also includes
   * the startup work — which is the whole point: the first visitor pays for
   * everything the process had to do before it could answer.
   */
  readonly totalServerMs = computed(() => {
    const view = this.state();
    if (!view) {
      return 0;
    }
    return view.coldStart ? view.renderMs + view.boot.eagerMs : view.renderMs;
  });

  private resolve(): TelemetryView | null {
    // On the server: read the request context and stash it for the client.
    if (this.requestContext) {
      const source = this.requestContext.telemetry;
      const view: TelemetryView = {
        ...source,
        renderedAt: new Date().toISOString(),
        renderMs: Date.now() - source.handleStartMs,
      };
      this.transferState.set(TELEMETRY_KEY, view);

      return view;
    }

    // In the browser: recover whatever the server serialized into the HTML.
    return this.transferState.get(TELEMETRY_KEY, null);
  }

  markHydrated(): void {
    this.hydrated.set(true);
  }
}
