# Owner can delete a project from Project Control (prompt32 Task 10)

## Current state (before)
- Owner-confirmed delete already existed but only on the dashboard card menu (`ProjectLanding` DeleteModal → `api.projects.confirmDelete`). The backend `ownerDeleteProject` (`POST /api/projects/:id/delete`, body `{ confirmName, cascadeLinked }`) is owner-scoped, typed-name confirmed, writes an audit row, and (with `cascadeLinked`) soft-deletes the caller's linked screening workspaces (and thus their RoB assessments via FK cascade).
- The main-workflow "Project Control" is the monolith's `ControlTab` (`meta-lab-3-patched.jsx`). It had no delete affordance.

## Decision
Surface an **owner-only Danger Zone** inside `ControlTab` reusing the existing soft-delete (reversible by ops, audit-preserving, cascades correctly). No new delete semantics; no hard delete. Archive/Unarchive added alongside delete (reversible hide).

## Implementation (`meta-lab-3-patched.jsx`)
- Imported the `api` client.
- `ControlTab` gains an `onDeleted` prop and owner-only Danger Zone (gated on `amProjectOwner = !project._shared`):
  - **Archive / Unarchive** → `api.projects.archive/unarchive` + local `_archived` annotation.
  - **Delete project** → a type-the-project-name confirmation; on exact match calls `api.projects.confirmDelete(project.id, { confirmName, cascadeLinked: true })`, then `onDeleted(id)`.
- `MetaLab` wires `onDeleted` to remove the project from local state and navigate back to the dashboard (`onBackToProjects()`), which reloads fresh (soft-deleted rows excluded).
- The consequences list explicitly names Data Extraction studies, linked Screening records, and Risk-of-Bias assessments.

## Permissions
Owner only — UI gated on `amProjectOwner`; the backend independently enforces owner-scope (`where: { id, userId }`), so a non-owner cannot delete even by calling the API directly. Leaders/Reviewers/Viewers never see the Danger Zone.

## Test results
- Backend owner-scope + typed-name confirmation already covered by `tests/screening/integration/prompt9.test.js` (`ownerDeleteProject`).
- Build green; the Danger Zone renders only for the owner.

## Risks / limitations
- Soft delete (not hard delete) — recoverable by an admin from Ops; this is intentional for audit/compliance. The confirmation copy says "cannot be undone from here" (true for the user; ops can still restore).
- After delete the monolith navigates to the dashboard; the deleted project is gone on reload.
