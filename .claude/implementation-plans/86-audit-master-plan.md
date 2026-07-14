# 86.md — Full Application Audit & Prioritized Master Plan (PecanRev / META·LAB v3.83.0)

_Audit date: 2026-07-14 · commit `2e6ca07` · method: 14 parallel subsystem mappers (2.5M tokens) → 14 deep per-subsystem finders → adversarial verifiers. 237 findings (4 P0, 21 P1, 102 P2, 110 P3). Top correctness/security findings independently re-verified against source before inclusion._

---

## 1. Executive summary

PecanRev is a mature, feature-dense systematic-review & meta-analysis platform: React 18 + Vite SPA (`src/`, ~490 files) over an Express + Prisma API (`server/`, ~230 real JS files, 93 Prisma models), with pure deterministic research engines (`src/research-engine/` — statistics, screening, extraction, RoB, manuscript, search builder) shared with the server. The unit-test suite is strong and green (**4,987 passing**); the codebase is well-commented and prompt history is meticulously preserved.

The audit found the product **works well for the single-user happy path** but has three systemic weaknesses that cut across every engine:

1. **The fat-blob data model has no reliable concurrency control.** `Project.data` is one JSON `TEXT` column. The `autosaveRev` CAS clock is (a) implemented as a non-atomic check-then-write and (b) bypassed entirely by ~7 server-side "module writers" (screening handoff, revert, extraction send-to-MA, study-doc pointers, engine completion). The result is a family of silent lost-update races that materialize whenever two tabs/collaborators touch a project — and become materially worse on the Postgres production target (multi-writer). This is the single highest-leverage area. **(P0.2, P1.13/14/15/16/18/21, P2.60/88, P3.85)**

2. **Several headline features are silently non-functional or contradict each other's numbers.** Evidence-shift alerts can never fire (array/object API mismatch). Extraction "exclude from analysis" and "archive outcome" don't actually exclude — the analysis engine never reads `extractionMeta`. Server-side pooling (GRADE, living review, public synthesis) always uses DerSimonian–Laird, ignoring the estimator the user picked, so certainty ratings and alerts can contradict the Analysis tab. Legacy GRADE/Results/Overview views pool *all* studies across outcomes and measures in one call. GRADE ignores ROBINS-I judgments. **(P0.3, P0.4, P1.5/6/12/17, P2.15/16/17/43/49/50/51)**

3. **Authorization and blinding are enforced per-endpoint, not centrally, so they leak.** Blind mode is re-implemented inline at each endpoint and is missing from record exports and AI-score endpoints. `canRunAnalysis` and ~1/3 of tier entitlements are UI-only. A pre-auth 64 MB JSON parser fires on any `/import`-suffixed path. Removing a waitlisted applicant leaves their account invitation live. **(P1.1/8/10/20, P2.92/93, P3.1/104)**

Underneath these: the integration suite (704 cases) silently passes when the API is down and is un-gated in CI; there is no lint/typecheck/coverage; observability beacons to a route that doesn't exist; and everything assumes a single process (in-memory rate limits, SSE bus, AI-run mutex).

**None of these require a rewrite.** The architecture (pure engines + thin controllers + blob store) is sound; the fixes are targeted: make the CAS atomic and route module writes through one serialized helper; add a shared study-analyzability predicate and thread the estimator through server consumers; centralize blind-mode and authorization projections; and close the CI/observability gaps. This plan sequences them so the app stays shippable throughout.

### Current-state scorecard

| Dimension | State | Evidence |
|---|---|---|
| Core single-user workflow | **Good** | 4,987 unit tests green; full review lifecycle wired end-to-end |
| Multi-user / concurrent editing | **At risk** | CAS non-atomic + 7 writers bypass it → silent lost updates (P0.2, P1.13–21) |
| Statistical correctness (multi-outcome) | **At risk** | exclusions ignored, estimator ignored server-side, cross-outcome pooling (P0.3/4, P1.5/6/17) |
| AuthZ / privacy enforcement | **At risk** | per-endpoint blinding leaks; UI-only gates; pre-auth DoS (P1.1/8/20) |
| Scalability (large projects) | **Weak** | O(n²) dedup on request thread, full-blob loads, N+1s (P2.42/96/102, P2.66) |
| Observability | **Weak** | dead error beacon, boundaries don't report, no release id (P1.7, P2.26, P3.34) |
| Test gating | **Weak** | 704 integration cases un-gated & silently skip; no lint/types/coverage (P1.4, P2.9, P3.22) |
| Deployment reproducibility | **Weak** | deploy script un-versioned; schema-to-prod path unencoded (P2.11, P3.69) |
| Documentation accuracy | **Fair** | many stale header comments; README domain claim false (P3.10/24/53/92) |

---

## 2. Architecture & workflow map

**Frontend shell** (`src/`): React 18 SPA, React Router. Guards `ProtectedRoute`/`PublicRoute`/`AdminRoute`/onboarding gate. Two coexisting design systems (legacy + Stitch) governed by `User.uiDesignMode` + `DesignModeContext`, with a pre-paint theme injected server-side. Error boundaries (`ScopedErrorBoundary` per workflow stage, `AppErrorBoundary` top-level). Realtime via a single SSE `EventSource` (`useRealtime`). API access through `apiClient` + two other fetch wrappers. Largest file: `AdminConsole.jsx` (9,856 lines, single lazy chunk).

**Backend** (`server/`): single Express process on :3001. Middleware order (load-bearing, comment-enforced): helmet → CSP → embed frame-relax → `apiNoStore` → CSP-report → CORS → path-sized JSON parsers → cookieParser → requestLogger → `maintenanceGate` → route mounts → SPA static → 404 → errorHandler. Auth = JWT-in-httpOnly-cookie + DB-backed revocation (`suspended` + `sessionEpoch`, 15s cache). Three auth-wiring patterns coexist (router-internal, per-route, mount-level). Durable background workers (import, pecan-search, citation-chase, AI-scoring, export, eligibility, full-text, living-scheduler) start after SQLite pragmas.

**Data** (`server/prisma/schema.prisma`, 93 models): SQLite (dev) / Postgres (prod-target, selected at runtime by `DATABASE_PROVIDER` in `db/client.js`). Two DBs: main + strictly-isolated waitlist. Central entity is the fat-blob `Project` (`data String`), with a relational `ScreenProject` mirror for screening (records, decisions, chat, members, PDFs). `WorkflowModuleState` holds per-module docs (revision-CAS'd via `patchModuleState`). Schema reaches prod via `prisma db push` (migrations directory abandoned).

**Project lifecycle:** create `Project` (+ optionally linked `ScreenProject`) → Search (build strategy / automated Pecan multi-DB) → Screening (import → dedup → dual-review → conflict → second review → **handoff** appends a study into `Project.data.studies[]`) → Extraction (classic split-screen or flagged Pecan engine; values live in the blob; `extractionMeta` bookkeeping) → Analysis (`runMeta` per outcome/timepoint/esType) → RoB/GRADE → Manuscript (`Project.data.manuscripts[]`, Word export) → Public synthesis / Living review.

**Roles & flags:** four independent authorization axes — system role (user/mod/admin), project ownership (`Project.userId`), linked-workspace membership + per-capability grants (`canEdit`/`canChat`/`canAssessRiskOfBias`/`canRunAnalysis`), and product tier/entitlements. Feature flags (`FLAG_META`, `featureAccess`) gate ~15 engines (existence-hiding 404).

**Cross-module data flow (the connected system):** screening handoff → `Project.data.studies[]` → analysis pool → GRADE/manuscript/public-synthesis/living-review derivations. Extraction values → same `studies[]`. Search strategy → `WorkflowModuleState('search')` → screening PRISMA + manuscript methods text. The audit's Phase-4 finding: **derived consumers have drifted from the source** — estimator, exclusions, and outcome-grouping applied in the Analysis tab are not applied by the other consumers, so the same project shows different numbers in different places.

---

## 3. Consolidated issue inventory

Counts by category (across all 237 findings): correctness 28, security 16, silent-failure 16, scalability 16, race-condition 14, data-integrity 12, stale-state 12, dead-code 10, docs-gap 10, performance 8, duplication 8, authz 7, sync 7, error-handling 7, ui-consistency 7, plus validation, missing-transaction, orphaned-record, workflow, accessibility, browser-compat, coupling, testing-gap, feature-opportunity.

Full evidence for every finding is preserved in the audit working set. The sections below give the actionable, prioritized subset; §11 lists the remaining P2/P3 by number.

---

## 4. Prioritized findings — P0 & P1 (with fix specs)

> Format per item: **problem → evidence → impact → root cause → fix → files → tests → acceptance → migration/flag/risk.**

### P0 — Critical

**P0.1 — Search autosave reports success on a dropped write (silent data loss).** `putSearch` returns `{ok:true}` regardless of whether `patchModuleState` committed; `patchModuleState` still runs an internal CAS (`updateMany where revision:currentRev`) even with `baseRevision:null`, so a concurrent PUT between its read and write yields `{conflict:true}` with no write — and the client marks the edit saved and never resends. _File:_ `server/searchEngine/searchEngineController.js:267`, `server/services/workflowState.js:167-176`, `SearchBuilderTab.jsx:1230-1244`. _Fix:_ branch on `out.conflict/out.ok`; on conflict, re-read + re-apply the whitelisted patch (bounded retry) for single-key writes, else 409; client treats non-ok/409 as save-failed and keeps the pending payload. _Tests:_ integration — force a rev bump between read/write, assert non-ok + payload retained. _Acceptance:_ no `ok:true` without a committed write; concurrent mode-pick + autosave never loses either. _Severity note:_ verifier adjusted true probability to P1 (ms-wide window) but kept P0 class due to silent-loss + false-success. _Risk:_ low.

**P0.2 — Module-writer blob mutations never bump `autosaveRev` and Stitch pages never refetch on realtime pokes → a stale whole-blob autosave erases handed-off studies.** `handoffToMetaLab` (and revert, doc-upload, send-to-MA) do bare `prisma.project.update` without incrementing the rev; `useStitchProjectDoc` isn't subscribed to `project.updated`. _File:_ `screeningReviewController.js:110-118`, `useStitchProjectDoc.js:37-95`, `store.js:153-171`. _Fix (two-part):_ (a) module writers bump `autosaveRev` inside a transaction so stale autosaves 409; (b) subscribe `useStitchProjectDoc` to the realtime bus (reload-when-clean, banner-when-dirty). _Files:_ the 7 writers + `useStitchProjectDoc.js` + `store.js` helper. _Tests:_ integration — handoff then stale autosave must 409, not clobber. _Acceptance:_ a study handed off while an owner has the workspace open survives the owner's next autosave. _Risk:_ **medium** (touches many writers) — see §10. _Migration:_ none.

**P0.3 — Pecan Extraction Engine (flag ON) has no raw-data→effect-size path; 2×2/continuous studies extracted there can never enter meta-analysis.** The engine replaces the classic tab (which had `ESCalcInline`), but only the Converter was ported; `runMeta`/`checkPoolability` pool only rows with `es/lo/hi`, and the engine never derives them from a/b/c/d or mean/SD. _File:_ `extractionTabs.jsx:576`, `articleStatus.js:48`, `monolithStats.js:31`. _Fix:_ port an ES-calculation step into the engine — auto-derive `es/lo/hi` from complete raw sets via `calcES` at complete-time (recording a `conversions[]` audit) and make the completion gate warn when raw data is complete but `es` is underivable. _Tests:_ unit — engine study with a/b/c/d completes → `es/lo/hi` present and pools. _Acceptance:_ an OR/RR/SMD study extracted in the engine appears in its outcome's pool. _Risk:_ medium (new engine step); gated by `extractionEngine` flag.

**P0.4 — Evidence-shift alerts can never fire.** `livingService.createSnapshot` calls `detectEvidenceShift(prevSummary.ma||[], summary.ma||[])` — passing **arrays** to a function that expects a single per-outcome summary object or null; every `isNum` check fails, `res.any` is always false, no alert is ever created. `snapshotDiff.js` already has the correct pairing (`diffMetaAnalyses`) but it isn't reused. _File:_ `server/living/livingService.js:513`, `evidenceShift.js:69`, `snapshotDiff.js:53`. _Fix:_ export/reuse `diffMetaAnalyses` (pair by outcome‖timepoint, call detector per pair, aggregate) in `createSnapshot`. _Tests:_ unit + integration — two summaries with a direction/significance flip must produce a `major` shift and an `EvidenceShiftAlert`. _Acceptance:_ the headline living-review promise works. _Risk:_ low (pure reuse). **Also fold in P2.15/P3.30:** `crossesNull` hardcodes null=0, wrong for AUC (0.5) and PROP (logit) — make the null measure-aware.

### P1 — High (grouped by theme)

**Concurrency / data-integrity (the CAS family)**

- **P1.13 — `autosaveRev` CAS is check-then-write, not atomic.** `save()`/`saveAsMember()` do `findFirst` → JS compare → `upsert where {id}` (not `where {id, autosaveRev:base}`), no transaction. Two saves at the same `baseRev` both pass, loser silently overwritten. _File:_ `server/store.js:127-170,226-242`. _Fix:_ when `baseRev` supplied, do a conditional `updateMany({where:{id, autosaveRev:base}})`, `count===0`→`SAVE_CONFLICT` (re-read for `serverProject`); keep `upsert` for create only. _Tests:_ unit — two saves same baseRev → second throws `SAVE_CONFLICT`. _Acceptance:_ concurrent same-rev saves cannot both land. _Risk:_ low. **Foundation for P0.2/P1.14–21.**
- **P1.14/15/16/18/21 — module blob writers do unserialized, non-transactional, rev-skipping read-modify-write.** Consolidate: extract one `store.mutateProjectBlob(projectId, mutator, {bumpRev:true})` helper wrapping `$transaction(read→mutate→write, autosaveRev:+1)`; route `handoffToMetaLab`, `revertFinalReview`, `postSendToMa`, all four `studyDocController` writers, and `completionService` through it; wrap handoff blob-append + `screenRecord.update` in one transaction; move disk deletes after commit. _Files:_ `screeningReviewController.js`, `extractionController.js:642`, `studyDocController.js`, `extraction/engine/completionService.js`, `store.js`. _Tests:_ integration — two concurrent handoffs both survive; handoff+stale-autosave 409s. _Acceptance:_ no module write is lost by a concurrent autosave or sibling module write. _Risk:_ **medium** — largest change; do as its own phase with the helper first.

**Statistics correctness**

- **P1.17 — analysis never reads `extractionMeta`; "exclude from analysis" and archived outcomes still pool.** _(Independently verified: zero `extractionMeta` readers under `src/frontend`.)_ _File:_ `analysisTabs.jsx:87`, `study-validator.js:193`. _Fix:_ add a shared pure predicate (e.g. `isAnalyzableStudy(s)` → false when `s.extractionMeta?.includedInAnalysis===false` or `s.extractionMeta?.archived===true`) and apply it at the single `filteredStudies` choke point **and** in `checkPoolability`/`runMeta` valid-filter and every other pooling consumer; surface excluded/archived rows in DataBehindAnalysis with a reason. _Tests:_ unit — excluded/archived study absent from pool + `checkPoolability`. _Acceptance:_ an excluded study contributes to no pooled estimate, forest plot, or export. _Risk:_ low.
- **P1.5 — all server-side pooling ignores the persisted τ² estimator (always DL).** _(Verified: `gradeService.js:114`, `livingService.js:459`, `publicSynthesisService.js:167` all `runMeta(.,'random')` with no opts.)_ _Fix:_ thread `project.analysisSettings.tau2Method` into `gradeService`, `livingService.buildSnapshotSummary`, `publicSynthesisService.deriveMa` (all already load the blob); accept an optional validated `tau2Method` in `/api/meta/*`; record the estimator in living snapshots so old/new aren't compared across estimators. _Tests:_ unit — REML project → GRADE/living/public pooled CI equals Analysis tab. _Acceptance:_ one estimator, one number, everywhere. _Risk:_ low.
- **P1.6 — legacy GRADE tab, Results write-up, Overview badge, report HTML, gradeSuggestions pool ALL studies across outcomes/measures in one `runMeta`.** _Fix:_ route through the same per-(outcome,timepoint,esType) grouping + `checkPoolability` gate the Analysis tab uses; hide badge/suggestions when studies span multiple esTypes. _Files:_ `reportTabs.jsx:169,301`, `overviewTabs.jsx:324`, `projectHelpers.js:136`, `Workspace.jsx:664,1574`. _Risk:_ low-medium (display logic).
- **P1.12 — GRADE RoB domain ignores ROBINS-I (serious/critical invisible or counted low).** `VALID_OVERALL` = only RoB2 levels. _Fix:_ make `summariseRobForGrade` instrument-aware (map ROBINS-I low→low, moderate→some, serious/critical→high; include `instrumentId` in the projection). _File:_ `rob/gradeSync.js:29`, `gradeService.js:207-222`. _Risk:_ low.

**Security / privacy**

- **P1.1 — blind mode not applied to record exports.** `buildExportRow` emits `authors`/`journal` unconditionally; `canSeeIdentity` gates only reviewer-name columns. _Fix:_ thread `blindRecords = project.blindMode && !isLeader` into `buildExportRow` (blank authors/journal, skip AU/JO in RIS). Longer term: one shared `projectRecordForViewer(record, access)` used by listRecords, second-review, and both export paths. _File:_ `screeningExportService.js:174-177`. _Risk:_ low.
- **P1.8 — unauthenticated 64 MB JSON parse on any `/import`-suffixed path (pre-auth/pre-limit/pre-maintenance DoS).** The path-suffix regex runs at app level before auth. _Fix:_ scope the 64 MB parser to exact known import route prefixes (`req.path.startsWith('/api/screening/') && /\/import(\/start)?$/`), keep the 10 MB default (consider lowering for unmatched paths), and add a cheap global fallback limiter. _File:_ `server/index.js:313-318`. _Risk:_ low.
- **P1.9 — screening instantiates its own SQLite-schema `PrismaClient`, bypassing the provider-selected shared client.** Split-brain under Postgres; missing busy_timeout under SQLite. _Fix:_ replace `new PrismaClient()` in `routes/screening.js` and `screeningController.js` with the shared `db/client.js`; add a CI grep forbidding `new PrismaClient(` outside `db/`+`waitlist/`. _Risk:_ low (behavior-preserving in dev), high value for Postgres cutover.
- **P1.10 — removing a waitlist applicant leaves their account invitation live.** `adminRemoveApplicant` deletes the waitlist row but never revokes the main-DB `WaitlistInvitation`. _Fix:_ call `invitationService.revokeInvitationForApplicant(applicantId, {revokedByUserId})` in `adminRemoveApplicant`, include revoked count in audit; optionally warn when a pending invite exists. _File:_ `waitlistAdminController.js:190`. _Risk:_ low.
- **P1.20 — eligibility-engine decisions count as human reviewers → one human + one auto-apply satisfies the two-reviewer quorum.** _Fix:_ add `reviewerId: { not: ELIGIBILITY_ENGINE_REVIEWER_ID }` to the promotion-gate query, `syncConflicts` load, overview/PRISMA `taReviewers` loops, and the AI-score threshold count — or add an `origin:'engine'` column and filter centrally. _File:_ `screeningController.js:1637` + 4 others. _Risk:_ low-medium (touches promotion accounting; add tests). Also fixes P2.94 (AI trains on engine labels) by excluding engine rows from `loadEngineInput`.

**Reliability / observability / CI**

- **P1.7 — `/api/client-errors` beacon has no server route; all crash telemetry is lost.** _Fix:_ add a small rate-limited, size-capped, log-only `POST /api/client-errors` keyed by correlationId (and wire `AppErrorBoundary`/`StitchErrorBoundary` to `reportClientError`, P2.26) — or remove the beacon+correlation-id UI. _File:_ `errorReporting.js:69`. _Risk:_ low.
- **P1.3 — shared `production-deploy` concurrency group lets any PR run evict a queued production deploy.** _Fix:_ move the `concurrency` block onto the `deploy` job only / make it event-scoped. _File:_ `.github/workflows/deploy.yml:8`. _Risk:_ low (CI only).
- **P1.4 — 704 integration cases silently pass when the API is down; no CI job starts one.** _Fix:_ replace `if(!up) return` with `describe.skipIf(!up)`/`ctx.skip()` (visible skips) + a run-level guard that fails when 100% skip; add a CI job that boots the API (ephemeral SQLite + `node server/index.js` + wait-on `/api/health`) and runs the integration suite. _File:_ `tests/integration/api-auth.test.js:10` (×353), `deploy.yml:16`. _Risk:_ low-medium.
- **P1.2 / P1.11 / P1.19** — search strategy full LWW clobber (pair with P0.1 fix); RoB "Re-run appraisal" force-overwrites human answers (default `force=false` + confirm dialog + before/after audit); OA PDF download has no timeout and buffers before size-cap (AbortController + streaming abort + periodic stuck-job sweep). All low-medium risk, independent.

---

## 5. Implementation roadmap (phases)

Each phase is independently shippable and leaves the suite green. Order chosen so foundations land first and high-risk work is isolated.

- **Phase A — Quick, isolated correctness & security wins.** ✅ **SHIPPED (v3.84.0):** P1.17 (exclusions), P1.5 (estimator threading), P0.4 (evidence-shift pairing), P1.1 (blind export), P1.8 (import DoS), P1.9 (shared PrismaClient), P1.10 (invite revoke), P1.13 (atomic CAS), P1.7 (client-errors route), P1.12 (GRADE ROBINS-I), P1.11 (RoB re-run non-destructive), P1.3 (deploy concurrency) — all with unit tests; full suite green. **Deferred from A:** P1.20 (quorum exclusion — changes screening methodology semantics; needs the reconciliation approach in §10, not a silent quick-win); P2.15 measure-aware evidence-shift null (folded into Phase C stats work). P0.1/P1.2 (search autosave false-success/LWW) moved to their own small phase — they touch the client save path and deserve a focused change.
- **Phase B — The blob-writer concurrency phase.** ✅ **SHIPPED (v3.86.0, `c8fd79b`).** `store.mutateProjectBlob` CAS helper; routed handoff/revert/postSendToMa/4×studyDoc/completionService through it; useStitchProjectDoc realtime subscription; `updateProject` CAS. Verified by a DB-direct integration test. (Full `projectRecordForViewer` projection unification remains a future refactor.)
- **Phase C — Statistics consumer unification.** ✅ **SHIPPED (v3.87.0, `d4035af`).** P1.6 `poolPrimaryOutcome` in all six summary consumers; P2.15 measure-aware evidence-shift null (AUC); P2.19 cross-copy parity test. (P2.17 export/R-script estimator threading remains.)
- **Phase D — Scalability.** ✅ **SHIPPED (v3.88.0, `c4dd236`).** P2.56 missing indexes on 7 hot tables; P2.42 cached Ops metric scan. **Deferred:** P2.96 O(n²) dedup → worker pool, P2.102 listRecords full-project load (both need larger worker/pagination work).
- **Phase E — AuthZ/privacy centralization.** ✅ **SHIPPED (v3.89.0, `1e61c04`).** P2.2/34 session revocation on role change; P2.93 AI-score/explanation blind gating. **Deferred:** P3.1 (canRunAnalysis is inherently UI-only for client-side compute), P2.3 (unenforced-entitlement Ops-editor honesty).
- **Phase F — CI/observability.** ✅ **PARTIAL (v3.90.0).** P2.26 top-level error boundary now reports through the `/api/client-errors` route (added in Phase A) with a correlation id. **Deferred:** P1.4 integration CI job + visible skips, P3.22 lint/typecheck/coverage, P2.11/P3.69 deploy-script version control, P3.34 release-id injection — all CI/build-config changes best done where the pipeline can be exercised.
- **Phase G — UX & docs.** ✅ **PARTIAL (v3.90.0).** P3.56 RoB-assessment delete confirmation; P3.24 README domain-hardcoding honesty note. **Deferred:** P3.81 extraction remove-study confirm, P2.100 pagination-stable teammate decisions, P2.24 deep-link preservation, remaining stale-comment sweep.

---

## 6. Testing & validation strategy

- **Unit-first, per fix.** Every Phase-A item ships with a unit test that fails before and passes after (pure engines make this cheap: exclusion predicate, estimator threading, evidence-shift pairing, quorum exclusion, CAS conflict).
- **Integration for concurrency (Phase B).** Boot the live API; drive real handoff/autosave races; assert 409 + no data loss.
- **Fix the harness (P1.4) before trusting it:** visible skips + a "100% skipped = fail" guard, then a CI job that boots the server. Until then, integration runs must be treated as advisory unless a server was manually started (this audit ran the baseline that way: 517 passing in-process; the 2 external-server-gated waitlist tests require a running server, and the full suite cannot currently run in one pass because some tests need an external server while others collide with it — itself a P1.4/P2.9 symptom).
- **Regression gates:** `npm run test:ci` (unit) must stay green after every commit; add cross-copy statistics parity tests (P2.19) so single-copy fixes can't diverge again.
- **Manual verification** for Phase B (multi-tab) and P0.3 (extract a 2×2 study in the engine → confirm it pools).

---

## 7. Recommended architectural improvements

1. **One serialized, transactional, rev-bumping blob writer** (`store.mutateProjectBlob`) — eliminates the entire lost-update family and gives a single seam for future field-level merge. _(Phase B)_
2. **One shared record projection** (`projectRecordForViewer`) and **one shared study-analyzability predicate** (`isAnalyzableStudy`) — blinding and exclusion can never again be forgotten by a new consumer. _(A/E)_
3. **Collapse the duplicate statistics engine** (`monolithStats.js` vs `meta-analysis.js`) to one source of truth, or pin them with cross-copy parity tests — removes a whole class of "fixed in one copy" bugs. _(C)_
4. **Move CPU-heavy per-request work to the worker pool** (dedup, duplicate detection) and paginate blob/record loads — the scale story for 10k–100k-record projects. _(D)_
5. **Single-process assumptions → shared state** (rate-limit store, SSE bus, AI-run advisory lock) before any horizontal scaling. _(later)_
6. **Encode deployment in the repo** (versioned deploy script + explicit schema-to-prod step) so releases are diffable and recoverable. _(F)_

---

## 8. UX & product improvements

- Protect destructive actions (RoB delete, extraction "Remove Study", "Re-run appraisal") with confirmation and undo where feasible (P3.56/81, P1.11).
- Make progress honest: one canonical progress number across dashboard and header (P2.63/64); accurate save-status that reflects real failures (P2.77, P3.84).
- Surface excluded/archived studies and the reason in the Analysis "data behind" view (P1.17) so exclusion is visible, not silent.
- Preserve deep links through login (P2.24); keep teammates' list position stable during live decisions (P2.100).
- Empty/error states that name the cause and the next action (P2.21, P3.87); enforce or hide decorative Ops toggles (P2.39).
- Competitive: a durable-job admin console + stuck-job sweeps (P3.103); reconciliation for cross-DB waitlist drift (P3.71); UI for GRADE upgrade domains already in the engine (P2.52).

---

## 9. Quick wins (high value / low risk / small diff)

P1.3 (deploy YAML), P1.7 (client-errors route), P1.9 (shared PrismaClient), P1.10 (invite revoke), P1.13 (atomic CAS), P1.17 (exclusion predicate), P1.5 (estimator threading), P0.4 (evidence-shift reuse), P1.20 (quorum exclusion), P1.1 (blind export), P1.8 (scope import parser), P1.11 (RoB re-run default), P1.12 (GRADE ROBINS-I), P2.10 (localhost→127.0.0.1 in 24 tests), P2.12 (gitignore `.env.test`), P3.70 (remove stale `dev.db.bak`).

## 10. High-risk changes (special caution)

- **Phase B blob-writer refactor (P0.2/P1.14–21):** touches screening, extraction, study-docs. Land the shared helper first with tests; migrate writers one at a time; verify multi-tab manually; no schema change but behavior change (writes now 409 instead of silently winning) — clients must handle the 409 (the conflict UI already exists for autosave).
- **P1.20 quorum exclusion:** changes promotion accounting — could re-open records previously auto-promoted. Add tests and consider a one-time reconciliation report rather than silent re-evaluation.
- **P0.3 engine ES derivation:** new completion-time computation; gate behind `extractionEngine`, add a warn path, don't auto-overwrite reviewer-entered `es`.
- **P1.9 provider client swap:** verify no screening code depends on the second connection's separate transaction scope.
- **Statistics consumer changes (P1.5/6, Phase C):** numbers users see will change (correctly). Note in release notes; keep golden tests.

---

## 11. Remaining P2/P3 index (by number)

The 102 P2 and 110 P3 findings are catalogued with file:line evidence in the audit working set and summarized in the one-line inventory. Themes and representative items:

- **Concurrency/integrity:** P2.4/5/6/48/79/98, P2.60/61/88, P3.39/93.
- **Statistics:** P2.15/16/17/43/49/50/51/55, P3.27/30/31/32.
- **Screening scale/correctness:** P2.92/93/94/95/96/97/98/100/101/102, P3.104/105/106/107/108.
- **Search/living/public/full-text:** P2.7/8/80/81/82/83/84/85/86/87/90/91, P3.93/94/95/96/97/98/99/101/102.
- **AuthZ/security:** P2.2/29/30/31/32/33/34, P3.1/2/4/5/40/41/42.
- **Frontend/UX/a11y:** P2.20/21/22/23/24/26/100, P3.35/36/37/56/60/79/81/85.
- **Admin/Ops:** P2.35/36/37/38/39/41/42, P3.48/49/50/51/59.
- **Tech-debt/docs/testing:** P2.9/11/12/13/14/28, P3.22/23/24/25/54/69/70/92.

---

## 12. Recommended order of execution

**Phase A now** (this PR: verified quick wins) → **Phase B** (concurrency, isolated) → **Phase C** (statistics unification) → **Phase F** (CI/observability, so future phases are gated) → **Phase D** (scalability) → **Phase E** (authZ centralization) → **Phase G** (UX/docs sweep). Ship each phase behind its existing feature flags where one applies; keep `npm run test:ci` green as the invariant between every commit.
