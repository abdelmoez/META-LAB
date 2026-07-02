# Public Synthesis Pages (68.md P8)

Public synthesis pages let a review team publish a **read-only, sanitized snapshot**
of a systematic review at a shareable link. The feature is behind the
`publicSynthesis` feature flag (default **OFF**) and, even when the flag is on,
**every project stays private until its owner/leader explicitly publishes it.**

Server implementation:
- `server/publicSynthesis/publicSynthesisService.js` — the sanitization boundary + publish lifecycle
- `server/controllers/publicSynthesisController.js` — authenticated authoring API
- `server/routes/publicSynthesis.js` — authoring routes (`/api/synthesis`, `requireAuth`)
- `server/routes/publicView.js` — public read routes (`/api/public`, no auth)

> **Implementation status.** The server side described here is fully implemented.
> The end-user **client UI** (an authoring/composer screen, the rendered public
> page, and the `/embed/synthesis/:token` SPA route) is **not present in `src/`
> at the time of writing** — only the server payload/API and the framing/rate-limit
> plumbing exist. See `docs/chart-interactivity.md` and
> `docs/embeddable-dashboards.md` for the specific client gaps.

## Publish workflow

Private by default. A `PublicSynthesis` row is created lazily the first time an
authorized user saves settings, publishes, or regenerates a token. Until
`publish` is called with `enabled: true`, nothing is publicly reachable.

**Explicit publish → immutable version.** `publish(metaLabProjectId, { settings, actor })`
(`publicSynthesisService.js`):
1. Normalizes the publish settings (`normalizeSettings`).
2. Builds the **sanitized** payload from live private data (`buildPublicPayload`).
3. Snapshots that payload as JSON into a new `PublicSynthesisVersion` row with a
   monotonically increasing `version` number, the app `appVersion`, and the
   publishing actor's id/name.
4. Flips the `PublicSynthesis` row to `enabled: true`, sets `currentVersionId` to
   the new version, and records `publishedAt` / `publishedBy`.

Published versions are **immutable**: public reads serve the frozen version JSON
and **never recompute from private data**. Editing the review after publishing
does not change the public page until someone publishes again (creating a new
version). The version list is retained (up to 50 shown in the status view) so the
published state is auditable and each version's `appVersion` is recorded for
reproducibility.

**Unpublish is immediate.** `unpublish(metaLabProjectId)` sets `enabled: false`.
`getByToken` returns `null` for any row that is not `enabled`, so the public
route answers a clean `404` the moment access is withdrawn. The share **token is
kept** on unpublish, so re-publishing restores the same link.

**Token regeneration.** `regenerateToken(metaLabProjectId)` mints a fresh
256-bit token (`newShareToken` → `crypto.randomBytes(32).toString('hex')`, 64 hex
chars), invalidating the old link permanently. This is the "revoke a leaked link"
control; it is distinct from unpublish (which keeps the token but disables access).

## What becomes public (whitelist)

The public payload is assembled **field-by-field** in
`buildPublicPayloadFromData` — **no source record is ever spread**. Section
toggles in publish settings (`sections.{prisma,forest,studies,rob,methods,yearHistogram}`)
gate whether each block is included at all. The payload contains only:

| Block | Fields exposed | Source |
|---|---|---|
| `title` / `summary` | Author-supplied publish title + summary strings | publish settings |
| `pico` | `question`, `population`, `intervention`, `comparator`, `outcome` (only when `sections.methods` **and** `showMethods`) | project blob PICO strings |
| `prisma` | Counts only: `identified`, `duplicatesRemoved`, `screened`, `fullTextAssessed`, `included` | derived from live screening tables (`derivePrisma`) |
| `includedStudies` | `author`, `year`, `title`, `journal`, `doi` per study | project blob `studies[]` |
| `ma` | Per-(outcome,timepoint,esType) pooled result: `k`, `es`, `lo`, `hi`, `pval`, `i2`, `method`, plus per-study rows `{label, es, lo, hi, weight}` where `label` is **author+year only** | canonical `runMeta` engine (`deriveMa`) |
| `rob` | Distribution counts only: `{total, low, some, high}` of resolved overall judgements | `RobAssessment.overall` (`deriveRob`) |
| `yearHistogram` | `[{year, count}]` | project blob study years |
| `dashboard.cards` | Validated, whitelisted card descriptors (see embeddable-dashboards.md) | `DashboardLayout` |
| `publishedFrom`, `generatedAt`, `appVersion` | Provenance metadata | constants |

Every string is length-capped; every number is coerced through `pickNum`; years
through `pickYear`. Study labels in the forest data are built as
`` `${author}${year}` `` and nothing else.

## What NEVER becomes public

The sanitization boundary is deliberate and documented in the service header. The
following are **never** copied into the payload, by construction (they are simply
not read into any whitelist picker):

- Reviewer / user **identities**, emails, or `extractedBy` fields
- Screening **decisions** at the record level, notes, or conflict data
- RoB **rationales / justifications** (only the resolved level is counted)
- Per-record **permissions**
- **File references** / attachments
- Any nested **provenance** on PICO or study objects

The RoB derivation reads only `overall.{overridden,finalOverall,proposedOverall}`
and counts levels; the studies derivation reads five explicit fields; the MA
derivation whitelists per-study rows from the engine result rather than passing
the study object through. Card `settings` are also whitelisted to a fixed set of
display-only keys (`CARD_SETTING_KEYS`) so a card cannot become a smuggling
channel for private text.

## API surface

**Authenticated authoring** — `/api/synthesis/:mlpid/*` (`requireAuth`, flag-gated
404 when off, project access via `resolveExtractionAccess`). `:mlpid` is the
META·LAB project id. Viewing status/preview/dashboard needs any member; mutating
(publish/unpublish/regenerate/settings/dashboard) needs
`resolveExtractionAccess.canAdjudicate` (owner/leader/`canManageExtraction`):

| Method + path | Purpose |
|---|---|
| `GET /:mlpid/status` | published flag, token, settings, version list, `canManage` |
| `PUT /:mlpid/settings` | persist section toggles / branding / download / `embedEnabled` (no publish) |
| `POST /:mlpid/publish` | snapshot sanitized payload → new immutable version + enable |
| `POST /:mlpid/unpublish` | disable public access (keep token) |
| `POST /:mlpid/regenerate-token` | mint a new token, invalidating the old link |
| `GET /:mlpid/preview` | build the sanitized payload **without persisting** (view access) |
| `GET /:mlpid/dashboard` / `PUT /:mlpid/dashboard` | composer layout CRUD |

**Public read** — `/api/public/*` (no auth, rate-limited, **not** flag-gated; see
`docs/public-sharing-security.md`):

| Method + path | Purpose |
|---|---|
| `GET /synthesis/:token` | the frozen sanitized payload + version + settings-lite |
| `GET /synthesis/:token/export.json` | raw payload download (only when `allowDownload`) |
| `GET /synthesis/:token/export.csv` | formula-safe CSV of studies + MA rows (only when `allowDownload`) |
| `GET /synthesis/:token/qr.png` | QR code of the public page URL |

## Version reproducibility

Each publish produces a `PublicSynthesisVersion` with:
- an immutable JSON `payload` snapshot,
- a sequential `version` number,
- the `appVersion` at publish time (read from `server/version.json`),
- `createdBy` id/name.

Because the public route serves the stored `payload` verbatim (never recomputing),
a shared link is **stable and reproducible**: it always shows exactly what was
published at that version, regardless of later edits to the underlying review,
until a new version is published or the token/access is changed.
