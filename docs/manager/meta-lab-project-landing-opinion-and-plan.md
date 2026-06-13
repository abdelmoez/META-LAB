# META·LAB Project Landing — Opinion & Implementation Plan

*Author: Fable (architect/reasoning lead). Date: 2026-06-13. Prompt: prompt11.*

This document is both the product/UX opinion the prompt asked for **and** the engineering
spec the implementation agents work from. It is grounded in a full inspection of the live
code (findings in `.claude/tmp/prompt11/inspect/A–D`).

---

## 0. Architecture reality (what actually exists)

The prompt assumes META·LAB *projects* carry owner/leader/member/viewer roles and linked
META·SIFT. The codebase splits that across **two** entities:

| Entity | Role | Collaboration | Lifecycle today |
|---|---|---|---|
| **`Project`** (META·LAB analysis) | single-owner fat-blob (`userId`) | **none of its own** | soft-delete (`deletedAt`/`deletedSource`), **no `archived`** |
| **`ScreenProject`** (Review Workspace / META·SIFT) | `ownerId` + **`ScreenProjectMember`** (owner/leader/reviewer/viewer, granular `canEditMetaLab`/`canRunAnalysis`/`canManageMembers`…), invite ceremony | full member model | `archived` (admin-only), soft-delete, leave (`POST /screening/projects/:pid/leave`) |

The two are linked by `ScreenProject.linkedMetaLabProjectId`, with the invariant
`ScreenProject.ownerId === Project.userId`. Crucially, **`GET /api/projects` already returns
the unified roster** — owned projects *and* projects shared through a workspace membership
(`listSharedMetaLabAccess`), each annotated with `_permissions.role`/`isOwner`, `_shared`,
`_role`, `_canEdit`, `_readOnly`, `_canExport`, `_owner{…}`, and `_linkedMetaSift{id,title}`
(`projectsController.js:20–140`). That endpoint is the data backbone for the landing.

Current post-login flow: `Login → /app → AppWorkspace → <MetaLab/>` monolith
(`meta-lab-3-patched.jsx`). The "project list" is a **256px sidebar switcher inside the
monolith** (`:8149`), selection is a memory-only `activeId` (`:7535`); a `?project=<id>`
deep-link is read once then stripped, so **refresh/back silently resets to `projects[0]`**.

---

## 1. What is weak about the current post-login flow

1. **No real home.** You land *inside* a project shell with a thin sidebar list; there is no
   overview of "all my work," no metrics, no sense of a command center.
2. **Stale-project bug.** `activeId` lives only in React state; refresh → `projects[0]`, not
   the project you were in. If the active project is deleted/loses access mid-session the UI
   silently drops to a Welcome hero with no explanation.
3. **Role/lifecycle invisibility.** A project's role, linked-META·SIFT status, member count,
   archived state, study/record counts — all the things that tell you *what this project is*
   — are buried one or more clicks deep (Control tab) or not surfaced at all.
4. **No archive, fragmented leave.** `Project` has no user-facing archive; workspace
   `archived` is admin-only; "leave" is buried in the Members panel rather than a
   project-level action. Owner soft-deletes are invisible to ops (no `deletedSource` split).
5. **Two disjoint lists.** META·LAB sidebar vs `/sift-beta` SiftDashboard — the user has no
   single place that answers "what can I work on right now?"

## 2. What the new landing page should accomplish

A premium, **post-login project command center** at `/app` that lets the user (a) see every
project they can touch with status/role/linked-SIFT at a glance, (b) search/filter/sort/triage,
(c) act safely by role (open, archive, leave, delete, create, open META·SIFT), and (d) open a
project *deterministically by ID* into the **existing** overview/workflow — without breaking
anything that works today.

## 3. Recommended UX structure (my opinion — implemented)

```
┌ Greeting band ─ "Welcome back, {name}" · "Choose a workspace to continue your
│                  evidence synthesis." · [+ New Project]   [bell] [account]
├ KPI summary tiles (command-center) ─ Accessible · Owned · I lead · Active ·
│                  Linked to META·SIFT · Archived   (real counts, animated, no fakes)
├ Control bar ─ [search]  [quick-filter chips]  [sort ▾]  [cards|table ▾]  [show archived]
├ Project browser ─ responsive card grid (default) / compact table (toggle)
└ Empty states ─ no projects · no active (archived exist) · no search match
```

**Why cards-first with a table toggle:** cards carry the status stripe + role badge +
linked-SIFT pill + progress + counts that make this feel like a research command center;
the table is for power users with many projects. Default = **cards, active-only, newest first**.

## 4. Recommended project card / table design (implemented)

**Card** (adapts `SiftDashboard` `ProjectCard` + `AdminConsole` motion kit):
- Left **status stripe** colored by status (active/in-progress=accent, done=green,
  archived=muted).
- Title + **role badge** (Owner/Leader/Reviewer/Viewer, `tagS` pill) + status pill.
- **Linked-META·SIFT pill**: "META·SIFT · {title}" (teal) or "Not linked" (muted).
- Meta row (MONO, `tabular-nums`): owner (if shared), studies count, screening records (if
  linked), members, created · updated (relative).
- **Progress bar** (3px) when a meaningful progress signal exists; omitted otherwise (no fakes).
- Footer: primary **Open Project →**; overflow **⋯ menu** with role-gated actions; secondary
  **Open META·SIFT** when linked.

**Table row** (toggle): Title · Role · Status · Linked · Studies · Updated · ⋯ — same actions.

## 5. Recommended filters & sorting (implemented)

- **Search** (debounced) over title, owner, linked-META·SIFT title, status.
- **Quick-filter chips**: All · Owned by me · I lead · Shared with me · Read-only · Active ·
  In progress · Done · Linked · Not linked · Archived. Counts shown on each chip.
- **Sort**: Last modified (default) · Created · Title A–Z · Status · My role.
- **View**: cards | table; **show archived** toggle (off by default → archived hidden).

## 6. Archive vs delete — my recommendation (implemented)

**Archive is the default safe lifecycle; delete is soft and guarded.**
- **Archive** = reversible hide. Add additive `archived`/`archivedAt` to `Project`; reuse
  `ScreenProject.archived`. Archived projects leave the active list + the monolith switcher,
  become read-only, and are restorable by the owner. Linked workspace archives together when
  the pair is owned by the same user (the existing invariant guarantees it).
- **Delete** = **soft** only (`deletedAt`/`deletedSource:'owner'`), never hard, owner-only,
  typed-name confirmation, with an explicit consequences list and optional linked-SIFT cascade.
  Hard/permanent deletion stays an ops-only, deliberately-not-built-here capability.

Rationale: research data is expensive and irreplaceable; every destructive path must be
reversible by default and auditable. Both archive and delete write `AdminAuditLog`/
`ScreenAuditLog` + a `UsageEvent`.

## 7. Role-differentiated actions (enforced server-side, mirrored in UI)

| Action | Owner | Leader | Reviewer/Member | Viewer/Read-only |
|---|---|---|---|---|
| Open project | ✓ | ✓ | ✓ | ✓ (read-only) |
| Open / link META·SIFT | ✓ | ✓ (open; link if `canManageSettings`) | open if `canViewMetaSift` | open if allowed |
| Rename | ✓ | if `canEditMetaLab` | — | — |
| Archive / Unarchive | ✓ | only if perms allow (**default no**) | — | — |
| Soft-delete | ✓ | — | — | — |
| Manage members | ✓ | if `canManageMembers` | — | — |
| **Leave project** | **✗** (must transfer/delete/archive) | ✓ | ✓ | ✓ |

Owners cannot leave: there is **no ownership-transfer endpoint yet** (documented gap). The UI
shows *"Owners must transfer ownership or archive/delete the project."* instead of a Leave button.

## 8. Linked META·SIFT status & actions

Each card reads `_linkedMetaSift`. Linked → teal "META·SIFT · {title}" pill + **Open META·SIFT**
routing **directly to `/sift-beta/projects/{linkedId}`** (never the generic list, never
project[0]). Not linked → muted "Not linked" + (owner/`canManageSettings`) **Create / link
META·SIFT** action. "Open Project" routes to `/app/project/{metaLabProjectId}`.

## 9. Avoiding clutter while keeping control

Primary action (**Open**) is always one click; everything destructive/administrative is behind
a per-card **⋯ overflow menu**, role-gated so users only see what they can do. Archived hidden
by default. KPI tiles summarize; chips filter; the table view exists for density. No metric is
shown unless it is real (counts derived from actual data; progress omitted when unknown).

## 10. Risks to the existing workflow & mitigations

| Risk | Mitigation |
|---|---|
| Monolith `activeId` is private; deep-link is stripped on load | **Route split:** `/app` = landing; `/app/project/:projectId` = monolith. AppWorkspace passes the param via a new `initialProjectId` prop that seeds `activeId` — *fixing* the stale bug. Existing `?project=` path preserved. |
| Autosave delete-sweep can fire spurious DELETEs if a sibling page mutates projects | Landing performs **no** project blob writes; lifecycle goes through dedicated endpoints. `knownServerIds` baseline untouched. |
| Adding `Project.archived` breaks the monolith list | Additive, default `false` (legacy clean); `GET /api/projects` excludes archived by default + `?includeArchived=1` for the landing's toggle — the monolith naturally stops showing archived (correct). |
| Migration on VPS `prisma db push` path (prior pain: `@unique` forced `--accept-data-loss`) | Columns are **nullable/defaulted, no unique constraints** → `db push` clean. |
| Breaking existing overview/control/chat | Zero changes to tab internals; only routing + one additive prop. |

## 11. Final implementation plan

**Scope decision (Fable):** ship a complete, tested, coherent **v1 command center** now;
document genuinely large extras as "recommended next." This is a meaningful product/UX upgrade.

### v1 — this delivery
1. **Backend** (additive, safe):
   - Migration: `Project.archived Boolean @default(false)`, `Project.archivedAt DateTime?`.
   - `GET /api/projects`: exclude archived by default; `?includeArchived=1`; add real
     `_studyCount` (and `_recordCount`) derived from the blob before stripping; surface
     `_archived`.
   - `POST /api/projects/:id/archive` + `/unarchive` (owner-only) → cascade linked workspace
     archive; audit + `UsageEvent`.
   - `POST /api/screening/projects/:pid/archive` + `/unarchive` (owner-only, user-facing) on
     `ScreenProject.archived`; audit + usage.
   - Client methods: `api.projects.archive/unarchive/confirmDelete`,
     `screeningApi.archiveProject/unarchiveProject`.
2. **Routing:** `/app` → new `ProjectLanding`; `/app/project/:projectId` → `AppWorkspace`
   → `<MetaLab initialProjectId>`; minimal monolith prop seeding `activeId`. Login/redirects → `/app`.
3. **Frontend:** `ProjectLanding.jsx` + small co-located components (KPI tiles, control bar,
   `ProjectCard`, `ProjectRow`, action menu, Create/Leave/Archive/Delete modals) using theme
   tokens (`C`, `alpha`, `btnS`, `tagS`), `UserMenu`, `NotificationsBell`, `Icon`.
4. **Create flow:** modal (title, optional description, "Create linked META·SIFT" default on)
   → existing `POST /api/projects {createLinkedSift}` → open `/app/project/:id`.
5. **Ops (Task 12):** AdminConsole — show `deletedSource` (owner vs admin), add restore for
   owner-soft-deleted workspaces (`adminApi.screening.restore`), surface archive/delete audit.
6. **Tests:** backend integration (list excludes archived / `includeArchived` shows them;
   archive owner-only; soft-delete owner-only + hides; leave non-owner only; shared list
   includes member projects; open route uses correct id) + run full suite + build.
7. **Docs:** update `api-contract.md` (fix stale "permanently removes" on `DELETE
   /api/projects/:id`; document archive/unarchive + `includeArchived`), `database-schema.md`
   (`Project.archived/archivedAt`).
8. Version bump, commit, push.

### Deferred (documented, with reasons)
- **Ownership transfer** endpoint (unblocks owner-leave) — net-new server+client+UI; out of
  v1 to keep blast radius safe. UI already guides owners correctly.
- Per-card *live* screening stats join (extra queries) — show linked title now, counts lazily.
- Persistent "recently opened" (new column) — v1 uses `updatedAt`-based "recently updated."
- Full table-view parity polish and the complete 34-step manual QA matrix.
