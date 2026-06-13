CLAUDE MAX / FABLE 5.0 — META·LAB PROJECT LANDING PAGE, PROJECT SELECTOR, PROJECT CONTROLS, VERSIONING, COMMIT, AND PUSH

Claude, I want you to treat this as a serious product and UX upgrade for META·LAB.

Right now, when I log into META·LAB, I want the first experience to be better. I do not want the user to feel lost inside the app. I want the user to first see a beautiful, useful, highly organized project landing page where they can choose the project they want to work on, understand their role, see project status, filter/search/sort projects, and manage project-level actions safely.

I want you to think deeply about this. Do not just create a simple list of projects. I want this to feel like a real professional research command center for the user’s projects.

I want your opinion and your design judgment. If you think there is a better workflow than what I wrote, explain it in your plan and implement the better version. Do not come back to me for small confirmations.

Use this workflow:

Fable:
- You are the architect and advanced reasoning lead.
- You make the workflow.
- You decide the best UX and architecture.
- You assign easy execution tasks to Sonnet agents.
- You assign reasoning, edge cases, and product decision tasks to Opus agents.
- You keep advanced reasoning, final integration, version bump judgment, commit, and push.

Sonnet:
- Handle straightforward UI implementation, component creation, styling, tests, and documentation edits.

Opus:
- Handle UX reasoning, permission edge cases, project lifecycle rules, archive/delete/leave logic, and regression risks.

Fable:
- Own final product judgment, final QA acceptance, version bump decision, commit, and push.

Do not ask me small questions.
Think, decide, implement, test, commit, push, and report.

====================================================
HIGH-LEVEL GOAL
====================================================

Create a new META·LAB app landing page after login.

This page should be the first thing the user sees after logging into META·LAB.

Purpose:
The user should select a project first.

After the user opens a project:
- launch the existing project overview page that we already have in the app
- then allow navigation to the rest of the project sections:
  - data extraction
  - PRISMA
  - analysis
  - methods/equations
  - project control
  - linked META·SIFT
  - chat
  - exports
  - settings
  - anything else already implemented

Do not remove the existing project overview.
The new page is before the project overview.
Think of it as:

Login → META·LAB Project Landing / Project Selector → Open Project → Existing Project Overview → Project Workflow

====================================================
TASK 1 — INSPECT FIRST, THEN MAKE A PLAN
====================================================

Before coding, inspect:

1. Current META·LAB app entry flow after login.
2. Current project list/dashboard if one exists.
3. Existing project overview.
4. Existing project control system.
5. Current owner/leader/member/viewer permissions.
6. Current linked META·SIFT workspace system.
7. Current project deletion/archive/leave endpoints if any.
8. Current UI theme/design system.
9. Current account dropdown, notification bell, chat placement.
10. Current routing.

Then create:

docs/manager/meta-lab-project-landing-opinion-and-plan.md

This document must include:
1. What is weak about the current post-login flow.
2. What the new landing page should accomplish.
3. Your recommended UX structure.
4. Your recommended project card/table design.
5. Your recommended filters and sorting.
6. Your recommendation for archive vs delete.
7. How owner/leader/member/viewer actions should differ.
8. How linked META·SIFT status should appear.
9. How to avoid clutter while still giving the user control.
10. Risks to existing workflow.
11. Final implementation plan.

I want your opinion. Do not be passive.

====================================================
TASK 2 — NEW META·LAB PROJECT LANDING PAGE
====================================================

Create a new landing page after login.

Suggested route:
- /app
or whichever route is currently the authenticated META·LAB home

This page should show all projects the user can access:
- projects they own
- projects where they are leader
- projects where they are member
- projects where they are viewer/read-only
- projects linked through Review Workspace permissions

It should not show projects the user has no access to.

The page should feel premium, clean, and very navigable.

It should include:

A. Header / Welcome Area
- Welcome back message
- user name if available
- short phrase like:
  “Choose a review workspace to continue your evidence synthesis.”
- quick create project button
- optional import/start from template button only if still supported
- account dropdown
- notification bell
- chat icon only if global chat is appropriate; otherwise project chat should appear only after project context exists

B. Project Summary Cards
Show useful high-level metrics:
- total accessible projects
- owned projects
- projects where I am leader
- active projects
- archived projects
- linked META·SIFT projects
- projects marked done
- recently updated projects

Do not fake metrics.
If data is unavailable, use real empty states.

C. Main Project Browser
This is the core of the page.

Show projects as either:
- beautiful project cards
or:
- card/table hybrid

You decide which is better.
You can provide a toggle between card view and compact table view if useful.

Each project should show:
- project title
- owner
- current user role:
  - Owner
  - Leader
  - Member
  - Viewer
  - Read-only
- project status:
  - active
  - in progress
  - done
  - archived
- created date
- last modified date
- linked META·SIFT status:
  - linked
  - not linked
  - linked project title
- number of studies in Data Extraction if available
- number of screening records if linked META·SIFT exists
- number of included/final studies if available
- progress indicator if available
- member count
- recent activity if available
- quick action button:
  - Open Project

D. Project Actions
Actions should depend on role.

Owner can:
- open project
- rename project if already supported
- archive project
- unarchive project
- delete project
- manage members
- open project control
- open linked META·SIFT project
- create/link META·SIFT project if missing

Leader can:
- open project
- manage project workflow
- manage members if permission allows
- archive project only if permission allows; default should probably be no unless already allowed
- leave project if not owner
- open linked META·SIFT project
- open project control

Member can:
- open project
- leave project
- open linked META·SIFT if permission allows

Viewer/read-only can:
- open project in read-only mode
- leave project
- no editing actions

Important:
The owner cannot leave the project unless ownership transfer exists.
If ownership transfer does not exist, show:
“Owners must transfer ownership or delete/archive the project.”

E. Empty States
If no projects:
- show a polished empty state
- create first project CTA
- explain META·LAB + META·SIFT linked workflow briefly

If no active projects but archived exist:
- show option to view archived

F. Recently Opened / Recent Activity
If feasible:
- show recently opened projects
- show recent project activity
- show last edited project

If not feasible:
- do not fake it
- create backend support if simple and useful
- otherwise document as future enhancement

====================================================
TASK 3 — FILTERS, SEARCH, SORTING, AND VIEW OPTIONS
====================================================

Add useful project navigation controls.

Search:
- search by project title
- owner
- linked META·SIFT title
- status
- member if available

Filters:
- All projects
- Owned by me
- I am leader
- Shared with me
- Read-only
- Active
- In progress
- Done
- Archived
- Linked to META·SIFT
- Not linked to META·SIFT
- Recently updated

Sorting:
- Last modified
- Created date
- Project title A–Z
- Project status
- My role
- Progress if available

View options:
- card view
- compact table view if you think useful
- show/hide archived
- show only active by default

Make the default view smart:
- active/recent projects first
- archived hidden unless selected
- owned/leader projects easy to identify

====================================================
TASK 4 — PROJECT OPENING FLOW
====================================================

When the user clicks Open Project:

1. Navigate to the correct project by project ID.
2. Do not open the first project by mistake.
3. Do not rely on stale selected project state.
4. Open the existing project overview page.
5. Preserve permissions.
6. If viewer/read-only, overview should show read-only state.
7. If project is archived, show archived banner and disable editing unless owner unarchives.
8. If user lost access, show proper access-denied message.

This is important:
The new landing page should not break existing project overview or workflow.

====================================================
TASK 5 — LEAVE PROJECT FLOW
====================================================

Members and leaders who are not the owner should be able to leave a project.

Requirements:
1. Show Leave Project action only for non-owner users.
2. Show warning before leaving.
3. Warning should explain:
   - you will lose access
   - your previous contributions remain in the project history
   - you may need to be re-invited to return
4. Confirm action.
5. After leaving:
   - remove user from project/workspace membership or mark inactive depending on current model
   - project disappears from their active project list
   - audit log is created
   - notifications/activity if supported
6. If user is the only leader but owner exists, allow leave unless policy says otherwise.
7. If user is owner, do not show Leave Project; show delete/archive/transfer guidance.

Backend:
- enforce permission server-side
- do not allow owner leave unless ownership transfer exists
- create audit log

Frontend:
- confirmation modal
- update list immediately after success
- show toast/notification

====================================================
TASK 6 — ARCHIVE PROJECT FLOW
====================================================

Add archive/unarchive project behavior if not already working.

Recommended:
Archiving is safer than deleting.

Owner should be able to archive.
Leader can archive only if permission allows; default should be owner only unless your architecture already supports it.

Archive behavior:
1. Project no longer appears in active list by default.
2. Project appears when “Show archived” filter is enabled.
3. Archived project is read-only by default.
4. Owner can unarchive.
5. Linked META·SIFT project should archive together if part of same Review Workspace.
6. Do not destroy data.
7. Audit log created.

UI:
- Archive action should be less dangerous than delete.
- Show confirmation:
  “Archive this project? You can restore it later.”

====================================================
TASK 7 — DELETE PROJECT FLOW
====================================================

Owner should be able to delete project.

I want this, but I also want you to think about safety.

My preference:
- Use soft delete/archive-like deletion first if possible.
- Avoid permanent hard delete unless there is a protected advanced flow.

Rules:
1. Only owner can delete.
2. Leaders cannot delete by default.
3. Members/viewers cannot delete.
4. If project is linked to META·SIFT through same Review Workspace, deleting from META·LAB should also delete/archive linked META·SIFT project.
5. Before deletion, show strong warning.
6. Confirmation should show exactly what will be affected:
   - META·LAB project
   - linked META·SIFT project if linked
   - data extraction records
   - PRISMA data
   - analysis results
   - screening records
   - second review decisions
   - chat messages
   - project members
7. Require explicit confirmation.
8. Consider requiring typing project name for deletion.
9. Create audit log.
10. After delete/archive:
   - project disappears from normal list
   - user is returned to project landing page

Backend:
- enforce owner-only server-side
- prevent accidental hard delete
- implement soft delete if possible
- preserve data unless permanent deletion is explicitly implemented
- linked workspace behavior should be consistent

Frontend:
- delete button visible only to owner
- strong modal
- clear consequences
- loading state
- success/error handling

====================================================
TASK 8 — CREATE PROJECT FLOW FROM LANDING PAGE
====================================================

The new landing page should allow creating a project easily.

Create Project button should open a good flow.

The create flow should include:
- project title
- optional description
- PICO/question if existing model supports it
- inclusion/exclusion if existing model supports it
- option:
  “Create linked META·SIFT screening project”
- this option should be enabled by default unless you think otherwise
- owner is current user
- Review Workspace created if needed
- linked META·SIFT project created if selected
- after creation, open project overview

If user creates without META·SIFT:
- show option later to link/create META·SIFT from project control or overview

====================================================
TASK 9 — LINKED META·SIFT STATUS AND ACTIONS
====================================================

Project cards should make linked META·SIFT status obvious.

For each project:
- show “META·SIFT linked” if linked
- show linked META·SIFT project title if available
- show “Not linked” if no screening project
- owner/leader with permission should see:
  - Create/link META·SIFT
- users with access should see:
  - Open META·SIFT

Clicking Open META·SIFT must go directly to correct project ID.

Do not route to first project.
Do not route to generic list if linked ID exists.

====================================================
TASK 10 — UI / UX DESIGN QUALITY
====================================================

I want this page to be beautiful and easy.

Design direction:
- serious academic research platform
- premium but not flashy
- night mode first
- day mode supported
- monochrome icons
- strong spacing
- good hierarchy
- smooth interactions
- polished empty states
- subtle animations
- no generic AI SaaS look

Good UI ideas you may use:
- project cards with status stripe
- role badges
- linked META·SIFT pill
- progress rings/bars
- timeline activity
- quick filters
- command-center style summary cards
- elegant search/filter bar
- row/card hover actions
- contextual menus
- archived banner
- read-only banner
- recently opened section

You have freedom to decide what is best.

Do not overload the page.
Keep it easy to navigate.

====================================================
TASK 11 — PERMISSION AND SECURITY RULES
====================================================

Backend must enforce everything.

Do not rely on frontend hiding.

Rules:
1. User can only see accessible projects.
2. Owner can archive/delete/manage.
3. Leader can manage only allowed things.
4. Member can leave but not delete.
5. Viewer/read-only cannot edit.
6. Archived projects are read-only unless owner unarchives.
7. Deleted/soft-deleted projects do not appear in normal lists.
8. Linked META·SIFT access must respect Review Workspace permissions.
9. All dangerous actions must create audit logs.
10. Route/API access must be tested.

====================================================
TASK 12 — OPS/ADMIN VISIBILITY IF RELEVANT
====================================================

If project archive/delete/leave is implemented, ops console should reflect this.

Ops should be able to see:
- active projects
- archived projects
- deleted/soft-deleted projects if safe
- project owner
- status
- linked META·SIFT
- deletion/archive audit events

Do not expose dangerous restore/permanent-delete controls unless you design them safely.

If adding new settings makes sense:
- default create linked META·SIFT on META·LAB project creation
- allow/disable project deletion
- deletion mode: archive/soft delete
- archive behavior

Use your judgment.

====================================================
TASK 13 — TESTING REQUIREMENTS
====================================================

Sonnet agents should add implementation tests.
Opus agents should reason through permission edge cases.
Fable should approve final behavior.

Manual QA:
1. Login as user with no projects.
2. Confirm new empty landing page appears.
3. Create META·LAB project from landing page.
4. Confirm project opens existing project overview.
5. Confirm linked META·SIFT project is created if option selected.
6. Return to project landing page.
7. Confirm project card shows:
   - title
   - owner
   - current user role
   - created date
   - last modified date
   - linked META·SIFT status
8. Search project by title.
9. Filter owned projects.
10. Filter linked META·SIFT projects.
11. Sort by created date.
12. Sort by last modified.
13. Switch view if view toggle exists.
14. Add another member.
15. Login as member.
16. Confirm project appears in member’s landing page.
17. Confirm member can open project.
18. Confirm member can leave project.
19. Confirm member cannot delete/archive.
20. Login as leader.
21. Confirm leader permissions are correct.
22. Login as owner.
23. Archive project.
24. Confirm project hidden from active list.
25. Show archived.
26. Confirm project appears.
27. Unarchive project.
28. Delete/soft-delete project.
29. Confirm strong warning appears.
30. Confirm linked META·SIFT is also archived/deleted according to chosen policy.
31. Confirm project disappears from normal list.
32. Confirm existing project overview still works.
33. Confirm viewer/read-only cannot edit.
34. Confirm unauthorized user cannot access project by direct URL.

Automated tests:
- accessible project list includes owned projects
- accessible project list includes shared/member projects
- inaccessible projects hidden
- archived hidden by default
- archived visible with filter
- owner can archive
- owner can delete/soft-delete
- leader cannot delete by default
- member can leave
- owner cannot leave without transfer/delete
- project open route uses correct ID
- linked META·SIFT ID returned and opens correctly
- create META·LAB with linked META·SIFT works
- viewer read-only enforced
- archive/delete audit logs created
- API permissions enforced

Build:
- Run test suite.
- Run build.
- Fix failures before returning.

====================================================
TASK 14 — VERSION BUMP, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump using your judgment.

Current example:
v2.7.0

Rules:
- Minor patch/bug fix:
  update third number
  example: v2.7.0 → v2.7.1

- Meaningful feature or important UX/product upgrade:
  update second number
  example: v2.7.0 → v2.8.0

- Major overhaul/state-of-the-art new system:
  update first number
  example: v2.7.0 → v3.0.0

This task creates a new post-login project landing experience and project lifecycle controls. I trust your judgment whether this is minor or major. Explain your reasoning.

2. Update version files/metadata.

3. Run tests.

4. Run build if available.

5. Commit changes with a clear commit message.

Suggested commit message:
feat: add META-LAB project landing and lifecycle controls

6. Push to the current branch.

Important:
- If git remote is configured and safe, push.
- If push fails because of auth/remote issue, commit locally and report exact reason.
- Do not include secrets.
- Do not commit generated junk files.
- Do not commit broken test artifacts.

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Your product/UX opinion before implementation.
2. What landing page design you chose and why.
3. How project selection now works.
4. How opening a project works.
5. How leave project works.
6. How archive project works.
7. How delete/soft-delete works.
8. How linked META·SIFT behavior works.
9. How permissions are enforced.
10. Backend changes.
11. Frontend changes.
12. Database changes/migrations.
13. Tests added.
14. Manual QA results.
15. Build/test results.
16. Version bump decision and new version.
17. Commit hash.
18. Push status.
19. Known limitations.
20. Recommended next improvements.

Do not return until this is implemented, tested, versioned, committed, and pushed if possible.