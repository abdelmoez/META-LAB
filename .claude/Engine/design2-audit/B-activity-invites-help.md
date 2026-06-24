# Topic B — Activity / Invitations & Collaboration / Help & Feedback / My Work

Read-only audit for the design2.md Stitch-vs-legacy redesign. Every surface below maps to **real, existing** server data and api-client methods. No fake/empty pages required. File:line citations are exact as of this audit.

---

## 0. EXECUTIVE SUMMARY (build vs reuse, per surface)

| Surface | Verdict | Primary data source |
|---|---|---|
| **Notification bell** | **ALREADY EXISTS — DO NOT DUPLICATE.** `src/frontend/components/NotificationsBell.jsx` is a complete, shared, polling+SSE bell with badge, history, deep-links. Reuse it verbatim. | `notificationsApi` → `/api/notifications/*` |
| **Activity** | **Build a real lightweight per-project feed** from the existing leader-only audit log; OR (cross-project) aggregate `Notification` rows (already powering the bell). No dedicated global activity endpoint exists. | `screeningApi.getAudit(pid)` (leader-only) + `Notification` model |
| **Invitations & Collaboration** | **Mixed.** Real data exists for: pending/active members per project (`screeningApi.listMembers`), accepting an invite token (`api.invites` — NOT in api-client yet, route exists), and incoming invite notifications (bell). There is **NO "all my pending invitations across projects" endpoint** — must be derived. | `ScreenProjectMember`, `/api/invites/:token`, `Notification` |
| **Help & Feedback** | **Reuse the existing contact pipeline.** `api.contact({name,email,message})` → `POST /api/contact` → `ContactMessage` table (Ops console reads it). Build a small in-app form that calls it; do NOT invent a new endpoint. | `api.contact` → `ContactMessage` |
| **My Work** | **Build a real per-user view by fanning out over the user's project list.** No single aggregate endpoint exists, but every actionable item is derivable per-project from existing, permission-safe endpoints. | `screeningApi.listProjects` + `getStats`/`getOverview`/`listConflicts` + `robApi.listAssessments` |

---

## 1. NOTIFICATION BELL — ALREADY EXISTS (do not rebuild)

**Component:** `src/frontend/components/NotificationsBell.jsx` (full impl, 390 lines).
- Default export `NotificationsBell({ fixed = false, right = 16 })` — `NotificationsBell.jsx:74`.
- Self-contained: badge, dropdown panel, "Mark all read", "Show history" (`?all=1`), deep-link click-through, outside-click/Escape close.
- Polls `unread-count` every 30s (`POLL_MS`, `NotificationsBell.jsx:41`), stretches to 120s while SSE healthy (`HEALTHY_POLL_MS`, `:44`), pauses on hidden tab (`:130`).
- Realtime via `useRealtime({ 'notification.created': ... })` (`:118`).
- Deep-links: `relatedMetaLabProjectId → /app?project=<id>`, else `relatedScreenProjectId → /sift-beta/projects/<id>` (`targetUrl`, `:67`).
- Designed to mount on all 4 surfaces (workspace, SIFT dashboard, SIFT project, ops) per its own header comment (`:2-3`).

**Implication for redesign:** The Stitch shell should simply render `<NotificationsBell fixed .../>` (or inline). **Building a second bell or a separate "notifications page" would duplicate working infrastructure.** An "Activity" surface, if desired, should be a *fuller list view of the same data*, not a competing bell.

### Notification client (`src/frontend/api-client/notificationsApi.js`)
```
notificationsApi.list(params={unread?,page?,limit?,all?})  → GET /api/notifications        (notificationsApi.js:39)
notificationsApi.unreadCount()                             → GET /api/notifications/unread-count (:50)
notificationsApi.markRead(id)                              → POST /api/notifications/:id/read    (:53)
notificationsApi.opened(id)                                → POST /api/notifications/:id/opened  (:60)  (read+dismiss+clicked, idempotent)
notificationsApi.dismiss(id)                               → POST /api/notifications/:id/dismiss  (:63)
notificationsApi.markAllRead()                             → POST /api/notifications/mark-all-read (:66)
```

### Returned shape — `notificationsApi.list(...)`
Controller `listNotifications` (`server/controllers/notificationsController.js:29`) returns:
```json
{ "notifications": [ <Notification> ], "total": <int>, "unreadCount": <int> }
```
Each `<Notification>` (shaped by `shapeNotification`, `notificationsController.js:15`) carries the raw `Notification` columns PLUS two response aliases:
```
id, userId, type, title, message, app ('metalab'|'metasift'|'workspace'),
relatedScreenProjectId, relatedMetaLabProjectId, actorId, actorName, actorEmail,
role, readAt, dismissedAt, clickedAt, createdAt,
relatedWorkspaceId (= relatedScreenProjectId),       // alias added in shapeNotification
relatedMetaSiftProjectId (= relatedScreenProjectId)  // alias added in shapeNotification
```
(Schema: `server/prisma/schema.prisma:393-413`.) `type` is a free string, e.g. `PROJECT_INVITE | ROLE_CHANGED` (`schema.prisma:396`).

### Permission constraints
- Router `server/routes/notifications.js`: `router.use(requireAuth)` (`:24`) — auth required, **per-user scoped**. Every read/write is `where:{ userId: req.user.id }` (`notificationsController.js:31,68,82,99,123,153`). A foreign id → **404** (existence hiding). No rate limiter on this mount (deliberate — the bell polls; `routes/notifications.js:7-8`).
- `unread` = `readAt null AND dismissedAt null` (`notificationsController.js:69`).

### Recommendation — Activity surface
There is **no dedicated `/api/activity` or "recent activity feed" endpoint**. Two real options:

1. **Global "Activity" = a fuller notification list (RECOMMENDED, cheapest).** Reuse `notificationsApi.list({ all:true, limit:50 })`. This is the only truly *per-user, cross-project* event stream that exists. Render as a full page/drawer instead of the 340px bell popover. Permission-safe by construction (user-scoped). This is real data: invites accepted, role changes, etc.

2. **Per-project "Activity" = the audit log (leader-only).** `screeningApi.getAudit(pid)` → `GET /api/screening/projects/:pid/audit`. Controller `getAuditLog` (`server/controllers/screeningOverviewController.js:157`) returns:
   ```json
   { "entries": [ { id, actorId, actorName, action, entityType, entityId, details, createdAt } ] }   // newest first, take 200 (:165)
   ```
   **Hard constraint:** `if (!access.isLeader) return 403` (`screeningOverviewController.js:161`). So a per-project activity tab is **leader-only** — fine for a project command-center, NOT for a general member's dashboard.

**Verdict:** Build a lightweight Activity view backed by `notificationsApi.list({all:true})` for the global/per-user case (real data, no new endpoint, permission-safe). Optionally surface `getAudit(pid)` inside a project for leaders only. Do **not** ship an empty "coming soon" activity page.

---

## 2. INVITATIONS & COLLABORATION

### What real data exists

**(a) Project members + pending invites (per-project).**
`screeningApi.listMembers(pid)` → `GET /api/screening/projects/:pid/members` (`screeningApi.js:108`).
Controller `listMembers` (`server/controllers/screeningMemberController.js:61`) returns:
```json
{
  "members": [ <ShapedMember> ],   // includes status:'pending' rows = outstanding invites
  "myRole": "...", "myUserId": "...", "ownerId": "...",
  "isLeader": bool, "isOwner": bool, "canManageMembers": bool
}
```
`ScreenProjectMember.status` ∈ `active | inactive | pending` (`schema.prisma:691`); `userId` is **null for pending invites** to unregistered emails (`schema.prisma:686`). Invite lifecycle columns live on the same row: `invitedByUserId, inviteTokenHash, inviteExpiresAt, inviteAcceptedAt` (`schema.prisma:716-724`).
**Permission:** `listMembers` requires project access (`getProjectAccess`, `screeningMemberController.js:63`) — any active member can read the roster; `canManageMembers` flag is returned so the UI can gate mutate actions.

**(b) Look up a user before invite (collaboration add flow).**
`screeningApi.lookupMember(pid, email)` → `GET /api/screening/projects/:pid/members/lookup?email=` (`screeningApi.js:111`).
Controller `lookupUser` (`screeningMemberController.js:102`). **Permission: `canManageMembers`-gated** — `if (!access.canManageMembers) return 403` (`:106`). Returns:
```json
{ "found": false }
| { "found": false, "pendingInvite": true, "currentRole": "...", "status": "..." }
| { "found": true, "alreadyMember": false, "user": { id, name, email } }
| { "found": true, "alreadyMember": true, "currentRole": "...", "status": "...", "user": {...} }
```

**(c) Add / update / remove / leave / transfer (mutations).**
```
screeningApi.addMember(pid, { email, preset, modules? })   POST  /projects/:pid/members      (screeningApi.js:114)
screeningApi.updateMember(pid, mid, body)                  PATCH /projects/:pid/members/:mid  (:116)
screeningApi.removeMember(pid, mid)                        DELETE                              (:117)
screeningApi.leaveProject(pid)                             POST  /projects/:pid/leave          (:120)  → 200 {left:true}; owner gets 400 transfer-first
screeningApi.transferOwner(pid, toUserId)                  POST  /projects/:pid/transfer-owner (:125)
```

**(d) Accepting an invite (token ceremony).**
Routes exist: `server/routes/invites.js` — `GET /api/invites/:token` (PUBLIC, `:15`) and `POST /api/invites/:token/accept` (requireAuth, `:16`).
- `getInvite` (`server/controllers/invitesController.js:79`) returns sanitized landing info: `{ projectName, inviterName, roleLabel, email (masked), expiresAt }` (`:93-99`). 404 invalid/revoked/accepted, 410 expired.
- `acceptInvite` (`:113`) binds the pending row to the logged-in user, returns `{ projectId, projectName }` (`:178`), fires a welcome `Notification` (`:168`) and an SSE `members.changed` poke (`:176`).
- **GAP:** there is **no `api.invites` method in `apiClient.js`** — the route exists but the main api-client does not yet expose it (the invite landing flow calls `fetch` directly or a page-local helper). If the redesign adds an "Accept invite" UI, add `api.invites = { get(token), accept(token) }` to `apiClient.js` mirroring the route.

**(e) Incoming invitations as notifications.** `Notification.type === 'PROJECT_INVITE'` rows (created by `notifyProjectInvite`, called from `acceptInvite` and `addMember`) surface in the bell with `role` (granted preset) and `actorName`/`actorEmail` (the inviter). This is the **real per-user "you were invited" feed** and it is cross-project.

### The missing piece — "My pending invitations" (cross-project)
There is **NO endpoint that lists all invitations awaiting the current user across all projects.** Pending invite rows (`status:'pending'`, `userId:null`) are keyed by **email**, and the per-project roster endpoint requires you to already be in the project. So an "Invitations" inbox must be derived one of two ways:

1. **From notifications (RECOMMENDED, real, per-user):** `notificationsApi.list({ all:true })` filtered to `type === 'PROJECT_INVITE'`. These are the actual invite events delivered to this user. Deep-link via `relatedScreenProjectId`. Permission-safe (user-scoped). Cheapest and accurate for *received* invites.
2. **From the project list (for OUTSTANDING/SENT invites a manager owns):** fan out `screeningApi.listProjects()` → for each project where `canManageMembers`, call `listMembers(pid)` and filter `members` to `status==='pending'`. This shows invites *you sent* that are unaccepted. Heavier (N calls) and only meaningful for owners/leaders.

### Recommendation — Invitations & Collaboration surface
- **Collaboration / roster management:** REUSE the existing screening Members tab data (`listMembers`, `addMember`, `lookupMember`, `updateMember`, `removeMember`). It is complete and permission-correct. The redesign can re-skin `src/frontend/screening/tabs/MembersTab.jsx`'s data flow.
- **"Invitations" inbox (received):** Build a lightweight view over `notificationsApi.list({all:true})` filtered to `PROJECT_INVITE`. Real data, per-user, no new endpoint.
- **Accept-invite UI:** route layer exists; add the thin `api.invites` client wrapper if a new accept page is built.
- Do **not** create an empty invitations page — back it with `PROJECT_INVITE` notifications.

---

## 3. HELP & FEEDBACK

### Existing pipeline (real, end-to-end)
`api.contact(body)` → `POST /api/contact` (`apiClient.js:380`):
```js
contact: (body) => req(`${BASE}/contact`, { method: "POST", ...json(body) })   // apiClient.js:380-381
```
Route `server/routes/contact.js` (`POST /`, **no auth required**, `:7`). Validates `email` + `message` required (`:10-15`), accepts optional `name` and `subject`, and writes a `ContactMessage` row (`:16-23`). Returns `{ ok: true }` (`:24`).

`ContactMessage` model (`schema.prisma:304-326`): `id, email, name?, subject?, message, read, archived, origin('contact_form'), replied, repliedAt, readAt, readByUserId, readByName, createdAt`. **The Ops/admin console already reads & replies to these** (origin field, replies relation, shared read-state) — so feedback submitted in-app lands in a real, monitored inbox, not a void.

### Current usage
The contact form currently lives only in the **public marketing Landing page** (`src/frontend/pages/Landing.jsx:638` state, `:656` `await api.contact(contact)`, form at `:1533`) and is referenced in `Terms.jsx`. There is **no in-app (authenticated) Help/Feedback destination today.**

### Recommendation — Help & Feedback surface
**REUSE `api.contact`.** Build a small in-app Help & Feedback form/drawer that calls `api.contact({ name, email, message, subject })`. This is real data into a monitored table; no new endpoint needed. Pre-fill `name`/`email` from `useAuth().user` for signed-in users (the route does not require auth but accepts those fields). Optionally pass `subject: 'In-app feedback'` so Ops can distinguish it (the `origin`/`subject` columns already exist). Static help/docs content can sit alongside, but the feedback path is fully backed.

---

## 4. MY WORK (dashboard, per-user actionable items)

**Key architectural fact:** There is **no single cross-project "my work" aggregate endpoint.** All per-user work items must be assembled client-side by:
1. `screeningApi.listProjects()` → the user's owned + active-member projects (`screeningController.js:91`), then
2. fanning out per-project to the endpoints below.

`listProjects` returns (per project, `screeningController.js:143-162`): `id, title, stage, blindMode, requiredScreeningReviewers, progressStatus, archived, recordCount, memberCount, myRole/currentUserRole ('owner'|'leader'|'reviewer'|...), isOwner, owner, ...`. This already gives a real "my projects" list with the user's role per project — the backbone of a My Work view.

### Derivable per-user actionable items (each with exact source + scope)

| My Work item | Data source / api-client | Per-user or per-project | Permission constraint | Notes |
|---|---|---|---|---|
| **Unscreened / assigned screening (records I still owe a decision)** | `screeningApi.getStats(pid)` → `GET /projects/:pid/stats` (`screeningApi.js:103`) | **Per-user, per-project.** `getStats` counts the **caller's own** decisions (`reviewerId: req.user.id`, `screeningController.js:1728`) | Any project member with access. | Returns `{ total, screened, included, excluded, maybe, undecided, conflicts, duplicates, progress }` (`:1738-1747`). `undecided` = records this user has NOT decided. This is the cleanest "my queue size" signal. |
| **My screening progress (count + %)** | `screeningApi.getOverview(pid)` → `members` filtered to me (`screeningOverviewController.js:84` `myProgress`) | **Per-user, per-project.** Non-leaders receive ONLY their own row (`:85` `visibleMembers = isLeader ? all : myProgress`) | Member access; server enforces own-only visibility for non-leaders. | `{ screened, included, excluded, maybe, undecided, progress }` per member. Real per-user numbers, blind-safe. |
| **Unresolved conflicts I can act on** | `screeningApi.listConflicts(pid)` → `GET /projects/:pid/conflicts` (`screeningApi.js:77`) | **Per-project (action-gated per-user).** | **`canResolveConflicts`-gated** — `if (!access.canResolveConflicts) return 403` (`screeningController.js:1406`). Leaders + members granted the flag only. | Use `getStats(pid).conflicts` (unresolved count, `screeningController.js:1729`) as the *badge* for everyone; only fetch the list / show "Resolve" for users with the permission. Counting is safe for all; the list is restricted. |
| **Pending Risk of Bias assessments** | `robApi.listAssessments(projectId)` → `GET /api/rob/projects/:projectId/assessments` (`robApi.js:25`) and `robApi.listStudies(projectId)` (`:27`) | **Per-project** (assessments carry `reviewerId`, so a per-user "my drafts" subset is derivable) | RoB endpoints **404 when flag `rob_engine_v2` is OFF or caller lacks project access** (`robApi.js:5`); also `canAssessRiskOfBias` member flag (`schema.prisma:711`). Gate the whole RoB My-Work block behind `robFlagEnabled()` (`robApi.js:42`). | `RobAssessment.status ∈ draft|complete|consensus` (`schema.prisma:850`), `reviewerId` (`:848`). "Pending RoB" = studies in universe with no `complete` assessment by me, or my `draft` rows. Operates on META·LAB projects (RobAssessment.projectId → `Project`, `schema.prisma:841`), not ScreenProjects. |
| **Incomplete extraction** | No dedicated extraction-progress endpoint surfaced. Extraction state lives in the META·LAB `Project.data` blob (workspace monolith) and `finalStatus:'accepted'` records flow to extraction. | Per-project, **weak signal** | — | Reliable proxy: `getOverview(pid).dataSummary.acceptedToExtraction` (`screeningOverviewController.js:140`) = count handed to Data Extraction. There is **no clean per-user "rows I still need to extract" count** — recommend NOT promising this item, or show only the accepted-to-extraction count as "ready to extract". |
| **Pending invitations (received)** | `notificationsApi.list({all:true})` filtered `type==='PROJECT_INVITE'` (see §2) | **Per-user, cross-project** | User-scoped (safe). | This is the one genuinely global per-user item — reuse the bell's data. |
| **Outstanding invites I sent (as manager)** | fan-out `listMembers(pid)` → `status==='pending'` for projects where `canManageMembers` | Per-project | `listMembers` needs access; pending rows visible to members; manage actions gated by `canManageMembers`. | Optional; heavier. |

### Recommendation — My Work surface
**Build a real, lightweight My Work dashboard** assembled client-side:
1. Call `screeningApi.listProjects()` once → render the user's projects with `myRole`.
2. For each project (or top-N most recent), call `getStats(pid)` to get **`undecided`** (my screening queue) and **`conflicts`** (badge). Both are real and per-user-correct (`undecided` derives from the caller's own decisions).
3. Optionally call `robApi.listAssessments(pid)` **only when `rob_engine_v2` is enabled** to surface my draft/pending RoB.
4. Surface "Invitations" from `notificationsApi.list({all:true})` `PROJECT_INVITE` rows.

**Every tile maps to real data.** Avoid the "incomplete extraction" tile unless you scope it to `acceptedToExtraction` (a project-level "ready for extraction" count), since there is no per-user extraction-progress source. Respect the permission gates: show conflict *counts* to everyone but the *resolve list* only when `canResolveConflicts`; gate RoB behind the flag + `canAssessRiskOfBias`.

**Performance note:** there is no aggregate endpoint, so My Work is N+1 (one `listProjects` + one `getStats` per project). For many projects, cap the fan-out (e.g. recent/active projects) or consider that a thin new aggregate endpoint would be the only "new server work" justified by this surface. The redesign can ship without it by limiting the fan-out.

---

## 5. CROSS-CUTTING FACTS / GOTCHAS

- **api-client split:** main app uses `src/frontend/api-client/apiClient.js` (`export const api`); screening uses `src/frontend/screening/api-client/screeningApi.js` (`export const screeningApi`); notifications use `src/frontend/api-client/notificationsApi.js` (`notificationsApi`); RoB uses `src/frontend/rob/robApi.js` (`robApi`). All four use the same `credentials:'include'` cookie-auth `req()` pattern. A My Work / Activity / Invitations view will import from **multiple** clients.
- **Realtime:** `GET /api/events` (SSE, `server/routes/events.js`) is identity-only thin pokes; the bell already consumes it via `useRealtime`. Activity/My-Work tiles can subscribe to `members.changed`, `notification.created`, etc. for live refresh without polling.
- **Notification deep-link mismatch to watch:** bell links SIFT projects to `/sift-beta/projects/<id>` (`NotificationsBell.jsx:71`); the screening api lives under `/api/screening` and metalab door under `/sift-beta/...`. Reuse the bell's `targetUrl()` logic rather than re-deriving routes.
- **No global activity/audit table for non-leaders:** `ScreenAuditLog` (per-project, leader-only via `getAudit`) and `ScreenProjectStatusEvent` (`schema.prisma:432`, used for Ops "done today" metrics, **no per-user read endpoint**) are NOT a member-facing activity feed. The only per-user cross-project event stream is `Notification`.
- **ContactMessageRead / shared read-state** exists for Ops triage of feedback (`schema.prisma:320-325,332`) — confirms feedback is actively monitored, so an in-app feedback form is a real destination.

---

## 6. ANSWERS TO THE EXPLICIT QUESTIONS

- **Is there an existing notification bell?** **YES** — `src/frontend/components/NotificationsBell.jsx`, fully functional, shared, polling+SSE, with history and deep-links. **Reuse it; do not duplicate.**
- **Activity:** No dedicated endpoint. Build over `notificationsApi.list({all:true})` (per-user, cross-project) and/or `screeningApi.getAudit(pid)` (per-project, **leader-only**).
- **Invitations & Collaboration:** Roster + invite mutations fully exist (`screeningApi` members family + `/api/invites/:token` routes). No "all my invitations" endpoint — derive received invites from `PROJECT_INVITE` notifications; derive sent-pending from `listMembers` fan-out. Add `api.invites` wrapper if an accept page is built (route exists, client method missing).
- **Help & Feedback:** Reuse `api.contact()` → `POST /api/contact` → `ContactMessage` (Ops-monitored). Build a small in-app form; no new endpoint.
- **My Work:** No aggregate endpoint; assemble from `listProjects` + per-project `getStats` (my `undecided`/`conflicts`), `getOverview` (my progress, non-leader own-only), `listConflicts` (gated by `canResolveConflicts`), `robApi.listAssessments` (flag-gated). Drop or down-scope "incomplete extraction" (no per-user source).
