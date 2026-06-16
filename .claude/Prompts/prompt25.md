CLAUDE OPUS — OPS ACTIVE USER METRICS, PROJECT TIMESTAMP ROOT-CAUSE FIX, DYNAMIC OWNER NAMES, SCREENING STEP NAVIGATION, KEYBOARD SHORTCUTS, AND PROJECT IMPORT

Claude, I want you to treat this as a careful bug-fix and product-polish update.

Some of these are UI improvements, but one of them is a serious data/state bug: when I open one project, all projects appear as if they were opened/updated at the same time. I want you to investigate that deeply and fix the root cause, not just hide the symptom.

Use Opus as the lead architect.
Use Sonnet for straightforward UI, tests, and documentation if useful.

Do not ask me small questions.
Inspect the app first.
Find the root causes.
Implement safely.
Run tests/build.
Version, commit, and push if safe.

====================================================
TASK 1 — OPS CONSOLE: ONLINE / OFFLINE / ACTIVE USER METRICS
====================================================

In the Ops Console, I want to see how many users are online/active and how many users are not online/active.

This should appear in both:

1. Ops Overview
2. Ops Users tab

Definitions:
- Online / active user: a user with a recent active presence heartbeat or authenticated activity within the chosen active window.
- Offline / inactive user: a registered user who is not currently active.
- Use the existing presence/activity system if available.
- Do not count public visitors as online users unless they are authenticated.
- Pick a reasonable active threshold, for example active within the last 60–120 seconds for “online,” and document it.

Requirements:
1. Ops Overview should show:
   - total registered users
   - online/active users
   - offline/inactive users
   - optionally active in last 24h if already tracked

2. Ops Users tab should show:
   - online/active users
   - offline/inactive users
   - total users
   - percentage online

3. User list should show online status:
   - green pulsating circle for online users
   - muted/gray dot or no pulse for offline users
   - label or tooltip: Online / Offline / Last active

4. If I click a user in Ops Users:
   - show whether they are currently online
   - show where they are right now if active:
     - which project
     - which section
     - which subsection if available
   - examples:
     - “Project: The Super test for screening”
     - “Location: Screening > Title & Abstract”
     - “Location: Data Extraction”
   - show last active time if offline

5. Do not leak data to unauthorized users.
6. Admin can see this.
7. Mod access should follow the current Ops policy.
8. Normal users cannot access Ops presence data.

Backend:
- Reuse ProjectPresence / activity tracking if implemented.
- Add or update Ops endpoints if needed:
  - GET /api/admin/users/activity-summary
  - GET /api/admin/users/:id/activity
  - or extend existing users endpoint safely
- Include:
  - userId
  - name
  - email
  - online boolean
  - lastActiveAt
  - currentProjectId
  - currentProjectTitle
  - currentSection
  - currentSubsection
  - countryCode/countryName if needed for map
- Do not expose raw IP.

QA:
- Online user shows green pulsating dot.
- Offline user does not show green pulse.
- Ops Overview counts online/offline correctly.
- Ops Users counts online/offline correctly.
- Clicking active user shows current project and section.
- Clicking offline user shows last active.
- Unauthorized user cannot access endpoints.

====================================================
TASK 2 — OPS WORLD MAP: ONLINE AND TOTAL USERS BY COUNTRY
====================================================

In the Ops Users map, when I hover over a country, I want to see:

1. country name
2. total registered users from that country
3. online/active users from that country
4. offline/inactive users from that country
5. percentage of total users if already shown

Example tooltip:
United Arab Emirates
Total users: 5
Online now: 2
Offline: 3
Share: 12.5%

The country table should show similar information.

Country table columns:
- Rank
- Country
- Total users
- Online users
- Offline users
- Percentage of all users
- Latest registration if already available

Requirements:
1. Keep the real world map.
2. Keep correct country mapping.
3. Do not reintroduce the UAE/Ukraine bug.
4. Country color can still be based on total users or percentage of total users.
5. Add online count as tooltip/table data.
6. Use green/pulsing indicator or badge for online count if visually appropriate.
7. Unknown country users should appear in table/summary but not color a map country.
8. Do not expose raw IP.

QA:
- Hover UAE shows UAE total and online users.
- Hover USA shows USA total and online users.
- Ukraine does not show UAE data.
- Country table matches tooltip.
- Offline count = total - online.
- Unknown users handled safely.

====================================================
TASK 3 — APP PRESENCE SHOULD SHOW USER NAME, NOT EMAIL
====================================================

In the app’s active user/presence UI, show the user’s name, not email.

This applies to:
- project active users indicator
- hover/dropdown list
- members active location
- field-lock indicators
- chat title/participants if relevant
- any “X is editing” message

Expected:
Show:
- “Abdulmoiz is editing Comparator”
- “Omar — Screening > Duplicates”

Not:
- “abdelmoezhj@gmail.com is editing Comparator”

Fallback:
If name is missing, then use:
1. displayName if available
2. name
3. email username before @
4. email only as final fallback if nothing else exists

Requirements:
1. Keep email available only where needed, like Ops user detail or account settings.
2. Presence dropdown should prioritize display name.
3. Field lock should show display name.
4. Chat should show display name.
5. Do not break identity resolution.

QA:
- Active project popover shows names.
- Field lock shows name.
- Members active status shows name.
- Missing name fallback works.

====================================================
TASK 4 — CRITICAL BUG: OPENING ONE PROJECT MAKES ALL PROJECTS LOOK OPENED/UPDATED
====================================================

This is a big bug.

Problem:
When I open any project, all other projects are assumed to have been opened at the same time.

Example:
If I opened Project 1 six minutes ago, Project 2, Project 3, etc. also appear as if they were opened six minutes ago.

This is visible on the app landing page where the updated/opened time becomes the same for all projects.

Important observation:
When I log in with a different user who owns only one project and is only a reviewer/member in the others, it seems only the project he owns changes if any change happened.

This may indicate a bug involving:
- user-level lastActiveAt being shown as project updated time
- owner-level updatedAt being applied incorrectly
- shared project timestamps using current user activity
- project list mapping using the same timestamp variable for all rows
- opening a project updates all projects owned by the same user
- backend query joining user last active instead of project last opened
- frontend cache mutating every project card
- landing page “updated” field is not actually project updatedAt
- recently opened logic uses user timestamp globally instead of per-project timestamp

I want root-cause analysis.

Do not just change the label.
Do not just hide the timestamp.
Find why this happens and fix definitively.

Clarify the data concepts:
1. project.updatedAt
   - should change only when the project itself changes
2. project.lastOpenedAt for a user
   - should be per user + per project
3. user.lastActiveAt
   - should be global user activity
4. project.modifiedAt
   - should reflect project content change, not just viewing
5. recently opened
   - should use per-user project-open event, not global user activity

Expected behavior:
1. Opening Project 1 should update only Project 1’s last opened time for that user.
2. Opening Project 1 should NOT change Project 2/3/4 last opened time.
3. Viewing a project should not update project.updatedAt unless content changed.
4. Editing project content should update only that project’s updatedAt.
5. Landing page should show correct per-project:
   - last opened, if the card says last opened
   - last updated, if the card says last updated
6. The “Recently opened” section should use actual last opened project for that user.
7. Owner name and owner activity should not affect all project timestamps.

Implementation direction:
- If needed, introduce or fix a ProjectOpen / UserProjectActivity / WorkspaceRecentActivity table:
  - userId
  - workspaceId/projectId
  - lastOpenedAt
  - lastViewedSection optional
- Use this for “recently opened.”
- Do not use user.lastActiveAt for every project card.
- Do not update project.updatedAt on simple open/view.
- Only update project.updatedAt on real project mutations.
- Check all endpoints that call updateMany or update all owner projects.
- Check frontend state update logic to avoid mapping all projects to same timestamp.

Root-cause report required:
Create:
docs/manager/project-timestamp-root-cause.md

Include:
1. where wrong timestamp came from
2. whether bug was backend or frontend
3. why all projects appeared updated/opened
4. why behavior differed for owner vs reviewer
5. what was changed
6. how each timestamp should now be used

QA:
- User has 3 projects.
- Open Project 1.
- Landing page shows only Project 1 last opened changed.
- Project 2 and Project 3 unchanged.
- Open Project 2.
- Only Project 2 last opened changes.
- Edit Project 2 content.
- Only Project 2 updatedAt changes.
- Login as reviewer/member.
- Opening shared project updates that user’s per-project open state only.
- Recently opened shows only true last opened project.
- Refresh does not corrupt times.
- Logout/login preserves correct times.

====================================================
TASK 5 — PROJECT OWNER NAME SHOULD BE DYNAMIC
====================================================

Problem:
The project owner name shown in the project should update dynamically if the owner changes their name.

Expected:
If the owner changes their name:
- the new name should appear everywhere
- project cards
- project overview
- project header
- Project Control
- Members & Permissions
- Ops project/user views
- any owner badge/name display
- chat/presence if relevant

This means do not store owner name as stale denormalized text unless it is refreshed correctly.

Requirements:
1. Prefer resolving owner display name from the current User record.
2. If denormalized ownerName exists, keep it in sync or stop using it for display.
3. Do not show stale owner names.
4. If owner name changes, invalidate/refetch relevant project queries.
5. Use displayName/name fallback logic.
6. Email should not be primary display name in normal UI unless no name exists.

QA:
- Change owner name.
- Project list updates owner name.
- Project overview updates.
- Members & Permissions updates.
- Ops views update.
- Refresh still shows new name.

====================================================
TASK 6 — SCREENING STEPS SHOULD BE CLICKABLE AS ONE UNIT WITH TITLE
====================================================

Previously I said the stepwise workflow should not be clickable because it felt like a separate confusing button.

Now I want a better version:

In Screening, the step and the title should act as one giant button.

Meaning:
- It should not feel like there are two separate navigation controls.
- The title/menu item and its step indicator/count should be one combined clickable area.
- Clicking the title or the step/count under it should take the user to the same place.

Expected:
Each Screening navigation item should include:
- title
- step number
- count/status
- connected line
- active/completed state

And the whole item is one click target.

Example:
[Import]
[Step 1 · 124 records]

Clicking anywhere on that item goes to Import.

Requirements:
1. Do not make a separate duplicate stepper navigation.
2. Combine submenu item + step indicator into one integrated navigation component.
3. Keep current good aesthetic.
4. Keep connecting line between steps.
5. Keep alignment.
6. Whole block is clickable.
7. Use correct route:
   - Import
   - Duplicates
   - Title & Abstract
   - Conflicts
   - Final Review
   - Export/Settings if included
8. Active state clearly shown.
9. Completed state clearly shown.
10. Keyboard accessible.
11. No confusion between title and stepper.
12. The click target should be large and easy.

QA:
- Click title → navigates.
- Click step number/status → same navigation.
- Active item updates.
- Counts update.
- Keyboard navigation works if feasible.
- No duplicate stepper row.

====================================================
TASK 7 — SCREENING KEYBOARD SHORTCUTS
====================================================

In Screening, add keyboard shortcuts for reviewing articles.

Default shortcuts:
- Right Arrow: next article
- Left Arrow: previous article

Also add shortcuts for:
- Include
- Exclude
- Maybe
- Undo
- Move / advance if applicable

Suggested defaults:
- I = Include
- E = Exclude
- M = Maybe
- U = Undo
- Right Arrow = Next article
- Left Arrow = Previous article

Use your judgment if better defaults exist.

Important:
These shortcuts must be user-based settings.

Users should be able to change them in User Settings / Preferences.

Requirements:
1. Add user preference section:
   - Screening shortcuts
2. Allow user to enable/disable shortcuts.
3. Allow changing keys for:
   - next article
   - previous article
   - include
   - exclude
   - maybe
   - undo
   - move/advance if implemented
4. Save per user.
5. Persist after refresh/login.
6. Do not affect other users.
7. Show shortcut hints in the Screening UI.
8. Avoid triggering shortcuts while user is typing in:
   - text input
   - textarea
   - contenteditable
   - select/dropdown
   - modal form
9. Avoid conflicts with browser/system shortcuts.
10. If duplicate shortcut keys are selected, show validation error.
11. Provide “Reset to defaults.”

Possible user settings structure:
screeningShortcuts: {
  enabled: true,
  next: "ArrowRight",
  previous: "ArrowLeft",
  include: "i",
  exclude: "e",
  maybe: "m",
  undo: "u",
  advance: "Enter" or null
}

Implementation:
- central shortcut hook:
  useScreeningShortcuts()
- route-scoped only to Screening article review pages
- respects focused input guard
- uses current user preferences

QA:
- Right arrow goes next.
- Left arrow goes previous.
- I includes.
- E excludes.
- M marks maybe.
- U undo.
- Shortcuts do nothing while typing in notes/search.
- User changes Include shortcut.
- New shortcut works.
- Old shortcut no longer works.
- Refresh preserves shortcut settings.
- Reset defaults works.

====================================================
TASK 8 — ADD BACK IMPORT PROJECT BUTTON ON APP LANDING PAGE
====================================================

Add back the Import Project button, but place it on the app landing page/project dashboard.

Expected:
On the main app landing page/project dashboard, there should be:
- Create Project
- Import Project

Import Project should allow importing project data if that feature already exists.

Requirements:
1. Do not put Import Project inside a cluttered project sidebar.
2. Put it in the landing/dashboard action area.
3. If import project backend already exists, wire to it.
4. If not fully implemented, add a safe placeholder/modal that explains supported formats only if appropriate.
5. Do not confuse this with importing references into Screening.
6. Label clearly:
   - Import Project
   not
   - Import References
7. If both are available, make distinction clear:
   - Project dashboard: Import Project
   - Screening Import tab: Import References
8. Validate imported project file.
9. Show success/error.
10. After import, open or list the imported project.
11. Permissions should be correct.
12. Do not overwrite existing projects unless user explicitly confirms.

QA:
- Landing page shows Import Project.
- Create Project still works.
- Import Project opens correct flow.
- Import does not conflict with Screening reference import.
- Imported project appears in dashboard.
- Invalid file handled safely.

====================================================
GENERAL CLEANUP
====================================================

While working, search for:
- stale ownerName usage
- user.email used instead of display name in app UI
- project updatedAt being used incorrectly
- user.lastActiveAt being mapped to project timestamp
- updateMany project timestamp bugs
- duplicate presence indicators
- hardcoded shortcut behavior
- old non-clickable stepper logic
- outdated Screening nav components

Do not make unrelated changes unless clearly necessary.

====================================================
DOCUMENTATION
====================================================

Create/update:

docs/manager/ops-active-user-metrics.md
docs/manager/project-timestamp-root-cause.md
docs/manager/dynamic-owner-display-name.md
docs/manager/screening-integrated-step-navigation.md
docs/manager/screening-keyboard-shortcuts.md
docs/manager/project-import-dashboard.md
docs/manager/app-presence-and-timestamps-final-report.md

Docs should include:
1. active/offline definition
2. country online/offline map logic
3. display name logic
4. project timestamp root cause
5. timestamp model after fix
6. dynamic owner name logic
7. integrated Screening step navigation design
8. shortcut defaults and customization
9. Import Project location and behavior
10. QA results

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:
1. Ops overview shows online/offline counts.
2. Ops users list shows online status.
3. Country endpoint returns total/online/offline by country.
4. UAE/Ukraine/USA mapping remains correct.
5. App presence shows display name, not email.
6. Opening one project updates only that project’s per-user lastOpenedAt.
7. Opening one project does not mutate all project cards.
8. Editing one project updates only that project updatedAt.
9. Owner name updates dynamically after user name change.
10. Screening integrated step item navigates when title or step/status clicked.
11. Shortcut defaults work.
12. Shortcuts ignored in text inputs.
13. User shortcut preferences persist.
14. Duplicate shortcut validation works.
15. Import Project button renders on dashboard.
16. Import Project flow opens.

Manual QA:
1. Open Ops Overview.
2. Confirm online/offline user counts.
3. Open Ops Users.
4. Confirm green pulsating dot for online user.
5. Click online user and see current project/section.
6. Hover map country and see total/online/offline.
7. Confirm country table has same info.
8. Open app project presence and confirm names, not emails.
9. Open Project 1.
10. Return to landing page.
11. Confirm only Project 1 last opened changed.
12. Confirm other projects unchanged.
13. Edit Project 2.
14. Confirm only Project 2 updatedAt changed.
15. Change owner name.
16. Confirm project owner name updates everywhere.
17. In Screening, click Import title and step/status area.
18. Confirm both navigate.
19. Use right/left arrow in Title & Abstract.
20. Use Include/Exclude/Maybe/Undo shortcuts.
21. Confirm shortcuts do not fire while typing notes/search.
22. Change shortcut settings and confirm new keys work.
23. Open landing page and confirm Import Project button.
24. Test Import Project flow.
25. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.
This is likely a minor version because it includes Ops analytics, timestamp data correctness, owner display logic, shortcuts, and import project UX.

2. Update version metadata.

3. Run tests.

4. Run build.

5. Commit.

Suggested commit message:
feat: improve ops activity, project timestamps, and screening shortcuts

Alternative:
fix: correct project timestamps and add active user analytics

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

1. Ops online/offline metric implementation.
2. Country map/table online/offline implementation.
3. User list online indicator behavior.
4. Clicked-user activity details behavior.
5. App display name changes.
6. Root cause of all projects showing same opened/updated time.
7. Timestamp model after fix.
8. Recently opened behavior after fix.
9. Dynamic owner name implementation.
10. Integrated Screening step navigation changes.
11. Keyboard shortcut defaults.
12. User shortcut settings.
13. Import Project button implementation.
14. Backend changes.
15. Frontend changes.
16. Database/migration changes if any.
17. Security/privacy decisions.
18. Tests added.
19. Manual QA results.
20. Build/test results.
21. Version bump and new version.
22. Commit hash.
23. Push status.
24. Known limitations.
25. Recommended next steps.

Claude, this one needs careful thinking.

Especially the project timestamp bug:
dig deep, find the real cause, and fix it definitively.

Make Ops show real active/offline users.
Make the app show names, not emails.
Make owner names dynamic.
Make Screening navigation feel like one integrated click target.
Make shortcuts customizable per user.
Bring Import Project back to the dashboard.