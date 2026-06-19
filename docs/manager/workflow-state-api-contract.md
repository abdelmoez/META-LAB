# Workflow-State API Contract (prompt38, Phase 6)

Mounted at `/api/workspaces` (requireAuth at the mount). `:projectId` is the
META·LAB **Project** id (the "review workspace"). Every handler additionally gates
on the `serverBackedWorkflowState` feature flag (default OFF → **404**) and the
caller's project access (owner, or linked-workspace member). Module keys are
**whitelisted**: `protocol`, `project_control`, `analysis_config`, `prisma`,
`report` (unknown → 400).

## GET `/api/workspaces/:projectId/state`
Module summaries + revisions.
```json
{ "projectId":"…", "modules": { "protocol": { "revision": 2,
  "updatedAt":"…", "updatedBy": { "id":"…", "name":"" } } } }
```

## GET `/api/workspaces/:projectId/modules/:moduleKey/state`
One module's full state (empty default when never written).
```json
{ "moduleKey":"protocol", "state": { "P":"adults", "O":"death" },
  "revision":2, "updatedAt":"…", "updatedBy": { "id":"…", "name":"" } }
```

## PATCH `/api/workspaces/:projectId/modules/:moduleKey/state`
Requires `canEdit` (viewer → **403**). Body:
```json
{ "patch": { "P": "adults" }, "baseRevision": 1 }
```
**200** — applied (shallow merge, revision incremented):
```json
{ "state": { "P":"adults", "O":"death" }, "revision":2,
  "updatedAt":"…", "updatedBy": { "id":"…","name":"" } }
```
**409** — stale `baseRevision` (or lost CAS race); **no overwrite**:
```json
{ "error":"STATE_CONFLICT", "currentState": { … },
  "currentRevision":2, "updatedBy": {…}, "updatedAt":"…" }
```
**400** — `patch` not an object / non-integer `baseRevision` / unknown module.
**403** — read-only access. **404** — flag off OR no access (existence hidden).

## Status codes (live-verified)
| Case | Code |
|---|---|
| flag OFF | 404 |
| unauthenticated | 401 |
| non-member | 404 |
| read-only member PATCH | 403 |
| unknown moduleKey | 400 |
| fresh patch | 200, revision+1 |
| stale patch | 409 STATE_CONFLICT |

## Domain-specific APIs (unchanged)
Screening (`/api/screening/*`) and RoB (`/api/rob/*`) keep their structured
endpoints — this generic contract is for modules that don't (yet) warrant their
own schema. The intent is to **stop whole-project blob saves** for migrated
modules, not to force structured domains into generic JSON.
