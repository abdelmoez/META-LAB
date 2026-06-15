CLAUDE OPUS — MAJOR SCREENING ENGINE UX REBUILD, WORKFLOW REPAIR, FOREST PLOT FIX, DASHBOARD CLEANUP, AND OPS USER MAP

Claude, this is a very big update.

I want your full power here. Think deeply. Use Opus as the lead architect. Do not treat this as a small bug fix. This is a product workflow repair and UX redesign.

I want you to inspect the app first, understand what broke, map the current structure, then design and implement the cleanest solution.

Do not blindly patch the current clutter.
Do not preserve bad UI just because it already exists.
If the current layout is wrong, redesign it.

Keep the app powerful, but make the user experience simple.

====================================================
IMPORTANT PRODUCT DIRECTION
====================================================

Keep “META·SIFT” only as an internal/backend name for the screening engine.

The user should not see META·SIFT anymore.

User-facing language:
- Screening
- Screening workspace
- Screening engine, only in admin/internal contexts if needed
- Screening records
- Screening decisions
- Screening settings

Do NOT show:
- META·SIFT
- linked META·SIFT
- META·SIFT project
- Open META·SIFT
- Create/link META·SIFT

The architecture can still know internally that META·SIFT powers Screening.
But the product should feel like one app.

The user is inside one Review Project.
Screening is one stage inside that Review Project.

====================================================
TEAM STRUCTURE
====================================================

Use a team of 5.

1. Opus Lead Architect / Product Owner
   - Owns the whole plan.
   - Maps current workflow.
   - Decides the final UX.
   - Assigns tasks.
   - Reviews all work.
   - Owns final QA, version bump, commit, and push.

2. Screening Engine Engineer
   - Owns all Screening/META·SIFT internal functionality.
   - Fixes broken Screening tabs.
   - Preserves internal engine separation.
   - Ensures import/duplicates/title-abstract/conflicts/full-text/settings/export work.

3. Frontend UX & Layout Engineer
   - Redesigns the Screening layout.
   - Removes clutter.
   - Fixes navigation and responsive behavior.
   - Handles slide-away side menu/full-screen screening workspace.
   - Removes confusing linked-project UI.

4. Research Workflow & Permissions Engineer
   - Owns reviewer requirements.
   - Adds minimum reviewer logic before second review.
   - Ensures owner/leader can change required reviewer count.
   - Ensures workflow rules are enforced in frontend and backend.

5. QA, Ops & Visualization Engineer
   - Fixes forest plot live display.
   - Removes dashboard linked/unlinked filters.
   - Adds interactive users-country map in Ops.
   - Adds tests and manual QA.
   - Checks theme consistency.

Use this communication format internally:

[FROM: Agent Name]
[TO: Agent Name]
[TOPIC: Short topic]
[MESSAGE]
[FILES I OWN THAT ARE AFFECTED]
[WHAT I NEED FROM YOU]

Do not let agents overwrite each other.
The Opus Lead Architect resolves conflicts.

====================================================
EXECUTION PLAN
====================================================

Follow this sequence.

1. Inspect current code.
2. Map Screening routes/components/state.
3. Identify why Screening tabs are broken.
4. Identify all remaining META·SIFT user-facing strings.
5. Identify all “linked META·LAB project” and linked/unlinked UI references.
6. Map current reviewer workflow and second-review logic.
7. Map current forest plot live component vs exported/preview component.
8. Map current Ops users table and user registration model.
9. Design new Screening layout.
10. Implement in safe stages.
11. Test old and new projects.
12. Run build/tests.
13. Update docs/version.
14. Commit and push if safe.

Create an implementation document first:

docs/manager/screening-workflow-overhaul-plan.md

Include:
- what is broken now
- current architecture map
- proposed new layout
- backend changes
- frontend changes
- migration/data changes
- risks
- QA plan

Then implement.

====================================================
TASK 1 — FIX BROKEN SCREENING TABS
====================================================

The Screening tab is currently broken.

The top buttons are not working:

- Overview
- Import
- Duplicates
- Title & Abstract
- Conflicts
- Full Text
- Settings
- Export

I need all of them repaired.

But do not only “make buttons click.”
First inspect why they are broken.

Possible issues to check:
- wrong route nesting
- wrong active tab state
- broken component imports
- route mismatch after workflow unification
- project ID vs workspace ID confusion
- internal META·SIFT ID not being resolved
- missing auto-created screening module
- conditional rendering hiding content
- stale linked-project assumptions
- permissions blocking content incorrectly
- z-index/layout issue causing clicks not to register
- tabs using old META·SIFT project state

Expected:
When the user opens the main project and clicks Screening, they enter the Screening workspace.

Inside Screening, these sub-tabs should work:
1. Overview
2. Import
3. Duplicates
4. Title & Abstract
5. Conflicts
6. Full Text
7. Settings
8. Export

Also, Second Review / Full Text must be present and working. If “Second Review” is the more accurate workflow label, decide whether to call it:
- Full Text
- Second Review
- Full Text Review

My preference:
Use **Full Text** as the tab label, with “Second Review” language inside the page if needed.

====================================================
TASK 2 — REDESIGN SCREENING LAYOUT
====================================================

The current Screening layout feels wrong.

Problem:
Everything is cluttered in one screen.
Everything is small.
There are too many things happening at once.
This will confuse users.

I want a new design that fits Screening as a serious workflow.

Do not attach yourself to the current UI.
If it is bad, redesign it.

Preferred concept:
Main project navigation has one button:

Screening

When clicked, Screening opens a dedicated workspace.

Inside Screening, show sub-tabs or a secondary navigation:

Overview | Import | Duplicates | Title & Abstract | Conflicts | Full Text | Settings | Export

This keeps the main app simple, but keeps Screening powerful.

Important:
Do not spread all Screening functions as top-level META·LAB tabs.
Everything powered by internal META·SIFT should live under the single user-facing Screening stage.

Suggested layout:
- Project main nav remains clean.
- Screening page has its own internal header.
- Screening sub-tabs are clearly below the Screening header.
- Each sub-tab has enough screen space.
- Avoid showing import, duplicates, screening, conflicts, full text, settings, and export all at the same time.
- Use progressive disclosure.
- Use cards only where useful.
- Use tables/lists with proper spacing.
- Avoid cramped multi-column overload.

Suggested Screening structure:

Screening
├── Overview
│   ├── screening progress
│   ├── imported records
│   ├── duplicates
│   ├── screened records
│   ├── conflicts
│   ├── full text pending
│   ├── included studies
│   └── next recommended action
├── Import
│   ├── import references
│   ├── import history
│   └── source/database info
├── Duplicates
│   ├── duplicate groups
│   ├── similarity percentage
│   └── merge/exclude actions
├── Title & Abstract
│   ├── record list
│   ├── abstract viewer
│   ├── inclusion/exclusion decisions
│   ├── keyword highlights
│   └── reviewer decisions
├── Conflicts
│   ├── conflicts list
│   ├── reviewer decisions
│   └── resolution tools
├── Full Text
│   ├── full-text review queue
│   ├── PDF attachments
│   ├── second review decisions
│   └── final inclusion/exclusion
├── Settings
│   ├── required reviewer count
│   ├── blind mode
│   ├── keyword settings
│   ├── exclusion reasons
│   └── screening permissions/settings
└── Export
    ├── screening export
    ├── included studies export
    ├── decisions export
    └── PRISMA screening data export

Make it feel spacious, logical, and not scary.

====================================================
TASK 3 — OPTIONAL FULL-SCREEN SCREENING EXPERIENCE
====================================================

When the user is inside Screening, consider giving Screening more horizontal room.

The current META·LAB right menu/sidebar can make the Screening workspace cramped.

I want you to evaluate the best solution.

Possible approaches:
1. Automatically collapse the META·LAB side/right menu when entering Screening.
2. Add a “Focus mode” button.
3. Make the side menu slide out of the way.
4. Hide secondary project panels while Screening is active.
5. Make Screening use full width under the main app shell.

Preferred:
When Screening opens, the workspace should have enough width to breathe.

Do not break global navigation.
Do not trap the user.
There should still be:
- Back to project overview
- Back to projects
- project name/context
- account/notification access if currently global

But remove unnecessary panels that clutter the Screening stage.

====================================================
TASK 4 — REMOVE “LINKED META·LAB PROJECT” AND LINKING LANGUAGE
====================================================

Remove this entirely from normal user UI:

“Linked META·LAB Project”

Reason:
The user is already inside META·LAB / the Review Project.
This text creates confusion and clutter.

Also remove normal user-facing:
- linked META·SIFT
- linked META·LAB
- unlinked
- link project
- linked project status
- open linked META·SIFT
- create linked META·SIFT
- META·SIFT project

Replace with:
- Screening
- Screening status
- Screening workspace
- Review Project
- Project workflow

Internal/admin-only wording can still mention internal engine if needed:
- Internal Screening Engine
- Internal META·SIFT module ID
- Engine health

But ordinary users should not see it.

====================================================
TASK 5 — MOVE PROJECT STATUS TO THE RIGHT PLACES
====================================================

Project status should not clutter the Screening workspace.

Move project status to:
1. Project Control
2. META·LAB / Review Project overview

In the Screening tab, only show Screening-specific status:
- imported records
- duplicates pending
- title/abstract screening progress
- conflicts
- full text pending
- final included
- next action

Do not show general project status everywhere.

====================================================
TASK 6 — PROJECT SETTINGS SHOULD CONTROL EVERYTHING
====================================================

Project settings/control should include everything about the project, whether the setting affects META·LAB or the internal Screening engine.

User-facing:
- one Project Control / Project Settings area

It should include:
- general project title/status
- project description
- members
- roles
- permissions
- screening settings
- required reviewer count
- blind mode
- keyword settings if appropriate
- analysis settings if appropriate
- export settings if appropriate
- archive/delete/leave
- audit log

Do not make users go to separate “META·SIFT settings” as if it is another app.

Inside Screening, the Settings sub-tab can exist for workflow-specific settings, but it should be clearly part of Project Settings or sync with it.

====================================================
TASK 7 — RENAME META·SIFT TO SCREENING EVERYWHERE USER-FACING
====================================================

Find all user-facing appearances of META·SIFT and replace them with Screening.

Search for:
- META·SIFT
- MetaSift
- Meta Sift
- metasift
- sift-beta
- SIFT
- linked META·SIFT
- META·SIFT Project

Rules:
- Internal code names can remain if refactor is risky.
- Database table names can remain.
- Backend service names can remain.
- Comments/docs for developers can explain internal META·SIFT engine.
- User-facing UI must say Screening.
- Public docs should say Screening, unless they are developer docs.
- Email templates/notifications should say Screening.
- Ops normal UI should say Screening.
- Admin debug/developer details may mention internal META·SIFT.

Important:
Do not break routes unnecessarily.
If old routes include “sift,” keep compatibility redirects if needed, but hide route details from user where possible.

====================================================
TASK 8 — SCREENING STATS IN PROJECT OVERVIEW
====================================================

Show Screening stats in the Review Project / META·LAB overview.

But do NOT move member stats there.
Member stats should remain where they are currently managed.

Project overview should show useful Screening progress:
- imported records
- duplicates detected/resolved
- title/abstract screened
- title/abstract remaining
- conflicts
- full text pending
- full text reviewed
- final included
- excluded
- readiness for Data Extraction
- next recommended action

Make this simple.
Do not overload the overview.

Good:
A “Screening Progress” card with key numbers and a Continue Screening button.

Bad:
A giant table of every reviewer’s performance in the main overview.

====================================================
TASK 9 — REQUIRED REVIEWERS BEFORE FULL TEXT / SECOND REVIEW
====================================================

Major workflow change:

There must be at least 2 reviewers required per project before records can move to Full Text / Second Review.

Default:
- required reviewers = 2

Owner and project leader can change this number from Project Settings.

They can increase it to any reasonable number depending on the project.

Requirements:
1. Add project-level setting:
   - requiredScreeningReviewers
   - default 2
2. This setting belongs to Project Settings / Project Control.
3. Owner can change it.
4. Leader can change it if they have permission.
5. Normal members/viewers cannot change it.
6. Enforce this on frontend and backend.
7. A record cannot move from Title & Abstract to Full Text unless it has enough required independent reviewer decisions.
8. The number required should be visible in Screening Settings.
9. If required reviewers is 2:
   - one include decision is not enough
   - two include decisions can allow movement forward
10. If required reviewers is 3:
   - three required decisions needed based on selected logic
11. Handle conflicts clearly.

Important:
Define the logic carefully.

Recommended:
For a record to move to Full Text:
- it must have at least requiredScreeningReviewers valid title/abstract decisions
- and the include/maybe/advance threshold must be satisfied
- conflicts remain in Conflicts until resolved

You may choose the exact logic, but document it.

Possible decision logic:
- include + include = advance
- include + maybe = conflict or advance depending setting
- include + exclude = conflict
- maybe + maybe = maybe/full-text queue depending setting
- exclude + exclude = exclude
- not enough decisions = pending

Add settings if useful:
- requiredScreeningReviewers
- maybeBehavior:
  - treat as advance
  - treat as conflict
  - require resolution
- conflictResolutionRequired: true

Do not overcomplicate UI unless needed.
Make the default safe and research-standard.

Full Text tab:
- must exist in menu
- should show records that passed title/abstract screening
- should allow final inclusion/exclusion with reasons
- accepted studies should move to Data Extraction

QA:
1. Project starts with required reviewers = 2.
2. One reviewer includes record → not moved to Full Text.
3. Second reviewer includes record → moves/eligible for Full Text.
4. Include + exclude → conflict.
5. Owner changes required reviewers to 3.
6. Two includes no longer enough for new advancement.
7. Third include makes it eligible.
8. Viewer cannot change setting.
9. Leader with permission can change setting.
10. Backend blocks invalid advancement even if frontend bypassed.

====================================================
TASK 10 — FIX FOREST PLOT LIVE DISPLAY
====================================================

The Forest Plot live display in the website is broken.

Issues:
1. It is always dark themed even when the website is in day mode.
2. The live plot width is smaller than the surrounding layout.
3. It causes clutter.
4. Text overlaps inside the live plot.
5. Preview/exported figures work fine.
6. The broken issue appears to be only the live embedded display.

Do not break export/preview since they work.

Inspect:
- live Forest Plot component
- export Forest Plot component
- preview component
- theme provider
- CSS container width
- SVG/canvas size
- responsive behavior
- label wrapping
- plot margins
- text anchor/overflow
- device pixel ratio handling if canvas

Fix requirements:
1. Live Forest Plot must respect current theme:
   - day mode → light plot background/text
   - night mode → dark plot background/text
2. It must use full available width.
3. It must not overlap text.
4. It must scale responsively.
5. Study labels should not collide with effect labels.
6. CI labels should remain readable.
7. It should match the quality of the exported/preview plot.
8. Do not degrade exported figures.
9. If necessary, share styling logic between preview/export/live.
10. Add container min-width and responsive handling.
11. Add horizontal scroll only if absolutely necessary for very long labels.
12. Preserve chosen decimal precision.

QA:
1. Day theme live forest plot.
2. Night theme live forest plot.
3. Long study names.
4. Many studies.
5. Narrow screen.
6. Export still works.
7. Preview still works.
8. No overlap/clutter.

====================================================
TASK 11 — REMOVE LINKED/UNLINKED FILTERS FROM MAIN DASHBOARD
====================================================

Remove linked/unlinked filters from the main project dashboard.

Reason:
We are no longer exposing linking as a user concept.

Remove filters like:
- linked
- unlinked
- linked META·SIFT
- missing linked project
- linked screening

Replace if needed with better filters:
- Active
- Archived
- Owned by me
- Shared with me
- Recent
- Needs attention
- Screening in progress
- Ready for extraction
- Analysis ready
- Completed

Do not show internal linking status to normal users.

====================================================
TASK 12 — OPS USERS MAP BY COUNTRY
====================================================

Add an interactive map in the Users tab of the Ops Console.

Goal:
Show where registered users are from by country.

Data source:
The country should be captured automatically when the user registers, based on IP geolocation.

Do not ask the user during registration.

Important privacy note:
Only store country-level location, not precise location.
Do not store street/city/coordinates unless already required elsewhere.
This is for aggregate ops analytics only.

Registration behavior:
1. On registration, detect request IP.
2. Use an IP geolocation service or library if already available.
3. Store:
   - registrationCountryCode
   - registrationCountryName
   - registrationIpHash optional
   - registeredAt
4. Do not store raw IP unless necessary.
5. If geolocation fails:
   - country = Unknown
6. If local/dev/private IP:
   - country = Local/Unknown
7. Do not block registration if geolocation fails.
8. Document privacy behavior.

Backend:
Add fields to User if needed:
- registrationCountryCode
- registrationCountryName
- registrationIpCountrySource
- registrationIpHash optional

Add Ops endpoint:
- GET /api/admin/users/countries

Return:
- countryCode
- countryName
- userCount
- percentage
- latestRegistrationAt maybe

Permissions:
- Admin can view
- Mod only if current ops policy allows user analytics
- normal users cannot access

Frontend:
In Ops Console → Users tab:
Add:
1. Interactive world map.
2. Country shading based on percentage of users.
3. Table ranked by highest user count.

Map behavior:
- The more users from a country, the closer the country color is to the app’s main accent color.
- The fewer users, the lighter the color.
- Countries with no users should be white/light neutral.
- The map should change if the app accent color/theme changes.
- Tooltips:
  - country name
  - user count
  - percentage
- Click country optionally filters/highlights table.
- Table sorted by user count descending.

Theme behavior:
- Day mode should look clean.
- Night mode should look clean.
- Accent color should drive the map.
- If accent color changes, map color scale updates.

Implementation options:
- Use an existing map library if already installed.
- If no map library exists, choose a lightweight safe option.
- Avoid huge dependencies unless necessary.
- If a library is too heavy, implement a simpler SVG/GeoJSON map.
- Keep performance good.

Table:
Columns:
- Rank
- Country
- Users
- Percentage
- Latest registration maybe

Also show summary:
- Total registered users with known country
- Unknown users
- Number of countries represented

Migration:
For existing users:
- country may be Unknown.
- Do not try to infer old users unless a safe existing login IP source exists.
- Future registrations should populate the field.
- Optionally add backfill only if reliable data exists.

QA:
1. New registration captures country if possible.
2. Registration works if geolocation fails.
3. Unknown country handled.
4. Ops map renders.
5. Country table ranks correctly.
6. Theme/accent color updates map.
7. Unauthorized user cannot access endpoint.
8. No raw IP leak to frontend.
9. Build passes.

====================================================
ADDITIONAL SUGGESTIONS FROM ME
====================================================

Claude, consider these improvements if they fit:

1. Add a “Screening Focus Mode”
Inside Screening, add a button:
- Enter Focus Mode
- Exit Focus Mode

Focus Mode:
- collapses extra side panels
- gives full width to screening records
- keeps top project context
- improves screening speed

2. Add “Next Action” cards
In Screening Overview, show:
- Import references
- Resolve duplicates
- Continue title/abstract screening
- Resolve conflicts
- Continue full text review
- Send included studies to extraction

Only show the next relevant action.

3. Add status chips instead of cluttered cards
Use simple chips:
- Imported
- Duplicates pending
- Screening active
- Conflicts pending
- Full text active
- Extraction ready

4. Make Screening layout task-based
Instead of showing every tool at once, each sub-tab should answer one question:
- Import: “How do I get records in?”
- Duplicates: “Which records are duplicates?”
- Title & Abstract: “Which records should advance?”
- Conflicts: “What needs resolution?”
- Full Text: “Which articles are finally included?”
- Export: “What do I need to export?”

5. Add empty states
Every Screening sub-tab should have helpful empty states:
- No records imported yet
- No duplicates detected
- No conflicts yet
- No full-text records yet
- No included studies yet

6. Add breadcrumbs
Example:
Review Project > Screening > Title & Abstract

7. Add route stability
Use URLs that can deep-link:
- /projects/:workspaceId/screening/overview
- /projects/:workspaceId/screening/import
- /projects/:workspaceId/screening/duplicates
- /projects/:workspaceId/screening/title-abstract
- /projects/:workspaceId/screening/conflicts
- /projects/:workspaceId/screening/full-text
- /projects/:workspaceId/screening/settings
- /projects/:workspaceId/screening/export

Old routes should redirect if possible.

8. Add internal engine repair
If Screening is opened and internal META·SIFT engine/module is missing:
- auto-create if safe
- repair ownership/permissions
- log audit event
- do not show scary error to user
- show simple “Preparing screening workspace…” if needed

====================================================
DOCUMENTATION TO CREATE/UPDATE
====================================================

Create/update:

1. docs/manager/screening-workflow-overhaul-plan.md
2. docs/manager/screening-current-breakage-map.md
3. docs/manager/screening-new-ux-spec.md
4. docs/manager/screening-reviewer-rules.md
5. docs/manager/forest-plot-live-display-fix.md
6. docs/manager/ops-users-country-map.md
7. docs/manager/screening-overhaul-final-report.md

Also update:
- README if user-facing language changed
- admin/ops docs
- internal architecture docs
- tests report

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:
- Screening sub-tabs route/render correctly
- internal screening engine resolves from Review Project
- no manual linked-project UI for normal users
- required reviewers default to 2
- owner/leader can change required reviewer count
- viewer/member cannot change required reviewer count
- record cannot advance to Full Text with insufficient decisions
- conflicts behave correctly
- full-text accepted studies reach Data Extraction
- forest plot respects theme
- forest plot live width responsive
- dashboard linked/unlinked filters removed
- ops users country endpoint permissions
- registration country field safe handling

Manual QA:
1. Login.
2. Open main dashboard.
3. Confirm linked/unlinked filters are gone.
4. Open Review Project.
5. Confirm main nav has Screening, not META·SIFT.
6. Click Screening.
7. Confirm full Screening workspace opens.
8. Confirm sub-tabs work:
   - Overview
   - Import
   - Duplicates
   - Title & Abstract
   - Conflicts
   - Full Text
   - Settings
   - Export
9. Confirm no “Linked META·LAB Project.”
10. Confirm no visible META·SIFT user-facing text.
11. Import records.
12. Screen with one reviewer.
13. Confirm not enough to move to Full Text if required reviewers = 2.
14. Screen with second reviewer.
15. Confirm advancement/conflict logic works.
16. Change required reviewers in Project Settings.
17. Confirm rule updates.
18. Accept full text.
19. Confirm study reaches Data Extraction.
20. Open Project Overview.
21. Confirm Screening stats show.
22. Confirm member stats did not move there.
23. Test forest plot in day theme.
24. Test forest plot in night theme.
25. Confirm export/preview still work.
26. Open Ops Users tab.
27. Confirm map renders.
28. Confirm country table renders.
29. Confirm unauthorized user cannot access country endpoint.
30. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

This is a major workflow/UX update.

After successful implementation:
1. Decide version bump.
2. This may be a minor or major bump depending on how much is changed.
3. Update version metadata.
4. Run tests.
5. Run build.
6. Commit.

Suggested commit message:
feat: rebuild screening workspace and unify screening UX

Alternative:
feat: overhaul screening workflow and ops user geography

7. Push to current branch if safe.

If push fails:
- commit locally
- report exact error.

Do not commit:
- secrets
- .env
- raw local DB
- junk files
- broken generated artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Root cause of broken Screening tabs.
2. New Screening workspace design.
3. How internal META·SIFT is preserved.
4. All user-facing META·SIFT removals.
5. All removed linked-project UI.
6. How Project Settings now controls Screening settings.
7. Required reviewer logic.
8. Full Text / Second Review behavior.
9. Screening stats added to Project Overview.
10. Forest Plot live display fix.
11. Dashboard filter cleanup.
12. Ops country map implementation.
13. Database changes.
14. Backend changes.
15. Frontend changes.
16. Migration/backfill behavior.
17. Privacy decisions for IP/country.
18. Tests added.
19. Manual QA results.
20. Build/test results.
21. Version bump.
22. Commit hash.
23. Push status.
24. Known limitations.
25. Recommended next step.

Claude, I want your real judgment here.

If my suggested layout is not the best, propose a better one and implement the better one.
But keep the core rule:

META·SIFT remains the internal screening engine.
The user sees only Screening.

Make the workflow elegant.
Make the screen breathe.
Make the buttons work.
Remove confusion.
Keep the backend clean.
Protect the data.
Test everything.