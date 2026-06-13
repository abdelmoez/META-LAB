# META·LAB / META·SIFT — Final Implementation Report

## prompt9 — Notifications, Invites, Exports, Project Delete, Chat Fix, Ops Expansion (2026-06-12)

Date: 2026-06-12 · Version: **2.7.0** · Brief: `.claude/Prompts/prompt9.md` (8 tasks)
Baseline: v2.6.0 — screening 249/249, full repo 883 pass / 6 quarantined / 7 skip.
Result: **screening 272/272 (+23 `prompt9.test.js`) · full repo 906 pass / 6 pre-existing fail / 7 skip ·
`npm run build` exit 0 · flipped assertions: NONE.**

Design rationale, invite architecture, delete-vs-archive decision, export architecture, ops-scope opinion,
and security analysis: [`claude-opinion-notifications-invites-exports-ops.md`](claude-opinion-notifications-invites-exports-ops.md).
API surface deltas: `server/docs/{api-contract, screening-api-contract, admin-api-contract, email-setup}.md`
(each has a "Prompt 9 additions" section).

**Delivered (all 17 deliverables):**
1. **Notification click = open + read + dismiss** — new idempotent `POST /api/notifications/:id/opened`
   stamps readAt/dismissedAt/clickedAt; the bell awaits it before full-reload navigation, removes the row
   optimistically, and gained a "Show history" toggle (`?all=1`). Survives refresh and re-login.
2. **Email validation** on add-member (frontend + backend, both apps' UIs) and register.
3. **Invite tokens** — pending member row carries the ceremony (invitedBy, SHA-256 token hash, expiry,
   acceptedAt); public `/api/invites/:token` landing + accept; styled `renderInviteEmail`; copyable-link
   fallback in the 201 response when SMTP is unconfigured.
4. **Auto-join after invite registration** — register accepts `inviteToken` (token claim alongside the
   legacy email-match claim); mismatched-email accept binds the row to the accepting account; single-use.
5. **META·SIFT Overview → linked META·LAB button** — `getOverview` additive `linkedMetaLab
   {id,title,missing,canOpen}`; the card covers open / access-denied / missing / link-a-project states.
6. **Landing animation speed from ops** — `landingContent.animationSpeed` (Off/Slow/Normal/Fast segmented
   control in Content→Animation), wired via `--lp-dur` CSS multiplier + HeroCanvas rate;
   `prefers-reduced-motion` always wins; Off reuses the static path.
7. **Chat drawer fixed** — root cause was stacking-context entrapment (drawer's z 10000 capped inside the
   monolith's fixed z-9999 wrapper, bell/account z-9999 later siblings painting over the X). The open
   overlay now portals to `document.body` (first `createPortal` in the codebase); drawer stays mounted
   while closed so unread poll + SSE survive. Consistent in both apps.
8/9. **Export dialog + size chooser** — shared `ExportDialog` + `exportCore` (journal single/double column,
   poster, slide, custom 320–6000 px, transparent background, light/dark variants) with per-item adapters;
   all ~14 triggers routed through it (8 monolith adapters incl. the funnel plot's first-ever export +
   SIFT ExportTab); RIS added server-side; `exportTools` flag now actually enforced; exports recorded
   for the by-format metric.
10–13. **Project lifecycle** — soft delete both apps (`deletedAt` + `deletedSource 'owner'|'admin'`),
   owner-only, typed-name confirmation server-side (`POST /api/projects/:id/delete`), linked cascade
   ML→SIFT (SIFT→ML deliberately one-way), autosave resurrection guard (200 `{skipped:true}`, never
   revives), member/leader **leave** endpoint + UI, admin restore for both apps, audit trail survives
   (SIFT audits before the mark — hard delete used to cascade its own audit log away).
14. **Ops expansion** — no new sections (anti-clutter decision): Settings grouped cards (Platform /
   Notifications & Invites / Exports / Projects), new enforced settings (`registrationOpen` 403 gate,
   `maintenanceMode` 503 gate with configurable message + staff bypass, `notificationsEnabled`,
   `emailInvitesEnabled`, `defaultTheme`, `exportFormats`, `inviteExpiryDays` 1–90), Engagement metrics
   card (invites, notification funnel, lifecycle, emails, linking, exports-by-format) powered by the new
   no-FK `UsageEvent` table. Fixed a latent bug: flat Settings edits were silently dropped server-side.
15. **Audit** — previously-unaudited `updateScreeningSettings`/`updateScreeningProjectStatus` now log;
   INVITE_REVOKED / MEMBER_LEFT / PROJECT_DELETED / RESTORE_SIFT_PROJECT actions added.
16/17. **Tests + docs** — +23 integration tests (`tests/screening/integration/prompt9.test.js`, with an
   anti-vacuous-green reachability guard and finally-block setting resets); 55/55 server-side smoke
   (`smoke-b2`); reports updated; four contract docs extended.

**DB (one additive migration `prompt9_invites_lifecycle_usage`):** Notification.clickedAt;
ScreenProjectMember.{invitedByUserId, inviteTokenHash @unique, inviteExpiresAt, inviteAcceptedAt};
Project.deletedSource; ScreenProject.{deletedAt, deletedSource}; new UsageEvent. No data wiped; no FK added.

**Known limitations (deliberate, documented in the opinion doc):** ownership transfer not implemented
(owner must delete; error copy says so); owner-side restore is admin-mediated; XLS export stays the honest
HTML-based `.xls`; invite emails not sent to already-registered users (in-app notification instead);
invite-expiry 410 covered by smoke, not the API-only vitest suite.

---

# prompt6 Final Implementation Report (historical)

Date: 2026-06-10 · Version: **2.5.0** · Brief: `.claude/Prompts/prompt6.md` (19 tasks + 22 final-QA items)
Baseline: v2.4.0 — screening suite 216/216, full repo 632 pass / 6 quarantined fail / 7 skip.
Result: **screening 239/239 · full repo 866 pass / 6 pre-existing fail / 7 skip · `npm run build` exit 0.**

---

## 1. Claude/team opinions and implementation decisions

The full per-agent opinions (Main Claude, Backend/Auth/DB, Frontend, Research Engine, Collaboration & Realtime, QA, Website Manager) and the chosen plan are in
[`docs/manager/team-opinion-and-implementation-plan.md`](team-opinion-and-implementation-plan.md). The decisions that shaped everything:

- **The Review Workspace IS the `ScreenProject` row** (unanimous). It already carries owner, members + 17 permission flags, the link (`linkedMetaLabProjectId`), PICO snapshot, status, and audit. `workspaceId == ScreenProject.id`; API responses alias it (`relatedWorkspaceId`). No physical `ReviewWorkspace` table — a multi-table data migration mid-release was judged the largest regression risk for zero functional gain.
- **SSE pokes + polling fallback, not WebSocket** — nothing in the product is client→server bidirectional; thin `{type, projectId, at}` events make data leaks structurally impossible (clients refetch through already-authorized endpoints).
- **403-vs-404 policy**: outsiders keep 404 (existence-hiding); only authenticated, active members lacking the specific permission get 403.
- **Viewer autosave stays `200 + skipped:true`** — the batch autosave bridge `Promise.all`s every project; a 4xx would lose the user's *own* edits. Enforcement happens at the client write choke point + the per-endpoint server guards; the contract is pinned by a dedicated test.
- **`createLinkedSift` is API-opt-in** (frontend checkbox defaults it ON) so legacy API behavior never drifts.
- **One additive migration**, no FK cascade from Notification/LoginEvent to User (metrics/notifications must survive user deletion).

Major decided deviations recorded by implementers (vs the literal plan):

| Deviation | Who | Why |
|---|---|---|
| Claim-on-register also flips member `status pending→active` | B1 | without it the claimed member has zero access and the invite notification's "Open project" would 404 |
| `modules:'metasift'` also clears `canEditMetaLab` | B1 | `metalabAccess` computes view from `full||canViewMetaLab||canEditMetaLab` — a leftover edit flag would silently re-grant META·LAB visibility |
| Member rename implemented on existing `PUT /api/projects/:id` (plan said PATCH) | B3 | only PUT is wired in `server/routes/projects.js`; plan allowed "the existing update route" |
| META·LAB export gated on `canExport` (not the SIFT flag `canExportRecords`) | B3 | `canExport` is the META·LAB-group flag in `PERMISSION_KEYS`; the brief's `canExportMetaLab` ≡ `canExport` |
| `importReferences` (META·LAB) extended to the same access+perm pattern | B3 | Task 5 says viewers cannot import; previously ALL members 404'd there |
| SIFT rename gate kept as `canManageSettings` | B2 | code reality; superset of "owner/leader", pre-existing behavior |
| Inactive members get 403 (not 404) on audited endpoints | B2 | consistent with the existing `saveDecision` convention; pending invites and outsiders stay 404 |
| Admin status events written only for `progressStatus` transitions (not stage/archive flips) | B4 | the table is progressStatus history; stage values would pollute the done-today metric |
| Mods keep limited *write* user management (edit/status/reset) | B4 | brief says "limited user management", not read-only; server guards were already correct since prompt4 |
| UI excludes the `leader` preset for non-owner managers | F2 | server 403s leader-minting by non-owners — followed code, not the plan's "all presets except owner" |
| `Frac` helper shipped unused; all equations are linear Unicode | F1 | sanctioned by the plan; KaTeX (~280 KB) rejected for a fixed self-authored equation set |
| `hasPendingSave()` widened to cover the in-flight PUT window | RT | required for the "never apply a remote refetch while dirty" guarantee |
| `linkMetaLab`/`resolveConflict` emits + targeted `permissions.changed` on removeMember | RT | mutations whose views would otherwise stay stale; a removed member's open page must revalidate |

## 2. Backend changes (B1–B4 + realtime server side)

**B1 — notifications, logins, lastActive, member modules**
- `server/controllers/notificationsController.js` (new) — list (`?unread=1`, `?all=1`, paginated), unread-count, read, dismiss, mark-all-read; every read/write scoped `{id, userId}` (cross-user probe → 404); responses alias `relatedWorkspaceId`/`relatedMetaSiftProjectId` = `relatedScreenProjectId`.
- `server/services/notificationService.js` (new) — `createNotification` + `notifyProjectInvite`; creation is fire-and-forget (`.catch(()=>{})`) so a notification failure can never fail an invite.
- `server/routes/notifications.js` (new) — own router behind `requireAuth` only, mounted at `/api/notifications` in `server/index.js` — deliberately **never** under the rate-limited `/api/auth` or `/api/admin` mounts (the bell polls).
- `server/controllers/authController.js` — `recordLoginEvent()` fire-and-forget on login success / wrong-password (existing user) / suspended attempt; `lastActive` write on login success; `claimPendingScreenInvites()` on register — claims pending (`userId:null`) `ScreenProjectMember` rows by email, activates them, and creates the deferred `PROJECT_INVITE` notification.
- `server/middleware/auth.js` — `touchLastActive()`: module-level `Map<userId, epochMs>` throttle (one DB write per user per 5 min), never awaited, error-swallowed. Covers "opens app / saves / screens / sends message" since everything flows through `requireAuth`.
- `server/controllers/screeningMemberController.js` — `addMember` accepts `modules:'metalab'|'metasift'|'both'` (invalid → 400) mapping the canView* flags; emits `PROJECT_INVITE` for registered invitees; `updateMember` emits `ROLE_CHANGED` on real role/preset change to someone other than the actor.

**B2 — screening core (`server/controllers/screeningController.js` + `server/screening/picoSnapshot.js` new)**
- `createProject`: validates a provided `linkedMetaLabProjectId` (caller-owned + live, else 400 — previously stored unvalidated); snapshots PICO via `snapshotPico()`; accepts `alsoCreateMetaLab?:boolean` for the SIFT-side optional flow (warning in response if the ML side fails; SIFT project still created).
- `getProject`: adds `linkedMetaLabProjectTitle`; lazily refreshes `picoSnapshot` from the linked ML project (compare-before-write, detached, error-swallowed).
- `updateProject`: writes a `ScreenProjectStatusEvent` on real `progressStatus` transitions; rename **sync-if-in-sync** — a title change propagates to the linked ML project iff the titles were equal before.
- `importRecords`: owner-only guard replaced by access guard (outsider 404 / member without `canImportRecords||leader||owner` 403); SHA-256 fingerprint over CRLF→LF-normalized content; per-project hash hit → **409 `duplicate_import`** with batch provenance unless `force:true`; DOI/PMID/normalized-title record dedupe always on (even forced); response `{imported, skippedDuplicates, total, batchId}`.
- Same access+perm audit applied to export (`canExportRecords`), duplicates detect/resolve (`canManageDuplicates`), labels/reasons (leader), `listDecisions` (any active member, own decisions only); `deleteProject`/`createRecord`/`deleteRecord` stay owner-only.
- `getMetaLabSummary`: membership-aware — the root cause of "members don't see the link" was an `ownerId: req.user.id` filter.

**B3 — META·LAB projects (`projectsController.js`, `store.js`, `importExportController.js`, `screening/metalabAccess.js`, `screening/createScreenProject.js` new)**
- `POST /api/projects {name, createLinkedSift?:true}` → creates the ML project plus a linked ScreenProject server-side (shared helper `createScreenProject.js`: same owner/title, PICO snapshot, seeded reasons/keywords, owner member row); response `{project, linkedScreenProject}`; SIFT failure never rolls back the ML project (`warning` instead). Default-off keeps the legacy bare-project 201 byte-compatible.
- `GET /api/projects` / `/:id` annotate every accessible row with `_linkedMetaSift:{id,title}|null` and `_permissions:{role,isOwner,canView,canEdit,readOnly,canExport}` (underscore keys stripped on persist by `store.projectToData`). Link reverse-lookup enforces the owner invariant (`ScreenProject.ownerId === Project.userId`) and uses the new index.
- `PUT /api/projects/:id` gains a member path: outsider 404, member without edit 403 ("Read-only access…"), member with `canEdit` 200; rename sync-if-in-sync ML→SIFT.
- `store.save()` foreign-owner throw is typed (`code:'FOREIGN_PROJECT'`, status 403) — was a 500; autosave maps it to `200 {skipped:true}`.
- `exportProject` gated on `canExport`, `importReferences` on `canEdit` (member writes go through `saveAsMember`, never reassigning ownership).

**B4 — ops backend (`adminController.js`, `screeningAdminController.js`, `routes/admin.js`)**
- `GET /api/admin/metrics` adds `logins:{day,week,month,quarter,year}` — distinct successful-login userIds per rolling window (24h/7d/30d/90d/365d).
- `GET /api/admin/screening/metrics` adds `doneToday/doneThisWeek/doneThisMonth` — `COUNT(DISTINCT projectId)` of `done` status events per calendar bucket.
- `GET /api/admin/projects` rows add `owner{id,name,email}`, `status`, `linkedMetaSift{id,title}|null`, `workspaceId`; SIFT admin list rows add `workspaceId`, `status`, `linkedMetaLab`; SIFT admin project detail adds the 10-field `progress` block + `memberProgress[]`.
- `PATCH /api/admin/screening/projects/:id/status` accepts `progressStatus` (validated; new 400 message `'Provide stage, disabled/archived, or progressStatus'`) and writes status events on real transitions.
- Admin rate limiter reshaped: 60 → 300/15min in production (1000 otherwise), with `GET /console` and `GET /contact-messages/unread-count` exempt so a mod's own badge polling can never 429 it out of the console.

**RT server side** — `server/realtime/bus.js` + `server/routes/events.js` (new) and one-line emit hooks in `screeningController`, `screeningMemberController`, `screeningChatController`, `screeningReviewController`, `screeningAdminController`, `projectsController`, `notificationService` — see §5.

## 3. Frontend changes (F1 pass 1+2, F2, F3 + RT frontend)

**F1 — the monolith (`meta-lab-3-patched.jsx`), two sequential passes**
- *Pass 1 (Task 13)*: Templates tab + the two giant base64 .docx blobs deleted first (~40 KB off the main bundle; the file is now safe for normal tooling). New **Methods & Equations** tab (`MethodsTab`, Unicode math, no KaTeX) rendering `METHODS_CONTENT` from the research engine; new `phase:null`/`group` tab plumbing so the PRISMA progress math (denominator, next-step walker) is untouched. Footer version is now dynamic — fetches `GET /api/version` (was hardcoded "v2.0 · PRISMA 2020").
- *Pass 2*:
  - Task 15 **Overview tab** — landing target on every entry path (create, project-list click, deep link): stats, identity/owner/role, linked META·SIFT card with real deep link, team card (members via `screeningApi.listMembers` on the linked ScreenProject), PICO summary, workflow + extraction progress, PRISMA numbers, readiness check, next suggested step.
  - Task 4 **Project Control tab** — project info, status select (writes `progressStatus` to the linked ScreenProject), linked-workspace card / owner-only "Create & link", full members roster (presets, active toggle, remove, expandable per-flag matrix, add-member with email+preset+modules) — the workspace is the single source of truth.
  - Task 5 — `updateProject` early-returns for `_permissions.readOnly||_readOnly` targets (the single client write choke point); persistent "🔒 Read-only access" pill.
  - Task 3 — deep-link `?project=` consumed inside the same mount effect that loads projects; missing/forbidden id → explicit panel, **never `projects[0]`**; `history.replaceState` strips the param.
  - Task 2 — New-Project checkbox "Create linked META·SIFT screening project" (default ON) → `createLinkedSift:true`; sidebar rows show a clickable "⬡ Sift" badge from `_linkedMetaSift`.
  - Task 18 — inline ✎ rename issuing a real `PUT /api/projects/:id {name}` (not autosave), 403 rendered inline.
  - Task 16 — `AI_FEATURES_ENABLED=false`: AIButton returns null; Search AI panel, AI Study Extractor, PROSPERO/Manuscript generation, AddStudyModal Claude fallback, and all marketing copy hidden (not disabled); `callClaude` infra kept.
  - Truth-fix: the SMD dropdown label now says "SMD (Cohen's d)".
- `src/frontend/storage/serverStorage.js` — autosave batch skips read-only projects, `Promise.all` → `Promise.allSettled` (one failure can't flip the user's save indicator); `hasPendingSave()` covers the in-flight window (RT).
- `src/frontend/pages/AppWorkspace.jsx` — mounts `<NotificationsBell fixed right={56}/>`.

**F2 — SIFT frontend**
- `src/frontend/components/NotificationsBell.jsx` (new) — shared bell for all 4 surfaces: 30s unread-count poll (paused on `document.hidden`), red 99+ badge, panel with app/actor/role chips, mark-read on click → navigate (`/app?project=<id>` or `/sift-beta/projects/<id>`), mark-all-read, empty state.
- `SiftDashboard.jsx` — bell; linked-ML card badge is now a real deep-link button; New Project modal "Also create & link a META·LAB project" (default OFF → `alsoCreateMetaLab:true`).
- `SiftProject.jsx` — bell; `SiftImport.jsx` — 409 `duplicate_import` amber banner ("already imported on DATE by USER… records not imported") with "Import anyway" (`force:true`) + Cancel.
- `MembersTab.jsx` — add-member "Participates in" select (`modules`), preset select per row (leader preset excluded for non-owners), expandable per-flag "All permissions" matrix.
- `ProjectControlTab.jsx` — inline title rename; "Open META·LAB project →" with the real id; explicit "Link broken" warning when the target is missing.
- `screeningApi.js` — `importRecords(..., {force})`, contract comments.

**F3 — ops frontend**
- `src/frontend/components/AdminRoute.jsx` — **the Task 14 root cause**: guard now admits `['admin','mod']`; everyone else keeps the deliberate `GenericNotFound` 404 cloak.
- `src/frontend/pages/admin/AdminConsole.jsx` — `allowed` is always a Set (role-derived from first render; server truth from `GET /api/admin/console`; on fetch error falls back to the role-derived minimal set `['users','messages']` for mods — the old `null → show all nav` leak is gone); "Mod Console" chip for mods; Unique Logins cards (Task 9); Done Today/Week/Month cards (Task 12); Linked META·SIFT column + workspace rows in projects (Task 11); clickable SIFT project rows → progress drill-in panel (10-cell grid + per-member progress); null `lastActive` renders an em-dash (Task 10).

**RT frontend** — `src/frontend/hooks/useRealtime.js` (new, singleton EventSource with refcounting + capped-backoff reconnect); bell/chat/SiftProject/monolith wiring — see §5.

## 4. Database changes

One additive migration: `server/prisma/migrations/20260610034844_prompt6_notifications_logins_status_fingerprint/`. **No destructive changes; all existing users, projects, studies, screening records, and links preserved** (the full pre-prompt6 suite was re-run green against the migrated DB).

| Change | Detail |
|---|---|
| `Notification` (new table) | userId, type (`PROJECT_INVITE`/`ROLE_CHANGED`), title, message, app, `relatedScreenProjectId` (= workspaceId), `relatedMetaLabProjectId`, denormalized actorId/actorName/actorEmail, role, readAt, dismissedAt; indexes `[userId, readAt]` + `[userId, createdAt]` |
| `LoginEvent` (new table) | userId, email, ip, userAgent, success; indexes `[createdAt]` + `[userId, createdAt]`. Separate from `SecurityEvent` so high-volume successes don't pollute the forensics table |
| `ScreenProjectStatusEvent` (new table) | projectId, status, previousStatus, changedById, changedByName; indexes `[status, createdAt]` + `[projectId, createdAt]` — done-today = distinct projectId where status='done' |
| `ScreenImportBatch` (5 new columns) | `fileHash` (sha256 of line-ending-normalized content), `fileSize`, `importedById`, `importedByName`, `parser` — all nullable/defaulted so legacy rows migrate clean; new index `[projectId, fileHash]` |
| `ScreenProject` | new `@@index([linkedMetaLabProjectId])` — Tasks 3/8/11 all reverse-lookup by it |

Deliberate design point: **no FK to `User`** from Notification/LoginEvent/ScreenProjectStatusEvent (SecurityEvent precedent) — ops metrics and notification history must survive user deletion.

## 5. Realtime architecture

Full document: [`docs/manager/realtime-architecture.md`](realtime-architecture.md) (written by the Collaboration & Realtime agent; includes the two-browser manual test recipe). Summary:

- **Transport**: SSE (`GET /api/events`, own router, `requireAuth` only, `text/event-stream` + `X-Accel-Buffering: no` + `retry: 5000` + `:hb` heartbeat every 25 s). WebSocket rejected — realtime here is purely server→client. Polling is the always-on fallback (chat 4 s, bell 30 s); SSE only makes it faster and lets polls stretch while healthy.
- **Bus** (`server/realtime/bus.js`): in-process `Map<userId, Set<res>>`; one global stream per browser tab. Recipients resolved **at emit time** from active member rows + owner — a just-removed member silently stops receiving. All emits fire-and-forget, error-swallowed, short-circuit at zero streams.
- **"Poke, don't payload"**: events carry only `{type, projectId?/metaLabProjectId?, at}` — never content, never actor identity (`decision.saved` is blind-mode safe by construction). Clients refetch through existing endpoints, each re-authorized per request.
- **Delivered semantics**: META·SIFT (row-level writes) is genuinely live; META·LAB (whole-blob autosave) is *fresh-on-clean + conflict banner when dirty* — a refetch is never applied while `hasPendingSave()`; the "Updated by a collaborator — refresh to see changes" banner appears instead. OT/CRDT explicitly out of scope.

Event catalog:

| Event | Recipients | Emitted on |
|---|---|---|
| `project.updated` | workspace active members + owner, minus actor | SIFT settings save, link/unlink, ML project update/autosave, handoff blob write, title sync |
| `members.changed` | members + owner, minus actor | addMember / updateMember / removeMember |
| `permissions.changed` | **affected userId only** | updateMember (any field), removeMember |
| `decision.saved` | members + owner, minus actor (no identity) | saveDecision, resolveConflict |
| `chat.message` | members + owner, minus sender (no content) | postMessage |
| `status.changed` | members + owner, minus actor | real `progressStatus` transitions (member + admin endpoints) |
| `handoff.updated` | members + owner, minus actor | finalizeRecord (accept/reject), retryHandoff |
| `notification.created` | the notification's userId only | every successful `createNotification` |

## 6. Notification system

- **Model**: persistent per-user `Notification` rows (§4) — persistence-first design means logout/login survival is free and the unread count is server-authoritative.
- **Endpoints** (`/api/notifications`, own unthrottled router): `GET /` (`?unread=1`, `?all=1` to include dismissed, `?page/limit`) → `{notifications, total, unreadCount}`; `GET /unread-count` → `{count}`; `POST /:id/read`; `POST /:id/dismiss`; `POST /mark-all-read`. Cross-user access → 404.
- **Bell** (`NotificationsBell.jsx`) on all 4 surfaces — META·LAB `/app`, SIFT dashboard, SIFT project, ops console. Shows project name, app chip (`metalab`/`metasift`/`workspace`), inviter name/email, role/preset granted, relative date, and an Open action that deep-links to the exact linked project; click marks read.
- **Creation paths**: `PROJECT_INVITE` on `addMember` for registered users; **claim-on-register** for pending invites (member row claimed + activated at registration, notification created then — a decided, tested behavior, not an accident); `ROLE_CHANGED` on real role/preset changes by someone else.
- **SSE poke**: `notification.created` → immediate badge refresh; the 30 s poll stretches to 120 s while the stream is healthy and snaps back on failure.

## 7. Linked project behavior

- **Workspace = ScreenProject** (decision #1). `workspaceId` in every API response is the ScreenProject id.
- **Create from META·LAB**: checkbox default ON → `POST /api/projects {createLinkedSift:true}` → `{project, linkedScreenProject}` — atomic server-side creation via `server/screening/createScreenProject.js` (same owner, title, PICO snapshot, seeded reasons/keywords, owner member row). SIFT-side failure never rolls back the ML project (`warning` returned).
- **Create from META·SIFT**: SIFT-only by default; optional `alsoCreateMetaLab:true` checkbox (never forced).
- **Annotations**: `GET /api/projects` (+`/:id`) carry `_linkedMetaSift:{id,title}|null` and `_permissions` for every accessible row — owned and shared; underscore keys are stripped on persist so clients can echo them back safely.
- **Membership-aware summary**: `GET /api/screening/metalab/:mlpid/summary` returns `linked:true` for any active member of the linked workspace (was owner-only — the prompt6 bug). Members added to a linked project see it linked automatically; the link belongs to the workspace, not the user (Task 8).
- **Deep links**: META·SIFT → META·LAB uses `/app?project=<id>`; the monolith consumes the param inside the same effect that loads projects, selects the exact project, and shows an explicit "no access / link broken" panel for a bad id — **the `projects[0]` fallback is gone**. META·LAB → META·SIFT uses `/sift-beta/projects/<id>` from `_linkedMetaSift.id` everywhere (sidebar badge, Overview card, Control tab, RayyanTab).
- **Rename**: owner or permitted member renames sync to the linked twin **iff the titles were equal before** (sync-if-in-sync), in both directions; diverged titles never sync. Documented in `server/docs/api-contract.md` and `screening-api-contract.md`.

## 8. Permission model

- **Presets** (shared `src/research-engine/screening/permissionPresets.js`): Owner, Leader, Reviewer, Data Extractor, Viewer, Read-only META·LAB, Read-only META·SIFT, Read-only Both, Custom (raw flags). `addMember` additionally accepts `modules:'metalab'|'metasift'|'both'` mapping the canView* flags (`metasift` also clears `canEditMetaLab`).
- **Viewer read-only enforcement** — both sides:
  - *Client*: single choke point — monolith `updateProject` no-ops for read-only targets; controls hidden; persistent "Read-only access" pill; autosave batch skips read-only projects (`allSettled`).
  - *Server*: member `PUT /api/projects/:id` → 403, export → 403 (`canExport`), import references → 403 (`canEdit`); SIFT import/export/duplicates/labels/reasons gated per-flag; `store.save()` foreign-owner is a typed 403 (was 500).
- **403-vs-404 policy**: outsiders and pending invites stay **404** (existence-hiding, incl. the 4 prompt5 `SEC*` adversarial tests — unchanged); active members without the specific permission get **403**; permission upgrades (viewer→leader) take effect immediately — access is resolved per-request from the DB, there is no permission cache.
- **Pinned autosave contract**: viewer/member autosave is `200 {skipped:true}` — never 4xx — protected by a dedicated test so nobody "fixes" read-only by 403-ing the batch save.
- **Owner/leader protections** (unchanged from prompt5, re-verified): owner row locked for everyone; only the owner mints/demotes leaders; leaders cannot touch the owner, transfer ownership, or alter owner permissions.

## 9. Ops metrics

- **Unique logins** (`GET /api/admin/metrics → logins:{day,week,month,quarter,year}`): distinct successful-login userIds per **rolling** window (24h/7d/30d/90d/365d) from the new `LoginEvent` table; five cards in the ops Overview. Distinctness verified: 3 logins by one user move `day` by exactly +1.
- **Done today/week/month** (`GET /api/admin/screening/metrics`): `COUNT(DISTINCT projectId)` of `done` `ScreenProjectStatusEvent`s per calendar bucket — done→in_progress→done on the same day counts **once**; same-value PATCHes write no event.
- **lastActive** (Task 10 fix): written on login + throttled (5-min in-memory map, fire-and-forget) on every authenticated request — previously only profile updates wrote it. Ops users table renders it (em-dash when null).
- **Linked status in ops** (Task 11): META·LAB projects rows carry `linkedMetaSift{id,title}`, `workspaceId`, `owner`, `status`; SIFT rows carry `linkedMetaLab`, `workspaceId`, `status`.
- **SIFT project drill-in**: `GET /api/admin/screening/projects/:id` adds `progress:{total, screened, unscreened, included, excluded, maybe, conflicts, duplicates, secondReview, sentToExtraction}` + `memberProgress:[{name,email,screened,included,excluded,maybe}]`; clickable rows in the console open the panel.
- **Limiter reshape**: admin limiter 60 → 300/15min prod (1000 dev), `GET /console` + `GET /contact-messages/unread-count` exempt.

## 10. Methods & Equations replacement (Task 13)

- **Templates removed entirely**: tab, sidebar Downloads section, `DOCS` array with both base64 .docx payloads, `downloadDoc()` — zero remaining references; bundle shrank ~40 KB and the monolith no longer has tooling-breaking giant lines.
- **Replacement**: Methods & Equations tab driven by engine-owned data — `src/research-engine/docs/methods-content.js` (`METHODS_CONTENT` + `NOT_IMPLEMENTED`), rendered by `MethodsTab` in Unicode/HTML (KaTeX rejected). Each entry: equation(s), plain-English explanation, where used in the app, implemented-in file pointer, references, limitations.
- **The 33-entry whitelist is the contract** — exactly the implemented math, nothing more: IV fixed-effect, Cochran Q, I², DL τ², DL random-effects, z/p, 95% CI, HKSJ, prediction interval, Egger, trim-and-fill, leave-one-out, DFFITS influence, subgroup Q-between, MD, SMD (Cohen's d), log OR/RR/HR, Fisher z, logit proportion, log DOR, the 9 Wan/Hozo conversion recipes, duplicate `scorePair`, numerical methods. A closing box lists what is *not* implemented (REML, Paule–Mandel, Peters, Begg, meta-regression, network MA).
- **144-test structural contract** (`tests/unit/methods-content.test.js`): exact id set equality both directions, per-entry completeness, kebab-case ids, citation pool restricted to 27 verified author-prefixes (no "rounding out" references), and the exact `verified:false` set.
- **Cohen's d truth-fix**: the engine's SMD has no Hedges' J correction despite old comments/docs claiming "Hedges' g". Comments in `calculators.js`, `statistical-validation.md` §9, the monolith dropdown label, and a test-file comment now all say **Cohen's d**; the computation was deliberately NOT changed (it would alter every SMD result and invalidate 55 tests) — adding J is a recommended next step.
- **Needs-verification labeling**: 4 entries (`es-logit-proportion`, `conv-median-iqr`, `duplicate-similarity-scorepair`, `numerical-methods`) carry an amber "⚠ needs verification" badge — in-house heuristics documented honestly rather than dressed with invented citations.

## 11. Mod access solution (Task 14)

Option **C — same entrance, role-based console** (the brief's preferred option):

- Root cause was one line: `AdminRoute.jsx` checked `role !== 'admin'`. It now admits `admin` and `mod`; plain/anonymous users keep the deliberate `GenericNotFound` **404 cloak** on `/ops` (existence-hiding — kept on purpose).
- Server guards were already correct since prompt4 (`requireAdminOrMod` vs `requireAdmin` per route, DB-verified on every request, no hardcoded emails) — no guard changed.
- The console's `allowed` sections set is now **always role-derived first**, replaced by server truth from `GET /api/admin/console`, and falls back to the role-derived minimal set on fetch error — the old `null → render all nav` leak (mod briefly seeing admin sections) is gone in both the loading and error paths.
- Mods see a teal **"Mod Console"** chip and land on Users.
- **Mods can reach**: Users (list, detail, edit name/email, suspend/unsuspend, password reset) and Messages (contact messages, replies, unread-count, mark-read).
- **Mods cannot reach** (server 403 + SecurityEvent, UI AccessDenied): metrics, settings, landing content, feature flags, audit log, security events, health, projects, role assignment, message delete, and **all** `/api/admin/screening/*`.

## 12. QA manual results

**Integrator API smoke (run live before the QA phase): 16/16 PASS** — register→login→empty notifications→`createLinkedSift` returns `{project, linkedScreenProject}` with `_linkedMetaSift`+`_permissions`→legacy bare create→membership-aware summary `linked:true`→admin 403 for a normal user→SIFT project carries `linkedMetaLabProjectTitle`+non-empty `picoSnapshot`→rename sync-if-in-sync both ways→cleanup.

**Verified by automated HTTP tests** (the 23-test `prompt6.test.js` inventory, full table in `tests/screening/report.md`): notification lifecycle incl. fresh-login persistence and claim-on-register; linked creation both directions incl. 400 validation; member link visibility; viewer matrix incl. the pinned autosave contract; modules mapping; SSE handshake/pokes/scope-leak/heartbeat; import 403-vs-404 incl. instant upgrade; fingerprint 409/force/per-project/CRLF; logins distinctness, lastActive recency, doneToday distinctness; ops linked columns + progress block; mod RBAC allow/deny matrix; rename sync both directions.

**Manual-browser remainder** — these need a two-browser human pass and are recorded in both test reports:
two-browser realtime (incl. the dirty-edit conflict banner), bell UX on all 4 surfaces, deep-link from a real click, viewer UX polish (pill/hidden controls/save indicator), mod console navigation (404 cloak, chip, AccessDenied, fetch-failure fallback), Methods & Equations rendering vs the whitelist, EventSource reconnect after a server restart, poll pause on `document.hidden`. A 10-step two-browser recipe is in `docs/manager/realtime-architecture.md` §9.

## 13. Automated test results

| Suite | Baseline (pre-prompt6) | Final | Δ |
|---|---|---|---|
| Screening (`tests/screening/`, server up) | 216/216 | **239/239** | +23 (`integration/prompt6.test.js`) |
| Unit (`tests/unit/`) | 377 pass / 6 quarantined fail | **521 pass / 6 quarantined fail** | +144 (`methods-content.test.js`); `effect-sizes.test.js` 55/55 |
| Full repo (`npx vitest run --no-file-parallelism`, server up) | 632 / 6 / 7 | **866 pass / 6 fail / 7 skip** | no net loss |
| Build | — | **`npm run build` exit 0** | pre-existing monolith ~L4047 esbuild JSX advisory + >500 kB chunk note only |

- The 6 failures are the **identical pre-existing quarantined** `tests/unit/serverStorage.test.js` fake-timer assertions (file untouched by prompt6; set did not grow).
- **Flipped assertions: none required.** Every 404→403/400/409 flip landed on previously-untested member paths; owner-200 and outsider-404 assertions — including the 4 prompt5 `SEC*` adversarial tests — pass unchanged. The only test-file edit besides the new suite is a cosmetic comment (Hedges' g → Cohen's d).
- The new suite passed twice consecutively (flake check). QA found **zero product bugs** — every implementer contract behaved as documented on first test contact.

## 14. Known limitations

1. **In-process SSE bus = single-process only.** Multiple Node processes would split the registry; horizontal scaling needs Redis pub/sub (or similar). The polling fallback keeps every feature *correct* (slower) even then. Same limitation already applies to in-memory chat typing indicators.
2. **No OT/CRDT** — META·LAB whole-blob editing delivers *fresh-on-clean + conflict banner when dirty*, last-write-wins on explicit Refresh. Simultaneous PICO co-typing is not merged.
3. **Hedges' J correction deferred** — SMD is (now truthfully documented as) Cohen's d; adding the small-sample correction changes every SMD result and must be a deliberate release with test updates.
4. **AI features are hidden, not removed** — `AI_FEATURES_ENABLED=false` in the monolith; `callClaude` infra intact pending future implementation.
5. **Pending-invite actor unknown at claim time** — member rows don't store the inviter, so a claim-on-register notification falls back to "A project manager".
6. **Typing indicators are polling-only** (in-memory, 4 s cadence while the chat drawer is open).
7. **Pre-existing**: META·LAB `MetaSiftPrismaSync` "Create & link" 400s for non-owner members (the new Control tab hides the button for non-owners); the 6 quarantined `serverStorage.test.js` fake-timer failures; the monolith esbuild JSX advisory.
8. **Bundle chunk-size advisory** — the main chunk is ~885 kB minified / ~244 kB gzip (>500 kB warning); code-splitting is a next step, not a regression (the bundle *shrank* this round with the base64 Templates removal).

## 15. Recommended next steps

1. **Hedges' g** — apply the J correction `1 − 3/(4(n₁+n₂−2) − 1)` as a deliberate, versioned change with the 55 effect-size tests updated in the same commit, plus the Methods entry and `statistical-validation.md`.
2. **Physical `ReviewWorkspace` table** if/when workspace-level features outgrow the ScreenProject row (multi-project workspaces, workspace-level billing/settings) — the API already speaks `workspaceId`, so the migration is contained.
3. **Redis pub/sub bus** behind `server/realtime/bus.js`'s emit functions if the deployment ever goes multi-process.
4. **OT/CRDT** (e.g. Yjs) for live PICO/extraction co-editing if simultaneous text editing becomes a real workflow.
5. **Re-enable AI features** behind the existing `AI_FEATURES_ENABLED` flag once the feature set is decided — the infra was kept.
6. **REML / Paule–Mandel τ² estimators** (and Peters' test for log OR) — currently honestly listed under "Not implemented" in Methods & Equations.
7. **Bundle code-splitting** — lazy-load the monolith and the SIFT app as separate chunks to clear the >500 kB advisory.
8. Smaller: move Landing `STEPS`/`VALUE_PROPS` into admin-managed `landingContent`; a shared `<VersionTag/>` component to dedupe the three version displays; ownership-transfer flow.
