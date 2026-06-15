# Phase 6 — Migration / Compatibility Plan

[FROM: QA, Security & Regression Engineer (with Backend)]
[TO: Team]
[TOPIC: Phase 6 migration / compatibility — backfill the internal screening module, keep standalone SIFT reachable, zero schema change]
[MESSAGE: Additive-only. Backfill creates a linked ScreenProject for every live Project that lacks one (idempotent, owner-scoped). Standalone ScreenProjects (no `linkedMetaLabProjectId`) are KEPT as admin/deep-link screening-only workspaces — we do NOT fabricate META·LAB projects for them. No `prisma db push` change required.]
[FILES I OWN: `scripts/backfill-screen-modules.mjs` (new), `server/screening/ensureScreenModule.js` (new helper — shared with Backend), migration integration tests `tests/integration/api-unified-workspace.test.js` (new) + `tests/screening/integration/prompt18-migration.test.js` (new). This doc: `docs/manager/unified-workflow-migration-plan.md`.]
[WHAT I NEED FROM YOU: Backend — land `ensureScreenModuleForMetaLab()` and `GET /api/screening/metalab/:mlpid/workspace` exactly per §4 so the backfill script and the lazy first-open repair share one code path. Frontend — call the workspace endpoint on first Screening-tab open; never call the legacy `/projects/:pid/link` flow from normal UX. Lead — confirm the version bump (MINOR is correct: additive product overhaul, no destructive migration).]

---

## 0. Scope and ground truth

This plan covers ONLY data migration / backwards-compatibility for prompt18 (unify META·LAB + META·SIFT into one "Review Project" with Screening as a single stage). It does not redesign the UX (Frontend owns that) or the runtime ensure/endpoint internals (Backend owns those) — it specifies the **data-state guarantees**, the **idempotent repair command**, the **standalone-SIFT decision**, and the **migration tests**.

Verified against the live code (graphify + source read):

| Fact | Evidence |
|---|---|
| The link is a **soft FK**: `ScreenProject.linkedMetaLabProjectId String?`, indexed with `@@index`, **never `@unique`**. | `server/prisma/schema.prisma` L204, L234 |
| Both sides soft-delete: `Project.deletedAt` (L61) and `ScreenProject.deletedAt` (L219). | `server/prisma/schema.prisma` |
| The seeding helper already exists and is correct: `createLinkedScreenProject({ ownerId, title, linkedMetaLabProjectId, mlData, members })` — seeds PICO snapshot, default keywords, 7 exclusion reasons, `ensureLeaderMember`. | `server/screening/createScreenProject.js` L41–99 |
| Project creation already opt-in creates the pair: `POST /api/projects {createLinkedSift:true}` → `createLinkedScreenProject`; failure is **non-fatal** (returns project + `warning`, link `null`). | `server/controllers/projectsController.js` L255–293 |
| Member ML access already flows through the link (no relink action needed): `getMetaLabMemberAccess` / `listSharedMetaLabAccess`. | `server/screening/metalabAccess.js` L36–109 |
| Both helpers already exclude soft-deleted workspaces (`deletedAt: null`) and enforce owner-equality (the linked Project must be owned by the workspace owner). | `metalabAccess.js` L40, L60–64, L87, L96 |
| The legacy manual link/unlink endpoint still exists: `POST /api/screening/projects/:pid/link` → `linkMetaLab` (link requires the target Project be owned by the workspace owner; empty body unlinks). | `screeningController.js` L494–538; route `server/routes/screening.js` L57 |
| Handoff already appends to `Project.data.studies[]` (idempotent by DOI/PMID/title) on accept. | `finalizeRecord`/`handoffToMetaLab`, `server/controllers/screeningReviewController.js` |

**Bottom line: the data model needs NOTHING new. The migration is pure repair — manufacture the missing rows that the unified UX now assumes always exist.**

---

## 1. Migration principles (hard constraints)

1. **Never delete.** No `DELETE`, no `deleteMany`, no soft-delete writes (`deletedAt`) in any migration path. The backfill is **create-only** plus PICO-snapshot **refresh** on existing rows (write to `picoSnapshot` is the single allowed update, and only when stale/empty).
2. **Never reset the DB.** No `prisma migrate reset`, no `db push --force-reset`, no dropping tables. Deploy path stays `prisma db push` (the VPS path) which the schema is already written to keep safe (see the schema's own comments at L36, L397).
3. **Additive / nullable only — and here, literally zero schema change.** prompt18 needs no new column, no new model, no relation, no `@unique`. So `prisma db push` is trivially additive-safe: there is nothing to push. We assert this in a test (§7, T-SCHEMA).
4. **Idempotent.** Running the backfill twice, or running it while users are live, must converge to the same state and never create duplicates. Idempotency key = "a live `ScreenProject` whose `linkedMetaLabProjectId == project.id` and `deletedAt == null` already exists."
5. **Owner-scoped.** A repaired module's `ownerId` is **always** `Project.userId`. We never create a module owned by anyone other than the META·LAB project owner. This preserves the security invariant that `metalabAccess.js` relies on (linked Project's `userId === ScreenProject.ownerId`).
6. **Preserve everyone and everything.** Owners, leaders, members, permission flags, screening decisions, extracted data, chat, audit are **untouched** for any project that already has a module. New modules are seeded with exactly one owner member (the existing seeding behaviour) and inherit nothing they shouldn't.

---

## 2. The two populations and what happens to each

### 2.1 Existing META·LAB `Project` rows (the thing we repair)

For every **live** `Project` (`deletedAt == null`, including archived — archived projects still need a module so they open correctly if unarchived):

- **If a live linked module already exists** → no-op. (Counts as `skipped`.) Refresh `picoSnapshot` only if it is empty/`'{}'` and the project now has PICO data, so the Screening stage shows the right criteria; this is the only mutation on the existing-module path and it is itself idempotent.
- **If no live linked module exists** → create one via the shared ensure helper (§4), `ownerId = project.userId`, `title = project.name`, `mlData = project.data` for the PICO snapshot. (Counts as `created`.)
- **If only a *soft-deleted* module exists** (owner deleted it earlier) → treat as missing and **create a fresh live one** (counts as `created`/`repaired`). We do NOT resurrect the soft-deleted row: resurrecting could re-expose members the owner intentionally removed when they deleted the workspace. A fresh module with just the owner is the safe, least-surprising state. The soft-deleted row stays for audit history.

Archived projects (`Project.archived == true`) are included — they are still live data. We just ensure the module; we do not change archive state.

### 2.2 Existing standalone META·SIFT `ScreenProject` rows (the decision)

A **standalone** ScreenProject is one with `linkedMetaLabProjectId == null` (a real, supported state today: created directly in /sift-beta, or unlinked via `linkMetaLab` with an empty body).

**DECISION: KEEP them as screening-only workspaces, reachable via admin + deep-link. Do NOT auto-fabricate a META·LAB `Project` for them.**

Rationale (honest):

1. **A fabricated Project would be a hollow shell with no methodology.** META·LAB is the SR backbone — PICO, protocol, search strategy, risk of bias, meta-analysis, GRADE, manuscript. A standalone SIFT project has none of that. Auto-creating a Project would litter every owner's `/app` list with empty "Review Projects" they never asked for, each demanding a PICO and protocol they may never fill. That is worse UX than leaving the screening project where it is.
2. **Direction of truth.** In the unified model the `Project` is the user-facing identity and the `ScreenProject` is its internal engine. Fabricating a parent for an orphan engine inverts the ownership story and creates a Project whose `name`/PICO are guesses. The clean rule is: **Projects own modules; modules do not spawn Projects.**
3. **No data is stranded.** Standalone ScreenProjects keep working exactly as today: their owner/members, decisions, duplicates, conflicts, chat, audit, and export are all intact and still served by `/api/screening/projects/:pid/...`. They are simply not surfaced in the new unified `/app` Screening tab (which resolves *from a Project*). They remain reachable through:
   - **Admin/ops console** (Phase: internal screening engine inspector) — staff can list and open any ScreenProject.
   - **Deep-links** — the existing `/sift-beta/projects/:pid` route is kept for back-compat (hidden from normal nav, not deleted), so any bookmark/old link still resolves.
4. **It is reversible and user-driven.** The owner of a standalone project can still attach it to a real Review Project using the **existing** `linkMetaLab` endpoint (the only place manual linking survives, now admin/power-user only). Once linked, it appears in that Project's Screening tab. We are not removing the capability — only removing it from the everyday happy path.

**Optional future path (documented, NOT built in prompt18):** offer an explicit, opt-in "Promote to Review Project" action for a standalone screening project that creates a Project seeded from the ScreenProject's `picoSnapshot` + title and links it. This stays a deliberate user action with a confirmation, never an automatic backfill. Left out of prompt18 because (a) it is net-new UX, not migration, and (b) auto-running it would violate principle #1's spirit (manufacturing user-facing entities nobody requested).

### 2.3 The "multiple modules for one Project" edge (no `@unique`)

Because `linkedMetaLabProjectId` is not unique, a Project could (rarely, via old manual linking) have **two** live linked ScreenProjects. The backfill and the ensure helper must be deterministic here:

- Resolution rule: **pick the oldest live linked module** (`orderBy createdAt asc, take 1`) as the canonical one. Never create a third.
- The backfill does **not** merge or delete the duplicate — that would be destructive and out of scope. It logs a `duplicate-module` warning into the report (§5) for ops to review. The ensure helper (§4) returns the canonical one consistently so the UX is stable.

---

## 3. What is explicitly preserved (the no-loss contract)

| Asset | Where it lives | Migration effect |
|---|---|---|
| META·LAB project data (PICO, protocol, studies, search, analysis) | `Project.data` JSON blob | **Untouched.** Backfill never writes `Project`. |
| Project ownership / archive state | `Project.userId`, `Project.archived/archivedAt/deletedAt` | **Untouched.** |
| Screening decisions, records, duplicate groups, conflicts, import batches | `ScreenRecord` / `Decision` / `DuplicateGroup` / `Conflict` / `ImportBatch` | **Untouched** for existing modules. New modules start empty (correct). |
| Members + module permissions (canViewMetaLab/canEditMetaLab/canManageExtraction/canRunAnalysis/canExport + SIFT perms) | `ScreenProjectMember` | **Untouched** for existing modules. New modules seed exactly one owner member. Shared ML access keeps flowing via `metalabAccess.js`. |
| Shared chat thread | `ScreenChatMessage` (resolved via `linkedMetaLabProjectId`) | **Untouched.** Newly-created modules simply start with an empty thread. |
| Audit trail | `ScreenAudit` | **Untouched.** Backfill writes an additive `MODULE_BACKFILLED` audit row per created module (history, not mutation). |
| Standalone screening projects | `ScreenProject` with `linkedMetaLabProjectId == null` | **Kept and reachable** (admin + deep-link). Never deleted, never auto-promoted. |

---

## 4. Idempotent repair: the shared `ensure` helper + endpoint (design)

Backend owns the implementation; this section is the **contract** the backfill script and the lazy first-open both depend on, so there is exactly one repair code path.

### 4.1 Helper — `server/screening/ensureScreenModuleForMetaLab(mlProjectId, user)`

```
ensureScreenModuleForMetaLab(mlProjectId, user) -> { screenProjectId, created, repaired }
```

Behaviour (pseudo, all reads/writes via `prisma`):

1. Load the Project unscoped-but-live: `prisma.project.findFirst({ where: { id: mlProjectId, deletedAt: null }, select: { id, name, userId, data } })`. If missing → throw `NOT_FOUND` (caller maps to 404).
2. Authorize: the caller must be the owner (`project.userId === user.id`) OR a member with `canView` via `getMetaLabMemberAccess` OR staff. (Members may *trigger* a repair when they open Screening; the created module is still **owner-scoped** — `ownerId = project.userId`, never the member.)
3. Find the canonical live module: `findFirst({ where: { linkedMetaLabProjectId: mlProjectId, deletedAt: null }, orderBy: { createdAt: 'asc' } })`.
   - **Found** → `created=false`. If its `picoSnapshot` is empty/`'{}'` and the project now has PICO, refresh it (`repaired=true`); else `repaired=false`. Return its id.
   - **Not found** → call `createLinkedScreenProject({ ownerId: project.userId, title: project.name, linkedMetaLabProjectId: project.id, mlData: project.data })`, write a `MODULE_BACKFILLED` audit row, return `{ screenProjectId, created:true, repaired:false }`.
4. **Concurrency:** wrap create in a guard against the create→create race (two simultaneous first-opens). Since there is no `@unique`, the guard is a re-check-after-create: if a second live module appears, keep the oldest and leave the extra for the §2.3 duplicate report (never throw to the user). A short serialized section (or `findFirst` retry-on-race) is acceptable; the user-visible contract is "always returns one stable id, never errors on a normal repair."

This helper must be **side-effect-free on success-with-existing-module** except the optional PICO refresh — so calling it on every Screening open is cheap and safe.

### 4.2 Endpoint — `GET /api/screening/metalab/:mlpid/workspace`

- Auth: `requireAuth`; honours the META·SIFT kill-switch (`metaSiftSettings.enabled=false` → 503, same as the rest of `/api/screening`).
- Calls `ensureScreenModuleForMetaLab(req.params.mlpid, req.user)`.
- 200 → `{ screenProjectId, created, repaired }`. 404 when the Project is gone or the caller has no access (existence-hiding, same convention as `getProject`). 503 when META·SIFT disabled.
- Frontend calls this on first open of the Screening tab; the returned `screenProjectId` is what the embedded SiftProject loads. **No client ever calls `/projects/:pid/link` in normal UX.**

### 4.3 Forced-on create path

The unified create path sends `createLinkedSift:true` **always** (Frontend removes the checkbox). The existing non-fatal failure handling stays (project still created with a `warning`); the lazy first-open ensure then repairs it on the user's next Screening visit. This is the belt-and-suspenders: even if create-time module seeding fails, opening Screening fixes it.

---

## 5. The backfill command (one-time + safe to re-run)

**File:** `scripts/backfill-screen-modules.mjs` (ESM `.mjs`, run via `node scripts/backfill-screen-modules.mjs`).

It imports the same `ensureScreenModuleForMetaLab` helper (§4) so the backfill and the runtime repair are byte-for-byte the same logic — no second implementation to drift.

### 5.1 Algorithm

```
1. Connect prisma.
2. Page through ALL live Projects (deletedAt: null), ordered by createdAt,
   in batches of N (e.g. 200) to stay memory-flat on a large DB.
3. For each project, synthesize a "system" user = { id: project.userId, staff:true }
   and call ensureScreenModuleForMetaLab(project.id, systemUser).
   (Owner-scoped by construction.)
4. Tally { scanned, created, skipped, picoRefreshed, duplicatesFound, errors[] }.
5. Print a JSON report to stdout and exit 0 on success.
   Per-project errors are caught and recorded — one bad project never aborts the run.
6. Separately, scan standalone ScreenProjects (linkedMetaLabProjectId:null, deletedAt:null)
   and COUNT/log them only (no mutation) so ops sees the surviving screening-only population.
```

### 5.2 Flags (defensive, ops-friendly)

| Flag | Effect |
|---|---|
| `--dry-run` | Compute and print the report but perform **no writes**. Default-recommended first run. |
| `--limit=N` | Process only the first N live projects (smoke a small batch in prod before full run). |
| `--owner=<userId>` | Restrict to one owner's projects (targeted repair / support ticket). |
| `--verbose` | Per-project log lines (id, decision: created/skipped/refreshed/duplicate). |

### 5.3 Operational safety

- **Idempotent:** re-running after a partial/interrupted run only creates what's still missing; everything already linked is `skipped`.
- **Online-safe:** can run while the app is live — `ensure` is the same concurrency-guarded path used by first-open, so a user opening Screening mid-backfill races safely (oldest module wins).
- **No transaction-wrapping the whole run** (a multi-thousand-row single transaction would lock SQLite). Each project's ensure is its own small unit; the report captures partial progress.
- **Backup note in the runbook:** even though the script is create-only, ops takes a file copy of the SQLite DB before the first prod run (cheap insurance; documented, not enforced by the script).

### 5.4 Expected report shape (for ops + tests)

```json
{
  "scanned": 412,
  "created": 37,
  "skipped": 372,
  "picoRefreshed": 3,
  "duplicatesFound": 0,
  "standaloneScreenProjects": 5,
  "errors": []
}
```

---

## 6. Compatibility / back-compat matrix

| Surface | Pre-prompt18 behaviour | Post-migration behaviour | Compat verdict |
|---|---|---|---|
| `POST /api/projects {createLinkedSift:true}` | creates pair | unchanged (now the only create path; checkbox gone client-side) | ✅ same contract |
| `POST /api/projects` (no flag) | legacy bare project | still returns bare shape (kept for old clients / direct API) | ✅ kept |
| `GET /api/screening/metalab/:mlpid/summary` | PRISMA rollup | unchanged | ✅ |
| `GET /api/screening/metalab/:mlpid/chat` | shared chat | unchanged | ✅ |
| `POST /api/screening/projects/:pid/link` | manual link/unlink | **kept** (admin/power-user only; not used by normal UX) | ✅ kept, de-emphasized |
| `/sift-beta` dashboard, `/sift-beta/projects/:pid` | normal nav | **hidden** from normal nav, route kept for deep-link + admin/debug | ✅ kept, hidden |
| Member ML access via link | `metalabAccess.js` | unchanged — new modules don't change this | ✅ |
| Standalone ScreenProject | reachable in /sift-beta | reachable via admin + deep-link (screening-only) | ✅ kept |
| `prisma db push` deploy | additive-safe | **no schema delta at all** for prompt18 | ✅ trivially safe |
| META·SIFT kill-switch (`enabled=false`) | `/api/screening` → 503 | `/workspace` endpoint also 503; backfill is offline anyway | ✅ honoured |

---

## 7. Migration tests to add (specifications)

Two new files. Integration tests follow the existing live-API harness (base `http://127.0.0.1:3001/api`, cookie auth, self-skip when the server is down, `127.0.0.1` never `localhost`, `until()` polling for fire-and-forget writes) — copy the harness from `tests/screening/integration/prompt6.test.js` L24–55. Run unit-style assertions via the standard runner; run integration via PowerShell `--pool=forks --poolOptions.forks.singleFork=true` (the Bash-tool vitest-worker crash gotcha).

### 7.1 `tests/integration/api-unified-workspace.test.js` — ensure/endpoint contract

| ID | Test | Assert |
|---|---|---|
| T-WS-1 | Owner creates a project WITHOUT a module (legacy bare `POST /api/projects`), then `GET /metalab/:id/workspace`. | 200, `{ screenProjectId, created:true, repaired:false }`. |
| T-WS-2 | Call `/workspace` **again** for the same project. | 200, `created:false` (idempotent — no second module). Verify via summary/admin that exactly one live module exists. |
| T-WS-3 | Create project WITH `createLinkedSift:true`, then call `/workspace`. | 200, `created:false` (the create-path module is reused, not duplicated). |
| T-WS-4 | Two concurrent `/workspace` calls for a module-less project (Promise.all). | Both 200, **same** `screenProjectId`; only one live module exists afterwards (race-safe). |
| T-WS-5 | A workspace **member** (canView, not owner) opens `/workspace` for the owner's module-less project. | 200; the created module's `ownerId` is the **Project owner**, not the member (assert via admin inspect). |
| T-WS-6 | A non-member stranger calls `/workspace`. | 404 (existence-hiding). |
| T-WS-7 | Soft-deleted Project. | 404. |
| T-WS-8 | META·SIFT kill-switch off (`metaSiftSettings.enabled=false`). | 503. (Restore after.) |
| T-WS-9 | PICO refresh: project gets PICO set after a module with empty `picoSnapshot` exists; `/workspace`. | `repaired:true` once, then `repaired:false` on the next call (idempotent refresh). |

### 7.2 `tests/screening/integration/prompt18-migration.test.js` — backfill behaviour

These exercise the backfill **logic** through the shared ensure helper against seeded fixtures (the script and the helper are the same path), plus a direct script invocation smoke.

| ID | Test | Assert |
|---|---|---|
| T-BF-1 | Seed 3 projects: one already linked, one bare, one with only a soft-deleted module. Run backfill (dry-run). | Report: `scanned:3, created:2, skipped:1`; **no writes** (DB unchanged). |
| T-BF-2 | Run backfill for real, then again. | First: `created:2`. Second: `created:0, skipped:3` (idempotent convergence). |
| T-BF-3 | Backfill the soft-deleted-only project. | A **fresh live** module is created; the soft-deleted row is **still present** (not resurrected, not deleted). |
| T-BF-4 | After backfill, the previously-bare project's owner opens Screening; a member with `canViewMetaLab` lists projects. | Owner sees the module; member's shared ML access (`listSharedMetaLabAccess`) is unaffected and still resolves. |
| T-BF-5 | Standalone ScreenProject (`linkedMetaLabProjectId:null`) present during backfill. | It is **counted** in `standaloneScreenProjects`, **not mutated**, **no Project fabricated**, still reachable via `/api/screening/projects/:pid`. |
| T-BF-6 | Duplicate live modules for one project (seed two). | Backfill creates **no** third module; report flags `duplicatesFound>=1`; ensure helper returns the **oldest** consistently. |
| T-BF-7 | Owner/members/decisions/chat/audit preservation. | For the already-linked project, member rows + any seeded decisions + chat + audit counts are **identical** before and after backfill. |
| T-BF-8 | `--owner=<id>` and `--limit=N` flags. | Only the targeted/limited subset is processed; others remain `scanned:0`/untouched. |

### 7.3 Regression / safety tests (extend existing suites or add)

| ID | Test | Assert |
|---|---|---|
| T-SCHEMA | Schema drift guard: `prisma db push --skip-generate` (or a diff check) on the prompt18 schema against the prior schema. | **No schema delta** — confirms prompt18 introduces zero column/model/relation/`@unique` change, so the deploy stays additive-safe. (Can be a CI assertion or a documented manual gate.) |
| T-REG-1 | Existing `prompt6.test.js` T2 (linked-create pair shape) and T3/8 (member sees linked project) still pass unchanged. | Green — proves the unification didn't break the existing link contract. |
| T-REG-2 | Existing `metalabAccess` member-access tests (prompt5) still pass. | Green — shared ML access untouched. |
| T-REG-3 | Standalone deep-link still resolves: `GET /api/screening/projects/:pid` for a standalone project by its owner. | 200 with full project (back-compat for /sift-beta deep-links). |
| T-SEC-1 | No internals leak in normal UX: the unified `getProject`/`listProjects` responses do not expose `screenProjectId` to non-staff in a way that implies a separate app (Frontend shows "Screening", not a link). Assert response shape stays the existing annotated shape. | Annotated shape unchanged; no new cross-app linking fields surfaced to normal users. |
| T-SEC-2 | A member who can view but not edit ML still cannot edit via the repaired module path; repaired module never grants the member ownership. | Edit blocked per `mlAccessFromMember`; module `ownerId` == Project owner. |

---

## 8. Runbook (deploy order)

1. **Deploy code** (ensure helper + `/workspace` endpoint + frontend unified UX + hidden /sift-beta nav). No schema push needed; if the deploy pipeline runs `prisma db push`, it is a no-op for prompt18.
2. **Snapshot the SQLite DB file** (ops insurance; create-only script doesn't require it but we take it anyway).
3. **Dry-run the backfill in prod:** `node scripts/backfill-screen-modules.mjs --dry-run`. Review the report (expected `created` ≈ count of pre-link projects; `errors:[]`; note `standaloneScreenProjects`).
4. **Smoke a small batch:** `node scripts/backfill-screen-modules.mjs --limit=10`, spot-check 2–3 projects' Screening tabs.
5. **Full run:** `node scripts/backfill-screen-modules.mjs`. Confirm `errors:[]`. Re-run once to confirm `created:0` (idempotency in prod).
6. **Verify** a couple of previously-bare projects open Screening cleanly; verify a standalone screening project is still reachable via admin/deep-link.
7. **Leave the script in place** — it stays the supported repair tool (e.g. after any future bulk import that creates Projects without modules).

---

## 9. Honest risks / open items

- **Duplicate-module projects (no `@unique`)** are handled non-destructively (oldest wins, logged) but NOT auto-merged. If ops wants merge/cleanup, that is a separate, explicitly-confirmed admin action — out of prompt18 scope by the never-delete principle.
- **Lazy-repair latency:** if the backfill is skipped, the very first Screening open does the create inline (one extra round-trip). Acceptable, but the backfill should be run so the common case is `created:false`.
- **Standalone-SIFT discoverability:** owners of pre-existing standalone screening projects lose them from everyday nav (admin/deep-link only). This is the deliberate cost of unification; the optional future "Promote to Review Project" action (§2.2) is the escape hatch if user feedback demands it. We are not building it now, and we should not auto-fabricate to avoid the discomfort — that would be worse.
- **Kill-switch interaction:** with META·SIFT disabled, the Screening tab and `/workspace` return 503; the unified Project still works for every other stage. Frontend must degrade the Screening tab gracefully (Backend/Frontend coordination, noted here for completeness).

---

*No schema change. No deletion. No reset. Additive repair only. Standalone screening projects preserved and reachable; never auto-promoted.*
