# META·LAB — Deployment Readiness

Operational guide for deploying the META·LAB monorepo (React + Vite frontend, Express + Prisma API). Covers build, DB migration, environment variables, CORS/session/cookie hardening, HTTPS, the GitHub-main → live workflow, and the `/api/version` versioning process.

> Stack: ESM (`"type": "module"`) throughout. Frontend = Vite (root). API = Express on port `3001`, entry `server/index.js`, which loads `server/.env` via `server/load-env.js` before any Prisma/JWT code runs. Dev proxy: `vite.config.js` forwards `/api` → `http://127.0.0.1:3001`.

---

## 1. Build

```bash
# from repo root
npm install
npm run build        # → vite build, emits static assets to ./dist
```

Server deps install separately:

```bash
cd server
npm install
npx prisma generate   # regenerate the Prisma client for the target platform
```

The frontend talks to the API via the relative `/api` path. In production the reverse proxy / host must route `/api/*` to the Node API process and serve `./dist` for everything else (or serve `dist` from a static host and point the frontend origin at the API via `CORS_ORIGIN`).

---

## 2. Database migration in production

Dev uses SQLite (`server/prisma/dev.db`). **Production should use a managed database (PostgreSQL).** See §7.

Apply committed migrations on the production database (do NOT use `migrate dev` in prod — it can generate/reset):

```bash
cd server
npx prisma migrate deploy
```

`migrate deploy` applies any pending migrations in `server/prisma/migrations/` against `DATABASE_URL`. Migrations are **additive** — never hand-edit applied migrations; create new ones for schema changes.

**prompt6 (v2.5.0)** adds one additive migration — `20260610034844_prompt6_notifications_logins_status_fingerprint`: new `Notification`, `LoginEvent`, and `ScreenProjectStatusEvent` tables, fingerprint columns on `ScreenImportBatch` (nullable/defaulted), and an index on `ScreenProject.linkedMetaLabProjectId`. No destructive changes; existing users/projects/records/links are preserved. `npx prisma migrate deploy` + `npx prisma generate` is all the DB work this release needs.

---

## 3. Environment variables

Two env files. Copy each `.example` and fill real values; never commit the real files.

- **`server/.env`** (server runtime) — template: `server/.env.example`
- **`.env`** (root, frontend build/deploy) — template: `.env.example`

### Server vars (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma connection string. Dev: `file:./dev.db` (SQLite). Prod: managed Postgres URL. |
| `JWT_SECRET` | Secret used to sign session JWTs. Long random hex; rotate on compromise. |
| `NODE_ENV` | `development` or `production`. `production` enables Secure cookies + strict auth rate limiting (20 req/15 min). |
| `PORT` | Port the Express API listens on (default `3001`). |
| `ADMIN_EMAIL_1` | First seeded admin account email. |
| `ADMIN_EMAIL_2` | Second seeded admin account email. |
| `ADMIN_SEED_PASSWORD` | Initial password for seeded admins; rotate after first login. |
| `CORS_ORIGIN` | Allowed browser origin for credentialed requests. Primary CORS source. |
| `APP_BASE_URL` | Canonical public base URL; CORS fallback when `CORS_ORIGIN` unset; used for email links. |
| `EMAIL_PROVIDER` | Mail backend selector (e.g. `smtp`, `console`, `none`). |
| `SMTP_HOST` | SMTP server host (when `EMAIL_PROVIDER=smtp`). |
| `SMTP_PORT` | SMTP server port (e.g. `587`). |
| `SMTP_USER` | SMTP auth username / API key. |
| `SMTP_PASS` | SMTP auth password / API secret. |
| `EMAIL_FROM` | Default `From:` address for outbound mail. |
| `GIT_COMMIT` | (Optional) build commit shown by `/api/version`. Set in CI. |
| `BUILD_DATE` | (Optional) ISO build timestamp shown by `/api/version`. Set in CI. |

> The CORS and email/SMTP vars are consumed by code owned by other devs / introduced alongside this work. They are listed here and in `server/.env.example` so every var the app uses is documented in one place.

### Root vars (`.env`)

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | Public frontend origin; also the API's CORS fallback. |
| `VITE_*` | Any client-exposed build-time vars (none required today; frontend uses relative `/api`). |

---

## 4. CORS, session, and cookie production notes

### CORS
`server/index.js` now reads the allowed origin from the environment:

```js
const ORIGIN = process.env.CORS_ORIGIN || process.env.APP_BASE_URL || 'http://localhost:3000';
app.use(cors({ origin: ORIGIN, credentials: true }));
```

In production set `CORS_ORIGIN` to the exact deployed frontend origin (scheme + host, e.g. `https://app.example.com`). `credentials: true` is required so the httpOnly session cookie is sent on cross-origin requests; with credentials you must use a specific origin (not `*`).

### Session cookie — REQUIRED production change

The session cookie is set in **`server/controllers/authController.js`** (`cookieOptions()`), and the cookie name `metalab_session` is defined there and in **`server/middleware/auth.js`** (`COOKIE_NAME`). These files are NOT modified by this task — the change is documented here and must be made by their owner.

Current options:

```js
// server/controllers/authController.js
function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',  // ✓ already env-gated
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}
```

- `secure: true` is already correctly gated on `NODE_ENV === 'production'` — **ensure `NODE_ENV=production` is set in the deployed environment**, otherwise the cookie is sent over plain HTTP.
- `sameSite: 'strict'` works only when the frontend and API share a site. **If the frontend is served from a different site/origin than the API (cross-site), `SameSite=Strict` will block the cookie** — change it to `sameSite: 'none'` (which requires `secure: true`, i.e. HTTPS) for the login/register/logout cookies. Use `'lax'` only for same-site top-level navigation flows.
- The `logout` handler's `clearCookie` options (also in `authController.js`) must mirror whatever `sameSite`/`secure` values the set-cookie uses, or the cookie won't clear.

Summary of the production cookie target (to be applied in `authController.js`):

| Option | Same-site deploy | Cross-site deploy |
|---|---|---|
| `secure` | `true` (HTTPS) | `true` (HTTPS, mandatory) |
| `sameSite` | `'lax'` or `'strict'` | `'none'` |
| `httpOnly` | `true` | `true` |

---

## 5. HTTPS

Production must run behind HTTPS (terminated at a reverse proxy / platform load balancer). Reasons:
- `secure: true` cookies are only transmitted over HTTPS — without it, authenticated sessions silently break.
- `SameSite=None` (cross-site cookie) is rejected by browsers unless `Secure`.
- `helmet` is enabled in `server/index.js` (`contentSecurityPolicy: false`); consider enabling HSTS at the proxy.

Ensure the proxy forwards the correct protocol headers and that the Node process trusts them if the app ever needs `req.secure` / correct `req.ip` (Express `trust proxy`).

---

## 5b. SSE in production (`GET /api/events`) — prompt6

The realtime layer is a single Server-Sent Events stream per browser tab (`server/routes/events.js`; architecture: `docs/manager/realtime-architecture.md`). It is deployment-sensitive — a buffering proxy silently breaks it. Requirements:

- **Disable response buffering for the stream route.** The route already sends `X-Accel-Buffering: no` (honored per-response by nginx); with nginx also set `proxy_buffering off;` for `/api/events`. Anything that buffers or compresses whole responses must exclude this route.
- **Read timeout > heartbeat.** The server writes a `:hb` comment frame every **25 s**; set `proxy_read_timeout` ≥ 60 s so idle streams are never reaped between heartbeats.
- **Keep-alive streaming.** HTTP/1.1 to the upstream with `proxy_set_header Connection '';` (nginx) so the long-lived response can stream.
- **No compression middleware.** The Express app deliberately has none (verified); if one is ever added globally, `/api/events` must be excluded or frames will buffer until close.
- **Degradation is safe by design.** If SSE is blocked by the platform, every feature still works via the pre-existing polling (chat 4 s, notifications bell 30 s, load-on-navigation) — realtime only makes them faster. No flag needed.
- **Single-process limitation.** The event bus is in-process memory (`server/realtime/bus.js`). Running multiple Node processes (pm2 cluster, replicas) splits the registry — users connected to one process miss emits from another. Scale realtime horizontally only after adding a broker (Redis pub/sub); until then run a single API process (consistent with SQLite anyway). Polling keeps features correct even if this is violated.

**Rate-limiter invariant (do not regress):** `/api/notifications` and `/api/events` are mounted on their **own routers** behind `requireAuth` only. They must **never** move under the rate-limited `/api/auth` (20 req/15 min) or `/api/admin` mounts — the bell polls `unread-count` and a reconnecting EventSource retries; either would burn those limiters and lock users out of login or the ops console.

---

## 6. "Pushing to GitHub main deploys live" — checklist

Pushing to `main` deploys to production. Before pushing:

- [ ] `npm run build` succeeds locally (no Vite errors).
- [ ] `node --check server/index.js` and `node --check server/version.js` pass.
- [ ] All required prod env vars set on the host: `NODE_ENV=production`, `DATABASE_URL` (managed DB), `JWT_SECRET`, `CORS_ORIGIN`/`APP_BASE_URL`, `ADMIN_*`, SMTP vars if email is enabled.
- [ ] DB migrations committed and `npx prisma migrate deploy` runs in the deploy step.
- [ ] Cookie options in `authController.js` reviewed for the deploy topology (§4).
- [ ] `CORS_ORIGIN` matches the live frontend origin exactly.
- [ ] `GIT_COMMIT` / `BUILD_DATE` set in CI so `/api/version` reflects the build (§8).
- [ ] No secrets committed; `.env` / `server/.env` are gitignored.
- [ ] Smoke test after deploy: `GET /api/health` → `{ status: "ok" }` and `GET /api/version` returns the expected version + commit.
- [ ] SSE smoke test (§5b): `curl -N https://<host>/api/events` with a valid session cookie → `retry:` + `:connected` arrive immediately, `:hb` within ~25s (proves the proxy isn't buffering).

---

## 7. Production database: SQLite → managed Postgres

The dev DB is SQLite (`server/prisma/dev.db`, Prisma `provider = "sqlite"`). For production:

1. Switch the Prisma datasource provider in `server/prisma/schema.prisma` to `postgresql` (owned by the schema owner — not changed by this task).
2. Provision a managed Postgres instance and set `DATABASE_URL` to its connection string.
3. Regenerate the client (`npx prisma generate`) and create/apply migrations (`npx prisma migrate deploy`).
4. Keep migrations **additive**; never rewrite an already-applied migration.

A file-based SQLite DB is unsuitable for production (no concurrency safety, lost on ephemeral filesystems, no managed backups).

---

## 8. Versioning — `/api/version`

A public, unauthenticated route exposes build metadata that **changes with each commit** (prompt5 Task 7):

```
GET /api/version
→ { "name": "META·LAB", "version": "2.5.0", "commit": "dff653b",
    "commitDate": "2026-06-10T...", "buildDate": "2026-06-10T...",
    "full": "v2.5.0 · dff653b · 2026-06-10" }
```

Implemented in `server/version.js` (`getVersion()`), wired in `server/index.js` next to `/api/health`. All values are resolved **once at module load** and cached, so the route does no fs/git work per request. `GET /api/health` and the ops `GET /api/admin/health` also report the real `version` (no longer hardcoded). Display: the shared `UserMenu` account dropdown (META·LAB, META·SIFT, ops) shows `full`, the ops sidebar footer shows version + commit + date, and (since prompt6) the META·LAB monolith sidebar footer fetches `/api/version` too — the last hardcoded version surface ("v2.0 · PRISMA 2020") is gone. The server logs the version on boot:

```
META·LAB API on :3001 (v2.5.0 · dff653b)
```

Derivation (most authoritative first — so the value changes per commit and degrades gracefully):

| Field | Source (in order) |
|---|---|
| `name` | Constant `"META·LAB"`. |
| `version` | Root `package.json` `"version"` (read once). |
| `commit` | `env GIT_COMMIT` → generated `server/version.json` → `git rev-parse --short HEAD` → `"dev"`. |
| `commitDate` | `env GIT_COMMIT_DATE` → generated `version.json` → `git log -1 --format=%cI` → `null`. |
| `buildDate` | `env BUILD_DATE` → generated `version.json` → `commitDate` → module-load ISO time. |
| `full` | `vX.Y.Z · <shortCommit> · <YYYY-MM-DD>`. |

### Build-time generation (preferred for production)

The deployed container often has no `.git` directory. `npm run build` runs `npm run version:gen`
(`scripts/generate-version.js`), which writes `server/version.json` with the commit + commit date + build timestamp.
`version.js` prefers that file when git is unavailable, so the deployed app still reports the real version. You can also
inject env vars in CI instead:

```bash
export GIT_COMMIT="$(git rev-parse --short HEAD)"
export GIT_COMMIT_DATE="$(git log -1 --format=%cI)"
export BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

When all of git, `version.json`, and env are unavailable, `commit` falls back to `"dev"`. To release a new version, bump
`"version"` in the root `package.json` (currently `2.5.0`).
