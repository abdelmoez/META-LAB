CLAUDE OPUS — MAJOR UX/PRESENCE/COLLABORATION/PICO/SCREENING WORKFLOW FIXES

Claude, I want you to treat this as a serious workflow, UX, and collaboration update.

Do not just patch random UI pieces.
Inspect the app first.
Understand how the project workflow currently works.
Understand how Screening, PICO, Duplicates, Title & Abstract, Project Members, and Project Overview are connected.
Then implement the cleanest solution.

Use Opus as the lead architect.
Use Sonnet for straightforward implementation, UI cleanup, tests, and docs if useful.

Do not ask me small questions.
If something is incomplete or ambiguous, use your best product judgment, document the assumption, and implement the best version.

====================================================
HIGH-LEVEL GOAL
====================================================

The app should feel simpler, cleaner, more collaborative, and more professional.

I want the workflow to feel like:

Project Landing → Open Review Project → Protocol/PICO → Screening → Data Extraction → Analysis → PRISMA/Export

The interface should not be cluttered.
The user should not see redundant navigation.
The app should support real collaboration without people overwriting each other’s work.
The default theme should be day/light mode.

====================================================
TASK 1 — REMOVE “PROJECTS” FROM THE LEFT PANEL INSIDE THE MAIN APP
====================================================

Problem:
Inside the main app/project interface, the left panel has “Projects.”

I want it removed because it clutters the interface and does not serve much purpose there.

Users can access all projects from the main app landing/project dashboard.

Expected:
1. Remove “Projects” from the left panel/sidebar inside the project workspace.
2. Do not remove the actual project landing/dashboard.
3. Keep a clean way to go back to all projects:
   - Back to Projects button
   - breadcrumb
   - top header link
   - or another clean navigation pattern
4. Do not break routing.
5. Do not make it harder to leave the project and return to project list.
6. Remove only redundant sidebar clutter.

QA:
- Open a project.
- Confirm left panel no longer has redundant Projects item.
- Confirm user can still return to main project landing page.
- Confirm project routes still work.

====================================================
TASK 2 — PERSIST SORT PREFERENCE ON APP MAIN LANDING PAGE
====================================================

Problem:
On the app main landing page/project dashboard, if I change “Sort by,” it resets after refresh/login.

Expected:
Save the user’s selected sorting preference so they do not need to change it every time.

Requirements:
1. Persist sort preference per user.
2. It should survive:
   - page refresh
   - logout/login
   - browser restart if possible
3. Choose the best storage:
   - backend user preference if existing preferences exist
   - localStorage as fallback
   - or both, with backend preferred
4. Save:
   - sort field
   - sort direction if applicable
   - maybe view mode/filter if already part of the dashboard state
5. Do not overwrite defaults for other users.
6. If invalid saved preference exists, fall back safely.

QA:
- Change sort.
- Refresh page.
- Sort remains.
- Logout/login.
- Sort remains.
- Different user can have different sort.

====================================================
TASK 3 — SCREENING STEPPER: RESTORE CONNECTING LINE AND TASK COUNTS
====================================================

Current status:
The stepwise workflow looks good aesthetically now.

Problem:
Previously, each step had useful task counts, like:
- remaining articles to screen
- remaining conflicts
- remaining final review items
- duplicates pending

Also, there should be a line between the steps indicating that they are connected.

Expected:
Keep the current improved alignment and aesthetics, but restore:
1. Connecting line between steps.
2. Useful task count/status under each step.
3. Active/completed/pending state.

Important:
The stepper is still a visual guide only.
It should not be clickable.

Suggested stepper layout:

Import
Step 1
124 records

Duplicates
Step 2
3 unresolved

Title & Abstract
Step 3
45 remaining

Conflicts
Step 4
2 conflicts

Final Review
Step 5
8 pending

Each step should be aligned under its submenu item.
A subtle connecting line should run between steps.
Completed steps can show check/accent.
Active step uses accent.
Pending steps muted.

Requirements:
1. Stepper remains directly below the Screening submenu.
2. Stepper remains aligned with submenu items.
3. Stepper is non-clickable.
4. Add connecting line without breaking alignment.
5. Add task counts/status text.
6. Counts should reflect real project data.
7. Do not show fake counts.
8. If data is unavailable, show a safe fallback like “Not started” or “—”.
9. It should work in day and night themes.
10. Responsive behavior must not overlap.

Suggested count logic:
- Import: imported records count.
- Duplicates: unresolved duplicate groups or “resolved.”
- Title & Abstract: records remaining to screen based on required reviewer rules.
- Conflicts: unresolved conflicts count.
- Final Review: pending final-review count or sent count.
- Data Extraction next-step indicator if included in the stepper.

QA:
- Stepper has connecting line.
- Stepper shows real counts.
- Stepper does not navigate on click.
- Submenu still navigates.
- Counts update after import, duplicate resolution, screening, conflict resolution, and final review.

====================================================
TASK 4 — SCREENING TITLE & ABSTRACT SHOULD UPDATE AFTER CONFLICT RESOLUTION
====================================================

Problem:
In Screening → Title & Abstract, studies are not updating correctly after conflict is resolved.

Expected:
When a conflict is resolved:
1. The record should leave the Conflicts queue if resolved.
2. The Title & Abstract list should update.
3. The record status should reflect the resolved decision.
4. Counts should update.
5. Stepper should update.
6. Screening Overview should update.
7. Final Review eligibility should update if applicable.
8. No stale records should remain in the wrong tab/list.

Investigate:
- cache invalidation
- query refetching
- local state not updating
- backend status not being changed correctly
- conflict resolution endpoint not returning updated record
- Title & Abstract filters not recalculating
- quorum logic not recalculating
- route state stale after mutation

Requirements:
1. Backend should persist resolved status correctly.
2. Frontend should invalidate/refetch all affected queries.
3. The same record should not appear in conflicting states.
4. Audit log conflict resolution if audit exists.
5. No page refresh should be required.

QA:
- Create/identify conflict.
- Resolve conflict.
- Confirm Conflicts count decreases.
- Confirm Title & Abstract list updates.
- Confirm Final Review eligibility updates if relevant.
- Confirm stepper counts update immediately.

====================================================
TASK 5 — REAL-TIME COLLABORATIVE FIELD LOCKING
====================================================

Major feature:
If someone is typing in a shared project in any field, that field should be locked for other members until the user is done.

Reason:
I do not want two users typing into the same field at the same time and causing conflicting saved data or discarded changes.

Expected:
When User A starts editing a field:
1. The field becomes locked for other users in the same project.
2. Other users see an indicator:
   - “Abdulmoiz is editing”
   - “Omar is typing”
   - or similar
3. Other users cannot edit that same field until the lock is released.
4. The indicator should appear immediately or near-real-time.
5. When User A stops typing/leaves/saves, the lock releases.
6. If User A disconnects, the lock expires automatically.

Scope:
Apply this to shared project fields where simultaneous editing can cause conflict.

Examples:
- PICO fields
- protocol fields
- inclusion criteria
- exclusion criteria
- data extraction fields
- screening notes/reasons if shared
- project settings fields if multiple leaders/owners can edit
- any other shared editable project fields

Do not apply unnecessarily to:
- personal filters
- personal view preferences
- individual reviewer decisions if each reviewer owns their decision
- chat input
- search input/filter boxes
- local-only UI fields

Backend requirements:
Create or reuse a field-lock/presence system.

Possible model:
FieldLock:
- id
- workspaceId/projectId
- entityType
- entityId
- fieldKey
- lockedByUserId
- lockedByUserName
- lockedAt
- expiresAt
- lastHeartbeatAt

Possible API:
- POST /api/workspaces/:id/locks/acquire
- POST /api/workspaces/:id/locks/heartbeat
- POST /api/workspaces/:id/locks/release
- GET /api/workspaces/:id/locks

Or use WebSocket/SSE if already available.

Requirements:
1. Lock is scoped to project/workspace.
2. Lock is scoped to exact field.
3. Same user can continue editing their field.
4. Other users are blocked.
5. Lock expires after inactivity.
6. Heartbeat refreshes lock while user is active.
7. Locks release on save/cancel/blur after debounce.
8. Locks release on navigation away if possible.
9. Locks must not permanently trap a field.
10. Backend enforces lock on save if feasible:
    - if another user owns active lock, reject update with clear error
11. Frontend shows a clear indicator.
12. If lock expires, UI updates.
13. Use optimistic UI carefully.

Suggested timing:
- acquire lock on focus or first keystroke
- heartbeat every 10–15 seconds while editing
- expire after 45–90 seconds without heartbeat
- release after save/cancel or after user leaves field
Use your judgment.

Visual UI:
- locked field becomes disabled or read-only
- show small inline badge:
  - “Omar is editing”
- maybe show avatar/initials
- do not make it ugly or intrusive
- use theme/accent colors

Conflict behavior:
If User B tries to edit locked field:
- show toast:
  “This field is being edited by Omar.”
- keep field read-only

Important:
Do not over-engineer collaborative editing like Google Docs.
This is field-level locking, not simultaneous text merging.

QA:
- Two users open same project.
- User A focuses PICO Population.
- User B sees lock indicator.
- User B cannot edit Population.
- User A saves.
- User B can edit after lock release.
- Lock expires if User A closes browser.
- User B can edit after expiration.
- Different fields can be edited by different users at same time.
- Reviewer decisions still work independently if they are per-user decisions.

====================================================
TASK 6 — DEFAULT MAIN THEME SHOULD BE DAY/LIGHT MODE
====================================================

Problem:
The main theme should be day/light mode, not dark mode.

Expected:
1. New users default to day/light theme.
2. Logged-out/public pages default to day/light unless user selected otherwise.
3. Existing users with saved dark preference should keep their preference if already saved.
4. If no preference exists, use day/light.
5. Theme toggle should still work.
6. Ops accent/theme controls should still work.
7. Forest plots, maps, charts, and UI should respect theme.

QA:
- New browser/no saved preference opens in day mode.
- Existing dark preference remains dark.
- Toggle works.
- Refresh preserves selected theme.
- Forest plot respects current theme.
- World map respects current theme.

====================================================
TASK 7 — REMOVE “SCREENING IS BUILT IN” COPY FROM CREATE PROJECT
====================================================

Problem:
In create project, remove this copy:

“Screening is built in
Your project includes a collaborative Screening stage — import references, de-duplicate, screen titles & abstracts with your team, then flow accepted studies into Data Extraction. Nothing to link.”

Reason:
It does not serve anything and clutters the create-project flow.

Expected:
1. Remove this block entirely.
2. Keep create project simple.
3. Do not remove actual Screening functionality.
4. Do not bring back linking language.

QA:
- Open create project.
- Confirm block is gone.
- Create project still works.
- Screening still exists after project creation.

====================================================
TASK 8 — PICO IMPROVEMENTS
====================================================

PICO needs improvements.

A. Time Frame should not be a free text field.

Change Time Frame to a controlled selection of time options the user can choose from.

Suggested options:
- No time restriction
- Last 1 year
- Last 3 years
- Last 5 years
- Last 10 years
- Since 2000
- Since inception
- Custom date range

If “Custom date range” is selected:
- show start date
- show end date optional
- validate dates

Use your best judgment for the option list.

B. Comparator / Control should be mandatory.

Comparator/Control should be required like the rest of PICO.

Requirements:
1. Population required.
2. Intervention/Exposure required.
3. Comparator/Control required.
4. Outcome required.
5. Time Frame required as a selection.
6. If custom date range, validate it.
7. Show clear validation messages.
8. Do not allow protocol/PICO to be marked complete if Comparator is missing.
9. Update any “green light” readiness status.
10. Update tests.

C. Inclusion and Exclusion Criteria

The user note was incomplete, but I want you to improve this area using product judgment.

Make inclusion and exclusion criteria structured and useful, not just an unclear free field.

Suggested implementation:
- Separate sections:
  - Inclusion Criteria
  - Exclusion Criteria
- Each section supports multiple criteria as rows/items.
- User can add/remove criteria.
- Each criterion can have:
  - text
  - optional category
  - optional required/major flag
- Provide simple starter placeholders:
  - Study design
  - Population
  - Intervention/exposure
  - Comparator
  - Outcomes
  - Time frame
  - Language/publication type if needed
- Make the UI clean and not overcomplicated.

If criteria are already implemented, improve them rather than duplicate.

Expected:
1. Inclusion/exclusion criteria are structured.
2. They save correctly.
3. They can be edited collaboratively with field locks.
4. They can be used later for Screening keyword logic if feasible.
5. They appear in protocol/export if applicable.

QA:
- Comparator required.
- Time Frame dropdown works.
- Custom date range validates.
- Inclusion criteria can be added/removed/saved.
- Exclusion criteria can be added/removed/saved.
- Readiness state updates.

====================================================
TASK 9 — AFTER IMPORT, DIRECT USER TO DUPLICATES AND MAKE DUPLICATE DETECTION READY
====================================================

Problem:
After importing references, the user should be directed to Step 2: Duplicates.

But currently, if you go straight to Duplicates after import, there can be an error.

Expected:
After successful import:
1. Records are fully saved.
2. Duplicate detection/indexing is ready.
3. User is directed to Duplicates step.
4. Duplicates page loads without error.
5. Duplicate detection runs automatically or is immediately available.
6. The user sees progress/loading if duplicate detection is still running.
7. No race condition.

Investigate:
- import endpoint
- duplicate detection endpoint
- async job timing
- frontend navigation occurring before backend is ready
- missing refetch/invalidate
- screening engine ID not ready
- duplicate component expecting data that does not exist yet

Fix requirements:
1. Import should complete record persistence before navigation.
2. Duplicate detection should be triggered after import.
3. If duplicate detection is async, show:
   - “Preparing duplicate review…”
   - progress/loading
   - then display results
4. If no duplicates, show helpful empty state.
5. Do not crash.
6. Stepper updates after import.
7. Counts update.

QA:
- Import file.
- App automatically navigates to Duplicates.
- No error.
- Duplicates page is ready.
- Duplicate count appears.
- If no duplicates, empty state appears.
- Refresh Duplicates page works.

====================================================
TASK 10 — DUPLICATES: KEEP BOTH + SHOW FULL ABSTRACT
====================================================

In Duplicates, user should be able to decide that suspected duplicates are not duplicates.

Add option:
- Keep both
- Not duplicates
- Keep as separate records

Use the label you think is best.

Expected:
1. For a duplicate pair/group, user can choose to keep both studies.
2. This marks the duplicate suggestion as resolved.
3. Both records remain active.
4. The group no longer appears as unresolved.
5. Audit log records the action.
6. Counts update.
7. Stepper updates.

Also:
User should be able to see the full abstract if they click “Show more.”

Requirements:
1. Abstract preview should be limited by default.
2. “Show more” expands full abstract.
3. “Show less” collapses it.
4. Works for each duplicate record/card.
5. Handles missing abstract gracefully.
6. Does not break layout.

QA:
- Duplicate group appears.
- Click Keep both.
- Group resolves.
- Both records stay active.
- Counts update.
- Show more displays full abstract.
- Show less collapses abstract.

====================================================
TASK 11 — TITLE & ABSTRACT REVIEWER COUNT MUST FOLLOW SETTINGS
====================================================

Problem:
In Title & Abstract, the number of reviewers and quorum must change based on project settings.

Expected:
If required reviewers = 2:
- quorum requires 2 decisions.

If required reviewers = 3:
- quorum requires 3 decisions.

If required reviewers = 4:
- quorum requires 4 decisions.

Everything should update based on the setting.

Areas to update:
1. Title & Abstract page.
2. Quorum labels.
3. Progress counts.
4. Stepper counts.
5. Screening Overview stats.
6. Record status logic.
7. Conflict logic.
8. Advancement to Final Review.
9. Settings page text.
10. Backend enforcement.

Requirements:
1. Use `requiredScreeningReviewers` from project settings.
2. Do not hardcode 2 anywhere except default initialization.
3. If setting changes, recalculate statuses.
4. If setting increases, records with fewer decisions may return to pending/not enough decisions unless already manually resolved by owner/leader.
5. If setting decreases, records may become eligible.
6. Document behavior.
7. Backend must enforce.
8. UI must explain:
   - “Requires 3 independent reviewer decisions”
   - “2 of 3 completed”
9. Conflict handling should use the same required reviewer count.

QA:
- Set required reviewers = 2.
- Quorum requires 2.
- Set required reviewers = 3.
- Quorum requires 3.
- Progress text updates.
- Advancement requires correct number.
- Backend blocks insufficient decisions.
- Conflicts update correctly.

====================================================
TASK 12 — REMOVE “RECORDS · MEMBERS” FROM SCREENING SUBMENU
====================================================

Problem:
The Screening submenu shows something like:

records · members

Remove this from the submenu.

Reason:
It clutters the submenu.

Expected:
1. Remove “records · members” from Screening submenu area.
2. Do not remove useful record/member data from the app entirely.
3. Replace with a cleaner active user/member indicator near the top-right utility area.

====================================================
TASK 13 — PROJECT ACTIVE USERS INDICATOR BESIDE CHAT ICON
====================================================

Add a project active users indicator near the chat icon/top-right project utility area.

Purpose:
Show who is currently active in the current project and where they are.

Display:
- active users currently inside this project
- total members in the project

Example:
- “3 active / 8 members”
- or icon with “3 / 8”
- choose the cleanest UI

When hovering over active users:
Show a popover/list:
- user name
- current location in project:
  - Overview
  - PICO
  - Screening
  - Screening > Import
  - Screening > Duplicates
  - Screening > Title & Abstract
  - Screening > Conflicts
  - Screening > Final Review
  - Data Extraction
  - Analysis
  - PRISMA
  - Project Settings
- last seen maybe
- small status indicator

This should be available to everyone in the project.

Requirements:
1. Track project presence in near-real-time.
2. A user is active if they are currently inside that project.
3. Store/update current location.
4. Update when user changes tabs/routes.
5. Remove/expire inactive users.
6. Do not show users as active forever after closing browser.
7. Total members count should come from project membership.
8. Active count should be current project only.
9. Do not expose activity across projects to unauthorized users.
10. Theme-compatible.
11. Does not overlap with chat/notification/user menu.

Possible backend model:
ProjectPresence:
- workspaceId/projectId
- userId
- userName
- currentPath
- currentSection
- currentSubsection
- lastHeartbeatAt
- activeUntil

Possible API:
- POST /api/workspaces/:id/presence/heartbeat
- GET /api/workspaces/:id/presence
- or use WebSocket/SSE if existing system supports it

Suggested timing:
- heartbeat every 20–30 seconds
- active if heartbeat within last 60–90 seconds
- update location on route change immediately

Frontend:
- use hook like useProjectPresence(workspaceId)
- derive human-readable location from current route
- show active indicator near chat
- hover/click popover lists active users

QA:
- Two users open same project.
- Active count shows 2.
- User navigates to Screening > Duplicates.
- Popover updates location.
- User closes tab.
- User expires after timeout.
- Total members count remains correct.
- Unauthorized user cannot access presence.

====================================================
TASK 14 — ADD ACTIVE USER LOCATION TO MEMBERS TAB
====================================================

Also add this feature in the Members tab/Project Settings members area.

Goal:
Owner and leader should know:
- who is active
- where they are in the project right now

But this should also be visible to all project members if appropriate, because active project presence is collaborative information.

In the members list, add:
1. Online/active indicator.
2. Current location.
3. Last active in project if available.
4. Maybe “currently editing field” if field locks are active.

Example:
- Omar Alwan — Active now — Screening > Title & Abstract
- Abdulmoiz Aljafari — Active now — Data Extraction
- John Doe — Last active 12 min ago

Requirements:
1. Do not clutter the list.
2. Owner stays top, then leaders, then members.
3. Role grouping remains.
4. Active users can have green/accent dot.
5. Inactive users show last seen if available.
6. Presence respects project permissions.
7. No private activity from other projects.

QA:
- Active user appears active in members list.
- Current location updates.
- Inactive user expires.
- Owner/leader/member ordering remains correct.

====================================================
TASK 15 — INTEGRATE FIELD LOCKING WITH PROJECT PRESENCE
====================================================

If you implement field locking and project presence together, connect them cleanly.

Presence:
- shows user is in project and current section

Field lock:
- shows user is editing a specific field

Do not confuse them.

Example:
Presence popover:
- Omar — Screening > Title & Abstract
- Abdulmoiz — PICO, editing Comparator

Field indicator:
- “Abdulmoiz is editing Comparator”

If a user is typing in a shared field, that should appear if it helps, but keep UI clean.

====================================================
GENERAL CLEANUP
====================================================

While doing this, search for:
- outdated “linked” language
- old META·SIFT user-facing terms
- confusing project language
- hardcoded reviewer count = 2
- dark theme defaults
- stale “members tab” references
- stepper clickable code
- duplicate-related race conditions
- duplicate group unresolved state bugs

Fix only what is related or clearly broken.

====================================================
DOCUMENTATION
====================================================

Create/update:

docs/manager/main-app-ux-collaboration-update-plan.md
docs/manager/project-presence-and-field-locking.md
docs/manager/pico-protocol-improvements.md
docs/manager/screening-import-duplicates-fix.md
docs/manager/reviewer-quorum-settings.md
docs/manager/main-app-ux-collaboration-final-report.md

Docs should include:
1. What changed.
2. Why Projects was removed from left panel.
3. How sort preference is persisted.
4. Stepper status/count logic.
5. Conflict resolution state sync.
6. Field locking design.
7. Presence design.
8. Theme default behavior.
9. PICO validation rules.
10. Time Frame options.
11. Inclusion/exclusion criteria structure.
12. Import → Duplicates flow.
13. Duplicate “Keep both” logic.
14. Reviewer quorum logic.
15. Active users UI behavior.
16. Known limitations.

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:

1. Project sidebar no longer shows redundant Projects item.
2. Back to Projects still works.
3. Sort preference persists.
4. Default theme is day/light if no preference.
5. Existing saved dark preference is preserved.
6. Create Project no longer shows “Screening is built in” block.
7. PICO Comparator is required.
8. PICO Time Frame uses controlled options.
9. PICO custom date range validates.
10. Inclusion/exclusion criteria can be added/saved.
11. Import redirects to Duplicates after records and duplicate detection are ready.
12. Duplicates page does not error immediately after import.
13. Duplicate Keep Both resolves duplicate group.
14. Show More expands abstract.
15. Required reviewers setting controls quorum.
16. No hardcoded 2 reviewer quorum except default.
17. Conflict resolution updates Title & Abstract state.
18. Stepper shows connecting line and counts.
19. Stepper is non-clickable.
20. Active project presence endpoint permissions.
21. Active users indicator shows current project users.
22. Members list shows active location.
23. Field lock prevents another user editing same field.
24. Lock expires after timeout.

Manual QA:

1. Login.
2. Open project.
3. Confirm left panel Projects item removed.
4. Use Back to Projects.
5. Change project dashboard sort.
6. Refresh and confirm sort persists.
7. Confirm app defaults to day theme in clean browser.
8. Create project and confirm “Screening is built in” block is gone.
9. Fill PICO without Comparator and confirm validation blocks completion.
10. Select Time Frame option.
11. Test custom date range.
12. Add inclusion criteria.
13. Add exclusion criteria.
14. Import references.
15. Confirm app navigates to Duplicates.
16. Confirm no Duplicates error.
17. Resolve duplicate by Keep Both.
18. Expand full abstract with Show More.
19. Set required reviewers to 3.
20. Confirm Title & Abstract quorum says 3.
21. Resolve a conflict and confirm Title & Abstract updates.
22. Confirm stepper has connecting line and task counts.
23. Confirm stepper is not clickable.
24. Open same project as two users.
25. Confirm active users indicator shows both.
26. Hover active users and see current location.
27. Navigate one user to Screening > Duplicates and confirm location updates.
28. In Members/Settings, confirm active status and location.
29. User A edits PICO field.
30. User B sees field locked with User A name.
31. User A saves or leaves.
32. User B can edit after lock releases.
33. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.
This is likely a minor version because it adds presence, locking, PICO improvements, and screening workflow fixes.

2. Update version metadata.

3. Run tests.

4. Run build.

5. Commit.

Suggested commit message:
feat: add project presence, field locking, and screening workflow polish

Alternative:
feat: improve project UX, PICO validation, and collaborative editing

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- .env
- raw local database files
- junk files
- broken generated artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Left panel Projects removal.
2. How users now return to project landing.
3. Sort preference persistence implementation.
4. Stepper connecting line and task counts.
5. Conflict resolution update fix.
6. Field locking implementation.
7. Lock timeout/heartbeat rules.
8. Active users/presence implementation.
9. Active users indicator behavior.
10. Members tab active location behavior.
11. Day theme default change.
12. Create project copy removal.
13. PICO Time Frame options.
14. Comparator mandatory behavior.
15. Inclusion/exclusion criteria structure.
16. Import → Duplicates flow fix.
17. Duplicate Keep Both behavior.
18. Show More abstract behavior.
19. Reviewer quorum setting behavior.
20. Backend changes.
21. Frontend changes.
22. Database/migration changes if any.
23. Security/privacy decisions.
24. Tests added.
25. Manual QA results.
26. Build/test results.
27. Version bump and new version.
28. Commit hash.
29. Push status.
30. Known limitations.
31. Recommended next steps.

Claude, use your judgment.

Make the app cleaner.
Make collaboration safer.
Make the workflow obvious.
Make the default theme light.
Make Screening and PICO feel professional.
Do not break existing projects.
Do not expose internal META·SIFT language.
Do not let users overwrite each other’s work.