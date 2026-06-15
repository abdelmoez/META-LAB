CLAUDE OPUS — LANDING PAGE CLEANUP, UNIVERSAL PROJECT HEADER, PROJECT-WIDE PRESENCE, SCREENING LAYOUT FIXES, AND MEMBER UI CONSISTENCY

Claude, I want you to understand what I am asking here before you implement anything.

This is a UX cleanup and consistency update. The app is becoming powerful, but I need it to feel simpler, more stable, and less cluttered. Some of the new collaboration/presence features are working in one place but not globally, and some layout elements are being hidden or pushed off-screen.

Use Opus as the lead architect. Use Sonnet for straightforward UI edits, tests, and cleanup if useful.

Do not ask me small questions.
Inspect the current implementation first.
Find the root causes.
Then implement the best version using your product judgment.

====================================================
HIGH-LEVEL GOAL
====================================================

I want the app to feel consistent across the whole project.

The project header / breadcrumb / active users / chat / notifications should behave the same everywhere, not only inside Screening.

The Screening page should not push important controls off-screen.

The landing page should be simpler.

The Members & Permissions UI should be consistent between Screening Settings and the main Project Control.

====================================================
TASK 1 — CLEAN UP APP LANDING PAGE / PROJECT DASHBOARD
====================================================

On the main app landing page / project dashboard:

1. “Recently opened” should show only the last opened project.

Current problem:
It may be showing more than one recently opened project.

Expected:
- Show only the most recently opened project.
- Keep it clean and compact.
- If no project has been opened yet, show a simple empty state or hide the section.

2. Remove these filters:
- Recent
- Shared with me

Reason:
They clutter the filter area and are not needed right now.

3. Remove “In Progress” from the top.

Reason:
The top area is getting cluttered. Keep the dashboard simple.

Requirements:
- Do not remove the ability to access shared projects if the user has them.
- Do not delete project data.
- Do not break sorting/search.
- Do not break the project cards/table.
- Keep useful filters only, such as:
  - All
  - Owned by me
  - Archived, if implemented
  - Needs attention, if implemented and useful
  - Completed, if implemented and useful
Use your judgment.

QA:
- Landing page shows only one recently opened project.
- Recent filter is gone.
- Shared with me filter is gone.
- In Progress top item is gone.
- Shared projects still appear in the project list if the user has access.
- Sort/search still works.

====================================================
TASK 2 — PROJECT-WIDE REAL-TIME PRESENCE, NOT ONLY SCREENING
====================================================

The real-time presence feature currently works best inside Screening, where it shows something like:

online number / total members

I want this feature to work across the entire project, not only Screening.

It should be available in:
- Project Overview
- PICO / Protocol
- Screening
- Data Extraction
- Analysis
- PRISMA
- Report / Export
- Project Control / Settings
- Any other project page

Expected:
There should be one consistent active-users indicator in the universal project header.

It should show:
- active online users in this project
- total members in this project

Example:
- 2 / 6
- or “2 active / 6 members”
- choose the best clean UI

When hovering or clicking:
Show a dropdown/popover listing:
- active user name
- current location in the project
  - Project Overview
  - PICO
  - Screening > Import
  - Screening > Title & Abstract
  - Screening > Final Review
  - Data Extraction
  - Analysis
  - PRISMA
  - Project Control
- optionally last active time
- optionally if they are editing a field

Important:
This must be project-wide presence, not Screening-only presence.

Implementation:
- Reuse the working Screening presence indicator if it is the best implementation.
- Remove the broken/non-responsive presence indicator beside notifications if it is duplicative or unreliable.
- Replace it with the working style from Screening.
- There should be one consistent project presence component reused everywhere.

Suggested component:
ProjectPresenceIndicator

It should be placed in the universal project header near:
- chat
- notifications
- user menu

But it must not overlap other buttons.

====================================================
TASK 3 — FIX PRESENCE DROPDOWN / POPOVER Z-INDEX AND HOVER BEHAVIOR
====================================================

Problem:
When hovering over the active users count, the dropdown list is hidden under other screens or clipped under the navbar. It behaves like it is trapped inside the navbar container and cannot overflow.

Also:
When I move the cursor from the active count toward the dropdown, it disappears completely, so I cannot actually use it.

Expected:
The presence dropdown/popover should:
1. Appear above all page content.
2. Not be clipped by the navbar or parent containers.
3. Not hide behind other screens.
4. Stay visible when moving cursor from the count to the dropdown.
5. Close only when:
   - mouse leaves both trigger and dropdown, with slight delay
   - user clicks outside
   - user presses Escape
6. Work in day and night themes.
7. Work on smaller screens.

Root causes to inspect:
- parent container has overflow hidden
- navbar z-index too low
- popover rendered inside clipped container
- hover state only on trigger, not trigger + content
- no portal
- absolute positioning inside wrong stacking context
- collision detection missing

Preferred fix:
Use a proper Popover/Dropdown component rendered in a portal if available.

Requirements:
- high enough z-index
- collision handling
- offset from trigger
- hover/focus safe behavior
- accessible keyboard behavior if possible

QA:
- Hover active users count.
- Dropdown appears fully above content.
- Move cursor into dropdown; it stays visible.
- Click/hover user list.
- Dropdown does not overlap incorrectly with Project Overview / Projects buttons.
- Dropdown closes on outside click/Escape.
- Works on Project Overview, Screening, PICO, Data Extraction.

====================================================
TASK 4 — FIX OVERLAP WITH PROJECT HEADER NAVIGATION
====================================================

There was a prior issue where the active users / chat / notification / user buttons overlap with:

- Project Overview
- Projects
- breadcrumb/project title
- top navigation buttons

I want the universal header to be stable.

Expected header structure:
- left: menu icon / project title / breadcrumb
- middle: current section or project navigation if needed
- right: active users, chat, notifications, user menu

The right-side utility cluster must have reserved space and must not be covered by project title or nav.

Requirements:
1. Use proper flex layout.
2. Use min-width: 0 for the title/breadcrumb region.
3. Long project names should truncate with ellipsis.
4. Right utility cluster should not shrink below usable width.
5. Buttons must stay clickable.
6. Presence indicator must not overlap chat/notifications/user menu.
7. On smaller screens, use responsive fallback:
   - collapse text labels
   - keep icons
   - truncate project title
   - optionally move some nav into menu

QA:
- Long project title.
- Small screen.
- Project Overview page.
- Screening page.
- Data Extraction page.
- Presence dropdown open.
- No overlap.

====================================================
TASK 5 — SCREENING PAGE: CONTROLS ARE OUT OF SCREEN
====================================================

Problem:
In Screening, some controls are pushed out of the visible screen downward.

Examples:
- “← Previous 1 / 50 (of 638) Next →” is out of the screen and I cannot see it.
- “Load more (588)” in the left menu of studies is also out of the screen.

This makes Screening hard to use.

Expected:
Important controls should always be visible or reachable without being cut off.

Affected areas:
- Screening → Title & Abstract
- left studies list
- pagination controls
- load more button
- bottom navigation controls
- maybe other Screening subpages with tall layouts

Requirements:
1. Fix vertical layout so the page uses available height correctly.
2. Avoid content being hidden below the viewport.
3. Use scroll containers intentionally:
   - left studies list scrolls internally
   - main abstract/review panel scrolls internally if needed
   - bottom pagination/action bar remains visible if appropriate
4. “Load more” should be visible at the bottom of the studies list or in a sticky footer within the list.
5. Previous/Next controls should be visible:
   - sticky bottom action bar
   - or placed above content if better
6. Avoid double-scroll confusion.
7. Make layout responsive.
8. Do not hide study content.
9. Do not break keyboard/mouse navigation.

Suggested layout:
- Screening workspace height: calc viewport minus header/nav/stepper.
- Left list:
  - header/search/filter fixed
  - list scrolls
  - Load more sticky at bottom
- Main panel:
  - content scrolls
  - previous/next controls sticky at bottom or top-right
- Avoid page-level overflow trapping important controls.

QA:
- Open Title & Abstract with many records.
- Load more button is visible/reachable.
- Previous/Next controls visible.
- Scroll list and main panel.
- No controls hidden below screen.
- Works at common laptop height.
- Works in day and night themes.

====================================================
TASK 6 — COPY MEMBERS STYLE FROM SCREENING SETTINGS TO MAIN PROJECT CONTROL
====================================================

Problem:
The members UI in Screening Settings looks better than the Members & Permissions UI in the main Project Control.

I want the same style copied/adapted to:

Project Control → Members & Permissions

Expected:
The main Project Control members UI should use the same polished style as Screening Settings.

Requirements:
1. Use same visual grouping:
   - Owner
   - Leaders
   - Members
   - Viewers if applicable
2. Owner always top.
3. Leaders next.
4. Members next.
5. Subtle separation between groups.
6. Consistent role badges.
7. Consistent action buttons.
8. Consistent active/online location indicators if presence is implemented.
9. Consistent permission summary.
10. Consistent edit/remove controls.
11. Do not duplicate logic unnecessarily; reuse a shared component if possible.

Preferred:
Create a shared component:
ProjectMembersPanel
or
MembersPermissionsList

Use it in:
- Screening Settings
- Main Project Control → Members & Permissions

This avoids two different designs drifting apart.

QA:
- Screening Settings members still look good.
- Project Control Members & Permissions now matches style.
- Role actions still work.
- Owner/Leader/Member grouping works.
- Presence status appears consistently if added.

====================================================
TASK 7 — UNIVERSAL PROJECT HEADER ACROSS ALL PROJECT PAGES
====================================================

I want this header/context to stay universal across all project pages:

[ ☰
The Super test for screening.
▸
Screening
Project overview
Projects
]

Meaning:
The project context/header/breadcrumb/navigation should be consistent everywhere in the project.

I do not want it to appear only in Screening or disappear on some pages.

Expected:
Across all project pages, show a consistent universal project header that includes:
- menu icon
- project title
- current section breadcrumb
- Project Overview link
- Projects / Back to Projects link
- right utility cluster:
  - active users indicator
  - chat
  - notifications
  - user menu

The exact visual layout can be improved, but the function should remain universal.

Requirements:
1. Header appears on:
   - Project Overview
   - PICO
   - Screening
   - Data Extraction
   - Analysis
   - PRISMA
   - Report/Export
   - Project Control
2. Header uses same component across project pages.
3. Header does not overlap content.
4. Header does not fight with Screening submenu.
5. Header shows current section accurately.
6. “Projects” or “Back to Projects” navigates to main project landing page.
7. “Project Overview” navigates to current project overview.
8. Project title truncates if long.
9. Active users/chat/notification/user menu are on the right.
10. Header should remain clean and responsive.

Important:
Earlier I asked to remove redundant “Projects” from the left panel. That still stands.
But the universal header can still have a clean Projects / Back to Projects link, because users need a way to return to the project landing page.

Do not confuse:
- Remove Projects from the left panel/sidebar.
- Keep a clean Projects/Back to Projects link in the universal header.

====================================================
TASK 8 — REMOVE DUPLICATE OR BROKEN PRESENCE INDICATOR
====================================================

There are currently two presence-related ideas:
1. One beside notifications, but it is not responsive to user location.
2. One in Screening that works better and shows online number / total members.

I suggest:
- remove the broken one beside notifications
- replace it with the working Screening-style one
- make that component universal

Expected:
One single source of truth for active project presence.

Requirements:
1. No duplicate presence indicators.
2. Presence updates location across project pages.
3. Location updates on route change.
4. Presence list visible in popover.
5. Works globally.
6. Does not overlap header.

====================================================
TASK 9 — PRESENCE LOCATION TRACKING
====================================================

The active user list should show where each member currently is inside the project.

Location examples:
- Project Overview
- PICO
- Screening > Overview
- Screening > Import
- Screening > Duplicates
- Screening > Title & Abstract
- Screening > Conflicts
- Screening > Final Review
- Screening > Settings
- Screening > Export
- Data Extraction
- Analysis
- PRISMA
- Report & Export
- Project Control > Members & Permissions

Requirements:
1. Derive location from route.
2. Update location on route change.
3. Heartbeat updates backend.
4. Active users expire after inactivity.
5. Do not show users as active forever.
6. Popover uses latest location.
7. Members & Permissions also shows location/status.
8. Available to everyone inside the project.

QA:
- Open project as two users.
- User A in Screening > Duplicates.
- User B sees User A location correctly.
- User A moves to Data Extraction.
- User B sees location update.
- User A closes tab.
- User A disappears after timeout or becomes inactive.

====================================================
GENERAL CLEANUP
====================================================

While doing this, search for and clean up:
- old broken presence component
- duplicated presence hooks
- header layout hacks
- z-index issues
- overflow-hidden clipping popovers
- stale references to removed filters
- landing page clutter
- inconsistent member UI
- project header inconsistencies

Do not make huge unrelated changes unless needed.

====================================================
DOCUMENTATION
====================================================

Create/update:

docs/manager/project-dashboard-cleanup.md
docs/manager/project-presence-globalization.md
docs/manager/universal-project-header.md
docs/manager/screening-layout-overflow-fix.md
docs/manager/members-permissions-ui-unification.md
docs/manager/project-ux-polish-final-report.md

Docs should include:
1. Landing page changes.
2. Removed filters.
3. Recently opened behavior.
4. Universal project header structure.
5. Presence component architecture.
6. Popover z-index/portal fix.
7. Screening layout height/overflow fix.
8. Members UI shared component.
9. Known limitations.
10. QA results.

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:
1. Recently opened shows only one project.
2. Removed filters are not rendered.
3. In Progress top item removed.
4. Universal project header renders on all project pages.
5. Presence indicator renders globally.
6. Presence popover can render outside clipped containers.
7. Presence location changes with route.
8. Duplicate/broken presence indicator removed.
9. Screening pagination controls are visible.
10. Load more button is visible/reachable.
11. Project Control members UI uses shared grouped component.
12. Back to Projects works.
13. Project Overview link works.

Manual QA:
1. Open app landing page.
2. Confirm Recently opened shows only the last project.
3. Confirm Recent filter is gone.
4. Confirm Shared with me filter is gone.
5. Confirm In Progress top item is gone.
6. Open a project.
7. Confirm universal project header appears.
8. Open Project Overview.
9. Open PICO.
10. Open Screening.
11. Open Data Extraction.
12. Open Project Control.
13. Confirm header remains consistent.
14. Confirm Projects/Back to Projects works.
15. Confirm active users indicator appears globally.
16. Hover/click active users indicator.
17. Confirm dropdown is not clipped or hidden.
18. Move cursor into dropdown and confirm it stays open.
19. Confirm active user location is correct.
20. Confirm no overlap with Project Overview / Projects buttons.
21. Open Screening → Title & Abstract.
22. Confirm Previous/Next controls are visible.
23. Confirm Load more button is visible.
24. Open Project Control → Members & Permissions.
25. Confirm it matches Screening Settings members style.
26. Test long project title.
27. Test smaller screen.
28. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.
This is likely a patch or minor version depending on how much shared component work is needed.

2. Update version metadata.

3. Run tests.

4. Run build.

5. Commit.

Suggested commit message:
fix: unify project presence and clean dashboard layout

Alternative:
fix: stabilize universal project header and screening layout

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact error.

Do not commit:
- secrets
- .env
- raw database files
- junk files
- broken generated artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Landing page cleanup changes.
2. Recently opened behavior.
3. Removed filters/top items.
4. Universal project header implementation.
5. Project-wide presence implementation.
6. Removed/replaced broken presence indicator.
7. Presence popover z-index/hover fix.
8. Presence location tracking.
9. Screening overflow/layout fix.
10. Previous/Next visibility fix.
11. Load more visibility fix.
12. Members UI unification.
13. Backend changes.
14. Frontend changes.
15. Database/migration changes if any.
16. Tests added.
17. Manual QA results.
18. Build/test results.
19. Version bump and new version.
20. Commit hash.
21. Push status.
22. Known limitations.
23. Recommended next steps.

Claude, I want your judgment here.

Make the app cleaner.
Make presence universal and reliable.
Make the popover usable.
Make the Screening page stop hiding important controls.
Make the header consistent everywhere.
Reuse the best working component instead of keeping duplicate broken ones.