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
- **What a cold start is actually made of** — the process reports its own
  startup, stage by stage, and `/cold-start` renders the waterfall.
- **Why the fix is not a faster render** — `--min-instances` and `--cpu-boost`
  target different stages, and one of them cannot help you at all.
- **Why high concurrency works for SSR** — and the case where it does not.
- **Search that works without JavaScript** — resolved on the server, out of an
  index built once at boot, delivered inside the first HTML response.
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
reload: render origin, render time, **what this instance paid to start**,
instance id, request number, cold start or warm, `PORT`, and current
concurrency.

Then open <http://localhost:8080/cold-start> and reload it twice. The startup
column will not move; the render column drops by two orders of magnitude.

Prefer to skip Docker? `npm run build && npm run start:ssr` works too.

---

## The four routes

The render strategy lives in [`app.routes.server.ts`](src/app/app.routes.server.ts).
Open `view-source:` on each — the difference is immediate:

| Route | Mode | Raw HTML | What it means |
| --- | --- | --- | --- |
| `/` | `Server` | **~30 kB**, all 12 products present | Rendered per request. Price and stock are current. |
| `/?q=cobalt` | `Server` | **~44 kB**, 24 results | The query ran on the server, against an index built at boot. |
| `/cold-start` | `Server` | ~31 kB | The instance reporting on its own startup. |
| `/about` | `Prerender` | ~18 kB, frozen at build time | Generated once by `ng build`. Never wakes the renderer. |
| `/dashboard` | `Client` | **~4.6 kB**, empty `<app-root>` | Nothing rendered. The browser does all the work. |

Reload `/about` a few times: its timestamp **never changes**, because it
belongs to the build, not to your visit. That is the limit of prerendering, and
the reason a live catalog cannot use it.

`/dashboard` is the control group. It fetches the same data the server-rendered
pages already had — including the startup waterfall `/cold-start` renders
directly — but only after the bundle has downloaded and executed.

---

## The cold start, made honest

A hello-world SSR container starts in a few hundred milliseconds, which makes
cold starts look like a non-problem. Real applications are not hello-world:
before they can answer anything they load configuration from a secret store,
derive or verify keys, build caches, and open connection pools.

[`src/boot/startup.ts`](src/boot/startup.ts) does those four things, measured
individually, and the rest of the app reports what they cost:

| Stage | Kind | When | What it stands for |
| --- | --- | --- | --- |
| Load runtime configuration | I/O | before `listen` | Secret Manager / Parameter Store round trips |
| Derive signing keys | CPU | before `listen` | real `scrypt`, not a timer |
| Build the product index | CPU | before `listen` | real work: tens of thousands of SKUs, inverted index |
| Open the connection pool | I/O | **first request** | the database handshake the health check never saw |

Two of the four are measured simulations of network latency, and each one says
so in its own `detail` string. The two CPU stages are genuine work.

The split between the last row and the others is the part worth internalising.
The port does not open until the eager stages finish, so Cloud Run's startup
probe sees them — but the connection pool opens **after** the health check
already passed. As far as the platform is concerned the instance was ready;
the first real visitor waited anyway.

### Choosing how heavy startup should be

```bash
docker run -e BOOT_PROFILE=heavy -e PORT=8080 -p 8080:8080 angular-ssr-demo:local
```

| `BOOT_PROFILE` | Secrets | scrypt keys | SKUs indexed | Pool connect |
| --- | --- | --- | --- | --- |
| `off` | — | — | 1,200 | — |
| `realistic` (default) | 220 ms | 2 | 24,000 | 350 ms |
| `heavy` | 900 ms | 6 | 60,000 | 1,400 ms |

Measured with `node dist/angular-ssr-cloud-run/server/server.mjs` on a
developer laptop (Windows 11, Node 24.16) — no Docker, so no container
creation in these numbers:

| | `off` | `realistic` | `heavy` |
| --- | --- | --- | --- |
| Port opens after | 115 ms | 612 ms | 1,802 ms |
| — of which startup stages | 12 ms | 511 ms | 1,696 ms |
| Connection pool, billed to request #1 | 16 ms | 360 ms | 1,415 ms |
| First render | 147 ms | 137 ms | 143 ms |
| Warm render, mean | 12 ms | 11 ms | 10 ms |
| **Visitor on a scaled-to-zero service** | **278 ms** | **1,109 ms** | **3,360 ms** |
| **Cold vs warm** | **23x** | **101x** | **336x** |

Three things are worth reading twice:

1. **The render is not the variable.** First render stays around 140 ms in all
   three columns, because the profile changes startup, not rendering.
2. **Even with `off`, the first render costs 12x a warm one.** Nothing is
   JIT-compiled yet and the route's lazy chunk has not been loaded. That floor
   exists no matter how light your startup is.
3. **Node itself costs about 100 ms.** `612 − 511` is bundle evaluation and
   Node's own boot, before a line of application startup runs.

`off` is roughly what this project measured before the startup stages existed,
and roughly what a tutorial's hello-world SSR container measures today. It is
also why hello-world benchmarks understate the problem so badly.

---

## Search without JavaScript

`/` carries a plain `<form method="get">`. No `routerLink`, no `fetch`, no
client-side state: the browser navigates, the server queries the index it built
at boot, and the results arrive inside the HTML.

```text
GET /?q=cobalt+monitor  →  754 matches, index lookup 3.4 ms, 24 rendered
```

This is the version of a search feature that a crawler can follow and a visitor
with scripting disabled can still use — and it costs one HTTP round trip
instead of three (document, bundle, XHR).

It also makes the cold start argument concrete. Building that index is the
CPU stage in the table above: **one process pays 136 ms, and every request for
the rest of that instance's life is answered from memory in single-digit
milliseconds.** Losing the instance means paying it again.

The same index backs `GET /api/search?q=…&category=…&limit=…`, for anything
that is not a page render.

---

## Measuring things yourself

Six scripts, in the order they make sense. All accept `-?` for parameters.

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
.\demo\3-cold-start.ps1 -BootProfile heavy   # triple the startup work
.\demo\3-cold-start.ps1 -BootProfile off     # what hello-world measures
.\demo\3-cold-start.ps1 -DelayMs 800         # simulate a slow upstream API
```

It times container creation and the port opening, then reads `/api/boot` and
prints the startup breakdown the instance measured on itself — so the gap
between "container created" and "first connection accepted" is itemised
instead of assumed.

A local container skips the image-layer download and network latency Cloud Run
pays during provisioning, so absolute numbers are higher in the cloud. The
*ratio* is what reproduces faithfully — and the ratio is the point.

`-DelayMs` is the deliberate contrast: it inflates the warm column too, because
a slow upstream API is paid on every request. Startup work is paid once.

### `demo/4-concurrency.ps1` — one instance, many requests

Runs with `BOOT_PROFILE=off`, because this test is about throughput and startup
work would only add noise. **Two scenarios**, and the contrast is the lesson:

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

### `demo/6-min-instances.ps1` — measuring the fix, not the problem

```powershell
.\demo\6-min-instances.ps1
.\demo\6-min-instances.ps1 -BootProfile heavy
```

Times the same visit twice: once against a service that has scaled to zero, and
once against an instance somebody already warmed. It then prints the startup
cost of both — **identical**, because `--min-instances 1` makes nothing faster.
It changes who waits.

That is also the honest limitation: the instance bills continuously, traffic or
not. Steady traffic keeps instances warm on its own; spiky or low-volume
traffic is where every visitor is a first visitor.

---

## Observability

The server emits one JSON line per request, in the shape Cloud Logging indexes
without configuration:

```json
{"severity":"INFO","message":"GET /","instanceId":"c0e96f3d","renderMs":137,
 "warmupWaitMs":360,"coldStart":true,"bootMs":871,"requestNumber":1,
 "inFlight":1,"path":"/","status":200}
```

Startup gets its own line, emitted the moment the port opens:

```json
{"severity":"INFO","message":"Server ready to accept requests","bootProfile":"realistic",
 "bootMs":511,"bootStages":["runtime-config=229ms","signing-keys=146ms",
 "inventory-index=136ms"],"indexedSkus":24000,"processReadyMs":612}
```

`severity` becomes the real log level, so you can alert on `severity=ERROR`
without parsing text. When `GOOGLE_CLOUD_PROJECT` is set, each line also
carries a Cloud Trace correlation id, letting you jump from a log entry to the
full request.

From the outside, without reading a log at all:

| | |
| --- | --- |
| `Server-Timing` | `render;dur=137, warmup;dur=360, boot;dur=511` — renders as a waterfall in DevTools |
| `X-Instance-Id` | which process answered |
| `X-Cold-Start` | whether this request was the first |
| `X-Boot-Ms` | what that process paid to start |
| `GET /api/boot` | the full stage breakdown as JSON |
| `GET /api/instance` | live counters plus the same breakdown |

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
| `RENDER_DELAY_MS` | `0` | Artificial data-loading delay, paid on **every** request. |
| `BOOT_PROFILE` | `realistic` | Startup weight: `off`, `realistic` or `heavy`. |
| `BOOT_SECRETS_MS` | per profile | Simulated secret-store latency at startup. |
| `BOOT_KEY_DERIVATIONS` | per profile | How many real `scrypt` keys to derive at startup. |
| `INVENTORY_SIZE` | per profile | SKUs to generate and index at startup. |
| `DB_POOL_CONNECT_MS` | per profile | Simulated pool handshake, paid by the **first request**. |
| `K_SERVICE`, `K_REVISION` | — | Injected by Cloud Run. Displayed in the telemetry bar. |
| `GOOGLE_CLOUD_PROJECT` | — | Enables trace correlation in logs. |

The four `BOOT_*` / `INVENTORY_SIZE` variables override individual fields of
the chosen profile, so you can make exactly one stage expensive and watch the
waterfall on `/cold-start` change shape.

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

The startup waterfall extends the same rule: **amber for CPU stages, blue for
I/O**. They look different because they are fixed differently — `--cpu-boost`
moves the amber bars and does nothing at all to the blue ones.

### Typography

[Google Sans Flex](https://github.com/googlefonts/googlesans-flex) for the
interface and [Google Sans Code](https://github.com/googlefonts/googlesans-code)
for anything representing machine output — telemetry, identifiers,
measurements. Both are released by Google under the SIL Open Font License 1.1
and installed from `@fontsource-variable`, so they are genuinely
redistributable rather than merely named in a font stack and silently falling
back to Arial.

Two decisions follow from this being a performance project:

- **Self-hosted, not CDN-loaded.** The files ship inside the image. Server-side
  rendering exists so the first paint waits on nothing; adding a third-party
  round trip to the render path would undo that.
- **Latin subset only.** The packages ship ten to eleven subsets each.
  Importing their stylesheet wholesale copies 318 kB of woff2 into the build;
  declaring latin alone costs 83 kB. Browsers download only what they need at
  runtime, but the build copies every file it can see. See
  [`src/_fonts.scss`](src/_fonts.scss) to add the subsets you actually serve.

Both are variable fonts, so one file covers the entire weight axis, and both
use `font-display: swap` — never `block`, which would hide server-rendered HTML
behind a font download and throw away the LCP that SSR just earned.

### Themes

**Light by default.** The system preference is intentionally not consulted:
this project is read as documentation and shown on projectors, where a light
surface is the predictable choice. Dark is an explicit opt-in through the
header toggle, and the choice persists across reloads.

Two details are worth copying:

- **No flash of the wrong theme.** A small inline script in
  [`index.html`](src/index.html) applies `data-theme` before first paint. The
  server cannot know a visitor's stored choice, so a theme decision made after
  bootstrap always arrives too late. Because light is the default, doing
  nothing is also the correct fallback when storage is unavailable.
- **No hydration mismatch.** Nothing in the rendered markup depends on the
  theme — the toggle ships both icons and CSS reveals one. Server and client
  therefore produce identical HTML even when the stored preference differs from
  the default.

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

## How the server talks to the renderer

The pattern is reusable for any server-only value the UI must keep after
hydration, and it is worth reading even if you do not care about the rest:

1. `server.ts` builds one context object per request — telemetry, the resolved
   search results, the resolved product — and passes it as the second argument
   to `angularApp.handle(req, context)`.
2. Inside Angular, [`TelemetryStore`](src/app/core/telemetry.ts) and
   [`CatalogStore`](src/app/core/catalog.ts) each read their own slice of it
   through the `REQUEST_CONTEXT` injection token.
3. Because `REQUEST_CONTEXT` is `null` in the browser, each store writes what
   it needs into `TransferState`, which Angular serializes into the HTML.
4. After hydration the client reads them back — no second request, no flicker.

Skip step 3 and the bar goes blank the moment JavaScript takes over.

Step 3 has a corollary worth applying: **only transfer what the client cannot
produce itself.** The curated twelve products ship inside the bundle already,
so `CatalogStore` transfers a slice only when it holds search results. Skipping
that check would send the same products twice in every response — once as
markup, once as JSON.

---

## Project layout

```text
├── src/
│   ├── server.ts                    Express + telemetry, logs, /healthz, /api/*
│   ├── boot/
│   │   ├── startup.ts               The measured startup sequence
│   │   └── inventory.ts             SKU generation + inverted index + search
│   ├── styles.scss                  Design tokens and the two themes
│   ├── _fonts.scss                  Self-hosted Google Sans faces
│   ├── index.html                   Pre-paint theme script
│   └── app/
│       ├── app.routes.server.ts     Server | Prerender | Client — start here
│       ├── core/
│       │   ├── telemetry.ts         REQUEST_CONTEXT -> TransferState bridge
│       │   ├── catalog.ts           The same bridge, second use
│       │   ├── catalog-data.ts      Framework-free types + curated products
│       │   ├── boot-report.ts       Framework-free startup types
│       │   └── theme.ts             Light/dark control
│       ├── shared/
│       │   ├── telemetry-bar/       The sticky bar at the top
│       │   ├── boot-waterfall/      Startup, drawn as stages
│       │   └── theme-toggle/
│       └── pages/{catalog,product,cold-start,about,dashboard}/
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

The startup sequence is shared between both entry points, which makes the
lifecycle difference visible: Lambda has no `--min-instances`. Provisioned
concurrency exists, but it is billed by the hour whether or not anything calls
the function, and execution environments are reclaimed on the platform's
schedule rather than yours — so the same startup work gets paid more often.

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
| Startup takes seconds and you did not ask for it | `BOOT_PROFILE` defaults to `realistic`. Set it to `off`. |
| Telemetry bar goes blank after load | `TransferState` bridge missing — see the section above. |
| Garbled accents when running scripts | `.ps1` files must be UTF-8 **with BOM** for Windows PowerShell 5.1. |

## License

MIT.
