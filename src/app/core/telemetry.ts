import {
  Injectable,
  REQUEST_CONTEXT,
  TransferState,
  computed,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';

/**
 * Per-request data that the server injects into every render.
 *
 * `server.ts` builds this object for each request and passes it to
 * `angularApp.handle(req, context)`. Inside Angular it arrives through the
 * `REQUEST_CONTEXT` injection token.
 */
export interface ServerRenderContext {
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
}

/** Telemetry shaped for display, with the derived values the UI needs. */
export interface TelemetryView extends ServerRenderContext {
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
 * showing after hydration.
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

  private resolve(): TelemetryView | null {
    // On the server: read the request context and stash it for the client.
    if (this.requestContext) {
      const view: TelemetryView = {
        ...this.requestContext,
        renderedAt: new Date().toISOString(),
        renderMs: Date.now() - this.requestContext.handleStartMs,
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
