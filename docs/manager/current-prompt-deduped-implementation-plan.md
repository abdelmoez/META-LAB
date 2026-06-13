# Current Prompt — Deduped Implementation Plan

*Author: Sonnet technical writer. Source: prompt12.md + addendum + inspection findings. Date: 2026-06-13.*

This document fulfills prompt12 Addendum Task 5: for each item in the combined prompt12 roadmap, record the disposition after the inspection audit.

---

## Section 1 — REMOVED from implementation (already exists and works)

These items were listed in prompt12 as potential gaps but the inspection found them fully implemented. Building them again would create duplicate systems.

| Prompt12 item | Actual state | Evidence |
|---|---|---|
| Project Landing / Selector (Feature Group 2 / Stage 1) | Implemented-working | `ProjectLanding.jsx`, full KPI/filter/sort/card/table, routed at `/app` |
| Project Command Center / Overview (Feature Group 2 / Stage 2) | Implemented-working | `OverviewTab()` L6912, `auditProject()` L6745, next-step walker, readiness rollup |
| Protocol Builder — PICO (Feature Group 3 / Stage 3) | Implemented-working | `PICOTab()` L1749 with full P/I/C/O + eligibility |
| Protocol Builder — PROSPERO (Feature Group 3 / Stage 3) | Implemented-working | `PROSPEROTab()` L5650 with all PROSPERO fields + AI drafting |
| Search Strategy / Import with batch tracking (Feature Group 4 / Stage 4) | Implemented-working | `SearchTab()`, `ScreenImportBatch` with fileHash, parsers |
| Duplicate file detection (Feature Group 4) | Implemented-working | `fileHash` on `ScreenImportBatch` catches duplicate uploads |
| Duplicate management (Feature Group 5 / Stage 5) | Implemented-working | `ScreenDuplicateGroup` + `isPrimary/isDuplicate`, merge, PRISMA count sync |
| Title/Abstract Screening 2-reviewer + conflicts (Feature Group 6 / Stage 6) | Implemented-working | `ScreenDecision @@unique`, `ScreenConflict`, blind mode |
| Full-Text / Second Review (Feature Group 6 / Stage 7) | Implemented-working | `currentStage`, `promotedVia`, `promotedAt`, `finalStatus`, `acceptedAt` |
| Study Inclusion Finalization + handoff (Stage 8) | Implemented-working | `handoffStatus/handoffAt/handoffStudyId`, `MetaSiftPrismaSync` idempotent pull |
| Data Extraction (Feature Group 7 / Stage 9) | Implemented-working | `ExtractionTab()`, `mkStudy` defaults, raw effect-size calculator with zero-cell correction |
| Analysis Readiness Check (Feature Group 8 / Stage 11) | Implemented-working | `checkPoolability()`, `analysisTypeWarnings()`, per-study `validateStudy()` |
| Meta-Analysis engine — fixed + random + HKSJ + prediction interval (Feature Group 9 / Stage 12) | Implemented-working | `runMeta()`, Q/I²/τ², unit-tested |
| Sensitivity / subgroup / pub-bias (Feature Group 9 / Stage 13) | Implemented-working | `leaveOneOut()`, `subgroupAnalysis()`, `eggersTest()` (fixed), `trimFill()` |
| RoB 2 + Newcastle-Ottawa (Feature Group 10 / Stage 10) | Implemented-working | `RoBTab()` D1-D5 RoB2 + NOS full domain grid |
| GRADE 5-domain certainty assessment (Feature Group 11 / Stage 14) | Implemented-working | `GRADETab()`, `gradeSuggestions()`, auto start-level + downgrade |
| PRISMA auto-generation from SIFT (Feature Group 12 / Stage 15) | Implemented-working | `PRISMATab()`, `MetaSiftPrismaSync`, `buildPrismaSVG`, PRISMA 2020 |
| Report / manuscript generator + HTML/PDF export (Feature Group 13 / Stage 16) | Implemented-working | `ManuscriptTab()`, `buildReportHTML()`, `openReportExport()` |
| Audit trail — 3-sink model (Feature Group 15 / Stage 18) | Implemented-working | `AdminAuditLog`, `ScreenAuditLog`, `UsageEvent` |
| Project Control / Members / Permissions (Feature Group 16 / Stage 19) | Implemented-working | `ControlTab()`, `ScreenProjectMember`, 18 flags, 8 presets, `access.js` server enforcement |
| Ops / Admin console 10 sections (Feature Group 17 / Stage 20) | Implemented-working | `AdminConsole.jsx` NAV_SECTIONS, animated KPIs, `RoleBadge` |
| Chat + notifications (Feature Group 16) | Implemented-working | `MetaLabChatLauncher`, `NotificationsBell`, dismiss-on-click, deep-link |
| Invite ceremony + token (Feature Group 16) | Implemented-working | CSPRNG token, SHA-256 hash stored, expiry, accept endpoint |
| `mod` as a real global role (Feature Group 17) | Implemented-working | `requireAdminOrMod`, `requireTargetEditable`, `MOD_PERMISSIONS` — fully live |
| META·SIFT back-navigation `← Projects` | Implemented-working | `SiftProject.jsx:117-120` |
| Global `RoleBadge` in ops console | Implemented-working | `AdminConsole.jsx:1444-1448`, used in user table, detail panel, console header |

---

## Section 2 — KEPT (needs improvement, improvement applied or deferred)

These items exist but have a documented gap. Listed with disposition.

| Item | Gap | Disposition |
|---|---|---|
| Last-active display in Account Settings | `/api/auth/me` omits `lastActive`; `Profile.jsx` reads wrong field | **Fixed this cycle** (Bucket A) |
| Global role badge in UserMenu | Plain text in account dropdown; ops console already has `RoleBadge` | **Fixed this cycle** (Bucket A) |
| Protocol Builder — PROSPERO round-trip | Manual `prosperoId` entry only; no PROSPERO submission or status tracking | **Deferred** (Bucket C, next-next cycle) |
| RoB breadth: ROBINS-I + QUADAS-2 | Only RoB 2 + NOS today | **Deferred** (Bucket B, next cycle) |
| GRADE SoF table export | Data exists in blob; no table render or export | **Deferred** (Bucket B, next cycle) |
| Report — `.docx` export | Browser-print PDF only; no docx/Markdown | **Deferred** (Bucket B, next cycle) |
| Role model — confusing overlaps | `reviewer` overloaded; two add-member implementations; stale schema comment | Schema comment fixed this cycle. Role rename deferred (Bucket G — high blast radius, low user-facing gain given preset labels already use plain English). Two-implementation sync documented. |
| Ops console: `deletedSource` split | LAB Projects table shows one "archived" badge for both admin-archive and owner-delete | **Deferred** (Bucket B, next cycle — UI-only) |
| Ops console: SIFT Restore button | Endpoint exists; no Restore button in SIFT Projects table | **Deferred** (Bucket B, next cycle — UI-only) |

---

## Section 3 — ADDED from the addendum (new items, applied this cycle)

These items were not in the original prompt12 main body but were added by the addendum section.

| Addendum task | Disposition |
|---|---|
| Task 1 — Back to Projects button in META·LAB sidebar | **Implemented this cycle** — `onBackToProjects` prop pattern; sidebar `<Icon name="arrowLeft"/>` button; `AppWorkspace` wires `navigate('/app')` |
| Task 2 — Admin/mod name styling (role badge in UserMenu) | **Implemented this cycle** — subtle gold/teal pill in account dropdown using `alpha()` convention |
| Task 3 — Fix last-active in Account Settings | **Implemented this cycle** — Fix A (endpoint), Fix B (frontend field), Fix C (time formatter) |
| Task 4 — Role system review + recommendation doc | **Documented** — inspection confirms the role model is sound; rename deferred; confusions catalogued in roles.md inspection + current-live-app-audit.md; no code changes to the role model |
| Task 5 — Deduped implementation plan | **This document** |

---

## Section 4 — POSTPONED

These items from prompt12 are feasible but out of scope for this cycle. All are documented with a recommended cycle.

| Item | Reason for postpone | Target cycle |
|---|---|---|
| Reproducibility bundle (Stage 17) | Only truly missing stage; additive JSZip client export; needs proper QA time | Next cycle (Bucket B) |
| GRADE SoF table | Additive render; exists in blob | Next cycle (Bucket B) |
| RoB — ROBINS-I + QUADAS-2 | Additive domain arrays | Next cycle (Bucket B) |
| `.docx` report export | Additive client export | Next cycle (Bucket B) |
| PROSPERO submission round-trip | External API dependency; additive field approach is fine first | Next-next cycle (Bucket C) |
| Protocol version history | Requires new `ProtocolVersion` model | Next-next cycle (Bucket C) |
| Reviewer agreement metrics (Cohen's kappa) | Methodologically non-trivial; requires screening decision aggregation | Next-next cycle (Bucket C) |
| Per-outcome GRADE | Data model extension in blob | Next-next cycle (Bucket C) |
| Ownership transfer | Net-new server + client + UI; unblocks owner-leave | Bucket D — needs architectural design |
| Task system (assignments, due dates) | Separate model; non-trivial | Bucket D |
| Organization / team hierarchy | Large; separate epic | Bucket E |
| AI screening / extraction suggestion | Must meet safety/auditability requirements not yet designed | Bucket F |
| Role rename (reviewer → contributor) | High blast radius; no user-facing gain given existing preset label system | Bucket G — effectively indefinite |

---

## Self-check

Five documents written:
1. `docs/manager/current-live-app-audit.md` — surface-by-surface audit with Working / Implemented-buggy / Missing labels and fixes noted.
2. `docs/manager/complete-workflow-existing-feature-map.md` — all 20 workflow stages with honest status.
3. `docs/manager/implementation-priority-plan.md` — buckets A–G with items placed.
4. `docs/manager/chosen-implementation-path.md` — chosen path (Stabilization + UX-Clarity), reasoning, next-cycle target.
5. `docs/manager/current-prompt-deduped-implementation-plan.md` — this document.
