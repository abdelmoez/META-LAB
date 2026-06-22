# Production deployment config — env, cookies, CORS, SSE (prompt49 item 6)

This is the operator reference + the rationale for the cookie/CORS/SSE choices.
It complements the boot-time diagnostic (`server/config/validateConfig.js` →
`runStartupConfigCheck()`), which refuses to start in production when a critical
value is missing and only warns in dev.

## Architecture (verified)
`pecanrev.com` (and optionally `www.`) → TLS-terminating reverse proxy (nginx) →
single-process Node/Express API on `:3001` → SQLite file (or PostgreSQL after the
item-2 cutover). The SPA is built static and served by nginx/Vite; the API is
JSON-only. There is **no compression middleware** in the API process (so SSE
frames flush immediately), and `trust proxy` is configured so `req.ip` is the
real client IP behind the proxy.

## Environment variables that gate production boot
`runStartupConfigCheck()` (in `server/index.js`, first thing at boot) validates:
- **JWT_SECRET** — present, ≥16 chars, not a placeholder. *Critical in prod.*
- **DATABASE_URL** — present. *Critical.*
- **DATABASE_PROVIDER** — `sqlite` (default) or `postgres`; `postgres` additionally
  requires **POSTGRES_DATABASE_URL**. *Critical in prod when postgres.*
- **CORS_ORIGIN / APP_BASE_URL** — at least one present, non-wildcard; warns if
  `APP_BASE_URL` is `http://` in prod (Secure cookies need https).
- **SMTP_HOST / EMAIL_FROM** — both or neither (half-config warns; email is optional).
Secret *values* are never logged — only which key is missing/insecure.

## Cookies (`server/config/cookies.js` — single source of truth)
The session cookie `metalab_session` is issued/cleared from ONE module so set and
clear never drift (a cookie only clears when name + Path [+ Domain] match):
- `HttpOnly` — no JS access (XSS can't read the session).
- `SameSite=Strict` — never sent cross-site → CSRF defence-in-depth on the
  token-in-cookie API.
- `Secure` — HTTPS-only in production (off in dev so `http://localhost` works).
- `Path=/` — explicit on both set and clear.
- `maxAge` 7 days; no `Domain` (host-only cookie — not shared with subdomains).

**Why not the `__Host-` prefix?** It mandates an HTTPS-only Secure cookie with
`Path=/` and no `Domain`. We already set Secure (prod) + `Path=/` + host-only, so
the only thing `__Host-` adds is a name that is *rejected over http* — which would
break local dev and force renaming `metalab_session` (logging out every existing
session) for no real gain over the flags above. Deliberately not adopted; revisit
if the app ever drops http dev entirely.

## CORS (`server/config/cors.js`)
An **explicit allowlist**, never a wildcard (wildcard + credentials is invalid and
unsafe). `CORS_ORIGIN` may be a single origin OR a comma-separated list, unioned
with `APP_BASE_URL`:
```
CORS_ORIGIN="https://pecanrev.com,https://www.pecanrev.com"
APP_BASE_URL="https://pecanrev.com"
```
The `corsOriginDelegate` echoes a request's `Origin` only when it is in the
allowlist (so credentialed cookies are returned to trusted origins only), allows
requests with no `Origin` header (same-origin nav, curl, health checks), and
rejects everything else with no CORS headers (the browser then blocks it) rather
than throwing. The active allowlist is logged once at boot (`[cors] allowlist: …`).
**Preview environments:** add each preview origin explicitly to `CORS_ORIGIN` —
arbitrary/regex origins are intentionally not accepted.

## SSE (`server/routes/events.js`, `server/realtime/bus.js`)
A single `GET /api/events` stream per tab, behind `requireAuth` only (never under
the rate-limited `/api/auth` or `/api/admin` mounts — a reconnecting EventSource
would burn a limiter). It is **identity-only**: events are thin pokes (no content
travels on the channel), and every refetch re-authorizes through the normal
endpoints, so a stream can never leak another user's/project's data. Headers:
`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection:
keep-alive`, `X-Accel-Buffering: no`. A `:hb` heartbeat every 25s keeps proxies
alive and surfaces dead clients via `close` (which unregisters them). Suspending a
user force-closes their streams (`forceCloseStreams`).

### Required nginx for SSE (do NOT buffer or time out the stream)
```nginx
# In the server{} block that proxies the API:
location /api/events {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Connection '';          # keep-alive to upstream
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;                      # critical: stream events immediately
    proxy_cache off;
    proxy_read_timeout 1h;                    # long-lived connection (> heartbeat)
    chunked_transfer_encoding on;
}

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
The app already sends `X-Accel-Buffering: no`, so nginx disables buffering for the
stream even without the per-location block — but setting `proxy_read_timeout`
generously is what prevents the proxy from killing an idle-but-alive SSE socket.

## Trust proxy
`TRUST_PROXY` controls how `req.ip` is derived from `X-Forwarded-For`. Default
trusts only loopback/link-local/unique-local upstreams (the nginx-on-127.0.0.1
case). Set a hop count or subnet list if your proxy topology differs. A wrong
value makes `req.ip` the proxy's private IP (breaks geo + weakens rate limits).

## Tests
- `tests/unit/security/cors-cookies.test.js` — allowlist parsing/de-dup, the
  credential-safe delegate (allow listed / reject unlisted / allow no-Origin /
  never wildcard), and the cookie attributes (HttpOnly/SameSite/Secure/Path,
  clear-mirrors-set).
- `tests/unit/security/cors-origin.test.js` — back-compat single-origin resolver.
- `tests/unit/validateConfig.test.js` — boot diagnostics incl. the postgres provider check.
