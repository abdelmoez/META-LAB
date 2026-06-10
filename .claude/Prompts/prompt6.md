CLAUDE MAX — META·LAB / META·SIFT COLLABORATION, OPS, NOTIFICATIONS, AND PROJECT-SYNC UPGRADE

Goal:
Continue improving the META·LAB + META·SIFT ecosystem.

This is a follow-up task.
Do NOT rebuild from scratch.
Do NOT wipe/reset/delete the database.
Do NOT remove working features unless explicitly requested.
Preserve all existing users, projects, studies, screening records, and linked workspace data.

Use the same team:

1. Main Claude — Overall Manager / Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. QA Developer
6. Website Manager / Public Website Agent
7. Collaboration & Realtime Agent

Autonomy:
Do not ask me for small confirmations.
Make the best product, UX, security, and technical decisions.
Implement, test, fix failures, document, and return only when complete.
Only stop if blocked by missing credentials, missing files, or a serious security issue.

Important instruction:
Before implementing, Main Claude and each agent must add their own expert input/opinion.

Create:
docs/manager/team-opinion-and-implementation-plan.md

It should include:
1. Main Claude’s opinion on the best architecture.
2. Backend agent’s opinion on database/security/RBAC.
3. Frontend agent’s opinion on UX and navigation.
4. Collaboration agent’s opinion on realtime sync, invites, chat, and notifications.
5. QA agent’s opinion on what must be tested before marking complete.
6. Any concerns, risks, or better alternatives.
7. Final chosen implementation plan.

Then implement the plan.

====================================================
HIGH-LEVEL PRODUCT DIRECTION
====================================================

META·LAB and META·SIFT should feel like two separate apps inside one research ecosystem.

However, project linking and membership should be unified through a shared Review Workspace.

Rules:
1. META·LAB project creation should automatically create and link a META·SIFT project by default or through an obvious option.
2. Creating a project in META·SIFT should NOT automatically create a META·LAB project unless the user chooses to create/link one.
3. If a META·LAB and META·SIFT project are linked, all members should see the linked status correctly.
4. If a member is added to a linked project, they should not need to manually link it again.
5. The project should appear correctly in both apps according to their permissions.
6. Opening the linked META·LAB project from META·SIFT should take the user directly to the correct META·LAB project, not the first project in the list.
7. Opening the linked META·SIFT project from META·LAB should take the user directly to the correct META·SIFT project.
8. The shared Review Workspace should be the source of truth for owner, leaders, members, roles, permissions, and linked project relationships.

====================================================
TASK 1 — INVITE NOTIFICATIONS WITH BELL ICON
====================================================

Add user notifications for project invitations.

Requirements:
1. Add a bell icon in the top-right user/header area.
2. Bell should exist across META·LAB, META·SIFT, settings, and ops/mod console where appropriate.
3. When a user is invited/added to a project, create a notification.
4. Notification should show:
   - project name
   - app/module: META·LAB, META·SIFT, or linked workspace
   - inviter name/email
   - role/permission granted
   - created date
   - action button: Open project
5. When the user opens/clicks the notification, mark it read/dismissed.
6. If the user has unread notifications, show a badge count.
7. Read/dismissed notifications should not keep showing as unread.
8. Notifications should persist across logout/login.
9. Notifications should be per user.
10. If the invited project is linked, opening notification should take user to the correct linked workspace/project.

Backend:
Create notification system:
- Notification table/model
- userId
- type
- title
- message
- relatedProjectId
- relatedWorkspaceId
- relatedMetaLabProjectId
- relatedMetaSiftProjectId
- readAt
- dismissedAt
- createdAt

Suggested endpoints:
- GET /api/notifications
- GET /api/notifications/unread-count
- POST /api/notifications/:id/read
- POST /api/notifications/:id/dismiss
- POST /api/notifications/mark-all-read

Frontend:
- Bell icon dropdown/panel
- unread badge
- notification list
- empty state
- mark read on click
- open correct project route

QA:
- User receives invite notification.
- Notification opens correct linked project.
- Notification disappears from unread after opening.
- Notification does not reappear after logout/login.

====================================================
TASK 2 — META·LAB PROJECT CREATION SHOULD CREATE/LINK META·SIFT PROJECT
====================================================

Requirement:
If a project is added in META·LAB, it should automatically create and link the same project in META·SIFT.

Implementation:
When creating a META·LAB project:
1. Show option:
   - “Create linked META·SIFT screening project”
2. Default should be enabled unless there is a good reason not to.
3. If enabled:
   - create ReviewWorkspace
   - create META·LAB project
   - create linked META·SIFT project
   - same owner
   - same initial members
   - same project title
   - same PICO/inclusion/exclusion if available
4. If disabled:
   - create META·LAB project only
   - allow linking/creating META·SIFT later

Creating from META·SIFT:
1. Create META·SIFT project only by default.
2. Offer:
   - “Also create/link META·LAB project”
3. Do not force META·LAB creation from META·SIFT.

QA:
- Create META·LAB project with linked META·SIFT.
- Confirm both exist.
- Confirm link works both directions.
- Create META·SIFT-only project.
- Confirm META·LAB project is not created unless selected.

====================================================
TASK 3 — FIX LINKED PROJECT DISPLAY AND DIRECT NAVIGATION
====================================================

Current bug:
In Screening/PRISMA or linked areas, when a user is added to the project, the project is not shown as linked even if it is linked.
In META·SIFT, it shows linked, but clicking the META·LAB project leads to the first project in the list instead of the correct project.

Fix:
1. Every linked project display should use the real linked project ID.
2. Never navigate to generic project list if a linked project ID exists.
3. Route should go directly to:
   - META·LAB project detail/workspace for that linked project
   - META·SIFT project detail/workspace for that linked project
4. If user lacks permission, show “You do not have access” instead of redirecting wrong.
5. If link is missing/broken, show clear “Link missing” warning.

Backend:
Return linked IDs and titles in all relevant project endpoints:
- workspaceId
- metaLabProjectId
- metaLabProjectTitle
- metaSiftProjectId
- metaSiftProjectTitle
- currentUserPermissions

Frontend:
Use IDs from API.
Do not fallback to first project.

QA:
- Added member sees project as linked.
- Clicking linked META·LAB opens exact project.
- Clicking linked META·SIFT opens exact project.

====================================================
TASK 4 — PROJECT CONTROL TAB IN META·LAB TOO
====================================================

Requirement:
Add a Project Control tab in META·LAB, similar/synced with META·SIFT.

META·LAB Project Control tab should include:
1. Project info
2. Owner
3. Leaders
4. Members
5. Add member
6. Remove/deactivate member if permitted
7. Role management
8. Permissions management
9. Linked META·SIFT project
10. Create/link META·SIFT project
11. Project status
12. Done/in-progress state
13. Read-only settings
14. Member activity/progress if relevant

Permissions:
- Owner can control everything.
- Leaders can manage members except owner and protected leader rules.
- Members/viewers cannot manage permissions.
- Viewer must not edit META·LAB content.

This Project Control tab should sync with META·SIFT if both projects are linked through the same Review Workspace.

====================================================
TASK 5 — FIX VIEWER PERMISSIONS IN META·LAB
====================================================

Current bug:
Viewer can edit in META·LAB. This is wrong.

Expected:
Viewer/read-only users can read but cannot write.

Must block:
- editing project details
- editing PICO
- editing data extraction
- importing studies
- deleting records
- changing PRISMA
- running destructive actions
- changing members
- changing project status
- exporting if permission disallows it

Backend:
Enforce read-only server-side.
Do not rely only on disabled UI.

Frontend:
1. Hide or disable edit controls for viewer/read-only.
2. Show clear label:
   - “Read-only access”
3. If user tries direct API call, backend rejects.

QA:
- Viewer cannot edit in UI.
- Viewer cannot edit by direct API request.

====================================================
TASK 6 — ROLE/PERMISSION CHANGES FROM BOTH META·LAB AND META·SIFT
====================================================

Requirement:
Owner and leaders should be able to change member roles/permissions from both META·LAB and META·SIFT.

When adding a member:
User should choose whether the member can participate in:
- META·LAB only
- META·SIFT only
- both

Leaders:
- leaders participate in both by default unless owner changes policy.
- leader permissions should be clear.

Available roles/presets:
- Owner
- Leader
- Reviewer
- Data Extractor
- Viewer
- Read-only META·LAB
- Read-only META·SIFT
- Read-only Both
- Custom

Owner/Leader can assign:
- canViewMetaLab
- canEditMetaLab
- canManageExtraction
- canRunAnalysis
- canExportMetaLab
- canViewMetaSift
- canScreen
- canImportStudiesToMetaSift
- canSecondReview
- canResolveConflicts
- canManageDuplicates
- canExportMetaSift
- canChat
- canManageMembers if role permits

Important:
Leader and owner should be able to change member role to everything allowed by their authority, not just viewer/reviewer.

Owner limitations:
- owner protected
- no one else can change owner permissions/status

Leader limitations:
- leader cannot change owner
- leader cannot remove owner
- leader cannot alter owner permissions
- leader cannot transfer ownership

QA:
- Add member from META·LAB.
- Add member from META·SIFT.
- Confirm they appear in both apps if linked.
- Confirm permissions are enforced.

====================================================
TASK 7 — REALTIME TEXT AND STATE UPDATES
====================================================

Requirement:
All text and project data should automatically update for all members on the same page when any member updates it, without needing refresh.

Examples:
- project name
- PICO
- inclusion/exclusion text
- project status
- member role/status
- screening decisions
- second review decisions
- chat messages
- notes
- project control changes
- PRISMA/handoff status

Implementation:
Use the best practical method:
1. WebSocket if existing infrastructure supports it.
2. Server-Sent Events if easier.
3. Polling fallback if needed.

Requirements:
1. Updates should be project/workspace-scoped.
2. Users only receive updates for projects they have access to.
3. Do not leak private project data.
4. UI should update without full page refresh.
5. If realtime connection fails, fallback to periodic refetch.
6. Document the architecture.

Collaboration & Realtime Agent owns this.

QA:
- User A edits project name while User B is on same page.
- User B sees update without refresh.
- User A changes member permission.
- User B sees permission effect without refresh or after revalidation.
- Chat updates live.

====================================================
TASK 8 — ADDED MEMBER SHOULD NOT NEED TO LINK PROJECT AGAIN
====================================================

Requirement:
If a member is added to a project that is already linked between META·LAB and META·SIFT, the member should automatically see it as linked.

Fix:
1. Link belongs to ReviewWorkspace, not individual user.
2. Member access should not require personal relinking.
3. Project cards should show linked status for all members with access.
4. Opening linked project should work for all permitted members.

====================================================
TASK 9 — OPS OVERVIEW UNIQUE LOGIN METRICS
====================================================

Add metrics in Ops Overview:
- unique logins in past 24 hours
- unique logins in past week
- unique logins in past month
- unique logins in past quarter
- unique logins in past year

Definition:
Unique users who successfully logged in during each time window.

Backend:
Track login events:
- userId
- timestamp
- ip/userAgent if already collected safely
- success/failure

Metrics should count unique userId per period.

Frontend:
Add cards/chart in Ops Overview.

QA:
- Simulate login events.
- Confirm unique users counted once per period.

====================================================
TASK 10 — FIX LAST ACTIVE IN OPS USERS
====================================================

Current bug:
Last active in ops console for users does not work.

Expected:
Last active should update when user:
- logs in
- opens app
- performs meaningful authenticated action
- saves/updates project
- screens article
- sends message

Backend:
1. Add/update lastActiveAt.
2. Update safely, preferably throttled to avoid DB spam.
3. Return lastActiveAt in users endpoint.

Frontend:
Display readable last active.

QA:
- Login user.
- Confirm lastActiveAt updates.
- Perform action.
- Confirm ops console updates.

====================================================
TASK 11 — OPS PROJECTS SHOULD SHOW LINKED STATUS
====================================================

In Ops Projects:
Show if project is linked to META·SIFT.

For META·LAB projects:
- linked META·SIFT project: yes/no
- linked META·SIFT title
- workspaceId
- owner
- status

In META·SIFT project tab in Ops:
- linked META·LAB project: yes/no
- linked META·LAB title
- workspaceId
- owner
- status

Also:
If admin clicks a META·SIFT project in Ops, show project progress:
- total records
- screened
- unscreened
- included
- excluded
- maybe
- conflicts
- duplicates
- second review
- sent to data extraction
- member progress if admin has access

====================================================
TASK 12 — OPS DONE-TODAY UNIQUE PROJECT METRIC
====================================================

In Ops console:
Show how many projects were marked done today.

Important:
This should count unique projects, not repeated toggles.

If one project was:
done → under process → done again on the same day
it counts as only one project done today.

Backend:
Track project status events:
- projectId
- status
- changedAt
- changedBy

Metric:
Count distinct projectId where status changed to done today.

Add:
- done today
- done this week if useful
- done this month if useful

QA:
- Toggle one project done twice.
- Confirm metric counts 1.

====================================================
TASK 13 — REMOVE TEMPLATES TAB AND FILE ENTIRELY
====================================================

Requirement:
Remove Templates tab with its file entirely from the app.

But replace it with a professional equations/methodology reference area.

New tab/section name:
Methods & Equations

Purpose:
Show all equations used in the analysis and research engine, with references.

Include equations for:
- fixed-effect meta-analysis
- random-effects meta-analysis
- inverse-variance weighting
- DerSimonian–Laird tau²
- Q statistic
- I²
- z statistic
- confidence intervals
- prediction interval
- HKSJ if implemented
- Egger test if implemented
- effect-size calculations:
  - OR
  - RR
  - HR
  - SMD
  - MD
  - correlation Fisher z
  - proportions/logit if used
- duplicate similarity scoring if used
- any other important analysis equation in the app

For each:
1. equation
2. plain-English explanation
3. where it is used in the app
4. reference/citation
5. limitations/assumptions

Design:
- professional
- clean
- academic
- not flashy
- readable
- useful for researchers

Important:
Use accurate references.
Do not invent references.
If unsure, document as “needs verification” and cite only known sources.

Remove:
- Templates tab
- template file/components/routes if unused
- any broken imports

QA:
- App builds without template imports.
- Methods & Equations tab renders.
- Equations are readable.
- No broken routes.

====================================================
TASK 14 — MOD ACCESS TO OPS CONSOLE
====================================================

Current bug:
Mod cannot access ops console; it shows 404.
This is likely because access is hardcoded to two admins.

Requirement:
Create a secure workaround.

Options:
Choose best UX/security:
A. Same Ops Console route with role-based limited view.
B. Separate Mod Console route.
C. Same entrance but dynamically shows Admin or Mod console based on role.

Preferred:
Same console entrance, role-based access.

Rules:
- Admin sees full console.
- Mod sees limited console.
- User sees no console.
- No hardcoded access only to two admins.
- Backend must check role.
- Frontend must render based on role.
- Direct navigation to admin-only pages by Mod should show access denied/404.
- Mod should access:
  - user support section
  - messages
  - message replies
  - limited user management
- Mod should not access:
  - metrics
  - settings
  - feature flags
  - system/security admin
  - database controls
  - role assignment to admin

QA:
- Admin can access full ops.
- Mod can access limited ops.
- Normal user cannot.
- Mod route no longer 404 if role permits.

====================================================
TASK 15 — META·LAB OVERVIEW TAB
====================================================

Requirement:
There should be an Overview tab in META·LAB.

Even if the user has projects, there should be a landing/overview page every time they enter a project.

META·LAB project overview should show:
- project title
- owner
- leaders
- members count
- linked META·SIFT project
- project created date
- last updated
- PICO summary
- extraction progress
- number of studies in Data Extraction
- PRISMA status
- meta-analysis readiness
- recent activity
- next suggested steps

It should be useful and not generic.

====================================================
TASK 16 — REMOVE AI FEATURE VISIBILITY
====================================================

Requirement:
Remove AI feature visibility from UI for now, but keep the code/structure for later implementation if already present.

Rules:
1. Hide AI buttons/tabs/badges from users.
2. Do not delete future AI infrastructure unless unused and harmful.
3. Add comment/docs:
   - AI features hidden pending future implementation.
4. Ensure no broken imports/routes.

====================================================
TASK 17 — FIX META·SIFT IMPORT PERMISSIONS FOR ADDED USER
====================================================

Current bug:
Added user cannot import studies to META·SIFT.
It shows “project not found.”
This may be because user was viewer then changed to leader, or membership/permission cache is stale.

Expected:
If user has permission:
- canImportStudiesToMetaSift = true
or role leader/owner
then import should work.

Fix:
1. Backend must check membership/permissions correctly.
2. Do not return project not found if project exists and user lacks permission; return 403.
3. If user was upgraded from viewer to leader, permissions should update immediately.
4. Frontend should revalidate session/project permissions after role change.
5. Import endpoint should use ReviewWorkspace membership.

QA:
- Add user as viewer.
- Confirm cannot import.
- Change user to leader.
- Confirm can import.
- Confirm no “project not found.”

====================================================
TASK 18 — PROJECT OWNER CAN CHANGE PROJECT NAME
====================================================

Requirement:
Project owner should be able to change project name.

Also leaders can change project name if permission allows.

Apply to:
- META·LAB project name
- META·SIFT project name
- ReviewWorkspace title if linked

If projects are linked:
- decide whether changing workspace title updates both.
- Prefer a shared workspace title with module-specific titles optional.
- Document behavior.

====================================================
TASK 19 — PREVENT DUPLICATE IMPORT OF SAME SCREENING FILE
====================================================

Requirement:
When importing screening files in META·SIFT, prevent importing the same file again if it already exists.

At minimum:
- detect same file
- warn user file was already imported
- prevent duplicate records unless user confirms override

Better:
Use import fingerprinting.

Backend:
For each import batch store:
- fileName
- fileSize
- fileHash/fingerprint
- importedBy
- importedAt
- projectId
- number of records
- parser type

Before import:
1. Compute file hash.
2. Check existing imports in same project.
3. If same hash exists:
   - return warning
   - do not import automatically
4. Optional override:
   - “Import anyway”
5. Also deduplicate records by DOI/PMID/title.

Frontend:
Show:
- “This file appears to have already been imported on DATE by USER.”
- “Records not imported to prevent duplication.”
- Optional “Import anyway” if implemented.

QA:
- Import file once.
- Import same file again.
- Confirm warning/prevention.
- Confirm no duplicate records created.

====================================================
FINAL QA REQUIREMENTS
====================================================

QA must manually test:
1. Invite notification bell.
2. META·LAB project creates linked META·SIFT project.
3. META·SIFT project does not force META·LAB project unless selected.
4. Linked project opens correct project, not first project.
5. META·LAB Project Control tab.
6. Viewer cannot edit META·LAB.
7. Role/permission editing from both apps.
8. Realtime updates across two logged-in members.
9. Added member sees linked project automatically.
10. Unique login metrics.
11. Last active updates.
12. Ops linked project status.
13. META·SIFT project progress in ops.
14. Done-today unique metric.
15. Templates removed.
16. Methods & Equations tab added.
17. Mod console access works.
18. META·LAB Overview tab.
19. AI feature visibility hidden.
20. Added user upgraded to leader can import to META·SIFT.
21. Owner can rename project.
22. Duplicate screening import prevention works.

Automated tests should cover all permission, route, API, and import behaviors.

Update:
- /tests/report.md
- /tests/screening/report.md
- docs/manager/final-implementation-report.md

Final report must include:
1. Claude/team opinions and implementation decisions.
2. Backend changes.
3. Frontend changes.
4. Database changes.
5. Realtime architecture.
6. Notification system.
7. Linked project behavior.
8. Permission model.
9. Ops metrics.
10. Methods & Equations replacement.
11. Mod access solution.
12. QA manual results.
13. Automated test results.
14. Known limitations.
15. Recommended next steps.

Do not return until implemented, tested, and documented.