CLAUDE MAX — META·LAB / META·SIFT SERVER-READY UPGRADE WITHOUT PDF WORK

Goal:
Implement the next META·LAB + META·SIFT upgrades.

Important:
The PDF issue is already solved. Do NOT work on PDF preview, PDF upload, PDF storage, PDF routes, or PDF viewer in this task.

This is a follow-up task. Do NOT rebuild from scratch.
Read the current codebase, database schema, auth system, admin console, META·SIFT module, META·LAB project system, docs, and tests before coding.

Requested upgrades:
1. Add the user dropdown menu to META·SIFT.
2. Admins should be able to edit user info.
3. Add a new “Mod” role below Admin.
4. Mods should access the same console entrance as Admins but only see limited areas.
5. Console messages should support replying by email using a META·LAB-styled email template.
6. Make all changes server/deployment-ready because pushing to main GitHub will deploy live later.
7. Add app versioning that updates automatically with each update.
8. Add typing indicators to project chat.
9. Improve chat notifications.
10. Rename “creator” to “owner.”
11. Owner has full control.
12. Leaders can do almost everything owner can, except changing owner permissions/status/ownership.
13. Unify META·LAB and META·SIFT projects through a shared Review Workspace.
14. From META·LAB, users should be able to create and automatically link a META·SIFT project.
15. Linked META·LAB/META·SIFT projects should share members, owner, leaders, and permission controls.
16. Owners/leaders should control member permissions for META·LAB, META·SIFT, or both.

Use the team:
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

Website Manager only helps if public website/profile/header changes are needed.
Research Engine only helps if META·SIFT/META·LAB handoff or data model compatibility is affected.

Autonomy:
Do not ask me small questions.
Make the best technical/product/security decisions.
Implement, test, fix failures, document, then report.
Only stop if blocked by missing credentials, missing files, or a serious security issue.

Deployment-readiness rule:
The app is local now, but it must be written as if it will deploy from GitHub main branch to production later.
Do not use local-only hacks that will break on the server.
Use environment variables.
Do not commit real secrets.
Add .env.example updates.
Document production requirements.

Database safety:
Do NOT wipe, reset, or delete the database.
Do NOT run destructive migrations without backup.
Use additive migrations whenever possible.
Preserve existing users, projects, META·LAB data, and META·SIFT data.

====================================================
TASK 1 — USER DROPDOWN IN META·SIFT
====================================================

Problem:
User dropdown menu is available in main app but not from META·SIFT.

Requirements:
1. Add same user/account dropdown to META·SIFT layout/header.
2. Dropdown should include:
   - user name/email
   - profile/account
   - open META·LAB/main app
   - control panel if admin or mod with access
   - sign out
3. Normal users should not see admin/mod console links.
4. Admins and Mods should see console link according to their role.
5. Keep UI consistent with META·LAB.
6. Do not duplicate auth logic unnecessarily; reuse shared auth/user menu component if possible.

====================================================
TASK 2 — ADMIN USER EDITING
====================================================

Admins should be able to manage users from the console.

Admin capabilities:
1. View users.
2. Search/filter users.
3. Edit user name.
4. Edit email if safe.
5. Change account status:
   - active
   - suspended
   - disabled
6. Assign/remove roles:
   - user
   - mod
   - admin
7. Reset password safely.
8. Never view plain-text passwords.
9. Audit every admin change.
10. Prevent admin from accidentally removing the last admin.
11. Prevent non-admin from assigning admin role.

Password reset:
For local/server-ready MVP:
- Admin can set temporary password OR generate reset token.
- Prefer reset token flow if feasible.
- If email sending is configured, send reset link.
- If email is not configured, show local dev fallback safely.
- Document production setup.

====================================================
TASK 3 — ADD “MOD” ROLE
====================================================

Add role:
Mod

Hierarchy:
- Admin: full console access
- Mod: limited console access
- User: normal app access

Mods enter the console from the same entrance as admins, but see limited areas.

Mod permissions:
Allowed:
1. View users.
2. Edit basic user info if safe:
   - name
   - email if policy allows
   - account status if policy allows
3. Reset password or initiate reset.
4. View contact/support messages.
5. Reply to contact/support messages by email.
6. View user support context if needed.
7. View basic non-sensitive project metadata if needed for support.

Not allowed:
1. No global metrics dashboard.
2. No admin metrics.
3. No revenue/system/security metrics.
4. No app-wide settings.
5. No role assignment to admin.
6. No changing admin users.
7. No deleting users unless you decide it is safe; default should be no.
8. No editing META·SIFT system settings.
9. No database/admin config.
10. No feature flags unless explicitly safe.

Admin assigns Mods:
1. Add role dropdown in user management.
2. Only Admin can assign/remove Mod.
3. Mod assignment should be easy and clear.
4. Add confirmation dialog.
5. Add audit log.
6. If a user becomes Mod, they can access console with limited UI.
7. If role is removed, console access changes immediately after refresh/session revalidation.

Backend:
1. Add role enum/field if needed.
2. Add middleware:
   - requireAdmin
   - requireAdminOrMod
   - requirePermission
3. Protect all console routes server-side.
4. Do not rely on frontend hiding alone.

Frontend:
1. Console layout should render based on role.
2. Mods see only allowed sections.
3. Admins see everything.
4. If Mod tries admin-only route, show access denied or 404.

====================================================
TASK 4 — REPLY TO CONSOLE MESSAGES BY EMAIL
====================================================

Requirement:
When a message/contact request is received in console, Admin/Mod should be able to send a reply. The reply should be sent directly to the sender’s email.

Email requirements:
1. Add reply composer in message detail view.
2. Show recipient email.
3. Subject field.
4. Message body.
5. Preview.
6. Send button.
7. Save sent reply in database.
8. Mark original message as replied.
9. Show reply history/thread.
10. Use META·LAB-styled email template.
11. If email provider is not configured, show clear setup error and optionally save draft.

Email template:
Should resemble META·LAB:
- professional
- clean
- app name/logo text
- message content
- footer
- no flashy design

Backend:
1. Add email service abstraction.
2. Support environment variables:
   - EMAIL_PROVIDER
   - SMTP_HOST
   - SMTP_PORT
   - SMTP_USER
   - SMTP_PASS
   - EMAIL_FROM
   - APP_BASE_URL
3. If Resend/SendGrid/Nodemailer already exists, use it.
4. Do not commit secrets.
5. Update .env.example.
6. Add audit log for replies.

Suggested endpoints:
- POST /api/admin/messages/:id/reply
- GET /api/admin/messages/:id/replies
- POST /api/mod/messages/:id/reply if separate route is cleaner

Permissions:
- Admin can reply.
- Mod can reply.
- Normal user cannot.

====================================================
TASK 5 — SERVER/DEPLOYMENT READINESS
====================================================

Because pushing to main GitHub will deploy the website later, make sure these changes are server-ready.

Requirements:
1. No hardcoded localhost URLs except dev fallback.
2. Use environment variables.
3. Update .env.example.
4. Ensure build command works.
5. Ensure migration command is documented.
6. Add CORS/session/cookie production notes.
7. Add HTTPS/cookie secure notes.
8. Do not assume local-only behavior in production.

Docs:
- docs/manager/deployment-readiness.md
- server/docs/email-setup.md

====================================================
TASK 6 — APP VERSIONING
====================================================

Add app version visible in the app and console.

Requirements:
1. Add version number to app.
2. Show version in:
   - footer or profile/about area
   - admin/control panel system area
   - META·SIFT user dropdown/about area
3. Version should update automatically with each update if feasible.

Implementation options:
Choose best practical approach:
- read package.json version
- use build-time variable
- use git commit hash
- use build timestamp
- use semantic version + commit hash

Recommended display:
v0.x.x · build <short commit> · <date>

Automation:
1. Add script to generate version metadata at build/dev startup if appropriate.
2. Do not manually hardcode in many places.
3. Add endpoint:
   - GET /api/version
4. Frontend reads version from shared config/API.
5. Document versioning process.

====================================================
TASK 7 — CHAT TYPING INDICATORS AND BETTER NOTIFICATIONS
====================================================

Add typing indicators to project chat.

Requirements:
1. When a member is typing, other project members see:
   - “Name is typing…”
2. If multiple:
   - “Name and Name are typing…”
   - “Several members are typing…”
3. Typing state should clear after timeout.
4. Do not store typing permanently in database.
5. Use websocket if available.
6. If no websocket, use lightweight polling or in-memory event channel and document limitations.
7. Typing is project-specific.
8. Users outside the project cannot see typing state.

Notifications:
1. Unread chat badge should only show unread messages.
2. Notification should not appear every login if messages are already read.
3. Add notification when new chat message arrives while user is in project but chat closed.
4. Optional: sound disabled by default.
5. Notification state should be per user/per project.

====================================================
TASK 8 — RENAME CREATOR TO OWNER AND UPDATE ROLES
====================================================

Change terminology:
- creator → owner

Owner:
- the user who created the project by default
- has full control
- can transfer ownership if implemented
- can delete project
- can change owner-level permissions
- can assign leaders
- can control member permissions
- can change project status
- can manage linked META·LAB/META·SIFT settings

Leader:
- can do everything owner does EXCEPT:
  - cannot change owner permission
  - cannot change owner status
  - cannot remove owner
  - cannot transfer ownership
  - cannot demote owner
  - cannot delete owner
- can manage members except owner
- can change member status/role if permitted
- can manage project workflow
- can toggle blind mode
- can resolve conflicts
- can control screening settings
- can manage chat permissions

Member:
- permissions depend on project settings.

Viewer/read-only:
- can view allowed parts but cannot edit/screen.

Update:
1. Database fields if needed.
2. API responses.
3. Frontend labels.
4. Docs.
5. Tests.
6. Do not break old data; migrate creatorId → ownerId safely if needed.

====================================================
TASK 9 — UNIFY META·LAB AND META·SIFT PROJECTS THROUGH SHARED WORKSPACE
====================================================

This is a major architecture improvement.

Goal:
Make projects easier for users by creating one shared “Review Workspace” concept while keeping META·LAB and META·SIFT as separate modules/apps.

User experience:
If user creates a project in META·LAB, they should have an option:
“Create and link META·SIFT screening project”

If selected:
1. Create META·LAB project.
2. Create linked META·SIFT project.
3. Both belong to the same Review Workspace.
4. Same owner.
5. Same leaders.
6. Same members where applicable.
7. Shared permissions are managed from the project.

If projects are linked:
- META·LAB shows linked META·SIFT project.
- META·SIFT shows linked META·LAB project.
- Members are synchronized.
- Owner is synchronized.
- Leaders are synchronized.
- Project permissions apply across both modules.
- Accepted second-review studies go to the linked META·LAB Data Extraction.
- META·LAB PRISMA updates from linked META·SIFT.

Keep apps separate:
- META·LAB module remains separate.
- META·SIFT module remains separate.
- Both use shared Review Workspace for association, membership, permissions, and handoff.

Suggested data model:
- ReviewWorkspace
  - id
  - title
  - ownerId
  - status
  - createdAt
  - updatedAt

- ReviewWorkspaceMember
  - workspaceId
  - userId
  - role: owner, leader, member, viewer
  - status: active, inactive
  - permissions JSON or explicit fields

- MetaLabProject
  - workspaceId nullable or required after migration

- MetaSiftProject
  - workspaceId nullable or required after migration

Permissions:
Owners/leaders can control member permissions for:

META·LAB:
- canViewMetaLab
- canEditMetaLab
- canManageExtraction
- canRunAnalysis
- canExport
- readOnlyMetaLab

META·SIFT:
- canViewMetaSift
- canScreen
- canSecondReview
- canResolveConflicts
- canManageDuplicates
- canImportRecords
- canExportRecords
- canChat
- readOnlyMetaSift

Global:
- canManageMembers
- canManageSettings

UX:
1. In META·LAB project settings, add Members & Permissions.
2. In META·SIFT project overview/settings, add Members & Permissions.
3. Changes should reflect across linked workspace.
4. Show clear module-specific permissions:
   - META·LAB permissions
   - META·SIFT permissions
   - Chat permissions
5. Easy presets:
   - Owner
   - Leader
   - Reviewer
   - Data Extractor
   - Viewer
   - Read-only META·LAB
   - Read-only META·SIFT
   - Read-only Both
6. Advanced permissions can be expanded.

Migration:
1. Existing META·LAB projects should get a ReviewWorkspace.
2. Existing META·SIFT projects should get a ReviewWorkspace.
3. If already linked, they should share one workspace.
4. Preserve all data.
5. Do not wipe anything.

====================================================
TASK 10 — QA
====================================================

QA must test everything before completion.

Manual QA:
1. Start app.
2. Confirm no database reset.
3. Login as admin.
4. Confirm admin console works.
5. Confirm admin can edit users.
6. Assign a user as Mod.
7. Login as Mod.
8. Confirm Mod can enter console.
9. Confirm Mod sees only allowed sections.
10. Confirm Mod cannot see metrics/settings.
11. Confirm Mod can view messages.
12. Confirm Mod can reply to message by email or gets clean email-not-configured error.
13. Confirm reply is saved in thread.
14. Confirm app version is visible.
15. Confirm /api/version works.
16. Login as normal user.
17. Confirm user dropdown appears in META·SIFT.
18. Create META·LAB project and choose create/link META·SIFT project.
19. Confirm shared workspace created.
20. Confirm same owner.
21. Add member.
22. Set member read-only META·LAB.
23. Set member read-only META·SIFT.
24. Confirm permissions are enforced.
25. Change member to leader.
26. Confirm leader can manage workflow but cannot change owner.
27. Confirm owner label appears instead of creator.
28. Test chat typing indicator.
29. Test unread notifications.
30. Confirm accepted Second Review article appears in linked META·LAB Data Extraction.
31. Confirm META·LAB and META·SIFT still operate separately.
32. Disable META·SIFT if feature flag exists.
33. Confirm META·LAB still works.

Automated tests:
- User dropdown renders in META·SIFT.
- Admin can edit user.
- Admin can assign Mod.
- Mod access limited.
- Mod cannot access metrics/settings.
- Message reply endpoint permission.
- Email service fallback if not configured.
- Version endpoint.
- Chat typing state.
- Chat unread notification.
- creator → owner migration.
- owner permissions.
- leader cannot alter owner.
- create META·LAB project with linked META·SIFT project.
- workspace membership sync.
- module permissions enforced.
- second-review accepted article appears in Data Extraction.

Update:
- /tests/report.md
- /tests/screening/report.md

====================================================
FINAL DELIVERABLES
====================================================

Deliver:
1. User dropdown visible in META·SIFT.
2. Admin user editing.
3. New Mod role.
4. Mod limited console.
5. Admin assignment of Mods.
6. Console message email replies.
7. META·LAB email template.
8. Server/deployment-ready configuration.
9. App versioning.
10. Version endpoint/display.
11. Chat typing indicators.
12. Better chat notifications.
13. creator renamed to owner.
14. Owner/leader permission model.
15. Shared Review Workspace model.
16. META·LAB project can create/link META·SIFT project.
17. Shared members and permissions across linked projects.
18. Module-specific read-only permissions.
19. Second Review → Data Extraction still works.
20. Tests and docs updated.

Final report must include:
1. User dropdown changes.
2. Admin user-editing changes.
3. Mod role permissions.
4. Email reply setup and required env vars.
5. Versioning approach.
6. Chat typing/notification approach.
7. Owner/leader model.
8. Shared Review Workspace architecture.
9. Database migrations.
10. Deployment readiness notes.
11. Manual QA results.
12. Automated test results.
13. Known limitations.
14. Production deployment warnings.

Do not return until implemented, tested, and documented.