# Screening Workflow Overhaul — Master Plan (prompt19)

[FROM: Opus Lead Architect] [TO: Team] [TOPIC: Screening rebuild + reviewer rules + forest fix + dashboard + ops map]
[MESSAGE: Root causes mapped, contracts fixed below. Build the Screening workspace full-width/focus, enforce per-project reviewers, fix the live forest plot, clean the dashboard, add the ops country map. META·SIFT stays internal-only.]
[FILES I OWN: meta-lab-3-patched.jsx, SiftProject/SiftImport + screening tabs, this + breakage/ux/forest docs, final report, version/commit/push]
[WHAT I NEED FROM YOU: keep to your file lanes (below); report contracts honored]

## 1. What is broken now (root causes — verified in code)

| # | Symptom | Root cause |
|---|---------|-----------|
| Screening tabs "not working" / cramped | The whole project body renders inside `meta-lab-3-patched.jsx` `<div className="tab-content" style={{maxWidth:960,margin:"0 auto"}}>` (L8549), under a tall project header. `EmbeddedScreening` (and its `height:calc(100vh-168px)` embedded `SiftProject`) is therefore crushed into a ≤960px column — the full-bleed Title&Abstract 3-column workbench is unusable and the sub-tabs feel dead. | Narrow clamp + stacked under project header; no focus/full-width treatment. |
| Forest plot always dark + narrow | `ForestPlot` (L1260) is ONE component for live **and** export. It hardcodes dark hex (`FC={txt:"#eaecf6"...}`, `<svg style background "#0e1420">`, `<rect fill "#0e1420">`) and a fixed pixel width `W≈620` inside `overflowX:auto`. Export needs the absolute dark hex; the live embed inherits it → always dark, narrow, scrolly. | Live and export share one hardcoded-dark, fixed-width renderer. |
| Reviewers | Only a GLOBAL admin quorum exists (`server/screening/settings.js` `minIncludeQuorum`/`requireTwoReviewers` → `getEffectiveQuorum`). No per-project, owner-editable required-reviewers setting. | Missing per-project policy. |
| Dashboard linked/unlinked filters | `ProjectLanding.jsx` exposes linking as a user concept (`Linked META·SIFT` KPI/filters). | Leftover linking UX. |
| User-facing META·SIFT strings | Scattered "META·SIFT", "Linked META·LAB Project", "Open META·SIFT", BetaBadge, etc. across monolith, SiftProject, ProjectLanding, emails, notifications. | Product renamed Screening; UI not fully swept. |
| Ops users geography | No country capture at registration; no country endpoint or map. | Feature missing. |

## 2. Current architecture map (relevant)

- Review Project = META·LAB `Project` (single-owner). Opened at `/app/project/:id` → `AppWorkspace` → monolith `meta-lab-3-patched.jsx`. Monolith tab state `const[tab,setTab]=useState(...)`; content router L8604-8620; **Screening** is the `screening` tab → `EmbeddedScreening` → `SiftProject embedded` (sub-tabs Overview/Import/Duplicates/Title&Abstract/Conflicts/Full Text/Settings/Export).
- Screening engine = META·SIFT `ScreenProject` (+ Screen* tables) under `/api/screening`. Resolved per Review Project via `GET /api/screening/metalab/:mlpid/workspace` (auto-creates for owner; prompt18). Membership/permissions live on `ScreenProjectMember`.
- Handoff: Full-Text accept → study appended to `Project.data.studies[]`. PRISMA: `GET /api/screening/metalab/:mlpid/summary`.

## 3. New Screening UX (the redesign)

**Screening opens a dedicated, full-width, focus workspace** — it escapes the 960px `.tab-content` clamp, hides the big project header, and (focus mode) collapses the monolith left sidebar so the workbench breathes. Chrome kept: breadcrumb `Review Project ▸ Screening ▸ <sub-tab>`, project name, Back to overview, Back to projects, account/notifications (global). Sub-nav: **Overview · Import · Duplicates · Title & Abstract · Conflicts · Full Text · Settings · Export** with generous space + empty states + a "Next action" on Overview. Screening shows ONLY screening-specific status (records, duplicates, screened, conflicts, full-text pending, included, next action) — NOT general project status (that lives in Project Control + Overview).

**Project Overview** gains a compact **Screening Progress** card (imported / duplicates / screened / remaining / conflicts / full-text / included / next action + "Continue screening"). Member stats stay where they are.

**Project Control / Settings** is the single place for everything incl. screening settings + **Required reviewers** (default 2, owner/leader editable).

## 4. Backend changes
- Schema (DONE, additive, db-push safe): `ScreenProject.requiredScreeningReviewers Int @default(2)`; `User.registrationCountryCode/Name/IpCountrySource/IpHash` (nullable).
- Reviewer logic (Agent A): promotion to Full Text requires ≥ `requiredScreeningReviewers` distinct title/abstract decisions meeting the include threshold; conflicts unchanged; enforced in `screeningController.saveDecision`; field exposed in `getProject`, settable in `updateProject` (canManageSettings only).
- Ops geography (Agent B): `register()` captures country best-effort (proxy header → optional offline lookup → Unknown), stores country-level only, never raw IP (optional salted hash); `GET /api/admin/users/countries`.

## 5. Frontend changes
- Monolith (Lead): full-width focus Screening render + sidebar collapse; Screening Progress card in Overview; forest plot live fix; remaining META·SIFT rename.
- Screening tabs (Lead): spacious layout, empty states, breadcrumbs, next-action, required-reviewers Settings UI + Title&Abstract gating display.
- ProjectLanding (Agent C): remove linked/unlinked filters → status-based filters; rename sweep.
- AdminConsole Users tab (Agent B): interactive accent-driven country choropleth + ranked table + summary.

## 6. Migration / data
- No destructive migration. `requiredScreeningReviewers` defaults to 2 for all existing projects. User country = null/Unknown for existing users; future registrations populate. Optional: none required.

## 7. Risks
- Monolith shell surgery (full-width + sidebar collapse) — mitigate by conditional render keyed on `tab==="screening"`, leaving all other tabs untouched.
- Forest plot — add a `live` mode; DO NOT change export path (export stays absolute-dark/fixed).
- Parallel agents — strict file ownership (no two touch the same file); schema pre-changed by Lead.

## 8. QA plan
Automated (tests/screening + tests/integration, live server): screening workspace resolves & renders; required-reviewers default 2; owner/leader can change, viewer cannot; record can't advance with insufficient decisions; backend blocks bypass; full-text accept → Data Extraction; ops countries endpoint perms (admin 200 / user 403); registration safe when geo fails. Manual: the 30-step checklist in the prompt. Build + unit (baseline 653/6 pre-existing) + full integration.
