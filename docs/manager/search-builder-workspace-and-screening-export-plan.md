# 97.md Phase 1 plan — Search Builder Boolean workspace + Portable Screening export

Date: 2026-08-02 · Baseline: v4.3.0, post-96.md (commits 847f6f4/94f8657) · Author: senior coordinating agent
Status: **APPROVED for implementation** (this document is the plan 97.md Phase 1 requires; it was reviewed against three independent investigation reports covering export infrastructure, builder gaps, and the test baseline).

Companion documents: `docs/search-overhaul-96.md` (architecture this plan builds on),
`docs/manager/search-builder-pico-sync-root-cause.md`, `docs/manager/search-builder-state-model.md`.

---

## 0. Non-negotiable invariants inherited from 96 (restated; every workstream must honor these)

1. **putSearch whitelist + byte-stable signatures.** `putSearch` (server/searchEngine/searchEngineController.js:215-260) patches *named keys only*: `concepts, overrides, ignored, databases(≤40), readyForScreening, dismissedWarnings(≤200), filters, searchMode, rejectedSuggestions, questionSnapshot`. Every NEW top-level persisted key requires **six touch points** or it is silently dropped / breaks byte-stability: (a) putSearch branch + sanitizer, (b) `pickPersisted` entry with **omit-when-empty** (searchState.js:288-309), (c) inclusion in `serializeSearchState` signature, (d) `applyRemote` line (SearchBuilderTab.jsx:1036-1053), (e) load-effect line (:925-947), (f) pinned omit-when-empty tests. Omit-when-empty must hold, or every pre-97 project autosaves spuriously on open and pokes collaborators.
2. **Additive-only schema.** No destructive Prisma migrations; new columns defaulted/nullable; no new uniques on existing tables. SQLite dev via `prisma db push`; committed Postgres migration via `prisma migrate diff`.
3. **Term-liveness adopters.** `isLiveTerm` (tests/unit/searchTermLiveness.test.js) is the single rule adopted by compilers, quality checks, methods text, version hash, and the pecan AST (`normalizeCanonical`). New term flags (`intentionallyDuplicated`, `components`, `dupOverride`) must not change liveness semantics.
4. **Stage triple.** `src/features/searchWorkspace/searchStages.js` is the single source of truth; `navConfigSearchSubmenu.test.js` pins side-menu === `stagesFor(mode)`; `searchStageStatus.test.js` pins `STAGE_IDS` sync. Stage **ids never change** (`STAGE_ALIASES concepts/refine→terms`, deep links); only labels may.
5. **Legacy shapes load forever.** Legacy PICO groups (`picoField`, `source:'pico_auto'`), id-less entries, string[] `ignored`, Concepts-era shapes all load byte-stably (tests/unit/searchMigrationFixtures.test.js — 8 archetypes × 4 seams). Migration must be idempotent and preserve `picoField` (drift exemption searchState.js:648, empty-group exemption crossConcept.js:108, Time-frame rendering, `rejectionKey` scoping all key off it).
6. **Frozen legacy export contract.** `EXPORT_COLUMNS` (screeningExportService.js:41-44) is append-only and position-pinned (tests/screening/integration/export-columns.test.js). The ZIP CSV is a **new file with its own schema**; the legacy CSV is never mutated.
7. **Persisted duplicate/rejection keys are stable.** `rejectionKey` and `dismissedWarnings` ids embed the family-based `termEquivalenceKey`; that function is never altered — new normalizers are **added alongside**.
8. **Hermetic CI gate.** `npm run test:ci` (tests/unit + tests/screening/unit) = 380 files / 5,700 tests, verified green 2026-08-02 in 58s. House style: `renderToStaticMarkup`, no jsdom, no @testing-library, effects never run; all logic extracted into exported pure functions. No live external calls; NLM stays behind `server/searchEngine/nlmClient.js`.

---

## 1. Current Screening export behavior

- **A full sync + async export pipeline already exists** (62.md era). Sync: `GET /api/screening/projects/:pid/export?format=csv|json|ris&filter=...` (screeningController.js:1392-1493). Above `EXPORT_SYNC_MAX=5000` records the route answers **413 `{useAsync:true, startUrl}`** and the client falls back to the async job: `POST .../export/start` (202+jobId) → poll `GET .../export/jobs/:jobId` → `GET .../download` (screeningController.js:1517-1616; routes server/routes/screening.js:141-144).
- **Durable worker**: `server/services/screeningExportWorker.js` — atomic claim, heartbeat, crash recovery (`server/utils/jobRetry.js`), 24h TTL reaping, files in `SCREEN_EXPORT_DIR || server/storage/exports`. `makeFileSink` (:55) forces `encoding:'utf8'` (text-only — must become binary-safe for ZIP). Enqueue dedupes queued/processing jobs by (project,user,format,filter). Job artifacts are **creator-only** (poll/download 404 for anyone else, :1563/:1596) because rows carry the creator's personal "my decision" columns.
- **Permission chain** (all reusable, in order): `getProjectAccess` outsider→404 → `canExportRecords`/leader/owner else 403 → admin toggle `allowExport` → tier boolean `screening.export` → master gate `requireProjectExport(EXPORT_TYPES.SCREENING_RECORDS)` with monthly allowance (reserve→settle `ProjectExportUsage` ledger; async reservation settled 'succeeded' at enqueue — a submitted async export counts even if it later fails, documented policy). `gateExport` re-checks on every poll/download without consuming allowance.
- **Row mapping** is centralized in `server/services/screeningExportService.js`: `EXPORT_COLUMNS` (12 legacy + AI CV + review columns incl. per-reviewer families ×6), `buildExportRow`, `buildExportContext` (blind-mode identity rule), `renderRisBlock` (the only RIS writer: TY/TI/AU/JO/PY/DO/AN/AB/ER), `streamExportToSink` (cursor-paged PAGE=1000, bounded memory).
- **Known deficiencies vs 97.md**: the `json` format is a **flat array of the same CSV rows** — exactly the misleading flattened "backup" 97.md forbids; filenames are `sift-export-<pid8>.<ext>`, not the project-title convention; RIS omits KW/VL/IS/SP/UR; full-text/final status, workflow stage, handoff status, conflict rows are absent; **no export is audited** (only UsageEvent + ledger; `writeAudit` exists at server/screening/access.js:152 but is never called on export paths); no ZIP, no README, no partial-failure semantics.
- **UI**: `src/frontend/screening/tabs/ExportTab.jsx` ("Export Data", filter radio, shared `ExportDialog` with CSV/JSON/RIS, sync→413→async fallback, 1.2s polling; client API `screeningApi.js:81-90`). Mounted in both `TABS` and `EMBEDDED_TABS` of `SiftProject.jsx`.

## 2. Current Screening data available for export

- **ScreenRecord** (schema.prisma:632-688): title, authors ("; "-joined), year, journal, doi, pmid, abstract, keywords, sourceDb, rawData (JSON **truncated `.slice(0,2000)`** — may be invalid JSON), isDuplicate/isPrimary/duplicateGroupId, currentStage (`title_abstract|full_text`), finalStatus (`''|accepted|rejected`), promotedAt/promotedVia, acceptedAt, rejectedReason, handoffStatus (`''|pending|sent|failed|already_exists`), handoffAt/handoffStudyId/handoffError, createdAt (≈import date), importBatchId. **No volume/issue/pages/URL columns** — those live only in truncated rawData or authoritatively in `PecanSourceRecord` (schema:1594; + pmcid, nctId, meshTerms, language, pubType) joinable via `ScreenRecordSource` for pecan-imported records (`toScreeningRecord`, server/pecanSearch/normalize.js:148, drops them at landing).
- **ScreenDecision** (schema:690): stage-scoped, unique(recordId,reviewerId,stage); decision/exclusionReason/notes/rating/labels/reviewerName/createdAt/updatedAt — covers all 97.md reviewer fields.
- **ScreenConflict** (schema:764): reviewerDecisions JSON, finalDecision, resolvedBy, resolvedAt, notes — **not in any current export**; consensus otherwise computed via `consensusState(taDecisions, requiredReviewers)` (src/research-engine/screening/conflicts.js:71).
- **Duplicates**: record flags + `ScreenDuplicateGroup`/`ScreenDuplicateLabel`.
- **Catalogs**: `ScreenExclusionReason` (project reason catalog, schema:721), `ScreenLabel` (schema:712).
- **Provenance**: `ScreenImportBatch` (filename/format/source/searchRunId/importedByName/createdAt), `ScreenRecordSource` (post-96 only), `ScreenRecordMetadataChange`.
- **Eligibility** (optional richness): `EligibilityAssessment`/`EligibilityCriterion` (schema:2206-2268) with engine/config/criteria version provenance.
- **Project metadata**: `ScreenProject.title/blindMode/requiredScreeningReviewers`; app version `getVersion()` (server/version.js → PecanRev 4.3.0 + commit); screening engine version `getEngine('screening')` (server/engineVersion/engineVersionService.js).
- **Reviewer-identity rule** (reuse verbatim, never duplicate): `buildExportContext` — `canSeeIdentity = !project.blindMode || isLeader`; blind + non-leader → "Reviewer N" ordinals AND blanked record authors/journal (86.md P1.1). Pinned by tests/unit/screening/exportBlind.test.js + export-columns.test.js.
- **Known trap**: `buildExportRow`'s "my decision" uses `decisions.find(d => d.reviewerId===userId)` with **no stage filter** — ambiguous for dual-stage reviewers. The new CSV is stage-explicit and does not inherit this.

### 2b. Proposed Screening export architecture (decisions)

**Decision E1 — reuse the ScreenExportJob worker; ZIP is always an async job.** The existing job infra (atomic claim, heartbeat, recovery, TTL, dedupe, creator-only download, gateExport) is exactly the "background job infrastructure already present" 97.md tells us to reuse. The ZIP is added as `format:'zip'` (the String column is unconstrained — additive). No sync ZIP path: even small projects go through the job (uniform code path; the UI polls exactly as it already does for over-cap CSV). The legacy sync GET for csv/json/ris is untouched.

**Decision E2 — zero-dependency ZIP writer, ported server-side, with raw-DEFLATE.** No server ZIP library exists and repo convention explicitly prefers the hand-rolled STORE writer (`zipFiles` + CRC-32, src/frontend/components/exportCore.js:120-192) over adding jszip. Port it to **`server/utils/zip.js`** as a Buffer-emitting builder (`createZipBuilder()` → `addEntry(name, buffer)`/`finalize()` streaming Buffers to the sink), and extend it with **method-8 raw DEFLATE via `node:zlib.deflateRawSync`** per entry (abstract-heavy CSV/JSON at STORE would produce very large downloads; deflate is a ~30-line extension with its own unit tests, still zero deps). Client `exportCore.js` stays untouched. jszip remains a devDependency used only by tests to **read** produced zips.

**Decision E3 — new CSV `references-and-screening-decisions.csv` with its own documented v1 schema** (frozen legacy EXPORT_COLUMNS untouched). Columns (documented in README and in a `SCREEN_ZIP_CSV_COLUMNS` append-only array with its own pinning test): `record_id, title, abstract, authors, journal, year, volume, issue, pages, doi, pmid, url, other_identifiers, keywords, source_database, imported_from, import_date, is_duplicate, is_primary, duplicate_group_id, current_stage, title_abstract_status, full_text_status, final_status, exclusion_reason, promoted_at, accepted_at, handoff_status, handoff_at, conflict_status, consensus_or_final_decision, notes` + per-reviewer families **stage-explicit**: `reviewer_N_name, reviewer_N_ta_decision, reviewer_N_ta_decided_at, reviewer_N_ft_decision, reviewer_N_ft_decided_at, reviewer_N_note` (cap 6, blind-gated ordinals via `buildExportContext`). volume/issue/pages/url/other_identifiers come from a per-record **best-effort** resolver: PecanSourceRecord join where provenance exists, else try/catch `JSON.parse(rawData)` — a bad record yields blanks, never a failed export (97.md missing-optional-metadata rule). Reuse `server/utils/csv.js` (RFC-4180 + CWE-1236 formula guard). No nested objects in cells; `other_identifiers` is a documented `key:value; key:value` serialization.
**Decision E4 — structured `screening-backup.json`, streamed per-table.** Shape: `{ schemaVersion: "1", exportedAt, exportedBy:{id,name}, app:{name,version,commit}, engines:{screening}, project:{id,title,blindMode,requiredScreeningReviewers,createdAt}, exclusionReasons:[...], labels:[...], records:[...], decisions:[...], conflicts:[...], duplicateGroups:[...], importBatches:[...], eligibility?:{criteria,assessments} }`. Written by a streaming serializer (array-by-array, cursor-paged like `streamExportToSink` — never a whole-project `JSON.stringify`). **Blind-mode rule applies identically**: with `!canSeeIdentity`, reviewer ids are replaced by stable ordinals ("reviewer-1"), reviewerName by "Reviewer 1", record authors/journal blanked, and ScreenConflict.reviewerDecisions keys re-mapped through the same ordinal map — this is the top leak vector and gets dedicated tests. No reviewer cap in the backup (it is a backup). `restorable: true` intent documented; restore workflow itself is future work.
**Decision E5 — RIS: new writer function, legacy untouched.** `renderRisRecord(r, extras)` (new, in a new `server/services/screeningExportZip.js`) emits TY/TI/AU/JO/PY/VL/IS/SP/EP/DO/AN(pmid)/UR/AB/KW where available (extras from the same best-effort resolver as E3); blind blanking of AU/JO reused. Screening state never enters RIS tags. The legacy `renderRisBlock` and its pinned tests are untouched (legacy sync `ris` format keeps using it). **BibTeX: deferred** — no writer exists anywhere in the repo (parsers are import-only); 97.md makes it optional ("when it can be added safely"); documented as a deferred improvement rather than net-new risk in this overhaul.
**Decision E6 — README.txt + EXPORT-WARNINGS.txt + partial failure.** README generated per project: project name, export date, file-by-file explanation (CSV = human-readable citations + decisions; RIS = reference-manager citations; JSON = complete PecanRev backup), explicit "not every third-party application preserves PecanRev-specific fields" disclaimer, versions, schema version, and any failed optional format. Member generation is per-file try/catch: CSV + JSON + README are **core** (any core failure ⇒ job `failed` with actionable error); RIS is **optional** (failure ⇒ ZIP still produced + `EXPORT-WARNINGS.txt` + warning surfaced non-blockingly in UI). ScreenExportJob gets additive columns `warningCount Int @default(0)` + `warnings String?` (JSON array of messages), mirroring the ScreenImportJob precedent; status stays `completed`.
**Decision E7 — filename + sanitizer.** New `server/utils/filenames.js` `safeFilePart(s, fallback)` (port of exportCore.js:195-199 semantics: lowercase, non-alnum→'-', collapse, trim, cap 60 — cross-OS safe). Filename: `${safeFilePart(project.title,'project')}-screening-export-YYYY-MM-DD.zip`, set on job.filename and Content-Disposition. Server never imports from `src/frontend/**` (layering rule).
**Decision E8 — gating, audit, policy.** Reuse `EXPORT_TYPES.SCREENING_RECORDS` (no new type), the full permission chain, and creator-only job artifacts (kept: a plain member with canExportRecords already sees other reviewers' names in non-blind projects in the legacy CSV; the ZIP matches that surface, and blind mode remains the identity-protection mechanism). Reservation-at-enqueue policy kept for consistency (documented: a failed ZIP job consumes allowance; revisit refunding only if support burden appears). Add `writeAudit(projectId, actor, 'SCREENING_EXPORTED', {details:{format, filter, records, warnings}})` on sync export success and on ZIP job completion.
**Decision E9 — binary-safe sink, scoped.** `makeFileSink` drops `encoding:'utf8'` **only for `format==='zip'`** (Buffer chunks pass through untouched; text formats unchanged). Export files remain single-node local disk, 24h TTL, blanked resultPath after reaping (download 410) — the ZIP inherits this documented limitation (multi-instance deployments need shared `SCREEN_EXPORT_DIR`).
**Decision E10 — UI.** ExportTab gains the headline action "Download screening file (ZIP)" with researcher-facing copy explaining the three format categories, plus the existing per-format buttons retained. Non-blocking warning banner when the completed job has `warningCount > 0`. Copy avoids internal jargon ("Export references and decisions", "Complete screening backup").

## 3. Current Search Builder behavior

Post-96, the Search workspace is: **Research Question → Terms & Vocabulary → Search Mode → (Database Strategies) → Run Externally → Documentation → Send to Screening**. Terms & Vocabulary is the single building surface: question token/span phrase selection creates concept groups; groups support rename/reorder/merge/split/delete (all undoable, button-driven); per-term structured vocab (MeSH lookup via server boundary); per-database previews with live counts; manual per-database overrides with EDITED badge + revert; versions panel; drift banner (informational only). Suggestions include the compliant one-MeSH accept **and** the non-compliant `synonyms` bulk-accept + "Accept all N subject headings" (97 Phase 13 targets). An inline card still **labeled "Search Quality Check"** renders in the workspace (SearchBuilderTab.jsx:1786-1814) with severity glyphs + `sensitivitySignal` broad/narrow badge (97 Phase 7 target). There is **no drag-and-drop anywhere, no Regenerate action, no global Ctrl/Cmd+Z** (undo is snackbar-button only), and cross-group term move exists only as a popover menu action with three defects (§5/§12).

## 4. Current Search Builder data structure

One authoritative structured document per project: WorkflowModuleState `search` = `{ concepts:[{id, label, sourcePhrase?, op, picoField?, terms:[{id, text, normalizedLabel?, type, field, source, phrase?, truncate?, noExplode?, disabled?, kept?, vocab?{mesh,meshUI,tree,emtree,synonyms≤40,scope,children,source}}]}], overrides{dbId}, ignored, databases, dismissedWarnings, filters, rejectedSuggestions, questionSnapshot, searchMode, readyForScreening }` + server `revision`/`updatedAt`/`updatedBy` and `WorkflowStateAudit` rows per save. Array order **is** order (no explicit order fields — fine per 97 Phase 15 "adapt conventions"). Snapshots: `SearchStrategyVersion` freezes the full module state including overrides (searchVersionService.js:113-157), restorable, audited, diffable. Missing vs 97's illustrative model: `intentionallyDuplicated`, generation/modification metadata, schema/conversion marker, phrase-component history — all addressed in §7/§8.

## 5. Root cause of silent regeneration and manual-work overwriting — **already fixed by 96** (evidence)

97.md asks for the exact root cause. It was the SE2-era "auto-sync the five groups whenever PICO changes" effect calling `syncSearchBuilderFromPico` on mount and on PICO edits. **96 removed every production call site**:

- `syncSearchBuilderFromPico` still exists in searchState.js:105 but is kept only "for legacy tests and historical-state understanding" (comment :474-481). Exhaustive grep: callers are only `searchBuilderBenchmark.js:7,36` (offline benchmark) and `tests/unit/searchState.test.js`. **Zero production callers.**
- SearchBuilderTab.jsx:1026-1029 marks the retired effect's former location: "Question edits never mutate concept groups."
- Seeding happens **only at revision 0**: the load effect (:922-958) adopts saved docs as-is; a null GET (server revision ≤ 0) seeds **empty** via `seedStateFromQuestion` — no scaffold groups, no extraction at seed.
- The builder reads **only the research question** (:798-803); PICO P/I/C/O/T fields are never read, so PICO edits cannot touch the workspace.
- Drift is informational-only and undoable (`conceptDrift` + `QuestionDriftBanner`), with legacy `picoField` groups exempt — already 97-Phase-3 compliant.

**Remaining Phase-3 gaps are metadata-only**: no `generatedAt/generatedBy/manuallyModifiedAt/By/sourceQuestionVersion` markers (drift tracks the question text snapshot only; no PICO-version tracking exists). Addressed by the `meta` key (§8). One live data-loss bug in the adjacent area: `moveTerm` (SearchBuilderTab.jsx:1666-1679) records no undo entry, rewrites `source:'user_added'`, and **silently deletes the term when the target group already holds the same normalized text** (:1671) — fixed in §12.

## 6. Current autosave and persistence behavior

800ms debounce + unmount flush + Retry + honest SaveStatusIndicator (SearchBuilderTab.jsx:960-1024). Dirty detection = persisted-signature diff (`serializeSearchState` vs lastSavedRef). Server: named-key patch (whitelist), CAS retry ×4 then 409, revision rides GET/PUT; client PUT sends **no baseRevision** (documented LWW). Remote pokes → `remoteAdoptDecision` (echo-skip / not-newer-skip / defer-while-editing); undo stack cleared on remote adopt (collaboration rule). Loaded-gate prevents pre-load blank PUTs; single-key saves (searchMode, readyForScreening) cannot wipe other keys. `localStorage` is not canonical state anywhere. Phase 16's autosave requirements are substantially met; the gap is stale-write **rejection** (§16).

## 7. Proposed Boolean workspace model

The visible model is 97's: **OR groups connected by AND**. Concretely, existing `concepts` **are** the OR groups — no data-shape change, only presentation + naming:

- Group headers say "Search Group N" (or the user's custom label); "Legacy group" badges remain for `picoField` groups until migration (§15) rewrites canonical labels.
- Visible OR separators between chips, AND connectors between group cards, and the existing live per-database preview communicate the Boolean structure without raw syntax editing.
- Within-group operator remains fixed OR; groups chain with AND (96 limitation retained; split-group remains the AND-between-terms path). NOT remains unsupported (96 §7).
- First tab rename (97 Phase 5): **label-only** change at searchStages.js:27 → `Select & Build Key Terms`; stage id `terms` unchanged (aliases, deep links). The tab is redesigned in place: source sections (research question; PICO text shown read-only as labeled *source* sections when present — sources never dictate workspace organization), interactive tokens, and the group workspace. Documented variation per 97 Phase 17: 96's merged-workspace architecture means "first tab" = the terms stage, not a new tab.
- Token model: `tokenizeForSelection` stays the render source; combined phrases persist **inside the created term** as `components:[{text}...]` (additive term-level key — rides inside `concepts`, no putSearch branch) so split-later is lossless; manually edited phrases get a safe split UI (§12).

## 8. Proposed server-backed state model (new persisted keys — exact accounting)

Canonical state stays WorkflowModuleState `search`. Additions:

| Data | Where it lives | putSearch cost |
|---|---|---|
| Generation/modification metadata: `{generatedAt, generatedBy:{id,name}, sourceQuestion, manuallyModifiedAt, manuallyModifiedBy:{id,name}}` | **One** new top-level key `meta` (object) | 1 × six touch points (branch + sanitizer capping field lengths; omit-when-empty = omit `meta` entirely when all fields empty) |
| Intentional-duplicate decisions | Term-level `dupOverride:{key:<exactDuplicateKey>, groups:[sorted concept ids]}` riding inside `concepts` | none (concepts stored as-sent) |
| Group custom names | Existing `concept.label` (rename already exists) | none |
| Migration/conversion marker | Per-concept `labelMigrated: 1` riding inside `concepts` (+ nothing top-level) | none |
| Phrase component history | Term-level `components:[...]` | none |
| Optional stale-write safety | `baseRevision` in the PUT **body envelope** (not persisted state) | server branch only (patchModuleState already supports CAS) |
| Regeneration audit | PUT body envelope `auditAction:'regenerated'` (whitelisted enum) → controller records `SEARCH_REGENERATED` instead of `SEARCH_UPDATED` | server branch only |

Rules: `meta` is refreshed client-side — `manuallyModifiedAt/By` stamped on any manual mutation (the same code paths that push undo entries), `generatedAt/By/sourceQuestion` stamped only by Regenerate. "Manually modified since generation" and "source changed since generation" are **derived**, never stored. No other top-level keys are added; anything else rides inside `concepts` per invariant 1.

## 9. Proposed regeneration behavior

**Decision R1 — regenerate from the research question only, with neutral labels.** 97's wording says "question and PICO", but 96 removed PICO from the builder entirely (props don't include it) and Phase 8 forbids resurrecting the P/I/C/O organization. Regeneration = `extractConcepts(question, '')` (conceptExtraction.js:125-154 — pure, network-free) → groups labeled `Search Group 1..N`, terms **without** `picoField`. Documented variation (97 permits documented variations; PICO remains a source only via the question text the researcher writes). `syncSearchBuilderFromPico` stays untouched (legacy tests).

Flow (client): `Regenerate` button in the terms-stage toolbar → confirmation dialog with 97's exact copy (Title "Regenerate search strategy?"; Body "This will rebuild the automatically generated keywords and search groups from the current research question and PICO. Your current manual organization may change."; Cancel / Regenerate) → **snapshot first via `POST /api/search-builder/:pid/versions`** (`name:'Before regeneration'`) — on snapshot failure, **abort with an error toast; no state change** → replace `concepts`, stamp `questionSnapshot` + `meta.generatedAt/By/sourceQuestion` → **immediate `saveNow`** (bypass the 800ms debounce; carries `auditAction:'regenerated'` + `baseRevision`) → push a whole-state `regenerate` undo entry → show "Search strategy regenerated. Undo". Cancel leaves all state unchanged. Overrides/filters/dismissals are **not** cleared by regeneration (they ride in the snapshot regardless).

## 10. Proposed pre-regeneration snapshots

**Reuse `SearchStrategyVersion` wholesale** — `snapshotVersion` already freezes the entire module state **including overrides, filters, questionSnapshot, dismissals** and records number/name/note/createdById/Name/createdAt; `restoreVersion` overwrites via the same patch path and bumps revision; both audit (`SEARCH_VERSION_SAVED`/`SEARCH_VERSION_RESTORED`) and poke `search.updated`; the SearchVersionsPanel already lists versions on the terms stage — satisfying "expose the snapshot through version history". No new storage is invented. The only additions: the auto-named pre-regeneration snapshot call, and `meta` riding inside the snapshotted state automatically (it is part of module state).

## 11. Proposed undo and action-history behavior

Extend the existing inverse-patch `undoStack` (cap 20, cleared on remote adopt — rule retained):

- **New kinds**: `moveTerm` (cross-group, stores from/to/index), `copyTerm`, `combineTokens`/`splitPhrase`, `renameConcept`, `addConcept`/`deleteConcept` (delete already covered by `removeConcept`), `regenerate` and `restore` (whole-`{concepts, meta, questionSnapshot}` entries — consistent with existing whole-object entries), `dupOverride` set/unset.
- **Global Ctrl/Cmd+Z**: one document-level keydown handler mounted by the terms stage, gated by a **pure predicate** `shouldHandleGlobalUndo({tagName, isContentEditable, role})` (unit-testable per house style) that refuses INPUT/TEXTAREA/contentEditable/rich-text/search-syntax editors. It calls the same `performUndo` as the snackbar and respects the stack-cleared-on-adopt rule. No redo (out of scope; snackbar copy says what was undone). No collision with screening's 'u' shortcut (different surface; handler mounts only in the search workspace).
- Toasts: every undoable action keeps/gains a descriptive snackbar ("Combined into “sodium-glucose cotransporter 2” — Undo", "Moved “EUS” to Search Group 2 — Undo"); `announce()` live region reused.

## 12. Proposed drag, reorder, merge, split, and group movement behavior

**Decision D1 — hand-rolled pointer-events DnD; no new dependency.** No dnd library exists; HTML5 DnD has no touch support; framer-motion (already a dep) covers only within-group reorder. We build one small shared hook (`src/features/searchBuilder/dnd/useChipDrag.js`) on pointer events (pointerdown + move threshold + pointermove hit-testing + pointerup), with **pure, unit-tested helpers** (`resolveDropTarget(geometry, pointer)` returning `{kind:'insert', groupId, index} | {kind:'merge', targetTermId} | null`). Reorder shows an **insertion line**; merge requires hovering the target chip's center zone past a ~350ms hover threshold and shows a **distinct merge-target ring** — never the same affordance. Touch works by construction; Esc cancels a drag. Keyboard/menu alternatives remain primary and complete (Phase 21): existing popover Move/Position controls, plus new "Move to new group", "Duplicate term (copy)", merge/split menu items.

Behavior contract (all implemented as **pure functions in `src/research-engine/searchBuilder/`**, consumed by the UI):
- `moveTermToConcept(concepts, termId, fromId, toId, index)` — preserves stable id, type, vocab, source, `components`, `dupOverride` (re-validated, §13); **no `source:'user_added'` rewrite** (vestigial anti-resync guard removed); **on exact-dup at target: blocked with "This exact term is already in this group — Find existing term" (no silent deletion)**; records `moveTerm` undo. This replaces today's defective `moveTerm` (fixes the silent-loss bug, the un-undoable move, and the source rewrite).
- Default drag **moves**; duplication only via the explicit copy action (new term id, `source:'copied'`).
- Token-tray interactions (amended post-QA, M15): the QUESTION token tray is merge-only — drag-onto-token = `combineTokens` (order-preserving, whitespace-normalized, hyphens/punctuation preserved, `components` recorded); insert/gap targets never resolve there because the question's word order is fixed, so the drag can never signal a reorder it would not perform. Reorder-by-drag lives on the GROUP chips, where order persists. `splitPhrase` restores components only while the text still equals the joined components, else opens a safe manual-split dialog (edited phrases are never guessed destructively).
- Group ops: existing reorder/merge/split/delete/rename retained (already pure + undoable); add "move term to **new** group" and group-level drag handles reusing the same hook. Non-empty group delete keeps the inline confirm + undo path.
- Responsive invariant: chip layout keeps the no-horizontal-overflow contract (e2e/responsive enforced at 768/1024).

## 13. Proposed duplicate normalization and warning behavior

**Decision N1 — add a new conservative `exactDuplicateKey`; never touch `termEquivalenceKey`.** New shared pure module `src/research-engine/searchBuilder/exactDuplicate.js`: trim; collapse internal whitespace; lowercase; strip **surrounding** straight/curly quotes only; strip trailing database field tags (`[tiab]`, `[Mesh]`, …) for comparison. `EUS ≡ eus ≡ "EUS" ≡ “EUS”` ✔; `EUS ≠ endoscopic ultrasound ≠ EUS-guided biliary drainage` ✔. The family-based `termEquivalenceKey` survives unchanged (persisted `rejectionKey`/`dismissedWarnings` ids stay valid) and is **downgraded to the soft "Possible variant" signal** — non-blocking, no dark-red, accurate copy.

- **Cross-AND-group exact duplicates**: every affected chip gets dark-red border/background + warning icon + tooltip ("Exact duplicate across AND groups — “EUS” appears in more than one search group. Because these groups are connected with AND, this may make the search unnecessarily restrictive.") + SR label + focus-visible styling — never color alone. Chip menu: Find other duplicate (scroll + focus, no disorientation), Move to the other group (a real move via `moveTermToConcept`), Remove this copy, Keep both intentionally, Dismiss.
- **Keep both intentionally** persists as term-level `dupOverride:{key, groups:[sorted ids]}` on **each** copy; the warning is suppressed only while the term's current `exactDuplicateKey` and the sorted set of groups containing that key still match — any text edit, move, or third copy invalidates the override automatically (97's reevaluation requirement), with no top-level key and no orphaned dismissal ids. Existing `multi:` dismissals continue to suppress the (now softer) family-variant signal only.
- **Same-OR-group**: insertion already prevented at every entry path; add the "Find existing term" focus affordance; the blocked-move path (§12) reuses the same message. No override for same-group duplicates (no legitimate use case in the current product).
- The inline "Search Quality Check" card is removed (§ Phase 7 scope): branding, severity score framing, and `sensitivitySignal` badge go; `detectCrossConceptDuplicates` (model layer) survives as the chip-integrated engine; useful non-blocking hints (empty group, literal boolean operator) become quiet inline notices; `strategyCritic`/`stageStatus` (pecan run surface) untouched.

## 14. Proposed MeSH behavior

- **Terminology**: replace every "Subject heading" string with MeSH / Emtree ("controlled vocabulary" only generically) — full location list captured (searchState.js:470; SuggestionsDisclosure 17/53; AddTermBox 25/27; TermEditorPopover 106/111/119; TermChipRow:80; ActiveConceptPanel 63/65; SearchBuilderTab 408/1435/1469-1470/1719; suggestionReview.js:87; strategyGenerator/strategyCritic advisory copy; compiler capabilities + gscholar/opengrey renderer warnings).
- **Kill keyword bundles**: remove the `synonyms` bulk suggestion kind's one-click bulk insert, the "Accept all N subject headings" button, and the "+ add N synonyms" popover bulk action. Entry terms/synonyms become **individual rows with per-term "Add this term"** actions (each added term appears individually in the OR group as a free-text term with source metadata). Suggestion confidence surfaced where `meshConfidence` is reliable; low-confidence marked, never auto-added.
- **Details popover**: new hover/focus popover on MeSH chips showing preferred term, scope note, entry terms, tree/category, MeSH UI, explode status, source — **zero new fetches**: all fields already ride on `term.vocab` (nlmClient.js:119-129; children via cached SPARQL). Keyboard-accessible (focus opens; Esc closes); informational only.
- **Explode**: existing `noExplode` toggle relabeled "Include narrower indexed terms" + explanation that it changes database indexing behavior and adds no visible free-text terms.
- **Individual add/remove/move**: already works (chips show descriptor + MeSH badge; popover move preserves vocab); editing a matched heading into unmatched text already converts to keyword via the existing "Convert to keyword" flow — verify wording ("This is no longer the MeSH term — converted to free text").
- **Service boundary**: unchanged — nlmClient stays the single caller; browser uses `/api/search-builder/mesh|mesh-suggest|count`; CI hermetic gate makes no live calls; new popover needs no new endpoints. E2E's one live-NLM suggestion test is rewritten against seeded vocab/`localMeshSuggestions` fixtures so the 97 acceptance criterion ("no live external controlled-vocabulary calls" in automated tests) holds beyond the unit gate.

## 15. Existing-data migration strategy (neutral group names, idempotent)

Pure function `migrateLegacyGroupLabels(concepts)` in searchState.js, applied in the load effect after adoption:

- For each concept with `picoField`/`source:'pico_auto'` whose label **exactly matches a canonical PICO label** (against LEGACY_FIELD_TO_KEY / PICO_FIELD_DEFS variants — user-renamed labels are preserved per 97), rewrite label to `Search Group <n>` (n = position among groups) and stamp per-concept `labelMigrated: 1`.
- **`picoField` is retained** (invariant 5: drift exemption, empty-group QC exemption, Time-frame handling, rejectionKey scoping all depend on it). The "Legacy group" badge is dropped from the UI; the marker key makes the function a no-op on already-converted docs (idempotent across refreshes).
- Signature consequences: conversion changes the persisted signature **once**, the ensuing autosave persists it, subsequent loads no-op (byte-stable thereafter). Version `currentMatch` hashes flip once for old snapshots (canonicalStrategyProjection includes the normalized label) — acceptable, documented.
- No top-level schemaVersion key (per-concept marker is cheaper and whitelist-free). Prisma: no schema change at all for the builder (state is JSON in WorkflowModuleState).
- Tests: extend `searchMigrationFixtures.test.js` — all 8 archetypes + new archetypes (renamed-label legacy group; already-migrated doc) through the 4 seams + idempotency (`migrate(migrate(x)) === migrate(x)` by signature).

## 16. Collaboration and conflict risks

- **Today**: LWW-with-revision-surfaced. Guards: signature echo skip, revision-gated adoption, defer-while-editing, loaded-gate (blank-over-valid impossible), CAS ×4 → 409, undo cleared on adopt. Two editors can still LWW-clobber between pokes.
- **Change (Phase 16)**: builder full-state PUTs send `baseRevision`; server rejects stale writes (patchModuleState CAS — small branch). On 409 the client re-GETs, runs `remoteAdoptDecision`, surfaces "A collaborator updated this strategy — your view was refreshed" and lets the user re-apply; it never replaces server state with blank/older client state. **Partial-body writers (searchMode, readyForScreening single-key PUTs) intentionally omit baseRevision** and keep LWW — they cannot clobber concepts by construction (named-key patch). Documented limitation: no operational-transform merge; stale full-state writes are rejected, not merged.
- Regeneration + collaboration: the pre-regeneration snapshot and the immediate `saveNow` (with baseRevision) mean a stale collaborator cannot silently overwrite a newer regenerated workspace (their PUT 409s); their own unsaved work is protected by the same adoption flow. Undo-stack clearing on adopt prevents cross-user undo application.
- Realtime: existing `search.updated` pokes are emitted by putSearch/version routes already; no new infra.

## 17. Preservation and rollback risks (and mitigations)

| Risk | Mitigation |
|---|---|
| Blind-mode leakage via JSON backup (top leak vector) | Same `buildExportContext` gate for every ZIP member; ordinal re-mapping incl. ScreenConflict.reviewerDecisions keys; dedicated leak tests (§19) |
| Legacy EXPORT_COLUMNS breakage | ZIP CSV is a new file/schema; legacy service functions untouched; position-pinning tests stay green |
| ZIP corruption via utf8 sink | Binary sink scoped to `format==='zip'` only; round-trip JSZip read tests |
| rawData unparseable → export fails | Per-record try/catch resolver; missing-optional-metadata tests |
| New persisted key silently dropped / byte-stability broken | Only ONE new top-level key (`meta`), full six-touch-point wiring + omit-when-empty pinned tests; everything else rides inside `concepts` |
| `termEquivalenceKey` change orphaning persisted ids | Never changed; `exactDuplicateKey` added alongside; family path demoted to soft signal |
| moveTerm silent term loss (live bug) | Replaced by pure `moveTermToConcept` with dup-block + undo |
| Regeneration losing manual work | Snapshot-first (abort on failure), whole-state undo entry, version-history restore, audit |
| Label rename red wave (~150 pinned assertions) | Single coordinated sweep owned by T, executed with the rename commit (list in §19) |
| Legacy-group rewrite breaking exemptions | `picoField` retained; migration idempotent + fixture-tested |
| Failed ZIP consuming allowance | Documented policy (consistent with existing async exports); revisit later |
| DnD regressions on touch/overflow | Pointer-events (touch by construction); responsive e2e invariant kept; keyboard/menu paths primary |
| Search Quality Check removal breaking pecan surfaces | Remove UI card only; `detectCrossConceptDuplicates` kept; strategyCritic/stageStatus untouched |
| Rollback | Builder changes are state-JSON + UI (no destructive migration; old clients read new docs — unknown term keys ignored by all consumers); export additions are additive columns + new routes/format values; reverting the deploy restores prior behavior with no data conversion needed |

## 18. Minimal safe implementation order (Phase 17, adapted — documented variations noted)

1. ~~Plan doc~~ (this document) + **capture e2e baseline**: full `npx playwright test` run recording the exact titles of the 6 pre-existing failures (no per-title list exists in the repo — required for Phase 19 evidence).
2. **S1**: `server/utils/zip.js` (STORE + deflate-raw, CRC-32) + `server/utils/filenames.js` + unit tests.
3. **S2**: `server/services/screeningExportZip.js` — new CSV schema builder (stage-explicit), best-effort volume/issue/pages/url resolver, `renderRisRecord`, streaming JSON backup serializer, README/EXPORT-WARNINGS generators; blind-mode parity.
4. **S3**: ScreenExportJob additive columns (`warningCount`, `warnings`) + worker `zip` format (binary sink, per-member try/catch) + `exportContentType` zip branch + filename + `SCREENING_EXPORTED` audit + gating reuse.
5. **S4**: ExportTab ZIP UI + copy + warning surfacing.
6. **B1**: `meta` key six-touch-point wiring; `exactDuplicateKey` module; pure `moveTermToConcept` / `copyTerm` / `combineTokens` / `splitPhrase` / `migrateLegacyGroupLabels`; new undo kinds; `shouldHandleGlobalUndo` predicate; putSearch `baseRevision` + `auditAction` branches. (Order rationale: pure state layer before any UI consumes it — 97 steps 9-12 fold into B1/B2 because silent regeneration is already stopped.)
7. **B2**: Regenerate flow (dialog, snapshot-first via versions API, saveNow, undo, audit).
8. **U1**: first-tab rename (label-only) + terms-stage redesign (source sections, token states) — **with T's coordinated label sweep in the same change**.
9. **U2**: pointer-DnD hook + insertion-line/merge-target visuals + token reorder/combine/split UI + phrase edit; keyboard/menu alternatives for everything.
10. **U3**: OR/AND visual model, group headers/renames, move-to-new-group, explicit copy action.
11. **U4**: duplicate chip styling/menu (dark-red, icon, tooltip, SR labels, Find-other/Find-existing, keep-both via `dupOverride`).
12. **U5**: MeSH — terminology sweep, individual entry-term rows (remove bulk accepts), details popover, explode relabel.
13. **U6**: remove the inline Search Quality Check card (keep the duplicate engine + quiet hints).
14. **B3**: legacy-group label migration wired into load; migration fixtures extended.
15. **B4**: collaboration — client baseRevision on full-state PUTs, 409 reconcile UX.
16. **T (continuous, final sweep at the end)**: unit/integration/e2e additions §19; full `test:ci` + integration + e2e + build; compare e2e against the step-1 baseline.
17. Manual QA (§20) → senior code review → docs + version bump (patch per repo convention) → commit/push when green.

High-risk state-preservation steps (2, 6, 14, 15) are never skipped or merged into UI commits.

## 19. Automated test plan

**Screening export** (patterns: export-columns.test.js for schema pinning/streaming, exportBlind.test.js for identity, exportFigures.test.js for JSZip reading, api-project-export.test.js for gating):
- Unit (hermetic): zip.js round-trip via `JSZip.loadAsync(buffer)` (names, CRC, deflate + STORE); `safeFilePart`; new CSV schema position-pinning (`SCREEN_ZIP_CSV_COLUMNS` append-only); stage-explicit reviewer columns; best-effort resolver with truncated/garbage rawData; `renderRisRecord` tag mapping + blind AU/JO omission; README/EXPORT-WARNINGS content; JSON-backup serializer chunk output + `schemaVersion`; blind-mode ordinal re-mapping incl. conflict rows (leak tests).
- Integration (direct-prisma, tag-scoped, serialized): seeded blind + non-blind projects → build full ZIP buffer → assert the four members + schema versions; partial failure via injected failing RIS renderer → ZIP + EXPORT-WARNINGS + `warningCount`; bounded-memory streaming assertion on a large seeded set (with afterAll cleanup — do not aggravate dev-DB scale); worker job lifecycle for format zip. Live-HTTP: 401/403/404 matrix, creator-only poll/download, content-type/Content-Disposition filename, allowance gate.
- E2E: screening export journey (seed via `makeRis`/`importScreeningRecords` → ZIP download via `page.request` → JSZip assert), updated `exportHeading`/`exportButton` locators, axe scan.

**Builder** (house style: pure functions + SSR contracts; gestures only in Playwright):
- Pure: `exactDuplicateKey` matrix (97's exact-dup and not-exact lists verbatim); crossConcept split — exact path vs family "possible variant" (rework the pinned `fam:` duplicate assertions accordingly); `dupOverride` suppression + auto-invalidation on move/edit/third-copy; `moveTermToConcept` (metadata preservation, dup-block, undo info); `combineTokens`/`splitPhrase` (components round-trip, edited-phrase safe path); `migrateLegacyGroupLabels` idempotency + custom-name preservation; `meta` omit-when-empty byte-stability; new undo kinds round-trips; `shouldHandleGlobalUndo` predicate; regeneration state transition (question → neutral groups, no `picoField`).
- SSR contracts: duplicate chip (icon + SR label + not-color-alone), merge-target/insertion-line prop-driven states, MeSH popover markup, individual entry-term rows (bulk-accept testids **removed** — rework `sb-accept-all-headings` and `synonyms`-kind pins), group toolbar contract (new — `sb-group-actions` currently e2e-only), renamed stage label.
- Coordinated label sweep (owned by T, shipped with U1): searchWorkspace.test.jsx (STAGE_LABELS + terms assertions), searchBuilderPhases.test.jsx, searchBuilderUi.test.jsx, navConfigSearchSubmenu.test.js, searchStageStatus.test.js, searchWizardPanels.test.jsx, SearchPage.ts, searchWorkspace.spec.ts, responsive spec, search.spec.ts.
- Integration: putSearch `meta`/`baseRevision`/`auditAction` (stale-write 409; partial-body writers unaffected); versions snapshot-before-regenerate; `SEARCH_REGENERATED` audit row.
- E2E (net-new drag surface — highest flake risk, mitigations: explicit mouse.down/move/up with waits, generous thresholds, retries): drag-reorder vs drag-merge distinct targets; cross-group chip drag; Ctrl/Cmd+Z outside vs inside a textarea; regenerate cancel/confirm/undo/restore; duplicate dark-red journey (create → find-other → keep-both → refresh persistence); MeSH popover + individual entry-term add (against seeded/offline vocab — no live NLM); responsive no-overflow retained; axe scans on the redesigned stage.
- Baseline discipline: step-1 Playwright baseline captured before any change; any post-change failure is diffed against it (Phase 19 evidence rule).

## 20. Manual QA plan

**Export**: complete-metadata project; missing DOI/abstract project; blind-mode project as leader AND as non-leader (verify ordinals + blanked authors in CSV, RIS, JSON alike); conflicted records; limited-permission member (403) and outsider (404); open CSV in Excel/LibreOffice (formula-guard check with a `=SUM`-titled record); import RIS into Zotero; inspect JSON structure + schemaVersion; read README; force RIS failure (temporary injection) → ZIP + warnings banner; >5000-record project via job path with progress; filename check on Windows/macOS.
**Builder**: full 97 Phase 20 checklist — select/unselect, token reorder, merge two/several tokens, edit phrase, split phrase (both component and edited paths), undo every major action, add/delete/reorder/rename/merge/split groups, move terms between and to new groups, explicit copy, MeSH hover + individual entry-term add (confirm others NOT inserted), explode toggle copy, create cross-group exact dup → all chips dark-red → find-other → keep-both → move/edit → warning reevaluates, refresh + logout/login persistence, PICO/question change → no silent overwrite + informational line only, regenerate cancel/confirm/undo/version-restore, Ctrl/Cmd+Z inside vs outside text fields, keyboard-only full pass (Phase 21 list), touch drag on tablet emulation, two-browser collaboration (stale write rejected, no blank overwrite), browser console + server logs clean.

---

## 21. Key decisions (summary table)

| # | Decision |
|---|---|
| Export architecture | Reuse ScreenExportJob worker; ZIP always async (`format:'zip'`); legacy sync formats untouched |
| ZIP library | Zero-dep hand-rolled writer ported to `server/utils/zip.js` (STORE + node:zlib raw-DEFLATE, CRC-32); jszip stays test-only |
| RIS | New `renderRisRecord` (TY/TI/AU/JO/PY/VL/IS/SP/EP/DO/AN/UR/AB/KW, best-effort extras); legacy `renderRisBlock` untouched; BibTeX deferred (documented) |
| JSON backup | New streamed per-table `screening-backup.json`, schemaVersion 1, full blind-mode ordinal re-mapping |
| Export gating | Reuse SCREENING_RECORDS type + full chain; creator-only artifacts kept; enqueue-counts-allowance kept; add `SCREENING_EXPORTED` audit |
| Partial failure | Core = CSV+JSON+README; optional = RIS; `warningCount`/`warnings` additive columns; EXPORT-WARNINGS.txt |
| DnD | Hand-rolled pointer-events hook, pure hit-testing helpers, distinct insert-line vs merge-target, hover threshold; no new deps; keyboard/menu primary |
| intentionalDuplicates | Term-level `dupOverride:{key, groups}` inside `concepts` (config-scoped auto-reevaluation; no putSearch key) |
| Group custom names | Existing `concept.label`; migration marker per-concept `labelMigrated:1`; `picoField` retained |
| generatedAt/manuallyModifiedAt | ONE new top-level `meta` object key, full six-touch-point wiring, omit-when-empty |
| Duplicate normalization | New `exactDuplicateKey` (conservative) alongside untouched `termEquivalenceKey` (demoted to "Possible variant") |
| Regeneration | Question-only via `extractConcepts`, neutral labels (documented variation); snapshot-first via SearchStrategyVersion; `auditAction:'regenerated'`; saveNow |
| Collaboration | Optional `baseRevision` CAS on full-state PUTs; partial-body writers keep LWW; 409 → adopt/reconcile UX |
| First tab | Label-only rename to `Select & Build Key Terms` (stage id `terms` unchanged); in-place redesign; coordinated test sweep |
| moveTerm bug | Replaced by pure `moveTermToConcept` (no silent deletion, undoable, source preserved) |

## 22. Workstream file ownership (disjoint — same discipline as the 96 plan)

Conflict rule: **B lands pure functions and server branches first; U consumes them; no workstream edits another's files.** SearchBuilderTab.jsx is U-owned; all logic it needs must be exported from B-owned modules.

**S — Server export (+ screening UI)**
`server/utils/zip.js` (new), `server/utils/filenames.js` (new), `server/services/screeningExportZip.js` (new), `server/services/screeningExportWorker.js`, `server/services/screeningExportService.js` (additive exports only; frozen contract untouched), `server/controllers/screeningController.js` (export sections), `server/routes/screening.js`, `server/prisma/schema.prisma` (ScreenExportJob columns) + Postgres migration, `src/frontend/screening/tabs/ExportTab.jsx`, `src/frontend/screening/api-client/screeningApi.js`, `src/frontend/components/ExportDialog.jsx`.

**B — Builder state layer + persistence (pure + server)**
`src/research-engine/searchBuilder/` — `searchState.js`, `crossConcept.js`, `exactDuplicate.js` (new), `termOps.js` (new: move/copy/combine/split), `undoStack.js`, `keywordSelection.js`, `conceptExtraction.js`, `suggestionReview.js`, `regenerate.js` (new); `server/searchEngine/searchEngineController.js` (putSearch branches), `server/searchEngine/searchVersionService.js` (only if the pre-regeneration name/flag needs support), `server/services/workflowState.js` (audit action constant).

**U — Builder UI / DnD**
`src/features/searchBuilder/` — `SearchBuilderTab.jsx`, `components/**` (TermChipRow, TermEditorPopover, ActiveConceptPanel, SuggestionsDisclosure, AddTermBox, uiShared, new MeshDetailsPopover, new dnd/useChipDrag), `src/features/searchWorkspace/` — `SearchWorkspace.jsx`, `searchStages.js` (label), `src/frontend/stitch/nav/navConfig.js` (only if icon/copy touched).

**T — Tests**
`tests/unit/**`, `tests/screening/**`, `tests/integration/**`, `e2e/**` (specs + page objects + fixtures). Owns the coordinated label sweep, the Playwright baseline capture, migration-fixture extensions, and the crossConcept assertion split. T lands test updates in the same commit as the behavior change they pin (paired with the owning workstream), but only T edits test files.

Shared/sequencing: `server/prisma/schema.prisma` is S-only this cycle (B needs no schema change). `docs/**` owned by the coordinator. Merge order: S1-S4 independent of B/U; B1 → B2 → (U1..U6 ∥ B3/B4 where files stay disjoint).
