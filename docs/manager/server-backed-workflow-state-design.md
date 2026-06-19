# Server-Backed Workflow State Design (prompt38, Phase 3)

## Goal
Replace whole-project blob autosave with **per-module** server state so a save
touches only one module, carries a revision, and never clobbers unrelated data.

## Model (implemented)
A generic table backs any module whose data does not (yet) deserve its own
structured schema:

```prisma
model WorkflowModuleState {
  id            String   @id @default(uuid())
  projectId     String
  project       Project  @relation(fields:[projectId], references:[id], onDelete:Cascade)
  moduleKey     String   // whitelisted (server/services/workflowState.js)
  stateJson     String   @default("{}")
  revision      Int      @default(0)
  updatedById   String?  // bare string (no FK), matching the collab-table convention
  updatedByName String   @default("")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([projectId, moduleKey])
  @@index([projectId])
}
```
Additive, `prisma db push`-safe (new table → composite `@@unique` created cleanly).

## Structured vs generic — the decision rule
- **Domain data that is rich/queried → its own structured tables.** Already true
  for Screening and RoB; keep them. Future structured candidates: extraction
  studies (the `ReviewStudy` shadow already exists behind `relationalProjectStore`).
- **Module config / small structured state → generic `WorkflowModuleState`.** Used
  now for `protocol`; whitelisted keys also reserve `project_control`,
  `analysis_config`, `prisma`, `report`.
- **User preference → User columns** (already: theme/dashboard/shortcuts).
- **Derived → recompute** (never stored).
- **UI-only → local component state.**

## State classification applied
| Module | Class | Home |
|---|---|---|
| protocol/PICO | domain (manageable) | `WorkflowModuleState[protocol]` ✅ this phase |
| project control settings | module config | `WorkflowModuleState[project_control]` (reserved) |
| analysis config | module config | `WorkflowModuleState[analysis_config]` (reserved) |
| PRISMA counts | module config | `WorkflowModuleState[prisma]` (reserved) |
| report draft | draft | `WorkflowModuleState[report]` (reserved) |
| screening / RoB | domain (rich) | existing structured tables (unchanged) |
| extraction studies | domain (rich) | `ReviewStudy` (future, behind `relationalProjectStore`) |

## Requirements coverage
per-module (not blob) ✅ · partial/shallow patches ✅ · `revision` ✅ · `updatedBy`
✅ · `updatedAt` ✅ · conflict detection (409) ✅ · permission enforcement (project
access) ✅ · audit (row metadata + structured logs; dedicated table = follow-up) ◑
· background autosave (debounced hook) ✅ · stale-write protection (CAS) ✅ · no
cross-module clobber ✅ · cross-tab/user ✅ · survives refresh/login ✅ · ready for
future realtime (revision is the sync primitive) ✅.

## Transitional dual-write (back-compat)
While only `protocol` is migrated, other tabs still read `project.pico` from the
blob. So when the flag is ON the module is the **conflict-authority** AND the panel
mirrors edits back into `project.pico` (`onMirror`) so legacy readers stay
consistent. The blob mirror is dropped once all protocol readers migrate (a later
wave). With the flag OFF, the blob remains the sole source of truth (unchanged).
