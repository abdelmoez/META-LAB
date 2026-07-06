# 76.md — Pecan Extraction Engine — Implementation Plan

Status: executing. Flag `extractionEngine` (default OFF, admin-visible, no hard deps).
ON → new Pecan Extraction Engine; OFF → the current `ExtractionTab` byte-preserved.

## 1. Current-state architecture (investigation, §2)

| Layer | Location | State |
| --- | --- | --- |
| Pure engine | `src/research-engine/extraction/**` (27 modules + digitizer/ + ocr/), 6.7k lines of unit tests | **STRONG — reuse wholesale.** cellGrammar/numberTokens (smart parsing), pdfTextGrid+tableShape (grid pipeline), TableRegionMapper logic, PlotDigitizer (Guyot KM→HR), records.js (draft record + provenance + protection rule), valuePrecedence.decideWrite (no-silent-overwrite), draftReconcile (idempotency), maHandoff (analysis bridge), study-validator. |
| PDF/OCR | `AppPdfViewer.jsx` (universal, virtualized, search, zoom, rotation, **coordinate capture**, unused `pageOverlay`), `usePdfSource.js` (3-way sourcing), `ocr.js` (Tesseract, "text recognition") | **STRONG — reuse; extend viewer with a reveal/jump handle.** |
| Split UI | `src/features/extraction/unified/AssistedExtractionPanel.jsx` (PDF-left/methods-right, embedded in a scrolling tab, not full-screen) | Reuse method LOGIC; rebuild the shell. |
| Structured (66.md) | `ExtractionWorkspace.jsx` + `/api/extraction` + 6 Prisma tables (Form/Value/Assignment/Consensus/AiSuggestion/ParsedTable) | Preserve behind `extractionAssist`; not the primary surface. |
| Analysis store | `Project.data.studies[]` blob (`mkStudy`); analysis reads it live via `useMemo` | The extraction data lives here. es/lo/hi are on the **ln analysis scale** for OR/RR/HR. |
| Shell/nav | `StitchProjectWorkspace.jsx` (full-bleed via `onWorkspaceChange` lift), `robTabs.jsx` (flag-dispatcher), `RobWorkspace.jsx` (resizable split), Stitch flag stack | Reuse all patterns. |
| Backend authz | `server/extraction/access.js` `resolveExtractionAccess` (owner/member/adjudicator), `featureAccess`, permission flags | Reuse as-is. |
| Screening→extraction | `screeningReviewController.handoffToMetaLab` appends `mkStudy` to blob, dedupe + revert-snapshot | Works; the article list feeds off `studies[]`. |

### Current workflow (end-to-end)
Screening leader accepts a full-text record → `handoffToMetaLab` appends an `mkStudy` row to `Project.data.studies[]` → Extraction tab shows a `<select>` of studies + the split-screen `AssistedExtractionPanel` → reviewer runs Auto / Pick-a-source (table→grid mapper, figure→digitizer) / Click-assign / Manual card → confirmed values land in the blob study row → Analysis reads `studies[]` live.

## 2. Top problems / limitations (vs 76.md)
- **No article-list entry view** (§6) — a `<select>` dropdown, no statuses/progress/filters/assignment.
- **Not a focused full-screen workspace** (§7/§8) — embedded in a scrolling tab; no resizable/collapsible panels, no per-user persistence, no stable toolbar with progress/validation/save/prev-next/complete.
- **No per-value structured provenance / jump-to-source** (§15) — click provenance is a free-text note; `pageOverlay` unused; viewer has no reveal handle.
- **No article status + completion workflow** (§6/§22) — no complete/reopen, no completedBy/at, no audit.
- **No honest conflict-aware autosave** (§18) — blob path is whole-project last-write-wins.
- **No analysis sync status / change propagation** (§20/§21) — analysis IS the blob; no synced/updated-since-sync state, no outdated marking.
- **No undo/history / audit** (§24/§15) — values overwrite in place; no ExtractionAuditLog.
- **Backend not modular** (§4) — logic concentrated in one controller; `server/extraction/` holds only access.js.

## 3. Design — reuse inventory
- **Keep as-is:** whole pure engine, AppPdfViewer core, usePdfSource, ocr.js, TableRegionMapper, PlotDigitizer, DraftReviewList, screening handoff, resolveExtractionAccess, featureAccess, mkStudy/blob store, analysis engine, the 66.md structured stack (behind extractionAssist).
- **Extend:** AppPdfViewer (add a `reveal` prop for jump-to-source overlay + scroll); records PROVENANCE_METHODS (+`ocr`); StitchProjectWorkspace fullbleed (+extraction); navConfig (`?article=` param).
- **Build new** (below).

## 4. Backward-compat / migration (§5/§33) — ZERO destructive migration
- New article metadata lives **additively** in the blob: `study.extractionMeta = { status?, completedBy, completedAt, locked, reopenedAt, provenance:{field→{...}}, syncHash, syncedAt, includedInAnalysis, assignedTo[] }` and `project.extractionEngine = { lastArticleId, ... }`. Unknown keys are ignored by analysis/legacy code; no schema change to `mkStudy`.
- One NEW Prisma model `ExtractionAuditLog` (clone of `RobAuditLog`: bare `projectId`, denormalized actor, append-only, `@@index([projectId, createdAt])`) + postgres twin sync. Additive table — safe `db push`.
- Flag OFF preserves the current `ExtractionTab` verbatim (dispatcher). Existing `extractionAssist` structured stack untouched.

## 5. Build plan (workstreams, dependency-ordered)

### WS-A — Pure engine (`src/research-engine/extraction/engine/`) + tests
- `articleStatus.js` — `articleStatusOf(study, meta, validation)` → one of not_started / in_progress / validation_required / ready_for_review / complete / locked; `progressOf(study)` → {pct, filledFields, totalFields}.
- `articleProvenance.js` — per-value provenance record + `attachProvenance/readProvenance/listProvenance`; fields {method, page, bbox, excerpt, at, by, original, transformed, rule, confidence, ocr}.
- `syncState.js` — `computeSyncHash(study)` (stable), `syncStatusOf(study, meta)` → not_ready / ready / synced / updated_since_sync / excluded (manuscript OUTDATED precedent).
- `completionGate.js` — `evaluateCompletion(study, issues)` → {canComplete, blocking[], warnings[]}.
- `articleList.js` — pure `filterSortArticles(summaries, query)` (search/sort/status/reviewer/progress/pdf filters).
- `records.js` — add `'ocr'` to PROVENANCE_METHODS.
- Tests: `tests/unit/extraction/engine/*.test.js`.

### WS-B — Backend module (`server/extraction/engine/`) + routes + audit table
- `auditLog.js` — `writeExtractionAudit(...)` (best-effort, RobAuditLog shape) + `readExtractionAudit`.
- `articleService.js` — `buildArticleSummaries(project, access)` from the blob.
- `completionService.js` — complete/reopen: mutate `study.extractionMeta` via `store.save`, write audit; `touchProjectActivity`.
- `server/routes/extractionEngine.js` (mounted `/api/extraction-engine`, requireAuth + `extractionEngine` flag gate + rate limiter):
  - `GET  /projects/:pid/articles`
  - `POST /projects/:pid/articles/:sid/complete`
  - `POST /projects/:pid/articles/:sid/reopen`
  - `GET  /projects/:pid/articles/:sid/audit`
- `ExtractionAuditLog` Prisma model (+ `scripts/sync-postgres-schema.mjs`).
- Flag wiring: settingsController DEFAULTS + AdminConsole FLAG_META + featureAccess (no dep) + client mirror + `extractionEngineFlag.js` helper + `useExtractionEngineEnabled.js` hook.

### WS-C — Frontend engine (`src/features/extraction/engine/`)
- `PecanExtractionEngine.jsx` — orchestrator: ArticleList ⇄ Workspace via `?article=<id>`; lifts open state to the shell (`onWorkspaceChange`).
- `ArticleList.jsx` — §6 entry view (status/progress/pdf/sync/last-edited, search/sort/filters, continue, keyboard nav, bulk assign).
- `ExtractionWorkspaceShell.jsx` — full-screen resizable split (adapted from RobWorkspace, key `metalab.extraction.splitRatio`); stable top toolbar (methods, progress ring, validation, honest save status, prev/next article, article info, Complete, help); collapse/maximize.
- `ArticleWorkspacePanel.jsx` — right pane: method bar (Table / Click / Manual) reusing pure grammar + TableRegionMapper/PlotDigitizer/DraftReviewList; structured form with per-field **jump-to-source** provenance chips; validation panel; completion.
- `engineApi.js` — client for `/api/extraction-engine`.
- AppPdfViewer `reveal` prop wiring; `useExtractionSplit.js` (ported split hook).
- Mount: `extractionTabs.jsx` dispatcher (flag ON → engine, OFF → current body); StitchProjectWorkspace fullbleed + `onWorkspaceChange` lift.

### WS-D — Tests + docs + deliverables
- Unit (WS-A), integration (`tests/integration/api-extraction-engine.test.js`: flag gate + articles + complete/reopen), e2e (`e2e/extraction/pecan-engine.spec.ts`), SSR smoke.
- `docs/pecan-extraction-engine.md` (architecture, API, provenance, sync, autosave, permissions, migration/rollback, limitations).
- Version bump 3.74.0 + changelog.

## 6. Risk register
- **Blob write races (§18):** completion writes read-modify-write `Project.data`; use `store.save` guards + keep writes small/idempotent; document that field autosave stays whole-blob (v1 honest-status, not CAS — noted as limitation).
- **Full-bleed lift:** must not remount engine on toggle (same DOM position — mirror RoB).
- **Postgres twin drift:** run sync-postgres-schema.mjs; restart dev server before integration tests.
- **Flag invisible to admins** without FLAG_META row.
- **es/lo/hi ln-scale:** every machine capture path already enforces ln; jump-to-source display must back-transform for ratios.

## 7. Definition of done
Flag-gated engine mounts full-screen inside PecanRev; article list with statuses/filters/progress; open→split PDF+form; three methods work with provenance; jump-from-field-to-source; honest save status; validation; complete/reopen with audit; analysis sync status surfaced; existing data + analysis unbroken; unit+integration+e2e green; docs shipped; committed + pushed; recs round applied.

## 8. Known limitations (v1 — foundation for future)
- Server-side OCR/table-detection jobs remain client-side (Tesseract.js) — durable job scaffolding deferred.
- N-arm/subgroup relational modelling stays blob-flat (one outcome×timepoint per row); companion-publication linkage deferred.
- Field-level autosave stays whole-blob honest-status (not per-value CAS); completion/reopen are audited + conflict-guarded.
- Blinded dual-extraction enforcement stays in the 66.md structured stack; the engine's assignment is advisory in v1.
