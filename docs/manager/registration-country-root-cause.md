# Registration country detection — root cause & permanent fix (prompt32 Task 1)

## Current state (before)
- `server/index.js` configures `trust proxy` (prompt30) so `req.ip` is derived from `X-Forwarded-For` when behind a private upstream proxy.
- `server/utils/geo.js` `resolveCountry(req)` resolves country in this order: (1) proxy country header (`cf-ipcountry`, `x-vercel-ip-country`, `x-country`, `x-appengine-country`); (2) **optional** offline `geoip-lite` lookup *only if the package happens to be installed* (dynamic `import`); (3) private/loopback IP → `{code:'', name:'', source:'local'}`; (4) public IP, nothing resolved → `{code:'', name:'Unknown', source:'none'}`.
- `server/controllers/authController.js` `captureRegistrationCountry()` persists `registrationCountryCode/Name/IpCountrySource/IpHash` best-effort at registration.
- Ops map aggregation lives in `server/utils/countryStats.js`.

## Root cause (why it still showed "Local" / "Unknown")
The deployment is a **self-managed VPS behind nginx** — there is **no Cloudflare/Vercel/App-Engine edge**, so none of the `COUNTRY_HEADERS` is ever present. And **`geoip-lite` was never installed** (it was only a best-effort `import()` that silently no-ops when absent). Therefore, even with a correct public `req.ip`, resolution always fell through to step 4 → `Unknown`. Older rows still carried the literal `"Local"` (pre-prompt30 behaviour), and `countryStats.js` *preferred* that label for the no-code bucket — so the Ops map surfaced "Local". Net: there was **no working path that produced a real country on this host**.

## Decision
1. **Install `geoip-lite` as an `optionalDependency`** (offline MaxMind GeoLite DB, no API key, no network calls, country-level only — fits the privacy contract). `geo.js` already auto-detects it. `optionalDependency` (not a hard dep) means a failed install never breaks `npm install`; `geo.js` degrades gracefully.
2. Keep the proxy-header path first (so a future Cloudflare/Vercel front-end needs zero code changes).
3. Make the no-code bucket **always "Unknown"**, never "Local", in `countryStats.js`.
4. Store `registrationCountryDetectedAt` (new nullable column).
5. Emit a **one-time `console.warn`** when a *public* IP resolves with neither a header nor geoip — turning a silent "everyone Unknown" misconfig into an actionable log.
6. Privacy unchanged: **country level only**; the raw IP is never stored (only an optional salted SHA-256 `registrationIpHash`); raw IP is never returned to the frontend.

## Implementation
- `server/package.json` — `optionalDependencies: { "geoip-lite": "^1.4.10" }`.
- `server/prisma/schema.prisma` — `User.registrationCountryDetectedAt DateTime?` (additive, nullable; `prisma db push`-safe).
- `server/controllers/authController.js` — `captureRegistrationCountry` now sets `registrationCountryDetectedAt: new Date()`.
- `server/utils/geo.js` — added `warnNoGeoSourceOnce()` (throttled) on the public-IP/no-source branch.
- `server/utils/countryStats.js` — no-code bucket label is hard-coded to `"Unknown"` (removed the "Local beats Unknown" override).
- `scripts/repair-country-codes.js` — extended to relabel any legacy no-code rows still named `Local`/`Development`/`Local (dev)` → `Unknown` (dry-run by default; `--apply` to persist).
- `server/.env.example` — documented `TRUST_PROXY` and the geo requirement.

## Test results
- `tests/unit/geo.test.js` — added cases proving the offline DB resolves real IPs: `8.8.8.8 → US`, `2.50.0.0 → AE` (graceful `source:'none'` if a CI env skips the optional install).
- `tests/unit/countryStats.test.js` — the merged no-code bucket is now asserted to be `"Unknown"`, never "Local".
- **Live HTTP smoke test (verified):** `POST /api/auth/register` with `X-Forwarded-For: 8.8.8.8` → `registrationCountryCode: "US"`, `registrationCountryName: "United States"`, `registrationIpCountrySource: "geoip"`, `registrationCountryDetectedAt` set. UAE IPs → `AE`. `cf-ipcountry: AE` header → `AE` via `source:"header"`. `127.0.0.1` → graceful local.

## Privacy decision
Country-level only. No city/region/coordinates. Raw IP never persisted (only an optional salted hash via `JWT_SECRET`). Only `hit.country` is read from geoip-lite — never its city/lat/lon. Nothing IP-related is exposed to the frontend.

## Risks / limitations
- geoip-lite bundles a ~tens-of-MB GeoLite dataset that ages; acceptable for country-level analytics. Run `npm run` updatedb periodically if precision matters. The deploy must run `npm install` in `server/` (it does).
- `req.ip` correctness depends entirely on `trust proxy` + nginx forwarding the real client IP (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; X-Real-IP $remote_addr;`). If nginx does not, `req.ip` stays private → `source:'local'` → "Unknown". Validate a real registration's `registrationIpCountrySource` after deploy.
- Legacy rows are cosmetically fixed on the Ops map immediately (label derives from code); run `node scripts/repair-country-codes.js --apply` once to also clean the stored per-user name.
