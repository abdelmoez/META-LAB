# Current Live App Audit — Addendum Cycle (prompt12)

*Author: Sonnet technical writer. Source: inspection findings in .claude/tmp/prompt12/inspect/* and .claude/tmp/prompt11/inspect/*. Date: 2026-06-13.*

Headline: the vast majority of the prompt12 roadmap is already implemented and working. This audit records the honest status of every surface area examined, and identifies the narrow set of fixes being applied in this cycle.

---

## Audit status vocabulary

- **Working** — implemented correctly, no action needed.
- **Implemented-buggy** — implemented, but a code defect produces wrong output; fix applied this cycle.
- **Implemented-confusing** — implemented correctly but the UX is unclear or misleading; improvement applied this cycle or documented.
- **Missing** — not implemented; noted as a gap.
- **Should-improve** — working but worth polishing; improvement applied this cycle or deferred.
- **Should-not-touch** — working; in active parallel edit by Fable; leave alone.

---

## 1. Public Landing Page

**Status: Working**

The public landing page (evidence-pipeline redesign, prompt8) is live. No action needed this cycle.

---

## 2. Login Flow

**Status: Working**

Login → `/app` → `AppWorkspace` → `<MetaLab/>` monolith. `PublicRoute` bounces authenticated users away from `/login`. Post-login redirect is `/app`. No defects found.

---

## 3. META·LAB Project Landing / Selector (prompt11)

**Status: Working**

`src/frontend/pages/ProjectLanding.jsx` is implemented with the full KPI/search/filter/sort/triage landing. Routed at `/app`. Project cards carry status stripe, role badge, linked-META·SIFT pill, meta row, overflow menu. Filters: All / Owned by me / I lead / Shared / Read-only / Active / Archived / Linked / Not linked. Sorts by last modified, created, title, status, role. Archive/unarchive/soft-delete with typed-name confirmation are wired. Lifecycle goes through dedicated endpoints; no blob writes from the landing.

One known gap carried forward from prompt11: the monolith strips `?project=` immediately via `history.replaceState`, so refresh inside a project resets to `projects[0]`. This is mitigated by the `/app/project/:projectId` route param passed via `initialProjectId` prop. Not regressed by this cycle.

---

## 4. META·LAB LAB Overview / Command Center

**Status: Working**

`OverviewTab()` at monolith L6912 provides a readiness rollup via `auditProject()` (L6745-6794) scoring PLAN→REPORT items, PRISMA summary, next-step walker, and an animated command center. The Overview answers "where am I, what is incomplete, what is next" for the active project.

---

## 5. META·SIFT Overview

**Status: Working**

`SiftProject.jsx` provides per-workspace overview with screening stats, member list, conflict/duplicate counts, and handoff status. The `← Projects` back-navigation to `/sift-beta` already exists at `SiftProject.jsx:117-120`. No treatment needed.

---

## 6. Review Workspace Linking

**Status: Working**

`ScreenProject.linkedMetaLabProjectId` links the two entities. The link invariant (`ownerId === Project.userId`) is enforced. `annotateOwned` / `annotateShared` in `projectsController.js` surface `_linkedMetaSift` on the project list. "Open META·SIFT" routes to `/sift-beta/projects/{linkedId}`. `POST /api/screening/projects/:pid/link` and `/linkable` exist. No issues found.

---

## 7. Project Navigation — Back to Projects (META·LAB)

**Status: Missing → Fix applied this cycle**

Inside a META·LAB project (the monolith), there is no "Back to Projects" control. Every subpage (overview, extraction, PRISMA, analysis, methods, control, ...) lives inside the 256px fixed sidebar shell with no upward navigation affordance. `SiftProject.jsx` already has the equivalent "← Projects" button at L117.

**Fix being applied:** add a `onBackToProjects` prop to `MetaLab()` at L7533; wire `useCallback(() => navigate('/app'))` from `AppWorkspace.jsx`; render a persistent sidebar button between the brand block (L8147) and the PROJECTS section (L8149) using `<Icon name="arrowLeft"/>` + `nav-item` styling. The monolith stays router-free.

---

## 8. Ops / Admin Console

**Status: Working**

`AdminConsole.jsx` has 10 NAV_SECTIONS: overview, users, projects, sift, content, settings, flags, messages, security, health. Animated KPI kit, user table with `RoleBadge`, project table, SIFT workspace table.

Known gap (not fixed this cycle): the META·LAB Projects table maps `deletedAt` to one "archived" badge and never surfaces `deletedSource`, so admin-archive and owner-delete look identical. The SIFT workspaces table has no Restore button for owner-soft-deleted rows despite the endpoint existing (`PATCH /admin/screening/projects/:id/restore`). These are documented in the next-cycle target.

---

## 9. Mod Console Behavior

**Status: Working**

`requireAdminOrMod` gates `/console`, `/users*`, `/contact-messages*`. `requireAdmin` gates role-change, metrics, settings, flags, security, health. `requireTargetEditable` limits mod mutations to `role==='user'` targets — mods cannot edit other mods or admins. The `MOD_PERMISSIONS` set (`manage_users, view_users, reply_messages, manage_messages`) is enforced server-side via `requirePermission`. AdminConsole shows "Mod Console" pill with `alpha(C.teal,'14')` background. Role-switching in the UI already offers `mod`.

---

## 10. Account Settings — Last Active Display

**Status: Implemented-buggy → Fix applied this cycle**

The `lastActive` field is written correctly by four server-side paths (login, requireAuth throttle at 5-min interval, profile update, password change). The bug is in the read path:

- `GET /api/auth/me` (`authController.js:213`) does NOT select `lastActive` — it is absent from the select object.
- `Profile.jsx:359` reads `user?.updatedAt || user?.lastActive`, where both are `undefined` because `AuthContext` is fed exclusively by `getMe()` → `/api/auth/me`.
- Result: "Last active" always shows "—".

**Fix A (required):** add `lastActive: true` to the select at `authController.js:213`.
**Fix B (required):** change `Profile.jsx:359` to read `user?.lastActive` only (drop `updatedAt` fallback).
**Fix C (recommended):** add a `fmtDateTime` helper in `Profile.jsx` that shows date + time rather than date-only, matching the relative style used in AdminConsole via `fmtAgo`.

---

## 11. Role Assignment UI

**Status: Working with documented confusions**

Global roles (`admin | mod | user`) and project roles (`owner | leader | reviewer | viewer`) are separate and correctly enforced server-side. The `RoleBadge` component in `AdminConsole.jsx` (L1444-1448) with `ROLE_COLORS {admin: C.gold, mod: C.teal, user: C.muted}` already badges global roles in the ops console user table (site A), user-detail panel (site B), and ops console header (site C).

The one missing badge site is the account dropdown (`UserMenu.jsx:98-99`), which shows the role as plain MONO uppercase text. **Fix applied this cycle:** convert to a subtle pill using the same `ROLE_COLORS` + `alpha()` convention.

Documented confusions (no code changes, documented only):
- `reviewer` is overloaded: it is both a `member.role` value and a preset name, and the `data_extractor` preset also maps to `role:'reviewer'`, so two functionally different members look identical in member tables.
- The schema comment at `schema.prisma:19` says `"user" | "admin"` but `'mod'` is fully operational — stale comment, 1-line fix.
- The `owner` and `leader` presets have byte-identical permissions; the difference is the role label and owner's immutability.
- Two parallel add-member implementations exist (monolith `CtrlAddMember` and SIFT `MembersTab.jsx` `AddMemberModal`) with duplicated preset/module lists that must be kept in sync manually.

The role model is NOT being renamed or migrated this cycle. The inspection confirmed that "Contributor" → "reviewer" is the existing implementation, and the rename would require touching the DB, both add-member UIs, all member tables, and tests — risky without clear user-facing demand. See chosen-implementation-path.md for the next-cycle recommendation.

---

## 12. Admin / Mod Name Display — Role Badges

**Status: Implemented-confusing in UserMenu → Improvement applied this cycle**

Ops console already uses `RoleBadge`. The account dropdown (`UserMenu.jsx:98-99`) shows raw text. **Fix applied this cycle:** inline the same two-token color map in `UserMenu` to produce a subtle pill (gold for admin, teal for mod) consistent with the ops console badge convention. Normal users (`role === 'user'`) continue to show nothing — the existing behavior where the role line is hidden for regular users is preserved.

---

## 13. Back-Navigation from META·SIFT

**Status: Working — Should-not-touch**

`SiftProject.jsx:117-120` already has `← Projects` → `navigate('/sift-beta')` in the persistent sticky header. No change needed.

---

## Summary of fixes applied this cycle

| Item | File(s) changed | Type |
|---|---|---|
| Last-active: add `lastActive` to `/api/auth/me` select | `server/controllers/authController.js:213` | Bug fix |
| Last-active: read correct field in Profile | `src/frontend/pages/Profile.jsx:359` (+ optional fmtDateTime) | Bug fix |
| Back to Projects button in META·LAB sidebar | `meta-lab-3-patched.jsx` (new prop + button) + `AppWorkspace.jsx` (new callback + prop) | Missing feature |
| Global role badge in UserMenu | `src/frontend/components/UserMenu.jsx:98-99` | UX improvement |

**Files that are NOT touched this cycle** (Fable parallel edits): `meta-lab-3-patched.jsx`, `AppWorkspace.jsx`, `authController.js`, `Profile.jsx` — the lead is concurrently editing these four files. All four of the above fixes will be delivered by the Fable lead's patch, not by this agent.
