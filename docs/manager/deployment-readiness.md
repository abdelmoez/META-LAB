# META·LAB — Deployment Readiness

Operational guide for deploying the META·LAB monorepo (React + Vite frontend, Express + Prisma API). Covers build, DB migration, environment variables, CORS/session/cookie hardening, HTTPS, the GitHub-main → live workflow, and the `/api/version` versioning process.

> Stack: ESM (`"type": "module"`) throughout. Frontend = Vite (root). API = Express on port `3001`, entry `server/index.js`, which loads `server/.env` via `server/load-env.js` before any Prisma/JWT code runs. Dev proxy: `vite.config.js` forwards `/api` → `http://127.0.0.1:3001`.
>
> 93.md operational companions: deploy = `deploy/metalab-deploy.sh` (+ `deploy/rollback.sh`), reverse proxy = `deploy/nginx/`, process manager = `ecosystem.config.cjs` + `docs/manager/pm2-operations.md`, staging = `docs/manager/staging-deployment.md`, and the full runbook index in the repo `README.md`.

---

## 1. Build

```bash
# from repo root
npm install
npm run build        # stage OCR assets → version:gen → vite build → prerender-public
```

`npm run build` is four steps, and the last one is load-bearing for SEO:
`scripts/prerender-public.mjs` renders every public page to
`dist/__prerender/<path>/index.html` and regenerates `dist/sitemap.xml`,
`dist/robots.txt` and `dist/llms.txt`. It **fails the build** (non-zero exit, no
artefacts shipped) when an indexable page will not render, when a page does not have
exactly one `<h1>`, or when a prerendered page's inline scripts stop being
byte-identical to `dist/index.html` (they are hashed into the CSP at runtime). Treat a
prerender failure as a broken build, never as a warning to skip — and see §5c for the
serving side, which is where this output actually has to end up.

Server deps install separately:

```bash
cd server
npm install
npx prisma generate   # regenerate the Prisma client for the target platform
```

The frontend talks to the API via the relative `/api` path. In production the reverse proxy / host must route `/api/*` to the Node API process and serve `./dist` for everything else (or serve `dist` from a static host and point the frontend origin at the API via `CORS_ORIGIN`).

---

## 2. Database migration in production

Dev uses SQLite (`server/prisma/dev.db`); the live VPS also runs **SQLite** (`prod.db` at
`/var/lib/metalab/prod.db`). PostgreSQL remains the recommended target for scale (see §7) but is not what
production runs today.

> **⚠️ TRANSITIONAL (93.md §2.2/§3.6):** the `db push` flow described below is the legacy VPS behavior and
> is being replaced. The committed, release-based deploy script **`deploy/metalab-deploy.sh`** (install to
> `/usr/local/bin/metalab-deploy.sh`) keeps the sqlite `db push` branch only until the PostgreSQL cutover;
> with `DATABASE_PROVIDER=postgres` it runs versioned **`prisma migrate deploy`**
> (`npm run db:migrate:deploy:postgres` — see `docs/manager/postgres-migration.md` § Versioned migration
> workflow). Rollback (auto on failed readiness + the manual `deploy/rollback.sh` fast path):
> `docs/manager/rollback-runbook.md`.

> **How the legacy in-place VPS script applied schema changes (verified from the deploy log, 2026-06-12):**
> the old `/usr/local/bin/metalab-deploy.sh` ran **`npx prisma db push`** against `prod.db` — NOT `migrate deploy`.
> `db push` diffs `schema.prisma` directly against the database and ignores `server/prisma/migrations/`
> entirely. This is why committed migrations alone neither help nor break that deploy. The transitional
> sqlite branch of the new script behaves identically on purpose.

> **⚠️ db-push-safety rule (the prompt9 deploy failure — read before any schema change):**
> The deploy script runs `db push` **without `--accept-data-loss`** (correct — an unattended prod deploy must
> never silently drop data). So any change Prisma flags as data-loss **aborts the deploy** (`script_stop:true`)
> and the site stays on the previous version. Flagged operations: **adding a `@unique`/unique index to an
> existing table**, dropping a column/table, or narrowing a column type. prompt9 originally added
> `inviteTokenHash @unique`, which aborted runs 9 and 10. Fix: keep schema changes **db-push-safe** — additive
> nullable columns, new tables, and **plain `@@index` (never a new `@unique` on a populated table)**. If a
> unique constraint is genuinely required, apply it as a separate **manual** step on the VPS
> (`prisma db push --accept-data-loss` run by hand after reviewing the data), not through the unattended deploy.

The history-aware alternative (`cd server && npx prisma migrate deploy`) is preferred long-term but is **not
wired into the deploy script**; adopting it needs the one-time baseline in §2b plus a script edit. Migrations
are **additive** — never hand-edit an already-applied migration; create new ones for schema changes.

**prompt6 (v2.5.0)** adds one additive migration — `20260610034844_prompt6_notifications_logins_status_fingerprint`: new `Notification`, `LoginEvent`, and `ScreenProjectStatusEvent` tables, fingerprint columns on `ScreenImportBatch` (nullable/defaulted), and an index on `ScreenProject.linkedMetaLabProjectId`. No destructive changes; existing users/projects/records/links are preserved. `npx prisma migrate deploy` + `npx prisma generate` is all the DB work this release needs.

**prompt9 (v2.7.0)** adds one additive migration — `20260611165749_prompt9_invites_lifecycle_usage`: invite columns on `ScreenProjectMember` (`invitedByUserId`, `inviteTokenHash` **plain-indexed, not unique** — see the db-push-safety rule above; uniqueness is guaranteed by 256-bit random tokens + single-use nulling), `inviteExpiresAt`, `inviteAcceptedAt`, `Notification.clickedAt`, `Project.deletedSource`, `ScreenProject.deletedAt`/`deletedSource`, and the new no-FK `UsageEvent` table. All nullable/defaulted; no destructive changes; **db-push-safe**.

### 2b. Migration history is now committed (fixed 2026-06-12)

Until v2.7.0 this checklist said "migrations committed" while `.gitignore` excluded
`server/prisma/migrations/` — every migration since `init` existed only on the dev machine, so a clean
clone could not `migrate deploy`. As of this fix the **full 12-migration history + `migration_lock.toml`
is in git** and the contradiction is closed.

**One-time baseline for a pre-existing deployed database.** If the deployed DB was previously synced
without migration history (e.g. `prisma db push`, or a copied dev.db), its `_prisma_migrations` table is
missing or incomplete, and the first `migrate deploy` would try to re-apply migrations against existing
tables and fail. Baseline it once by marking every migration that is already reflected in the schema as
applied, then deploy normally:

```bash
cd server
# for each already-reflected migration directory, oldest → newest:
npx prisma migrate resolve --applied 20260607134620_init
npx prisma migrate resolve --applied 20260607145855_add_autosave_profile_contact
# ... (repeat through the newest migration already present in the DB schema)
npx prisma migrate deploy   # applies only what remains
```

Quick check of what the DB already has: `npx prisma migrate status` (lists pending vs applied).
**This baseline is only needed if/when a database created by `db push` is switched to `migrate deploy`.**
The transitional sqlite branch of `deploy/metalab-deploy.sh` still uses `db push` (needs no history); the
PostgreSQL path uses `migrate deploy` from day one, and a fresh PG database needs no baseline (the committed
migrations ARE its history). Full workflow + PG baseline commands: `docs/manager/postgres-migration.md`.

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
| `APP_BASE_URL` | Canonical public base URL; CORS fallback when `CORS_ORIGIN` unset; used to build invite + password-reset email links. |
| `EMAIL_PROVIDER` | Informational mail-backend label shown in the ops console (e.g. `smtp`, `resend`). |
| `SMTP_HOST` | SMTP server host. Sending requires this **and** `EMAIL_FROM`. |
| `SMTP_PORT` | SMTP server port. `587`→STARTTLS (default), `465`→implicit TLS. |
| `SMTP_USER` | SMTP auth username / API key (optional — omit for unauthenticated relays). |
| `SMTP_PASS` | SMTP auth password / API secret (optional). |
| `EMAIL_FROM` | Default `From:` address for outbound mail. Required to send. |
| `PASSWORD_RESET_TTL_MINUTES` | (Optional) reset-token link lifetime in minutes (default `60`). |
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

## 5c. SEO serving (113.md §1) — the prerendered documents MUST reach the crawler

**This section exists because it went wrong in production.** On 2026-08-10 the live
site served the empty SPA shell on *every* route: `/features/screening` returned the
homepage `<title>`, no meta description, no `<h1>`, no article text and no JSON-LD.
`dist/__prerender/` had been built and deployed and was never read once. Nothing was
indexed. The application code was correct the whole time — the reverse proxy was
answering page requests from `dist/` with a plain `try_files … /index.html` SPA
fallback, so `server/middleware/publicPages.js` never ran.

It is invisible without a deliberate check: a browser executes the JavaScript and
renders a perfect page, so the site *looks* fine to everyone who is not a crawler.

### How serving is supposed to work

1. `npm run build` runs `scripts/prerender-public.mjs`, which writes a fully rendered,
   crawlable document to `dist/__prerender/<path>/index.html` for **every** entry in
   `src/frontend/website/publicPages.js`, and regenerates `sitemap.xml`, `robots.txt`
   and `llms.txt` into `dist/`. An indexable page that fails to render, renders zero or
   two `<h1>`s, or whose inline scripts stop matching the shell's (the CSP byte-identity
   guard) is a **hard build failure** — the build is the first gate.
2. `server/middleware/publicPages.js` classifies each GET and answers with one of:
   the prerendered document, a 301, a real 404, or the SPA shell (+ `X-Robots-Tag`).
3. **The reverse proxy must let requests reach step 2.** That is the whole job, and it
   is the step that failed.

### Required proxy configuration

Use `deploy/nginx/pecanrev.conf.example` as-is — it proxies every non-`/assets`
request to Node (**recipe A**). Read the box at the top of that file before editing it.

If Node genuinely cannot sit in front of page requests, use **recipe B** (the
commented block at the bottom of the same file), which is prerender-aware:

```nginx
root /var/www/pecanrev/dist;
location = /            { try_files /__prerender/index.html /index.html; }
location /              { try_files /__prerender$uri/index.html $uri /index.html; }
location ^~ /__prerender/ { return 404; }
```

Recipe B serves the correct document per page but **loses**, honestly: real 404s
(every unknown URL becomes a 200 soft-404), the `PERMANENT_REDIRECTS` 301s and the
trailing-slash/case canonicalisations, `X-Robots-Tag: noindex` on `/app` `/ops` and
token URLs, and every helmet security header including CSP (files off disk get none —
you must re-add them at nginx). Prefer recipe A.

**Never** use `try_files $uri $uri/ /index.html` for page routes. That is the bug.

### www and TLS

`www.pecanrev.com` served a certificate covering only the apex, so www was a hard TLS
error rather than a redirect. Fix DNS + reissue with both names as SANs
(`certbot --nginx -d pecanrev.com -d www.pecanrev.com`), then the `www` → apex 301
server block in the example config takes over. Every canonical the app emits is
apex-absolute (`SITE_ORIGIN`), so two live hostnames would split the signal.

### Verification (run after every deploy AND every nginx change)

```bash
# THE check. A feature page must serve its OWN title, not the homepage's.
curl -s https://pecanrev.com/features/screening | grep -o '<title>[^<]*'
#   ✓ <title>Title, Abstract &amp; Full-Text Screening Software | PecanRev
#   ✗ <title>PecanRev — Systematic Review & Meta-Analysis Platform   ← prerender not served

# Exactly one <h1>, and it is the page's own.
curl -s https://pecanrev.com/features/screening | grep -c '<h1'            # → 1
curl -s https://pecanrev.com/features/screening | grep -o '<h1[^>]*>[^<]*' # → screening headline

# Page-specific description + canonical, and structured data.
curl -s https://pecanrev.com/features/screening \
  | grep -oE '<(meta name="description"|link rel="canonical")[^>]*'
curl -s https://pecanrev.com/features/screening | grep -c 'application/ld+json'   # → ≥1

# Soft-404 regression alarm — both must be 404.
curl -sI https://pecanrev.com/this-does-not-exist    | head -1
curl -sI https://pecanrev.com/features/does-not-exist | head -1

# Redirects, noindex headers, and the internal prerender dir.
curl -sI https://pecanrev.com/privacy | grep -iE '^(HTTP|location)'   # 301 → /terms#privacy
curl -sI https://pecanrev.com/app     | grep -i x-robots-tag          # noindex, nofollow
curl -sI https://pecanrev.com/__prerender/terms/index.html | head -1  # → 404

# Crawler files.
curl -s  https://pecanrev.com/robots.txt  | tail -1                   # Sitemap: …
curl -s  https://pecanrev.com/sitemap.xml | grep -c '<loc>'           # every submitted page
curl -sI https://pecanrev.com/llms.txt    | head -1                   # 200

# www is a 301, not a certificate error.
curl -sI https://www.pecanrev.com/ | head -1                          # → 301
```

`/login` and `/register` are deliberately **absent from `sitemap.xml`** (registry
`sitemap: false`) while remaining indexable and present in `llms.txt` — if they
reappear in the sitemap, a registry entry lost its flag.

### Owner actions this repo cannot perform

- Google Search Console: verify the property, submit `https://pecanrev.com/sitemap.xml`,
  then watch **Coverage → Soft 404** weekly. A soft-404 spike is this failure returning.
- Bing Webmaster Tools: same property + sitemap.
- DNS `www` record + certificate SAN (above).

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
- [ ] **SEO serving smoke test (§5c)** — `curl -s https://<host>/features/screening | grep -o '<title>[^<]*'` prints the *screening* title, and `curl -sI https://<host>/this-does-not-exist` is a **404**. A page-shaped 200 with the homepage title means the prerendered documents are not being served and the site is invisible to crawlers.

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
