# META·LAB / META·SIFT — Role-System Review & Recommendation

*Author: Opus (permissions / UX analyst). Date: 2026-06-13. Prompt: prompt12, Task 4.*

Grounded in `.claude/tmp/prompt12/inspect/roles.md`, `.claude/tmp/prompt11/inspect/B-workspace-model.md`,
and the source of truth `src/research-engine/screening/permissionPresets.js`.

**Recommendation up front:** **KEEP the current model.** The two-tier design (global app roles +
project workspace roles + presets + permission keys) is already correct and well-enforced. The
confusion is in **labels and visibility, not in logic.** This cycle should do **label/clarity work
only — no role rename, no migration.** A genuine `reviewer→contributor` rename is a sound *future*
step; this document specifies it as an optional, mapped, deferred change so it can be done safely
later without breaking existing members.

---

## 1. Current roles found in code/database

### A. Global app roles — `User.role` (`schema.prisma:19`)
- Values: **`admin` | `mod` | `user`** — all three are **live**. (`mod` is a real, fully-working
  global role; the schema comment `"user" | "admin"` at `:19` is **stale** and should be corrected —
  a 1-line doc fix, no migration.)
- Plain Prisma `String @default("user")` — no DB enum / CHECK; app uses exactly these three.
- **Enforcement (server, DB-verified, never trusts JWT):**
  - `requireRole(['admin','mod'])` = `requireAdminOrMod` (`requireRole.js:55`).
  - `requireTargetEditable` (`requireRole.js:70-101`): a mod may mutate **only** `role==='user'`
    targets; editing an admin or another mod → 403 + `MOD_TARGET_DENIED` SecurityEvent.
  - `requireAdmin = requireRole(['admin'])`; `MOD_PERMISSIONS` = {manage_users, view_users,
    reply_messages, manage_messages} (`requireAdmin.js:20-25`); `requirePermission` (`:27-59`).
  - Routes (`routes/admin.js`): `/console`, `/users*`, `/contact-messages*` = `requireAdminOrMod`;
    **role change `PATCH /users/:id/role` = `requireAdmin` only** (`:93`); metrics/settings/flags/
    security/health/screening-admin = `requireAdmin`.
- Seeding: `seed-admins.js` only ever creates `admin`; **mods are minted via the admin UI dropdown**
  (which already offers `mod`).

### B. Project / workspace roles — `ScreenProjectMember.role` (`schema.prisma:348`)
- Values: **`owner | leader | reviewer | viewer`** (4 roles).
- These govern access **inside** a linked Review Workspace (and, through it, the linked META·LAB
  project). A plain `Project` (unlinked META·LAB analysis) is **single-owner** (`Project.userId`) and
  has no member rows of its own — collaboration always flows through the `ScreenProject` pairing
  (invariant `ScreenProject.ownerId === Project.userId`).

## 2. Current permission flags (18 keys) + 8 presets

- **18 `PERMISSION_KEYS`** (`permissionPresets.js:13-21`):
  - META·SIFT (9): `canViewMetaSift, canScreen, canSecondReview, canResolveConflicts,
    canManageDuplicates, canImportRecords, canExportRecords, canChat, readOnlyMetaSift`.
  - META·LAB (6): `canViewMetaLab, canEditMetaLab, canManageExtraction, canRunAnalysis, canExport,
    readOnlyMetaLab`.
  - Global (2): `canManageMembers, canManageSettings` (`GLOBAL_PERMISSION_KEYS`, `:74`) — granting
    either confers leader-equivalent authority, so they are **owner-only to grant/revoke**.
- **8 `PERMISSION_PRESETS`** (`:33-66`) → role:
  | preset | role | gist |
  |---|---|---|
  | `owner` | owner | FULL + both globals (display; enforcement = full) |
  | `leader` | leader | FULL + both globals |
  | `reviewer` | reviewer | screen + second review + chat + view META·LAB |
  | `data_extractor` | **reviewer** | view screening; edit META·LAB extraction + run/export analysis |
  | `viewer` | viewer | read-only both + chat |
  | `readonly_metalab` | viewer | view META·LAB read-only |
  | `readonly_metasift` | viewer | view META·SIFT read-only + chat |
  | `readonly_both` | viewer | view both read-only |
- `ASSIGNABLE_PRESETS` (`:69`) = the 7 non-owner presets (owner is implicit/fixed).
- **Enforcement** (`server/screening/access.js`): owner & `role∈{leader,owner}` → `fullPermissions()`;
  everyone else → their stored flags. `getProjectAccess` returns `null`→404 (existence-hiding) when
  missing/soft-deleted/non-member/pending. `ensureLeaderMember` self-heals the owner row.

## 3. Where roles are ASSIGNED

- **Global role:** admin-only dropdown, `PATCH /api/admin/users/:id/role` (`requireAdmin`,
  `routes/admin.js:93`). Mods cannot change roles.
- **Project role/preset (two near-identical add/edit UIs):**
  1. **META·LAB monolith** `CtrlAddMember` (`meta-lab-3-patched.jsx:7218-7292`) + `CtrlMemberRow`
     (`:7133`): two `<select>`s — preset + "Participates in" (both/metalab/metasift).
  2. **META·SIFT** `AddMemberModal` (`MembersTab.jsx:566+`) + `MemberRow` (`:408+`): same two
     dropdowns, plus quick toggles and a collapsible "All permissions" matrix post-add.
- Server add/edit: `addMember` / `updateMember` (`screeningMemberController.js`): granting `leader`
  or any GLOBAL flag is **owner-only**; `owner` is never assignable; owner row is locked.

## 4. Where roles are DISPLAYED

| Role kind | Site | File:line | Rendering |
|---|---|---|---|
| Global | Ops user table "Role" col | `AdminConsole.jsx:1712` | `RoleBadge` (admin gold / mod teal / user muted) — DONE |
| Global | Ops user-detail header | `AdminConsole.jsx:1569` | `RoleBadge` — DONE |
| Global | Ops console header (viewer) + "Mod Console" pill | `AdminConsole.jsx:3563`, `:3543` | `RoleBadge` + pill — DONE |
| Global | Account dropdown (UserMenu) role line | `UserMenu.jsx:98-99` | **plain MONO uppercase text**, only when `role!=='user'` — **NOT badged (the one gap)** |
| Project | SIFT member table | `MembersTab.jsx:395` | `m.role` text/tag |
| Project | LAB member row | `meta-lab-3-patched.jsx:7149` | `m.role` tag |
| Project | Landing card role badge | `ProjectLanding.jsx` | Owner/Leader/Reviewer/Viewer pill |

`ROLE_COLORS = { admin: C.gold, mod: C.teal, user: C.muted }` + `RoleBadge` already exist
(`AdminConsole.jsx:1444-1448`) but are module-local to the admin bundle.

## 5. What is confusing (candid)

1. **`reviewer` is overloaded across two axes.** It is both a `member.role` value **and** a preset
   name — and a *different* preset (`data_extractor`) **also maps to `role:'reviewer'`**. So a "Data
   Extractor" shows the role tag "Reviewer" while holding META·LAB-edit/analysis powers a plain
   reviewer lacks. Member tables badge `m.role`, so two functionally different members look identical;
   the *preset* is the real differentiator but isn't surfaced on the badge.
2. **The word "Role" means two different things.** Global `User.role` (admin/mod/user) and project
   `member.role` (owner/leader/reviewer/viewer) are distinct columns with distinct UIs, but both
   appear under a column literally labeled "Role" in the admin console (`:1712` global vs `:3154`
   project). A skimmer can conflate them.
3. **Owner appears as a member row** (it is a real `ScreenProjectMember`) but its controls are locked
   and a "second owner" is never assignable — so Owner's absence from `ASSIGNABLE_PRESETS` can read as
   "missing" rather than "intentional."
4. **owner vs leader presets are byte-identical perms** (`:34-41`, both FULL + both globals). The only
   real differences are the label and owner's un-demotability — easy to mistake for redundancy.
5. **Stale schema comment** (`schema.prisma:19`) omits `mod` → invites the wrong assumption that mod
   doesn't exist.
6. **"Custom · <role>"** is a UI-only sentinel (`MembersTab.jsx:415`, monolith `:7160`) shown when
   per-member toggles diverge from any preset — there is no stored `custom` preset, which can confuse
   anyone reading state.
7. **Two parallel add-member UIs** carry duplicated preset/module lists and help copy that must be
   hand-synced — any wording change must touch both.

## 6. What is redundant / what is unsafe

- **Redundant (cosmetically):** owner vs leader preset perms are identical; the differentiation is
  role-label + un-demotability. This is *correct design*, not a bug — owner needs an immutable
  identity. Leave the perms identical; clarify the labels.
- **Unsafe?** **Nothing is unsafe.** Enforcement is solid: DB-verified roles, existence-hiding 404s,
  owner-only grants for leader/global flags, mod-cannot-touch-admin/mod with a SecurityEvent, locked
  owner row. There are **no permission leaks** in the reviewed paths. The issues are purely
  presentational.

## 7. Final recommended role model — KEEP, clarify, do NOT rename this cycle

**Decision: keep the 4 project roles + the 8 presets + 18 keys exactly as they are. Keep the 3 global
roles. Do not rename, do not migrate.** Rationale: the model already implements precisely what
prompt12 Task 4 asks for (global vs project separation, fewer roles + presets on top), and it is
enforced correctly. A rename touches `ScreenProjectMember.role` values, every preset's `role` field,
both add-member UIs, the access resolver, tests, and existing rows in production — high blast radius
for a label change, against the cycle's "additive only / do not break permissions" mandate.

### Safe clarity changes for THIS cycle (no logic, no migration)

1. **Badge the global role in UserMenu (`:98-99`)** — the one missing display site. Convert the plain
   text to a subtle pill: admin → `C.gold`, mod → `C.teal`, user → `C.muted`, using the `alpha(C.x,
   '14')` pill convention (precedent: the "Mod Console" pill `AdminConsole.jsx:3543`). Reuse/lift
   `RoleBadge` so UserMenu and AdminConsole share one implementation. **(Note: UserMenu.jsx is NOT one
   of the four locked files; this is safe. Profile.jsx and the monolith ARE locked — leave them.)**
2. **Label disambiguation in the admin console:** rename the two ambiguous column headers from "Role"
   to **"App role"** (global table) and **"Project role"** (per-project member view). Pure string
   change.
3. **Surface the preset, not just the role, on member rows** — so "Data Extractor" reads as
   "Data Extractor" rather than the bare "Reviewer" tag. Show `PERMISSION_PRESETS[preset].label`
   alongside or instead of `m.role`. The label data already exists (`permissionPresets.js:35-65`).
   *(SIFT MembersTab is editable here; the monolith CtrlMemberRow is Fable-owned — design-only there.)*
4. **Fix the stale schema comment** (`schema.prisma:19`) to `"user" | "admin" | "mod"`. 1 line.
5. **Show preset descriptions in the add-member flow** — render the selected preset's
   `description` (already authored) under the dropdown instead of the static, hand-synced help line.
   Single source, both UIs stay consistent.

### Optional FUTURE step (design-only, documented, NOT this cycle): label-only rename + mapping

If the product later wants the prompt's suggested vocabulary (Owner / Leader / **Contributor** /
Viewer), do it as a **display-label change with a stored-value mapping**, never a destructive rename:

| Stored value (unchanged) | Current label | Future display label |
|---|---|---|
| `owner` | Owner | Owner |
| `leader` | Leader | Leader |
| `reviewer` | Reviewer | **Contributor** |
| `viewer` | Viewer | Viewer |

Mapping rules for a safe future migration:
- **Do not change the `role` column values.** Keep `reviewer` as the stored token; map it to the
  display label "Contributor" only in the UI label layer (`PERMISSION_PRESETS[*].label` and member-row
  rendering). This is reversible and breaks nothing.
- Keep `data_extractor` (and `reviewer`) as **presets on top of `role:'reviewer'`** — i.e., the
  prompt's own preferred model ("Reviewer" and "Data Extractor" are presets, not roles). The code
  **already** does this; the only change is the human label of the underlying role.
- Add a tiny `roleLabel(role)` helper as the single rendering source so global vs project labels never
  collide.
- No DB write, no data migration, no `prisma migrate`. If a stored-value rename is ever truly required,
  it must ship with a forward map + backfill + test, and is explicitly **out of scope** here.

## 8. Recommended global-role presentation (Task 2 styling)

- **Admin → subtle red/ruby**, **Mod → subtle green/emerald** as the prompt asks. The existing
  `ROLE_COLORS` uses `gold` for admin and `teal` for mod. To honor the prompt's red/green intent
  without harshness, map **admin → `C.red`** (subtle, via `alpha(C.red,'14')` background) and **mod →
  `C.grn`/`C.teal`**, keeping accessible contrast in both day and night themes. Apply at the five
  display sites in §4 that show **global** role; **never** color project roles (owner/leader/reviewer/
  viewer) with the global palette — keep the two tiers visually distinct.
- **Do not** badge the contact/support sender area — senders are often unregistered contacts with no
  `User.role` (`AdminConsole.jsx` MessagesSection ~`:1255-1420`).

## 9. QA the changes must preserve (no regressions)

- Admin global role does **not** auto-make project owner; mod does **not** auto-make leader (already
  true — global and project tiers are independent).
- Owner row locked; leader cannot edit owner; viewer read-only; mod cannot edit admin/mod (already
  enforced — verify still green after label edits).
- Existing members keep their exact permissions (labels change, stored values do not).
- UserMenu badge renders in day + night; normal users stay neutral.

**Net:** the role *logic* is correct and safe and should not be rebuilt or migrated. Ship **labels,
one missing badge, and a comment fix** this cycle; document the Contributor rename as a mapped,
reversible, future-only step.
