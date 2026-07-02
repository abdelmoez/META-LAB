# Public Sharing Security (68.md P8)

Public synthesis pages are **unauthenticated, externally shareable, and
iframe-embeddable**. This document describes the controls that keep that surface
safe. Relevant files:

- `server/routes/publicView.js` — the public read routes
- `server/publicSynthesis/publicSynthesisService.js` — token minting + the sanitization boundary
- `server/index.js` — rate limiter, embed framing relaxation, maintenance gate mounting
- `server/middleware/maintenance.js` — maintenance exemption

## Token entropy + lookup

- **Entropy.** A share token is `crypto.randomBytes(32).toString('hex')` —
  256 bits of CSPRNG output rendered as 64 lowercase hex characters
  (`newShareToken`). This is unguessable; there is no enumeration path.
- **Lookup.** `getByToken(token)` does an exact `prisma.publicSynthesis.findUnique({ where: { shareToken } })`.
  The token is the **only** credential — possession of the token is the grant.
- **Fail-closed.** `getByToken` returns `null` (→ clean `404`, message
  "This synthesis is not available.") when the token is missing, unknown, or the
  row is not `enabled`. A non-string token short-circuits to `null`. There is no
  distinction between "wrong token" and "unpublished" from the outside.
- **Revocation.** `regenerateToken` mints a new token, permanently breaking any
  previously shared link. `unpublish` disables access while keeping the token.

## Rate limiting

The public read routes are mounted behind a dedicated per-IP limiter
(`publicSynthesisLimiter` in `server/index.js`):

- Window: 15 minutes.
- Budget: **120 requests / 15 min in production** (relaxed to 2000 in dev/test for
  the integration suite).
- `standardHeaders: true`, `legacyHeaders: false`; over-budget returns
  `{ error: 'Too many requests, please try again later' }`.

The budget is generous enough for an embedded page hit by many anonymous visitors
but bounded to blunt scraping / DoS.

## Framing relaxation — scoped to public surfaces ONLY

The whole app ships strict framing: helmet sets `X-Frame-Options: DENY` and the
central CSP middleware sets `frame-ancestors 'none'` on **every** response. A
dedicated middleware in `server/index.js` (runs **after** the CSP middleware so it
overwrites the just-set header) relaxes framing for **only** two path prefixes:

- `/embed/synthesis` — the chrome-less embeddable SPA page
- `/api/public/` — the public JSON API

For those paths it removes `X-Frame-Options` and rebuilds a strict-but-embeddable
CSP with `frame-ancestors *`:

- `/api/public/*`: `default-src 'none'; frame-ancestors *; base-uri 'none'; form-action 'none'`
- `/embed/synthesis*`: `default-src 'self'; frame-ancestors *; base-uri 'self'; object-src 'none'; form-action 'self'`

Every **other** route keeps `X-Frame-Options: DENY` / `frame-ancestors 'none'`.
The relaxation is narrow (only `frame-ancestors` opens up; `object-src`,
`base-uri`, `form-action` stay locked), so the app's authenticated surfaces cannot
be clickjacked via this change.

## Sanitization boundary

Everything a token holder can read is built whitelist-first in
`buildPublicPayloadFromData` — **no source object is ever spread into the payload.**
The full whitelist and the never-exposed list are in `docs/public-synthesis.md`.
Two structural guarantees:

1. **Frozen snapshot.** Public reads serve the pre-sanitized
   `PublicSynthesisVersion.payload` JSON. They never recompute from private tables,
   so a future code change cannot accidentally widen what a *already-published*
   link exposes.
2. **Whitelisted card settings.** Dashboard card `settings` are coerced to a fixed
   set of display-only keys (`CARD_SETTING_KEYS`), so a card cannot carry private
   text into the public payload.

Downloads (`export.json` / `export.csv`) additionally require the publisher to have
left `allowDownload` on (else `403`), and the CSV is written through
`csvField`/`csvRow` which prefix `= + - @` cells with a quote (CWE-1236 formula
injection guard).

## Maintenance exemption

`server/middleware/maintenance.js` 503s all `/api` traffic when
`appSettings.maintenanceMode === true`, **except** a small exempt set. `/api/public/`
**is exempt** (added for 68.md P8): a published synthesis is an external artifact
embedded on third-party sites and opened by anonymous readers, so its availability
must not hinge on this app's internal maintenance state. The **authenticated
authoring** side (`/api/synthesis`) is intentionally **not** exempt — it 503s like
the rest of the app during maintenance.

## No auth/session exposure on public routes

- The public router (`publicView.js`) is mounted with **no `requireAuth`** and does
  not read cookies, sessions, or user context. It only reads the token from the
  URL and serves the frozen payload.
- **The flag gate is intentionally NOT applied to the public read side.** An
  unknown/unpublished token already yields a clean `404`, so turning
  `publicSynthesis` off simply means no token is ever `enabled`. This keeps
  published links stable regardless of the admin flag **and avoids leaking the
  flag's state** to anonymous callers. (The authoring side **is** flag-gated with a
  404 when off, so the feature's existence is not disclosed to authenticated
  non-users either.)
- Errors are logged server-side and returned as generic `500`
  `{ error: 'Internal server error' }` — no stack or internal detail crosses the
  boundary.
