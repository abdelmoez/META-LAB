CLAUDE MAX — ROLE, LINKED PROJECT ACCESS, VERSIONING, GLOBAL ACCOUNT MENU, AND OPS MESSAGE FIXES

Goal:
Fix the remaining role/permission confusion and improve linked META·LAB / META·SIFT project behavior.

Do NOT rebuild the app from scratch.
Do NOT wipe/reset the database.
Do NOT remove working features.
This is a targeted follow-up task.

Use the same team:
1. Main Claude — Overall Manager / Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. QA Developer
6. Website Manager / Public Website Agent
7. Collaboration & Realtime Agent

Primary agents:
- Main Claude
- Backend, Auth & Database Developer
- Frontend App Developer
- Collaboration & Realtime Agent
- QA Developer

Autonomy:
Do not ask me small questions.
Make the best decisions, implement, test, document, and report.
Only stop if blocked by missing credentials, missing files, or a serious security issue.

====================================================
TASK 1 — SEPARATE OWNER FROM LEADER EVERYWHERE
====================================================

Problem:
Owner and leader are still confusing. I want owner and leader separated clearly in names, permissions, UI, database/API labels, and documentation.

Definitions:

Owner:
- The original project owner unless ownership transfer is implemented.
- Has ultimate control.
- Cannot be edited by leaders or members.
- Cannot be removed by leaders or members.
- Cannot have permissions/status changed by leaders or members.
- Owner controls ownership-level decisions.

Leader:
- Can manage the project workflow and ordinary members.
- Can add members if permitted.
- Can manage member roles/status if permitted.
- Cannot change owner.
- Cannot remove owner.
- Cannot change owner permission.
- Cannot change owner status.
- Cannot transfer ownership.
- Cannot demote owner.
- Cannot change another leader’s permissions/status unless owner policy allows it.

Member:
- Can only act according to assigned permissions.

Viewer/read-only:
- Can view only what permissions allow.

Requirements:
1. Rename “creator” to “owner” everywhere.
2. Do not use creator/leader interchangeably.
3. Project cards should show:
   - Owner
   - Leaders if any
   - Current user role
4. Project settings should clearly separate:
   - Owner
   - Leaders
   - Members
   - Viewers/read-only
5. Backend APIs should return owner and leaders as separate fields.
6. Docs should define owner vs leader clearly.

====================================================
TASK 2 — HIDE PERMISSION ACTIONS FOR OWNER AND LEADER ROWS
====================================================

Requirement:
If the listed member is the Owner, do not show options to change their role, permissions, or status.

If the listed member is a Leader, do not show options to change their permission/role/status unless the current user is the Owner and the policy allows it.

For normal leaders:
- Do not show controls that allow them to change:
  - owner role
  - owner permissions
  - owner status
  - leader role
  - leader permissions
  - leader status

For normal members:
- Do not show controls to change anyone’s role, permissions, or status.

UI rules:
1. Owner row should be locked.
2. Leader row should be locked unless current user is Owner and editing leaders is allowed.
3. Members can be edited by Owner/Leader if permission allows.
4. Viewer/read-only can be edited by Owner/Leader if permission allows.
5. If a user cannot edit a row, do not show edit buttons, role dropdowns, permission toggles, remove buttons, or status dropdowns.
6. Optionally show a small lock icon and tooltip:
   - “Owner permissions cannot be changed here.”
   - “Only the owner can change leader permissions.”
7. Enforce the same rules server-side. Do not rely only on hidden UI.

Backend requirements:
1. Permission update endpoint must reject invalid edits.
2. Leader cannot edit owner.
3. Member cannot edit anyone.
4. Leader cannot edit leader unless policy allows.
5. Owner cannot accidentally remove themselves unless ownership transfer flow exists.
6. Add audit logs for permission changes.

====================================================
TASK 3 — DISPLAY DATE PROJECT WAS ADDED/CREATED
====================================================

Requirement:
Project lists/cards should display the date the project was added/created.

Show:
- Created date
- Last updated date if available

Apply to:
- META·LAB project list
- META·SIFT project list
- linked project cards
- admin/ops project tables if relevant

Use readable format:
- Jun 9, 2026
or similar.

Backend:
Make sure createdAt and updatedAt are returned.

Frontend:
Render dates consistently.

====================================================
TASK 4 — FIX LINKED PROJECT MEMBER ACCESS
====================================================

Problem:
It is confusing when META·LAB and META·SIFT projects are linked. If projects are created and linked, or linked later, all members should have access to the project in both apps according to their permissions.

Expected behavior:
If I add a member to a linked Review Workspace:
1. They should see the META·LAB project if they have META·LAB permission.
2. They should see the META·SIFT project if they have META·SIFT permission.
3. Their role and permissions should apply consistently across both apps.
4. If projects are linked later, member access should sync/merge correctly.
5. No one should lose access accidentally.
6. No one should gain access beyond their permissions.

Backend requirements:
1. ReviewWorkspace should be the shared source of truth for membership when META·LAB and META·SIFT are linked.
2. Adding a member to a linked workspace should make them visible in both modules according to permissions.
3. Project queries must include:
   - projects owned by user
   - projects where user is active member
   - projects where user has module permission
4. META·LAB project list must include projects the user is a member of, not only owner.
5. META·SIFT project list must include projects the user is a member of, not only owner.
6. If a user is read-only, they should see the project but not edit restricted areas.
7. If a user has only META·SIFT permission, they should not access META·LAB editing.
8. If a user has only META·LAB permission, they should not access META·SIFT screening.
9. Add migration/repair script if existing linked projects have members but access is broken.

Frontend requirements:
1. In project lists, show user’s role/permission:
   - Owner
   - Leader
   - Reviewer
   - Data Extractor
   - Viewer
   - Read-only
2. Disable actions according to permissions.
3. Show clear empty states:
   - “No projects you own or have been added to.”
4. If member is added in META·LAB, they should be visible in META·SIFT if linked and permission allows.
5. If member is added in META·SIFT, they should be visible in META·LAB if linked and permission allows.

QA:
Test adding a member and confirming project appears in both apps.

====================================================
TASK 5 — ADD META·SIFT PROJECT CONTROL TAB
====================================================

Requirement:
In META·SIFT, add a project control/settings tab where it fits best.

Suggested tab name:
Project Control

or:
Settings

This tab should include:
1. Members
2. Add member
3. Remove/deactivate member if permitted
4. Role management
5. Permission management
6. Link/unlink META·LAB project
7. Linked project information
8. Project status
9. Blind mode setting
10. Chat permissions
11. Screening permissions
12. Second review permissions
13. Import/export permissions if relevant

Visibility:
- Owner sees full controls.
- Leaders see allowed controls but cannot edit owner.
- Members see read-only project info if allowed.
- Viewers/read-only see limited info.

This should make META·SIFT project management clear and not scattered across random screens.

====================================================
TASK 6 — WHENEVER MEMBER IS ADDED, SYNC ACCESS CORRECTLY
====================================================

Interpretation:
Whenever a member is added to a project from either META·LAB or META·SIFT, and the projects are linked through the same Review Workspace, the member should receive access to the linked project according to selected permissions.

Implementation:
1. Add member to ReviewWorkspace, not only one module-specific table.
2. Assign module-specific permissions:
   - META·LAB permissions
   - META·SIFT permissions
3. Both apps should read from the shared workspace membership.
4. Adding member should immediately affect project visibility.
5. Removing/deactivating member should remove access from both modules where appropriate.
6. Changing permissions should apply immediately after save.

Permissions presets:
- Owner
- Leader
- Reviewer
- Data Extractor
- Viewer
- Read-only META·LAB
- Read-only META·SIFT
- Read-only Both
- Custom

====================================================
TASK 7 — VERSION SHOULD CHANGE WITH EACH COMMIT
====================================================

Problem:
Version should update with each commit.

Requirement:
Add automatic build/version metadata that changes with each Git commit.

Implementation:
Use:
- package.json version
- Git short commit hash
- Git commit date or build timestamp

Display:
vX.Y.Z · <shortCommit> · <buildDate>

Requirements:
1. Add script to generate version metadata from Git.
2. Add /api/version endpoint.
3. Frontend displays version in:
   - account dropdown/about
   - ops/admin console
   - META·SIFT
   - META·LAB
4. If Git info is unavailable in production, fallback gracefully.
5. Version should change when commit changes.
6. Document in deployment notes.

====================================================
TASK 8 — ACCOUNT DROPDOWN EVERYWHERE
====================================================

Problem:
Account dropdown should be available everywhere in the apps, including settings and ops console.

Requirements:
Add consistent account dropdown to:
- META·LAB app
- META·SIFT app
- META·LAB settings pages
- META·SIFT settings/control pages
- Ops/admin console
- Mod console
- Profile/account pages if appropriate
- Any internal app layout/header

Dropdown should include:
- user name/email
- role badge if admin/mod/owner/leader where relevant
- profile/account
- open META·LAB
- open META·SIFT if available
- ops/admin/mod console if permitted
- app version/about
- sign out

Security:
- Normal users should not see admin/mod console link.
- Mods should see console link but only limited console.
- Admins should see full console link.

Avoid duplicated code:
Use shared UserDropdown component if possible.

====================================================
TASK 9 — OPS CONSOLE MESSAGE NOTIFICATION DOES NOT CLEAR
====================================================

Problem:
Messages in the ops console show notification, but the notification does not go away after opening the message.

Expected:
1. Notification badge shows only unread messages.
2. Opening a message should mark it as read.
3. Badge should update immediately.
4. If message is already read, badge should not show.
5. Notification should persist correctly across logout/login.
6. Read state should be per admin/mod user if multiple staff members exist, OR global if you decide that is simpler. Document the decision.
7. If per-staff is feasible, use per-user read state.
8. If global read state is used, opening by one staff member marks it read globally.

Backend:
Add/fix:
- message read status
- per-staff read receipt if feasible
- mark-read endpoint
- unread count endpoint

Suggested endpoints:
- GET /api/console/messages/unread-count
- POST /api/console/messages/:id/mark-read

Frontend:
1. When message detail opens, call mark-read.
2. Update local state immediately.
3. Refetch unread count.
4. Remove notification badge.
5. Do not show notification again after reload if read.

QA:
1. Create unread message.
2. Confirm badge appears.
3. Open message.
4. Confirm badge disappears.
5. Refresh page.
6. Confirm badge stays gone.
7. Logout/login.
8. Confirm badge stays gone.

====================================================
QA REQUIREMENTS
====================================================

Manual QA must test:

1. Owner and Leader are visually separate everywhere.
2. Owner row has no editable controls for leader/member.
3. Leader row has no editable controls unless current user is owner and policy allows.
4. Member cannot edit permissions.
5. Project created date appears.
6. User added to linked workspace sees project in META·LAB if permitted.
7. User added to linked workspace sees project in META·SIFT if permitted.
8. Read-only META·LAB user cannot edit META·LAB.
9. Read-only META·SIFT user cannot screen.
10. META·SIFT Project Control tab exists.
11. Owner can add member from META·SIFT.
12. Leader can add member if permitted.
13. Members sync across linked projects.
14. Version changes with Git commit/build metadata.
15. Account dropdown appears in META·LAB, META·SIFT, settings, and ops console.
16. Ops message notification clears after opening message.

Automated tests:
- owner/leader permission enforcement
- leader cannot edit owner
- member cannot edit roles
- project created date returned
- linked workspace member access
- META·LAB project list includes member projects
- META·SIFT project list includes member projects
- module-specific permissions enforced
- version endpoint returns commit/build metadata
- account dropdown renders in major layouts
- ops unread count clears after mark-read

Update:
- /tests/report.md
- /tests/screening/report.md if relevant

====================================================
FINAL DELIVERABLES
====================================================

Deliver:
1. Owner and leader fully separated.
2. Permission controls hidden for owner/leader rows according to policy.
3. Project added/created date displayed.
4. Linked project member access fixed.
5. META·SIFT Project Control tab added.
6. Member sync across linked META·LAB/META·SIFT projects.
7. Version changes with each commit.
8. Account dropdown everywhere.
9. Ops message notification clears after opening message.
10. Tests updated.
11. Docs updated.

Final report must include:
1. What was changed.
2. Backend changes.
3. Frontend changes.
4. Database changes/migrations.
5. How owner vs leader now works.
6. How linked project access now works.
7. How member sync works.
8. How versioning works.
9. How account dropdown was shared.
10. How ops message unread state works.
11. Manual QA results.
12. Automated test results.
13. Known limitations.

Do not return until implemented, tested, and documented.