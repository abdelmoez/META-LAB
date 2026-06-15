CLAUDE OPUS — UNIFIED META·LAB / META·SIFT WORKFLOW OVERHAUL, UX SIMPLIFICATION, AND BACKEND-SEPARATED SCREENING ENGINE

Claude, I want to talk to you directly here.

I think the current META·LAB and META·SIFT workflow is becoming too complicated for the user.

The functionality is powerful, but the experience now feels like two separate apps that the user has to manually understand, manually link, and manually navigate between. I do not want that anymore.

I still want META·SIFT to remain a completely separate engine/module in the backend because that is cleaner architecturally. But I do NOT want the user to feel that separation.

From the user’s perspective, META·SIFT should feel like a natural part of the same project workflow.

I do not want the user to think:

“Now I need to link this META·LAB project to a META·SIFT project.”

Instead, I want the user to feel:

“I created one review project, and the screening stage is just one step inside it.”

So the backend can remain separated, but the frontend workflow should feel unified.

Do not attach yourself too much to the current UI/UX. I know we have built many features, but I am open to a serious workflow overhaul if that makes the app easier and more intuitive. Right now, I think the app is too cluttered, too complicated, and not straightforward enough. That will hurt adoption.

I want you to inspect everything first, understand the current workflow deeply, map all relationships, then propose the best possible simplified workflow.

Do not jump into coding immediately.

I want you to think, plan, debate internally with the team, then implement carefully.

====================================================
HIGH-LEVEL GOAL
====================================================

Goal:
Create a unified research workflow where META·LAB and META·SIFT feel like one app to the user.

Backend:
- META·SIFT remains a separate backend engine/module.
- META·LAB remains the main analysis/review engine.
- The shared Review Workspace remains the organizing layer.
- Internal linking can still exist in the database.

Frontend/user experience:
- Remove the feeling of “linking projects.”
- Remove visible/manual “link META·SIFT” confusion.
- A user creates one project.
- That one project automatically includes screening, extraction, analysis, PRISMA, reports, project control, and collaboration.
- Screening should appear as a stage/step in the same project workflow.
- The user should not need to know that screening is powered by a different backend module.
- If a screening project/entity must exist internally, create it automatically and silently.
- If it is missing, repair/create it automatically when safe.
- Do not show “linked” unless in developer/admin/debug context.

Think of it like this:

Current bad feeling:
META·LAB project + linked META·SIFT project

Desired feeling:
One Review Project with stages:
1. Overview
2. Protocol
3. Search & Import
4. Duplicates
5. Screening
6. Full Text / Second Review
7. Data Extraction
8. Risk of Bias
9. Analysis
10. PRISMA
11. GRADE
12. Report & Export
13. Project Control

Internally:
- Search/Import/Duplicates/Screening/Full Text may be powered by META·SIFT.
- Extraction/Analysis/PRISMA/Report may be powered by META·LAB.
- But the user should experience it as one project.

====================================================
TEAM OF 5
====================================================

I want a team of 5 working simultaneously.

You choose the team structure, but it must include one leader.

Recommended team:

1. Opus Lead Architect / Product Owner
   - Owns final decisions.
   - Maps the current system.
   - Decides the new unified workflow.
   - Coordinates all agents.
   - Resolves conflicts.
   - Owns final integration, QA acceptance, version bump, commit, and push.

2. Backend & Data Model Engineer
   - Owns Review Workspace, project lifecycle, internal META·SIFT engine creation, migration/repair logic, permissions, APIs, and backend separation.
   - Ensures META·SIFT remains separate internally while invisible to the user.
   - Ensures no data loss.

3. Frontend UX & Workflow Designer
   - Owns the new simplified project workflow.
   - Redesigns navigation/stages.
   - Removes user-facing linking confusion.
   - Simplifies UI and reduces clutter.
   - Keeps workflow intuitive.

4. Research Workflow & Methods Engineer
   - Owns the evidence synthesis workflow logic.
   - Ensures screening → full text → extraction → analysis → PRISMA makes methodological sense.
   - Ensures stage progression and data handoff are correct.

5. QA, Security & Regression Engineer
   - Owns tests, access control, permission regression, migration safety, and full manual QA.
   - Verifies no existing features break.
   - Verifies backend separation does not leak into UX.
   - Verifies user roles and data access remain correct.

Team communication format:
Every agent must communicate with the team using:

[FROM: Agent Name]
[TO: Agent Name]
[TOPIC: Short topic]
[MESSAGE]
[FILES I OWN THAT ARE AFFECTED]
[WHAT I NEED FROM YOU]

Rules:
- Agents must not overwrite each other’s work without coordination.
- Each agent owns its domain.
- The Lead Architect resolves conflicts.
- Everyone must document decisions.
- Do not implement until the initial mapping and plan are complete.

====================================================
PHASE 1 — CURRENT SYSTEM MAP
====================================================

Before changing anything, inspect the current app and create:

docs/manager/unified-workflow-current-system-map.md

Map:

1. Current project creation flow.
2. Current META·LAB project model.
3. Current META·SIFT project model.
4. Current Review Workspace model.
5. Current linking behavior.
6. Current routes.
7. Current project landing page.
8. Current META·LAB project overview.
9. Current META·SIFT project overview.
10. Current project control tabs.
11. Current member/permission model.
12. Current screening flow.
13. Current second review flow.
14. Current Data Extraction handoff.
15. Current PRISMA auto-fill.
16. Current chat/notifications.
17. Current ops/admin view.
18. Current places where the UI says:
    - link
    - linked
    - META·SIFT project
    - create/link META·SIFT
    - open linked META·SIFT
19. Current API endpoints for linking/opening projects.
20. Current failure points.

For each area, mark:
- works well
- works but confusing
- broken
- redundant
- should be hidden from user
- should remain admin/internal only
- should be redesigned

Do not guess. Inspect the code.

====================================================
PHASE 2 — USER EXPERIENCE DIAGNOSIS
====================================================

Create:

docs/manager/unified-workflow-ux-diagnosis.md

I want your honest opinion.

Answer:
1. Why does the current workflow feel cluttered?
2. Where does the user get confused?
3. Which screens have too many concepts?
4. Which labels should disappear?
5. Which steps should be merged?
6. Which technical concepts should be hidden?
7. Which actions are redundant?
8. Which navigation items should be replaced by stages?
9. What should a new user see first?
10. What should an experienced user see?
11. How can we make the app feel like one coherent workflow?

Be critical. Do not defend the current UI if it is bad.

====================================================
PHASE 3 — NEW UNIFIED WORKFLOW PLAN
====================================================

Create:

docs/manager/unified-review-workflow-plan.md

Design the new workflow.

I want you to propose the best possible structure.

My preferred direction:
One Review Project with stage-based navigation.

Possible project stages:
1. Overview
2. Protocol
3. Search & Import
4. Duplicates
5. Screening
6. Full Text Review
7. Data Extraction
8. Risk of Bias
9. Analysis
10. PRISMA
11. GRADE
12. Report & Export
13. Project Control

But you do not have to follow this exactly. If you think a better stage structure exists, propose it and implement it.

Requirements:
1. Project creation creates the full internal structure automatically.
2. The user never manually links META·SIFT.
3. The user never sees “linked META·SIFT project” as a required action.
4. Screening is just a stage in the project.
5. Full-text/second review is just a stage in the project.
6. Data Extraction receives accepted studies naturally.
7. PRISMA updates naturally.
8. Project Control manages members/permissions once.
9. Chat is shared across the project.
10. Notifications refer to the Review Project, not separate modules.
11. Ops/Admin can still see internal module health if needed.
12. Advanced/internal linking details can exist in admin/debug docs, not normal UI.

====================================================
PHASE 4 — BACKEND ARCHITECTURE PLAN
====================================================

Create:

docs/manager/unified-workflow-backend-plan.md

Backend requirements:
1. Keep META·SIFT as separate backend engine/module.
2. Keep META·LAB as separate analysis/review engine.
3. Use Review Workspace as the public project identity.
4. A user-facing project should map to one ReviewWorkspace.
5. ReviewWorkspace should own:
   - title
   - owner
   - leaders
   - members
   - status
   - permissions
   - chat
   - notifications
   - audit logs
6. META·LAB project should be internal module data under the workspace.
7. META·SIFT project should be internal module data under the workspace.
8. If internal META·SIFT project does not exist for a workspace, create it automatically when needed.
9. If internal META·LAB project does not exist, create/repair if safe.
10. Add repair logic:
    - ensureWorkspaceHasMetaLabModule()
    - ensureWorkspaceHasMetaSiftModule()
    - ensureWorkspaceModules()
11. Project APIs should prefer workspace/project identity, not separate linking identity.
12. Existing old linked projects must migrate/normalize safely.
13. No data loss.
14. No destructive migrations.
15. Old routes should redirect or adapt where possible.
16. Backend should still allow module-level separation internally.

Public/user-facing API direction:
- GET /api/workspaces
- POST /api/workspaces
- GET /api/workspaces/:id
- PATCH /api/workspaces/:id
- GET /api/workspaces/:id/stages
- GET /api/workspaces/:id/screening
- GET /api/workspaces/:id/extraction
- GET /api/workspaces/:id/analysis
- GET /api/workspaces/:id/prisma

Internal service direction:
- metaLabService
- metaSiftService
- workspaceOrchestratorService

Do not blindly rename every endpoint if risky.
Create a safe compatibility layer if needed.

====================================================
PHASE 5 — FRONTEND UX PLAN
====================================================

Create:

docs/manager/unified-workflow-frontend-plan.md

Frontend requirements:
1. New project landing shows Review Projects, not separate META·LAB/META·SIFT projects.
2. Inside a project, navigation is stage-based.
3. Remove or hide user-facing:
   - link META·SIFT
   - linked META·SIFT
   - create linked META·SIFT
   - open linked META·SIFT
   - separate META·SIFT project language
4. Replace with simple stage names:
   - Screening
   - Full Text Review
   - Data Extraction
   - Analysis
   - PRISMA
5. Keep META·SIFT branding only where useful, maybe in small technical footer/admin/debug, not as a burden.
6. Project overview should show workflow progress.
7. Each stage should show:
   - status
   - next step
   - warnings
   - completion progress
8. Project Control should manage all members and permissions once.
9. Chat should be project-wide.
10. Notifications should point to Review Project/stage.
11. Project back navigation should return to project landing.
12. UI should be less cluttered and more intuitive.

Design principle:
Do not show the user implementation details.

Bad labels:
- linked META·SIFT project
- create/link screening project
- separate module project

Better labels:
- Screening
- Full Text Review
- Review workflow
- Evidence workflow
- Project stages
- Continue screening
- Continue extraction
- Run analysis

====================================================
PHASE 6 — MIGRATION / COMPATIBILITY PLAN
====================================================

Create:

docs/manager/unified-workflow-migration-plan.md

Need to handle existing data.

Existing users may already have:
- META·LAB projects
- META·SIFT projects
- linked projects
- unlinked projects
- Review Workspace records
- members/permissions
- screening decisions
- extracted studies
- chat/messages
- notifications
- audit logs

Requirements:
1. Do not delete anything.
2. Do not reset the database.
3. Add migration/repair scripts only.
4. For each existing META·LAB project:
   - ensure it belongs to a ReviewWorkspace
   - ensure it has internal META·LAB module data
   - ensure it has internal META·SIFT module data if user-facing workflow requires screening stage
5. For each existing META·SIFT project:
   - ensure it belongs to a ReviewWorkspace
   - if no META·LAB project exists, decide whether to create one automatically or show it as a review project with screening stage only
   - document decision
6. Preserve owners/leaders/members.
7. Preserve permissions.
8. Preserve linked handoff state.
9. Preserve all screening records.
10. Preserve all extracted data.
11. Preserve chat/audit logs.
12. Add idempotent repair command if feasible.
13. Add tests for migration/repair.

====================================================
PHASE 7 — IMPLEMENTATION
====================================================

After mapping and planning, implement the chosen design.

Implementation priorities:
1. User-facing project identity becomes Review Project / Review Workspace.
2. Project creation automatically creates internal META·LAB and META·SIFT module records as needed.
3. Remove manual linking UX.
4. Replace linking labels with workflow-stage labels.
5. Screening appears as part of project workflow.
6. Full Text Review appears as part of project workflow.
7. Data Extraction handoff continues working.
8. PRISMA auto-fill continues working.
9. Project Control remains unified.
10. Chat remains shared.
11. Notifications point to project/stage.
12. Old routes remain compatible or redirect safely.
13. Ops console can still see internal META·LAB/META·SIFT module status if needed.

Important:
Do not attempt a reckless full rewrite.
If a safer staged implementation is better, do it that way.

Acceptable staged approach:
Stage 1:
- Hide linking UX.
- Auto-create/repair modules.
- Add unified stage navigation.
- Keep internal APIs mostly intact.

Stage 2 later:
- Refactor APIs to workspace-first.

Use your judgment.

====================================================
PHASE 8 — OPS/ADMIN VIEW
====================================================

Ops/Admin can still understand internals.

Normal users should see:
- Review Project
- Screening stage
- Extraction stage
- Analysis stage

Admins may see:
- workspace ID
- internal META·LAB module health
- internal META·SIFT engine health
- repair status
- missing module warnings
- data handoff logs

Ops should not expose confusing linking to ordinary users.

Add admin/debug wording:
- “Internal screening engine”
- “Internal analysis engine”
instead of making users manually link projects.

====================================================
PHASE 9 — QA AND REGRESSION TESTING
====================================================

QA must test deeply.

Manual QA:
1. Login.
2. See project landing.
3. Create new review project.
4. Confirm no manual link step appears.
5. Open project.
6. See stage-based navigation.
7. Open Screening stage.
8. Confirm internal META·SIFT module works.
9. Import records.
10. Screen records.
11. Move records to Full Text Review.
12. Accept final included study.
13. Confirm it appears in Data Extraction.
14. Run analysis.
15. Confirm PRISMA updates.
16. Confirm project control manages members once.
17. Add member.
18. Member sees same project, not a separate linked project.
19. Member opens Screening directly as a stage.
20. Back to Projects works.
21. Chat works across stages.
22. Notifications open correct project/stage.
23. Existing old project still works.
24. Existing old linked project still works.
25. Existing old unlinked project is repaired/handled safely.
26. Viewer cannot edit.
27. Leader cannot edit owner.
28. Owner can manage project.
29. Ops shows internal engine status.
30. Build passes.

Automated tests:
- create workspace creates internal modules
- ensureWorkspaceModules idempotent
- old linked project still resolves
- old unlinked META·LAB project gets screening engine when needed
- project list shows unified projects only
- no duplicate project cards for same workspace
- screening stage uses correct internal module
- data extraction handoff works
- PRISMA sync works
- permissions enforced
- route redirects do not open wrong project
- manual linking UI no longer appears for normal users

Do not mark complete if:
- user still has to manually link META·SIFT
- project appears twice
- screening stage is inaccessible
- accepted studies do not reach Data Extraction
- PRISMA breaks
- permissions leak
- old projects disappear
- build fails

====================================================
PHASE 10 — DOCUMENTATION
====================================================

Create/update:
1. docs/manager/unified-workflow-current-system-map.md
2. docs/manager/unified-workflow-ux-diagnosis.md
3. docs/manager/unified-review-workflow-plan.md
4. docs/manager/unified-workflow-backend-plan.md
5. docs/manager/unified-workflow-frontend-plan.md
6. docs/manager/unified-workflow-migration-plan.md
7. docs/manager/unified-workflow-final-report.md
8. /tests/report.md
9. /tests/screening/report.md if relevant

Documentation should clearly explain:
- META·SIFT is still a backend screening engine.
- Users experience one Review Project.
- Review Workspace is public/project identity.
- Internal modules are auto-created and repaired.
- Manual linking is removed from normal UX.
- Ops/Admin can still inspect module health.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.

Rules:
- Patch:
  small bug fixes
- Minor:
  meaningful workflow/product upgrade
- Major:
  major overhaul or state-of-the-art workflow change

This is likely a major product workflow overhaul if fully implemented.
Use your judgment.

2. Update version metadata.
3. Run tests.
4. Run build.
5. Commit.

Suggested commit message:
feat: unify review workflow and hide manual screening project linking

or, if larger:
feat: overhaul project workflow around unified review workspace

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- local database files
- junk files
- broken artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Your honest diagnosis of the old workflow.
2. What was confusing.
3. New workflow design.
4. Backend separation strategy.
5. How META·SIFT remains separate internally.
6. How users now experience one project.
7. What linking UX was removed.
8. How internal module creation/repair works.
9. How old projects were handled.
10. Frontend changes.
11. Backend changes.
12. Database/migration changes.
13. Route compatibility changes.
14. Permission/security changes.
15. Manual QA results.
16. Automated test results.
17. Version bump and new version.
18. Commit hash.
19. Push status.
20. Known limitations.
21. Recommended next iteration.

IMPORTANT MODIFICATION — META·SIFT SHOULD BECOME ONE “SCREENING” BUTTON/STAGE

Claude, I want to clarify the intended workflow.

I do NOT want all META·SIFT functions to be spread directly across the META·LAB workflow as separate top-level tabs.

Instead, I want everything that currently belongs to META·SIFT to live inside one user-facing button/stage called:

Screening

So the main project workflow should feel simple.

Main project navigation should be something like:
1. Overview
2. Protocol
3. Screening
4. Data Extraction
5. Analysis
6. PRISMA
7. Report & Export
8. Project Control

The user should not see separate main buttons for:
- Search & Import
- Duplicates
- Title/Abstract Screening
- Full Text Review
- Conflicts
- META·SIFT Project
- Linked META·SIFT

All of those should be inside the single Screening stage.

====================================================
WHAT “SCREENING” SHOULD CONTAIN
====================================================

When the user clicks Screening, they enter the full screening workspace.

Inside Screening, it can have its own internal sub-navigation, because this is where the META·SIFT engine lives.

The Screening workspace should include everything META·SIFT currently does:

1. Import References
2. Import History
3. Duplicate Management
4. Search/Filter Records
5. Title & Abstract Screening
6. Inclusion/Exclusion Keyword Highlighting
7. Reviewer Decisions
8. Blind Mode
9. Conflict Detection
10. Conflict Resolution
11. Full Text / Second Review
12. PDF Attachments
13. Final Included Studies
14. Exclusion Reasons
15. Reviewer Progress
16. Screening Exports
17. Screening Settings
18. Screening Member Activity
19. Handoff of accepted studies to Data Extraction

But all of this should be visually nested under:

Screening

The user should feel:
“I am inside the Screening part of my review project.”

Not:
“I opened a separate META·SIFT project.”

====================================================
BACKEND CLARIFICATION
====================================================

Keep META·SIFT as a separate backend engine/module.

That is still good architecture.

But do not expose that architecture to normal users.

Internally:
- META·SIFT can still have its own tables, services, routes, records, decisions, duplicates, full-text review, and settings.
- META·SIFT can still be separately maintained as the screening engine.
- ReviewWorkspace can still auto-create and own the internal META·SIFT module.

Externally:
- the user sees only one Review Project.
- the user sees one Screening button.
- everything META·SIFT-related appears inside Screening.
- no manual linking.
- no separate META·SIFT project identity in normal UX.
- no “Open linked META·SIFT.”
- no “Create/link META·SIFT.”
- no “META·SIFT project missing.”
- no duplicate project cards.

Admin/Ops can still see technical internal status if needed:
- Internal Screening Engine: healthy/missing/repaired
- Internal META·SIFT module ID
- Screening records count
- Duplicate engine status
- Handoff status

But ordinary users should not see this.

====================================================
REVISED UX GOAL
====================================================

Main app should be simple:

Review Project
├── Overview
├── Protocol
├── Screening
│   ├── Import
│   ├── Duplicates
│   ├── Title/Abstract
│   ├── Conflicts
│   ├── Full Text
│   ├── Included Studies
│   └── Screening Settings
├── Data Extraction
├── Analysis
├── PRISMA
├── Report & Export
└── Project Control

So META·SIFT is not removed.
META·SIFT is not merged randomly into every META·LAB tab.
META·SIFT becomes the internal engine powering the Screening stage.

====================================================
IMPLEMENTATION CHANGE
====================================================

Modify the previous plan accordingly:

Do NOT make Search/Import, Duplicates, Screening, and Full Text all separate top-level project stages unless you strongly believe there is a UX reason and explain it.

Preferred implementation:
- One top-level Screening button/stage.
- Inside Screening, use internal tabs or a stepper:
  1. Import
  2. Duplicates
  3. Screen
  4. Conflicts
  5. Full Text
  6. Included
  7. Settings

This keeps the main app clean while preserving META·SIFT’s full power.

====================================================
WHAT TO CHANGE IN THE DOCUMENTS
====================================================

When you create the planning docs, make sure they reflect this:

1. docs/manager/unified-review-workflow-plan.md
   - Main workflow should include one Screening stage.
   - All META·SIFT features should be nested inside Screening.

2. docs/manager/unified-workflow-frontend-plan.md
   - Remove separate top-level stages for Import, Duplicates, Full Text, and Conflicts.
   - Put them inside Screening.

3. docs/manager/unified-workflow-backend-plan.md
   - Keep META·SIFT as internal screening engine.
   - ReviewWorkspace auto-creates/repairs internal screening module.

4. docs/manager/unified-workflow-final-report.md
   - Explain that META·SIFT is preserved internally but exposed as Screening.

====================================================
FINAL CLARIFICATION
====================================================

Claude, do not misunderstand me.

I am not asking you to delete META·SIFT.
I am not asking you to merge all META·SIFT functions directly into META·LAB tabs.
I am not asking you to scatter screening features everywhere.

I want the opposite:

Keep META·SIFT powerful and separate internally.
But make the user-facing app simple.

One project.
One Screening button.
Everything META·SIFT does lives inside Screening.
No manual linking.
No separate META·SIFT UX burden.


Claude, I want you to make magic here.

Do not just patch the current clutter.
Think deeply.
Map the system.
Let the team debate.
Choose the simplest, most elegant workflow.
Keep the backend clean.
Make the frontend feel like one unified research app.
Do not break the existing powerful features.
Do not return until this is planned, implemented safely, tested, documented, versioned, committed, and pushed if possible.

META·SIFT should remain the backend screening engine, but the user-facing product should expose it only as one clean “Screening” stage inside the Review Project.