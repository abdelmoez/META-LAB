# Content-Security-Policy — Architecture, Rollout & Operations (prompt 51)

This document explains the production Content-Security-Policy (CSP) for PecanRev:
its threat model, every directive and allowed origin, the nonce/hash strategy,
the report-only ↔ enforce rollout, the violation-reporting endpoint, how to add a
new origin safely, how to investigate a violation, and how to roll back.

> CSP is **defense in depth**. It reduces the blast radius of cross-site
> scripting, malicious resource injection, clickjacking, mixed content, and
> unauthorized third-party connections. It is **not** a replacement for output
> encoding, input sanitization, secure templating, authentication, or dependency
> hygiene. A CSP only limits what an injected payload can *do*; preventing the
> injection in the first place remains the primary control.

---

## 1. Architecture discovered

| Aspect | Finding |
| --- | --- |
| Frontend | React 18 + Vite 5 **SPA** (not Next.js). Entry `src/main.jsx`, router `react-router-dom` v7. Build → `dist/` (single entry chunk + lazy chunks, all same-origin under `/assets/`). |
| Backend | Express API on `:3001` (`server/index.js`). `helmet`, `cors`, `cookie-parser`, `express-rate-limit`. |
| HTML serving | In production the **Node server serves the SPA HTML** via `server/middleware/spaTheme.js` (`serveSpa`) so it can inject the live brand palette pre-paint. This is also where the per-response CSP nonce is stamped. (Vite serves HTML only in local dev.) |
| Deployment | `docker-compose.yml` runs **only Postgres** — there is **no committed nginx/CDN config**, so the Express app is the single source of truth for headers. (If an operator adds nginx, it must **proxy** to Node and **not** add a second CSP — see §13.) |
| Auth | Email + JWT in an httpOnly `metalab_session` cookie. **No OAuth / third-party auth**, so no auth popup or external auth origin. |
| External browser calls | **None.** CrossRef / PubMed / OpenAlex / Semantic Scholar / DOAJ / ClinicalTrials / EuropePMC / ROR are all **proxied server-side** under `/api/*`. The browser only talks to its own origin (`fetch('/api/…')` + `EventSource('/api/events')`). |
| PDF | `pdfjs-dist` via Vite `?worker` → a same-origin `/assets/*.js` worker (`GlobalWorkerOptions.workerPort`), with a `blob:` fake-worker fallback. pdf.js uses **WebAssembly**. |
| Animations / styling | React inline `style={{}}` everywhere + `framer-motion` (runtime `<style>` injection). This forces a style-only `'unsafe-inline'` exception (§ Style handling). |

## 2. CSP implementation location

| File | Role |
| --- | --- |
| `server/security/csp.js` | **Single source of truth.** Pure policy builder (`buildCsp`/`serializeCsp`), mode resolution (`cspMode`), per-response nonce (`generateNonce`), inline-script hashing (`inlineScriptHashes`), `Permissions-Policy`, and the `cspMiddleware`. |
| `server/security/cspReport.js` | Violation report sanitization (`sanitizeCspReport`, `sanitizeUrl`) + the `cspReportHandler` (logs one redacted line, never persists/reflects). |
| `server/index.js` | Wires `helmet({ contentSecurityPolicy:false })` (keeps helmet's other headers) + `cspMiddleware()`; mounts `POST /api/csp-report` first (before maintenance gate, body parser, auth). |
| `server/middleware/spaTheme.js` | `serveSpa` reads `res.locals.cspNonce` and stamps it on the injected theme `<script nonce>`. |
| `index.html` | `<meta http-equiv=CSP>` **removed** — CSP is now a real header. The bootstrap `<script>` is authorized by its SHA-256 hash. |
| `server/config/validateConfig.js` | Validates `CSP_MODE` at startup; warns if production is `disabled`. |

## 3. Modes & configuration (`CSP_MODE`)

A single environment variable controls the rollout. The default is **`report-only`** —
it always ships a header for observation but never blocks, and is never silently
"disabled".

| `CSP_MODE` | Header sent | Behavior |
| --- | --- | --- |
| `disabled` (`off`) | *(none)* | No CSP header. Other security headers still apply. Production warns at startup. |
| `report-only` *(default)* | `Content-Security-Policy-Report-Only` | Browser **reports** violations, does **not** block. |
| `enforce` (`on`) | `Content-Security-Policy` | Browser **blocks** violations. |

Exactly one CSP header is ever sent (never both). The header is delivered on every
response by `cspMiddleware`, which covers the API and — because `serveSpa` is the
catch-all for non-`/api` GETs — every SPA route (landing, auth, onboarding,
workspace, search, screening, PDF, RoB, extraction, Ops Console, beta waitlist,
error/404).

```bash
# Report-only (observation)
CSP_MODE=report-only node server/index.js
# Enforce (after observation)
CSP_MODE=enforce node server/index.js
```

**Enforcement is coupled to strictness.** `cspMiddleware` forces the strict
(production) policy whenever `mode === 'enforce'`, regardless of `NODE_ENV`, so
`CSP_MODE=enforce` can never silently enforce a permissive, dev-source-leaking
policy. (Dev-only sources — `ws://localhost`, inline-script allowance — apply only
in report-only/disabled outside production.) For a *faithful* production capture
also set `NODE_ENV=production` (HSTS, Secure cookies); see §16.

## 4. Final policies

### 4a. Production — enforcement (SPA HTML)

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
form-action 'self';
script-src 'self' 'wasm-unsafe-eval' 'nonce-<PER-RESPONSE>' 'sha256-<BOOTSTRAP>';
script-src-attr 'none';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
img-src 'self' data: blob:;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self';
media-src 'self';
worker-src 'self' blob:;
manifest-src 'self';
frame-src 'self';
child-src 'self';
upgrade-insecure-requests;
report-uri /api/csp-report;
report-to csp-endpoint
```

*(`<PER-RESPONSE>` is a fresh base64url nonce per response — never a real value in
docs. `<BOOTSTRAP>` is the SHA-256 of the static theme bootstrap script.)*

### 4b. Production — report-only

Byte-for-byte identical directives, sent as `Content-Security-Policy-Report-Only`.

### 4c. API (`/api/*`) — all modes

```
default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';
report-uri /api/csp-report; report-to csp-endpoint
```

The API returns only JSON (no scripts/styles/resources), so it is locked to
`'none'`.

### 4d. Development-only differences

Vite serves HTML in dev, so the Node policy rarely applies to the dev HTML; when
it does (e.g. `SERVE_SPA=true` without a production build), non-production adds:

- `connect-src … ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*` — Vite HMR websocket + dev proxy.
- `script-src … 'unsafe-inline'` — Vite's HMR `@react-refresh` preamble (an un-nonced inline module script). A nonce is intentionally **omitted** in dev, because a nonce would make the browser ignore `'unsafe-inline'` and block the preamble.
- `upgrade-insecure-requests` is **absent** in dev (would break `http://localhost`).

These are gated on `NODE_ENV !== 'production'` and can **never** reach the
production policy.

## 5. Directive-by-directive — what each blocks & why it is allowed

| Directive | Value | What it blocks / why this value |
| --- | --- | --- |
| `default-src` | `'self'` | Fallback for unlisted fetch types — only same-origin. |
| `base-uri` | `'self'` | Blocks `<base>` hijacking that would re-root relative URLs to an attacker host. |
| `object-src` | `'none'` | Blocks `<object>/<embed>/<applet>` plugin vectors. |
| `frame-ancestors` | `'none'` | **Anti-clickjacking** — the app may not be framed by anyone. (Header-only; a `<meta>` cannot express this.) |
| `form-action` | `'self'` | Forms may only post to our origin (blocks credential-stealing form redirection). |
| `script-src` | `'self' 'wasm-unsafe-eval' 'nonce-…' 'sha256-…'` | Only same-origin scripts, the nonce'd injected theme script, and the hashed bootstrap. **No `'unsafe-inline'`, no `'unsafe-eval'`.** `'wasm-unsafe-eval'` permits **WebAssembly compilation only** (pdf.js) — it does **not** allow `eval()`/`new Function`. |
| `script-src-attr` | `'none'` | Blocks inline `on*=` event-handler attributes. |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | Stylesheets from self + Google Fonts CSS. `'unsafe-inline'` is a **documented, style-only exception** (§ Style handling). |
| `img-src` | `'self' data: blob:` | Same-origin images, `data:` (inline SVG/base64 icons), `blob:` (canvas/export rasterization + previews). |
| `font-src` | `'self' https://fonts.gstatic.com` | Self fonts + Google Fonts files. (`data:` dropped — no evidence any font is a data URI.) |
| `connect-src` | `'self'` | fetch/XHR/SSE only to our origin. **All external APIs are server-proxied** — incl. the DOI/PMID "Add Study" auto-fill, which now goes through the same-origin `/api/citation/*` proxy (`server/routes/citation.js`) instead of fetching CrossRef/NCBI from the browser — so no external connect origin is needed. |
| `media-src` | `'self'` | No external audio/video. |
| `worker-src` | `'self' blob:` | The bundled pdf.js worker (`/assets/*.js`, self) + the pdf.js `blob:` fake-worker fallback. `blob:` is scoped to workers only — **never** `script-src`. |
| `manifest-src` | `'self'` | `site.webmanifest` is same-origin. |
| `frame-src` / `child-src` | `'self'` | Conservative (PDF rendering is canvas-based, no PDF iframe). Candidate tightening to `'none'` once report-only confirms no same-origin frames (follow-up). |
| `upgrade-insecure-requests` | — | Production only — upgrades any stray `http://` subresource to `https://`. |
| `report-uri` / `report-to` | `/api/csp-report` / `csp-endpoint` | Violation reporting (legacy + modern). |

### External origins allowed (complete list)

| Origin | Directive(s) | Feature | Prod/Dev | Can self-host? |
| --- | --- | --- | --- | --- |
| `https://fonts.googleapis.com` | `style-src` | Google Fonts **CSS** (Inter / IBM Plex / Manrope; Material Symbols in Stitch admin mode) | both | Yes — self-hosting would let us drop both Google origins (tracked follow-up). |
| `https://fonts.gstatic.com` | `font-src` | Google Fonts **font files** | both | Yes (same follow-up). |
| `ws://localhost:*`, `ws://127.0.0.1:*`, `http://localhost:*`, `http://127.0.0.1:*` | `connect-src` | Vite HMR + dev proxy | **dev only** | n/a |

No external `script-src`, `frame-src`, `connect-src`, analytics, tag-manager, or
error-monitoring origin is allowed — none exists in the codebase.

## 6. Nonce & hash strategy

- **Per-response nonce** — `crypto.randomBytes(16)` → base64url, fresh for every
  response (`generateNonce`), stored on `res.locals.cspNonce`. It authorizes the
  **one dynamic inline script** (`serveSpa`'s theme-globals `<script>`). It is
  validated to `^[A-Za-z0-9_-]{16,}$` before use (header-injection guard), is not
  derived from time/user/route/request id, is not exposed as general client
  state, and is regenerated even across same-URL requests (HTML is served
  `Cache-Control: no-cache`, so a cached page can never reuse a stale nonce).
- **Static hash** — the **theme/brand/ui bootstrap** `<script>` in `index.html`
  is immutable per build, so it is authorized by its `'sha256-…'`, computed at
  runtime from the **served** `dist/index.html` (so it always matches the bytes
  the browser hashes). This works on every serving path and needs no per-response
  injection.
- **Vite output** — the entry module script and lazy chunks are external
  `/assets/*.js`, authorized by `script-src 'self'`. The build emits **no** inline
  module-preload polyfill (single entry chunk), verified in `dist/index.html`.
- `'strict-dynamic'` was **considered and deferred**: it would require nonce-ing
  Vite's entry script and is unnecessary while `'self'` is honored. Tracked as a
  follow-up.

## 7. Style handling — the one documented exception

`'unsafe-inline'` remains in **`style-src` only** because:

1. The UI is built on React inline `style={{}}` props → DOM `style=""` attributes,
   which cannot carry a nonce/hash.
2. `framer-motion` injects `<style>` elements at runtime; the correct CSP-clean
   path (passing a nonce via `MotionConfig`) would require exposing the
   per-response nonce to client JS, which CSP best practice (and this task)
   advises against.

It is scoped to styles and **never** appears in `script-src`. Residual risk: CSS
injection (e.g. data-exfil via attribute selectors) is not blocked by `style-src`.
**Remediation (tracked):** self-host fonts, migrate to a nonce-able/zero-runtime
CSS-in-JS approach, then drop `'unsafe-inline'` from `style-src` and split into
`style-src-elem`/`style-src-attr`.

## 8. Inline scripts & styles — found and remediated

| Item | Classification | Resolution |
| --- | --- | --- |
| `index.html` theme/brand/ui **bootstrap `<script>`** | Safe, immutable | **Hash** (`'sha256-…'`). |
| `serveSpa` injected **theme-globals `<script>`** | Safe, dynamic | **Per-response nonce**. |
| `index.html` reset **`<style>`** | Safe, immutable | Allowed by `style-src 'unsafe-inline'` (style exception). |
| React `style={{}}` (app-wide) | Unavoidable | `style-src 'unsafe-inline'` (exception). |
| `framer-motion` runtime `<style>` | Unavoidable | `style-src 'unsafe-inline'` (exception). |
| `dangerouslySetInnerHTML` ×3 (forest plots, RoB traffic lights) | First-party generated **SVG**, values escaped | Reviewed — no `<script>`, no user HTML. CSP is defense-in-depth here, not the primary control. |
| `eval` / `new Function` / string `setTimeout` | **None** in shipped `src/` | n/a — confirms no `'unsafe-eval'` needed. |
| Inline `on*=` handlers, service workers, JSON-LD, external `<script>` | **None** | `script-src-attr 'none'`. |

## 9. CSP violation reporting endpoint

`POST /api/csp-report` (`server/security/cspReport.js`), mounted **first** —
before the maintenance gate, the global JSON parser, and every authenticated
router — so reports always flow and carry no CSRF/auth assumptions.

- Accepts `application/csp-report`, `application/reports+json`, `application/json`.
- **16 KB** body limit → oversized = `413`; malformed JSON = `400`; both without a
  stack trace. Handler never throws.
- **Dedicated rate limiter** (120/min in prod) so it cannot become a logging-DoS
  surface. No body on rejection.
- **Redaction:** strips query strings, fragments and userinfo from all URLs;
  collapses `data:`/`blob:` to the scheme; **drops `script-sample`** entirely;
  logs no cookies/auth headers/user text.
- **Storage:** none — it logs one compact line through the existing console
  observability (`[csp-report] dir=… blocked=… doc=… src=…:line:col disp=… v=…`),
  tagged `[ext-noise]` for `chrome-extension:`/`moz-extension:`/etc. so genuine
  app violations are easy to filter. No database (none is justified).
- `Reporting-Endpoints: csp-endpoint="/api/csp-report"` is sent so the modern
  `report-to` group resolves; `report-uri` covers legacy browsers.

## 10. Other security headers (helmet + central)

Kept from helmet: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy:
same-origin`, `Strict-Transport-Security` (prod HTTPS), `X-Frame-Options:
SAMEORIGIN` (legacy defense-in-depth alongside `frame-ancestors 'none'`),
`Origin-Agent-Cluster`. Added centrally: a restrictive **`Permissions-Policy`**
(denies camera/microphone/geolocation/payment/usb/etc.; allows `fullscreen=(self)`
for the PDF viewer). **`Cross-Origin-Embedder-Policy` is intentionally NOT enabled**
— `require-corp` would break Google Fonts / pdf.js workers without thorough
testing.

## 11. Tests

- `tests/unit/security/csp.test.js` (19) — mode/header-name selection; nonce
  validity/uniqueness/unpredictability; inline-hash algorithm; prod invariants
  (baseline directives, nonce+hash, **no `unsafe-inline`/`unsafe-eval` in
  script-src**, **no wildcard/blanket-scheme**, externals = only Google Fonts);
  dev sources absent from prod; strict API policy; middleware header emission per
  mode + `/api` vs SPA + nonce-in-header.
- `tests/unit/security/cspReport.test.js` (9) — URL redaction; both report wire
  formats; `script-sample`/query never retained; extension-noise classification;
  204 + never-throws.
- `tests/unit/spaTheme.test.js` (+2) — nonce stamped on the injected script;
  malformed nonce ignored (no attribute injection).
- `tests/integration/csp-headers.test.js` — live-server: single non-duplicated
  header; strict policy on public/auth/admin/screening/404 routes; **header nonce
  == injected-script nonce**; different nonce per response; report endpoint
  204/413/400. (Skips when the server is down — run during rollout validation.)

**Result:** full CI suite (`npm run test:ci`) = **2234 passed** (2204 baseline +
30 new). Live enforce-mode boot verified end-to-end (see §16).

## 12. How to add a new legitimate origin

1. Confirm the browser *itself* loads it (not the server). Prefer a server-side
   proxy under `/api/*` — that keeps `connect-src 'self'`.
2. If it must be browser-side, add the **narrowest** source (exact scheme+host,
   path if possible) to the **single** directive that needs it in
   `buildCsp` (`server/security/csp.js`). Never `*`, `https:`, or a broad wildcard.
3. Add a row to §5's origin table with the feature + prod/dev + self-host note.
4. Deploy in `report-only`, confirm no violation, then enforce.

## 13. Avoiding duplicate policies (operators)

There is no committed proxy/CDN CSP. If you add nginx/Cloudflare, configure it to
**proxy** to Node and **not** emit its own `Content-Security-Policy` — two policies
are enforced as an intersection and cause hard-to-debug breakage. Keep the Node
app as the single source of truth.

## 14. How to investigate a violation

1. `CSP_MODE=report-only`, reproduce the workflow.
2. Read server logs for `[csp-report]` lines; ignore `[ext-noise]`.
3. Map `dir=`/`blocked=` to a directive in §5. If it is a **legitimate** app need,
   add the narrowest origin (§12). If it is **not**, it is a real attempted
   injection — leave it blocked and fix the source.
4. Re-test in report-only, then enforce.

## 15. Rollout & rollback

**Promote report-only → enforce:** observe report-only in staging then production;
once only `[ext-noise]` remains, set `CSP_MODE=enforce` and restart. No code
change. **Emergency rollback:** set `CSP_MODE=report-only` (or `disabled` only as a
last resort) and restart — instantly stops blocking without a deploy. Startup logs
the active mode (`[csp] mode=…`) and warns if production is `disabled`.

Stages: (1) local enforce test → (2) staging report-only → (3) staging enforce +
E2E → (4) production report-only (observation) → (5) production enforce
(monitoring + rollback ready). This codebase makes all five technically possible;
no production traffic was observed during implementation.

## 16. Validation performed

Booted `NODE_ENV=production CSP_MODE=enforce SERVE_SPA=true` and confirmed:
strict enforce header on `/` and nested `/login`; **header nonce == injected
`<script nonce>`**; a different nonce per response; `default-src 'none'` on
`/api/health` with no duplicate header; all related headers (COOP/CORP/HSTS/
nosniff/XFO/Permissions-Policy/Reporting-Endpoints) present; `POST /api/csp-report`
→ 204, oversized → 413. Production build succeeds; `index.html` no longer carries a
`<meta>` CSP.

## 17. Remaining risks & follow-up remediation

1. **`style-src 'unsafe-inline'`** (React + framer-motion) — CSS-injection not
   blocked. *Follow-up:* self-host fonts + nonce-able CSS-in-JS, then remove and
   split into `style-src-elem`/`-attr`.
2. **Google Fonts external origins** — *Follow-up:* self-host to reach
   `style-src 'self'` / `font-src 'self'`.
3. **`'strict-dynamic'`** not adopted — *Follow-up:* nonce Vite's entry script and
   evaluate, to harden against host-allowlist bypasses.
4. **`frame-src`/`child-src 'self'`** — tighten to `'none'` once report-only
   confirms no same-origin frames.
5. **`'wasm-unsafe-eval'`** required by pdf.js — acceptable (WASM-only, not
   `eval`); revisit if pdf.js drops the WASM path.
6. **Reporting** is log-based — wire `[csp-report]` lines into the central
   monitoring pipeline when one is adopted; aggregate by `effective-directive` +
   app version.
