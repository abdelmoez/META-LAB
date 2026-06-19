# Architecture Rescue — Final Report (Phase 1) (prompt38)

**Version:** 3.20.0 · **Posture:** additive, feature-flagged (`serverBackedWorkflowState`,
default OFF), strangler-fig. The app's behavior is **unchanged in production**; the
new architecture is opt-in.

## 1–2. Risk assessment
- **Monolith:** `meta-lab-3-patched.jsx` = 9095 lines — the single biggest
  engineering risk (every change funnels through one file; tight coupling; state
  mixed with UI). Mapped into ~46 sections (`current-monolith-and-state-map.md`).
- **Workflow state:** canonical state is the server **`Project.data` whole-blob**,
  saved last-write-wins via debounced `PUT /api/projects/:id/autosave`. The audit
  found **no canonical data in localStorage** (only UI prefs/theme cache) — so the
  real risk is whole-blob clobbering, which this phase begins to fix.

## 3–4. Target architecture & boundaries
`src/features/*` (public-boundary feature modules) + `hooks/workflow` (generic
autosave) + `services/workflowState` (REST), keeping `research-engine` React-free.
Boundaries: dashboard, project-shell, protocol, screening, data-extraction,
analysis, risk-of-bias, grade, prisma, reports, project-control, ops, shared
collaboration, shared state. See `target-feature-module-architecture.md`.

## 5–6. Extracted from the monolith / new structure
- `TIMEFRAME_OPTIONS` + `timeframeComplete` → `features/protocol/constants.js`
  (literal extraction, re-imported).
- New: `features/protocol/` (panel + hook + mappers + constants + index),
  `hooks/workflow/useModuleState.js`, `services/workflowState/api.js`. The monolith
  now **delegates** the PICO tab to the feature module behind the flag.

## 7. Server-backed workflow-state model
Generic `WorkflowModuleState(projectId, moduleKey, stateJson, revision,
updatedBy*, …)` with `@@unique([projectId, moduleKey])`. Structured domains
(screening, RoB) keep their own tables. See `server-backed-workflow-state-design.md`.

## 8. API endpoints added
`GET /api/workspaces/:projectId/state`, `GET/PATCH …/modules/:moduleKey/state`
(flag-gated, project-access authorized, revision-based). Full contract +
status-code matrix in `workflow-state-api-contract.md`.

## 9. Database changes
One additive table `WorkflowModuleState` + a `Project` back-relation. No drops, no
resets; `prisma db push`-safe (applied to dev SQLite; prod applies on deploy).

## 10–12. First module + migration + conflict
**Protocol/PICO**, server-backed via `useProtocolState`: server load/save,
revision, **409 conflict (no overwrite)**, permission checks, and **legacy
blob→module migration** (seed on first open when the module is empty). Concurrency
uses base-revision + a compare-and-swap on `revision`. See
`workflow-concurrency-and-conflict-model.md` + `localstorage-to-server-migration-plan.md`.

## 13. Permissions
Reuses the exact project access resolvers (`store.getById` owner,
`metalabAccess.getMetaLabMemberAccess` member): view → owner/member; write →
`canEdit`; viewer → 403; non-member → 404 (existence hidden). Module keys
whitelisted; client `userId` never trusted (taken from the session).

## 14–16. Tests / QA / results
+20 unit (concurrency core + protocol mappers) + a skip-aware integration suite.
**Gate: 1382 tests green** (75 files). **Build green.** Backend **live-verified**
end-to-end against the dev DB (flag gate, revision increment, shallow merge, 409
conflict, whitelist 400, non-member 404, summary) — matrix in
`architecture-rescue-testing-strategy.md`.

### Post-review hardening (v3.20.1)
A 4-dimension adversarial review (concurrency / data-loss / security / integration)
confirmed 7 issues in the new flag-gated code — all fixed (no production impact;
flag OFF by default):
- **`useModuleState` robustness:** serialized in-flight sends (no overlapping
  flush → no spurious self-409); pending fields cleared only after a successful
  response (overlap/failure never drops edits); the server echo is re-merged with
  still-pending edits (no dropped keystrokes mid-round-trip); a 409's rejected
  fields are kept + surfaced (`yourEdit`) and re-send on the next edit/flush
  against the refreshed revision; a pending debounced patch is flushed on unmount.
- **Backend:** the create catch is narrowed to Prisma `P2002` (unique race) and
  rethrows real errors (no more phantom revision-0 "conflict" loop on a transient
  DB error); `baseRevision` rejects non-integer types (400); `isStale` compares
  strictly (no coercion).
- **Extraction:** `STUDY_DESIGNS` is now a true extraction matching the legacy
  PICOTab option set (shared by both editors → no unselectable/rewritten design).
- Re-verified live: 409→retry recovery (re-send with refreshed base → 200, both
  edits preserved), 400 on bogus `baseRevision`, and prototype-pollution safety
  (`{__proto__:…}` patch applies as an own property; global Object not polluted).

## 17–18. Remaining risks
- **localStorage:** low — only UI prefs/theme remain; no canonical data there.
- **Monolith:** still 9k lines — this phase is the *first* cut. The whole-blob
  autosave still backs every non-migrated module; protocol is dual-write
  (module-canonical + blob mirror) until its readers migrate.

## 19. Next migration waves (sequencing, no timelines)
- **Wave 1:** finish Protocol (port AI + field-locks into the module; drop the blob
  mirror once readers migrate) · Project Control settings · confirm user prefs.
- **Wave 2:** Data Extraction + outcomes (pair with `ReviewStudy`) · Analysis config.
- **Wave 3:** RoB (retire `LegacyRoBTab`) · GRADE · PRISMA.
- **Wave 4:** Report drafts · export presets · remove whole-project blob autosave.
- **Wave 5:** retire `meta-lab-3-patched.jsx` (thin shell or removed).
Each wave: additive table or reuse `WorkflowModuleState`; flag-gated; tested.

## 20. Rollback
Flag OFF (instant, no deploy) → legacy path; `git revert` for code; table is inert
when OFF (no data loss). See `architecture-rescue-safety-baseline.md`.

## 21–23. Version / commit / push
3.19.2 → **3.20.0** (minor — significant additive infrastructure, no breaking
change). Commit + push to `main` (see git log).

## 24. Known limitations
1. **One module migrated** (protocol); the rest still use the blob. By design — this
   is phase 1.
2. **Protocol is dual-write** while the flag is ON (module-canonical + blob mirror)
   so legacy readers stay consistent; the mirror still triggers blob autosave until
   readers migrate.
3. **Phase-1 panel** omits the legacy AI helpers + per-field presence locks (kept in
   the legacy editor); sequenced for Wave 1. Revision conflict protects correctness
   meanwhile.
4. **Audit** is row-metadata + structured logs, not a dedicated history table yet.

## 25. Honest engineering recommendation
This is the right foundation: a generic, conflict-safe, permission-enforced,
flag-gated per-module state layer + a feature-module pattern, proven end-to-end on
one real module — without risking the running app. **Do not accelerate by ripping
the monolith apart;** continue wave-by-wave, each flag-gated and tested, retiring
the blob only when a module's last reader has moved. The biggest near-term value is
finishing Protocol (locks/AI + drop the mirror) and migrating Data Extraction onto
the already-existing `ReviewStudy` structured store.
