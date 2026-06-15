[FROM: Backend & Data Model Engineer] [TO: Team] [TOPIC: Unified review workspace — backend plan] [MESSAGE: The backend is ALREADY a review workspace (auto-create linked SIFT, membership→ML access, handoff, PRISMA rollup). prompt18 needs ONE new idempotent ensure/repair primitive + endpoint, forced module-create on the unified create path, and a backfill — ZERO schema change.] [FILES I OWN: server/screening/ensureWorkspace.js (new), server/routes/screening.js, server/controllers/screeningController.js, server/controllers/projectsController.js, server/controllers/adminController.js (+screeningAdminController.js for module health), scripts/backfill-screen-modules.mjs (new)] [WHAT I NEED FROM YOU: Frontend (UX) — call `GET /api/screening/metalab/:mlpid/workspace` on first Screening-tab open and pass the returned `screenProjectId` to embedded SiftProject; do NOT call the link/unlink endpoints in normal UX. QA — assert idempotency (created→false on 2nd call), member-resolve-without-create, and no destructive backfill. Methods — confirm the handoff + PRISMA-summary contracts below are the ones the Screening→Extraction→PRISMA stages consume.]

# Phase 4 — Backend Architecture Plan

## 0. Scope and honest framing

The hard backend work for a unified review workspace was **already done** across prompts 4–13. This phase does not re-architect the backend; it adds **one missing primitive** (idempotent ensure-and-repair of the screening module for a META·LAB project), exposes it on **one new endpoint**, makes the unified create path **always** create the module, and **backfills** the handful of pre-existing Projects that may lack a module. No Prisma schema change is required or proposed.

Being blunt about what is genuinely new vs. what already exists matters, because the risk of this prompt is *re-implementing* things that work and introducing regressions. The list below is verified against the live code, not assumed.

### Already built (do NOT rebuild)

| Capability | Where it lives | Status |
|---|---|---|
| Server-side atomic create of a linked `ScreenProject` (no second client POST) | `server/screening/createScreenProject.js` → `createLinkedScreenProject()` | Done. Seeds keywords, 7 exclusion reasons, `ensureLeaderMember`, PICO snapshot. |
| Project creation opt-in to create the module | `projectsController.createProject()` (`createLinkedSift:true`) | Done — but **opt-in**; this phase forces it on for the unified path. |
| Membership → META·LAB access (view/edit/export/read-only) | `server/screening/metalabAccess.js` → `getMetaLabMemberAccess()`, `listSharedMetaLabAccess()`, `mlAccessFromMember()` | Done. **This is why no new permission model is needed.** |
| Owner/member access resolution + self-heal of owner member row | `server/screening/access.js` → `getProjectAccess()`, `ensureLeaderMember()` | Done. `ensureLeaderMember` is already idempotent and self-healing. |
| Handoff: accepted full-text record → `Project.data.studies[]` (idempotent by DOI/PMID/title) | `screeningReviewController.finalizeRecord()` / `retryHandoff()` | Done. |
| PRISMA-shaped rollup for a linked ML project | `screeningController.getMetaLabSummary()` (`GET /api/screening/metalab/:mlpid/summary`) | Done. Already does prefer-own-then-membership resolution. |
| Shared chat resolved via the ML link | `screeningChatController.*MetaLab*` (`/api/screening/metalab/:mlpid/chat`) | Done. |
| Kill-switch | `routes/screening.js` `checkEnabled` → 503 when `metaSiftSettings.enabled=false` | Done. |
| Owner/member-aware getProject / updateProject / autosave / list | `projectsController` (owner path + member path via `getMetaLabMemberAccess`) | Done. |

### Genuinely new in this phase

1. `server/screening/ensureWorkspace.js` — **new** idempotent ensure-and-repair helper.
2. `GET /api/screening/metalab/:mlpid/workspace` — **new** endpoint (ensure + resolve).
3. `projectsController.createProject()` — unified create path **always** creates the module.
4. `scripts/backfill-screen-modules.mjs` — **new** one-shot repair for live data.
5. Ops/admin module-health surface — extend `adminController.getMetrics` (or a small dedicated admin endpoint in `screeningAdminController.js`).

---

## 1. Identity model — public vs. internal-service boundary

The locked decision: the META·LAB **`Project` is the single user-facing "Review Project."** The linked **`ScreenProject` is an internal service**: it is the screening engine AND the shared membership / permission / chat / audit layer. The two stay **separate engines** — separate Prisma models, separate controllers, separate routes. We are unifying the *experience*, not merging the *data models*.

```
                 USER-FACING IDENTITY                       INTERNAL SERVICE (engine)
   ┌──────────────────────────────────────┐      ┌──────────────────────────────────────────┐
   │  Project  (Prisma model)             │      │  ScreenProject  (+ ScreenRecord/Decision/  │
   │  - single owner: userId              │ soft │   Conflict/DuplicateGroup/ImportBatch/     │
   │  - data: JSON blob                   │  FK  │   Member/Chat/Audit)                       │
   │  - the "Review Project"              │◄─────┤  - linkedMetaLabProjectId  (nullable str)  │
   │  - /api/projects                     │      │  - ownerId === linked Project.userId       │
   │  - shown at /app, /app/project/:id   │      │  - /api/screening  (hidden from normal nav)│
   └──────────────────────────────────────┘      └──────────────────────────────────────────┘
        ▲  PUBLIC SURFACE                                ▲  INTERNAL SURFACE
        │  user thinks in Projects + a "Screening" tab   │  ops/admin/debug + embedded SiftProject only
```

### The link is a soft FK (deliberately removable)

`ScreenProject.linkedMetaLabProjectId` is a **nullable String with no DB-level relation** to `Project`. This is intentional and we keep it: it means the screening engine can be detached, archived, or repaired without cascade constraints, and a half-broken pair is recoverable rather than a foreign-key error. The **invariant we enforce in code** (not in the schema) is:

> A linked `ScreenProject.ownerId` always equals the linked `Project.userId`.

This is enforced today in `metalabAccess.getMetaLabMemberAccess()` (defense-in-depth check: `proj.userId === sp.ownerId`) and in `screeningController.linkMetaLab()` (link targets restricted to the owner's own ML projects). The new ensure helper must preserve this invariant — it creates the module with `ownerId = Project.userId`, never anyone else's id.

### Public vs. internal API boundary

| Surface | Endpoints | Audience after prompt18 |
|---|---|---|
| **Public (user-facing)** | `/api/projects/*` (list/get/create/update/autosave/archive/duplicate), `GET /api/screening/metalab/:mlpid/workspace` (resolve module for the Screening tab), `GET /api/screening/metalab/:mlpid/summary` (PRISMA numbers), `/api/screening/metalab/:mlpid/chat` (shared chat) | Normal users. These are framed as "the Review Project and its Screening stage." |
| **Internal service** | the rest of `/api/screening/*` (records, decisions, conflicts, duplicates, second-review, import/export, members, reasons, stats) | Consumed by the **embedded** SiftProject inside the Screening tab. Same endpoints as today; the user never sees a separate "META·SIFT app." |
| **Admin / debug / back-compat** | `/api/screening/projects/*` standalone CRUD, `POST /projects/:pid/link`, `getLinkable`, `/sift-beta` UI routes, `/api/admin/screening/*` | Staff and deep-links only. Kept working; hidden from normal nav by the frontend, not removed from the backend. |

The boundary is **enforced by what the frontend calls**, not by new auth. All `/api/screening/*` routes are already `requireAuth` + membership-scoped via `getProjectAccess`, and ML access is already membership-scoped via `getMetaLabMemberAccess`. No new permission model — confirmed.

---

## 2. The ensure/repair primitive — `server/screening/ensureWorkspace.js` (new)

This is the heart of the phase. One module, two exported functions. It must be **idempotent**, **race-safe**, **non-destructive**, and **owner-vs-member aware**.

### 2.1 `ensureScreenModuleForMetaLab(mlProjectId, user)` — owner-path ensure

Semantics: given a META·LAB project id and the **owner**, return the linked `ScreenProject`, creating it if missing and repairing it if structurally incomplete. Idempotent: calling it N times yields the same module and reports `created/repaired` honestly.

```
async function ensureScreenModuleForMetaLab(mlProjectId, user):
  1. Load the Project (deletedAt:null). If missing  -> return { ok:false, reason:'project_missing' }.
  2. Authorization:
       - if Project.userId === user.id            -> owner: may CREATE + REPAIR.
       - else: getMetaLabMemberAccess(mlProjectId,user)
            - canView -> member: may RESOLVE only (never CREATE). See 2.2.
            - else    -> return { ok:false, reason:'forbidden' }.
  3. Resolve existing module(s):
       prisma.screenProject.findMany({ where:{ linkedMetaLabProjectId: mlProjectId, deletedAt:null } })
       Prefer the one whose ownerId === Project.userId (the canonical pair).
  4a. NONE exists AND caller is owner:
        sp = createLinkedScreenProject({ ownerId: Project.userId, title: Project.name,
                                         linkedMetaLabProjectId: mlProjectId, mlData: Project.data })
        created = true
  4b. EXISTS:
        created = false
        REPAIR (idempotent, additive only):
          - ensureLeaderMember(sp)                       // self-heals/creates owner member row
          - if sp.ownerId !== Project.userId  -> log + flag 'owner_mismatch' (do NOT silently rewrite; see note)
          - if no exclusion reasons rows       -> seed DEFAULT_EXCLUSION_REASONS
          - if title drifted AND in-sync rule  -> (optional, best-effort) align title
        repaired = (any repair action ran)
  5. return { ok:true, screenProjectId: sp.id, created, repaired }
```

**Race safety.** Two concurrent first-opens of the Screening tab could both see "none exists" and both create. We guard with a Prisma transaction + a re-check, and we accept the soft-FK reality: if a duplicate slips through, `getMetaLabSummary` / the resolve path already does "prefer-own-then-membership, most-recent `updatedAt`" so a duplicate is harmless (deterministic winner). We also add a cheap advisory de-dup pass in the backfill (Section 5) so duplicates never accumulate silently. We do **not** add a DB `@unique(linkedMetaLabProjectId)` constraint — that violates the db-push deploy rule (no new `@unique`) and would turn a recoverable duplicate into a hard 500.

**`owner_mismatch` note (honesty).** If a legacy module's `ownerId` does not match the Project's `userId`, the helper does NOT silently rewrite ownership (that could hand a stranger's membership graph to the wrong user). It flags `repaired:false, warning:'owner_mismatch'` so ops can inspect. In practice this cannot occur for modules created via `createLinkedScreenProject` (it always sets `ownerId = the owner`), so this is purely a defensive guard for hand-edited / imported data.

### 2.2 Member resolve (no create)

A member opening the Screening tab must **resolve** the existing module but must **never create** one — only the owner's act of opening (or project creation) creates the module, and the create must use the owner's id. If a member opens Screening and no module exists yet, the correct response is **not** to create under the member's id; it is to return `{ ok:true, screenProjectId:null, created:false, repaired:false, pending:true }` (the owner hasn't initialized it) OR, more robustly, the create path at project creation (Section 4) guarantees the module exists before any member can be added, so `pending` should be vanishingly rare. We document `pending` as the honest edge case rather than pretending it can't happen.

### 2.3 Why a new helper instead of reusing `getMetaLabSummary`

`getMetaLabSummary` already does the **resolve** half (prefer-own-then-membership) but it is read-only — it returns `{linked:false}` when no module exists and never creates/repairs. We keep it as the PRISMA-numbers endpoint and add `ensureWorkspace.js` as the create/repair authority. The resolve logic is shared/extracted so the two cannot drift: extract a small `resolveLinkedModule(mlProjectId, user)` used by both `getMetaLabSummary` and `ensureScreenModuleForMetaLab`.

---

## 3. The new endpoint — `GET /api/screening/metalab/:mlpid/workspace`

Added to `server/routes/screening.js` next to the existing `/metalab/:mlpid/summary` and `/metalab/:mlpid/chat` group (all `requireAuth` + `checkEnabled`):

```js
// META·LAB integration — ensure+resolve the screening module for a Review Project
r.get('/metalab/:mlpid/workspace', S.getMetaLabWorkspace);
```

Controller `getMetaLabWorkspace(req, res)` in `screeningController.js`:

```
const out = await ensureScreenModuleForMetaLab(req.params.mlpid, req.user);
if (!out.ok && out.reason === 'project_missing') return 404 { error:'Project not found' }
if (!out.ok && out.reason === 'forbidden')       return 404 { error:'Project not found' }   // existence-hiding
return res.json({ screenProjectId: out.screenProjectId, created: !!out.created, repaired: !!out.repaired })
```

Contract:

| Field | Type | Meaning |
|---|---|---|
| `screenProjectId` | string \| null | The id the embedded SiftProject mounts on. `null` only in the rare `pending` member edge case. |
| `created` | boolean | True only when THIS call created the module (idempotent: false on every subsequent call). |
| `repaired` | boolean | True when this call performed any self-heal (owner member row, exclusion reasons). |

Properties:
- **Idempotent.** First owner call: `{created:true}`. Every later call (owner or member): `{created:false}`.
- **Owner creates / member resolves.** Enforced in the helper (Section 2).
- **Kill-switch aware.** Sits behind `checkEnabled`; returns 503 when META·SIFT is disabled — so the Screening tab degrades gracefully to "screening engine unavailable" instead of 500.
- **Existence-hiding.** Both missing-project and forbidden collapse to 404, matching the repo convention.

Frontend contract: the Screening tab calls this **once on first open**, takes `screenProjectId`, and mounts embedded SiftProject on it. No `?tab=` create flow, no link/unlink modal.

---

## 4. Project creation always creates the module

Change `projectsController.createProject()` so the **unified create path forces `createLinkedSift` on** rather than treating it as caller opt-in. Concretely:

- The unified frontend create (and the default API behavior we want going forward) always runs the `createLinkedScreenProject(...)` branch.
- Keep the existing **best-effort guarantee**: if module creation throws, the Project is still created and a `warning` is returned (the lazy `ensureScreenModuleForMetaLab` on first Screening-open will repair it). This is the existing try/catch at `createProject` L267–285 — we keep that resilience, we just stop gating it behind `createLinkedSift !== true`.
- Back-compat: the **legacy response shape** (`return res.status(201).json(saved)` when `createLinkedSift !== true`) is retained for any old API client that explicitly does not opt in, but the unified UI never takes that branch. We do not break existing callers; we change the default for the new path.

Net effect: a Review Project created through the unified UI **always** has its screening module from birth, so members can be added and the Screening tab opens with `created:false` (module already there). The lazy ensure exists purely as a repair safety net for (a) legacy projects and (b) the rare creation-time failure.

---

## 5. Backfill / repair for existing data — `scripts/backfill-screen-modules.mjs` (new)

Purpose: bring every live, non-deleted `Project` up to the "has exactly one healthy linked module" invariant **without data loss and without a destructive migration**. This is a one-shot Node script (run manually post-deploy), matching the existing `scripts/smoke-*.mjs` / `generate-version.js` pattern.

Algorithm (idempotent — safe to re-run):

```
for each Project P where deletedAt IS NULL:
  modules = ScreenProject.findMany({ linkedMetaLabProjectId: P.id, deletedAt:null })
  if modules.length === 0:
     createLinkedScreenProject({ ownerId: P.userId, title: P.name,
                                 linkedMetaLabProjectId: P.id, mlData: P.data })
     -> count.created++
  else:
     pick canonical = the module with ownerId === P.userId, else most-recent updatedAt
     ensureLeaderMember(canonical)                 // self-heal owner row
     seed exclusion reasons if none                // additive
     if modules.length > 1:
        // DO NOT delete duplicates. Report them. Operator decides.
        -> count.duplicates += (modules.length - 1)   // logged with ids for manual review
     -> count.repaired++
report { scanned, created, repaired, duplicates, ownerMismatches }
```

Non-destructive guarantees, stated plainly:
- The script **only creates and self-heals**. It never deletes a `ScreenProject`, never deletes records/decisions/members, never rewrites `ownerId`, never nulls a link.
- Duplicate modules (same `linkedMetaLabProjectId`) are **reported, not merged or deleted** — merging screening state is not safe to automate, so it is an operator decision. The resolve path already deterministically picks a winner, so duplicates do not break the UX in the meantime.
- Standalone `ScreenProject`s with `linkedMetaLabProjectId = null` are **left untouched** — they keep working via `/sift-beta` deep-links and admin. The backfill is keyed off Projects, so it never touches an unlinked standalone module.
- Re-running the script is a no-op except for any newly-created Projects (idempotent by construction: it re-checks existence each run).

Output is a summary table (scanned/created/repaired/duplicates/ownerMismatches) printed to stdout so the operator has an auditable record.

---

## 6. Ops / Admin module-health surface

Ops must be able to inspect **internal screening engine** health per Review Project, using admin/debug wording (never user-facing "linking" language). Two additions:

1. **Aggregate health in `adminController.getMetrics`** (it already loads `allProjects` and computes counts at L66+). Add a screening-module block:
   - `projectsWithModule` / `projectsMissingModule` (count of live Projects lacking a linked `ScreenProject`),
   - `duplicateModules` (Projects with >1 linked module),
   - `ownerMismatches` (defensive; expected 0).
   These are cheap: one `screenProject.groupBy({ by:['linkedMetaLabProjectId'] })` over live modules, diffed against live Project ids.

2. **Per-project drill-down** via the existing admin screening surface (`screeningAdminController.js`, mounted under `/api/admin/screening/*`): for a given Review Project return `{ screenProjectId, recordsCount, handoff:{sent,pending,failed,already_exists,accepted}, missingModule, repairAvailable }`. The handoff rollup is the same shape `getLinkable` already computes (L480–484) — reuse it. Wording in the admin UI: **"Internal screening engine"**, not "linked META·SIFT."

No new permission model: these endpoints are admin-gated by the existing `requireAdmin`/admin route guards.

---

## 7. Compatibility, migration safety, and the db-push rule

- **No schema change.** Confirmed: the soft FK `linkedMetaLabProjectId` already exists; membership/permission columns on `ScreenProjectMember` already exist (they carry both module + SIFT perms). The phase adds zero columns, zero relations, **zero `@unique`**. The db-push deploy rule (additive/nullable only, no new `@unique`) is satisfied trivially because there is nothing to push.
- **Old `/sift-beta` routes still resolve.** Standalone `ScreenProject` CRUD (`/api/screening/projects/*`) is unchanged; deep-links keep working for admin/back-compat.
- **Linking endpoints kept for admin/debug.** `POST /projects/:pid/link`, `getLinkable`, unlink — all retained server-side (the frontend just stops calling them in normal UX). They remain the operator's manual repair lever.
- **Permissions preserved.** Membership-based ML access already flows through `getMetaLabMemberAccess` / `listSharedMetaLabAccess`; nothing changes there. A member who could edit the ML project before can still edit it; a viewer is still read-only.
- **No data loss path.** Every new operation is create-or-heal. The only "destructive-looking" thing — duplicate modules — is explicitly handled by *reporting, not deleting*.
- **Kill-switch respected.** The new `/workspace` endpoint sits behind `checkEnabled`; when META·SIFT is disabled the Screening tab gets a clean 503, not a crash.

---

## 8. Files that change (precise)

| File | Change | New? |
|---|---|---|
| `server/screening/ensureWorkspace.js` | `ensureScreenModuleForMetaLab(mlProjectId,user)` + shared `resolveLinkedModule(...)`. Idempotent ensure/repair, owner-creates/member-resolves, returns `{ok,screenProjectId,created,repaired,reason?,warning?,pending?}`. | **NEW** |
| `server/routes/screening.js` | Add `r.get('/metalab/:mlpid/workspace', S.getMetaLabWorkspace)` beside the existing `/metalab/:mlpid/summary` group (behind `requireAuth`+`checkEnabled`). | edit |
| `server/controllers/screeningController.js` | Add `getMetaLabWorkspace` controller (thin wrapper over the helper, existence-hiding 404). Refactor `getMetaLabSummary` resolve half to reuse `resolveLinkedModule`. | edit |
| `server/controllers/projectsController.js` | `createProject`: unified path forces the linked-module branch on (keep legacy opt-out shape + best-effort try/catch warning). | edit |
| `server/controllers/adminController.js` | `getMetrics`: add screening-module health block (with/missing/duplicate/owner-mismatch counts). | edit |
| `server/controllers/screeningAdminController.js` | Add per-project module-health drill-down (`screenProjectId`, recordsCount, handoff rollup, missingModule, repairAvailable). Admin-gated. | edit |
| `scripts/backfill-screen-modules.mjs` | One-shot idempotent backfill/repair; create-or-heal only, reports duplicates, no deletes. | **NEW** |

Reused unchanged (load-bearing): `server/screening/createScreenProject.js` (`createLinkedScreenProject`), `server/screening/access.js` (`ensureLeaderMember`, `getProjectAccess`), `server/screening/metalabAccess.js` (membership→ML access — the reason no new permission model is needed), `screeningReviewController.finalizeRecord` (handoff), `screeningChatController` (shared chat).

---

## 9. Test hooks I will hand QA

- **Idempotency:** call `/metalab/:mlpid/workspace` twice → first `{created:true|false}`, second always `{created:false}`; same `screenProjectId`.
- **Owner creates / member resolves:** owner first-open creates; member first-open on an uninitialized project returns `pending` (never creates under the member id).
- **Repair:** delete the owner member row out-of-band → next `/workspace` call returns `{repaired:true}` and the row is back (`ensureLeaderMember`).
- **Backfill idempotency:** run `backfill-screen-modules.mjs` twice → second run `created:0`.
- **No data loss:** backfill never reduces any count of `ScreenProject` / `ScreenRecord` / `ScreenProjectMember`.
- **Kill-switch:** `metaSiftSettings.enabled=false` → `/workspace` returns 503, not 500.
- **Permissions unchanged:** a member with edit can still PUT the ML project; a viewer still 403s on edit.
