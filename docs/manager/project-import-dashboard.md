# Project Import from Dashboard (prompt25 Task 8)

*META·LAB internal — v3.6.3 → 3.7.0. Date: 2026-06-15.*

---

## Overview

Users can now import previously exported META·LAB projects directly from the
project dashboard, without navigating away or using a separate tool. The feature
is clearly distinct from the Screening workspace's "Import References" function,
which imports citation files into a screening project.

---

## Entry point

`src/frontend/pages/ProjectLanding.jsx` — a **"Import Project"** ghost button
with an upload icon sits immediately to the right of the existing "New Project"
button in the dashboard header. Clicking it triggers a hidden `<input type="file"
accept=".json">` element.

---

## Supported file shapes

The client-side parser accepts four JSON structures produced by existing META·LAB
export flows:

| Shape | Detected by | Description |
|---|---|---|
| `{ projects: [...] }` | Top-level `projects` array | Full multi-project backup (`metalab-backup`) |
| `{ project: {...} }` | Top-level `project` object | Single-project export (`metalab-project`) |
| `[...]` | Bare JSON array | Array of project objects |
| `{ id, name, ... }` | Bare object with `id` and `name` | Single bare project object |

If the file does not match any shape, an inline error banner is shown and no
projects are created.

---

## ID assignment and name collision handling

- **Fresh IDs are always assigned.** The parser generates a new `id` for every
  imported project using `crypto.randomUUID()` (or a timestamp-based fallback).
  An imported file's original IDs are never written to the DB, preventing
  collisions with existing projects.
- **Name collisions** — if an imported project name already exists among the
  user's projects, the imported copy is renamed `"<original name> (imported)"`.
  The collision check runs client-side against the current project list before
  any write.

---

## Backend interaction

No new backend endpoint was created. Each imported project is written via
**`PUT /api/projects/:id/autosave`**, the existing upsert endpoint used by the
live autosave bridge. The endpoint creates a new row if the ID does not exist,
which is always the case (fresh IDs). Behaviour is identical to a user creating
a project and immediately auto-saving its full state.

`api.projects.autosave(id, body)` was added to `src/frontend/api/apiClient.js`
as a thin wrapper around this endpoint.

---

## Post-import behaviour

| Condition | Behaviour |
|---|---|
| Single project imported | Dashboard reloads; imported project opens automatically |
| Multiple projects imported | Dashboard reloads; success banner shown with count |
| Parse error (invalid JSON / unknown shape) | Inline error banner; no projects created |
| Network error on one or more PUTs | Error banner; partial import is possible (see limitations) |

---

## Per-user recents isolation

As part of this task, the "Recently opened" localStorage key was namespaced **per
user**: `metalab.recentProjects.<userId>`. Previously the key was global, meaning
two accounts on the same browser shared the same recents ring. This is now fixed.
The dashboard rail still displays only the single most-recently-opened project
(`.slice(0, 1)`) per the v3.6.0 dashboard cleanup.

---

## What this is NOT

- It does **not** import citation/reference files (`.ris`, `.bib`, `.csv`). That
  function lives in the Screening workspace's **Import References** tab
  (`ScreeningTab` → Import sub-tab).
- It does **not** replace or merge into existing projects. Every import creates a
  new row with a fresh ID.
- It does **not** stream large files. The entire JSON file is read into memory by
  `FileReader` before parsing (see limitations).

---

## Files changed

| File | Change |
|---|---|
| `src/frontend/pages/ProjectLanding.jsx` | "Import Project" button + hidden file input + parser + collision logic |
| `src/frontend/api/apiClient.js` | `api.projects.autosave(id, body)` added |

No backend files changed. No DB schema changes. No new npm dependencies.

---

## Known limitations

1. **No import preview or confirm modal.** Projects are written immediately after
   parsing. If the user selects the wrong file, they must manually delete the
   imported projects. A future preview/confirm step with schema validation is
   recommended (see final report).
2. **No atomic rollback on partial failure.** If a multi-project import fails
   mid-way (e.g. network drop after the third PUT), the projects already written
   remain. An error banner is shown, but no automatic cleanup is performed.
3. **Client-side parsing only; no streaming.** Very large backup files (tens of MB)
   are read entirely into memory before parsing. This may cause the browser tab to
   be unresponsive briefly on low-end devices.
4. **No schema validation beyond shape detection.** Deeply malformed project data
   (valid JSON shape but corrupt field values) is passed to the server as-is. The
   autosave endpoint stores whatever it receives; the project may appear corrupt on
   open.

---

## QA results

| Scenario | Expected | Result |
|---|---|---|
| Import `metalab-backup` with 3 projects | 3 new projects created; success banner | ✅ |
| Import `metalab-project` (single) | 1 new project; opens automatically | ✅ |
| Import bare array | Projects created correctly | ✅ |
| Import bare object | Project created correctly | ✅ |
| Name collision with existing project | Renamed `"… (imported)"` | ✅ |
| Invalid JSON file | Error banner; no project created | ✅ |
| Two accounts on same browser | Each account's recents are independent | ✅ |
| Imported project ID | Never matches an existing project ID | ✅ |
