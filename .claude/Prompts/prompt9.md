CLAUDE MAX / FABLE 5.0 — NOTIFICATIONS, INVITES, EXPORTS, PROJECT DELETE, CHAT FIX, AND OPS CONTROL EXPANSION

Claude, I want you to keep thinking deeply about the product, not just implement these as isolated fixes.

Before coding, inspect the current notification system, invite/member system, META·LAB/META·SIFT linking, chat drawer, export/download system, project deletion behavior, landing page animation settings, and ops console.

I want your opinion and suggestions too. If you think there is a better UX or safer technical approach than what I wrote, explain it in the plan and then implement the best version.

Create first:

docs/manager/claude-opinion-notifications-invites-exports-ops.md

Include:
1. Your opinion on the current notification/invite flow.
2. Your recommended invite architecture.
3. Your opinion on project deletion vs archive/soft-delete.
4. Your recommended export/download UX.
5. Your recommendation for how much the ops console should control.
6. Security concerns.
7. Final implementation plan.

Use the same team:
1. Main Claude — Overall Manager / Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Collaboration & Realtime Agent
5. QA Developer
6. Website Manager / Public Website Agent
7. Security & Diagnostics Agent if useful

Do not rebuild from scratch.
Do not wipe/reset the database.
Use additive migrations.
Preserve existing data.
Do not ask me small questions.
Make decisions, implement, test, document, and report.

====================================================
TASK 1 — NOTIFICATION CLICK SHOULD DELETE/DISMISS IT
====================================================

Current behavior:
Notifications remain after being clicked.

Expected:
If a notification is clicked, it should be removed from the notification list or marked dismissed so the user does not keep seeing it.

Requirements:
1. Clicking a notification should:
   - open the correct target
   - mark it read
   - dismiss/delete it from the active notification list
2. It should not appear again after refresh.
3. It should not appear again after logout/login.
4. Keep notification history only if you think it is useful, but active notification list should remove clicked items.
5. Bell badge should update immediately.
6. Backend should persist read/dismissed/deleted state.

Preferred approach:
Soft-dismiss:
- keep record in database for audit/history
- hide it from active notification list after click
- set readAt and dismissedAt

Suggested endpoints:
- POST /api/notifications/:id/read
- POST /api/notifications/:id/dismiss
- POST /api/notifications/:id/opened

QA:
1. Create invite notification.
2. Click it.
3. Confirm it opens correct project.
4. Confirm it disappears.
5. Refresh.
6. Confirm it stays gone.

====================================================
TASK 2 — ADD MEMBER MUST VALIDATE EMAIL AND HANDLE INVITES
====================================================

Current issue:
Add member accepts random letters. It should require a real email and support inviting users who do not have accounts.

Expected flow:
When adding a member:
1. Validate that the input is an email.
2. If not valid email, show clear error.
3. Check whether a user account exists with that email.
4. If user exists:
   - add them to the project/workspace immediately
   - assign selected role/permissions
   - create notification for them
5. If user does not exist:
   - create pending invite
   - send email invite
   - invite link should allow them to register
   - after registration through invite link, they should automatically join the project/team they were invited to
   - assigned role/permissions should already be applied

Requirements:
1. Email validation on frontend and backend.
2. Backend must not accept invalid emails.
3. Pending invites should be stored in database.
4. Invite token should be secure and not guessable.
5. Invite token should expire.
6. Invite should be tied to:
   - email
   - project/workspace
   - invitedBy
   - role
   - permissions
   - status pending/accepted/expired/revoked
7. If email sending is not configured, show clean fallback in development:
   - invite created
   - display copyable invite link to owner/admin only
8. Do not reveal too much account existence information to unauthorized users.
9. Owner/leaders can invite according to permission rules.

Email invite:
- professional META·LAB styled email
- includes project name
- inviter name
- role/permission summary
- secure invite link
- expiration note

Suggested endpoints:
- POST /api/workspaces/:workspaceId/invites
- GET /api/invites/:token
- POST /api/invites/:token/accept
- POST /api/invites/:inviteId/revoke

QA:
1. Add invalid email → rejected.
2. Add existing user → added immediately.
3. Add non-existing email → invite created.
4. Register through invite link → user joins project automatically.
5. User sees linked META·LAB/META·SIFT project according to permissions.

====================================================
TASK 3 — META·SIFT OVERVIEW BUTTON TO OPEN LINKED META·LAB PROJECT
====================================================

Requirement:
From META·SIFT project overview, I should be able to go directly to the linked META·LAB project.

Add a clear button:
“Open linked META·LAB project”

Requirements:
1. Show button only if linked META·LAB project exists.
2. Button must route directly to the correct META·LAB project ID.
3. Do not send user to first project in list.
4. If user does not have permission, show access denied.
5. If no linked project exists, show:
   - “No linked META·LAB project”
   - option to create/link if user has permission

QA:
- From META·SIFT overview, click button.
- Correct META·LAB project opens.

====================================================
TASK 4 — CONTROL LANDING PAGE ANIMATION SPEED FROM OPS CONSOLE
====================================================

Requirement:
Landing page animation speed should be controllable from ops console.

Ops setting:
Landing Page Animation Speed

Suggested options:
- Off
- Slow
- Normal
- Fast

or numeric:
- 0.5x
- 1x
- 1.5x
- 2x

Claude, choose the better UX.

Requirements:
1. Add setting in ops console.
2. Save setting in database/config.
3. Landing page reads setting.
4. Animation speed updates without code change.
5. Add “Reduce motion” compatibility:
   - respect user/browser prefers-reduced-motion
   - allow animation off
6. Default should be tasteful, not distracting.

QA:
- Change speed in ops.
- Landing page animation speed changes.
- Off disables motion.
- Reduced motion is respected.

====================================================
TASK 5 — FIX META·LAB CHAT DRAWER OVERLAP/CLOSE BUG
====================================================

Current issue:
Chat in META·LAB overlaps account and notification icons, and I cannot press X to close it.

Expected:
When chat drawer is opened:
1. It should sit above account and notification icons.
2. It should have correct z-index.
3. X close button must be clickable.
4. Clicking outside should close it.
5. It should not block the page in a broken way.
6. It should not overlap in a way that prevents interaction.
7. It should be responsive.
8. It should behave consistently in META·LAB and META·SIFT.

Implementation:
- fix z-index layering
- use portal/modal layer if appropriate
- ensure drawer overlay captures outside click correctly
- ensure close button is above overlay
- test with notification/account dropdowns

QA:
1. Open chat.
2. Press X.
3. Chat closes.
4. Open chat again.
5. Click outside.
6. Chat closes.
7. Account/notification icons are not broken.

====================================================
TASK 6 — EXPORT/DOWNLOAD FORMAT AND SIZE CHOOSER
====================================================

Requirement:
For any downloadable item, before download, user should be able to choose what file format they want to export/download.

Also, for pictures/figures, user should be able to choose image size to fit journal/conference requirements.

Apply to downloadable items such as:
- PRISMA diagram
- forest plots
- funnel plots
- charts/graphs
- tables
- screening exports
- data extraction exports
- methods/equations exports if applicable
- project reports
- any other export/download feature

Export UX:
Before downloading, show an export dialog/modal.

Options:
File format:
- PNG
- SVG
- PDF
- CSV
- XLSX
- JSON
- RIS
- BibTeX
- DOCX if implemented
- choose only formats that make sense for that item

For images/figures:
- width
- height
- DPI if feasible
- preset sizes:
  - journal single-column
  - journal double-column
  - conference poster
  - presentation slide
  - custom
- transparent background option if feasible
- dark/light background option if relevant

Requirements:
1. Do not force all formats for all items.
2. Show only valid formats for that item.
3. Add export preview if feasible.
4. Add sensible defaults.
5. Add validation for image size.
6. Export should be high quality.
7. Existing download buttons should route through the export dialog.
8. Add server-side export where needed, client-side where appropriate.

Claude, give your opinion on best export architecture:
- shared ExportDialog component
- shared export service
- per-item export adapters

QA:
- Export PRISMA as PNG/SVG/PDF if supported.
- Export chart with custom size.
- Export screening as CSV/JSON/RIS/BibTeX if supported.
- Export data extraction as CSV/XLSX/JSON if supported.
- Confirm files are valid.

====================================================
TASK 7 — DELETE PROJECTS AND LEAVE PROJECTS
====================================================

Requirement:
Add ability to delete projects.

Rules:
1. Only owner can delete project.
2. Leaders cannot delete project unless owner explicitly grants that permission, but default should be owner only.
3. Members and leaders can leave projects.
4. If a project is deleted from META·LAB and it is linked to META·SIFT, it should delete or archive the linked META·SIFT project too.
5. If a project is deleted from META·SIFT and linked to META·LAB, Claude should decide safest behavior:
   - either delete only META·SIFT module project
   - or ask/require owner confirmation to delete whole linked workspace
   - document the behavior clearly

My preference:
For linked workspace deletion from META·LAB:
- delete/archive both META·LAB and META·SIFT together.

Important:
Think about whether hard delete or soft delete is better.
I prefer safety. You should give your opinion.
Probably soft delete/archive is safer, with optional permanent delete later.

Delete confirmation:
Before deleting:
1. Show strong warning.
2. Show what will be deleted:
   - META·LAB project
   - linked META·SIFT project
   - records
   - screening decisions
   - chats
   - exports
   - data extraction
3. Require confirmation.
4. Require typing project name if you think it is safer.
5. Then delete/archive.

Leave project:
1. Members can leave project.
2. Leaders can leave project unless they are the only leader and no owner? Owner still exists, so okay.
3. Owner cannot leave without transferring ownership or deleting project.
4. Leaving removes access.
5. Create audit log.

Backend:
- add delete/archive endpoints
- add leave endpoint
- enforce owner-only deletion
- soft delete preferred
- linked workspace handling
- audit logs

Frontend:
- delete button visible only to owner
- leave button visible to non-owner members
- confirmation modal
- clear consequences

QA:
1. Owner deletes linked META·LAB project.
2. Linked META·SIFT is archived/deleted accordingly.
3. Leader cannot delete by default.
4. Member can leave.
5. Owner cannot leave without ownership transfer/delete.
6. Deleted projects no longer show in normal project list.

====================================================
TASK 8 — OPS CONSOLE SHOULD CONTROL EVERY FEATURE POSSIBLE
====================================================

I want ops console to control every single thing in the apps that makes sense.

Important instruction:
Whenever you add a feature, make sure it can be modified/edited/controlled from the ops console if it is reasonable and safe.

Do not make ops console dangerous or cluttered.
I want your opinion on how to organize it well.

Add more metrics and controls.

Suggested ops sections:
1. Overview
2. Users
3. Roles & Permissions
4. Projects / Workspaces
5. META·LAB settings
6. META·SIFT settings
7. Landing Page settings
8. Notifications
9. Invites
10. Chat settings
11. Export settings
12. Email settings/status
13. Security & Audit
14. System Health
15. Feature Flags
16. Appearance / Theme
17. Animation settings
18. Reports / Diagnostics

Controls to add where appropriate:
- landing animation speed
- enable/disable notifications
- invite expiration duration
- enable/disable email invites
- enable/disable chat
- chat permissions defaults
- export formats allowed
- image export size presets
- project deletion behavior:
  - soft delete/archive
  - hard delete disabled by default
- default META·LAB→META·SIFT auto-link behavior
- default theme
- maintenance message
- feature visibility flags
- AI feature hidden/visible later
- META·SIFT enable/disable
- import duplicate prevention settings

Metrics to add:
- active users today/week/month
- pending invites
- accepted invites
- expired invites
- notifications sent
- notifications clicked/dismissed
- projects deleted/archived
- projects left by members
- exports by format
- chat messages sent
- unread chat counts aggregate
- failed email sends
- successful email sends
- linked workspace count
- unlinked META·LAB projects
- unlinked META·SIFT projects

Security:
1. Admin can control all.
2. Mod can only see limited support areas.
3. Do not expose dangerous controls to Mod.
4. Add audit log for settings changes.
5. Avoid destructive controls unless protected.

UX:
Ops should feel like a control center, but organized.
Do not dump everything into one page.
Use sections, tabs, search, and clear grouping.

====================================================
QA REQUIREMENTS
====================================================

QA must test:

Notifications:
1. Notification click opens target.
2. Notification disappears after click.
3. Badge updates.
4. Notification stays dismissed after refresh/login.

Invites:
1. Invalid email rejected.
2. Existing user added.
3. Non-existing user gets invite.
4. Invite link registration adds user to project.
5. Invited user sees correct linked project.

META·SIFT to META·LAB:
1. Button from META·SIFT overview opens correct META·LAB project.

Landing animation:
1. Ops changes speed.
2. Landing page respects speed.
3. Off/reduced motion works.

Chat:
1. Chat drawer z-index fixed.
2. X close works.
3. Outside click closes.
4. Account/notification icons not broken.

Exports:
1. Download opens format chooser.
2. Valid formats appear.
3. Image size presets work.
4. Custom size validates.
5. Exported files open correctly.

Projects:
1. Owner can delete/archive.
2. Warning confirmation appears.
3. Linked META·SIFT deleted/archived with META·LAB.
4. Leader cannot delete by default.
5. Member can leave.
6. Owner cannot leave without transfer/delete.

Ops:
1. New controls appear.
2. Settings save.
3. Metrics load.
4. Admin sees controls.
5. Mod does not see dangerous controls.
6. Audit log records changes.

Automated tests:
- notification dismiss-on-click
- email validation
- pending invite accept flow
- linked project direct route
- landing animation setting endpoint
- chat drawer UI state if frontend tests exist
- export dialog available formats
- owner-only project delete
- member leave project
- linked delete/archive behavior
- ops settings permissions
- audit logs

Update:
- /tests/report.md
- /tests/screening/report.md if relevant
- docs/manager/final-implementation-report.md

====================================================
FINAL DELIVERABLES
====================================================

Deliver:
1. Notifications dismiss/delete after click.
2. Email validation for add member.
3. Invite email/link flow for non-existing users.
4. Auto-join project after invite registration.
5. META·SIFT overview button to linked META·LAB project.
6. Landing animation speed control from ops console.
7. META·LAB chat overlay/close bug fixed.
8. Export/download format chooser.
9. Image/chart export size chooser.
10. Owner-only project delete/archive.
11. Member/leader leave project.
12. Strong delete warning confirmation.
13. Linked META·LAB delete archives/deletes linked META·SIFT.
14. Expanded ops controls and metrics.
15. Audit logs for major actions.
16. Tests updated.
17. Docs updated.

Final response must include:
1. Your opinion and decisions.
2. Invite architecture.
3. Notification behavior.
4. Export architecture.
5. Project delete/archive behavior.
6. Ops console organization.
7. Backend changes.
8. Frontend changes.
9. Database changes.
10. Manual QA results.
11. Automated test results.
12. Known limitations.
13. Recommended next steps.

Do not return until implemented, tested, and documented.
after you finish, delete all the files that area not neccessary in this project, all the temporary files, and those that are not needed any more. 