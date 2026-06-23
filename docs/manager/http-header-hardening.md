# HTTP Response-Header Hardening — Fingerprinting Reduction (prompt 52)

A defense-in-depth pass to remove/withhold response headers and body fields that
reveal implementation details (framework, runtime, versions, environment, build
metadata, internal timing) without breaking functionality, caching, auth, CORS,
PDFs, or downloads. It **complements** the CSP work (`docs/manager/csp-security.md`)
and **reuses the same central security-header architecture** (`server/security/`) —
there is no second, competing header system.

> Hiding version/identity headers raises the cost of *passive* fingerprinting and
> automated vuln-matching. It is **not** a security control on its own: it does not
> patch dependencies, fix misconfiguration, or replace input validation, output
> encoding, CSP, authentication, authorization, or vulnerability management. An
> attacker can still fingerprint by behavior. Treat this as one thin layer.

## 1. Response architecture (which layer sets what)

```
client → [reverse proxy: nginx/CDN, operator-managed] → Express app (server/index.js)
```

- **Express app** is the single application source of truth for headers:
  `helmet(helmetOptions())` (baseline) + `cspMiddleware()` (CSP) + `apiNoStore`
  (cache) — all in `server/security/`. It serves both the JSON API and (via
  `serveSpa`) the SPA HTML, so one place covers every route.
- **Reverse proxy / CDN**: none is committed in this repo (`docker-compose.yml`
  runs only Postgres). In production a proxy commonly terminates TLS; its own
  `Server:`/`Via:` headers are the operator's responsibility (§7).

## 2. Environments inspected

| Environment | Inspected | How |
| --- | --- | --- |
| Local production build | ✅ | `NODE_ENV=production CSP_MODE=enforce SERVE_SPA=true node server/index.js` + `curl -sS -D -` across routes |
| Local dev | ✅ (Express layer) | route capture |
| Staging / production | ❌ not available this session | the implementation makes capture possible; do not claim prod headers were tested |

Routes captured: `/`, `/login`, static `/assets/*.js`, `/api/health`,
`/api/health/ready`, `/api/version`, `/api/csp-report`, `404`/`401`, and an
authenticated `/api/version`.

## 3. Findings & changes

### Already clean before this task (verified, no change)
- **No `X-Powered-By`** — helmet's `hidePoweredBy` removes Express's default
  (now also `app.disable('x-powered-by')` for explicit belt-and-suspenders).
- **No `Server`** header from the app (Node's http server adds none).
- **No** `X-Runtime`, `X-Response-Time`, `Server-Timing`, `Via`, `X-Request-Start`,
  or any internal-host/region/pod/commit header anywhere in the code.
- `requestLogger` logs method/path/status to the **server console**, never to a
  response header.

### Changed by this task
| Item | Before | After | Why |
| --- | --- | --- | --- |
| `X-Frame-Options` | `SAMEORIGIN` (helmet default) | **`DENY`** | Agree with CSP `frame-ancestors 'none'` — no contradictory frame policy. (The inline-PDF route still overrides to `SAMEORIGIN` per-response so same-origin embedding works.) |
| `/api/version` (anonymous) | `{name,version,commit,commitDate,buildDate,full}` | **`{name,version}`** | The commit hash + build dates are build/deploy fingerprinting. The product version stays public (shown in the UI). Authenticated callers (UI footer / Ops Console fetch with credentials) still get the full payload. |
| `/api/health/ready` (public) | `{status,checks,version,env,dbLatencyMs,timestamp}` | **drops `env` + `dbLatencyMs`** | Environment name + infra timing are fingerprinting; a load-balancer probe only needs the 200/503 + checks. Still in server logs / admin health. |
| `/api/*` `Cache-Control` | *(unset → ETag only)* | **`no-store`** | Dynamic, often user-specific JSON must not be cached by shared/browser caches. Download/PDF/SSE handlers set their own `Cache-Control` and override this. |
| `X-Powered-By` | already stripped by helmet | `app.disable('x-powered-by')` added | Explicit + documented. |

### Retained deliberately (with reason)
| Header | Reason |
| --- | --- |
| `Date` | HTTP semantics. |
| `Content-Type`, `Content-Length`, `Content-Disposition`, `Accept-Ranges`, `Content-Range` | Required for rendering, downloads (CSV/RIS/JSON/ZIP/PDF), and PDF range requests. |
| `ETag`, `Last-Modified`, `Cache-Control: public, max-age=3600` (assets) | Cache validators / static-asset caching — not fingerprinting. |
| `Vary: Origin`, `Access-Control-Allow-Credentials` | Credentialed CORS correctness. |
| `RateLimit-*` | Standard rate-limit signaling (RFC), opaque counts only. |
| helmet set: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `Cross-Origin-Opener/Resource-Policy: same-origin`, `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0` | Security headers (kept). `X-XSS-Protection: 0` deliberately disables the legacy, buggy auditor (current best practice). None reveal technology/version. |
| `Content-Security-Policy(-Report-Only)`, `Permissions-Policy`, `Reporting-Endpoints` | From the CSP module (prompt 51). |

`Referrer-Policy` is **`no-referrer`** — stricter than the common
`strict-origin-when-cross-origin` baseline. The app has no external analytics or
integrations that need a referrer, so sending none maximizes privacy with no
compatibility cost.

## 4. Before / after (real captures, sanitized)

### Public HTML page `GET /`
**Before (post-CSP, pre-52):** `…; X-Frame-Options: SAMEORIGIN; …` (no Cache hardening on API).
**After:**
```http
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
content-security-policy: default-src 'self'; …; frame-ancestors 'none'; …
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: no-referrer
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
strict-transport-security: max-age=31536000; includeSubDomains
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), …
reporting-endpoints: csp-endpoint="/api/csp-report"
cache-control: no-cache
# (no server, no x-powered-by, no x-runtime, no server-timing)
```

### API JSON `GET /api/health`
**After:** adds `cache-control: no-store`; `content-security-policy: default-src 'none'; …`; `x-frame-options: DENY`; no fingerprinting headers.

### `GET /api/version`
**Before:** `{"name":"PecanRev","version":"3.50.0","commit":"<hash>","commitDate":"…","buildDate":"…","full":"v3.50.0 · <hash> · …"}` (anonymous).
**After (anonymous):** `{"name":"PecanRev","version":"3.50.0"}`.
**After (authenticated):** full object (unchanged) for the UI.

### `GET /api/health/ready`
**Before:** `{status,checks,version,env:"production",dbLatencyMs,timestamp}`.
**After:** `{status,checks,version,timestamp}`.

### Static asset `GET /assets/index-*.js`
**After (unchanged):** `cache-control: public, max-age=3600`, `etag`, `accept-ranges: bytes`, correct `content-type` — caching preserved.

### Errors `401` / `404`
**After:** `{"error":"…"}` body only (no stack/path/framework), full security headers present, `cache-control: no-store`.

## 5. Centralized implementation

| File | Role |
| --- | --- |
| `server/security/headers.js` | `helmetOptions()` (frameguard DENY, CSP off), `apiNoStore`, `publicVersion()`. |
| `server/security/csp.js` | CSP + Permissions-Policy + Reporting-Endpoints (prompt 51). |
| `server/index.js` | `app.disable('x-powered-by')`; `helmet(helmetOptions())`; `apiNoStore`; `/api/version` soft-auth gating; `/api/health/ready` trimmed. |

No literal header sets are duplicated across files; header values are static
(no user-controlled header names/values → no header/newline injection).

## 6. Tests

- `tests/unit/security/headers.test.js` — `helmetOptions` (frameguard DENY, CSP off),
  `apiNoStore` (/api → no-store, non-/api untouched, always next()), `publicVersion`
  (drops commit/dates, safe fallback).
- `tests/integration/header-hardening.test.js` (live server) — no
  X-Powered-By/Server-with-version/X-Runtime/Server-Timing; `X-Frame-Options: DENY`;
  anonymous `/api/version` has no commit, authenticated has commit; `/api/health/ready`
  has no `env`/`dbLatencyMs`; `/api` is no-store while assets keep `max-age`; nosniff +
  referrer-policy + permissions-policy + CSP remain.
- Full CI (`npm run test:ci`) green; no duplicate/contradictory headers (verified live).

## 7. Reverse proxy / hosting (operator)

The app emits no fingerprinting header, but a proxy may. If you run nginx/Cloudflare:

```nginx
http {
  server_tokens off;                     # drop nginx version from Server: and error pages
  # Optional (needs headers-more module) to remove Server entirely:
  # more_clear_headers Server;
}
server {
  proxy_hide_header X-Powered-By;         # belt-and-suspenders for any upstream
  # Do NOT add a second Content-Security-Policy / X-Frame-Options here — the app
  # owns those; two policies are enforced together and cause breakage.
}
```

Cloudflare/other CDNs add provider headers (`cf-ray`, `server: cloudflare`, etc.)
that cannot be removed — document them as unavoidable provider headers; do not claim
they were removed. Transport metadata shown by some tools (HTTP/2/3 pseudo-headers
like `:status`) is not an application header and cannot be controlled here.

## 8. How to … (runbook)

- **Test headers locally:** `NODE_ENV=production CSP_MODE=enforce SERVE_SPA=true node server/index.js` then `curl -sS -D - -o /dev/null http://127.0.0.1:3001/<route>`.
- **Add a new header safely:** add it to `server/security/headers.js` (one source of truth), static value only, never from user input; add a test; never duplicate it at the proxy.
- **Investigate a regression:** capture with `curl -D -`; if an unexpected fingerprinting header appears, check whether the app (`server/security/`) or the proxy added it (§7), and remove it at that layer.
- **Avoid duplicate headers:** the app owns CSP / X-Frame-Options / Permissions-Policy / Referrer-Policy — do not set them again at the proxy.

## 9. Rollback

All changes are version-controlled config in `server/security/headers.js` +
`server/index.js`. Narrow rollbacks without disabling the whole security layer:

- **Frame compatibility:** if a legitimate embed needs same-origin framing app-wide,
  change `frameguard: { action: 'deny' }` → `{ action: 'sameorigin' }` **and** widen
  the CSP `frame-ancestors` accordingly (keep them consistent).
- **Cache:** if a specific `/api` GET must be cacheable, have that handler set its own
  `Cache-Control` (it overrides `apiNoStore`) rather than removing the middleware.
- **Version:** to restore the public commit hash, revert the `/api/version` handler.

There is intentionally **no** `DISABLE_ALL_SECURITY_HEADERS` switch.

## 10. Remaining risks & follow-ups

1. Proxy/CDN `Server:`/provider headers are outside app control — apply §7 at deploy.
2. Source maps: the production build does not emit public `.map` files by default
   (Vite default) — keep it that way; if enabled for debugging, restrict access.
3. `no-store` on `/api` slightly increases revalidation traffic for the few public
   GETs (health/version/settings) — acceptable; revisit if a public, cacheable read
   API is added (give that route its own `Cache-Control`).
4. Build metadata for admins still flows via the authenticated `/api/version`; if
   tighter control is wanted, gate the commit specifically behind an admin role.
