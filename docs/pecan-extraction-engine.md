# Pecan Extraction Engine (76.md)

Feature flag: `extractionEngine` (default **OFF**). When an admin enables it in Ops → Flags, the
project **Data Extraction** tab *becomes* the Pecan Extraction Engine: a full-screen, article-centred
workspace — an article list (statuses, progress, validation counts, PDF availability, analysis-sync
state, search / sort / filters, continue-where-you-left-off) that opens each article into a resizable
PDF-left / form-right split with three extraction methods (Table Extractor, Click-to-Capture, Manual
Entry), per-value provenance with one-click jump-to-source, honest autosave status, three-tier
validation, a completion/reopen workflow with a durable audit trail, and per-article analysis-sync
status. The flag is **independent of `extractionAssist`** (the 66.md structured stack) — both read the
same project `studies[]` blob. Flag **OFF** preserves the current split-screen extraction tab
byte-for-byte via a dispatcher. Admins can use the engine even while the flag is globally OFF
(`featureAccess` admin override); non-admins get an existence-hiding 404.

## Architecture

| Layer | Location |
| --- | --- |
| Pure engine | `src/research-engine/extraction/engine/` (`articleStatus`, `articleProvenance`, `syncState`, `completionGate`, `articleList`, `index` barrel) |
| Server module | `server/extraction/engine/` (`articleService`, `completionService`, `auditLog`) |
| Routes / controller | `server/routes/extractionEngine.js` → `server/controllers/extractionEngineController.js` (mounted `/api/extraction-engine`, `server/index.js`) |
| Audit model | `ExtractionAuditLog` (`server/prisma/schema.prisma`) |
| Client API | `src/features/extraction/engine/engineApi.js` |
| Frontend engine | `src/features/extraction/engine/` (`PecanExtractionEngine`, `ArticleList`, `ArticleWorkspace`, `useExtractionSplit`) |
| PDF viewer | `AppPdfViewer.jsx` — `reveal`/`onRevealDismiss` props + persistent `.mlpdf-src-hl` jump-to-source overlay |
| Shell integration | `extractionTabs.jsx` (`ExtractionTab` flag dispatcher); `StitchProjectWorkspace.jsx` (`extractionInWorkspace` full-bleed lift) |

The pure engine is a **separate barrel** from `../index.js` (the 66.md engine) so its article-level
helpers deep-import without name collisions. It imports only sibling pure modules + the shared
`study-validator` — safe for server, client and unit tests (no DOM/IO/`Date.now`/`Math.random`).

## Data model — additive, zero-migration

The engine never changes the `mkStudy` contract. All engine bookkeeping lives **additively** under a
new `study.extractionMeta` namespace inside the existing `Project.data.studies[]` blob:

```
study.extractionMeta = {
  completedAt, completedBy, completedByName, reopenedAt, reopenedBy, readyForReview,
  locked,                                   // completion / lock (§22)
  provenance: { <field>: { method, page, bbox, excerpt, at, by, ... } },  // per-value source (§15)
  syncHash, syncedAt, syncedBy, includedInAnalysis,   // analysis sync (§20/§21)
  assignedTo: [ { id, name } ]              // advisory reviewer assignment
}
```

Unknown keys are ignored by analysis and legacy code, so **analysis keeps reading `studies[]`
unchanged** (es/lo/hi stay on the ln analysis scale for ratio measures). A study that has never
touched the engine simply has no `extractionMeta` and degrades to *not started* / *in progress*.
Per-user UI state lives under `project.extractionEngine` (e.g. `lastArticleId`).

One **new additive Prisma model** — `ExtractionAuditLog` (clone of the RoB audit shape: bare
`projectId`/`studyId` with no FK, denormalized `actorId`/`actorName`, append-only, `details` JSON
capped at 4000 chars, `@@index([projectId, createdAt])` + `@@index([studyId, createdAt])`). No
change to any existing table.

## API — `/api/extraction-engine`

Mounted with `requireAuth` + a dedicated `extractionEngineLimiter` (15 min window, max 900 prod /
4000 dev). Every handler shares one gate: `featureAccess('extractionEngine')` (404 when OFF, admins
pass) → `resolveExtractionAccess` (404 when not a project member). This layer owns article **STATE**
only; extraction **VALUES** keep flowing through the project-blob autosave, so it never races value
writes for the same fields.

```
GET  /projects/:pid/articles                 → article-list entry view {articles, stats, canEdit, canAdjudicate}   [canView]
POST /projects/:pid/articles/:sid/complete   → validate + mark complete; 422 VALIDATION_BLOCKED {blocking,warnings} [canEdit]
POST /projects/:pid/articles/:sid/reopen     → reopen a completed/locked article; 409 NOT_COMPLETE                 [canEdit]
POST /projects/:pid/articles/:sid/lock       → lock/unlock (body {locked}); 409 NOT_COMPLETE if not complete       [canAdjudicate]
POST /projects/:pid/articles/:sid/inclusion  → include/exclude from analysis (body {included})                     [canEdit]
GET  /projects/:pid/articles/:sid/audit      → most-recent-first audit rows for the article                        [canView]
```

Reads require `canView`; state changes require `canEdit`; lock/unlock requires `canAdjudicate`. State
mutations load the blob fresh, mutate only `study.extractionMeta`, persist the whole project row,
emit a realtime `project.updated`, stamp project activity, and write one audit row (best-effort).

## Three extraction methods

All three live in `ArticleWorkspace.jsx` and reuse the proven pure engine + the split-panel widgets
(`TableRegionMapper`, `PlotDigitizer`, `DraftReviewList`, `usePdfSource`) — data written here is
identical to and interoperable with the classic tab.

- **Table Extractor** — drag a rectangle around a table; the PDF text region runs through the pure
  grid pipeline (`normalizeItems` → `itemsToRows` → `detectColumns` → `buildGrid`) and opens in
  `TableRegionMapper` for confirmation. Confirmed cells become drafts (`mkExtractionRecord`) that the
  reviewer confirms into study fields. A `Figure` mode digitizes plots via `PlotDigitizer` (no model
  call). Table/figure failures never block the other methods.
- **Click-to-Capture** — click a number in the PDF; `snapToken` / `findNumberTokens` smart-parse the
  clicked token (ratio+CI, range, event/total pair, mean±SD, single value), fill the chosen field(s),
  and store **per-value provenance** (page + span bbox). An overwrite guard (`decideWrite`) refuses to
  silently replace an existing human value; ratio measures are stored ln-transformed.
- **Manual Entry** — the always-visible structured form; every identity/value field is directly
  editable and auditable, with a free-text notes field for assumptions and conversions.

## Provenance & jump-to-source (§15)

Each captured value can carry a normalized per-value provenance entry (pure `articleProvenance.js`),
keyed by the study value field under `extractionMeta.provenance`:

```
{ field, method, page, bbox:{x0,y0,x1,y1}, excerpt, at, by, original, transformed, rule, confidence, ocr }
```

`method` is one of `table | figure | click | manual | auto | ai | ocr`; `bbox` is the PDF user-space
rectangle at scale 1; `page` is 1-based. A field that has a jumpable source shows a **⌖ source** chip;
clicking it sets `AppPdfViewer`'s `reveal = { page, region, nonce, label? }`, which scrolls the region
into view (centred) and shows a PERSISTENT `.mlpdf-src-hl` highlight box over it (83.md §3). The
highlight stays until dismissed — click anywhere else (PDF or form), Escape, selecting another source,
or switching outcome/study/PDF — via the host clearing `reveal` (the viewer requests it through
`onRevealDismiss`). Page-only provenance shows a distinct labelled page-level indicator instead of a
fabricated box. The nonce forces a re-reveal on a repeat jump; the prop is inert/null for every
existing caller.

## Analysis sync (§20/§21)

Because analysis reads the blob live, "sync" here is a **visible per-article state**, not a data copy.
`syncStatusOf(study)` returns one of:

| Status | Meaning |
| --- | --- |
| `not_ready` | No usable effect size (`es`) yet |
| `ready` | Analysis-ready but never marked synced |
| `synced` | Synced before AND the live inputs hash matches the stored one |
| `updated_since_sync` | Synced before BUT an analysis input changed since (§21) |
| `excluded` | Reviewer set `includedInAnalysis === false` |

`computeSyncHash` is a stable djb2 hash over the analysis-input fields (`SYNC_INPUT_FIELDS`:
esType/outcome/timepoint/adjusted + all raw counts/means + es/lo/hi); the hash is stamped into
`extractionMeta.syncHash` when an article is completed while analysis-ready, so later edits are
detected as drift. The reviewer retains explicit include/exclude control via the inclusion endpoint.

## Autosave & completion

Extraction values autosave through the existing whole-project blob autosave; the workspace toolbar
shows an **honest** save badge threaded from the shell's `doc.saveStatus` (`saving` / `saved` /
`error`) — never a false "Saved". Completion is gated by the pure `evaluateCompletion(study)`, which
sorts validator output into **three tiers** (`SEVERITY.INFO` / `WARN` / `BLOCK`): an article may be
marked complete only when there are **no blocking errors**; warnings and info advisories surface but
**never block**. `complete` / `reopen` / `lock` / `unlock` / `inclusion` each write an
`ExtractionAuditLog` row (`EXTRACTION_COMPLETE | EXTRACTION_REOPEN | EXTRACTION_LOCK | EXTRACTION_UNLOCK
| EXTRACTION_INCLUDE`), recording actor and timestamp.

## Permissions (§9)

The engine reuses the existing `resolveExtractionAccess` resolver (owner / member / adjudicator) — it
does not introduce new roles. `canView` gates the list and audit reads; `canEdit` gates
complete/reopen/inclusion; `canAdjudicate` gates lock/unlock. Non-members get the same 404 as the rest
of the extraction surface.

## Migration & rollback

- **No destructive migration.** New state is additive blob keys (`study.extractionMeta`,
  `project.extractionEngine`) plus one additive table. Existing extraction records, schemas, analysis
  links and article statuses are untouched and render correctly in the new UI.
- **Rollback = turn the flag OFF.** The `ExtractionTab` dispatcher then mounts the classic
  split-screen workspace, byte-for-byte. The `ExtractionAuditLog` table is inert when unused.
- After editing `server/prisma/schema.prisma`, run **`npm run db:sync-postgres-schema`** from
  `server/` to regenerate the Postgres twin, then `prisma db push` to apply the additive table.

## Testing

| Kind | Location |
| --- | --- |
| Unit (pure engine) | `tests/unit/extraction/engine/*.test.js` — `articleStatus`, `articleProvenance`, `syncState`, `completionGate`, `articleList` (~61 unit + smoke assertions) |
| Integration | `tests/integration/api-extraction-engine.test.js` — flag-gate (404 when OFF), article list, complete/reopen |
| End-to-end | `e2e/extraction/pecan-engine.spec.ts` |

## Known limitations (v1 — foundation for future)

- Server-side OCR / table-detection jobs remain **client-side** (Tesseract.js "text recognition");
  durable background-job scaffolding is deferred.
- N-arm / subgroup relational modelling stays **blob-flat** (one outcome × timepoint per study row);
  companion-publication linkage is deferred.
- Field-level autosave stays **whole-blob honest-status** (not per-value CAS); completion/reopen are
  audited and conflict-guarded. Article STATE written server-side is merged back into the client blob
  on each change (so the next whole-blob autosave preserves it), but a value edit made within the 800 ms
  autosave debounce *before* pressing Complete may be validated server-side against the not-yet-persisted
  blob — deliberate value edits normally settle well before completion.
- Blinded dual-extraction enforcement stays in the 66.md structured stack (`extractionAssist`); the
  engine's reviewer assignment is **advisory** in v1 (unlocking a locked article still requires the
  adjudicate permission).
- The jump-to-source flash resets page rotation to 0 (its coordinate frame); the transient highlight is
  a verification aid, not a persisted annotation.
