# Ops — Users by Country map (prompt19, Task 12)

Captures the **country only** of each user at registration and surfaces an
interactive users-by-country distribution in the Ops Console **Users** tab.

## Privacy decisions (non-negotiable)

- **Country-level only.** We never resolve or store city, region, or
  coordinates — only an ISO-3166 alpha-2 code and its English country name.
- **The raw IP is never stored.** The IP is used transiently to derive the
  country. The only IP-derived value that may be persisted is an **optional**
  salted SHA-256 hash (`registrationIpHash`), salted with `JWT_SECRET` so it
  cannot be reversed via a rainbow table. It exists for coarse de-duplication /
  abuse signals only and can be dropped without affecting the map.
- **Best-effort, never blocking.** `resolveCountry()` never throws, and the
  capture in `register()` is fire-and-forget inside its own try/catch. A
  geolocation failure must never block, slow, or 500 a registration. The
  registration success contract (HTTP 201 + `{ user }`) is unchanged.
- **Aggregate display only.** The Ops map shows counts grouped by country; it
  never exposes an individual user's country.

## Country-resolution order

Implemented in `server/utils/geo.js` → `resolveCountry(req)` returns
`{ code, name, source }`:

1. **Proxy country header** — first present and valid of `cf-ipcountry`,
   `x-vercel-ip-country`, `x-country`, `x-appengine-country`. Uppercased,
   must be exactly 2 letters; Cloudflare placeholders `XX` and `T1` (unknown /
   Tor) are ignored. → `source = 'header'`. This is the reliable production path
   behind Cloudflare / Vercel.
2. **Optional offline lookup** via dynamic `import('geoip-lite')` — **only if the
   package is already installed**. We never `npm install` it and never add it as
   a dependency; the `try/catch` silently skips this step when it is absent.
   → `source = 'geoip'`.
3. **Private / loopback / empty IP** (`127.*`, `::1`, `10.*`, `192.168.*`,
   `172.16–31.*`, `localhost`, IPv6 ULA/link-local, empty) → `code = ''`,
   `name = 'Local'`, `source = 'local'`. (Checked before step 2 — a private IP
   can never be geolocated.)
4. **Otherwise** (public IP we could not resolve) → `code = ''`,
   `name = 'Unknown'`, `source = 'none'`.

Country **name** from a code uses the zero-dependency
`new Intl.DisplayNames(['en'], { type: 'region' }).of(code)` (Node 18+), guarded
in `try/catch` (falls back to the raw code).

Client IP for hashing only: `req.ip` → first hop of `x-forwarded-for` →
`req.socket.remoteAddress`.

## Schema

`User` gained four **nullable** columns (migrated by the Lead via `prisma db
push` — additive/nullable, no `--accept-data-loss`):

| column | meaning |
|---|---|
| `registrationCountryCode` | ISO-3166 alpha-2, or `''`/null when unknown/local |
| `registrationCountryName` | human-readable name, or null |
| `registrationIpCountrySource` | `header` \| `geoip` \| `local` \| `none` |
| `registrationIpHash` | optional salted SHA-256 of the IP — **never** the raw IP |

## Migration / existing users

- **No backfill.** Existing users registered before this change have null
  country fields and roll into the **"Unknown"** bucket on the map. We do **not**
  retroactively geolocate them — there is no reliable historical IP and storing
  one would violate the privacy contract.
- **Forward-fill only.** New registrations are populated best-effort from the
  resolution order above. The Unknown bucket therefore shrinks over time as the
  user base turns over; it is expected to be large at first.

## Endpoint

`GET /api/admin/users/countries` — **admin only** (`requireAdmin`), declared
before `/users/:id` so `"countries"` is not parsed as an `:id`.

Groups all live users by `registrationCountryCode`; null/`''` codes collapse
into a single **Unknown** bucket (named from `registrationCountryName`, e.g.
`Local`, else `Unknown`). Response:

```json
{
  "countries": [
    {
      "countryCode": "US",
      "countryName": "United States",
      "userCount": 42,
      "percentage": 38.5,
      "latestRegistrationAt": "2026-06-14T10:22:00.000Z"
    }
  ],
  "summary": {
    "totalUsers": 109,
    "totalKnown": 80,
    "unknown": 29,
    "countriesRepresented": 12
  }
}
```

- `countries` is sorted by `userCount` descending (name as tiebreak).
- `percentage` is `userCount / totalUsers` rounded to one decimal place.
- `countriesRepresented` counts only real (known-code) countries, excluding the
  Unknown bucket.

## Map approach (and tradeoff)

Implemented in `AdminConsole.jsx` as `UsersByCountryCard`, rendered at the top
of the Users tab (admin only — the endpoint is admin-gated).

- **Lightweight inline SVG, no map library / no heavy dependency.** A single
  equirectangular world outline (a few hand-simplified continent polygons for
  context) with **accent-scaled circle markers** placed at coarse national
  centroids. Marker radius and fill intensity scale with each country's user
  count. This reads clearly as a geographic distribution and stays performant.
- **Tradeoff:** centroid markers are not a true country-shape choropleth (that
  would require a ~100KB+ TopoJSON world atlas or a mapping library — explicitly
  out of scope). The marker map is paired with a full **ranked table** (rank,
  country, users, percentage, with an inline accent share-bar and a
  latest-registration tooltip) so every country — including those with no
  centroid and the Unknown bucket — is always visible and precise.
- **Theme correctness:** the colour scale is driven entirely by the app accent
  (`C.acc`) and other theme tokens via the `alpha()` `color-mix` helper — never
  hex-string concatenation — so it renders cleanly in both day and night themes.
  Zero-count uses a neutral muted tint; the Unknown bucket is excluded from the
  map's colour ceiling so one large Unknown bucket cannot wash out the real
  geographic signal.
- **Interaction:** hovering a marker shows a tooltip (country name, user count,
  percentage); clicking a marker or a table row cross-highlights the matching
  table row.

## Files

- `server/utils/geo.js` — `resolveCountry`, `getClientIp`, `isPrivateIp`,
  `countryNameFromCode`, `hashIp` (new).
- `server/controllers/authController.js` — `register()` best-effort country
  capture.
- `server/controllers/adminController.js` — `getUserCountries`.
- `server/routes/admin.js` — `GET /users/countries` route.
- `src/frontend/pages/admin/adminApiClient.js` — `adminApi.users.countries()`.
- `src/frontend/pages/admin/AdminConsole.jsx` — `UsersByCountryCard` + Users tab
  wiring.
- `tests/integration/prompt19-countries.test.js` — endpoint shape + auth +
  registration-still-succeeds coverage.
