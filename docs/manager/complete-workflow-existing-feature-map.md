# Complete Workflow — Existing Feature Map

*Author: Sonnet technical writer. Source: workflow-coverage.md inspection (.claude/tmp/prompt12/inspect/). Date: 2026-06-13.*

**Headline: ~95% of the prompt12 roadmap is already implemented. Do not rebuild.**

Status vocabulary used below:
- **Implemented-working** — correct, no action needed.
- **Implemented-needs-improvement (NI)** — exists and correct but has a documented gap worth addressing.
- **Partial** — skeleton or framework exists; meaningful pieces missing.
- **Missing** — not implemented anywhere.
- **Risky** — would require migrations or surgery on working core paths.
- **Not-feasible** — architecturally blocked given current design.
- **Postpone** — feasible but out of scope for this cycle.

---

## Stage 1 — Project Landing / Selector

**Implemented-working**

`src/frontend/pages/ProjectLanding.jsx` (delivered in prompt11). Full KPI tiles, card/table views, search, filter chips, sort, archive/unarchive, soft-delete with typed-name confirmation. Routed at `/app`. Lifecycle via dedicated endpoints; never writes project blob. `GET /api/projects` returns owned + shared-via-workspace projects annotated with `_permissions`, `_role`, `_linkedMetaSift`, `_shared`, `_canEdit`, `_readOnly`.

---

## Stage 2 — Project Overview / Command Center

**Implemented-working**

`OverviewTab()` (monolith L6912). `auditProject()` (L6745-6794) scores readiness across PLAN→REPORT items and feeds a next-step walker. PRISMA summary line (L7044). Displays member count, linked-SIFT status, analysis readiness, stage progress. Answers "where am I, what is incomplete, what next."

---

## Stage 3 — Protocol Builder (PICO + PROSPERO)

**Implemented-needs-improvement**

`PICOTab()` (L1749): P/I/C/O, study design, eligibility criteria, `prosperoId` field. `PROSPEROTab()` (L5650): full `PROSP_FIELDS` set, AI-assisted drafting of every PROSPERO field, character-limit aware. Stored in `project.pico` / `project.prospero` blob + cached to `ScreenProject.picoSnapshot`.

Gap: no real PROSPERO submission/registration round-trip — only manual drafting + `prosperoId` entry by hand. No protocol version history. No dedicated `Protocol` model (blob storage is fine for now; zero migration risk).

Improvement path (next cycle, Postpone now): surface a "Submit to PROSPERO" deep-link + optional status field. Keep blob storage; add a timestamp field for "last protocol update". No migration needed.

---

## Stage 4 — Search Strategy and Import

**Implemented-working**

`SearchTab()` (L1919): per-database search string checklist (PubMed, Embase, Scopus, Web of Science, Cochrane, manual, gray literature), query strings, search dates, notes. SIFT import: `ScreenImportBatch` model with `fileHash` (sha256), `fileSize`, parser (`schema.prisma:318-336`). Parsers: `src/research-engine/import-export/parsers.js`. Duplicate-file detection via `fileHash`. Import history via batch records. Source tagging via batch metadata.

---

## Stage 5 — Duplicate Management

**Implemented-working**

`ScreenDuplicateGroup` + `ScreenRecord.isPrimary/isDuplicate/duplicateGroupId` (`schema.prisma:215-301`). DOI/PMID match, title normalization, fuzzy similarity, merge metadata, primary-record preservation, audit of duplicate decisions, PRISMA duplicate count auto-update. LAB-side `findDuplicates()` for extraction studies (Overview audit L6769).

---

## Stage 6 — Title/Abstract Screening (2-reviewer, conflicts)

**Implemented-working**

Owned entirely by META·SIFT. `ScreenDecision` `@@unique([recordId,reviewerId,stage])` (`schema.prisma:256-273`). `ScreenConflict` (`:303-316`). Blind mode. `screeningReviewController.js`. Two-reviewer model, one decision per reviewer per article, conflict detection, conflict resolution flow. Manual LAB screening module exists in source but is no longer rendered (L2585-2587).

---

## Stage 7 — Full-Text / Second Review

**Implemented-working**

`ScreenRecord.currentStage` (`title_abstract | full_text`), `promotedVia` (`quorum | conflict_resolution`), `promotedAt`, `finalStatus`, `acceptedAt` (`schema.prisma:236-241`). `smoke-secondreview.mjs` integration test covers the promotion flow.

---

## Stage 8 — Study Inclusion Finalization → Handoff to META·LAB

**Implemented-working**

`acceptedAt` gates the handoff. `handoffStatus / handoffAt / handoffStudyId / handoffError` (`schema.prisma:242-246`). `MetaSiftPrismaSync` (L2588+) pulls accepted records into LAB extraction idempotently by `screeningRecordId / DOI / PMID / title`. No double-import risk.

---

## Stage 9 — Data Extraction

**Implemented-working**

`ExtractionTab()` (L3322). Studies in `project.studies` blob (`mkStudy` defaults in `defaults.js:96`). Handoff from SIFT via `handoffStatus` flows studies into the extraction tab automatically. Raw effect-size calculator with zero-cell correction (Haldane-Anscombe, delivered in prompt10). Study-level `validateStudy()` (`study-validator.js`).

---

## Stage 10 — Risk of Bias Assessment

**Implemented-needs-improvement**

`RoBTab()` (L3766): full domain grid for RoB 2 (D1-D5) and Newcastle-Ottawa Scale (`ROB2`/`NOS` constants). Overall judgment + /9 score. Data stored in `study.rob` blob (no dedicated table; zero migration risk).

Gap: only RoB 2 and NOS — no ROBINS-I, QUADAS-2, PROBAST.

Improvement path (next cycle): add ROBINS-I and QUADAS-2 domain arrays to `constants.js`; reuse existing `RoBTab` grid. Data stays in `study.rob` blob — no migration, no new tab, purely additive.

---

## Stage 11 — Analysis Readiness Check

**Implemented-working**

`checkPoolability()` (L711) and `analysisTypeWarnings()` (L495) gate the Analysis tab (L3916-3924) with an override UI (L4071). Per-study `validateStudy()` validates individually. Overview audit (L6778-6780) includes readiness in the project score. Shows Ready / Ready with warnings / Not ready.

---

## Stage 12 — Meta-Analysis Engine

**Implemented-working**

`src/research-engine/statistics/meta-analysis.js` `runMeta()` (L24). Fixed (inverse variance) + random (DerSimonian-Laird) + HKSJ + prediction interval, Q/Qpval/I²/τ². Unit-tested in `tests/unit/meta-analysis.test.js`. Egger bug fixed (unweighted OLS, prompt10).

---

## Stage 13 — Sensitivity / Subgroup / Publication Bias

**Implemented-working**

Same engine: `leaveOneOut()` (L220), `influenceDiagnostics()` (L321), `subgroupAnalysis()` (L359), `eggersTest()` (L167, fixed in prompt10), `trimFill()` (L250). UI: `SensitivityTab()` (L5941), `SubgroupTab()` (L6180), `ForestTab()` / funnel plot.

---

## Stage 14 — GRADE / Certainty of Evidence

**Implemented-needs-improvement**

`GRADETab()` (L6343): 5 domains (`GRADE_DOMAINS` / `GRADE_OPTIONS`), data-driven `gradeSuggestions()` (pulls from RoB / I² / CI / k / Egger), auto start-level + downgrade logic → Very low … High. Stored in `project.grade` blob.

Gap: no GRADE Summary-of-Findings (SoF) table export. Single-outcome only (one GRADE assessment per project rather than per outcome).

Improvement path (next cycle): render a SoF table from existing `project.grade` + `runMeta` result; add to Report export. No migration. Purely additive render.

---

## Stage 15 — PRISMA Auto-Generation

**Implemented-working**

`PRISMATab()` (L2677). `MetaSiftPrismaSync` (L2588) auto-fills counts from the linked SIFT summary (identified / dedupe / excluded-TA / excluded-FT / included). `buildPrismaSVG` (L2374) + `PrismaFigureExport` (L2759): publication-quality PNG/SVG per PRISMA 2020 standard.

---

## Stage 16 — Report / Manuscript Generator

**Implemented-needs-improvement**

`ManuscriptTab()` (L6446): AI-assisted section drafter, `project.manuscript.drafts` blob. `openReportExport()` (L7865) → `buildReportHTML()` → PDF (browser-print) / HTML export.

Gap: no `.docx`, no citation/reference manager, no journal templating. PDF is browser-print only.

Improvement path (next cycle): add a `.docx` or Markdown writer alongside `buildReportHTML`; surface as a new format option in `openReportExport`. Pure client-side export — no server change, no migration.

---

## Stage 17 — Reproducibility Package

**Missing**

No `.zip` / bundle export anywhere. No JSZip import. `openProjectExport()` (L7891) provides a single-project JSON backup. Individual CSV/SVG/PNG exports exist per artifact. No combined protocol + data + analysis + log archive.

**This is the only truly missing stage in the entire workflow.**

Implementation path (next cycle, high priority): a "Reproducibility bundle" button that zips already-available pieces (project JSON + analysis CSV + PRISMA SVG + GRADE JSON + audit JSON) client-side via JSZip. Additive, no server change, no migration, no core touch.

---

## Stage 18 — Audit Trail

**Implemented-working**

Three sinks:
- `AdminAuditLog` (ops-level actions) via `logAdminAction`.
- `ScreenAuditLog` (per-workspace, ~12 actions) via `writeAudit`.
- `UsageEvent` (product metrics, FK-free) via `recordUsage`.

LAB-project blob mutations are not individually audited (autosave model — last-write-wins). This is an accepted architectural trade-off.

---

## Stage 19 — Project Control / Members / Permissions

**Implemented-working**

`ControlTab()` (L7296). Members and roles sourced from the linked `ScreenProjectMember` (18 permission flags, 8 presets from `permissionPresets.js`). Server-side enforcement via `access.js`. LAB project itself is single-owner. Known gap: no ownership-transfer endpoint (blocks owner-leave); documented, not built this cycle.

---

## Stage 20 — Ops / Admin Oversight

**Implemented-working**

`AdminConsole.jsx` NAV_SECTIONS (10): overview, users, projects, sift, content, settings, flags, messages, security, health. Animated KPI tiles. Global `RoleBadge` with gold/teal/muted colors.

Known gaps (not fixed this cycle): LAB Projects table does not split `deletedSource` (admin-archive vs owner-delete); SIFT Projects table has no Restore button for owner-soft-deleted workspaces despite the restore endpoint existing.

---

## Summary table

| Stage | Status |
|---|---|
| 1. Project Landing | Implemented-working |
| 2. Project Overview | Implemented-working |
| 3. Protocol Builder | Implemented-needs-improvement (no PROSPERO round-trip) |
| 4. Search / Import | Implemented-working |
| 5. Duplicate Management | Implemented-working |
| 6. Title/Abstract Screening | Implemented-working |
| 7. Full-Text / Second Review | Implemented-working |
| 8. Inclusion Finalization / Handoff | Implemented-working |
| 9. Data Extraction | Implemented-working |
| 10. Risk of Bias | Implemented-needs-improvement (no ROBINS-I / QUADAS-2) |
| 11. Analysis Readiness | Implemented-working |
| 12. Meta-Analysis | Implemented-working |
| 13. Sensitivity / Subgroup / Pub-Bias | Implemented-working |
| 14. GRADE / Certainty | Implemented-needs-improvement (no SoF table export) |
| 15. PRISMA | Implemented-working |
| 16. Report / Manuscript | Implemented-needs-improvement (no .docx) |
| 17. Reproducibility Package | **Missing** |
| 18. Audit Trail | Implemented-working |
| 19. Project Control / Members | Implemented-working |
| 20. Ops / Admin Oversight | Implemented-working |
