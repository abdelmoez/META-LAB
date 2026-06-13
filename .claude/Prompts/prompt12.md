CLAUDE MAX / FABLE 5.0 — META·LAB COMPLETE RESEARCH WORKFLOW ROADMAP, FEASIBILITY CHECK, SAFE IMPLEMENTATION, AND AUTONOMOUS EXECUTION

Claude, I want you to treat this as a major product-planning and implementation prompt for META·LAB and META·SIFT.

I do not want you to blindly add features and break the app.

I want you to think like:
- a senior full-stack architect
- a medical research software expert
- a systematic review methodologist
- a UX/product designer
- a security reviewer
- a QA engineer
- a founder trying to build a serious research platform for hospitals, universities, and research institutes

I want you to have full autonomy, but I want you to be careful.

Your job is not just to implement everything immediately.
Your job is to:

1. Inspect the current app.
2. Check what is already implemented.
3. Check what is partially implemented.
4. Check what is missing.
5. Check feasibility.
6. Check risk of breaking existing workflows.
7. Create a safe implementation roadmap.
8. Prioritize the most important features.
9. Implement only what is feasible and safe in this cycle.
10. Add tests.
11. Run QA.
12. Version, commit, and push if possible.
13. Report clearly what was implemented, what was postponed, and why.

Do not ask me small questions.
Make decisions.
If something is risky, document it and choose the safer path.
If something already exists, improve it instead of duplicating it.
If something is not feasible now, create the architecture and documentation for later.
If something can break existing workflows, do not implement it until you create tests and a rollback-safe plan.

Use this workflow:

Fable:
- You are the main architect and advanced reasoning lead.
- You make the overall workflow.
- You decide priorities.
- You judge feasibility.
- You assign execution tasks to Sonnet.
- You assign reasoning/statistical/methodological tasks to Opus.
- You make the final version bump, commit, and push decision.

Opus:
- Handle reasoning-heavy tasks.
- Evaluate systematic review methodology.
- Evaluate meta-analysis correctness.
- Evaluate GRADE/RoB/protocol feasibility.
- Evaluate workflow design and edge cases.
- Validate that research features are methodologically sound.

Sonnet:
- Implement straightforward code changes.
- Build UI components.
- Add tests.
- Update docs.
- Clean up styling.
- Connect APIs.
- Handle refactors assigned by Fable.

Use the existing team:
1. Main Claude / Fable — Overall Manager, Architect, Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. Collaboration & Realtime Agent
6. QA Developer
7. Website Manager / Public Website Agent
8. Security & Diagnostics Agent
9. Methodology Agent — add this if useful for RoB, GRADE, protocol, PRISMA, and evidence synthesis logic

Do not rebuild from scratch.
Do not wipe/reset/delete the database.
Do not run destructive migrations without backup.
Do not remove working features unless clearly obsolete and documented.
Do not break META·LAB.
Do not break META·SIFT.
Do not break linked Review Workspace logic.
Do not break owner/leader/member/viewer permissions.
Do not break Data Extraction or analysis.
Do not commit secrets.
Do not commit broken builds.

====================================================
PHASE 0 — INSPECT FIRST, DO NOT CODE YET
====================================================

Before coding, inspect the full app.

Check:

1. META·LAB:
- login flow
- project landing page
- project overview
- project control
- protocol/PICO areas
- data extraction
- analysis engine
- PRISMA
- methods/equations
- exports
- project permissions
- linked META·SIFT behavior

2. META·SIFT:
- project overview
- import
- duplicate management
- screening
- full-text/second review
- conflict resolution
- PDF/full-text handling if present
- chat
- notifications
- member roles
- Data Extraction handoff to META·LAB

3. Shared system:
- Review Workspace
- owner/leader/member/viewer roles
- permissions
- linked project behavior
- notifications
- invites
- chat
- versioning
- ops console
- audit logs
- settings
- theme/design system

4. Research engine:
- effect size calculations
- meta-analysis models
- heterogeneity
- Egger test
- trim-and-fill
- forest/funnel plots
- diagnostic/proportion/survival support if present
- validation logic

5. Ops/Admin/Mod:
- users
- roles
- messages
- metrics
- project/workspace visibility
- app settings
- feature flags
- security/audit areas

Create this document first:

docs/manager/complete-workflow-existing-feature-map.md

For every major feature below, mark one of:
- Implemented and working
- Implemented but needs improvement
- Partially implemented
- Missing
- Risky to implement now
- Not feasible in current architecture
- Should be postponed

Do not guess. Inspect the code.

====================================================
PHASE 1 — FEASIBILITY AND RISK ASSESSMENT
====================================================

After mapping existing features, create:

docs/manager/complete-workflow-feasibility-and-risk-report.md

For each proposed feature, include:
1. What it does.
2. Why it matters.
3. Whether it already exists.
4. Feasibility:
   - easy
   - moderate
   - difficult
   - risky
5. Risk to existing app.
6. Database changes needed.
7. Backend changes needed.
8. Frontend changes needed.
9. Research-methodology validation needed.
10. Testing needed.
11. Recommendation:
   - implement now
   - improve existing
   - design architecture only
   - postpone
   - reject/avoid

Be honest. If something is too risky right now, do not force it.

====================================================
PHASE 2 — CREATE THE MASTER WORKFLOW MAP
====================================================

I want META·LAB and META·SIFT to eventually support a complete systematic review/meta-analysis workflow.

Create:

docs/manager/meta-lab-master-workflow-map.md

The ideal workflow should be:

1. Project Landing / Project Selector
2. Project Overview / Command Center
3. Protocol Builder
4. Search Strategy and Import
5. Duplicate Management
6. Title/Abstract Screening
7. Full-Text Review / Second Review
8. Study Inclusion Finalization
9. Data Extraction
10. Risk of Bias Assessment
11. Analysis Readiness Check
12. Meta-Analysis
13. Sensitivity/Subgroup/Publication Bias
14. GRADE / Certainty of Evidence
15. PRISMA Auto-Generation
16. Report / Manuscript / Export
17. Reproducibility Package
18. Audit Trail
19. Project Control / Members / Permissions
20. Ops/Admin oversight

For each stage, define:
- purpose
- current state
- missing pieces
- inputs
- outputs
- who can access
- what data is saved
- how it links to next stage
- what should be tested

This workflow map is important. Do not skip it.

====================================================
PHASE 3 — PRIORITIZATION
====================================================

Create:

docs/manager/implementation-priority-plan.md

Prioritize features into:

A. Must stabilize now
B. High-value next
C. Research credibility features
D. Collaboration polish
E. Institutional features
F. Future AI features
G. Postpone

My suggested priority order is:

First:
- make the end-to-end workflow stable
- project landing
- linked META·LAB/META·SIFT reliability
- permission reliability
- Data Extraction handoff
- export reliability
- audit logs
- full QA testing

Second:
- protocol builder
- extraction templates
- analysis readiness checks
- risk of bias
- GRADE
- reviewer agreement metrics

Third:
- manuscript/report generator
- reproducibility package
- institutional team features
- AI assistance

You may adjust this based on what you find in the code.
I want your opinion.

====================================================
FEATURE GROUP 1 — PERFECT END-TO-END GOLDEN PATH
====================================================

This is the most important.

Create or improve the “golden path”:

Create project → define PICO/protocol → import studies → remove duplicates → screen → second review → send included studies to Data Extraction → extract data → run analysis → PRISMA → export report

Requirements:
1. User always knows what the next step is.
2. Every project has a visible stage/progress.
3. Broken or incomplete stages show clear warnings.
4. META·LAB and META·SIFT linked state is always obvious.
5. Data handoff is reliable.
6. Project permissions are enforced.
7. Viewer/read-only users cannot edit.
8. Owner/leader/member roles are clear.
9. No stage silently fails.
10. No project opens the wrong linked project.

If this is not already perfect, prioritize this before adding advanced features.

====================================================
FEATURE GROUP 2 — PROJECT COMMAND CENTER
====================================================

Improve or implement a project command center.

This should exist:
- after opening a project in META·LAB
- ideally also in META·SIFT or shared workspace overview

It should show:
- project title
- owner
- leaders
- members
- current user role
- project status
- linked META·SIFT status
- PICO summary
- protocol completeness
- imported records
- duplicates
- screened records
- full-text/second-review records
- final included studies
- data extraction count
- analysis readiness
- PRISMA readiness
- recent activity
- next recommended step

The command center should answer:
- Where am I in the review?
- What is incomplete?
- What should I do next?
- Who needs to act?
- Is this ready for analysis/export?

If something similar exists, improve it rather than duplicate it.

====================================================
FEATURE GROUP 3 — REVIEW PROTOCOL BUILDER
====================================================

Check whether a protocol builder already exists.

If missing or weak, design/implement a safe first version.

Protocol fields:
- review title
- background/rationale
- review question
- PICO
- primary outcome
- secondary outcomes
- inclusion criteria
- exclusion criteria
- study designs
- population criteria
- intervention/exposure
- comparator
- outcomes
- databases searched
- planned search dates
- language restrictions
- date restrictions
- planned effect measures
- planned model: fixed/random
- planned subgroup analyses
- planned sensitivity analyses
- planned publication bias approach
- PROSPERO registration
- protocol version history

Requirements:
1. Save protocol in database.
2. Auto-feed PICO/inclusion/exclusion to META·SIFT keywords when linked.
3. Show protocol completeness percentage.
4. Track version history if feasible.
5. Export protocol as PDF/DOCX/Markdown if feasible.
6. Do not break existing PICO fields; migrate or sync carefully.

If too much for one cycle:
- implement the structure and core fields first
- document advanced versioning/export later

====================================================
FEATURE GROUP 4 — SEARCH STRATEGY AND IMPORT INTELLIGENCE
====================================================

Check current import/search strategy features.

Improve toward:
- database-specific search strings
- PubMed
- Embase
- Scopus
- Web of Science
- Cochrane
- CINAHL if useful
- manual source
- gray literature
- search date
- database name
- imported file batch
- import fingerprint/hash
- duplicate file warning
- source tagging
- import history
- re-run search/update import later

Requirements:
1. Do not import the same file twice without warning.
2. Store import batches.
3. Show import history.
4. Track source database for each record.
5. Make PRISMA records identified/imported more reliable.
6. Preserve existing parsers.
7. Add tests for duplicate file detection.

====================================================
FEATURE GROUP 5 — DUPLICATE MANAGEMENT
====================================================

Check current duplicate logic.

Improve:
- DOI match
- PMID match
- title normalization
- fuzzy title similarity
- author/year similarity
- similarity percentage
- reason for duplicate suggestion
- vertical comparison layout
- merge metadata safely
- keep primary record
- mark not duplicate
- audit duplicate decisions
- update PRISMA duplicate count

Add tests:
- exact DOI duplicate
- exact PMID duplicate
- fuzzy title duplicate
- not duplicate
- resolved duplicate count updates PRISMA

====================================================
FEATURE GROUP 6 — SCREENING AND FULL-TEXT REVIEW
====================================================

Check current META·SIFT screening and second-review features.

Improve:
- two-reviewer rule
- reviewer-specific decisions
- one active decision per reviewer per article
- conflict detection
- conflict resolution
- included conflicts go to second review
- second review accepted studies go to Data Extraction
- exclusion reasons
- full-text exclusion table
- PDF/full-text notes if already supported
- reviewer activity
- per-reviewer progress
- leader-only team progress
- reviewer agreement metrics if feasible

Add:
- Cohen’s kappa for two reviewers if feasible
- percent agreement
- conflict rate

If kappa is too much now, document and implement percent agreement first.

====================================================
FEATURE GROUP 7 — DATA EXTRACTION TEMPLATES AND VALIDATION
====================================================

Check current Data Extraction.

Add or improve structured templates:
- RCT template
- cohort template
- case-control template
- diagnostic accuracy template
- single-arm/proportion template
- survival/HR template
- adverse events template

Validation:
- missing sample size
- impossible counts
- negative counts
- zero-cell warning with correct correction
- incompatible outcome type
- unit mismatch
- duplicated study arm
- duplicated study/cohort
- missing SD/SE/CI
- suspicious CI direction
- invalid p-values
- invalid HR/RR/OR values

The goal:
Data Extraction should prevent common meta-analysis mistakes.

Do not block valid clinical data like zero events.
Warn intelligently.

====================================================
FEATURE GROUP 8 — ANALYSIS READINESS CHECK
====================================================

Before running meta-analysis, add or improve an Analysis Readiness Check.

It should check:
- at least two studies
- same outcome
- compatible effect measure
- valid effect sizes
- valid SE/CI
- no NaN/Infinity
- no impossible values
- heterogeneity warnings
- duplicate cohort warning
- enough studies for publication bias tests
- subgroup feasibility
- sensitivity feasibility
- model selection warning

It should show:
- Ready
- Ready with warnings
- Not ready

This would make META·LAB feel trustworthy and professional.

====================================================
FEATURE GROUP 9 — META-ANALYSIS METHOD QUALITY
====================================================

Check current research engine.

Verify:
- fixed effect
- random effects
- inverse variance
- DerSimonian-Laird tau²
- Q
- I²
- confidence intervals
- prediction interval if present
- HKSJ if present
- Egger test
- trim-and-fill
- leave-one-out
- influence diagnostics
- subgroup analysis

Create:
docs/manager/research-engine-method-validation-report.md

For each method:
- implemented?
- formula correct?
- tests exist?
- edge cases?
- needs improvement?

Do not change correct math unnecessarily.
Fix incorrect math only with tests.

====================================================
FEATURE GROUP 10 — RISK OF BIAS TOOLS
====================================================

Check if RoB exists.

If missing, design an architecture first.

Risk of Bias tools eventually needed:
- RoB 2 for randomized trials
- ROBINS-I for non-randomized studies
- QUADAS-2 for diagnostic accuracy studies
- Newcastle-Ottawa Scale for cohort/case-control
- custom RoB template

Safe first implementation:
1. Create generic Risk of Bias module.
2. Allow choosing tool per project or outcome.
3. Add structured domains.
4. Add reviewer judgments.
5. Add notes.
6. Add overall judgment.
7. Add conflict/resolution if two reviewers.
8. Export RoB table.

If full RoB 2/ROBINS-I is too much now:
- implement generic framework
- add one simpler tool first
- document roadmap

====================================================
FEATURE GROUP 11 — GRADE AND SUMMARY OF FINDINGS
====================================================

Check if GRADE exists.

If missing, design or implement first version.

GRADE should include:
- outcome
- number of studies
- participants
- effect estimate
- risk of bias
- inconsistency
- indirectness
- imprecision
- publication bias
- certainty:
  - high
  - moderate
  - low
  - very low
- reasons for downgrading/upgrading
- Summary of Findings table

If too much for one cycle:
- create GRADE data model and UI skeleton
- implement manual GRADE table first
- auto-populate from meta-analysis later

====================================================
FEATURE GROUP 12 — PRISMA AUTO-GENERATION
====================================================

Check current PRISMA.

Improve:
- imported records
- duplicates removed
- records screened
- records excluded
- full-text assessed
- full-text excluded with reasons
- final included studies
- studies in quantitative synthesis
- auto-update from META·SIFT
- manual override with audit log if needed

Ensure PRISMA is not disconnected from actual workflow.

====================================================
FEATURE GROUP 13 — REPORT / MANUSCRIPT GENERATOR
====================================================

Check whether any report generator exists.

Eventually, add:
- methods section draft
- search strategy appendix
- PRISMA explanation
- study characteristics table
- RoB table
- results paragraph
- heterogeneity paragraph
- publication bias paragraph
- GRADE/Summary of Findings
- limitations paragraph
- export to DOCX/PDF/Markdown

Important:
This should be transparent and editable.
Do not invent results.
Use only project data.

If too much now:
- implement report outline/export skeleton
- document full generator later

====================================================
FEATURE GROUP 14 — REPRODUCIBILITY PACKAGE EXPORT
====================================================

Design or implement a “Reproducibility Package.”

It should export:
- protocol
- search strings
- import logs
- screening decisions
- excluded studies with reasons
- extraction table
- RoB judgments
- analysis settings
- equations/methods
- PRISMA data
- figures
- final included studies
- audit log

This would make META·LAB more attractive to institutions.

If too much now:
- design architecture
- implement partial export bundle
- document future expansion

====================================================
FEATURE GROUP 15 — AUDIT TRAIL EVERYWHERE
====================================================

Check current audit logs.

Audit major actions:
- project created
- project renamed
- project archived/deleted
- member added/removed
- role changed
- permission changed
- import performed
- duplicate resolved
- screening decision changed
- conflict resolved
- second review accepted/rejected
- data extraction edited
- effect size calculated/applied
- analysis settings changed
- export generated
- PRISMA overridden
- GRADE edited
- RoB edited

Audit logs should include:
- who
- what
- when
- old value if safe
- new value if safe
- project/workspace
- module

Do not over-log sensitive content if inappropriate.
Use your judgment.

====================================================
FEATURE GROUP 16 — COLLABORATION AND TASKS
====================================================

Check current chat/notifications.

Improve or design:
- project chat
- shared META·LAB/META·SIFT chat
- notifications
- project invites
- assignments
- tasks
- “needs your review”
- due dates if useful
- reviewer calibration round
- activity feed

If feasible, add a small task system:
- task title
- assigned to
- project
- due date optional
- status
- created by
- linked stage

If not feasible now, document roadmap.

====================================================
FEATURE GROUP 17 — OPS / INSTITUTIONAL FEATURES
====================================================

Check ops console.

Improve:
- organizations/teams later
- users
- roles
- mods
- projects/workspaces
- metrics
- audit logs
- settings
- feature flags
- email status
- invite status
- security diagnostics
- app version
- backup/export warnings
- storage status if relevant

Do not overload ops with dangerous controls.
Admins need power, but safe design.

====================================================
FEATURE GROUP 18 — AI FEATURES LATER, AUDITABLE ONLY
====================================================

AI should remain hidden or optional unless already safe.

Future AI features:
- suggest inclusion/exclusion keywords
- suggest screening decision
- suggest extraction values
- detect extraction inconsistencies
- draft methods/results paragraphs
- suggest RoB concerns
- explain heterogeneity
- summarize full text

Rules for future AI:
- must be optional
- must show source text
- must show confidence
- must allow accept/reject/edit
- must audit accepted suggestions
- must not silently make research decisions

For now:
- keep AI hidden unless already implemented safely.
- do not make AI central yet.

====================================================
IMPLEMENTATION STRATEGY
====================================================

After inspection and feasibility review, do not implement everything blindly.

Choose one of these paths:

Path A — Stabilization Release:
If the app has fragile core workflow, focus on:
- golden path
- project command center
- permission reliability
- Data Extraction handoff
- PRISMA sync
- exports
- tests

Path B — Research Credibility Release:
If core workflow is stable, focus on:
- protocol builder
- data extraction templates
- analysis readiness
- research-engine validation
- RoB/GRADE skeleton

Path C — Collaboration Release:
If research workflow is stable, focus on:
- reviewer agreement
- tasks
- audit logs
- notifications
- shared chat
- assignments

Path D — Institutional Release:
If everything above is stable, focus on:
- ops metrics
- organizations
- reproducibility package
- report generator
- backup/restore architecture

Fable should choose the path based on current code reality.

Document the chosen path in:

docs/manager/chosen-implementation-path.md

====================================================
SAFE IMPLEMENTATION RULES
====================================================

1. Check if feature already exists before adding.
2. Do not duplicate features.
3. Do not create parallel systems unless needed.
4. Do not break existing routes.
5. Do not break database data.
6. Use additive migrations.
7. Keep feature flags where useful.
8. Add tests before/with risky changes.
9. Add empty states for incomplete features.
10. Make partially implemented features clearly labeled.
11. Avoid hidden failures.
12. Avoid fake metrics.
13. Avoid silent data changes.
14. Avoid UI that suggests something works when it does not.
15. Document postponed features.

====================================================
QA REQUIREMENTS
====================================================

QA must run a full diagnostic flow after implementation.

Minimum manual QA:
1. Login.
2. Create project.
3. Open project overview.
4. Add/confirm protocol/PICO if implemented.
5. Create/link META·SIFT.
6. Import records.
7. Detect duplicates.
8. Screen records.
9. Resolve conflict if applicable.
10. Send included study to Data Extraction.
11. Extract or calculate effect size.
12. Run analysis.
13. Check PRISMA.
14. Export something.
15. Test owner/leader/member/viewer permissions.
16. Test read-only behavior.
17. Test project reload after logout/login.
18. Test linked project navigation.
19. Test ops visibility if affected.
20. Confirm build passes.

Automated tests:
Add or update tests for every implemented feature.

Do not mark complete if:
- build fails
- core project flow fails
- permissions leak
- data handoff breaks
- analysis crashes
- linked project navigation opens wrong project

====================================================
VERSION BUMP, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump using your judgment.

Current example:
v2.7.0

Rules:
- Patch:
  third number
  v2.7.0 → v2.7.1
  for bug fixes or small improvements

- Minor:
  second number
  v2.7.0 → v2.8.0
  for meaningful features or workflow upgrades

- Major:
  first number
  v2.7.0 → v3.0.0
  for major overhaul/state-of-the-art workflow change

This prompt may become major or minor depending on what you actually implement.
Use your judgment and explain it.

2. Update version metadata.
3. Run tests.
4. Run build.
5. Commit with clear message.

Suggested commit messages depending on path:
- feat: stabilize complete review workflow
- feat: add protocol and analysis readiness workflow
- feat: add research credibility framework
- feat: add review command center and workflow diagnostics

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason push failed

Do not commit:
- secrets
- broken artifacts
- junk files
- local database files unless intentionally tracked

====================================================
FINAL REPORT
====================================================

When finished, report:

1. What you found already implemented.
2. What was partially implemented.
3. What was missing.
4. What was risky.
5. What implementation path you chose and why.
6. What you implemented.
7. What you improved.
8. What you postponed and why.
9. Database changes.
10. Backend changes.
11. Frontend changes.
12. Research-engine changes.
13. Security/permission changes.
14. Tests added.
15. Manual QA results.
16. Build/test results.
17. Version bump and new version.
18. Commit hash.
19. Push status.
20. Known limitations.
21. Recommended next implementation cycle.

Claude, I want your best judgment here.
Do not try to impress me by adding everything at once.
Impress me by building the right things safely, in the right order, without breaking the app.



CLAUDE MAX / FABLE 5.0 — ADDENDUM: LIVE APP AUDIT, PROJECT NAVIGATION, ROLE UX CLEANUP, ADMIN/MOD VISUALS, AND LAST-ACTIVE FIX

Claude, this is an addendum to the current major META·LAB / META·SIFT roadmap prompt.

Important:
Some features in the previous prompt may already be implemented in the app right now. I do NOT want you to blindly rebuild things that already exist.

Before implementing anything, check the current app state carefully.

Live app:
https://74.208.37.197.nip.io/

Use the live app for observation if possible, and also inspect the local codebase.

Your job:
1. Check what already exists.
2. Check what is partially implemented.
3. Check what is broken.
4. Check what is missing.
5. Modify your implementation plan based on reality.
6. Do not duplicate existing working features.
7. Improve or fix what exists instead of creating parallel systems.
8. Only implement what is missing, broken, confusing, or clearly weak.

If something already works well, leave it alone and document that it already exists.

If something is implemented but confusing, improve UX without breaking the underlying logic.

If something is implemented but buggy, fix it.

If something is not implemented, decide feasibility and implement safely if it fits the chosen release path.

Use the same Fable / Opus / Sonnet workflow:

Fable:
- inspect and decide the implementation path
- assign Sonnet easy execution tasks
- assign Opus reasoning and UX/permission analysis
- own final integration, version bump, commit, and push

Opus:
- reason through role hierarchy, permissions, navigation edge cases, and project lifecycle behavior

Sonnet:
- implement UI fixes, components, styling, tests, docs, and straightforward API edits

Do not ask me small questions.
Use your best judgment.
Do not break working features.
Do not wipe/reset/delete the database.
Use additive migrations only.
Test before returning.

====================================================
LIVE APP / CURRENT STATE AUDIT
====================================================

Before coding, create or update:

docs/manager/current-live-app-audit.md

Audit:
1. Public landing page.
2. Login flow if locally testable.
3. META·LAB project landing/project selector if implemented.
4. META·LAB project overview.
5. META·SIFT project overview.
6. Review Workspace linking.
7. Project navigation.
8. Ops/admin console.
9. Mod console behavior.
10. Account settings.
11. Last active display.
12. User roles and role assignment UI.
13. User name display for admins/mods.
14. Current project back-navigation.
15. Anything from the previous roadmap prompt that is already implemented.

For each item, mark:
- Working
- Implemented but buggy
- Implemented but confusing
- Missing
- Should be improved
- Should not be touched

Then update the implementation plan based on this audit.

====================================================
TASK 1 — BACK BUTTON FROM PROJECT TO MAIN META·LAB PROJECT LANDING PAGE
====================================================

I want to be able to go back from inside a project to the main landing page of the app where all my projects are.

Requirement:
When I am inside a META·LAB project, there should be a clear way to return to the main META·LAB project landing/project selector page.

This should not be confusing.

Possible UX options:
1. A breadcrumb:
   META·LAB / Projects / Project Name
2. A button:
   “Back to Projects”
3. A project switcher in the header.
4. A home/projects icon in the top navigation.

Claude, inspect the current layout and decide the best UX.

Requirements:
1. Add clear navigation back to the project landing page.
2. It should appear inside project context.
3. It should not conflict with browser back.
4. It should work from:
   - project overview
   - data extraction
   - PRISMA
   - analysis
   - methods/equations
   - project control
   - any other project subpage
5. If META·SIFT has a similar project context, consider whether it also needs a back-to-projects action.
6. Use monochrome icons consistent with the app design.
7. Do not clutter the header.

QA:
- Open META·LAB project.
- Click Back to Projects.
- Confirm it returns to the project landing page.
- Open another project.
- Confirm correct project opens.

====================================================
TASK 2 — ADMIN AND MOD USER NAME VISUAL STYLING
====================================================

Change admin and mod user names to visually reflect their role while complying with the design system.

Requirement:
Admin users’ names should appear in a subtle reddish style.
Mod users’ names should appear in a subtle greenish style.

Important:
This should not look childish or flashy.
It should match the app’s dark/night design and day mode.

Use:
- theme tokens
- subtle text/badge color
- accessible contrast
- no harsh bright red/green

Apply where role identity is shown:
1. Ops console user table.
2. User detail panel.
3. Account dropdown role badge if appropriate.
4. Project members list if global role is shown.
5. Message/support areas where staff identity is shown.
6. Any admin/mod management table.

Do NOT make normal project roles visually confusing.
Global role:
- Admin
- Mod
- User

Project role:
- Owner
- Leader
- Member
- Viewer

Keep these visually distinct.

Suggested UX:
- Name remains normal readable text.
- Add small role badge:
  - Admin: subtle red/ruby badge
  - Mod: subtle green/emerald badge
- If coloring the name itself is better, keep it subtle.

QA:
- Admin name appears with admin styling.
- Mod name appears with mod styling.
- Normal users remain neutral.
- Works in night and day mode.

====================================================
TASK 3 — FIX LAST ACTIVE IN ACCOUNT SETTINGS
====================================================

Problem:
Last active in account settings does not work.

Need to investigate:
1. Is lastActiveAt being updated on login?
2. Is lastActiveAt being updated on authenticated activity?
3. Is account settings reading the wrong field?
4. Is ops console using a different field?
5. Is timezone/formatting broken?
6. Is frontend caching stale account data?

Expected:
In Account Settings, Last Active should show the correct recent activity time.

Backend:
1. Ensure user.lastActiveAt exists.
2. Update lastActiveAt on:
   - login
   - authenticated app load/session check
   - meaningful app activity, throttled to avoid DB spam
3. Return lastActiveAt from:
   - /api/auth/me
   - account settings endpoint
   - ops users endpoint if relevant

Frontend:
1. Account settings should display lastActiveAt.
2. If missing, show “Not available” instead of wrong value.
3. Format clearly:
   - Today, 3:42 PM
   - Jun 13, 2026
   - or similar
4. Refresh after login/session fetch.

QA:
- Login as user.
- Open Account Settings.
- Confirm Last Active updates.
- Perform activity.
- Confirm last active updates after reasonable refresh/reload.
- Confirm ops console and account settings are consistent.

====================================================
TASK 4 — ROLE SYSTEM REVIEW AND UX OPTIMIZATION
====================================================

I think the roles are confusing now.

I want you to understand the current role system, then decide which roles should stay and how they should be assigned.

There should not be confusion or misunderstanding.

Optimize the role system for the best UX possible.

Do not just add more roles.
Simplify if needed.
Clarify if needed.
Separate global app roles from project roles.

You must inspect the current implementation first.

Create:

docs/manager/role-system-review-and-recommendation.md

Include:
1. Current roles found in the code/database.
2. Current permission flags found.
3. Where roles are assigned.
4. Where roles are displayed.
5. What is confusing.
6. What is redundant.
7. What is unsafe.
8. What should stay.
9. What should be renamed.
10. What should be hidden from users.
11. What should be internal only.
12. Final recommended role model.

Important distinction:

A. Global app roles:
- Admin
- Mod
- User

These control access to:
- ops/admin console
- mod console
- user management
- support messages
- global settings

B. Project/workspace roles:
- Owner
- Leader
- Member/Reviewer/Data Extractor if needed
- Viewer/Read-only

These control access inside projects.

Do not mix global roles with project roles.

Recommended model:
Global roles:
1. Admin
   - full ops access
   - can manage mods/users/settings
2. Mod
   - limited support console
   - cannot edit admins
   - cannot edit other mods
   - cannot see dangerous metrics/settings
3. User
   - normal app user

Project roles:
1. Owner
   - ultimate project authority
   - cannot be edited by leaders/members
   - can delete/archive
   - can assign leaders
2. Leader
   - project manager
   - can manage members depending on permissions
   - cannot change owner
   - cannot demote/remove owner
3. Contributor
   - can work in allowed modules
   - may screen/extract/analyze depending on permissions
4. Viewer
   - read-only

Optional functional labels/permissions:
Instead of making too many roles, use permission toggles:
- canViewMetaLab
- canEditMetaLab
- canManageExtraction
- canRunAnalysis
- canViewMetaSift
- canScreen
- canSecondReview
- canResolveConflicts
- canImportRecords
- canExport
- canChat
- canManageMembers

Claude, decide if “Reviewer” and “Data Extractor” should be:
A. actual roles
or
B. presets built on top of Contributor permissions.

My suggestion:
Use fewer roles:
- Owner
- Leader
- Contributor
- Viewer

Then use permission presets:
- Reviewer
- Data Extractor
- Analyst
- Read-only META·LAB
- Read-only META·SIFT
- Full Contributor

This may reduce confusion.

But I want your opinion. Inspect the app and decide.

Implementation requirements:
1. Do not break existing users/projects.
2. If you rename roles, migrate safely.
3. Do not remove permissions silently.
4. Add mapping from old roles to new roles if needed.
5. Update UI labels.
6. Update add-member form.
7. Update project control in META·LAB and META·SIFT.
8. Update ops console user/project displays.
9. Update tests.
10. Update docs.

UX requirements:
When adding a member, the user should understand:
- What role means.
- What permissions are granted.
- Whether the member can access META·LAB.
- Whether the member can access META·SIFT.
- Whether the member is read-only.
- Whether the member can screen/extract/analyze/manage.

Use a clean UI:
- Role dropdown
- Permission preset dropdown
- Advanced permissions expandable section
- Plain-English explanation:
  “This user can screen studies in META·SIFT but cannot edit META·LAB extraction.”

QA:
Test:
- Admin global role does not automatically make project owner.
- Mod global role does not automatically make project leader.
- Owner protected.
- Leader cannot edit owner.
- Viewer cannot edit.
- Contributor permissions work.
- Add-member UI is understandable.
- Existing projects still work.

====================================================
TASK 5 — REMODIFY CURRENT PROMPT BASED ON IMPLEMENTED FEATURES
====================================================

The current large roadmap prompt contains features that may already exist.

Do not implement duplicates.

After auditing the app, update your internal plan:

For each item in the current prompt:
1. Already implemented and working → leave alone.
2. Implemented but buggy → fix.
3. Implemented but ugly/confusing → improve UX.
4. Missing and feasible → implement if it fits current release path.
5. Missing but risky → document and postpone.
6. Not needed anymore → document and skip.

Update:

docs/manager/current-prompt-deduped-implementation-plan.md

This must include:
- what you removed from implementation because it already exists
- what you kept because it needs improvement
- what you added from this addendum
- what you postponed

====================================================
TASK 6 — SAFETY AND REGRESSION RULES
====================================================

Because roles and navigation are sensitive, do not break anything.

Rules:
1. Do not break login.
2. Do not break project access.
3. Do not break Review Workspace linking.
4. Do not break META·SIFT access.
5. Do not break owner/leader/member permissions.
6. Do not allow viewers to edit.
7. Do not allow mods to edit admins or mods.
8. Do not expose admin/mod controls to normal users.
9. Do not make project navigation open wrong project.
10. Do not remove working project controls without replacement.
11. Do not wipe database.
12. Use additive migrations only.
13. Test existing flows before and after.

====================================================
QA REQUIREMENTS
====================================================

Manual QA:
1. Login.
2. Confirm project landing page exists or current project selector works.
3. Open a project.
4. Confirm there is a clear Back to Projects action.
5. Return to project landing page.
6. Open correct project again.
7. Confirm admin names appear reddish/subtle admin styling.
8. Confirm mod names appear greenish/subtle mod styling.
9. Confirm normal users are neutral.
10. Open account settings.
11. Confirm Last Active works.
12. Inspect role assignment UI.
13. Confirm role labels are clear.
14. Add member with chosen role/preset.
15. Confirm permissions match explanation.
16. Confirm viewer/read-only cannot edit.
17. Confirm leader cannot edit owner.
18. Confirm owner can manage leaders/members.
19. Confirm mod cannot edit admin.
20. Confirm mod cannot edit other mod.
21. Confirm global roles and project roles are visually/logically separate.
22. Confirm no duplicate feature was added where one already existed.

Automated tests:
- project back navigation route
- correct project open by ID
- lastActiveAt update/return
- account settings renders last active
- admin/mod visual role badges if frontend tests exist
- mod cannot edit admin
- mod cannot edit mod
- owner protected
- leader cannot edit owner
- viewer read-only enforced
- role mapping/migration if implemented
- add-member permission preset behavior
- accessible project list still works

Update:
- /tests/report.md
- /tests/screening/report.md if relevant

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:
1. Decide version bump using judgment.
2. Update version metadata.
3. Run tests.
4. Run build.
5. Commit.
6. Push if safe.

Suggested commit message:
fix: clarify roles and improve project navigation

If this becomes a broader role-system refactor, use:
feat: streamline project roles and navigation

Explain your version bump reasoning.

====================================================
FINAL REPORT
====================================================

Final report must include:
1. What you found already implemented in the live/local app.
2. What you skipped because it already works.
3. What you fixed.
4. What you improved.
5. Role-system recommendation.
6. Final role model.
7. Navigation changes.
8. Last-active fix.
9. Admin/mod visual styling.
10. Database changes.
11. Backend changes.
12. Frontend changes.
13. Manual QA results.
14. Automated test results.
15. Version bump.
16. Commit hash.
17. Push status.
18. Known limitations.
19. Recommended next steps.

Claude, do not just execute blindly.
Inspect the app, understand the current state, remove duplication from the plan, and implement only what actually improves the product.