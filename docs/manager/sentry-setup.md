# Sentry setup (93.md §5.1)

Both integrations are **DSN-gated no-ops**: with no DSN configured (the
default, including every dev build and CI) the SDK is never even downloaded
and zero network calls are made. Creating the Sentry organization/projects and
obtaining DSNs is **external** (launch checklist: "Requires provider-account
creation"); everything below that point is already implemented in code.

## Where the code lives

| Side | Module | Wired from |
|---|---|---|
| Server | `server/services/errorTracking.js` | `server/index.js` boot + global error handler + process guards; flushed with a hard bound during graceful shutdown |
| Client (SPA) | `src/frontend/monitoring/sentryClient.js` | `src/main.jsx` boot; bridges the existing `errorReporting.reportClientError` funnel (error boundaries, unhandled rejections, window errors) |

## Environment variables

### Server (`server/.env` → `shared/server.env` on the VPS)

| Var | Default | Meaning |
|---|---|---|
| `SENTRY_DSN` | unset → disabled | the server project's DSN |
| `SENTRY_ENVIRONMENT` | falls back to `NODE_ENV` | `production` / `staging` — keeps the streams separate |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` (tracing OFF) | conservative opt-in, e.g. `0.05` |

### Client (root `.env`, **build-time** — Vite inlines `VITE_*` at `npm run build`)

| Var | Default | Meaning |
|---|---|---|
| `VITE_SENTRY_DSN` | unset → disabled | the frontend project's DSN (DSNs are not secrets, but use a *separate project* from the server) |
| `VITE_SENTRY_ENVIRONMENT` | falls back to Vite `MODE` | `production` / `staging` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | `0` | conservative opt-in |

Because client vars are baked at build time, the **staging build must be built
with the staging values** (the deploy builds per-environment, so this is
automatic when the staging checkout's root `.env` is staging-specific — see
`staging-deployment.md`).

## Environment separation

Set `SENTRY_ENVIRONMENT=production` on prod and `staging` on staging (the
staging template `server/.env.staging.example` already does; PM2's
`env_staging` block sets `APP_ENV=staging` which the server also reports).
Ideally use two Sentry *projects* (server/client) × environment tags; at
minimum keep the environment tag correct so alerts can filter on it.

## Scrubbing contract (implemented in code — do not weaken)

- `sendDefaultPii: false` on both sides — no IPs, cookies, or headers by
  default.
- Server `beforeSend` deletes `request.cookies/headers/data/query_string`,
  strips URLs to the path, and redacts `?token=/invite=/t=` URL params;
  `event.user` is removed and only the **internal user id** is ever attached
  (as `scope.setUser({id})` from the error handler's context — never email or
  name).
- Client `beforeSend`/`beforeBreadcrumb` strip query strings from URLs, drop
  `console` breadcrumbs entirely (they can quote content), and truncate
  messages. Session replay is **deliberately never registered** (93.md §5.3).
- Request bodies are never sent (they may contain manuscript/research
  content).
- Sentry failure never affects the app: SDK loads lazily inside try/catch and
  every capture is guarded.

Any change to these modules must preserve this contract — it is part of the
93.md acceptance criteria ("Sensitive information is redacted … Sentry
failures do not affect application availability").

## Release tagging

Releases are tagged automatically as `pecanrev@<version>+<commit>` (server,
from the build-time `server/version.json`) and `pecanrev@<releaseId>`
(client). No manual step.

## Source maps (OPTIONAL manual step)

The production build emits minified bundles; without uploaded source maps,
client stack traces are minified. This is acceptable for beta. To improve
them later (requires a `SENTRY_AUTH_TOKEN` — external credential):

1. Create an internal integration token in Sentry (scope: `project:releases`).
2. Add `@sentry/vite-plugin` to the build with the org/project/token, or run
   `sentry-cli sourcemaps upload` against `dist/` in the deploy step.
3. Keep the token ONLY in CI secrets / the VPS env — never in the repo.
Do **not** ship `.map` files publicly as an alternative; upload to Sentry or
skip.

## Test procedure (after DSNs are configured)

1. **Server**: temporarily add a throwing route or run on staging:
   `curl -s https://staging.example.com/api/<some-500-path>` — any unhandled
   route error flows through the global error handler → `captureException`.
   Simplest deliberate test: from `server/`,
   `node -e "process.env.SENTRY_DSN='<dsn>'; const et=await import('./services/errorTracking.js'); await et.initErrorTracking(); et.captureException(new Error('sentry server smoke test')); await et.flushErrorTracking();"`
   (run with `node --input-type=module`).
2. **Client**: on staging, open the browser console and run
   `window.__pecanSentryCapture(new Error('sentry client smoke test'), {kind:'manual-test'})`.
3. In Sentry: both events appear in the right project **with the right
   `environment` tag**, URLs have no query strings, and no cookies/headers/
   body data are attached (open the event JSON and check the `request`
   object).
4. Delete any temporary throwing route afterwards.
