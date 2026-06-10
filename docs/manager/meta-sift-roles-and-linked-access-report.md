# META·LAB / META·SIFT — Roles, Linked-Project Access, Versioning & Ops Fixes (prompt5)

Status: **complete** · Date: 2026-06-09 · Builds on prompt1–prompt4.

This is a targeted follow-up (no rebuild, no DB wipe, additive migrations only). It separates
**Owner** from **Leader** everywhere, fixes linked META·LAB ↔ META·SIFT member access, adds a META·SIFT
**Project Control** tab, makes the app **version change with each commit**, puts the shared **account dropdown**
everywhere, and fixes the **ops-console message notification** that never cleared.

---

## 1. Owner vs Leader — the model (Tasks 1 & 2)

| Role | Can be changed by | Powers |
|------|-------------------|--------|
| **Owner** | nobody (only via a future transfer-ownership flow) | Ultimate control. The owner row is **locked** — cannot be edited, removed, demoted, deactivated, or have permissions changed by anyone. |
| **Leader** | the **Owner** only | Manage workflow + ordinary members; add members; manage member roles/status/permissions. **Cannot** change/remove/demote the owner, cannot transfer ownership, and **cannot** change another leader (only the owner can). |
| **Member** (reviewer / data_extractor / …) | owner or leader (or a member granted `canManageMembers`) | Acts strictly per assigned module permissions. |
| **Viewer / read-only** | owner or leader | Views only what permissions allow. |

Key correctness change: the **owner's own role is now `owner`**, never `leader`. The previous code reported the
owner as `leader` in the project list (`isOwner ? 'leader' : …`); that conflation is removed. Owner and Leader are
now **separate fields** in API responses and **distinct chips/colors** in the UI (Owner = gold, Leader = teal).

### Where it shows
- **Project cards** (`SiftDashboard`): a role chip — *You are owner* / *You are leader* / *Shared · Reviewer* — plus a
  footer line `Owner: … · Leader(s): … · N members`.
- **Project Control → Members** (`MembersTab`): the owner row and (for non-owners) leader rows render **locked** with a
  🔒 note — *"Owner permissions cannot be changed here."* / *"Only the owner can change leader permissions."* No role
  dropdown, status toggle, remove button, or permission toggles appear on locked rows.
- **Backend** returns `owner`, `ownerName/ownerEmail`, `leaders[]`, `leaderCount`, and the caller's `myRole`/`isOwner`
  as separate fields. `listMembers` returns `isOwner`, `ownerId`, `myUserId`, and per-row `isOwner`/`isLeader`.

### Server-side enforcement (never trusts hidden UI)
`screeningMemberController.js`:
- add/update/remove require `canManageMembers` (owner, leader, or a member granted it).
- Owner row: only the owner may touch it, and never to change role/status away from owner/active → `400`.
- Leader row: editable/removable **only by the owner** → `403` for everyone else.
- Granting/promoting to **Leader**: **owner only** → `403` otherwise.
- `'owner'` is never assignable via add/update.
- Every change writes a `ScreenAuditLog` entry (`MEMBER_ADDED`, `MEMBER_PERMISSIONS_CHANGED`, `MEMBER_REMOVED`).

---

## 2. Linked META·LAB ↔ META·SIFT member access (Tasks 4 & 6)

**Source of truth for shared membership** = the `ScreenProject` (the "Review Workspace"). When a META·SIFT project is
linked to a META·LAB project (`ScreenProject.linkedMetaLabProjectId`), its members gain access to **both** modules per
their permissions. Link targets are always the workspace owner's own META·LAB projects, so a membership can only ever
grant access to that one owner's project — never a stranger's.

New resolver `server/screening/metalabAccess.js`:
- `getMetaLabMemberAccess(metaLabProjectId, userId)` → `{ role, canView, canEdit, readOnly, screenProjectId, ownerId }` or null.
- `listSharedMetaLabAccess(userId)` → the META·LAB projects a user can reach **as a member**, de-duplicated (most-permissive wins).
- Mapping: owner/leader → full; otherwise `canEditMetaLab && !readOnlyMetaLab` → edit, else `canViewMetaLab` → read-only.

### META·LAB list & access now include member projects
`projectsController.js`:
- `GET /api/projects` returns **owned + shared** projects. Shared ones carry transient annotations `_shared`, `_role`,
  `_canEdit`, `_readOnly`, `_owner`, `_screenProjectId`.
- `GET /api/projects/:id` resolves owner path first, then the membership path.
- `PUT /api/projects/:id/autosave` is **membership-aware and batch-safe**:
  - owner (or new project) → normal save;
  - member with edit permission → `saveAsMember` (updates name+data, **never** changes `userId`);
  - **read-only / no-access → 200 no-op** (`{ skipped: true }`).

  This last point is critical: the META·LAB autosave bridge (`serverStorage.js`) PUTs **every** project in one
  `Promise.all`. If a shared/read-only project returned a 4xx, the whole batch would reject and the user would lose
  their **own** edits. Read-only is therefore a silent no-op, never an error.
- `store.js` `projectToData` now **strips any `_`-prefixed key** before persisting, so collaboration annotations never
  pollute the stored project blob (for owner and member saves alike). New helpers: `getByIdUnscoped`, `getManyByIds`,
  `saveAsMember`.

### META·SIFT list respects module scope
`screeningController.listProjects` hides a project from a member whose membership has **only** META·LAB permission
(`canViewMetaSift = false`, e.g. the `readonly_metalab` preset). Symmetrically, a `readonly_metasift` member never sees
the META·LAB project (no `canViewMetaLab`). Read-only enforcement: a read-only META·LAB member sees the project (list +
open) but their autosave is a no-op; the monolith shows a 🔒 read-only banner.

### Repair / migration
`server/scripts/repair-linked-access.js` (idempotent, non-destructive):
1. ensures every `ScreenProject` has a valid **owner** member row (heals legacy `leader`-as-owner rows → `owner` + full perms),
2. backfills blank `permissionPreset`,
3. reports linked workspaces and how many members gain META·LAB / META·SIFT visibility.
Run: `node server/scripts/repair-linked-access.js`.

---

## 3. Member sync (Task 6)

Adding/removing/permission-changing a member operates on the `ScreenProjectMember` row of the shared workspace, so both
modules read from the same membership:
- **Add** → immediately visible in META·SIFT (if `canViewMetaSift`) and META·LAB (if `canViewMetaLab`/`canEditMetaLab`).
- **Deactivate/remove** → drops access from both (queries filter `status: 'active'`; removal deletes the row).
- **Permission change** → applies on next request (no caching).
Presets (`permissionPresets.js`): Owner, Leader, Reviewer, Data Extractor, Viewer, Read-only META·LAB / META·SIFT / Both, Custom.

---

## 4. Project Control tab (Task 5)

New `src/frontend/screening/tabs/ProjectControlTab.jsx` (tab key `control`, label **Project Control**; legacy
`?tab=members` redirects here). One hub for:
- **Project status** (not started / in progress / done), **blind mode**, **restrict chat** — saved via `updateProject`,
  gated by `canManageSettings`.
- **META·LAB link / unlink** + linked project info + handoff rollup (sent / pending / already-in-extraction / failed).
- **Members & permissions** — embeds the full `MembersTab` (add/remove/role/permission management).

Visibility: Owner = full; Leader = allowed controls but cannot edit the owner (server-enforced); Member/Viewer = read-only info.

---

## 5. Versioning that changes per commit (Task 7)

`server/version.js` resolves once at load (env → generated `version.json` → live git → fallback):
- `version` ← `package.json` (bumped to **2.4.0**), `commit` ← `git rev-parse --short HEAD`,
  `commitDate` ← `git log -1 --format=%cI`, `buildDate` ← env/`commitDate`/now,
  `full` = `vX.Y.Z · <shortCommit> · <YYYY-MM-DD>`.
- `GET /api/version` exposes all of it; `/api/health` + ops `/admin/health` now report the real version (not hardcoded `2.0.0`).
- `scripts/generate-version.js` (`npm run version:gen`, wired into `npm run build`) writes `server/version.json` so
  production without a `.git` dir still reports the real commit/date. **Graceful fallback** to `dev` if git is unavailable.

Displayed in: the shared account dropdown (META·LAB, META·SIFT, ops), and the ops sidebar footer.

---

## 6. Shared account dropdown everywhere (Task 8)

One component, `src/frontend/components/UserMenu.jsx` (name/email · role badge · Account & Profile · cross-app link ·
Ops/Mod Console for staff · app version · Sign out). Mounted in META·LAB (`AppWorkspace`), META·SIFT
(`SiftDashboard`, `SiftProject` — which also covers the Project Control tab), and now the **Ops console top bar**
(`AdminConsole`). Normal users never see the console link; mods see "Mod Console", admins "Ops Console".

---

## 7. Ops message notification clears (Task 9)

**Decision: per-staff read receipts** (each admin/mod has independent read state) — chosen because multiple staff exist
and a shared "read" flag would let one staffer's open hide a message from the others.

- New model `ContactMessageRead` (`@@unique([messageId, userId])`), additive migration `20260609230000_add_contact_message_read`.
- `GET /api/admin/contact-messages/unread-count` → `{ unread }` for the caller (non-archived messages with no receipt).
- `POST /api/admin/contact-messages/:id/mark-read` (`{ read }`) → upserts/deletes the caller's receipt, returns fresh `{ unread }`.
- `GET /api/admin/contact-messages?box=unread|read|archived` filters **per-staff**; each message carries `readByMe`.
- The sidebar badge **and** the admin Overview "Unread Messages" metric (`getMetrics`) are both computed **per-staff**
  (works for **mods** too, who can't read metrics). Opening a message calls `mark-read` so the badge decrements
  immediately and **stays gone after reload/login**. The per-staff actions (`mark-read`, reply) no longer write the
  legacy global `read` flag, so one staffer reading a message can never drop another staffer's unread count.
- Fixed a latent bug: the old `selectMsg` referenced an undefined `setUnread`, which threw and prevented the badge from
  ever updating on open. The in-section header badge + Unread-tab count are sourced from the server count (not the
  current page slice).

QA flow verified end-to-end (create → badge shows → open → badge clears → reload stays clear → second staffer still sees it unread).

### Security hardening (adversarial-review pass)
A multi-agent adversarial review of this change set found and we fixed the following before delivery (regression tests in
`tests/screening/integration/prompt5.test.js` → `SEC1`–`SEC4`):
- **Privilege escalation via raw permission flags** — `updateMember` applied every `PERMISSION_KEYS` flag from the body,
  letting a `canManageMembers` delegate grant the leader-level globals `canManageMembers`/`canManageSettings` (or widen
  their own row). Fixed: global flags are **owner-only** to grant/clear (shared `GLOBAL_PERMISSION_KEYS`), and a non-owner
  cannot edit their own row (self-guard).
- **Cross-owner data leak via the link field** — `PUT /screening/projects/:pid` wrote `linkedMetaLabProjectId` with no
  ownership check, so a non-owner leader could repoint the link to a stranger's META·LAB project and leak it to all
  members. Fixed: `updateProject` validates the target against the workspace owner (matching `linkMetaLab`), and
  `getMetaLabMemberAccess` / `listProjects` now **enforce** (not just assume) `project.userId === workspace owner` and
  `deletedAt: null`.
- **Admin-archived projects still reachable** — the member id-paths (`getByIdUnscoped`/`getManyByIds`/`saveAsMember`)
  ignored `deletedAt`. Fixed to exclude soft-deleted projects.
- **Settings/link controls were non-functional for `canManageSettings` members** (UI enabled, backend 403). Fixed:
  `updateProject`/`linkMetaLab` now honor `canManageSettings` (consistent with the members endpoints honoring
  `canManageMembers`); the UI also reverts optimistic toggles on failure.

---

## Backend / Frontend / DB change summary

**Backend:** `server/version.js`, `server/index.js`, `server/controllers/{adminController,projectsController,screeningController,screeningMemberController}.js`,
`server/routes/admin.js`, `server/store.js`, `server/screening/metalabAccess.js` (new), `server/scripts/repair-linked-access.js` (new),
`scripts/generate-version.js` (new), `package.json`.
**Frontend:** `UserMenu` (now in ops), `AdminConsole`, `adminApiClient`, `SiftDashboard`, `MembersTab`, `SiftProject`,
`ProjectControlTab` (new), and the META·LAB monolith project list + shared/read-only banner.
**DB / migrations:** additive migration `20260609230000_add_contact_message_read` (new `ContactMessageRead` table). No
column drops, no data loss.

## Known limitations
- **No ownership-transfer flow** yet — the owner is fixed to the creator (documented as the intended next step).
- The META·LAB monolith is a single-owner project model. Read-only enforcement for shared members is by **backend no-op
  save** + a clear read-only banner; per-field editor disabling inside the monolith is *not* implemented (deep refactor,
  intentionally deferred to avoid breaking META·LAB). A read-only member's local edits simply don't persist.
- Per-staff message read state replaces the badge logic; both the sidebar badge and the admin Overview "Unread Messages"
  card are now per-staff. The legacy global `read` column still exists (used only by the explicit admin mark-read/unread
  toggle in `updateContactMessage`) but is no longer driven by per-staff opens/replies.
