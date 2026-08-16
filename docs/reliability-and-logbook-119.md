# 119.md — Reliability & the Project Logbook: PRISMA Dedup Accounting, Table Repairs, PDF Split Workspace, Figures, Demographics, Templates, Logbook

**Version:** v4.27.0 (bump pending at push; baseline v4.26.0 `cb6af2b`) · **Date:** 2026-08-16 · **Prompt:** `.claude/Prompts/119.md`

Workflow per the prompt's model: Fable investigated (6 targeted readers with live repros),
architected (`ARCH-119`), delegated; Opus agents implemented in three waves (A–I); an
adversarial r2 review followed (11 findings: 9 fixed with regression tests, 2 declined with
evidence — see §2), and the fix round also closed both pre-accepted work items. Eleven stage
commits are pushed-ready on top of `cb6af2b`; **the r2 fix round is in the working tree,
uncommitted at the time of this report** (~25 files, +1,108/−145).

Commits: `dee9099` dedup-prisma (§1) · `7a06781`+`26765b6` tables + view default (§2–3) ·
`43375f8` logbook backend (§8) · `5df96b8` pdf-split (§4) · `fd6fb06` figures (§5) ·
`26dfd24` logbook UI (§8) · `c7d6069` playwright straggler · `176fb91` demographics (§6) ·
`b82e2d9` templates (§7) · `1642d7c` logbook pagination fix (§8 r2).

---

## 1. Confirmed root cause of every reported defect

**§1 — "automatic duplicates missing from PRISMA": REAL, but a different defect than
suspected.** Three stacked causes, all confirmed on code + the live stack:

- **Pecan (automated-search) duplicates never reach the canonical flow.**
  `server/pecanSearch/pipeline.js` classifies `exact_dup`/`fuzzy_dup` BEFORE landing — only
  `new`/`ambiguous` records ever reach `dedupeAndInsertRecords` — so engine duplicates were
  counted only on `PecanSearchSource.exactDupCount/fuzzyDupCount`, which
  `loadPrismaFlow` (the service behind GET `/prisma`, the PRISMA page, the manuscript
  diagram and the DOCX export) never read. For an automated search, every one of those
  surfaces under-reported both *records identified* and *duplicates removed* by
  exactDup+fuzzyDup — while `getMetaLabSummary` (the dashboard path) DID include them, so
  two surfaces disagreed on the same project.
- **Force re-import inflation.** The sha256 `fileHash` fence was the only idempotency for
  file imports; `force:true` legitimately bypasses it, and each forced re-upload of the same
  file added a new batch whose phantom `duplicateCount` was summed forever. Live-verified:
  identified 4→8, duplicatesRemoved 2→6, permanently.
- **Four independent PRISMA derivations** (flow service; `getMetaLabSummary`;
  `livingService` digest; `publicSynthesisService.derivePrisma`) that disagreed on real
  automated-search projects.

**§2 — Safari table title cannot be typed into.** WebKit fails to establish a caret from a
click inside an EMPTY inline editable island: the title is a `contenteditable=true` span
nested in a `contenteditable=false` caption, rendered as a zero-width inline box whose
`::before` placeholder is not a caret anchor. Focus succeeds (activeElement is correct) but
typing inserts nothing. Reproduced in Playwright WebKit on an isolated harness with the
exact caption DOM+CSS; Chromium types fine; a NON-empty title types fine in both. Every new
table starts with an empty title, hence "cannot type the table title in Safari". Ruled out
in the same investigation: event handlers (no `beforeinput` handler exists; typing is never
`preventDefault`ed), React rerenders (the DOM is rendered once), autosave resets.

**§2 — one click inserts two tables.** `insertTable` deliberately parks the caret inside
the new caption's title island; a second insert with the selection still there — the ⊞
button's `onMouseDown preventDefault` preserves exactly that selection, and
`selectionInRoot` checked DOM containment but never editing-host boundaries — made
`execCommand('insertHTML')` splice the new caption+table INSIDE the previous title span.
The user sees an extra table; worse, the `htmlToMd` round-trip silently DELETED the nested
table from markdown and corrupted the old title ("Existing titleTable 9."). One unguarded
geometry produced both visible duplication and silent data loss; the same trap fired for
inserts inside a table cell. Ruled out: double listeners, StrictMode, network retries and
collaboration echoes (table insertion involves no server call at all).

**§2 — selecting a table and pressing Delete does nothing useful.** No Delete/Backspace
handling existed anywhere in the editor — deletion was raw browser behaviour. A drag over
all cells deleted the `<table>` but the `contenteditable=false` caption island SURVIVED as
an orphan "Table 1." keeping its number slot (what users read as "the table didn't
delete"); a partial drag cleared cell text and left the skeleton. Only the ✕ Table menu op
deleted correctly — and it nulled `tableMeta`, so undo could not restore provenance stamps.

**Found during 119 and fixed inside the same effort:**

- **WebKit figure removal ate the adjacent cross-reference chip** (wave 2 finding):
  removing a placed figure whose next sibling held a chip also removed the chip — both are
  `contenteditable=false` islands and WebKit reached past the range end. Fixed in the r2
  round with an engine-neutral range shape, now verified in BOTH engines (the figures spec
  joined the `webkit-manuscript` Playwright project).
- **Figure DELETE could race an in-flight autosave** (r2 finding): the delete-time
  "still referenced?" check read the last PERSISTED blob, so a marker placed seconds ago
  was invisible and a hard delete could destroy bytes an autosave still pointed at. A
  single stale-blob read is never a safe basis for destroying bytes — DELETE became a soft
  delete (`deletedAt`) with a 24h grace window plus a restore-on-reference sweep
  (`sweepDeletedFigures`): a row the prose still references is restored; row + file are
  hard-deleted only after the grace window with nothing pointing at them.
- **Logbook filtered pagination over bridged history — two generations of defect.**
  (Wave-2 finding, fixed in `1642d7c`): bridged legacy stores have no engine/status/actor
  columns, so those predicates ran in memory AFTER a fixed per-source `take` — a selective
  filter could return a short page with `hasMore:false` while older matches existed, and a
  deep row from a fully-SQL-filtered source could move the cursor past rows a legacy source
  never read (permanently skipping them). Fixed with a per-source drain, a safe frontier,
  and an honest `scanIncomplete` flag. (r2 finding, fixed in the uncommitted round): the
  cursor was applied as an INCLUSIVE date window, so a same-millisecond tie group larger
  than the scan budget (one `createMany` stamps one `now()` on a whole batch) made every
  request re-read the group from its top — duplicate emission and a `nextCursor` that
  could sort at-or-before the request cursor, walking the pager backwards. The cursor is
  now pushed into each source's OWN columns as an exact keyset predicate (`cursorWhere`
  over timestamp → source rank → row id), and `listLogbook` refuses any nextCursor that
  does not sort strictly after the request cursor.

## 2. Suspected issues verified vs disproved

**Verified real** (each reproduced before fixing, per the prompt's safeguard #2):

- Automated-search duplicates absent from the canonical PRISMA flow (live-reproduced;
  §1 above) — including the consumer divergence GET `/prisma` ≠ `getMetaLabSummary`.
- Force re-import permanently inflating identified/duplicatesRemoved (live: 4→8/2→6).
- Safari empty-title caret failure; caption-splice double insert; missing whole-table
  delete handling (all three root-caused with repros).
- The wave-era findings above (WebKit figure removal, figure-delete race, both logbook
  pagination defects).

**Disproved / not defects** (documented + regression-pinned instead of "fixed"):

- *"Duplicates counted as groups, not instances."* Disproved: import discards count per
  INSTANCE (live: 3 identical copies + 1 unique → identified 4, duplicatesRemoved 2), and
  the worker counts non-primary members per record.
- *"Confirming an auto-detected group counts it twice."* Disproved: `dispositionOf` is a
  single terminal state per record; live-verified (auto count 2→3, human confirm keeps 3,
  keep-all reverses it). Phantom (never-inserted) and record-level sets are disjoint by
  construction, so import + worker cannot double-count one instance.
- *"Deleting an import batch leaves its counts behind."* Disproved for file batches
  (live-verified 8→4/6→2) and for full resets (batches deleted + `rolledBackAt` stamped).
- *"Re-running a search / living update inflates counts."* Already idempotent by design:
  pecan `existing_match` is deliberately counted nowhere (rerun-safety doctrine).
- *"The drawn 'Records removed before screening' box shows 0 for file imports."* Correct
  per PRISMA 2020 — the box is database-arm-scoped; other-arm removals are reported via
  `flow.otherArm`/`removedBreakdown`. Documented, not "fixed".
- *Double insert from debounce-class causes* (double listeners, StrictMode, retries,
  collaboration echoes): ruled out; the defect was selection geometry (§1).
- *Safari title reset by React/autosave*: ruled out; the DOM mounts once and no handler
  touches typing.

**r2 review disposition:** 11 findings — 9 fixed with regression tests; 2 declined with
evidence: one finding's premise was factually wrong (shown against the actual code/behaviour
rather than patched around), and one requires hardware this environment does not have
(real-Safari/macOS validation; see §10). Both pre-accepted work items were completed: the
WebKit figure-removal fix (verified in both engines) and re-running every requested suite.

## 3. Architecture and data-flow changes

**§1 dedup→PRISMA.** New `server/screening/dedupCounts.js` holds the shared primitives
(`sumImportDuplicates`, `isRemovedDuplicateRecord`, `loadEngineDuplicateSources`,
`engineDuplicateTotals/ByArm`, `loadDedupIdentificationInputs`). `loadPrismaFlow` now reads
`PecanSearchSource` (filtered `run.rolledBackAt: null`) and credits exact+fuzzy engine
duplicates as per-arm phantoms through the SAME `unrecordedDuplicates` mechanism import
discards use, with arm attribution through the real `armOf()` on the provider's canonical
DB key. The phantom shape widened additively (`dbSearch`/`otherSearch`) so the stage line
reads "Removed during automated search (not stored as records)" instead of mislabelling
engine removals as import discards. Same-fileHash force re-imports now supersede: the
NEWER batch is retired (linked `supersedesBatchId`/`supersededById`, stamped inside the
per-project landing lock), keeping the lineage root's accounting — a genuinely different
overlapping export (different hash) still adds instances, as PRISMA requires.
`getMetaLabSummary`, the living digest and `publicSynthesisService.derivePrisma` delegate
to the shared primitives — one authoritative calculation serves the PRISMA page, manuscript
diagram, dashboard, living digest, public synthesis and exports. `ScreenDedupEvent` is a
new AUDIT-ONLY table (never summed — pinned by a test that deletes the model from the
client and asserts every count is byte-identical); write points: import landing (per
removed instance, with real match basis), pecan pipeline, duplicate worker, resolve/keep-all
(keep-all stamps prior events reversed AND appends a restoration row).

**§2 tables.** The Safari fix is standards+lifecycle, zero UA sniffing: a `:empty`-scoped
CSS rule gives the empty island real caret geometry (`inline-block; min-width`), and a
delegated caption mousedown places a collapsed range via `caretRangeFromPoint` only when
the browser has not produced a caret; clicks in non-empty titles stay native. Double insert
is fixed at the geometry: `insertHtml(html, {hoistFromIslands})` hoists the insertion point
out of caption islands and table cells before `execCommand`; per-gesture operation ids
(minted at picker open, re-entrant calls are structural no-ops — explicitly not a
debounce); `TableGridPicker` gained the previously missing keyboard path (roving tabindex,
arrows, Enter, Escape + overlay latch). Whole-table Delete/Backspace/Cut intercept ONLY
when `fullySelectedTable()` proves the selection covers every cell of exactly one table
(written with `intersectsNode` because engines normalise table drag-selections to different
boundary containers) and route to the same `runTableOp('deleteTable')` the menu uses, so
caption+table die together in one native undo step; partial selections stay native. Orphan
captions are repaired at SERIALIZATION (`htmlToMd(html, {dropOrphanCaptions})`, emit-path
only — undo-safe by construction); `confirmDeleteTable` no longer nulls `tableMeta`.
`runTableOp` no longer depends on a live caret (WebKit drops the selection when focus
reaches a control), with retry-shaped (not engine-branched) completion fallbacks.

**§3 view default.** `DEFAULT_MANUSCRIPT_VIEW='continuous'` with the symmetric navConfig
rule (builder emits `&msv=sections`, omits the default) and matching absent-param reconcile
semantics; stored preferences win untouched and nothing is written for users who never
chose. r2 refinement: the omit-the-default rule is kept for LINKS but deliberately
overridden for history entries the session itself pushes (`ctx.explicitView`) — after the
user toggles, two different views cannot share one URL, otherwise Back appears dead for a
researcher whose stored preference is not the default, and a pre-toggle bare entry would
resolve to the wrong view. Two e2e assertions were deliberately re-pinned for this, with
the reasoning in-file.

**§4 PDF split.** A pure client-side consumer of the existing listPdf/study-doc routes —
no new endpoints, no second attachment model, no duplicated binaries.
`manuscriptSplit.js` (pure: ratio arithmetic, presets, article building/filtering,
three-valued PDF availability) + `PdfSplitPane.jsx` (CSS-var + rAF drag so dragging never
re-renders React; accessible `role=separator` with keyboard resize; bounded keep-alive
viewer pool of 3 so page/zoom/rotation/search/scroll survive article switches). The split
row and editor pane render UNCONDITIONALLY and the PDF pane is appended after — React
never remounts the editor, which is the structural guarantee behind "must not reload the
manuscript / reset the cursor / discard unsaved changes" (proven in e2e with an
out-of-React DOM probe). Rails hide by composing the shell's existing Focus Mode.
Screening-linked reports render through the screening `PdfViewer` wrapper (annotations
intact, read-only); study documents through `AppPdfViewer` + `pinPdfBytesVersion`. All
layout state is per-user localStorage — never the blob, never a server call, so layout
noise generates no audit events.

**§5 figures.** Identity + position live in the PROSE as `[[figcap:<figKey>]]` (the
`[[tblcap:]]` pattern), so ONE native Ctrl+Z restores picture, title and place together;
bytes on disk under `storage/manuscript-figures/<projectId>/`, metadata in the new
`ManuscriptFigure` table; display decisions (caption/legend/width/align) ride the existing
`draft.assets` channel. Uploaded figures are `kind:'figure', origin:'upload'` in the ONE
derived registry — numbering, chips, cross-refs, picker and export validation work
generically; generated figures keep first-mention anchoring and both streams merge by
document offset into one Figures sequence. One upload seam (picker, drag-drop, clipboard
paste — intercepted BEFORE the sanitizer that used to swallow pasted images silently); the
server sniffs magic bytes (PNG/JPEG/GIF/WebP; SVG rejected as a script container;
WebP client-transcoded to PNG) and parses dimensions from the same headers. DOCX preloads
bytes through the authenticated raw route and embeds at the marker with caption, legend,
alt text and bookmark; replacement keeps the figKey (depth-one history, superseded file
unlinked rather than leaked — r2). Deletion is the §1-described soft delete + grace +
sweep.

**§6 demographics.** No parallel field system: a demographics field IS a 116 extraction
field definition, extended by two optional facets (`armLevel`, `statType`) that materialize
only when set. Statistic cells are SLOTS on the same flat row (`xf_age__mean`,
`xf_age__arm_exp__q1`, `xf_<id>__state`), so per-value provenance, 108 undo, autosave,
`computeSyncHash`, the fingerprint ledger and manuscript dependencies all work with zero
new plumbing. The statistic TYPE is stored with the value (a property of what the article
reported); switching type never converts or deletes recorded numbers; `not-reported` /
`not-applicable` / `unclear` live in their own state slot, all distinct from "—" (never
extracted) and never coerced to zero. Arms are a per-project config list with stable ids
mapping onto the existing exp/ctrl model; removing an arm holding values is refused with a
count. `buildStudyCharacteristicsTable` now renders the configured columns (closing the
116 §10.3 gap) with `fieldId`/`armId`/`editable` cell refs; editing a cell from the
manuscript states "This changes the extracted project data, not just this table" and writes
through `applyExtractionWrite` — the same pure applier the extraction engine uses — with
manual provenance, a 108 history entry, a collaborator precondition and an undo executor.

**§7 templates.** New pure registry `templates.js` separates the three concepts §7 names:
reporting STRUCTURE (`draft.structure`, layered over the still-CLOSED `SECTION_TYPES`
core), JOURNAL PROFILE (the existing `templateId` — the five shipped ids always were
profiles), CITATION STYLE (already separate; changing it can no longer touch structure by
construction). `draftSectionTypes(draft)` is the ONE resolver every consumer reads —
orderedSections/citations/docx body order (the second hardcoded literal is gone) cannot
drift. `normalizeDraft` no longer drops unknown sections that hold text — the real blocker
for "never delete content" — and unmapped content survives a switch as a labelled RETAINED
section (or merges opt-in under a `## <original label>` heading marked `userEdited`).
Switching runs through a preview dialog (diff + per-section mapping; cancel writes
nothing) driven by the same pure planner apply consumes; undo is snapshot-backed, taken
inside the SAME `mutateActive` write; snapshots now capture structure/templateId/
citationStyle (absent key = pre-119 snapshot; restore then leaves structure alone).

**§8 logbook.** New append-only `ProjectLogEvent` table (deliberately NOT columns on
`ProjectEvent`, whose read path is membership-scoped and flag-gated — the scientific ledger
stays what it is; the Logbook BRIDGES it at read time). One writer service
(`logbookService.js`, pinned by test — nothing outside `server/logbook/**` touches the
table) with three paths: transactional (`recordLogEventTx` THROWS so a critical mutation
rolls back if it cannot be audited — membership, ownership, project create/delete),
best-effort + bounded in-process outbox, and coalesced 5-minute sessions for the two flood
sources (manuscript autosave, PDF range-request storms). Values pass the provenance
sanitizer; all JSON bounded. The reader unions 5 sources (native + ScreenAuditLog +
ProjectEvent + Extraction/RoB audit) on a total order behind one opaque cursor, with a
mirrored-action cutover so a membership change appears exactly once while pre-119 history
stays intact; filtered pagination is drained per source behind a safe frontier with exact
keyset cursors (§1) and honest `scanIncomplete`/`truncated`/`incomplete` reporting all the
way into the export headers and the `LOGBOOK_EXPORTED` audit row. UI: timeline + table
modes over one shared details component, all §8 filters, member- and engine-focused views
as the same query narrowed, cursor paging, CSV/JSON export, bridged-row honesty labels,
and a third "still searching — keep looking" state distinct from "no matches".

## 4. Database migrations and backfills

All migrations are **additive; there are no destructive migrations and no data rewrites**.
Both schema files (dev SQLite `server/prisma/schema.prisma` + prod mirror
`server/prisma/postgres/schema.prisma`) changed in lockstep (synced via
`scripts/sync-postgres-schema.mjs`; byte-parity pinned by `postgres-schema-sync` +
per-feature schema tests; every new column defaulted/nullable per the non-interactive
`prisma db push` discipline; no FK on audit rows; no `@@unique` added to existing tables).

- **`ScreenDedupEvent`** (new, `dee9099`): per-instance dedup audit rows — project,
  record/canonical/group/batch/run links, closed method+basis vocabulary, auto|manual,
  actor, confidence, reversal/restoration stamps. Audit-only; PRISMA never sums it.
- **`ScreenImportBatch.supersedesBatchId` / `supersededById`** (new columns): the
  force-re-import lineage; superseded batches are excluded from phantom accounting.
- **`ProjectLogEvent`** (new, `43375f8`): the Logbook substrate — dual project identity
  (`projectId` + `metaLabProjectId`), actor snapshot + actorType, engine/action/resource,
  before/after summaries, status, `mirrors`, lowercase `searchText` (SQLite/Postgres search
  parity), 9 indexes for the cursor/member/engine/status/cutover reads.
- **`ManuscriptFigure`** (new, `fd6fb06`): fileName/storedName/fileSize/mime/fileHash/
  uploadedBy/width/height/altText + depth-one replacement history
  (`prevStoredName/prevFileName/prevFileHash/replacedAt/replacedCount`); r2 added
  `deletedAt` (+ `[projectId, deletedAt]` index) for the soft-delete grace window.

**Backfills: none required, by design.** The Logbook is forward-only and gains historical
depth through the read-time bridge (no reconstruction of fields that were never recorded —
a bridged row's role-at-the-time renders blank, not guessed). §7's structure and §5/§6's
config keys follow the repo's byte-stability rule: an absent key IS the migration; legacy
blobs normalize byte-identically (pinned). Every feature degrades cleanly on a deployment
whose Prisma client predates its migration (figures ship dark with `available:false` +
503 writes; logbook writers no-op without aborting the caller's mutation — 10 dedicated
tests). Operational note: other machines need `prisma db push` + `prisma generate`; on the
dev box the running server holds the query-engine DLL, so regenerate with the stack down.

## 5. Major files/components/services changed

**Server (screening/PRISMA):** `screening/dedupCounts.js` + `screening/dedupEvents.js`
(new); `screening/prismaFlowService.js`; `services/screeningImportService.js`;
`services/screeningDuplicateWorker.js`; `pecanSearch/pipeline.js` + `runService.js`;
`controllers/screeningController.js`; `living/livingService.js`;
`publicSynthesis/publicSynthesisService.js`; `src/research-engine/prisma/derive.js`.

**Server (logbook):** `logbook/{vocabulary,logbookService,logbookQuery,logbookAccess,
manuscriptSession,retention}.js` (all new); `controllers/logbookController.js` +
`routes/logbook.js` (new); `realtime/bus.js` (leaders-only emit); `store.js`; writer call
sites in `screeningMemberController`, `screeningController`, `screeningPdfController`,
`importExportController`, `nmaController`, `pecanSearch/runService`.

**Server (figures):** `manuscript/figureStorage.js`, `controllers/
manuscriptFigureController.js`, `routes/manuscriptFigures.js` (all new);
`screening/settings.js` + `controllers/screeningAdminController.js` (allowImageUpload /
maxFigureSizeMb); `index.js` (routes, limiter).

**Manuscript engine (pure):** `research-engine/manuscript/{assets,refTokens,placement,
citations,snapshots,model,tables,sourceHash,exportValidation}.js`;
`research-engine/manuscript/templates.js` (new). **Extraction engine (pure):**
`research-engine/extraction/{demographics,demographicsTable}.js` (new), `fieldCatalog.js`,
`fieldRegistry.js`, `interaction/extractionHistory.js`.

**Manuscript UI:** `richEditor/RichSectionEditor.jsx` + `richEditor/mdDom.js` (Safari
caret, hoist, delete keys, orphan repair, figure blocks); `manuscriptPanels.jsx`;
`ManuscriptToolbar.jsx`; `ManuscriptWorkspace.jsx`; `ManuscriptOverview.jsx`;
`ContinuousView.jsx`; `manuscriptSplit.js` + `PdfSplitPane.jsx` (new);
`StructureSwitcher.jsx` (new); `figureApi.js` (new); `useManuscript.js`;
`export/manuscriptDocx.js` + `export/manuscriptRepro.js`; `manuscriptState.js`.

**Extraction UI:** `DemographicsPanel.jsx` (new), `ProjectFieldsPanel.jsx`,
`ArticleWorkspace.jsx`, `PecanExtractionEngine.jsx`, `workspace/tabs/extractionTabs.jsx`.

**Logbook UI:** `src/features/logbook/**` (8 new files: access/api/format + Page, Filters,
Event, Table). **Nav/shell:** `frontend/stitch/nav/navConfig.js`,
`frontend/stitch/pages/StitchProjectWorkspace.jsx`, `frontend/workspace/projectHelpers.js`,
`workspace/tabs/overviewTabs.jsx`, `Workspace.jsx`,
`research-engine/interaction/projectScopes.js`, `src/shared/access/capabilities.js`.

**Tests:** ~20 new unit files (dedup ×4, logbook ×8+UI, tables/figures/templates/
demographics/pdfSplit) and 6 new e2e specs (`manuscript-tables-119`, `manuscript-pdf-split`,
`manuscript-figures-119`, `manuscript-templates-119`, `extraction/demographics-119`,
`logbook/logbook`), plus `playwright.config.ts` (`webkit-manuscript` project).

## 6. New permissions and security controls

**Logbook — Owner/Leader only, enforced at all seven layers §8 names**, each with
direct-resource tests for every other role (reviewer/contributor/viewer/screener):

1. **Navigation visibility** — the single Project Control entry is gated on the new
   `viewLogbook` capability (`leader_only`, no `perm` escape hatch); non-leaders see no
   item at all, not a disabled one.
2. **Route guards** — `requireProjectLeader` on every path of the read-only router (a test
   pins that no write route can ever be added).
3. **API authorization** — per-handler re-resolution of leadership; 404 hides existence
   for strangers, 403 for members; neither response carries a single event. Site admins
   deliberately get NO implicit bypass (the client mirrors this: `isAdmin` pinned false so
   nobody is shown a door the API slams).
4. **Query scoping** — every query built from the resolved access scope, never
   `req.params`; cross-project isolation pinned.
5. **Export authorization** — separate `exportLogbook` gate; every export writes a
   `LOGBOOK_EXPORTED` audit row carrying the truncated/incomplete flags; CSV neutralises
   spreadsheet formula injection (leading `= + - @` prefixed).
6. **Real-time subscriptions** — `bus.emitToProjectLeaders()` filters recipients by role
   at emit time.
7. **Access events** — Logbook views, exports and denied attempts are themselves logged
   (denied attempts only when a project scope was resolved — a stranger's 404 is never a
   write path into an arbitrary project's log).

Additional: `/api/logbook` rate-limited; audit rows immutable (append-only, no edit/delete
surface); no secrets can land in rows (provenance sanitizer + bounded JSON, pinned by a
test that tries to store a token).

**Figures:** every route behind `resolveExtractionAccess` (canView → read, canEdit →
write; 404 non-members); admin kill-switch `allowImageUpload` + `maxFigureSizeMb`
(the `allowPdfUpload` precedent); server-side magic-byte sniffing (never extensions), SVG
rejected outright as a script container, dimensions parsed from the same headers;
`isSafeStoredName` path guard; raw route streams with ETag-from-fileHash + 304 + nosniff;
upload/replace/update/delete audited through the logbook vocabulary
(FIGURE_UPLOADED/REPLACED/UPDATED/DELETED, FILE_DOWNLOADED). CSP unchanged (img-src
already `'self' data: blob:`; same-origin authenticated streaming is the zero-CSP-delta
choice).

**PDF split:** no new endpoints and no new permissions — deliberately a pure client-side
consumer of the already-authorized screening/study-doc binary routes (membership → 404,
ETag private, inline CSP framing), `canManage={false}` read semantics preserved.

## 7. New templates and their authoritative sources

Ten reporting STRUCTURES ship in `src/research-engine/manuscript/templates.js`, each
recording its guideline, version, `reviewedAt` (August 2026, at implementation) and source
URL, each with per-section guidance drawn from that guideline's own checklist. They are
genuinely different shapes, not themes: **generic IMRAD · PRISMA 2020 · PRISMA-NMA ·
PRISMA-ScR · CONSORT 2025 · STROBE · STARD 2015 · CARE · SRQR · PRISMA-P (protocol)** —
CARE has no Methods/Results, PRISMA-P has no Results/Discussion, CONSORT 2025 carries
Harms and Open science, PRISMA-NMA carries Network geometry. Honesty notes recorded in the
registry itself: PRISMA-ScR shares PRISMA 2020's top-level section set (the real
differences are checklist/guidance-level — stated in its note); SRQR promotes reflexivity
to a top-level section as an authoring aid, a documented departure from the checklist's
nesting.

Journal PROFILES were enriched, never invented — no new ids (a stored id that stopped
resolving would silently mutate drafts). `JOURNAL_PROFILE_META` adds publisher, source,
`lastReviewedAt`, version, and per-FIELD `verified` vs `needsUserVerification` lists,
surfaced in the UI with the no-compliance-claim note: **JAMA** was verified against
jamanetwork.com's live author instructions (350-word SR abstract, 3,000-word text, Key
Points required, Data Sharing Statement required, AMA Manual of Style). **The Lancet**
(instructions PDF returned HTTP 403) and **BMJ** (author page unreachable at review time)
claim NOTHING verified — every field is listed under needsUserVerification with a
`reviewNote` saying the instructions could not be read (the Lancet note also records a
public-secondary-source discrepancy on abstract length). **Cochrane** is explicitly
labelled a formatting aid, not MECIR compliance. No template anywhere claims guaranteed
submission compliance.

## 8. Browser and device testing completed

- **Chromium (Playwright):** the full manuscript e2e suite grew 44 → 73 specs across the
  waves; final fix-round run: **manuscript + logbook 76/76 green** (`--workers=1`, live
  dev stack). Screening (`importHistoryReset` 2/2), permissions (10/1 skip), extraction
  demographics (2/2), focus (8) exercised in their waves.
- **WebKit (Playwright):** a NEW `webkit-manuscript` project runs the full table specs
  (117's Safari gap was structural — webkit was @smoke-only) and, after the fix round, the
  figures spec too: final run **15 passed / 3 documented skips** (each skip annotated
  in-spec with its reason; the Playwright-WebKit clipboard gap is a harness limitation,
  not an app one). The §2 investigation additionally reproduced the title/insert/delete
  behaviours on an isolated harness in chromium, webkit AND firefox before any fix.
- **Responsive:** the split workspace's stacked one-pane-at-a-time degrade below ~1024px
  is e2e-tested (both panes reachable, split returns when wide); the manuscript toolbar's
  four density tiers already adapt inside a ~50% pane.
- **Not run:** a full Firefox pass of the new features (Firefox coverage was
  investigation-harness only); real desktop Safari (see §10); physical mobile devices.

**The honest caveat §10 of the prompt demands:** Playwright WebKit is a PROXY for Safari,
not proof of it. This machine has no macOS and no real Safari; the prompt's "manually
validate in Safari when a real Safari environment is available" remains open, and one r2
finding was declined precisely because it needs that hardware. The WebKit engine coverage
is real and did catch real engine-specific defects (empty-island caret, figure-removal
chip loss, selection-drop on focus change) — but a human real-Safari pass has not
happened.

## 9. Automated test results

Final state after the r2 fix round (every requested suite re-run):

- **Unit: 585 files / 11,729 tests — all green.** (Baseline before 119: 559 files /
  11,139. Net +26 files / +590 tests; every wave ran the FULL suite green before its
  commit: 562/11,178 → 564/11,234 → 569/11,317 → 573/11,456 → 574/11,458 → 569/11,330 on
  the wave-I branch point → 585/11,729 final.)
- **e2e chromium: manuscript + logbook 76/76 green** (`--workers=1`, live stack).
- **e2e webkit-manuscript: 15 passed / 3 documented skips.**
- **Lint** clean on every touched path; **production build** (`npm run build`) clean in
  the waves that touched the bundle — vite build + 34/34 prerendered pages, CSP
  inline-script guard byte-identical.
- **Live repros as tests:** the §1 numbers (below) are pinned in unit fixtures; the
  logbook pagination fix was additionally proven against the real dev SQLite with a
  self-cleaning in-process repro (403 seeded rows; pre-fix shape returns 0 events and
  lies, fixed reader returns all matches over honest pages; cleanup verified).

**Outstanding failures — environmental, proven, not 119:** `e2e/projects` +
`e2e/extraction` fail (16 tests) because the dashboard hangs on "Loading your
workspace…". Root cause proven by measurement: `GET /api/projects?includeArchived=1`
takes **11–16 s** because `store.getAll` fetches every project's full `data` blob and the
dev DB holds **11,278 live projects — 9,662 of them leaked "E2E …" rows** from the e2e
harness itself; every other endpoint answers in 5–40 ms, and nothing in the eleven 119
commits touches that path (verified per-commit). Three independent agents bisected these
same failures mid-flight (reverting their changes reproduced them identically). The fix is
operational (purge the leaked rows; slim the listing query) and is recorded in §12 rather
than waved off.

## 10. Manual QA results — and real Safari, honestly

Manual QA was performed by the implementing/reviewing agents driving the live app (Vite +
API on :3000/:3001), not by a human, and **no real-Safari pass has occurred** — this
machine has no macOS. Recording what the live-app driving actually caught, because these
were found by watching the product rather than by unit tests: the split workspace's
measured pane widths and remount-free editor (verified with an out-of-React DOM probe);
the stale-editor defect where a structure merge or snapshot restore left pre-change text
mounted and the next keystroke committed it back (found in the browser, fixed with the
`contentEpoch` mount key — this also repaired a pre-existing silent-revert on snapshot
restore); the demographics manuscript cell editor leaking the previous cell's draft state
(fixed by keying per column+study); the figure-removal confirmation copy claiming
references would break when they in fact keep resolving (copy rewritten after the e2e
disproved it); the derived-reference `authorsList`/`authors` mismatch that made the §4
author search match nothing.

Safari specifically: everything Safari-related was validated in Playwright WebKit only
(§8). The prompt's requirement to manually validate the table-title input and editor
selection in real Safari **when a real Safari environment is available** is explicitly
deferred, is listed in §12, and was the stated reason one r2 finding was declined rather
than claimed fixed. No claim of real-Safari compatibility is made anywhere in-product or
in this report.

## 11. PRISMA reconciliation examples — before and after

- **Instance counting (was already correct; now regression-pinned).** RIS import with 3
  identical copies + 1 unique record → `identified: 4`, `duplicatesRemoved: 2` (3 copies
  → 1 kept + 2 instances removed, never "1 group"). Unchanged by 119; pinned so it stays
  true.
- **Force re-import (the live-reproduced defect).** BEFORE: force re-uploading the same
  file made `identified` 4→8 and `duplicatesRemoved` 2→6, permanently — each forced batch
  added its phantom counts forever. AFTER: stable **4/2 across repeated forces** (the
  repeat batch is superseded and excluded); a genuinely different overlapping database
  export (different hash) still adds its instances, as PRISMA 2020 requires.
- **Automated search (the headline §1 defect).** BEFORE: a pecan run whose sources
  recorded engine-level exact/fuzzy duplicates showed them NOWHERE on GET `/prisma` — the
  PRISMA page, the manuscript diagram and the DOCX export all under-reported *records
  identified* and *duplicates removed* by exactDup+fuzzyDup, while the dashboard summary
  included them (two surfaces, two answers, one project). AFTER: the flow credits them as
  per-arm phantoms labelled "Removed during automated search (not stored as records)", and
  a controller-level parity harness pins **GET `/prisma` == `getMetaLabSummary`** on the
  five fixtures where they used to disagree. Living digest and public synthesis delegate
  to the same primitives.
- **Confirm / restore round-trip (no double counting).** An auto-detected group takes
  `duplicatesRemoved` 2→3; a later human CONFIRM keeps it at 3 (not 4); keep-all restores
  the records and returns the count, stamping the audit events reversed and appending a
  restoration row.
- **Structural reconciliation** (identities: identified and removed move together;
  `removedBreakdown` partitions the removed box exactly) holds across all 59 new §1
  fixtures — including the fixture class that proves the ORIGINAL loss was invisible to
  reconciliation (the identities derived from the same incomplete inputs), which is why a
  parity check across consumers now exists as well.

## 12. Known limitations and deliberately deferred items

**Environment / operations**
- The dev DB's 9,662 leaked "E2E …" projects (of 11,278) make `store.getAll` listing take
  11–16 s and fail `e2e/projects` + `e2e/extraction` (16 tests). Needs an ops cleanup AND
  a listing query that stops fetching full blobs; also worth an e2e-harness teardown fix.
- The r2 fix round is uncommitted; the v4.27.0 bump/push and the memory-file update are
  the remaining release steps. Other machines must `prisma db push` + `prisma generate`.

**§2/§5 editor, WebKit**
- OPEN (top §2 follow-up): deleting a table that IS cited — so the confirmation dialog
  stands between command and document — still leaves the caption under WebKit
  (`test.fixme`, fully diagnosed in-spec; Chromium enforced green).
- Pre-existing, both engines: a table that is a section's ONLY content cannot be restored
  by native undo after deletion (identical via the menu command; documented in-spec).
- Read-only sections: the caption title span is still `contenteditable` in the DOM
  (nothing persists — emit is guarded — but the caret can enter it).
- Chrome sometimes wraps an inserted figure in a `<div>` (cosmetic position offset;
  round-trip, numbering and undo unaffected).
- `repairCaptionIslands` runs per emit (selector scan per keystroke batch; measurable only
  with very many tables in one section).
- `draft.tableMeta` entries for permanently deleted tables persist (inert; a future
  compaction could reap unclaimed ids). No server-side GC for uploaded-but-never-placed
  figures (deliberate — delete-only-when-unreferenced doctrine — but unused images
  accumulate until deleted in the panel).

**§3** — a researcher who always used Section View but never touched the switcher has no
stored preference and WILL open in Continuous View (exactly what §3 asks; visible change
worth a release note).

**§4 split workspace**
- Per-PDF page/zoom/rotation/search/scroll survive article switches (keep-alive pool) but
  reset on RELOAD — `AppPdfViewer` has no controlled-state seam yet (the additive
  `initialViewState`/`onStateChange` props are the named follow-up). Ratio, article and
  open state do survive reload.
- Focus Mode coupling: opening PDF view maximises the window via the 114 fullscreen
  bridge; Escape exits Focus Mode while the split stays open. Worth a product decision.
- Study-document branch renders without the annotation layer and has no e2e fixture;
  selecting a blob-only study fires one soft-failing studyDocApi request; first open
  resolves availability for the whole included set (N cached requests on large reviews).
- The citation chip's "Open PDF" still opens the legacy modal alongside the split pane.

**§6 demographics** — grouped column headers render flat (one header row) in the
manuscript/Word table; per-project table config exists but cross-project "Table 1
templates" do not; dual-extraction conflict handling is inherited from the existing
extraction model, not extended.

**§7 templates** — no bespoke user-minted sections (rename/reorder + preserved sections
only); Lancet/BMJ profiles unverified (403/unreachable — claims nothing, says so) and
Cochrane is a formatting aid; the templates e2e ran chromium-only.

**§1 dedup** — an unconfirmed worker SUGGESTION still counts as removed the moment it is
flagged (unchanged live behaviour; it is exactly what makes "confirm must not re-count"
hold; the audit trail now distinguishes worker-suggestion from human-confirm, so a
confirmed-only reporting mode is a small follow-up). Deleting a single pecan page batch
still leaves the run's engine counters (correct remedy is blocking per-batch deletion in
favour of run rollback — a UX change beyond §1). `BASE_RECORD_SELECT` still omits
`removedBeforeScreening/removedReason` (dead projection categories, documented). Metadata
"fill-blank" merges write no dedup event (they are not removals — intentional).

**§8 logbook**
- The best-effort outbox is in-process: a crash between mutation and retry loses that row
  (the critical set — membership/ownership/create/delete — uses transactions instead;
  stated, not hidden). Manuscript sessions attach to `captureProvenance`, so a project's
  first-ever save produces no edit-session row. Browser-side pooled meta-analysis runs are
  structurally unobservable server-side (client compute; a client-writable audit endpoint
  would be forgeable — NMA, the server-side analysis, is covered).
- ScreenAuditLog's prefix action families and free-text search stay in-memory filters, so
  a deep legacy history under a selective filter can hit the scan bound — the reader now
  SAYS so (`scanIncomplete` + "Keep looking") instead of lying, but a leader may click
  several times. CSV exports cannot carry the incomplete flag (the JSON header and the
  audit row do). Facet counts come from 2 of 5 sources; no resourceTypes facet. The UI
  polls on Refresh rather than consuming the leaders-only SSE emit; filters are
  single-choice per dimension; no jump-to-date. Retention is implemented + documented but
  deliberately NOT scheduled (operator decision on a single-process SQLite deployment).

**Cross-cutting** — real-Safari manual validation (hardware-gated; the one r2 finding
declined for that reason); full Firefox e2e; physical mobile devices.

## 13. Regression confirmation

Confirmed against the prompt's preserve list, with the evidence named:

- **Full unit suite green at every stage and at the end** (585 files / 11,729 — §9),
  including every pre-119 pinned suite: byte-stability/normalization pins (legacy blobs
  serialize byte-identically under §5/§6/§7's new keys — pinned per feature), the 116
  loader select-shape pins, the 117 table-object contracts, the 118 toolbar/view
  contracts, provenance/undo suites, and export/docx suites.
- **Manuscript + logbook e2e 76/76** on the live stack; `webkit-manuscript` green
  (15/3 skips); screening import/reset and manuscript-PRISMA-sync e2e green in-wave.
  Autosave, refresh persistence, undo/redo, citations, cross-references, both views and
  DOCX export are all exercised by those suites against real browsers.
- **Autosave/cursor/undo preserved structurally**, not just empirically: the split
  workspace never remounts the editor (DOM-probe-proven), figures/tables ride the native
  undo stack via the selection→execCommand path, demographics edits ride the extraction
  write path's existing history, and template switches snapshot inside the same write.
- **PRISMA:** counts change ONLY where the defect was (engine dups + force re-imports);
  instance counting, restoration, batch delete, reset, re-runs and living updates are
  pinned unchanged; consumer parity is now itself a regression test.
- **Existing PDFs and document associations untouched** (no new attachment model; split
  workspace is read-only over existing routes; e2e pins the attachment count is unchanged
  after opening a PDF in the split).
- **Deliberate re-pins — every one enumerated, none loosened:** the §3 default flip
  (`continuousView118` default/fallback/navConfig source-string pins, byte-exact on the
  new rule; e2e default + URL-walk assertions, five specs now naming `&msv=sections`
  because they drive the single-section editor); the r2 history-entry URL change (two e2e
  assertions re-pinned with in-file reasoning — a session-pushed entry now names its
  view); the 118 mount-key pin gaining `contentEpoch` (closes a real data-loss path, and
  incidentally a pre-existing snapshot-restore revert); two source-string pins in
  `tables119` for `hoistInsertionPoint`'s options argument (behaviour unchanged). One
  select-shape pin was EXTENDED (never changed) for `supersedesBatchId`. No golden or
  byte-stability output was re-pinned anywhere in 119.
- The only red anywhere is the 16 environmental e2e failures whose cause is proven to be
  the dev database's leaked e2e rows, not any 119 commit (§9) — investigated and
  documented rather than ignored, per the prompt's own rule.
