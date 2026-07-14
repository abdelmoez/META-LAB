# 88.md — Research Provenance & Manuscript-Sync Engine (design + build log)

Branch: `feat/provenance-88` (isolated worktree — a second Claude session works `main` concurrently).

## 1. What already exists (map)

PecanRev already ships most of the *manuscript-intelligence* half of 88.md. The gap is a
**discrete, append-only project EVENT ledger** and its **significance classification** —
everything downstream (dependency graph, staleness, source traceability, versions) is built.

- **Manuscript engine** `src/research-engine/manuscript/*` (pure, server+client safe):
  - `dependencies.js` — `DEPENDENCY_KEYS` registry (category = critical/methods/numerical/wording),
    `SECTION_DEPENDENCIES` (key → section), `computeDependencyState()` (FNV-1a fingerprint per slice),
    `diffDeps()` (which keys changed → which sections outdated). **This IS the manuscript dependency map.**
  - `freshness.js` — overall + per-section status (synced/updates/critical/…); per-section conflict = outdated ∧ userEdited.
  - `sources.js` / `sourceHash.js` — per-section source traceability + input fingerprints.
  - `syncPlan.js`, `contradictions.js`, `missingInfo.js`, `snapshots.js`, `versions.js`, `readiness.js`.
  - `analysisDescribe.js` — `resolveAnalysis(project,opts)` → `{model, tau2Method}` from `project.analysisSettings`.
- **State store** `server/store.js`:
  - `mutateProjectBlob(id, mutate, opts)` — the ONE safe blob writer; `autosaveRev` CAS via `updateMany` + bounded retry (86.md Phase B).
  - `save()` / client autosave also CAS on `autosaveRev`.
  - Project scientific state lives in the fat `Project.data` blob: `search.dbs` (per-database), `pico`,
    `studies[]` (per outcome×timepoint rows), `analysisSettings`, `robMethod`, `grade`.
- **Domain audit tables** (raw, per-engine): `ScreenAuditLog`, `RobAuditLog`, `ExtractionAuditLog`,
  `WorkflowStateAudit`, `EligibilityCriterionAudit`, `GradeAuditLog`, plus `AdminAuditLog`, `SecurityEvent`.
  None is a unified *scientific* project ledger with before→after + significance + manuscript impact.
- **Flags**: read from `/api/settings/public` `featureFlags.<key>`; per-feature `flag.js` helpers; nav in
  `src/frontend/stitch/nav/navConfig.js`; project tabs in `projectHelpers.js` `TABS[]`.
- **Two Prisma schemas**: `server/prisma/schema.prisma` (dev) + `server/prisma/postgres/schema.prisma` (prod) — additions go in both.

## 2. Gap → what 88.md needs that is missing

1. Append-only **ProjectEvent** ledger (who/when/why/before→after/origin/correlation) — atomic with the state write.
2. **Deterministic significance (L0–L6)** + **manuscript-relevance** classification per event — reusing `DEPENDENCY_KEYS`→sections.
3. **Analysis-run versioning** with explicit status (draft/exploratory/primary/secondary/sensitivity/superseded/invalidated/final) so the manuscript uses the *final* method, not the last click.
4. **Derived scientific state** consolidation with final-vs-superseded resolution.
5. **Project History / Provenance UI** (flag-gated) with filters + significance/impact.
6. **Migration baseline** event for pre-ledger projects (honest, marked `reconstructed`).
7. **Reason capture** for methodological changes.

## 3. Design

### 3a. Event schema (`ProjectEvent`, both schemas)
Autoincrement PK = global monotonic order (per-project order = `(projectId, id)`; avoids per-project seq contention).
Fields: projectId, projectRev(autosaveRev@write), eventType, category, subtype, actorUserId, actorRole,
origin, clientTs, serverTs, projectStage, module, entityType, entityId, parentEntityId, prevValue(Json),
newValue(Json), diff(Json), reason, correlationId, sessionId, jobId, relatedOutcome, relatedStudy,
relatedAnalysis, significance(Int 0-6), manuscriptSections(Json string[]), resultImpact(none|possible|changed),
requiresRecalc, requiresManuscriptRefresh, requiresReview, supersedesEventId, reconstructed, invalidated,
schemaVersion, metadata(Json), checksum. Indexes: (projectId,id),(projectId,category),(projectId,eventType),(projectId,significance),(correlationId).
Values are **sanitized + size-bounded** (no secrets/PHI; large blobs → hash+summary, never raw).

### 3b. Pure engine `src/research-engine/provenance/*` (no DOM/React/network/Date)
- `taxonomy.js` — `EVENT_TYPES` (type → {category, stage, module, defaultSignificance, dependencyKeys, resultImpact, requiresReason, origin}), `CATEGORIES`, `ORIGINS`, `SIGNIFICANCE`, `PROJECT_STAGES`.
- `diff.js` — `structuredDiff(prev,new)`, `isNoop`, `sanitizeValue` (bound + redact).
- `fingerprint.js` — blob-derivable scientific slices + FNV-1a fingerprints (server+client, no opts needed).
- `emit.js` — `diffProjectEvents(before, after, ctx)`: the **generic catch-all** — diff each scientific slice and emit a typed event per change (special-cases `search.dbs` per-database mode → `DATABASE_SEARCH_METHOD_CHANGED`, `studies[]` roster → inclusion/exclusion). Guarantees AC-25 "no methodological change unlogged".
- `classify.js` — `classifyEvent(evt)` deterministic: significance, `manuscriptSections` (via reverse `SECTION_DEPENDENCIES`), resultImpact, requiresRecalc/Refresh/Review. No-op (prev===new) → L0.
- `analysisRuns.js` — run-record shape + `ANALYSIS_STATUS` + `resolveEffectiveAnalyses(runs)` (final/primary/sensitivity that the manuscript may cite).
- `derivedState.js` — `deriveScientificState(project, events)` → search/screening/extraction/rob/analysis/reporting with supersession applied.
- `index.js` — barrel.

### 3c. Server `server/provenance/*`
- `recordEvent.js` — classify (fills significance/sections/impact) → sanitize → insert; idempotent via `correlationId`+`eventType`+`entityId` guard.
- `mutateWithEvents.js` — wraps the store CAS in a `$transaction`: CAS `updateMany` on autosaveRev; if count===1, `createMany` the derived events (state + events atomic). Uses `diffProjectEvents` on before/after automatically.
- `provenanceService.js` — `listEvents(filters, page)`, `summary()` (milestones + counts), `baselineProject()` (migration), `addReason()`, `invalidateEvent()` (admin). Permission-gated by project membership/role.
- controller + `/api/provenance` route (list/summary/baseline/reason).

### 3d. Frontend
- `researchProvenance` flag + `src/features/provenance/flag.js`.
- `history` project tab (`TABS[]`, phase:null, group:"project") → `ProjectHistoryPanel.jsx`: filter chips (all/scientific/manuscript/search/screening/extraction/rob/analysis/reporting/deviations), significance & impact badges, before→after, reason, superseded marker, expandable bulk summaries.
- Manuscript editor already surfaces freshness/outdated — additively show "why" from ledger events.

### 3e. Migration
`baselineProject()` writes ONE `PROJECT_STATE_BASELINE` event (significance L1, reconstructed=true) capturing the
current derived scientific state + which facts could/couldn't be reconstructed. **Never fabricate history.**

### 3f. Safety / perf
Atomic state+event; sanitize values; bulk ops → summary event (+correlationId) not thousands of rows; indexes + pagination;
schemaVersion; permission checks server-side; additive/zero-migration for existing data (baseline on first access).

## 4. Phases
- P1 pure engine + unit tests ✅ (this is the testable core)
- P2 Prisma model (both schemas) + server service/recordEvent/mutateWithEvents + API + tests (mocked prisma)
- P3 hook the generic emitter into `mutateProjectBlob` callers + `save()` path; reason capture
- P4 History UI tab + flag + nav wiring
- P5 migration baseline + integration test
- P6 report + known limitations

## Build log — v3.93.0 (branch `feat/provenance-88`)

**Reuse found (map workflow):** the significance/numeric-change engine ALREADY exists
(`src/research-engine/statistics/evidenceShift.js`, `living/snapshotDiff.js`) and the
manuscript live-sync (dependency graph, `draft.syncLog`, snapshots, freshness, sources)
is built. So this build adds the MISSING half — the discrete append-only event ledger +
significance classification — and reuses `DEPENDENCY_KEYS`→sections + evidenceShift for
numeric impact rather than duplicating them. All audit tables follow the "audit-survival"
no-FK denormalised convention; `ProjectEvent` matches it.

### Shipped
- **Pure engine** `src/research-engine/provenance/` (server+client+test safe, no DOM/Date):
  `taxonomy.js` (60+ event types, L0–L6 significance, origins, categories, stages) ·
  `diff.js` (FNV-1a, redact+bound sanitize, structured diff, no-op) · `fingerprint.js`
  (blob scientific slices) · `emit.js` (generic before→after emitter + bulk aggregation) ·
  `classify.js` (deterministic significance + manuscript sections via reversed
  SECTION_DEPENDENCIES) · `analysisRuns.js` (immutable runs, final/exploratory/superseded
  resolution) · `derivedState.js` (consolidated scientific state).
- **Prisma** `ProjectEvent` (append-only, Int autoincrement order, JSON-as-String, idempotencyKey unique, 6 indexes) in BOTH schemas (canonical + `sync-postgres-schema.mjs`).
- **Server** `server/provenance/`: `recordEvent` (classify+sanitize+insert, idempotent,
  ledger-guarded) · `mutateWithEvents` (ATOMIC CAS state+events in one `$transaction`,
  degrades to plain write pre-migration) + `recordBlobDiff` (best-effort autosave capture) ·
  `provenanceService` (list/summary/baseline/ensureBaseline/addReason/invalidate) ·
  controller + `routes/provenance.js` mounted `/api/provenance` (flag+access gated).
- **Capture hook**: `store.save()` fires `recordBlobDiff` fire-and-forget on every successful
  autosave (zero added latency; no-ops when nothing scientific changed or table absent).
- **Flag** `researchProvenance` (default OFF; admins pass; appears in Ops › Flags).
- **Frontend** `src/features/provenance/`: `ProjectHistoryPanel.jsx` (filters, significance +
  manuscript-impact badges, before→after, reason fill-in, superseded/review markers,
  pagination, unavailable state) · `format.js` (pure display) · `api.js` · `flag.js` +
  `useResearchProvenanceEnabled` hook. Wired: `?tab=history` dispatcher branch + SCOPE +
  `categoryForStage('history')→control` + `TABS` entry (group:"history", out of workflow) +
  flag-gated entry card in Project Control.
- **Migration**: `ensureBaseline` writes ONE honest `PROJECT_STATE_BASELINE` (reconstructed=true,
  origin=migration) on first History load of a pre-ledger project; records what could/couldn't
  be reconstructed; never fabricates history.

### Tests — 49 new, all green (full suite 5739 passed)
`tests/unit/provenance/{engine,server,format,panelSmoke}` — taxonomy integrity, diff/sanitize,
generic emitter (search-mode + model + estimator + effect-measure + study-exclusion + bulk),
deterministic classification (cosmetic→no refresh, no-op→L0, typo≠methodological, numericChange
upgrade), analysis-run resolution, derived state, atomic mutateWithEvents (state+events + CAS
retry + no-op + cosmetic-only), listing/filtering/summary, idempotency, append-only reason +
soft-invalidate. Both Prisma schemas `prisma validate` clean.
(3 pre-existing full-suite failures are environmental only: integration tests needing a live
:3001 server, and a CRLF-worktree esbuild quirk on 2 UNMODIFIED files — both pass on LF/main.)

### Adversarial review round (13 agents, find→verify) — 8 confirmed, all fixed
1. [HIGH→med] `postReason` had NO leader/actor check — any active member could annotate any event's reason. FIX: `addReason` now requires `isLeader || ev.actorUserId===actor`; controller 403s otherwise; viewers lose the affordance (`canAmend`).
2. [med] `analysisRuns.cmpAt` returned 0 when either `at` was null → non-transitive comparator → `Array.sort` could pick an OLDER run as effective primary. FIX: total order (null→-Infinity).
3. [med] `mutateWithEvents` catch treated EVERY non-CAS error as "table vanished" and committed state WITHOUT events (broke atomicity). FIX: fall back to eventless write ONLY on missing-table (P2021/P2010/"no such table"); re-throw everything else (tx already rolled back → consistent).
4. [low] `recordEvents` `createMany` aborted the whole batch on one duplicate `idempotencyKey`. FIX: per-row insert fallback on error (SQLite-safe; no `skipDuplicates`).
5. [low] `addReason` TOCTOU on the empty-reason check. FIX: conditional `updateMany` (reason still empty) → only the first writer wins.
6. [low] read-only users saw "+ Add reason" (silent no-op on save). FIX: `ReasonEditor` hidden when `!canAmend`.
7. [low] `diff.stableStringify` used a whole-tree visited-set → shared-but-acyclic refs became `[circular]` (lossy hash). FIX: ancestor-stack (`seen.delete` after recursion).
Two claims REJECTED by verification (correctly): multi-outcome same-id study collapse (each per-outcome×timepoint row already has a UNIQUE id) and history STAGE_LABEL (it IS in TABS). +3 regression tests (52 total).

### Activation (deploy)
`prisma generate && prisma db push` (or `sync-postgres-schema.mjs` + PG push) creates the
`ProjectEvent` table; flip the `researchProvenance` flag ON in Ops › Flags. Until then the code
is fully dark (ledger-guarded no-ops) — zero behavioural change.

### Known limitations / deferred
- Capture coverage today = the generic blob-diff on autosave + the atomic writer (available for
  module writers) + baseline. Server module writers (screening handoff, extraction sync) do not
  YET route through `mutateProjectBlobWithEvents` — their changes are captured on the next client
  autosave diff, not atomically at the server write. Follow-up: migrate those writers.
- Manuscript engine consumes the EXISTING dependency/freshness path; events are not yet wired to
  push section-stale directly (the dependency graph already detects the same changes). Follow-up:
  surface event `reason` + supersession into the manuscript Update-review panel.
- Numeric result-impact (`resultImpact:'changed'`) is wired via `classify` opts but analysis reruns
  don't yet call `evidenceShift` to set it at capture time. Follow-up in the analysis controller.
- No dedicated Playwright e2e yet (unit + mocked-Prisma integration cover the logic).
- Per-database `search.dbMethods` map is supported by the engine but the Search UI doesn't populate
  it yet (project-level `searchMode` + database set are captured today).
