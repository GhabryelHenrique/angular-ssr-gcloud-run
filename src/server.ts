import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { bootReport, ensureWarm, inventory, startup } from './boot/startup';
import { featuredSlice, type CatalogSlice, type Product } from './app/core/catalog-data';
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
 *
 * Unlike the startup stages in `src/boot/startup.ts`, this cost is paid on
 * every single request — it inflates the warm column too.
 */
const renderDelayMs = Number(process.env['RENDER_DELAY_MS'] ?? 0) || 0;

/** How many results one page of the catalog shows. */
const PAGE_SIZE = 24;

let requestCount = 0;
let inFlight = 0;
let peakInFlight = 0;

/**
 * Render times, kept so a page can show the cold and warm numbers side by side.
 *
 * A request cannot know its own render time before it finishes rendering, so
 * what a page displays is always the history of the requests before it — which
 * is exactly what makes reloading `/cold-start` interesting: the cold number
 * stays pinned while the warm average forms next to it.
 */
let firstRenderMs: number | null = null;
let warmRenderCount = 0;
let warmRenderTotalMs = 0;

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
// Server-side data resolution
//
// The renderer never fetches anything. The server answers the question the URL
// is asking — against the index it built at boot — and passes the result into
// the render. One process, no self-inflicted HTTP round trip, and the HTML a
// crawler receives is the same one a user receives.
// ---------------------------------------------------------------------------

/** Query string parsing that does not care whether the URL is absolute. */
function queryOf(url: string): URLSearchParams {
  return new URL(url, 'http://localhost').searchParams;
}

function pathOf(url: string): string {
  return new URL(url, 'http://localhost').pathname;
}

function resolveCatalog(url: string): CatalogSlice {
  if (pathOf(url) !== '/') {
    return featuredSlice();
  }

  const params = queryOf(url);
  const query = params.get('q') ?? '';
  const category = params.get('category') ?? '';

  // No query and no filter: show the curated rows rather than the first 24
  // machine-generated variants. `view-source:` on `/` therefore still contains
  // the twelve products the README talks about.
  if (!query.trim() && !category.trim()) {
    return featuredSlice();
  }

  return inventory().search({ query, category, limit: PAGE_SIZE });
}

function resolveProduct(url: string): Product | null {
  const match = /^\/product\/([^/]+)\/?$/.exec(pathOf(url));
  if (!match) {
    return null;
  }

  return inventory().byId(decodeURIComponent(match[1])) ?? null;
}

// ---------------------------------------------------------------------------
// Infrastructure endpoints
// ---------------------------------------------------------------------------

/**
 * Health check. The cold start script times how long a freshly created
 * container takes to answer this route: that is the cost of provisioning the
 * instance, booting Node AND running the eager startup stages, because the
 * port does not open until `startup` has resolved.
 */
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', instanceId, uptimeMs: Date.now() - bootTime });
});

/**
 * The startup breakdown, as JSON.
 *
 * Deliberately outside the warm-up gate: a health or diagnostics endpoint that
 * blocks on the connection pool would report the service as down while it is
 * merely starting.
 */
app.get('/api/boot', (_req, res) => {
  res.json({
    instanceId,
    requestsServed: requestCount,
    firstRenderMs,
    warmRenderAvgMs: warmRenderCount ? Math.round(warmRenderTotalMs / warmRenderCount) : null,
    warmSamples: warmRenderCount,
    ...bootReport(),
  });
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
    boot: bootReport(),
  });
});

/**
 * Search as an API, for anything that is not a page render.
 *
 * It reads the same index the server-rendered catalog reads, which is the
 * point: building it cost one cold start and every consumer since has been
 * answered from memory.
 */
app.get('/api/search', async (req, res) => {
  await startup;
  await ensureWarm();

  const params = queryOf(req.url);
  const slice = inventory().search({
    query: params.get('q') ?? '',
    category: params.get('category') ?? '',
    limit: Math.min(Number(params.get('limit') ?? PAGE_SIZE) || PAGE_SIZE, 100),
  });

  res.setHeader('Server-Timing', `search;dur=${slice.searchMs}`);
  res.json(slice);
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
  const arrivalMs = Date.now();
  const requestNumber = ++requestCount;

  // The first request served by a process is, by definition, the one that paid
  // for the cold start: it waited for the instance and for Node to boot.
  const coldStart = requestNumber === 1;

  inFlight++;
  peakInFlight = Math.max(peakInFlight, inFlight);

  // `startup` has already resolved by the time the port is open, so awaiting it
  // here costs a microtask. `ensureWarm` is the one that can actually block —
  // and only the request unlucky enough to be first.
  void startup
    .then(() => ensureWarm())
    .then(() => {
      const handleStartMs = Date.now();
      const warmupWaitMs = handleStartMs - arrivalMs;

      const context: ServerRenderContext = {
        telemetry: {
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
          boot: bootReport(),
          warmupWaitMs,
          firstRenderMs,
          warmRenderAvgMs: warmRenderCount ? Math.round(warmRenderTotalMs / warmRenderCount) : null,
          warmSamples: warmRenderCount,
        },
        catalog: resolveCatalog(req.url),
        product: resolveProduct(req.url),
      };

      const traceHeader = req.header('x-cloud-trace-context');

      return (
        angularApp
          // The second argument reaches Angular through the REQUEST_CONTEXT token.
          .handle(req, context)
          .then((response) => {
            if (!response) {
              next();
              return;
            }

            const renderMs = Date.now() - handleStartMs;
            const report = bootReport();

            if (coldStart) {
              firstRenderMs = renderMs;
            } else {
              warmRenderCount++;
              warmRenderTotalMs += renderMs;
            }

            // Exposes real timings to DevTools and to curl. `Server-Timing`
            // renders as a waterfall in the network panel, so the split between
            // startup and render is visible without reading a single log line.
            const timings = [`render;dur=${renderMs}`];
            if (warmupWaitMs > 0) {
              timings.push(`warmup;dur=${warmupWaitMs}`);
            }
            if (coldStart) {
              timings.push(`boot;dur=${report.eagerMs}`);
            }

            res.setHeader('Server-Timing', timings.join(', '));
            res.setHeader('X-Instance-Id', instanceId);
            res.setHeader('X-Cold-Start', String(coldStart));
            res.setHeader('X-Boot-Ms', String(report.totalMs));

            log(
              'INFO',
              `${req.method} ${req.url}`,
              {
                renderMs,
                warmupWaitMs,
                coldStart,
                bootMs: coldStart ? report.totalMs : undefined,
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
      );
    })
    .finally(() => {
      inFlight--;
    });
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  // The port stays closed until the eager startup stages finish. That is not an
  // accident: Cloud Run decides an instance is ready the moment it accepts a
  // connection, so opening early would route real traffic at a process that
  // cannot serve it yet.
  void startup.then(() => {
    const report = bootReport();

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
        bootProfile: report.profile,
        bootMs: report.eagerMs,
        bootStages: report.stages.map((stage) => `${stage.id}=${stage.durationMs}ms`),
        indexedSkus: report.indexedSkus,
        processReadyMs: report.processReadyMs,
        node: process.version,
      });
    });
  });
}

/**
 * Request handler used by the Angular CLI during dev-server and build.
 */
export const reqHandler = createNodeRequestHandler(app);
