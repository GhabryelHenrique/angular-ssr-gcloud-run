import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ServerRenderContext } from './app/core/telemetry';

const browserDistFolder = join(import.meta.dirname, '../browser');

/**
 * Extra hostnames allowed at runtime, comma separated.
 *
 * Angular 22 rejects any request whose `Host` header is not authorized — this
 * is its SSRF protection. The base list lives in `angular.json` under
 * `security.allowedHosts` and already covers `localhost` and `*.run.app`.
 *
 * The catch is that the `angular.json` list is fixed at BUILD time, while a
 * custom domain is often only known later. Without this variable, pointing a
 * domain at the service would require rebuilding the image. With it, a single
 * `gcloud run services update --set-env-vars ALLOWED_HOSTS=shop.example.com`
 * is enough.
 */
const allowedHosts = (process.env['ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const app = express();
const angularApp = new AngularNodeAppEngine({
  // Merged with the angular.json list rather than replacing it.
  allowedHosts,
  /**
   * Only trust X-Forwarded-* when a trusted proxy actually sits in front
   * (Cloud CDN, a load balancer). Plain Cloud Run preserves the original
   * `Host`, so the default here is `false` — enabling it without a proxy
   * would let clients forge the host.
   */
  trustProxyHeaders: process.env['TRUST_PROXY_HEADERS'] === 'true',
});

// ---------------------------------------------------------------------------
// Process identity and counters
//
// Everything here lives in the memory of ONE instance. When Cloud Run recycles
// the container this state dies with it — which is the point: watching
// `instanceId` change is the visible proof that a new instance started.
// ---------------------------------------------------------------------------

/** Unique per process. Acts as the instance fingerprint in the UI. */
const instanceId = randomUUID().slice(0, 8);

/** `Date.now()` when this module was evaluated. */
const bootTime = Date.now();

const K_SERVICE = process.env['K_SERVICE'] ?? '';
const K_REVISION = process.env['K_REVISION'] ?? '';

/** `K_SERVICE` only exists inside Cloud Run, so it doubles as an environment probe. */
const platform: 'cloud-run' | 'local' = K_SERVICE ? 'cloud-run' : 'local';

/**
 * The port.
 *
 * Cloud Run injects `PORT` into the environment and expects the container to
 * listen on it. Hardcoding a port is the mistake behind the classic deploy
 * failure "the container failed to start and listen on the port". The 8080
 * default is only for local runs — in production the environment decides.
 */
const port = Number(process.env['PORT'] ?? 8080);

/**
 * Artificial delay applied while resolving page data, used to simulate a slow
 * upstream API. Defaults to 0; set `RENDER_DELAY_MS=800` to see how a slow
 * backend inflates render time.
 */
const renderDelayMs = Number(process.env['RENDER_DELAY_MS'] ?? 0) || 0;

let requestCount = 0;
let inFlight = 0;
let peakInFlight = 0;

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

const GCP_PROJECT = process.env['GOOGLE_CLOUD_PROJECT'] ?? '';

/**
 * Emits one JSON line per event, in the shape Cloud Logging understands natively.
 *
 * Cloud Run reads the container's stdout: if a line is valid JSON, its fields
 * become indexed fields and `severity` becomes the real log level — so you can
 * alert on `severity=ERROR` without parsing text. Plain text collapses into a
 * single opaque string and you end up debugging blind.
 */
function log(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  extra: Record<string, unknown> = {},
  traceHeader?: string,
): void {
  const entry: Record<string, unknown> = {
    severity,
    message,
    instanceId,
    ...extra,
  };

  // Correlates this log line with the distributed trace, which makes it
  // possible to jump from a log entry to the full request in Cloud Trace.
  const traceId = traceHeader?.split('/')[0];
  if (traceId && GCP_PROJECT) {
    entry['logging.googleapis.com/trace'] = `projects/${GCP_PROJECT}/traces/${traceId}`;
  }

  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

// ---------------------------------------------------------------------------
// Infrastructure endpoints
// ---------------------------------------------------------------------------

/**
 * Health check. The cold start script times how long a freshly created
 * container takes to answer this route: that is the cost of provisioning the
 * instance plus booting Node, before any rendering happens.
 */
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', instanceId, uptimeMs: Date.now() - bootTime });
});

/**
 * Instance telemetry as JSON, consumed by the /dashboard route and by the
 * concurrency script. This is how you prove that N parallel requests were all
 * served by a single instance.
 */
app.get('/api/instance', (_req, res) => {
  res.json({
    instanceId,
    requestNumber: requestCount,
    uptimeMs: Date.now() - bootTime,
    inFlight,
    peakInFlight,
    port: String(port),
    service: K_SERVICE,
    revision: K_REVISION,
    platform,
  });
});

/**
 * Static assets from /browser.
 *
 * A one year `maxAge` is safe because the build emits hashed filenames: when
 * content changes, the name changes. Aggressive caching here means most
 * requests never wake the renderer at all.
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * The Angular renderer, instrumented.
 */
app.use((req, res, next) => {
  const handleStartMs = Date.now();
  const requestNumber = ++requestCount;

  // The first request served by a process is, by definition, the one that paid
  // for the cold start: it waited for the instance and for Node to boot.
  const coldStart = requestNumber === 1;

  inFlight++;
  peakInFlight = Math.max(peakInFlight, inFlight);

  const context: ServerRenderContext = {
    instanceId,
    requestNumber,
    coldStart,
    uptimeMs: handleStartMs - bootTime,
    inFlight,
    peakInFlight,
    port: String(port),
    service: K_SERVICE,
    revision: K_REVISION,
    platform,
    renderDelayMs,
    handleStartMs,
  };

  const traceHeader = req.header('x-cloud-trace-context');

  angularApp
    // The second argument reaches Angular through the REQUEST_CONTEXT token.
    .handle(req, context)
    .then((response) => {
      if (!response) {
        return next();
      }

      const renderMs = Date.now() - handleStartMs;

      // Exposes real render time to DevTools and to curl. This is the precise
      // source the measurement scripts read.
      res.setHeader('Server-Timing', `render;dur=${renderMs}`);
      res.setHeader('X-Instance-Id', instanceId);
      res.setHeader('X-Cold-Start', String(coldStart));

      log(
        'INFO',
        `${req.method} ${req.url}`,
        {
          renderMs,
          coldStart,
          requestNumber,
          inFlight,
          path: req.url,
          status: response.status,
        },
        traceHeader,
      );

      return writeResponseToNodeResponse(response, res);
    })
    .catch((error: unknown) => {
      log(
        'ERROR',
        `Failed to render ${req.url}`,
        {
          path: req.url,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        traceHeader,
      );
      next(error);
    })
    .finally(() => {
      inFlight--;
    });
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    log('INFO', 'Server ready to accept requests', {
      port,
      platform,
      service: K_SERVICE,
      revision: K_REVISION,
      renderDelayMs,
      bootMs: Date.now() - bootTime,
      node: process.version,
    });
  });
}

/**
 * Request handler used by the Angular CLI during dev-server and build.
 */
export const reqHandler = createNodeRequestHandler(app);
