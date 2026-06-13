# META·LAB / META·SIFT — Complete-Workflow Feasibility & Risk Report

*Author: Opus (methodology / architecture analyst). Date: 2026-06-13. Prompt: prompt12, Phase 1.*

This report answers prompt12 Phase 1 for every Feature Group (FG) 1–18. It is grounded in a
read-only inspection of the live codebase (findings in `.claude/tmp/prompt12/inspect/*` and
`.claude/tmp/prompt11/inspect/*`), not in the roadmap's assumptions.

## Headline finding — read this first

**~95% of prompt12's roadmap is already implemented and working.** The 20-stage workflow map
(`workflow-coverage.md`) finds **17 of 20 stages IMPLEMENTED-working**, **3 NI** (needs
improvement — RoB breadth, GRADE SoF export, report `.docx`), and exactly **one stage truly
MISSING**: the **Reproducibility package (FG14 / stage 17)**. The protocol builder, import +
file-hash dedup, 2-reviewer screening with conflicts, second review, extraction handoff,
RoB2/NOS grids, analysis-readiness gating, the full meta-analysis engine (fixed/random/HKSJ/
prediction interval/Egger/trim-fill/leave-one-out/influence/subgroup), GRADE 5-domain UI,
PRISMA 2020 auto-generation with publication-quality SVG/PNG, the manuscript drafter, and a
three-sink audit trail **all exist**.

Therefore the correct posture for this cycle is **improve-existing + one new additive feature**,
not "build the roadmap." Anything marked *implement-now* below is small and additive; everything
large is already done and must be **left alone**.

**Hard constraint:** Fable is concurrently editing `meta-lab-3-patched.jsx`, `AppWorkspace.jsx`,
`server/controllers/authController.js`, and `src/frontend/pages/Profile.jsx`. **Do not touch
those four files.** All recommendations below that would land in the monolith are therefore
*design-only / Fable-owned* for this cycle.

Legend — **Feasibility**: easy · moderate · difficult · risky. **Recommendation**: implement-now ·
improve-existing · design-only · postpone · reject.

---

## Feature-by-feature assessment

### FG1 — Perfect end-to-end golden path
- **What it does:** Create project → PICO/protocol → import → dedup → screen → second review →
  handoff → extract → analyze → PRISMA → export, with always-visible next-step and stage state.
- **Already exists?** YES. The chain is wired end-to-end: landing (`ProjectLanding.jsx`), overview
  with `auditProject()` readiness rollup (monolith :6745-6794), SIFT import/dedup/screening
  (`schema.prisma` `ScreenImportBatch`/`ScreenDuplicateGroup`/`ScreenDecision`/`ScreenConflict`),
  handoff (`handoffStatus` + `MetaSiftPrismaSync`), extraction, `runMeta`, PRISMA. The Overview
  audit is the "what's incomplete / next step" surface.
- **Feasibility / risk:** n/a to build; **risk is regression** if anyone re-wires it.
- **Needs:** none structural. One *wiring* item flagged in `workflow-coverage.md` §cross-cutting:
  confirm `/app` mounts `ProjectLanding` and that selection survives refresh (the monolith strips
  `?project=`). That is a Fable-owned routing concern in `AppWorkspace.jsx` / monolith.
- **Recommendation:** **improve-existing** (verify routing only; otherwise leave alone).

### FG2 — Project command center
- **What it does:** Per-project overview: role, linked-SIFT status, PICO/protocol completeness,
  record/dedup/screen/included/extraction counts, analysis & PRISMA readiness, next step.
- **Already exists?** YES — `OverviewTab()` (monolith :6912) with `auditProject()` scored items
  (PLAN→REPORT) and a PRISMA summary line (:7044). Landing KPI tiles cover the cross-project view.
- **Feasibility / risk:** n/a.
- **Recommendation:** **improve-existing** (cosmetic only; the data is all present). Leave alone.

### FG3 — Review protocol builder (PICO + PROSPERO)
- **What it does:** Structured protocol fields + PROSPERO drafting + completeness.
- **Already exists?** YES, NI. `PICOTab()` (:1749) + `PROSPEROTab()` (:5650) with the full
  `PROSP_FIELDS` set, AI drafting per PROSPERO field, char-limit awareness. Stored in
  `project.pico`/`project.prospero` blob and cached to `ScreenProject.picoSnapshot`.
- **Gap:** no real PROSPERO submission round-trip (drafting + manual `prosperoId` only); no
  protocol version history table.
- **Feasibility:** structure exists (easy to extend in blob); true registration API = moderate
  (external dependency). DB: none needed (blob); a `Protocol`/version table is optional/additive.
- **Risk to app:** low (blob is additive); a new table is additive-nullable → `db push` clean.
- **Recommendation:** **design-only** this cycle (surface a "Submit to PROSPERO" deep-link + status
  field later). Do not build a parallel protocol system — extend the existing tabs. **Leave alone.**

### FG4 — Search strategy & import intelligence
- **What it does:** DB-specific search strings, import batches, file fingerprint, dup-file warning,
  source tagging, import history, re-run.
- **Already exists?** YES. `SearchTab()` (:1919); SIFT import `ScreenImportBatch` with `fileHash`
  (sha256), `fileSize`, `parser` (`schema.prisma:318-336`); parsers in
  `src/research-engine/import-export/parsers.js` (RIS/NBIB/CSV, tested in `parsers.test.js`).
- **Feasibility / risk:** n/a to build.
- **Recommendation:** **improve-existing** at most (the file-hash dedup-warning is already the
  hard part and exists). Leave alone.

### FG5 — Duplicate management
- **What it does:** DOI/PMID/title dedup, fuzzy similarity, keep-primary, mark-not-duplicate,
  audit, PRISMA dup count.
- **Already exists?** YES. `ScreenDuplicateGroup` + `ScreenRecord.isPrimary/isDuplicate/
  duplicateGroupId` (`schema.prisma:215-301`); LAB-side `findDuplicates()` for extraction studies.
- **Recommendation:** **improve-existing** (fuzzy-title tuning is the only frontier). Leave alone.

### FG6 — Screening & full-text / second review
- **What it does:** 2-reviewer, one decision per reviewer per stage, conflict detect/resolve,
  promotion to full text, second review → handoff; agreement metrics (kappa / % agreement).
- **Already exists?** YES (core). `ScreenDecision @@unique([recordId,reviewerId,stage])`
  (:256-273), `ScreenConflict` (:303-316), `blindMode`, `screeningReviewController.js`;
  `currentStage`/`promotedVia`/`finalStatus`/`acceptedAt` (:236-241); `smoke-secondreview.mjs`.
- **Gap:** Cohen's kappa / percent-agreement metric is the one genuinely additive sub-feature
  prompt12 itself flags as optional. Data to compute it already exists in `ScreenDecision`.
- **Feasibility:** easy (pure read-side computation over existing decisions; no schema change).
- **Risk:** low (additive read endpoint + UI card). DB: none. Methodology: kappa formula is
  standard 2×2 agreement; needs a unit test against a known fixture.
- **Recommendation:** **improve-existing** (add % agreement first, kappa if time) — but only if it
  does not touch the four locked files. Otherwise **design-only**.

### FG7 — Data extraction templates & validation
- **What it does:** Per-design templates (RCT/cohort/case-control/DTA/proportion/survival/AE);
  validation (missing N, impossible/negative counts, zero-cell correction, unit mismatch, dup
  cohort, bad CI direction, invalid p/HR/RR/OR) that warns without blocking valid zero-event data.
- **Already exists?** YES (core). `ExtractionTab()` (:3322); studies in `project.studies` blob
  (`mkStudy`); per-study `validateStudy()` (`study-validator.js`); analysis-type warnings via
  `analysisTypeWarnings()` (:495) and `checkPoolability()` (:711).
- **Gap:** explicit per-design *templates* and the full validation matrix are partial; the
  poolability/validation layer is real but not a labeled "template per study type."
- **Feasibility:** moderate (template scaffolding is UI-heavy and lands in the monolith).
- **Risk:** low-medium — blob storage means no migration, but it is Fable-owned monolith work.
- **Recommendation:** **design-only** this cycle (the validation engine already prevents the
  worst MA mistakes; templates are polish). Do not duplicate `validateStudy`.

### FG8 — Analysis readiness check
- **What it does:** Pre-run gate: ≥2 studies, same outcome, compatible measure, valid SE/CI, no
  NaN/Inf, heterogeneity/dup-cohort warnings, enough studies for pub-bias, Ready/Warnings/Not-ready.
- **Already exists?** YES, **fully**. `checkPoolability()` (:711) + `analysisTypeWarnings()` (:495)
  gate the Analysis tab (:3916-3924) with an override UI (:4071) and feed the Overview audit.
- **Recommendation:** **reject** (do not rebuild — it is done). Leave alone.

### FG9 — Meta-analysis method quality
- **What it does:** fixed/random/IV/DL-τ²/Q/I²/CI/prediction interval/HKSJ + sensitivity/pub-bias.
- **Already exists?** YES, **fully and correctly** (see the dedicated method-validation report).
  `src/research-engine/statistics/meta-analysis.js`, unit-tested in `tests/unit/meta-analysis.test.js`.
- **Recommendation:** **reject** changes to the math. The roadmap itself says "do not change
  correct math unnecessarily." The engine is correct. **Leave alone.**

### FG10 — Risk of bias tools
- **What it does:** RoB2, ROBINS-I, QUADAS-2, NOS, custom; domains + judgments + overall + export.
- **Already exists?** YES, NI. `RoBTab()` (:3766) has the full domain grid for **RoB2 (D1-D5)**
  and **Newcastle-Ottawa** (`ROB2`/`NOS` constants, `constants.js:140`); overall + /9 score.
  Data in `study.rob` blob.
- **Gap:** only RoB2 + NOS — **no ROBINS-I, QUADAS-2, PROBAST**.
- **Feasibility:** **easy-additive** — add ROBINS-I / QUADAS-2 domain arrays to `constants.js` and
  reuse the existing `RoBTab` grid. Data stays in blob → **zero migration**.
- **Risk:** low. But `RoBTab` lives in the monolith (`meta-lab-3-patched.jsx`) → Fable-owned.
  `constants.js` is a separate, non-locked file, so the *domain definitions* can be added safely;
  wiring them into the grid is monolith work.
- **Recommendation:** **improve-existing** for the `constants.js` domain arrays (safe, non-locked);
  **design-only** for the monolith grid wiring (Fable-owned).

### FG11 — GRADE & Summary of Findings
- **What it does:** 5 GRADE domains, certainty High→Very low, downgrade reasons, SoF table.
- **Already exists?** YES, NI. `GRADETab()` (:6343) — 5 domains (`GRADE_DOMAINS`/`GRADE_OPTIONS`),
  data-driven `gradeSuggestions()` (uses RoB/I²/CI/k/Egger), auto start-level + downgrade, stored
  in `project.grade` blob.
- **Gap:** no SoF **table export**; single-outcome only.
- **Feasibility:** easy (render an SoF table from existing `project.grade` + `runMeta` result;
  wire into the report export). DB: none.
- **Risk:** low — pure render/export. The render helper can live outside the monolith; wiring the
  button into `openReportExport` is near-monolith but the export plumbing is the export module.
- **Recommendation:** **improve-existing** (build the SoF render as an additive export). Do not
  rebuild the GRADE engine — only add the table.

### FG12 — PRISMA auto-generation
- **What it does:** Auto-filled counts (identified/dedup/excTA/excFull/included), auto-update from
  SIFT, manual override with audit, publication figure.
- **Already exists?** YES, **fully**. `PRISMATab()` (:2677); `MetaSiftPrismaSync` (:2588)
  auto-fills from the linked SIFT summary; `buildPrismaSVG` (:2374) + `PrismaFigureExport` (:2759)
  produce PRISMA-2020 PNG/SVG.
- **Recommendation:** **reject** rebuild. Leave alone.

### FG13 — Report / manuscript generator
- **What it does:** Methods/results/heterogeneity/pub-bias/limitations drafts, tables, export.
- **Already exists?** YES, NI. `ManuscriptTab()` (:6446, AI section drafter,
  `project.manuscript.drafts` blob); `openReportExport()` (:7865) → `buildReportHTML()` for
  PDF(print)/HTML.
- **Gap:** no `.docx`, no citation/reference manager, no journal templating; PDF is browser-print.
- **Feasibility:** easy-moderate (add a `.docx`/Markdown writer alongside `buildReportHTML`; pure
  client export). DB: none.
- **Risk:** low (client export only). The writer can be a new module; wiring the format option is
  near the export code.
- **Recommendation:** **improve-existing** (add a Markdown/`.docx` writer as a new format).
  Do not invent results — the drafter already uses only project data.

### FG14 — Reproducibility package export
- **What it does:** One bundle: protocol + search strings + import logs + screening decisions +
  excluded-with-reasons + extraction table + RoB + analysis settings + methods + PRISMA + figures
  + included studies + audit log.
- **Already exists?** **NO — this is the only truly MISSING stage.** Closest = single-project JSON
  backup `openProjectExport()` (:7891) + per-artifact CSV/SVG exports. No combined archive; no
  JSZip dependency (grep clean).
- **Feasibility:** **easy and additive** — a client-side "Reproducibility bundle" button that zips
  *already-available* pieces (project JSON + analysis CSV + PRISMA SVG + GRADE + audit JSON) via
  JSZip. No server, no migration, no core change.
- **Risk:** **lowest of any feature** — new button + new client module; nothing else touched.
- **Methodology note:** this is exactly what makes the platform institution-credible (a reviewer
  can re-run the synthesis from one archive). It is the highest value-per-risk item in the whole
  roadmap.
- **Recommendation:** **implement-now** (if a build slot exists this cycle and it can be authored
  as a new module outside the four locked files). Otherwise the #1 next-cycle item.

### FG15 — Audit trail everywhere
- **What it does:** Log create/rename/archive/delete/member/role/permission/import/dedup/
  screening/conflict/2nd-review/extraction/effect-size/analysis-settings/export/PRISMA/GRADE/RoB.
- **Already exists?** YES (core, three sinks): `AdminAuditLog` (ops), `ScreenAuditLog`
  (per-workspace, ~12 actions, `schema.prisma:454-465`), `UsageEvent` (product metrics, FK-free,
  :441-452). Helpers `logAdminAction`/`writeAudit`/`recordUsage`.
- **Gap:** LAB-project *blob* mutations (extraction edits, analysis-setting changes, GRADE/RoB
  edits) are **not** individually audited — the LAB project uses whole-blob autosave (last-write-
  wins), so per-field audit is structurally weak.
- **Feasibility:** difficult-risky — true per-field LAB audit requires either a change-log table or
  diffing the blob on save; both touch the autosave path in the monolith. High blast radius.
- **Risk:** high if done naively (autosave is load-bearing).
- **Recommendation:** **postpone** / **design-only**. The collaborative (SIFT) side — where audit
  matters most for multi-user accountability — is already well-covered. LAB per-field audit is a
  larger architectural change; document it, don't force it this cycle.

### FG16 — Collaboration & tasks
- **What it does:** Project/shared chat, notifications, invites, assignments, tasks, due dates,
  "needs your review," activity feed.
- **Already exists?** Partially. Chat, notifications, and invites are **implemented** (shared chat
  via `/metalab/:mlpid/chat*`, `NotificationsBell`, invite token ceremony with SHA-256 hashes —
  see prompt9/prompt11). **Tasks / assignments / due dates do NOT exist.**
- **Feasibility:** moderate-difficult — a task system is net-new: DB table (`Task` with
  title/assignee/project/dueDate/status/linkedStage/createdBy), server CRUD, realtime, UI.
- **Risk:** medium — additive table (nullable, no unique constraints → `db push` clean per the VPS
  pain note), but a meaningful new surface with its own permission story.
- **Recommendation:** **design-only** this cycle (architecture + table sketch). The chat/
  notification/invite half is done; do not duplicate it. Tasks are a clean next-cycle feature.

### FG17 — Ops / institutional features
- **What it does:** Users/roles/mods/projects/metrics/audit/settings/flags/email/invite-status/
  security/version/storage; organizations later.
- **Already exists?** YES (broad). `AdminConsole.jsx` `NAV_SECTIONS` (:3429) has 10 sections
  (overview, users, projects, sift, content, settings, flags, messages, security, health) with an
  animated KPI kit and `/metrics/timeseries`.
- **Gap:** organizations/teams do not exist; SIFT projects list has no Restore button; the LAB
  table doesn't split admin-archive vs owner-delete (`deletedSource`) in the ops view.
- **Feasibility:** orgs = difficult (multi-tenant model). The small ops gaps (Restore button,
  `deletedSource` display) = easy and were already flagged in the prompt11 landing plan.
- **Risk:** orgs = high (cross-cutting); small ops fixes = low.
- **Recommendation:** **improve-existing** for the small ops gaps; **postpone** organizations.

### FG18 — AI features (auditable only)
- **What it does:** Optional, source-shown, confidence-shown, accept/reject/edit, audited AI
  suggestions for keywords/screening/extraction/RoB/methods.
- **Already exists?** Partially and *correctly scoped* — AI drafting already exists in PROSPERO and
  Manuscript tabs as **optional, editable, project-data-only** drafts (matches the FG18 rules).
- **Recommendation:** **postpone** expansion. The roadmap itself says "keep AI hidden unless
  already implemented safely." The existing AI is already safe and optional; do not make AI central.

---

## Cross-cutting risk register (what could break the working app)

| Risk | Source | Mitigation |
|---|---|---|
| Touching the four locked files mid-edit | Fable editing `meta-lab-3-patched.jsx`, `AppWorkspace.jsx`, `authController.js`, `Profile.jsx` | **Do not edit them.** Any monolith-resident change is design-only / Fable-owned this cycle. |
| Blob autosave is last-write-wins | LAB `Project.data` JSON for stages 3,7,9,10,11,13,14,16 | New features must use *dedicated endpoints* (landing pattern), never blob writes; no per-field LAB audit without an architecture change. |
| VPS `prisma db push` aborts on unique constraints | Prior pain (`@unique` forced `--accept-data-loss`; commit a821753) | Any new column/table must be **nullable/defaulted, no `@unique`** → clean `db push`. **Do not run `prisma migrate`.** |
| Landing routing masks a wiring gap | `/app` may still render the monolith switcher with memory-only `activeId` | Verify `/app` mounts `ProjectLanding` and selection survives refresh (Fable/AppWorkspace). |
| Duplicating an existing feature | ~95% already built | Always extend the existing tab/module; never create a parallel system (FG3, FG7, FG8, FG9, FG12 are the easiest to accidentally duplicate). |

## Recommended scope for THIS cycle (lowest risk, highest value)

1. **implement-now (if a non-locked build slot exists):** Reproducibility bundle (FG14) — new
   client module + button, JSZip, zips existing exports. The only true gap; lowest risk.
2. **improve-existing (safe, non-locked or export-only):** GRADE SoF table render (FG11); Markdown/
   `.docx` report writer (FG13); ROBINS-I/QUADAS-2 *domain arrays* in `constants.js` (FG10); small
   ops fixes — SIFT Restore button + `deletedSource` display (FG17); % agreement / kappa read-side
   (FG6) if it stays out of the monolith.
3. **design-only (document, don't build):** protocol registration round-trip (FG3); extraction
   templates (FG7); task system (FG16); organizations (FG17); LAB per-field audit (FG15).
4. **reject / leave alone (already done — do NOT rebuild):** analysis readiness (FG8), the
   meta-analysis math (FG9), PRISMA auto-gen (FG12), and the cores of FG1/FG2/FG4/FG5.

**Version guidance:** if only the additive items above ship, this is a **minor** bump (v2.9.x →
v2.10.0 or a patch if just fixes). Nothing here warrants a major bump — the heavy lifting is
already in the tree.
