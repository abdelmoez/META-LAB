# design3 Audit A — Project Control (legacy `ControlTab`)

**Auditor verdict in one line:** Project Control is NOT a single self-contained component — it is a **thin shell (`ControlTab`) that itself only owns ~5 capabilities, and delegates the entire Members/roles/invitations/permissions surface to `MembersTab` (re-exported as `ProjectMembersPanel`).** The cleanest design3 path is **HYBRID**: build a NATIVE Stitch shell that re-implements the ~5 simple cards (project-info, status, screening/collab settings, danger zone) by calling the same APIs, and **EMBED `ProjectMembersPanel` verbatim** for the members block (it is already a standalone, prop-driven component designed to be embedded outside its home tab — that's literally why the re-export exists). All state, autosave, validation, and permission gating already live in standalone API clients + the server; ControlTab owns no business logic worth porting.

---

## 1. Files & exact locations

| Concern | File:line | Signature |
|---|---|---|
| Shell component | `src/frontend/workspace/tabs/overviewTabs.jsx:507` | `function ControlTab({project,onAnnotate,setTab,presence,onDeleted})` |
| Export | `src/frontend/workspace/tabs/overviewTabs.jsx:820` | `export { … ControlTab }` |
| Members block (re-export) | `src/frontend/screening/tabs/ProjectMembersPanel.jsx:15` | `export { default } from './MembersTab.jsx'` |
| Members impl | `src/frontend/screening/tabs/MembersTab.jsx:131` | `export default function MembersTab({ pid, project, access, refreshProject, presence, leaveRedirect='/sift-beta' })` |
| `AddMemberModal` | `src/frontend/screening/tabs/MembersTab.jsx:757` | `function AddMemberModal({ pid, amOwner, onClose, onAdded })` |
| `MemberRow` | `src/frontend/screening/tabs/MembersTab.jsx:436` | `function MemberRow({ member, canManage, amOwner, busy, saved, expanded, onToggleExpand, rowErr, activity, onPatch, onRemove, onLeave })` |
| Helpers | `src/frontend/workspace/projectHelpers.js:370 / :380 / :385` | `projectPerms(project)`, `linkedSiftId(project)`, `CTRL_STATUS_OPTIONS` |
| Member API client | `src/frontend/screening/api-client/screeningApi.js:33,34,37,108-130` | `createProject/getProject/updateProject/listMembers/lookupMember/addMember/updateMember/removeMember/leaveProject/transferOwner` |
| Project API client | `src/frontend/api-client/apiClient.js:63-145` | `api.projects.{get,update,confirmDelete,archive,unarchive}` |
| Permission model | `src/research-engine/screening/permissionPresets.js` (whole file) | `PERMISSION_PRESETS`, `USER_ROLES`, `ROLE_TO_PRESET`, `PRESET_TO_ROLE`, `ASSIGNABLE_PRESETS`, `GLOBAL_PERMISSION_KEYS`, `resolvePreset`, `fullPermissions` |
| Server access resolver | `server/screening/access.js:32` | `getProjectAccess(pid,user)` → `{ isOwner,isLeader,canManageMembers,canManageSettings,member,project,role,… }` |
| Server member ctrl | `server/controllers/screeningMemberController.js` | `listMembers:61 lookupUser:102 addMember:138 updateMember:282 removeMember:425 leaveProject:480 transferOwner:525` |
| Server project ctrl | `server/controllers/projectsController.js:421/502/520` | `ownerDeleteProject` / archive helpers (owner-scoped by `userId: req.user.id`) |
| Server screen-settings | `server/controllers/screeningController.js:316` | `updateProject` (status/blind/chat/requiredReviewers field whitelist + `canManageSettings` gate) |

**Single source of truth:** the linked **ScreenProject** (the screening workspace). `lid = linkedSiftId(project)` resolves it. Members, roles, blind/chat/required-reviewers, and project status ALL live on the ScreenProject — there is **zero data duplication** because ControlTab never stores its own copy; it reads/writes the ScreenProject through `screeningApi`. **This is the design3 win: a native page reusing the same `screeningApi` calls automatically shares state with the Screening engine's Settings tab.**

---

## 2. Capability inventory (feature table)

Legend — **gate** = client guard; server always re-enforces (cited). **Owns** = does ControlTab itself implement it (vs delegate to MembersTab)?

| # | Capability | Owns | API method | Request shape | Response shape | Client gate | Server gate | Validation | UI states |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Read project info (name, owner, created/modified, study count, screening title) | ControlTab `:639-658` | `api.projects.get(id)` (loaded by parent/route) | — | `{ name, _owner:{id,name,email}, created/createdAt, modified/updatedAt, studies[], _linkedMetaSift, _archived, _permissions }` | none (read) | GET requires auth | — | renders dashes when missing |
| 2 | **Project status** (not_started/in_progress/done) | ControlTab `:579-592,672-680` | `screeningApi.updateProject(lid,{progressStatus})` | `PUT /projects/:pid {progressStatus}` | `{…ScreenProject}` | `canManageStatus = sp.canManageSettings\|\|sp.isLeader\|\|sp.isOwner` → else read-only badge | `screeningController.updateProject:321` `if(!access.canManageSettings) 403` | `:371-375` enum `['not_started','in_progress','done']`→400 | optimistic + revert `:588`; `✓ saved` flash `:586,664`; `spErr` red `:666` |
| 3 | **Blind mode** | ControlTab `:707-716` | `screeningApi.updateProject(lid,{blindMode})` | `{blindMode:bool}` | `{…}` | `canManageStatus` else `<span>` tag | same 403 gate; `screeningController.updateProject:355` `data.blindMode=!!blindMode`; audit `:386 BLIND_MODE_ON/OFF` | coerced bool | `SwitchToggle` busy/optimistic `:714`; revert `:605` |
| 4 | **Restrict chat** | ControlTab `:717-726` | `screeningApi.updateProject(lid,{chatRestricted})` | `{chatRestricted:bool}` | `{…}` | `canManageStatus` | same gate; `:381 data.chatRestricted=!!chatRestricted` | coerced bool | `SwitchToggle` |
| 5 | **Required reviewers** (2-10) | ControlTab `:727-740` | `screeningApi.updateProject(lid,{requiredScreeningReviewers:int})` | `{requiredScreeningReviewers:int}` | `{…}` | `canManageStatus` | same gate; `:339-347` must be **integer** (else 400), clamped `[REQUIRED_REVIEWERS_MIN(2),MAX]` | integer-only, no silent coercion | `<select>` 2..10 |
| 6 | **Create & link screening** (unlinked only) | ControlTab `:610-619` | `screeningApi.createProject({title,linkedMetaLabProjectId})` | `POST /projects {title,linkedMetaLabProjectId}` | `{id,title,…}` | owner only (server validates) | createScreenProject sets `ownerId=req.user.id` | — | `linkBusy`/`linkErr`. **Note:** current copy says workspace is auto-created on first Screening open — the explicit button path still exists in code |
| 7 | Open Screening (navigation) | ControlTab `:683,694` | — (`setTab('screening')`) | — | — | none | — | — | only if `setTab` prop present |
| 8 | **Members roster** (grouped Owner▸Leaders▸Members▸Viewers, live presence/location) | **MembersTab** `:319-348` | `screeningApi.listMembers(lid)` | `GET /projects/:pid/members` | `{members[],myRole,myUserId,ownerId,isLeader,isOwner,canManageMembers}` (`shapeMember` `memberCtrl:40`) | `canManage = canManageMembers\|\|isLeader\|\|access.isLeader` `:193` | `listMembers:61` requires owner-or-member access (else 404) | — | `<Loading>`; `<ErrorBanner onRetry>`; `<EmptyState>` |
| 9 | **Add member / invite** (email lookup → add-vs-invite) | **AddMemberModal** `:757` | `lookupMember(pid,email)` then `addMember(pid,{email,preset,modules:'both'})` | lookup `GET …/members/lookup?email=`; add `POST …/members {email,preset,modules}` | lookup `{found,alreadyMember?,currentRole?,user?,pendingInvite?}`; add `{member,pending,invite?:{link,emailConfigured,emailSent,expiresAt}}` | `canManage`; owner-only sees Leader option `:759` | lookup `canManageMembers` gate (`lookupUser:106` 403); add `addMember:143` `canManageMembers` 403; **Leader add owner-only** `:178-180` 403 | client `EMAIL_RE` `:31`; server `isValidEmail` `:150`; **409 dup** `:159`; modules∈{metalab,metasift,both} `:167` | debounced lookup w/ seq guard `:779-806`; invite-link copy w/ clipboard fallback `:845`; pending-email panel `:961` |
| 10 | **Change member role** (Leader/Reviewer/Viewer via preset) | **MemberRow** `:507-521` | `updateMember(pid,mid,{preset})` | `PATCH …/members/:mid {preset}` | `{member}` | `editable=canManage&&!locked`; owner-only can set Leader `:465` | `updateMember:282` full matrix (see §4) | preset→`resolvePreset`; role enum `ROLES` `:347` | optimistic per-row `patchMember:206`, seq-guarded `:209`, revert `:234`, `✓ Saved`/`saving…` `:600-610` |
| 11 | **Quick permission toggles** (Screen/Chat/Resolve) | MemberRow `:574-585` | `updateMember(pid,mid,{[key]:bool})` | `PATCH {canScreen\|canChat\|canResolveConflicts}` | `{member}` | `editable` | `updateMember:356-358` | bool coerce | optimistic |
| 12 | **Advanced permission matrix** (incl. **RoB `canAssessRiskOfBias`** & **extraction `canManageExtraction`**, View/Edit/Analysis/Export/Read-only; Global owner-only) | MemberRow `:616-646`; groups `:55-77` | `updateMember(pid,mid,{[PERMISSION_KEY]:bool})` | `PATCH {…flag}` | `{member}` | `editable`; **Global group hidden unless `amOwner`** `:73,624` | `updateMember:361-365` writes any `PERMISSION_KEYS` flag; **`GLOBAL_PERMISSION_KEYS` skipped for non-owner** `:363` | bool | expanded-state owned by parent by id `:154` (survives saves) |
| 13 | **Member status** active/inactive toggle | MemberRow `:523-528` | `updateMember(pid,mid,{status})` | `PATCH {status}` | `{member}` | `editable` (disabled for pending) | `:352-354` enum `STATUSES` | enum | `<Toggle>` |
| 14 | **Remove member / revoke invite** | MembersTab `:241-255`, modal `:364-401` | `removeMember(pid,mid)` | `DELETE …/members/:mid` | `204` | `canManage`; remove-leader owner-only | `removeMember:425` `canManageMembers` 403; **owner cannot be removed** `:435` 400; **remove-leader owner-only** `:439` 403; pending row removal = invite revoke `:449` | — | confirm modal (different copy for invite vs member) `:365`; `await load()` after |
| 15 | **Leave project** (self, non-owner) | MembersTab `:259-269`, modal `:404-421` | `leaveProject(pid)` | `POST …/leave` | `{left:true}` | own non-owner row only `:342` | `leaveProject:480` owner→400 `:484`; non-member→404 | — | confirm modal; navigates `leaveRedirect` (`/app` from Control) `:264` |
| 16 | **Transfer ownership** | NOT surfaced in ControlTab/MembersTab UI (API exists) | `transferOwner(pid,toUserId)` | `POST …/transfer-owner {toUserId}` | `{ok:true,ownerId}` | — | `transferOwner:525` owner-only `:530`; target must be active member; 409 if analysis shared by >1 workspace | — | (no UI today — gap to optionally add) |
| 17 | **Archive / Unarchive** (owner-only Danger Zone) | ControlTab `:519-527,775-784` | `api.projects.archive(id)` / `unarchive(id)` | `POST /projects/:id/archive` | `{archived:true,archivedAt}` / `{archived:false}` | `amProjectOwner = !project._shared` `:510` | owner-scoped via `findOwnedProjectForArchive` `projectsCtrl:502` (`userId:req.user.id` → 404 non-owner) | — | `archiveBusy`/`archiveErr`; `onAnnotate(id,{_archived,…})` local sync `:524` |
| 18 | **Delete project** (name-confirm + cascade) | ControlTab `:528-538,786-814` | `api.projects.confirmDelete(id,{confirmName,cascadeLinked:true})` | `POST /projects/:id/delete {confirmName,cascadeLinked}` | `{deleted:true,cascaded:[]}` | `amProjectOwner`; typed-name must match `:529` | `ownerDeleteProject:421` owner-scoped `userId:req.user.id` 404; **confirmName must equal name (trimmed)** `:435` 400; cascade soft-deletes linked ScreenProject + RoB; writes audit | client name-match `:529`; server name-match `:435` | inline confirm box w/ name input; `delBusy`/`delErr`; `onDeleted(id)` exits workspace `:536` |
| 19 | Read-only banner (non-managers) | ControlTab `:631-636`; MembersTab `:295-304` | — | — | `perms.readOnly` / `!canManage` | — | — | shows lock notice |

**NOT present anywhere in Project Control (so not a design3 obligation):** inline title/description rename (rename happens elsewhere — `screeningController.updateProject` *can* take `title`/`description` and `projectsController.updateProject:336` syncs the linked title, but ControlTab renders Name as **read-only**); role-preset CRUD (presets are a fixed code constant `PERMISSION_PRESETS`, not user-editable); dates/activity feed beyond created/modified rows.

---

## 3. Exact API surface a NATIVE Stitch Project Control must call

All already exist; a native page calls them directly — no new endpoints needed.

```js
// ── project blob (already loaded by the route / StitchProjectOverview) ──
api.projects.get(projectId)
//   → { name, _owner:{id,name,email}, _permissions, _archived, _archivedAt,
//       _linkedMetaSift:{id,title,progressStatus,recordCount}, studies[], created, modified }

// ── owner-only project lifecycle (apiClient.js) ──
api.projects.archive(projectId)                              // → {archived:true,archivedAt}
api.projects.unarchive(projectId)                            // → {archived:false}
api.projects.confirmDelete(projectId,{confirmName,cascadeLinked:true}) // → {deleted:true,cascaded[]}

// ── screening-workspace settings (screeningApi.js); lid = linkedSiftId(project) ──
screeningApi.getProject(lid)                                 // → ScreenProject row (status/flags/isOwner/isLeader/canManageSettings)
screeningApi.updateProject(lid,{progressStatus})             // status
screeningApi.updateProject(lid,{blindMode})                 // blind
screeningApi.updateProject(lid,{chatRestricted})            // restrict chat
screeningApi.updateProject(lid,{requiredScreeningReviewers})// required reviewers (int)
screeningApi.createProject({title,linkedMetaLabProjectId})  // create & link (owner)

// ── members family (screeningApi.js) — OR just embed ProjectMembersPanel ──
screeningApi.listMembers(lid)
screeningApi.lookupMember(lid,email)
screeningApi.addMember(lid,{email,preset,modules:'both'})
screeningApi.updateMember(lid,memberId,{preset|status|canScreen|…|canAssessRiskOfBias|…})
screeningApi.removeMember(lid,memberId)
screeningApi.leaveProject(lid)
screeningApi.transferOwner(lid,toUserId)   // (no current UI — optional to add)
```

Pure helpers to reuse (already imported by `StitchProjectOverview`): `projectPerms`, `linkedSiftId`, `CTRL_STATUS_OPTIONS` from `workspace/projectHelpers.js`; `PERMISSION_PRESETS`, `USER_ROLES`, `ROLE_TO_PRESET`, `PRESET_TO_ROLE` from `research-engine/screening/permissionPresets.js`.

---

## 4. Role-rule matrix (client gate AND server enforcement)

Roles surfaced to users: **Owner** (implicit, never assignable), **Leader**, **Reviewer**, **Viewer** (`USER_ROLES`). Internal presets map via `ROLE_TO_PRESET` / `PRESET_TO_ROLE`. `data_extractor` is a legacy preset that displays as "Reviewer" (with extraction/RoB enabled via the advanced matrix).

**Who can manage what** (`canManage = canManageMembers || isLeader`; `amOwner = isOwner`):

| Action | Owner | Leader | Member w/ `canManageMembers` | Reviewer/Viewer | Server enforcement |
|---|---|---|---|---|---|
| View roster | ✓ | ✓ | ✓ | ✓ (read-only) | `getProjectAccess` owner-or-member else 404 |
| Add member (Reviewer/Viewer) | ✓ | ✓ | ✓ | ✗ | `addMember:143` `canManageMembers` |
| Add member as **Leader** | ✓ | ✗ | ✗ | ✗ | `addMember:178` owner-only 403 |
| Edit a **Member/Viewer** row | ✓ | ✓ | ✓ | ✗ | `updateMember:287` gate |
| Edit a **Leader** row | ✓ | ✗ | ✗ | ✗ | `updateMember:314` owner-only 403 |
| Edit the **Owner** row | ✓ (but cannot demote/deactivate) | ✗ | ✗ | ✗ | `updateMember:306-311` (must remain active owner) |
| Promote member → **Leader** | ✓ | ✗ | ✗ | ✗ | `updateMember:317-321` owner-only |
| Grant **Global** flags (`canManageMembers`/`canManageSettings`) | ✓ | ✗ | ✗ | ✗ | `updateMember:325-329` + per-key skip `:339,:363`; UI hides group `:73,624` |
| Edit **own** row (widen self) | ✓ only | ✗ | ✗ | ✗ | `updateMember:300-303` self+non-owner 403 |
| Remove **Member/Viewer** | ✓ | ✓ | ✓ | ✗ | `removeMember:429` |
| Remove **Leader** | ✓ | ✗ | ✗ | ✗ | `removeMember:439` owner-only |
| Remove **Owner** | ✗ | ✗ | ✗ | ✗ | `removeMember:435` 400 always |
| Revoke pending invite | ✓ | ✓ | ✓ | ✗ | = removeMember on pending row `:449` |
| Leave project (self) | ✗ (transfer first) | ✓ | ✓ | ✓ | `leaveProject:484` owner→400 |
| Transfer ownership | ✓ | ✗ | ✗ | ✗ | `transferOwner:530` owner-only |
| Change status/blind/chat/req-reviewers | ✓ | ✓ | only w/ `canManageSettings` | ✗ | `screeningController.updateProject:321` `canManageSettings` |
| Archive/Unarchive/Delete project | ✓ | ✗ | ✗ | ✗ | owner-scoped `userId:req.user.id` (`projectsCtrl:427,443,503`) → 404 for non-owner |

**No-privilege-escalation guarantees (server, non-bypassable):** (a) a `canManageMembers` delegate can never mint Leaders or grant Global flags — both checked before write, and individual Global keys are silently skipped for non-owners even via raw-flag PATCH (`updateMember:339,363`); (b) self-widening blocked for non-owners (`:300`); (c) owner row immutable except by owner and never to a lower role (`:306`). The client mirrors all of these (`MemberRow` `locked`/`roleOptions`/owner-only Global group) but they are **defense-in-depth only** — the server is authoritative, so a native Stitch UI that omits a guard is a UX regression, not a security hole.

---

## 5. Coupling / standalone-usability analysis

**`ControlTab` itself** — props `{project, onAnnotate, setTab, presence, onDeleted}`:
- `project` = the `api.projects.get` blob (already loaded by `StitchProjectOverview:119`). ✓ standalone.
- `onAnnotate(id, patch)` = local-cache merge so the rest of the app sees archive/link changes instantly. A native page can pass `loadData`-style reload instead (StitchProjectOverview already has `loadData(true)`), or a no-op + reload. **Not a blocker.**
- `setTab(id)` = navigation to Screening. In Stitch this becomes `navigate(projectStageHref('screening',ctx))`. **Trivial.**
- `onDeleted(id)` = exit-workspace after delete. In Stitch → `navigate('/app')`. **Trivial.**
- `presence` = `{users,locks}` from `useRealtime` — StitchProjectOverview already subscribes (`:144`). ✓ pass-through.

ControlTab's own logic is ~5 optimistic-save handlers (status/blind/chat/req/link/archive/delete) — **all trivial to re-implement natively** and SHOULD be, because they are styled entirely with legacy `C`/`btnS`/`inp`/`SwitchToggle` tokens (`overviewTabs.jsx:21-22`). Embedding the whole ControlTab would drag in `SectionHeader/InfoBox/ProgressBar`, the legacy `C` token surface, and the `SiftProject`/`runMeta` imports at the top of `overviewTabs.jsx` (heavy, unrelated). **So: do NOT embed ControlTab.**

**`MembersTab` / `ProjectMembersPanel`** — props `{pid, project, access:{isLeader,myRole}, refreshProject, presence, leaveRedirect}`:
- This component was **explicitly built to be embedded outside its home tab** — that is the documented purpose of the `ProjectMembersPanel.jsx` re-export (`:1-14`) and it is *already* embedded inside legacy ControlTab (`overviewTabs.jsx:756-763`). It loads its own data (`listMembers`), owns its own optimistic state, modals, lookup/invite flow, and re-derives authority from the server response (`canManage`/`amOwner`) — `access` prop is only a hint. **It is genuinely standalone.**
- **Coupling cost if embedded in Stitch:** it imports legacy screening theme `'../ui/theme.js'` (`C,FONT,MONO,alpha`) and primitives `'../ui/components.jsx'` (`Loading,ErrorBanner,Button,Badge,Avatar,Toggle,Modal,Card,Field,EmptyState`). These are **CSS-var `--t-*` based**, and design2 already added `stitch/theme/stitchTokens.js` that remaps `--t-*` so embedded legacy widgets harmonize (per the design2 handoff). So embedding renders correctly inside a Stitch shell with no new theme work — same approach design2 used for the deep-tool fallbacks.

**Verdict for members:** **EMBED `ProjectMembersPanel` verbatim.** Re-implementing the roster + invite-lookup + advanced-permission matrix + optimistic seq-guarded patch + transfer/leave modals natively would be ~700 lines of high-risk re-port of subtle concurrency code (`patchSeq`, expanded-id preservation, stale-response guards) for purely cosmetic gain. The risk/reward is bad. Mount it inside a Stitch `Card` with a section header.

```jsx
<ProjectMembersPanel
  pid={linkedSiftId(project)}
  project={sp || project}
  access={{ isLeader: data.isLeader, myRole: data.myRole }}
  presence={presence}
  refreshProject={() => loadData(true)}
  leaveRedirect="/app"
/>
```

---

## 6. RECOMMENDED design3 build — HYBRID

Create `src/frontend/stitch/pages/StitchProjectControl.jsx` (route e.g. `/app/project/:id/settings`, and flip `STAGE_KIND.control` from `monolith`→a new `stitch-control` kind in `navConfig.js:89`; the rail already labels it "Settings" at `SCREENING_SUBNAV:167`... actually that label is on the screening subnav — the project rail label comes from `TABS` "Project Control"). The native page:

1. **NATIVE Stitch cards** (re-implement, calling the same APIs) for: Project info (read-only rows), Project status, Screening & collaboration (blind/chat/required-reviewers), Create-&-link (unlinked), Danger Zone (archive/unarchive/delete-with-name-confirm). These are ~5 small optimistic-save handlers — copy the exact API calls + validation from `ControlTab:519-619` but render with Stitch primitives.
2. **EMBED `ProjectMembersPanel`** verbatim for Members & permissions (covers capabilities #8-#16 including RoB & extraction permission via the advanced matrix).
3. **Optionally add a Transfer-ownership control** (API #16 exists; no UI today) since a native page is the natural home and the server is ready.

Data: reuse `api.projects.get` + `screeningApi.getProject(lid)` + `listMembers` exactly as ControlTab does (no duplication — both read the ScreenProject). Wire `useRealtime` (already in StitchProjectOverview) for `members.changed` / `project.updated` → reload. Permission gating: `projectPerms(project)`, `amProjectOwner = !project._shared`, `canManageStatus = sp.canManageSettings||sp.isLeader||sp.isOwner` — identical to legacy; server re-enforces everything.

**Net:** ~250 lines of native Stitch (the simple cards) + a 10-line embed of the members panel. Zero backend changes. Zero data duplication. Full feature parity including RoB/extraction permission, name-confirm delete, and invite-link flow.
