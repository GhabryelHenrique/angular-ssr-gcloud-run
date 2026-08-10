# Angular SSR on Google Cloud Run

A reference project showing how to deploy an **Angular 22** server-side
rendered application to serverless — and, more importantly, what actually
happens once you do.

Server-side rendering is easy to turn on. Keeping the resulting Node process
cheap, elastic and observable is the part tutorials skip. This repository makes
that part measurable: the app reports the infrastructure it is running on, and
a set of scripts turns claims about cold starts, concurrency and image size
into numbers you can reproduce on your own machine.

**Everything runs on local Docker.** No cloud account, no billing, no network
required.

---

## What you'll learn

- **Hybrid rendering** — `Server`, `Prerender` and `Client` routes side by side
  in one app, so you can compare their `view-source:` output directly.
- **Cold starts, decomposed** — provisioning, Node boot, first render and warm
  render measured separately instead of lumped into one scary number.
- **Why high concurrency works for SSR** — and the case where it does not.
- **Container images that stay small** — why the runtime image here needs no
  `node_modules` at all.
- **Structured logging** in the format Cloud Logging indexes natively.
- **Two Angular 22 traps** that break deployments and only surface in
  production ([details below](#two-angular-22-traps-worth-knowing)).

---

## Quick start

Requires **Node 22.22+ / 24.15+** (Angular 22 dropped Node 20) and Docker.

```bash
npm install
npm run build
docker build -t angular-ssr-demo:local .
docker run --rm -e PORT=8080 -p 8080:8080 angular-ssr-demo:local
```

Open <http://localhost:8080>. A telemetry bar at the top reports, on every
reload: render origin, render time, instance id, request number, **cold start
or warm**, `PORT`, and current concurrency.

Prefer to skip Docker? `npm run build && npm run start:ssr` works too.

---

## The three render modes

The whole idea fits in one file, [`app.routes.server.ts`](src/app/app.routes.server.ts).
Open `view-source:` on each route — the difference is immediate:

| Route | Mode | Raw HTML | What it means |
| --- | --- | --- | --- |
| `/` | `Server` | **~18.9 kB**, all 12 products present | Rendered per request. Price and stock are current. |
| `/about` | `Prerender` | Full HTML, frozen at build time | Generated once by `ng build`. Never wakes the renderer. |
| `/dashboard` | `Client` | **~1.2 kB**, empty `<app-root>` | Nothing rendered. The browser does all the work. |

Reload `/about` a few times: its timestamp **never changes**, because it
belongs to the build, not to your visit. That is the limit of prerendering, and
the reason a live catalog cannot use it.

`/dashboard` is the control group. It fetches the same data the server-rendered
pages already had, but only after the bundle has downloaded and executed — two
round trips before the first useful pixel.

---

## Measuring things yourself

Five scripts, in the order they make sense. All accept `-?` for parameters.

### `demo/1-build.ps1` — the build output

Shows `dist/` split into `browser/` (static assets and prerendered routes) and
`server/` (the Node process). Watch for `about/index.html`: that is the
prerendered route materializing as a real file.

### `demo/2-image.ps1` — the container image

```powershell
.\demo\2-image.ps1            # fast, uses layer cache
.\demo\2-image.ps1 -NoCache   # honest cold-build number, ~1-2 min
```

The layer breakdown is the interesting part: **2.37 MB of application code and
no `node_modules`**. Angular's application builder bundles Express into
`server.mjs`, so the runtime image needs zero installed packages.

### `demo/3-cold-start.ps1` — cold start, stage by stage

```powershell
.\demo\3-cold-start.ps1
.\demo\3-cold-start.ps1 -DelayMs 800   # simulate a slow upstream API
```

Measured on a developer laptop (Docker Desktop, Windows 11):

| Stage | Time |
| --- | --- |
| Container created | 417 ms |
| First connection accepted (Node booted) | 567 ms |
| First render | **261 ms** |
| Warm render (median of 20) | **19 ms** |
| **Cold vs warm** | **14.1x** |

A local container skips the image-layer download and network latency Cloud Run
pays during provisioning, so absolute numbers are higher in the cloud. The
*ratio* is what reproduces faithfully — and the ratio is the point.

The fix is not to make rendering faster. It is `--min-instances 1`, which keeps
one instance warm so real users land in the warm column.

### `demo/4-concurrency.ps1` — one instance, many requests

This one runs **two scenarios**, and the contrast is the whole lesson:

| | Pure render (CPU) | With a 500 ms upstream call |
| --- | --- | --- |
| Requests completed | 50 | 50 |
| Instances that answered | **1** | **1** |
| Peak simultaneous requests | 3 | **50** |
| Total burst time | 806 ms | 1,007 ms |

Scenario A looks disappointing until you understand it: rendering is CPU work
and Node has one thread, so renders queue. Scenario B is what production
actually looks like — pages call APIs, and while one request waits on I/O the
event loop serves the rest. Fifty requests that would take 25 seconds serially
finish in one.

That is what `--concurrency 80` buys: fewer instances for the same traffic, and
fewer instances is a smaller bill. It also tells you when to scale out on
instances instead — when your bottleneck is genuinely CPU.

### `demo/5-deploy.ps1` — deploying

```powershell
.\demo\5-deploy.ps1            # prints the command, runs nothing
.\demo\5-deploy.ps1 -Execute   # requires gcloud and a typed confirmation
```

```bash
gcloud run deploy angular-ssr \
    --source . \
    --region southamerica-east1 \
    --allow-unauthenticated \
    --cpu 1 --memory 512Mi \
    --concurrency 80 \
    --min-instances 1 --max-instances 20 \
    --cpu-boost
```

[`cloudbuild.yaml`](cloudbuild.yaml) covers the CI/CD path: build with layer
cache, push to Artifact Registry, deploy. Every deploy creates an immutable
revision, which is what makes traffic splitting and one-click rollback work.

---

## Observability

The server emits one JSON line per request, in the shape Cloud Logging indexes
without configuration:

```json
{"severity":"INFO","message":"GET /","instanceId":"c0e96f3d","renderMs":105,
 "coldStart":true,"requestNumber":1,"inFlight":1,"path":"/","status":200}
```

`severity` becomes the real log level, so you can alert on `severity=ERROR`
without parsing text. When `GOOGLE_CLOUD_PROJECT` is set, each line also
carries a Cloud Trace correlation id, letting you jump from a log entry to the
full request.

Two response headers help from the outside: `Server-Timing: render;dur=N` and
`X-Instance-Id`.

---

## Two Angular 22 traps worth knowing

### 1. An empty `allowedHosts` list breaks your deployment

`ng new --ssr` generates this:

```json
"security": { "allowedHosts": [] }
```

With an empty list, Angular 22 answers **400 Bad Request to every host** — this
is its SSRF protection. You will not notice locally, because `ng serve` handles
it separately. Then you deploy and **every request returns 400**.

This project sets it explicitly:

```json
"security": { "allowedHosts": ["localhost", "127.0.0.1", "*.run.app"] }
```

Matching supports exact hosts, `*` for everything, and `*.suffix` wildcards.
Because a custom domain is often unknown at build time,
[`src/server.ts`](src/server.ts) also accepts extra hosts at runtime:

```bash
gcloud run services update angular-ssr --set-env-vars ALLOWED_HOSTS=shop.example.com
```

### 2. Node 20 cannot run Angular 22

`@angular/core@22` declares `engines: ^22.22.3 || ^24.15.0 || >=26.0.0`. Node 20
support was removed, so the `node:20-alpine` base image found in most SSR
tutorials fails at `npm ci`. This project uses `node:22-alpine`.

---

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listening port. Cloud Run **injects** this — never hardcode it. |
| `ALLOWED_HOSTS` | empty | Extra allowed hostnames, comma separated. Merged with `angular.json`. |
| `TRUST_PROXY_HEADERS` | `false` | Enable only with a trusted proxy in front (Cloud CDN, load balancer). |
| `RENDER_DELAY_MS` | `0` | Artificial data-loading delay, to simulate a slow upstream API. |
| `K_SERVICE`, `K_REVISION` | — | Injected by Cloud Run. Displayed in the telemetry bar. |
| `GOOGLE_CLOUD_PROJECT` | — | Enables trace correlation in logs. |

---

## Design system

The UI is built on Google's brand palette with a two-layer token system in
[`src/styles.scss`](src/styles.scss):

1. A **reference palette** — the raw Google brand ramps and neutral greys.
   Components never touch these directly.
2. A **semantic layer** — `--surface`, `--on-surface`, `--primary`,
   `--outline`, and so on. This is the only layer components consume, which is
   why adding the second theme meant reassigning about twenty variables instead
   of auditing every stylesheet.

Colour also carries meaning here: each render mode keeps one hue everywhere it
appears, so the telemetry bar's left border tells you which mode you are
looking at before you read a word.

| Render mode | Light | Dark |
| --- | --- | --- |
| Server | Google Green `#188038` | `#81c995` |
| Prerender | Google Blue `#1a73e8` | `#8ab4f8` |
| Client | Google Red `#d93025` | `#f28b82` |

### Themes

Light and dark, following the system preference by default and overridable
with the toggle in the header. Two details are worth copying:

- **No flash of the wrong theme.** A small inline script in
  [`index.html`](src/index.html) applies `data-theme` before first paint. The
  server cannot know a visitor's preference, so a theme decision made after
  bootstrap always arrives too late.
- **No hydration mismatch.** Nothing in the rendered markup depends on the
  theme — the toggle ships both icons and CSS reveals one. Server and client
  therefore produce identical HTML even when the stored preference differs from
  the server's default.

Inside a component, reacting to `data-theme` requires `:host-context()`, not
`:root`. Under emulated view encapsulation Angular rewrites `:root .icon` into
`[_ngcontent-x]:root .icon[_ngcontent-x]`, which can never match because
`<html>` carries no component attribute — a rule that silently does nothing.

### Contrast

Every text token was measured rather than assumed. All pass WCAG AA (4.5:1),
in both themes:

| | Light | Dark |
| --- | --- | --- |
| Body text | 16.1:1 | 13.4:1 |
| Secondary text | 6.1:1 | 6.1:1 |
| Primary / links | 4.5:1 | 7.6:1 |
| Server green | 5.0:1 | 8.2:1 |
| Client red | 4.8:1 | 6.7:1 |

Interactive controls use a separate `--outline-interactive` token, because the
decorative border colour reaches only 1.4:1 against white — well short of the
3:1 that WCAG 1.4.11 requires for the boundary of a control.

## How the telemetry works

The pattern is reusable for any server-only value the UI must keep after
hydration, and it is worth reading even if you do not care about the rest:

1. `server.ts` builds a context object per request and passes it as the second
   argument to `angularApp.handle(req, context)`.
2. Inside Angular, [`TelemetryStore`](src/app/core/telemetry.ts) reads it via
   the `REQUEST_CONTEXT` injection token.
3. Because `REQUEST_CONTEXT` is `null` in the browser, the store writes the
   values into `TransferState`, which Angular serializes into the HTML.
4. After hydration the client reads them back — no second request, no flicker.

Skip step 3 and the bar goes blank the moment JavaScript takes over.

---

## Project layout

```text
├── src/
│   ├── server.ts                    Express + telemetry, logs, /healthz, /api/instance
│   ├── styles.scss                  Design tokens and the two themes
│   ├── index.html                   Pre-paint theme script
│   └── app/
│       ├── app.routes.server.ts     Server | Prerender | Client — start here
│       ├── core/
│       │   ├── telemetry.ts         REQUEST_CONTEXT -> TransferState bridge
│       │   ├── theme.ts             Light/dark control
│       │   └── catalog.ts
│       ├── shared/
│       │   ├── telemetry-bar/       The sticky bar at the top
│       │   └── theme-toggle/
│       └── pages/{catalog,product,about,dashboard}/
├── demo/                            Measurement scripts
├── lambda/                          The same app on AWS Lambda, for comparison
├── Dockerfile                       Multi-stage, node:22-alpine
└── cloudbuild.yaml                  CI/CD pipeline
```

---

## Comparison: the same app on AWS Lambda

[`lambda/`](lambda/README.md) ports this application to AWS Lambda to make the
adaptation cost concrete. Short version: Cloud Run runs the `server.ts` Angular
already generated, while Lambda needs a separate entry point, an extra build
configuration, an event adapter and an infrastructure template.

That is a statement about **hosting Angular SSR specifically**, not about which
platform is better in general. The folder's README covers when Lambda is the
right call.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Every request returns `400` | Host not in `allowedHosts`. See the traps section. |
| `npm ci` fails in Docker | Base image older than Node 22.22. |
| Container starts but Cloud Run reports failure | Something is hardcoding a port instead of reading `PORT`. |
| Telemetry bar goes blank after load | `TransferState` bridge missing — see the telemetry section. |
| Garbled accents when running scripts | `.ps1` files must be UTF-8 **with BOM** for Windows PowerShell 5.1. |

## License

MIT.
