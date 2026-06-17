# prompt30 — delivery notes & follow-ups

_Shipped in v3.13.0 (`f9cda7a`) + follow-up commit._

## What shipped

1. **Country-by-IP at registration.** Root cause of "Local": no `trust proxy`, so
   `req.ip` was the proxy's private IP. Fixed via `app.set('trust proxy', …)`
   (env `TRUST_PROXY`, default trusts local/private upstreams), hardened
   `getClientIp` (first PUBLIC X-Forwarded-For hop), and private/local IPs now save
   **"Unknown"** (not "Local"), source tagged `local`. Verified live: header →
   France/FR, localhost → Unknown, public-no-geoip → Unknown.
2. **Full-width workspace.** Monolith tab body `maxWidth:960` → none; RoB standalone
   → full; dashboard / Ops / standalone screening 1200/1180 → 1680.
3. **RoB two-section split** — LEFT PDF panel (reuses screening PDF/OA), RIGHT
   assessment (unchanged), default-open + collapsible, wraps on small screens.
4. **RoB full answer labels** — Yes / Probably yes / Probably no / No / No
   information (codes kept as a hint; scoring/stored values unchanged).
5. **Header cleanup** — detailed status header only on Overview; compact amber/red
   badges + Report/Export/Import in `ProjectHeaderBar` on other tabs.

## Follow-ups (documented, not forced)

1. **Bare-VPS geo accuracy.** Without a country-header proxy (Cloudflare/Vercel) or
   the optional offline `geoip-lite` package, a real public IP resolves to
   "Unknown" (graceful, never "Local"). To get the actual country on a bare VPS,
   install `geoip-lite` (the resolver uses it automatically when present) or front
   the app with a proxy that sets `CF-IPCountry` / `x-vercel-ip-country`. Not added
   here because its postinstall downloads a ~MaxMind DB and could make `npm ci` /
   deploy network-dependent.
2. **Multi-proxy deployments.** Set `TRUST_PROXY` (hop count or subnet list) when
   behind more than one proxy.
3. **Full-width text tabs.** Tables/screening/RoB now use the full width. Long-form
   prose tabs (Manuscript, Methods, GRADE, Report) inherit the full width too; if a
   paragraph looks too wide on very large displays, give those specific tab bodies
   an inner readable `max-width` (the wrapper intentionally no longer caps them).
4. **RoB export wording.** The answer-level CSV still uses canonical codes
   (Y/PY/PN/N/NI) for data interchange; mapping to full labels there is optional and
   would change the export format.
