# Project Timestamp Root-Cause Report (prompt25 Task 4)

*META·LAB internal — why opening one project made every project look
"updated/opened" at the same time, and the definitive fix. Date: 2026-06-15.*

---

## 1. The symptom

Opening any one project made **all** of the user's projects show the same
"updated" time on the dashboard. If Project 1 was opened six minutes ago,
Projects 2/3/4 also read "upd 6m ago". A reviewer who *owned* only one project
saw **only their owned project** drift — never the projects they were merely a
member/reviewer on.

## 2. Where the wrong timestamp came from — it was a BACKEND bug

The dashboard card shows `project.updatedAt` (`ProjectLanding.jsx` → `relTime(p.updatedAt)`,
labelled "upd"). `Project.updatedAt` is a Prisma **`@updatedAt`** column — Prisma
re-stamps it to "now" on **every** `update`/`upsert`, *even when the row's
content is byte-for-byte identical*.

Two facts combined to produce the bug:

1. **The autosave bridge saves the WHOLE project array.** `src/frontend/storage/serverStorage.js`'s
   `window.storage.set()` serialises every project and, in `doSave()`, issues a
   `PUT /api/projects/:id/autosave` for **every writable project** — not just the
   one that changed. (The monolith stores all projects under one `meta:projects`
   key, so any change — or an open that triggers a normalisation re-save — writes
   the whole array.)
2. **`store.js` `save()` wrote unconditionally.** The handler called
   `prisma.project.upsert({ update: { name, data } })` for each PUT regardless of
   whether `name`/`data` actually changed. Because `updatedAt` is `@updatedAt`,
   each of those no-op writes re-stamped `updatedAt = now()`.

So a single edit (or simply opening a project, which re-saves the array) ran
~N upserts and bumped `updatedAt` on **all N** of the user's writable projects to
the same instant. The dashboard then correctly displayed N identical timestamps.

## 3. Why behaviour differed for owner vs reviewer

The autosave batch **skips read-only projects** (`serverStorage.js` filters
`_readOnly`), and `save()` rejects writes to projects owned by someone else
(`FOREIGN_PROJECT` → mapped to a silent skip). A reviewer/member therefore only
ever re-saved the project(s) they **own and can write** — so only their *owned*
project's `updatedAt` got bumped, exactly as observed. This confirmed the cause
was the per-row write on save, not a shared/global timestamp variable.

## 4. The fix (definitive, backend)

`server/store.js` — both `save()` (owner path) and `saveAsMember()` (shared-edit
path) now **compare the incoming `name` + serialised `data` against the stored
row and return the existing row WITHOUT writing when nothing changed**:

```js
if (existing && existing.name === name && existing.data === dataStr) {
  return rowToProject(existing);          // no write → @updatedAt preserved
}
```

A no-op save is now truly a no-op: `updatedAt` only moves when the project's
content genuinely changes. The whole-array autosave is unaffected — the changed
project still writes, the untouched ones don't.

This is a root-cause fix (not a label change / not hiding the timestamp): the
data is now correct, so every surface that reads `updatedAt` (cards, table,
overview) is correct for free.

## 5. The timestamp model after the fix

| Concept | Meaning | Source of truth |
|---|---|---|
| `project.updatedAt` | Last real **content** change (edit), per project | Prisma `@updatedAt`, only written on a genuine content/name change (post-fix) |
| `project.createdAt` | Project creation | Prisma `@default(now())` |
| `user.lastActive` | **Global** user activity (any authed action) | `requireAuth` throttled touch (≤1 write / 5 min) — NEVER used as a project timestamp |
| "Recently opened" (per user) | The user's last-opened project(s) | Per-user, per-browser localStorage ring (`metalab.recentProjects.<userId>`), recorded on open — a *view* event, independent of `updatedAt` |

Rules enforced:
- Viewing/opening a project does **not** change `project.updatedAt` (a no-op
  save is a no-op).
- Editing content changes **only that project's** `updatedAt`.
- "Recently opened" uses the per-user open event, never `user.lastActive`.
- Owner display name is resolved live (Task 5) and never affects timestamps.

## 6. Recently-opened behaviour

The "Recently opened" rail shows **only the single most-recently-opened project**
for the current user (`.slice(0, 1)`), recorded on open. prompt25 follow-up keyed
the localStorage ring **per user** (`metalab.recentProjects.<userId>`) so two
accounts on the same browser no longer share recents.

## 7. QA

- Open Project 1 → return to dashboard → only Project 1 differs; Projects 2/3 unchanged. ✅
- Open Project 2 → only Project 2 changes. ✅
- Edit Project 2 content → only Project 2's `updatedAt` moves. ✅
- Login as a reviewer → opening a shared project bumps nothing (read/no-content-change). ✅
- Refresh / logout-login preserve the correct per-project times. ✅
- Unit guard: `server/store.js` no-op-on-unchanged covered by the timestamp behaviour above; presence/name and ops behaviour covered by `tests/unit/presence.test.js`.
