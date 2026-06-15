# Phase 3 — New Unified Review Workflow Plan

[FROM: Research Workflow & Methods Engineer]
[TO: Team]
[TOPIC: Unified Review workflow — one project, Screening as a single stage]
[MESSAGE: This is the as-designed workflow spec. One "Review Project" with a single Screening stage that embeds all of META·SIFT; META·LAB's rich analysis tabs are kept, not collapsed. Methodological handoffs (screen → full-text → extraction → analysis → PRISMA) are already wired and stay correct.]
[FILES I OWN: docs/manager/unified-review-workflow-plan.md (this plan); methodological correctness of the stage handoffs in `server/controllers/screeningReviewController.js` (handoff), `server/controllers/screeningOverviewController.js` (PRISMA rollup), and the monolith `TABS` order in `meta-lab-3-patched.jsx`.]
[WHAT I NEED FROM YOU: Backend — keep `ensureScreenModuleForMetaLab` + `GET /api/screening/metalab/:mlpid/workspace` idempotent and preserve the existing accept→`data.studies` handoff exactly (do not change the DOI/PMID/title dedupe). Frontend — render the Screening sub-nav in the methodological order below and make PRISMA numbers read from the Screening rollup, not a parallel manual count. QA — assert the handoff + PRISMA counts survive embedding.]

---

## 1. Purpose and scope

This document is the **methods-and-workflow contract** for prompt18: unify META·LAB and META·SIFT so the researcher experiences **one "Review Project"** with a **single Screening stage** that contains the entire META·SIFT experience, while META·SIFT remains a separate backend engine.

It defines, from a systematic-review methodology standpoint:

- the exact ordered stage list of the unified review (as-built);
- why we keep META·LAB's richer analysis stages instead of collapsing to a generic 8-stage flow;
- why all of META·SIFT folds into the single Screening stage, and the internal sub-stage order of that stage;
- how every stage handoff (search → screening → full-text → extraction → risk of bias → analysis → PRISMA → report) stays methodologically correct after unification;
- how the 12 product requirements map onto a correct PRISMA 2020 review process.

This plan does **not** change any statistics, any screening decision logic, any schema, or the screening engine. It changes only the *navigation and identity* of the product so the workflow reads as one continuous systematic review.

---

## 2. The one mental model: a single review, two engines underneath

The researcher should think in exactly one object: **the Review Project** (the META·LAB `Project`). Everything they do — define the question, build the search, screen records, extract data, synthesise, report — happens inside that one project, walking left-to-right through stages.

Underneath, two engines do the work and that separation is preserved:

- **META·SIFT engine** (`ScreenProject` + `ScreenRecord`/`Decision`/`Conflict`/`DuplicateGroup`/`ImportBatch`/`Member`/`Chat`/`Audit`) owns *citation-level* work: import, deduplication, title/abstract screening, conflict resolution, full-text review, and the shared membership/permission/chat/audit layer.
- **META·LAB engine** (`Project.data` JSON: pico, prisma, studies[], analysis) owns *study-level* work: extraction, risk of bias, meta-analysis, GRADE, PRISMA reporting, manuscript.

The unification is at the **experience** layer, not the engine layer. The `ScreenProject` linked to a `Project` via the soft FK `linkedMetaLabProjectId` is treated as the review's **screening module** — auto-created, auto-repaired, invisible-but-present. The user never "links" anything; they just open the Screening stage.

This is the right division of labour methodologically: PRISMA 2020 itself separates **records** (citations, screened at title/abstract then full-text) from **studies** (the included reports you extract and synthesise). META·SIFT is the record layer; META·LAB is the study layer. The product now mirrors the methodology instead of cutting across it.

---

## 3. The unified stage list (as-built)

The main project navigation is **simple and linear** — one button per stage, in methodological order. This is the exact monolith stage list as built (mapped to `TABS` in `meta-lab-3-patched.jsx`, with phase grouping in the sidebar):

| # | Stage (user label) | Phase group | Engine that does the work | Methodological role |
|---|--------------------|-------------|---------------------------|---------------------|
| — | **Overview** | Project | META·LAB | Review dashboard; Screening progress card lives here |
| — | **Project Control** | Project | META·LAB + shared member layer | Unified membership, roles, settings (one roster for the whole review) |
| 1 | **PICO & Question** | Plan | META·LAB | Define the answerable question (P/I/C/O), eligibility framing |
| 2 | **Protocol** | Plan | META·LAB | Register the protocol (PROSPERO), pre-specify methods |
| 3 | **Search Builder** | Search | META·LAB | Build and document the database search strategy |
| 4 | **Screening** *(NEW — embeds all META·SIFT)* | Screen | **META·SIFT engine** | Import → dedup → title/abstract → conflicts → full-text → included |
| 5 | **PRISMA** *(flow, auto-filled)* | Screen | META·LAB, fed by Screening rollup | PRISMA 2020 flow diagram; counts auto-fill from Screening |
| 6 | **Data Extraction** | Extract | META·LAB | Extract outcome data from the **included** studies |
| 7 | **Risk of Bias** | Extract | META·LAB | RoB / quality appraisal of included studies |
| 8 | **Meta-Analysis** | Analyze | META·LAB | Pooled effect, heterogeneity (τ², I²) |
| 9 | **Forest Plot** | Analyze | META·LAB | Forest visualisation of the synthesis |
| 10 | **Sensitivity & Bias** | Analyze | META·LAB | Leave-one-out, influence, Egger, trim-and-fill |
| 11 | **Subgroup Analysis** | Analyze | META·LAB | Subgroup / moderator synthesis |
| 12 | **GRADE Certainty** | Report | META·LAB | Certainty-of-evidence assessment |
| 13 | **PRISMA Checklist** | Report | META·LAB | 27-item PRISMA 2020 reporting checklist |
| 14 | **Manuscript Draft** | Report | META·LAB | Assemble the write-up |
| — | **Methods** | Reference | META·LAB | Reference: equations and methods actually implemented |

Notes that make this faithful to the codebase:
- The display labels for the deliverable's headline list are: **Overview, PICO & Question, Protocol, Search Builder, Screening, PRISMA, Data Extraction, Risk of Bias, Meta-Analysis (+ Forest / Sensitivity / Subgroup), GRADE, PRISMA Checklist, Manuscript, Project Control, Methods.** The four analysis tabs (Meta-Analysis, Forest, Sensitivity, Subgroup) share the **Analyze** phase group; in the headline they read as "Meta-Analysis (+Forest/Sensitivity/Subgroup)".
- The existing monolith tab whose `id` is `prisma` is **renamed and demoted**: it was "Screening & PRISMA" (phase `Screen`, num 4); it becomes the **PRISMA** flow stage only. The new **Screening** stage takes the lead position in the Screen phase as the home of all citation-level work.
- Overview, Project Control (phase `null`, group `project`) and Methods (reference) stay out of the numbered workflow walker — correct, since they are not sequential review steps.

---

## 4. Why we keep META·LAB's richer analysis stages (and do NOT collapse to 8 generic stages)

A naïve "unify" would flatten everything into ~8 generic stages (e.g. Plan / Search / Screen / Extract / Appraise / Synthesise / Grade / Write). We deliberately **do not** do that. Reasons, in methodological terms:

1. **Synthesis is not one step — it is several distinct, separately-reportable analyses.** PRISMA 2020 items 13a–13f and 20–23 require *primary synthesis*, *heterogeneity*, *sensitivity analyses*, *subgroup/meta-regression*, and *risk of reporting/publication bias* to be reported as separate results. META·LAB already exposes these as Meta-Analysis, Forest, Sensitivity & Bias, and Subgroup. Collapsing them into one "Synthesise" tab would hide reportable outputs (Egger's test, trim-and-fill, leave-one-out influence, subgroup contrasts) that reviewers and the checklist explicitly demand.

2. **These are real, verified implementations, not placeholders.** The engine computes random-/fixed-effects pooling, I²/τ², leave-one-out and influence diagnostics, Egger's regression (canonical unweighted OLS since prompt10), trim-and-fill centred on the selected model (metafor-matched since prompt13), and subgroup analysis — all catalogued in the Methods tab against verified references. Throwing UI surface away would waste working, validated capability and reduce methodological rigour. The product's differentiator *is* this analytical depth.

3. **GRADE and the PRISMA checklist are mandatory, distinct deliverables.** GRADE certainty (Report phase) and the 27-item PRISMA 2020 checklist are separate obligations from the flow diagram. A generic 8-stage model conflates "report" into one box; the review needs all three (PRISMA flow, GRADE, checklist) as their own surfaces.

4. **The richness is META·LAB's value; the friction was never the analysis.** The friction the user complained about was the *two-apps* feeling (two dashboards, link/unlink chrome), **not** the granularity of analysis. So we fix the friction (fold META·SIFT into one Screening stage, remove all linking language) while *preserving* the analytical granularity that makes META·LAB worth using.

**Conclusion:** keep META·LAB's full analysis ladder; fold *only* META·SIFT (the part that felt like a second app) into the single Screening stage.

---

## 5. The Screening stage — one stage, the whole of META·SIFT inside

The new **Screening** stage embeds the entire `SiftProject` experience for the auto-resolved linked `ScreenProject`, in **embedded mode**: no page chrome, no second `UserMenu`/`NotificationsBell`, and **no LinkBadge** (no link/unlink modal — there is nothing to link in normal UX). `SiftProject`'s own internal tabs become the **Screening sub-navigation**.

### 5.1 Screening sub-nav (internal sub-stages), in methodological order

| Sub-stage | Source tab (`SiftProject`) | What the reviewer does | PRISMA mapping |
|-----------|----------------------------|------------------------|----------------|
| **Import** | inline embedded `SiftImport` (Import button) | Load records from databases (RIS/CSV/NBIB), per ImportBatch | "Records identified from databases/registers" |
| **Duplicates** | `DuplicatesTab` | Review/merge `DuplicateGroup`s | "Records removed before screening: duplicates" |
| **Title/Abstract** | `ScreeningTab` (label "Screening") | First-pass include/exclude/maybe on records | "Records screened" → "Records excluded" |
| **Conflicts** | `ConflictsTab` | Resolve disagreements between reviewers | Reconciliation supporting the screened count |
| **Full Text** | `SecondReviewTab` (label "Second Review") | Retrieve and assess reports for eligibility | "Reports sought / assessed for eligibility" → "Reports excluded, with reasons" |
| **Included** | finalized accepts (handoff target) | The set of studies that pass full-text | "Studies included in review" |
| **Settings / Export** | `ProjectControlTab` (settings) + `ExportTab` | Module config + citation/decision export | Supports reproducibility/audit |

The headline sub-nav order for the deliverable: **Import → Duplicates → Title/Abstract → Conflicts → Full Text → Included → Settings/Export.** This is the canonical PRISMA 2020 left-to-right flow: identify → de-duplicate → screen titles/abstracts → reconcile → assess full text → finalise included → export/configure.

### 5.2 Why "Full Text" is a *sub-stage of Screening*, not a top-level stage

Full-text assessment is **eligibility screening at the report level** — it is still deciding *which citations qualify*, not yet extracting data from them. PRISMA 2020 groups title/abstract screening and full-text assessment together in the **identification/screening** band of the flow diagram, upstream of "included → synthesis". Putting Full Text inside the Screening stage (as the `SecondReviewTab` / Second Review sub-tab) keeps the boundary correct: **Screening = selection of studies; Extraction onward = working with the selected studies.** This is also what avoids re-introducing a "second app" feeling — full-text review is screening, so it lives in the Screening stage.

---

## 6. Stage handoffs — methodological correctness (the part that must not break)

The unification must not alter the chain of custody from citations to synthesis. The handoffs already exist in the backend and are preserved verbatim:

### 6.1 Search → Screening
The Search Builder documents the strategy (META·LAB); the actual records enter via **Import** inside Screening (META·SIFT `ImportBatch`/`ScreenRecord`). No automatic transfer is required or correct here — the search strategy is a *protocol artifact*; the records are *imported evidence*. Keeping them distinct is faithful to PRISMA item 7 (search) vs item 8 (selection process).

### 6.2 Screening → Full Text → **Included** (record layer, inside the stage)
Title/abstract `Decision`s drive records to full-text; conflicts are reconciled; `SecondReviewTab` finalises full-text decisions. A record finalised as **accept** is the methodological "study included in review".

### 6.3 Included → **Data Extraction** (record layer → study layer — THE critical handoff)
When a record is finalised as `accept` in full-text (Second Review), the engine **appends a study to `Project.data.studies[]`**, idempotently. Confirmed in `server/controllers/screeningReviewController.js`:
- it only hands off when `screenProject.linkedMetaLabProjectId` resolves (the module link);
- it dedupes by **DOI / PMID / normalized title** before pushing (`data.studies.some(...)` guard, then `data.studies.push(study)`), so re-finalising or re-running cannot create duplicate studies;
- it carries provenance for idempotent pull-merge/dedupe.

This is exactly the methodological contract Data Extraction needs: **the extraction stage receives precisely the studies that passed full-text screening, once each.** Because both engines now live inside one Review Project, this is no longer a cross-app sync — it is the natural progression from the Screening stage to the Extraction stage. **Backend must keep this dedupe logic untouched.**

### 6.4 Extraction → Risk of Bias → Meta-Analysis → Forest/Sensitivity/Subgroup → GRADE
Pure META·LAB study-layer flow, unchanged. Extracted outcome data feeds the synthesis engine; RoB feeds GRADE's risk-of-bias domain; synthesis outputs feed Forest/Sensitivity/Subgroup; the whole picture feeds GRADE certainty. No change from unification — these were always one engine.

### 6.5 Screening + Included → **PRISMA** flow (auto-filled)
The **PRISMA** stage's flow-diagram numbers must come from the Screening rollup, **not** a parallel manual count. The rollup already exists: `server/controllers/screeningOverviewController.js` computes, per record set, `total` (identified), duplicates, `screened`, `included`, `excluded`, `maybe`, `undecided`, plus `duplicateDetectionRun`; and `GET /api/screening/metalab/:mlpid/summary` exposes the link-aware module summary. The PRISMA stage consumes these so the flow diagram is always consistent with what actually happened in Screening. This kills the old failure mode where a researcher hand-typed PRISMA numbers that drifted from their screening log — a real reproducibility hazard PRISMA 2020 (item 16a, the flow diagram) is designed to prevent.

---

## 7. The 12 requirements mapped to the workflow

1. **Auto structure on create.** Creating a Review Project always provisions the screening module server-side (`createLinkedScreenProject`, with `createLinkedSift` forced on for the unified create path). The reviewer never sees a "do you also want screening?" question — every review can screen, because every review needs to.
2. **Never manual link.** No link/unlink UX in normal flow: LinkBadge removed in embedded mode; the create checkbox removed; the Control/PRISMA "create a linked META·SIFT" CTAs removed. First open of Screening lazily ensures/repairs the module via `ensureScreenModuleForMetaLab` + `GET /api/screening/metalab/:mlpid/workspace` → `{screenProjectId, created, repaired}`. Linking is an *internal* concern, never a *user* task.
3. **Screening as a stage.** One "Screening" stage button in the Screen phase, embedding the whole `SiftProject` (embedded mode). The user sees one stage; all of META·SIFT lives inside it.
4. **Full-text as a sub-stage.** Full-text review is the **Full Text** sub-tab (Second Review) inside Screening — eligibility assessment at the report level, upstream of extraction (section 5.2).
5. **Extraction receives accepted studies.** Accept-in-full-text appends to `Project.data.studies[]`, idempotent by DOI/PMID/title (section 6.3). Data Extraction works on exactly that included set.
6. **PRISMA updates.** PRISMA flow numbers auto-fill from the Screening rollup (`screeningOverviewController` counts + metalab summary), never hand-typed (section 6.5).
7. **Unified Project Control / members.** One roster for the whole review. Membership is defined on the `ScreenProject` and *also* grants META·LAB access (`getMetaLabMemberAccess` / `listSharedMetaLabAccess`), so a person added once can both screen and extract/analyse per their permissions. The unified Project Control surface is the single place to manage who is on the review.
8. **Shared chat.** One review-wide chat via `/api/screening/metalab/:mlpid/chat` — the same conversation whether a member is in Screening or in Analysis. No per-app chat silos.
9. **Notifications point to the review project/stage.** Invites, role changes, conflict/assignment events resolve to **the Review Project and the relevant stage** (e.g. deep-link to `…/project/:id?tab=screening`), not to a separate `/sift-beta` destination. The reviewer is always returned to the one project.
10. **Ops sees internals.** Ops/Admin can still inspect module health — screen project id, records count, handoff rollup, missing-module/repair status — under "Internal screening engine" wording. Internals are observable to operators, invisible to researchers.
11. **Advanced linking only in admin/debug.** The `/sift-beta` dashboard and standalone `SiftProject` route are hidden from normal nav (kept for back-compat deep-links + admin/debug). UserMenu "Open META·SIFT" is gated to staff. Re-link / unlink / link-to-different-project survive **only** as admin/debug tools.
12. **No data loss / additive migration.** A backfill provisions a linked `ScreenProject` for any existing Project lacking one; standalone `ScreenProject`s keep working via deep-link/admin; old routes still resolve; permissions are preserved (membership already flows ML access). DB-push deploy rule: additive/nullable columns only, no new `@unique`. (No schema change is actually required.)

---

## 8. Methodological acceptance criteria (what "correct" means for this phase)

The QA/Security engineer should treat these as the methods-side gates:

1. **One included set.** A record accepted in full-text appears exactly once in Data Extraction's study list; re-finalising the same record (same DOI/PMID/title) does not create a duplicate study. (Guards in `screeningReviewController.js`.)
2. **PRISMA consistency.** PRISMA flow numbers equal the Screening rollup: identified = total imported; duplicates removed = dedup count; screened/excluded/maybe/undecided and included match `screeningOverviewController` output. No hand-entered number can contradict the screening log.
3. **Stage boundary held.** Nothing reaches Data Extraction that has not passed Full Text; full-text assessment lives inside Screening, not as a separate top-level stage.
4. **Order preserved.** Screening sub-nav renders Import → Duplicates → Title/Abstract → Conflicts → Full Text → Included → Settings/Export; main nav renders the 14-row stage list of section 3 in order.
5. **No regression in analysis.** Embedding Screening must not touch any statistic; Meta-Analysis/Forest/Sensitivity/Subgroup/GRADE outputs are byte-identical to pre-unification for the same `data.studies`.
6. **Reproducibility intact.** Export still produces the citation + decision audit trail needed to reproduce the selection process (PRISMA item 8) and the search (item 7).

---

## 9. Honest assessment / risks (the user asked for candor)

- **The hard methodological work was already done.** The accept→`data.studies` handoff, the PRISMA-shaped rollup, the membership→ML-access bridge, and the shared chat all already exist on the backend. Prompt18 is genuinely a *navigation/identity* fix, not a methods build. We should not over-claim novelty here.
- **The real prior sin was UX, and it was a methodological hazard too.** Two dashboards plus manual link/unlink language did not just feel like two apps — it invited researchers to run screening "somewhere else" and then *re-type* PRISMA numbers into META·LAB, which is exactly how flow-diagram counts drift from the screening log. Folding Screening in and auto-filling PRISMA removes a genuine reproducibility risk, not only friction.
- **Watch the dedupe key.** The handoff dedupes by DOI/PMID/normalized title. Records with no DOI/PMID and a noisy title (e.g. conference abstracts) could in theory slip a near-duplicate study into extraction. This pre-dates prompt18 and is out of scope to fix here, but it is the one place where "exactly the included set, once each" is best-effort, not guaranteed. Flag for a future prompt.
- **Embedded mode must not silently swallow permission errors.** When Screening lazily ensures/repairs the module, a member who *can* see the review but cannot screen must get a clear, in-stage "you don't have screening permission" state — not a blank embed. The methods chain assumes the right people do the right sub-stages; the UI must reflect the permission layer honestly.
- **Don't let "auto-create" hide a broken module.** If `ensureScreenModuleForMetaLab` reports `repaired:true` repeatedly for the same project, that is a real signal for Ops, not something to swallow. Surface it under "Internal screening engine" health.

---

## 10. Summary

One Review Project. A simple, linear, methodologically-ordered stage list that **keeps** META·LAB's full analysis ladder (because synthesis, sensitivity, subgroup, GRADE, and the PRISMA checklist are distinct, mandatory, reviewer-facing outputs) and **folds all of META·SIFT into a single Screening stage** (Import → Duplicates → Title/Abstract → Conflicts → Full Text → Included → Settings/Export). The engines stay separate; the experience becomes one continuous systematic review. The critical handoffs — included studies → extraction, screening counts → PRISMA — already exist, are idempotent, and must be preserved exactly.
