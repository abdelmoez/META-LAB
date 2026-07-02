# Embeddable Dashboards (68.md P8)

A published synthesis carries an optional **dashboard layout** — an ordered list
of cards that a reader (or an embedding site) renders from the sanitized public
payload. The layout is stored per META·LAB project in the `DashboardLayout` model
and travels inside the published `payload.dashboard.cards`.

Server implementation:
- Card model + validation: `server/publicSynthesis/publicSynthesisService.js`
  (`CARD_TYPES`, `sanitizeCards`, `getDashboard`, `putDashboard`)
- Layout CRUD API: `server/controllers/publicSynthesisController.js`
  (`getDashboardHandler`, `putDashboardHandler`)
- Embed framing relaxation: `server/index.js` (~L121–147)

> **Implementation status.** The server card model, validation, layout CRUD, and
> the embed framing/CSP relaxation are implemented. The **client composer UI** and
> the **`/embed/synthesis/:token` SPA page that renders the cards** are **not
> present in `src/` yet.** No `InteractiveForest` component or public-page renderer
> exists in the client tree. The embed snippet below documents the intended route;
> the route's framing headers are already set up server-side (see below), but the
> HTML/SPA that would be served at that path is not yet built.

## Card model

A layout is `{ id, name, cards: [...] }`. Each card is validated and whitelisted
by `sanitizeCards`, which:
- drops anything whose `type` is not in `CARD_TYPES`,
- caps the array at **50 cards**,
- assigns a stable `id` (or generates a UUID),
- length-caps the `title`,
- whitelists `settings` to display-only keys,
- sorts by `order`.

**Allowed card types** (`CARD_TYPES`):

| `type` | Renders |
|---|---|
| `summaryText` | The publish summary text |
| `keyFindings` | Key-findings text block |
| `prisma` | PRISMA flow counts |
| `forest` | A pooled forest plot for one `(outcome,timepoint,esType)` group |
| `includedStudies` | The included-studies table |
| `rob` | RoB distribution (optionally a traffic-light `variant`) |
| `yearHistogram` | Publications-per-year histogram |
| `note` | A free-text note card |

**Allowed card `settings`** (`CARD_SETTING_KEYS` — everything else is dropped):

| Key | Type | Meaning |
|---|---|---|
| `outcome`, `timepoint`, `esType` | string | which pooled group a `forest` card plots |
| `variant` | string | e.g. `traffic-light` for a `rob` card |
| `limit`, `columns` | number | studies-table paging / layout |
| `showWeights`, `showCI`, `showLegend` | boolean | display toggles |

Because `settings` is whitelisted to these typed keys, a card's settings can
never carry arbitrary private strings into the public payload.

## Per-card data scoping — NOT implemented as such

The prompt spec envisioned **per-card scoping** (each card independently selecting
a subset of studies/outcomes). What the code actually does is narrower and worth
stating plainly:

- A `forest` card **selects** which already-pooled group to display via
  `settings.{outcome,timepoint,esType}`. The pooling itself is computed once over
  the whole review in `deriveMa`; the card does not re-scope or re-pool a custom
  subset.
- `includedStudies` cards accept `limit`/`columns` for paging/layout, but there is
  **no per-card study filter** — every card draws from the same whole-review
  `payload.includedStudies`.
- There is **no per-card visibility/permission scoping.** All cards in a published
  layout are equally public; the only gate is the whole-page publish state.

Treat cards as **views over one shared sanitized payload**, not independently
scoped queries.

## Embed snippet

The intended embed route is `/embed/synthesis/:token` — a chrome-less SPA page
whose framing is relaxed to allow embedding on any parent site:

```html
<iframe
  src="https://pecanrev.com/embed/synthesis/<token>"
  style="width:100%;height:900px;border:0"
  title="Systematic review synthesis"
  loading="lazy"></iframe>
```

The server already relaxes framing for this exact path prefix (see below), so once
the SPA route is built the iframe will load. Until then, integrators can consume
the raw sanitized payload directly from `GET /api/public/synthesis/:token` (which
is already live) and render it themselves.

## The `/embed` route framing (server side, implemented)

`server/index.js` adds a middleware **after** the CSP middleware that, for paths
starting with `/embed/synthesis` **or** `/api/public/`, relaxes framing so the
content can be iframed anywhere:

- Removes helmet's `X-Frame-Options: DENY`.
- Replaces the strict `frame-ancestors 'none'` CSP with one that keeps the app's
  own `default-src` but sets `frame-ancestors *`:
  - `/api/public/*` (JSON only): `default-src 'none'; frame-ancestors *; base-uri 'none'; form-action 'none'`
  - `/embed/synthesis*` (SPA): `default-src 'self'; frame-ancestors *; base-uri 'self'; object-src 'none'; form-action 'self'`

This relaxation is **scoped to only those two path prefixes**; every other route
keeps strict `X-Frame-Options: DENY` / `frame-ancestors 'none'`. See
`docs/public-sharing-security.md` for the security rationale.
