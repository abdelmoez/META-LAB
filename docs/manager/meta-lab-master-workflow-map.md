# META·LAB / META·SIFT — Master Workflow Map (20 stages)

*Author: Opus (architecture / methodology analyst). Date: 2026-06-13. Prompt: prompt12, Phase 2.*

The complete systematic-review / meta-analysis workflow, stage by stage. Grounded in
`.claude/tmp/prompt12/inspect/workflow-coverage.md`, the prompt11 inspection set, and the source.

**Notation:** `monolith` = `meta-lab-3-patched.jsx` (line refs are to it). `blob` = persisted inside
`Project.data` JSON (no dedicated table). SIFT tables are in `server/prisma/schema.prisma`.
**Status:** IMPLEMENTED-working · NI (needs improvement) · MISSING.

**Single most important fact:** 17/20 stages are IMPLEMENTED-working, 3 are NI, **1 is MISSING**
(stage 17, Reproducibility package). The workflow is real and end-to-end today; this map is for
orientation and to pinpoint the small additive gaps — not a build list for a missing system.

---

### Stage 1 — Project Landing / Selector — **IMPLEMENTED-working**
- **Purpose:** post-login command center listing every project the user can touch.
- **Current state:** `src/frontend/pages/ProjectLanding.jsx` (prompt11) — KPI tiles, search/filter/
  sort/triage, role-gated lifecycle via dedicated endpoints (never writes the blob). Routed at `/app`.
- **Inputs:** `GET /api/projects` (owned + shared via `listSharedMetaLabAccess`, annotated with
  `_permissions.role`, `_linkedMetaSift`, `_studyCount`, `_archived`).
- **Outputs:** navigation to `/app/project/:projectId`.
- **Access:** any authenticated user (sees only their accessible projects).
- **Data saved:** none here (lifecycle = dedicated endpoints).
- **Link to next:** opens a project → Stage 2.
- **Missing pieces / tests:** verify `/app` actually mounts `ProjectLanding` and that selection
  survives refresh (the monolith strips `?project=`). Covered by `tests/unit/projectLanding.helpers.test.js`
  + backend integration. **One wiring risk to confirm (Fable/AppWorkspace-owned).**

### Stage 2 — Project Overview / Command Center — **IMPLEMENTED-working**
- **Purpose:** "where am I, what's incomplete, what's next, is it ready."
- **Current state:** `OverviewTab()` (monolith :6912); `auditProject()` (:6745-6794) scores PLAN→
  REPORT items; PRISMA summary line (:7044).
- **Inputs:** the project blob + linked-SIFT summary.
- **Outputs:** readiness rollup + next-step cues; entry points to every stage tab.
- **Access:** any member with `canViewMetaLab`.
- **Data saved:** none (read rollup).
- **Link to next:** routes into Protocol / Search / Extraction / Analysis / PRISMA tabs.
- **Missing pieces / tests:** none structural; cosmetic only.

### Stage 3 — Protocol Builder (PICO + PROSPERO) — **NI**
- **Purpose:** structured review protocol + PROSPERO registration drafting + completeness.
- **Current state:** `PICOTab()` (:1749) + `PROSPEROTab()` (:5650) with full `PROSP_FIELDS`, AI
  drafting per field, char-limit aware. Stored `project.pico`/`project.prospero` blob, cached to
  `ScreenProject.picoSnapshot`.
- **Inputs:** user entry; AI draft.
- **Outputs:** protocol blob; PICO snapshot feeds SIFT keywords; `prosperoId` (manual).
- **Access:** members with `canEditMetaLab`.
- **Data saved:** blob (+ snapshot to the workspace).
- **Link to next:** PICO → Search strategy; PICO snapshot → SIFT screening keywords.
- **Missing pieces:** no real PROSPERO submission round-trip; no protocol version-history table.
  *Additive-only fix later (deep-link + status field; optional version table, nullable → db-push-clean).*
- **Tests:** PICO/PROSPERO field round-trip; recommend a snapshot-sync test.

### Stage 4 — Search Strategy & Import — **IMPLEMENTED-working**
- **Purpose:** database-specific search strings + record import with provenance and dedup-by-file.
- **Current state:** `SearchTab()` (:1919); SIFT import `ScreenImportBatch` (`fileHash` sha256,
  `fileSize`, `parser`; `schema.prisma:318-336`); parsers `src/research-engine/import-export/parsers.js`.
- **Inputs:** RIS/NBIB/CSV files; search metadata.
- **Outputs:** `ScreenRecord` rows + an import batch with a content hash.
- **Access:** members with `canImportRecords`.
- **Data saved:** SIFT tables.
- **Link to next:** imported records → Stage 5 dedup.
- **Missing pieces / tests:** none material; `parsers.test.js` covers the parsers; file-hash dup
  warning exists.

### Stage 5 — Duplicate Management — **IMPLEMENTED-working**
- **Purpose:** remove duplicate records, keep a primary, update PRISMA dedup count.
- **Current state:** `ScreenDuplicateGroup` + `ScreenRecord.isPrimary/isDuplicate/duplicateGroupId`
  (`schema.prisma:215-301`); LAB-side `findDuplicates()` for extraction studies.
- **Inputs:** imported records.
- **Outputs:** dedup groups, primary flags; dedup count → PRISMA.
- **Access:** members with `canManageDuplicates`.
- **Data saved:** SIFT tables.
- **Link to next:** de-duplicated records → Stage 6 screening.
- **Missing pieces:** fuzzy-title tuning only. Tests recommended: exact DOI/PMID, fuzzy title,
  not-duplicate, dedup-count→PRISMA.

### Stage 6 — Title/Abstract Screening (2-reviewer, conflicts) — **IMPLEMENTED-working**
- **Purpose:** independent dual screening with conflict detection.
- **Current state:** `ScreenDecision @@unique([recordId,reviewerId,stage])` (:256-273),
  `ScreenConflict` (:303-316), `blindMode`, `screeningReviewController.js`. (The legacy manual LAB
  ScreeningModule is retained in source but no longer rendered — monolith :2585-2587.)
- **Inputs:** de-duplicated records; reviewer decisions.
- **Outputs:** per-reviewer decisions; conflicts.
- **Access:** members with `canScreen` (resolve = `canResolveConflicts`).
- **Data saved:** SIFT tables.
- **Link to next:** included/conflicted records → Stage 7.
- **Missing pieces:** Cohen's kappa / % agreement metric (data exists in `ScreenDecision`; additive
  read-side). Tests: one-decision-per-reviewer uniqueness; conflict creation; (new) agreement metric.

### Stage 7 — Full-Text / Second Review — **IMPLEMENTED-working**
- **Purpose:** promote to full text; second review resolves and finalizes.
- **Current state:** `ScreenRecord.currentStage` (title_abstract|full_text), `promotedVia`
  (quorum|conflict_resolution), `promotedAt`, `finalStatus`, `acceptedAt` (:236-241);
  `smoke-secondreview.mjs`.
- **Inputs:** Stage 6 output.
- **Outputs:** promoted/accepted records with provenance.
- **Access:** `canSecondReview` / `canResolveConflicts`.
- **Data saved:** SIFT tables.
- **Link to next:** `acceptedAt` gates Stage 8 handoff.
- **Missing pieces / tests:** none material; smoke test exists.

### Stage 8 — Study Inclusion Finalization → handoff — **IMPLEMENTED-working**
- **Purpose:** move accepted studies from SIFT into LAB extraction.
- **Current state:** `acceptedAt` gates handoff; `handoffStatus/handoffAt/handoffStudyId/handoffError`
  (:242-246); `MetaSiftPrismaSync` (:2588+) idempotent pull-merge into LAB (by screeningRecordId/
  DOI/PMID/title).
- **Inputs:** accepted SIFT records.
- **Outputs:** `study` entries in the LAB blob; handoff status per record.
- **Access:** members with LAB edit + SIFT view (e.g. `data_extractor` preset).
- **Data saved:** LAB blob (studies) + SIFT handoff fields.
- **Link to next:** studies → Stage 9 extraction.
- **Missing pieces / tests:** idempotency is the hard part and is implemented; recommend a
  duplicate-handoff-is-noop test.

### Stage 9 — Data Extraction — **IMPLEMENTED-working**
- **Purpose:** structured extraction of effect data per study.
- **Current state:** `ExtractionTab()` (:3322); studies in `project.studies` blob (`mkStudy`,
  `defaults.js:96`); per-study `validateStudy()` (`study-validator.js`).
- **Inputs:** handed-off studies; manual entry.
- **Outputs:** study rows with es/lo/hi/esType, etc.
- **Access:** `canManageExtraction` / `canEditMetaLab`.
- **Data saved:** LAB blob (autosave, whole-blob, last-write-wins).
- **Link to next:** studies → Stages 10 (RoB), 11 (readiness), 12 (analysis).
- **Missing pieces:** per-design templates (RCT/cohort/DTA/…) are partial; the validation layer
  exists. Tests: `validation.test.js` covers per-study validation.

### Stage 10 — Risk of Bias (RoB2 / NOS) — **NI**
- **Purpose:** structured RoB assessment per study.
- **Current state:** `RoBTab()` (:3766) — full domain grid for **RoB2 (D1-D5)** and **Newcastle-
  Ottawa** (`ROB2`/`NOS` constants, `constants.js:140`); overall + /9 score. Data in `study.rob` blob.
- **Inputs:** included studies; reviewer judgments.
- **Outputs:** per-domain + overall RoB; feeds GRADE risk-of-bias domain.
- **Access:** members with LAB edit.
- **Data saved:** blob.
- **Link to next:** RoB → GRADE (Stage 14) + report RoB table.
- **Missing pieces:** **no ROBINS-I, QUADAS-2, PROBAST.** *Easy-additive:* add domain arrays to
  `constants.js` (non-locked file) and reuse the grid (grid wiring is monolith/Fable-owned). Blob →
  zero migration. Tests: RoB scoring; (new) tool-selection rendering.

### Stage 11 — Analysis Readiness Check — **IMPLEMENTED-working**
- **Purpose:** gate analysis on data quality (≥2 studies, same outcome, valid SE/CI, no NaN/Inf,
  pooling feasibility, pub-bias feasibility).
- **Current state:** `checkPoolability()` (:711) + `analysisTypeWarnings()` (:495) gate the Analysis
  tab (:3916-3924) with override UI (:4071); feed the Overview audit (:6778-6780).
- **Inputs:** extracted studies.
- **Outputs:** Ready / Ready-with-warnings / Not-ready verdict + reasons.
- **Access:** `canRunAnalysis`.
- **Data saved:** none (computed gate).
- **Link to next:** unlocks Stage 12.
- **Missing pieces:** none — fully implemented. **Do not rebuild.**

### Stage 12 — Meta-Analysis — **IMPLEMENTED-working**
- **Purpose:** pooled effect with fixed + random models.
- **Current state:** `src/research-engine/statistics/meta-analysis.js` `runMeta()` — fixed (IV) +
  random (DL) + HKSJ + prediction interval, Q/Qpval/I²/τ². Unit-tested
  (`tests/unit/meta-analysis.test.js`). (See `research-engine-method-validation-report.md` — math is
  correct.)
- **Inputs:** valid studies + model choice.
- **Outputs:** pooled estimate, CI, heterogeneity, weights, side-by-side fixed/random/HKSJ/PI.
- **Access:** `canRunAnalysis`.
- **Data saved:** analysis settings in blob; result computed on demand.
- **Link to next:** result → Stages 13, 14, 15, 16.
- **Missing pieces:** none. **Do not change the math.**

### Stage 13 — Sensitivity / Subgroup / Publication Bias — **IMPLEMENTED-working**
- **Purpose:** robustness + small-study-effect diagnostics.
- **Current state:** same engine — `leaveOneOut()`, `influenceDiagnostics()`, `subgroupAnalysis()`,
  `eggersTest()` (unweighted OLS, prompt10), `trimFill()`. UI: `SensitivityTab()` (:5941),
  `SubgroupTab()` (:6180), `ForestTab()`/funnel.
- **Inputs:** the analysis set + grouping key.
- **Outputs:** LOO table, influence flags, subgroup Q-between, Egger intercept/p, trim-fill k0.
- **Access:** `canRunAnalysis`.
- **Data saved:** none (computed).
- **Link to next:** feeds GRADE inconsistency/imprecision/pub-bias + report paragraphs.
- **Missing pieces:** optional numeric fixtures for trim-fill/HKSJ; everything else tested.

### Stage 14 — GRADE / Certainty — **NI**
- **Purpose:** certainty-of-evidence rating + Summary of Findings.
- **Current state:** `GRADETab()` (:6343) — 5 domains (`GRADE_DOMAINS`/`GRADE_OPTIONS`), data-driven
  `gradeSuggestions()` (RoB/I²/CI/k/Egger), auto start-level + downgrade → Very low…High. Stored
  `project.grade` blob.
- **Inputs:** RoB (Stage 10) + heterogeneity/pub-bias (Stages 12-13) + study counts.
- **Outputs:** certainty rating + downgrade reasons.
- **Access:** members with LAB edit.
- **Data saved:** blob.
- **Link to next:** GRADE → report.
- **Missing pieces:** no SoF **table export**; single-outcome only. *Easy-additive:* render an SoF
  table from `project.grade` + `runMeta`; wire into report export. Tests: `gradeSuggestions` mapping;
  (new) SoF render.

### Stage 15 — PRISMA Auto-Generation — **IMPLEMENTED-working**
- **Purpose:** PRISMA 2020 flow diagram auto-filled from the live workflow.
- **Current state:** `PRISMATab()` (:2677); `MetaSiftPrismaSync` (:2588) auto-fills counts
  (identified/dedupe/excTA/excFull/included, :2596-2602); `buildPrismaSVG` (:2374) +
  `PrismaFigureExport` (:2759) → publication PNG/SVG.
- **Inputs:** linked-SIFT summary counts.
- **Outputs:** PRISMA figure (SVG/PNG) + counts.
- **Access:** members with LAB view; export with `canExport`.
- **Data saved:** counts in blob (auto, with manual override).
- **Link to next:** figure → report + reproducibility bundle.
- **Missing pieces:** none material; manual override + audit exist.

### Stage 16 — Report / Manuscript Generator — **NI**
- **Purpose:** draft Methods/Results/heterogeneity/pub-bias/limitations + export.
- **Current state:** `ManuscriptTab()` (:6446, AI section drafter, `project.manuscript.drafts` blob);
  `openReportExport()` (:7865) → `buildReportHTML()` PDF(print)/HTML.
- **Inputs:** project data (only) + drafts.
- **Outputs:** HTML / print-PDF report.
- **Access:** members with LAB view; export with `canExport`.
- **Data saved:** drafts in blob.
- **Link to next:** report → export + reproducibility bundle.
- **Missing pieces:** no `.docx`, no reference manager, no journal templating; PDF is browser-print.
  *Easy-additive:* Markdown/`.docx` writer beside `buildReportHTML`. Tests: `methods-content.test.js`
  covers methods text; (new) export-writer test.

### Stage 17 — Reproducibility Package — **MISSING (the only true gap)**
- **Purpose:** one downloadable archive that lets a third party re-run the synthesis: protocol +
  search strings + import logs + screening decisions + excluded-with-reasons + extraction table + RoB
  + analysis settings + methods/equations + PRISMA + figures + included studies + audit log.
- **Current state:** **none.** Closest = single-project JSON backup `openProjectExport()` (:7891) +
  per-artifact CSV/SVG exports. No combined archive; **no JSZip** dependency (grep clean).
- **Inputs:** all already-available exports.
- **Outputs:** a `.zip` bundle.
- **Access:** members with `canExport`.
- **Data saved:** none (client-side zip).
- **Link to next:** terminal artifact for institutions/journals.
- **How to build (lowest-risk additive):** a new client module + a "Reproducibility bundle" button
  that JSZips the existing pieces (project JSON + analysis CSV + PRISMA SVG + GRADE + audit JSON).
  **No server, no migration, no core change** — and it should be authored as a new file, **not** in
  the four locked files. Tests: bundle contains the expected entries.

### Stage 18 — Audit Trail — **IMPLEMENTED-working**
- **Purpose:** who/what/when across the platform.
- **Current state:** three sinks — `AdminAuditLog` (ops), `ScreenAuditLog` (per-workspace, ~12
  actions, `schema.prisma:454-465`), `UsageEvent` (product metrics, FK-free, :441-452). Helpers
  `logAdminAction`/`writeAudit`/`recordUsage`.
- **Inputs:** privileged + collaborative actions.
- **Outputs:** queryable audit/usage rows.
- **Access:** leader-only workspace audit read; admin ops audit.
- **Data saved:** audit tables.
- **Link to next:** feeds ops + reproducibility bundle.
- **Missing pieces:** LAB-project **blob** mutations are not individually audited (whole-blob
  autosave). Per-field LAB audit = a larger architectural change → **postpone** (high blast radius;
  do not touch the autosave path). Tests: `adminVisibility.test.js`, `serverStorage.test.js`.

### Stage 19 — Project Control / Members / Permissions — **IMPLEMENTED-working**
- **Purpose:** manage members, roles, presets, and module participation.
- **Current state:** `ControlTab()` (:7296); members/roles/presets sourced from linked
  `ScreenProjectMember` (18 flags, 8 presets `permissionPresets.js`); enforced server-side
  (`access.js`). LAB project itself is single-owner.
- **Inputs:** owner/leader management actions.
- **Outputs:** member rows + permission grants; invites.
- **Access:** owner (full) / leader-or-`canManageMembers`; global flags owner-only.
- **Data saved:** `ScreenProjectMember` + invite token hashes.
- **Link to next:** governs access to every stage.
- **Missing pieces:** no transfer-ownership endpoint; no member-facing archive (admin-only). See the
  role review doc — keep the model, clarify labels, no rename this cycle. Tests: `adminAuth.test.js`,
  permission-preset tests.

### Stage 20 — Ops / Admin oversight — **IMPLEMENTED-working**
- **Purpose:** platform operation: users/roles/projects/SIFT/content/settings/flags/messages/
  security/health.
- **Current state:** `AdminConsole.jsx` `NAV_SECTIONS` (:3429) — 10 sections + animated KPI kit +
  `/metrics/timeseries`.
- **Inputs:** admin/mod actions (mod scoped by `MOD_PERMISSIONS`).
- **Outputs:** management actions + metrics.
- **Access:** admin (full); mod (support subset; cannot edit admin/mod, cannot change roles, cannot
  see dangerous metrics/settings).
- **Data saved:** admin tables + audit.
- **Link to next:** terminal oversight tier.
- **Missing pieces (small, additive):** SIFT projects list has no Restore button; LAB ops table
  doesn't split admin-archive vs owner-delete (`deletedSource`); organizations/teams not built
  (postpone). Tests: `adminAuth.test.js`, `adminVisibility.test.js`.

---

## Workflow data-flow summary

```
Landing(1) → Overview(2) → Protocol/PICO(3) ──snapshot──┐
                                                        ▼
Search+Import(4) → Dedup(5) → Screen(6) → 2nd Review(7) → Handoff(8) → Extraction(9)
                                                                            │
                                          ┌─────────────────────────────────┤
                                          ▼                                 ▼
                                       RoB(10)                     Analysis Readiness(11)
                                          │                                 ▼
                                          │                          Meta-Analysis(12)
                                          │                                 ▼
                                          │                   Sensitivity/Subgroup/Bias(13)
                                          ▼                                 │
                                       GRADE(14) ◄──────────────────────────┘
                                          ▼
                  PRISMA(15) ──► Report/Manuscript(16) ──► Reproducibility Bundle(17, MISSING)

  Cross-cutting: Audit Trail(18) · Members/Permissions(19) · Ops oversight(20)
```

## Where to act (and where NOT to)

- **MISSING — build (additive, new file, lowest risk):** Stage 17 Reproducibility bundle.
- **NI — improve (additive, mostly export/render or non-locked files):** Stage 10 RoB breadth
  (`constants.js` domain arrays), Stage 14 GRADE SoF table, Stage 16 Markdown/`.docx` writer.
- **Working — LEAVE ALONE / do not rebuild:** Stages 1,2,4,5,6,7,8,9,11,12,13,15,18,19,20 cores —
  especially Stage 11 (readiness), Stage 12 (the math), and Stage 15 (PRISMA), which are easiest to
  accidentally duplicate.
- **Locked files (Fable concurrently editing — DO NOT TOUCH):** `meta-lab-3-patched.jsx`,
  `AppWorkspace.jsx`, `server/controllers/authController.js`, `src/frontend/pages/Profile.jsx`. Any
  improvement that resides in the monolith is **design-only** this cycle.
- **Migration constraint:** any new column/table must be **nullable/defaulted, no `@unique`** →
  clean `prisma db push`. **Do not run `prisma migrate`.**
