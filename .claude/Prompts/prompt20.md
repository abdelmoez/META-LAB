CLAUDE OPUS — FIX SCREENING ROUTES, HEADER OVERLAP, PROJECT CHAT TITLE, FOREST PLOT LABELS, USER DATA EDITING, AND OPS WORLD MAP

Claude, I want you to fix the latest issues from the app after the Screening overhaul and Ops map update.

This is not a redesign-from-zero task. This is a focused repair and polish pass, but I want you to still inspect carefully before changing code.

Use Opus as the lead. Assign simple UI/code/test tasks to Sonnet if useful.

Do not ask me small questions.
Inspect the current implementation.
Find the root cause.
Fix safely.
Run tests/build.
Version, commit, and push if safe.

====================================================
TASK 1 — SCREENING SUBMENU STILL DOES NOT WORK
====================================================

Problem:
Inside the Screening tab, the submenu still does not actually work.

When I click the Screening submenu buttons:

- Overview
- Import
- Duplicates
- Title & Abstract
- Conflicts
- Full Text
- Settings
- Export

The browser link changes, but the page content does not change and sometimes nothing shows.

This means routing/state/rendering is broken.

Expected:
Clicking each submenu item should update both:
1. the URL
2. the displayed Screening subpage content

Routes should deep-link correctly.

Preferred route structure:
- /projects/:workspaceId/screening/overview
- /projects/:workspaceId/screening/import
- /projects/:workspaceId/screening/duplicates
- /projects/:workspaceId/screening/title-abstract
- /projects/:workspaceId/screening/conflicts
- /projects/:workspaceId/screening/full-text
- /projects/:workspaceId/screening/settings
- /projects/:workspaceId/screening/export

But inspect the current routing system first and adapt safely.

Check for:
- route path mismatch
- active tab state not synced with URL
- using query/hash route but rendering expects state
- workspaceId vs screeningEngineId confusion
- nested route outlet not rendering
- stale component still using old META·SIFT project route
- conditional rendering blocking content
- permissions state incorrectly hiding subpages
- wrong switch/case mapping
- missing default redirect from /screening to /screening/overview
- links using href correctly but component not reading params
- layout wrapper not rendering children
- CSS overlay hiding content

Fix requirements:
1. /screening redirects or defaults to Overview.
2. Every submenu button renders the correct page.
3. Active tab styling updates.
4. Refreshing a sub-route keeps the same page.
5. Browser back/forward works.
6. No blank page.
7. No old META·SIFT user-facing name appears.
8. If internal screening engine is missing, auto-prepare/repair it safely.
9. Add tests for route rendering if possible.

Manual QA:
- Click every submenu.
- Refresh every submenu URL.
- Use browser back/forward.
- Confirm correct content appears every time.

====================================================
TASK 2 — TOP-RIGHT BUTTONS OVERLAP PROJECT NAVIGATION
====================================================

Problem:
The top-right buttons are overlapping with the Project Overview / Projects buttons.

Affected top-right buttons:
- Chat
- Notifications
- User/account menu

They overlap with:
- Project Overview
- Projects
- possibly project breadcrumbs/navigation buttons

Expected:
The top header should never overlap.

Fix layout properly, not with random margin hacks.

Requirements:
1. Top-right utility cluster should have reserved space.
2. Project navigation/breadcrumbs should truncate or wrap gracefully.
3. Long project names should not push into buttons.
4. Header should work on desktop and smaller screens.
5. Chat, notification, and user buttons should remain clickable.
6. Project Overview / Projects buttons should remain clickable.
7. Use flex layout correctly:
   - min-width: 0 where needed
   - flex-shrink/flex-grow intentionally
   - overflow-hidden/ellipsis for long titles
   - no absolute positioning unless necessary
8. Test in day and night themes.
9. Test with long project names.

Preferred structure:
- left: breadcrumb / Back to Projects / Project Overview
- center: optional project title, truncating
- right: fixed utility cluster with Chat, Notifications, User

Do not allow the center/left area to cover the right controls.

====================================================
TASK 3 — CHAT TITLE SHOULD BE PROJECT NAME
====================================================

Problem:
In Chat, I want the chat title to clearly show the project name so users know which project they are chatting in.

Also, it must not overlap with close button or chat controls.

Expected:
Chat drawer/modal title should be:

<Project Name>

or:

Chat — <Project Name>

Choose the cleaner design.

Requirements:
1. Chat title uses the current Review Project name.
2. If the project name is long, truncate with ellipsis.
3. Add tooltip/title attribute with full project name if possible.
4. Do not overlap close button.
5. Do not overlap notification/user buttons.
6. If project name is missing/loading, show:
   - Project chat
   - or Loading project chat…
7. Chat messages should still load correctly.
8. Shared project chat should remain scoped to the current project/workspace.
9. No chat from another project should appear.

Preferred header layout:
- left: chat title/project name
- right: close button
- title area uses min-width:0 and text-overflow ellipsis

Manual QA:
- Open chat from a project.
- Confirm title shows project name.
- Test long project name.
- Confirm close button is clickable.
- Switch projects and confirm chat title changes.

====================================================
TASK 4 — FOREST PLOT SMD LABEL OVERLAPS FAVOURS AXIS LABELS
====================================================

Problem:
In the live Forest Plot, the SMD/effect size label overlaps with:

← favours   favours →

Also, the favours labels are not in the right place.

This is a live website display issue.

Expected:
The live forest plot should be readable and properly spaced.

Fix:
1. SMD/effect-size axis label should not overlap with favours labels.
2. Favours labels should be positioned correctly at the bottom/axis region.
3. There should be enough vertical margin between:
   - plot axis
   - effect size label
   - favours-left/favours-right labels
4. Text should not collide on small widths.
5. Long labels should not overlap the plot.
6. Live plot should match preview/export quality where possible.
7. Do not break export or preview, because they were working.
8. Keep theme support from the previous fix:
   - day theme uses light plot style
   - night theme uses dark plot style
9. Keep selected decimal precision.

Implementation guidance:
- Inspect live forest plot component separately from export/preview.
- Check bottom margin and SVG/canvas text placement.
- Increase bottom padding/margin if needed.
- Use separate y positions:
  - x-axis ticks
  - effect measure label, e.g. SMD
  - favours labels
- Consider placing “SMD” under the x-axis centered, and “← favours control” and “favours treatment →” below that or vice versa, but never overlapping.
- If there are configurable group labels, use those correctly.
- Add responsive spacing for narrow containers.

Manual QA:
1. SMD forest plot in day mode.
2. SMD forest plot in night mode.
3. OR/RR/HR forest plots if available.
4. Long study names.
5. Narrow container.
6. Export still works.
7. Preview still works.

====================================================
TASK 5 — OPS CONSOLE USER MENU SHOULD EDIT ALL USER DATA FIELDS
====================================================

Problem:
In Ops Console, user editing is incomplete.

I want admins to be able to change everything in user data from the user menu, except password.

Password reset email flow is already there. Do not break it. Do not replace it. Do not change the sent reset password email behavior.

Expected:
Any user data field that exists in the database and is safe/admin-editable should be editable from the Ops user menu.

This includes newly added user fields.

For example:
- name
- email if allowed
- role if allowed
- status
- active/disabled
- country fields if safe
- registrationCountryCode if admin-editable
- registrationCountryName if admin-editable
- institutional fields if any
- app/user settings if applicable
- any new feature fields added to the user model that should be editable

Important:
Use judgment. Do not expose unsafe/internal fields blindly.

Do NOT allow editing:
- password hash
- reset tokens
- raw security tokens
- session tokens
- OAuth provider IDs if any
- audit log IDs
- internal IDs unless read-only
- createdAt unless there is a strong reason
- raw IP if any
- secrets
- security-sensitive fields

Password:
- Keep current reset-password-email flow exactly as-is.
- Do not add manual password editing.
- Do not show password hash.

Permissions:
1. Admin can edit ordinary users and mods according to current policy.
2. Mod can edit only what current mod policy allows.
3. Mod must not edit admins.
4. Mod must not edit other mods if that is the current policy.
5. Users cannot edit other users.
6. Backend must enforce all restrictions.

UX:
1. User details drawer/modal should show editable fields clearly.
2. Use safe form controls:
   - text inputs
   - dropdowns
   - switches
   - read-only fields where needed
3. Add save/cancel.
4. Add validation.
5. Show success/error toast.
6. Update table after save.
7. Add audit log:
   - USER_UPDATED_BY_ADMIN
   - include changed fields, but do not log sensitive values.

Dynamic/future-friendly approach:
If possible, create a central editable user profile schema/config:
- field name
- label
- type
- editableByAdmin
- editableByMod
- validation
- sensitive
- readOnly

So future user fields can be added in one place and appear in the user edit menu safely.

QA:
- Admin edits safe user field.
- Admin cannot edit password.
- Reset password email still works.
- Mod cannot edit admin/mod.
- Invalid email rejected if email editable.
- User table refreshes.
- Audit log created.
- Sensitive fields are never exposed.

====================================================
TASK 6 — OPS WORLD MAP SHOULD BE A REAL FULL WORLD MAP
====================================================

Problem:
The newly added world map does not visibly show a real world map.

I want a real map of all countries in the world.

Expected:
In Ops Console → Users tab, show a real interactive world map.

Design:
1. The map should be large.
2. It should take the whole map container.
3. The table should not squeeze the map.
4. Put the table in another tab.
5. Countries should have visible borders.
6. Borders should be light gray.
7. Countries should be shaded by user percentage.
8. More users from a country = closer to the app’s main accent color.
9. Fewer users = lighter shade.
10. No users = white/light neutral.
11. Theme/accent changes should update the map.
12. Map should work in day and night themes.

Layout:
Users tab should have sub-tabs or toggle:
- Map
- Countries Table

Map tab:
- large real world map
- fills available container width/height
- tooltips on hover:
  - country name
  - users
  - percentage
- optionally click country to select/highlight

Countries Table tab:
- ranked table by user count descending
- columns:
  - Rank
  - Country
  - Users
  - Percentage
  - Latest registration if available

Map technical requirements:
1. Use a real country GeoJSON/TopoJSON dataset or a reliable map library.
2. Show all countries.
3. Country boundaries must be rendered.
4. Border/stroke color: light gray.
5. Stroke width should be visible but subtle.
6. The fill scale should use app accent color.
7. If no data, render world map in neutral state with empty message.
8. If geolocation unknown, show Unknown in summary/table, not as a country.
9. Do not expose raw IP.
10. Do not make map tiny.
11. Make it responsive.

Possible implementation choices:
- If a map library is already installed, use it.
- If not, choose a lightweight approach:
  - react-simple-maps + world-atlas/topojson-client
  - or a bundled GeoJSON world countries file
- Avoid extremely heavy dependencies unless justified.
- If dependency added, document why.

Data:
Endpoint should return:
- countryCode
- countryName
- userCount
- percentage
- latestRegistrationAt optional

Frontend should map countryCode to GeoJSON ISO code.

Important:
Different GeoJSON files may use ISO_A2, ISO_A3, NAME, ADMIN, id, etc.
Normalize properly.
Do not silently fail because codes do not match.

QA:
1. Map visibly renders all countries.
2. Countries have light gray borders.
3. Countries with users are colored.
4. Countries with no users are neutral.
5. Tooltip works.
6. Table tab works.
7. Map resizes correctly.
8. Accent color change updates map colors.
9. Day/night themes look good.
10. Unknown country users appear in summary/table.
11. Unauthorized users cannot access endpoint.

====================================================
GENERAL CLEANUP
====================================================

While fixing these, also check for:
- broken links from prior Screening overhaul
- stale META·SIFT user-facing labels
- linked/unlinked text
- old route references
- layout overflow
- z-index collisions
- mobile/tablet behavior if feasible

Do not make huge unrelated changes unless necessary.

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:
1. Screening subroute renders correct component.
2. /screening redirects to /screening/overview.
3. Active submenu state matches URL.
4. Header utility buttons do not overlap in layout if testable.
5. Chat title uses project name.
6. User edit endpoint blocks password/security fields.
7. Admin can edit safe user fields.
8. Mod restrictions enforced.
9. World map endpoint returns country data.
10. Unauthorized users blocked from country data endpoint.
11. Forest plot live component receives theme/spacing props correctly if testable.

Manual QA:
1. Open Screening.
2. Click every submenu.
3. Confirm page content changes.
4. Refresh each submenu URL.
5. Test browser back/forward.
6. Check top-right Chat/Notifications/User buttons do not overlap project nav.
7. Open Chat and confirm title is current project name.
8. Test long project title in chat.
9. Check Forest Plot SMD axis/favours labels.
10. Check forest plot in day and night themes.
11. Confirm export/preview still work.
12. Open Ops → Users.
13. Edit safe user fields.
14. Confirm password reset email flow still works.
15. Confirm sensitive fields are not editable.
16. Open Ops Users map.
17. Confirm real full world map appears.
18. Confirm table is in separate tab.
19. Confirm country borders are light gray.
20. Confirm colors follow app accent color.
21. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.
This is likely a patch or minor depending on scope.
Use your judgment.

2. Update version metadata.
3. Run tests.
4. Run build.
5. Commit.

Suggested commit message:
fix: repair screening navigation and ops user map

Alternative:
fix: polish screening workflow, forest plot, and ops users

6. Push to the current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- .env
- raw local DB files
- junk files
- broken artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Root cause of Screening submenu not rendering content.
2. How you fixed Screening routing/state.
3. Header overlap root cause and fix.
4. Chat title behavior and project scoping.
5. Forest Plot SMD/favours label fix.
6. Ops user edit improvements.
7. Confirmation password reset email flow was preserved.
8. World map implementation details.
9. How country code mapping works.
10. Map/table UX.
11. Theme/accent behavior for map.
12. Backend changes.
13. Frontend changes.
14. Database changes if any.
15. Security/privacy decisions.
16. Tests added.
17. Manual QA results.
18. Build/test results.
19. Version bump and new version.
20. Commit hash.
21. Push status.
22. Known limitations.
23. Recommended next steps.

Claude, fix the root causes, not just the symptoms.
Make the Screening submenu actually render.
Make the header clean.
Make chat clearly project-scoped.
Make the forest plot readable.
Make user editing complete but safe.
Make the Ops map a real world map.