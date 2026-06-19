# Legacy → Server Migration Plan (prompt38, Phase 5)

## Reframing (important)
The audit (`localstorage-audit.md`) found **no canonical workflow data in
localStorage** — it is in the server `Project.data` blob. So "localStorage
migration" in this app means: **migrate a module's slice OUT of the whole-project
blob INTO its per-module server state**, transparently, without data loss.

## Per-module migration (implemented for `protocol`)
On opening a project with the flag ON, `useProtocolState`:
1. **GET** the `protocol` module state from the server.
2. If `revision === 0` (module never written) AND the legacy blob carries protocol
   content (`!isBlankProtocol(pickProtocol(project))`), **seed** the module from
   the blob via a first PATCH → revision 1. This is the migration.
3. Thereafter the module is canonical; edits PATCH the module (revision-tracked).
4. The blob is kept as a **back-compat mirror** (`onMirror`) so not-yet-migrated
   readers stay consistent; it is never the conflict-authority while the flag is ON.

### Safety properties
- **Never overwrites newer server data:** seeding only happens when the module is
  at revision 0 (empty). If the module already has content, no seed occurs.
- **No data loss:** the blob is untouched as a source until the module is seeded,
  and remains a synced mirror after; with the flag OFF the blob is unchanged.
- **Idempotent:** a `seededRef` guard + the `revision !== 0` check make repeat
  opens safe; the `revision` itself is the migration marker (0 = not migrated).
- **Rollback:** turning the flag OFF returns the app to reading the blob (which the
  mirror kept current). No localStorage blob to delete.

## Conflict during migration
If two tabs open the same just-migrated project, the first seed creates revision 1;
the second sees `revision !== 0` and skips seeding (no double-seed). Concurrent
seeds are resolved by the CAS (one wins, the other gets the fresh state).

## Long-term
- localStorage stays for UI preferences + theme cache only (already the case).
- As each module migrates, its blob slice becomes a mirror, then (once all readers
  use the module) the mirror is removed and the slice leaves the blob.
- A future migration-telemetry log (`WorkflowStateAudit`) can record seed events.
