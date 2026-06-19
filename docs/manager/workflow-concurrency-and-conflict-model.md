# Workflow Concurrency & Conflict Model (prompt38, Phase 4)

## From last-write-wins → optimistic concurrency
The blob autosave replaced the whole project wholesale (last-write-wins). The new
model is **revision-based optimistic concurrency** per module, with a
**compare-and-swap** so a stale write can never silently overwrite a newer one.

## The contract
Each `WorkflowModuleState` row has `revision` (starts 0), `updatedAt`,
`updatedById`. A write is:

```
PATCH … { patch: {field: value, …}, baseRevision: <last revision the client saw> }
```
Server logic (`patchModuleState`, live-verified):
1. Read current row → `currentRev` (0 if none).
2. If `baseRevision != null && baseRevision !== currentRev` → **409 STATE_CONFLICT**
   (return `currentState` + `currentRevision`, no write).
3. Else apply a **shallow top-level merge** (`{...current, ...patch}`) so only the
   named keys change — unrelated fields are never clobbered.
4. **Compare-and-swap:** `updateMany(where: { …, revision: currentRev }, data: {
   …, revision: currentRev+1 })`. If `count !== 1` (a concurrent writer won the
   race) → refetch + **409**. First write uses `create`; a lost create race
   (unique violation) → 409.
5. On success return the new `state` + `revision`.

This closes the lost-update window even under truly concurrent writers (the CAS,
not just the base-revision check, is authoritative).

## Client behavior (`useModuleState`)
- Optimistic local update + **debounced per-field/section** PATCH (700ms) carrying
  the last known `revision` — never a whole-project blob.
- Status: `loading | idle | saving | saved | conflict | error`.
- On **409**: refetch the server's `currentState`, set `revision` to
  `currentRevision`, and surface a `conflict` object — **no silent overwrite**.
- Conflict UI (`ProtocolModulePanel`): _"This section was updated by {name} while
  you were editing. The latest saved version is shown (revision N). Re-apply your
  change if needed."_ The user dismisses, then may re-edit on top of the fresh base.

## Field-level collaboration
PICO P/I/C/O already have ephemeral **presence field-locks** (acquire/release via
the screening presence system) when a workspace is linked. Locks prevent two
people grabbing the same field; the `revision` CAS is the backstop against any
unexpected stale write regardless of locks. The phase-1 server-backed panel does
not yet wire the per-field locks (legacy editor keeps them) — sequenced for a later
wave; the revision conflict model protects correctness in the meantime.

## Audit
- **Implemented:** each row records `updatedById`/`updatedByName`/`revision`/
  `updatedAt` (who last changed each module + how many revisions); the server logs
  structured `PROTOCOL_UPDATED` (per `MODULE_AUDIT_ACTION`) and
  `WORKFLOW_STATE_CONFLICT` lines.
- **Follow-up (Wave):** a dedicated `WorkflowStateAudit` history table for the full
  event list (`PROTOCOL_UPDATED`, `…_UPDATED`, `WORKFLOW_STATE_CONFLICT`, migration
  events). Not in phase 1 to keep the schema change minimal; the row metadata + logs
  cover the essential trail.
