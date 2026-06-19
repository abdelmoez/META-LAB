# Architecture Rescue — Testing Strategy (prompt38, Phase 10)

## Layers
**Unit (hermetic, in the CI gate):**
- `tests/unit/workflowState.test.js` — the pure concurrency core: `mergePatch`
  (shallow, never clobbers), `isStale` (revision check), `safeParse` (rejects
  arrays/junk), module-key whitelist + audit-action coverage. (8 tests)
- `tests/unit/protocolState.test.js` — protocol mappers: `pickProtocol` (only
  declared fields, ignores junk), `applyProtocol` (mirror without losing keys),
  `isBlankProtocol` (default-only = blank), `timeframeComplete` + `TIMEFRAME_OPTIONS`
  (extracted, behavior unchanged). (10 tests)

**Integration (skip-aware, run with a live server):**
- `tests/integration/api-workflow-state.test.js` — 401 unauth, 404 while flag OFF.
  The full flag-ON matrix is live-verified (below) and documented in `describe.skip`
  (it needs an admin to flip the flag).

**Regression (build + existing suites):** the full unit + screening-unit gate
(1380 tests) must stay green; the production build must compile the monolith +
feature module. Both verified.

## Live-verified flag-ON matrix (this phase, against the dev DB)
| Step | Result |
|---|---|
| flag OFF → GET module | 404 ✅ |
| flag ON → GET module | revision 0, `{}` ✅ |
| PATCH `{P}` base 0 | revision 1 ✅ |
| PATCH `{O}` base 1 | revision 2, state = `{P,O}` (shallow merge) ✅ |
| PATCH stale base 1 (current 2) | **409 STATE_CONFLICT**, current state returned, **no overwrite** ✅ |
| unknown moduleKey | 400 ✅ |
| non-member GET/PATCH | 404 (existence hidden) ✅ |
| GET summary | `protocol: revision 2` ✅ |
| flag OFF again (cleanup) | 404 ✅ |

## Manual QA (for when the flag is enabled in a staging env)
1. Create project, fill PICO, refresh → protocol loads from the server module.
2. Open in two sessions; edit different fields → both land (no whole-project
   overwrite). 3. Edit the **same** field from a stale tab → 409 conflict banner,
   no silent overwrite. 4. Old project (data in blob) opens → migrates (seed) on
   first open; no data loss. 5. App works after logout/login. 6. Viewer sees
   read-only inputs; PATCH 403.

## What to add next wave
- Integration tests that flip the flag via admin + assert the matrix automatically.
- A multi-session concurrency test (two cookies racing the same module).
- Unit tests for `useModuleState`/`useProtocolState` via a render-test harness
  (the SSR-only React test infra already exists).
