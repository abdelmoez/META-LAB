# SE2 — Increment 3b: model versioning, drift tracking & rollback (se2.md §11)

> Second slice of Increment 3. Additive (columns on `ScreenAiRun`, no new table, no
> destructive migration); behind the `aiScreening` flag. Builds on the calibration +
> stopping metrics from Increment 2 (drift compares them across runs).

## What shipped

### Model version lifecycle
Every completed scoring run is now an explicit **model version**. `ScreenAiRun` gained
(additive) `isActive`, `supersededAt`, `parentRunId` (lineage), `rollbackFromRunId`,
`snapshotHash`, `featureVersion`, `driftJson`, and a `(projectId, stage, isActive)` index.
On each run, `runScoring`:
- stamps a reproducible **`snapshotHash`** = SHA-1 of the sorted labelled-record→label
  pairs + the model-defining config (provider / threshold / calibration method);
- records **lineage** (`parentRunId` = the version it supersedes);
- marks itself **active** and demotes the previous active version
  (`isActive=false, supersededAt=now`) — exactly one active version per (project, stage).
  Human decisions, scores, and all prior run rows are preserved; only the active pointer
  moves.

### Drift tracking (pure)
New `src/research-engine/screening/ai/drift.js`:
- `scoreHistogram` (fractional bins + mean), `populationStabilityIndex` (PSI),
  `detectClassCollapse`, `runDriftSnapshot`, and `computeDrift`.
- `computeDrift` compares the new version's snapshot to the previous active version's and
  emits explicit **warnings**: AUC drop, Brier/ECE worsening, WSS@95 fall, prevalence
  shift, large score-distribution shift (PSI ≥ 0.25), or the model **collapsing** into one
  band. Stored in `driftJson`; surfaced as a warning banner in the leader panel.

### Rollback
- `rollbackToRun` re-scores current records **pinned to a prior version's configuration**
  (embedding provider + threshold), producing a new **active** version stamped
  `trigger:'rollback'` + `rollbackFromRunId`. It is **honest** about semantics: it reverts
  the model *configuration* and re-scores current data — not a byte-identical restore of
  old scores (the deterministic engine reflects current decisions). Prior versions and all
  human decisions are preserved; audit logs `AI_MODEL_ROLLED_BACK`.
- New endpoints (leader / settings-gated, flag-gated): `GET /ai/versions` (history),
  `POST /ai/rollback`.

### UI (`AiAssist.jsx`, leader)
- A **drift-warning banner** in the AI status panel when the active version drifted from
  the previous one.
- A **Model versions** list (active marker, snapshot hash, mode/AUC, rollback badge, a
  per-version drift count) with a **Roll back** action, plus an honest note about rollback
  semantics.

## DB / API / files
- **DB (additive `prisma db push`):** new `ScreenAiRun` columns + index. No new table, no
  destructive change; existing runs default to `isActive=false` (the next run becomes
  active).
- **API:** `GET /screening/projects/:pid/ai/versions` (leader), `POST .../ai/rollback`
  (leader/settings). Run metrics now include `drift`.
- **New:** `drift.js`, `tests/unit/screening/ai/drift.test.js` (13 tests).
- **Changed:** engine `index.js`/`config.js`, `screeningAiService.js` (lifecycle +
  rollback + `listModelVersions` + snapshot hash), `screeningAiController.js`,
  `routes/screening.js`, `aiApi.js`, `useScreeningAi.js`, `AiAssist.jsx`, `schema.prisma`.

## Verified
- +14 pure drift unit tests. Full suite **1693 green / 98 files** (was 1679). Build green.
- **Real-DB smoke:** ran scoring twice → v2 active with `parentRunId`→v1, snapshot hash,
  v1 demoted (`supersededAt` set), drift computed; **rollback** → new active
  `trigger:rollback` run with `rollbackFromRunId`→v1, v2 demoted; `listModelVersions` shows
  the active marker. Concurrency smoke: two concurrent runs for one (project,stage)
  **serialized** (no deadlock) and left **exactly one** active version.

## Adversarial review (12 agents, 4 lenses + verify) — 7 findings, all fixed
- **HIGH (fixed):** direct callers (`postAiRun`, `rollbackToRun`) bypassed the background
  job's concurrency guard, so concurrent runs for one (project,stage) could race lineage +
  per-record run attribution and leave two active versions. Fix: a per-(project,stage)
  in-process mutex (`withRunLock`) now serializes **every** `runScoring` entry point.
- **MEDIUM (fixed):** a mid-persist failure (between creating the active run and demoting
  the previous) could leave two active. Fix: the create+persist+demote sequence is guarded
  — on failure the half-written run is flipped inactive/failed so the prior version stays
  sole-active.
- **MEDIUM (fixed):** `ModelHistory` re-fetched `/ai/versions` on every render (effect dep
  loop). Fix: keyed the effect on the active-run id only.
- **LOW ×4 (fixed):** lineage `prevActive` lookup moved out of the best-effort drift
  try/catch; WSS@95 drift gets its own `wssFall` threshold; dropped a dead `classBalance`
  snapshot field; version-history endpoint permission aligned with rollback
  (`canManageSettings`).

## Known limitation (multi-process)
`withRunLock` is in-process. A multi-process / multi-replica deployment would also need a
DB advisory lock (or a unique partial index on `(projectId,stage) WHERE isActive`) for the
same guarantee — documented in-code as a follow-up.

## Honesty & limitations (se2.md §11/§19)
- Rollback reverts model **configuration** and re-scores current data; it is not a
  byte-identical restore (documented in-code and in the UI). True per-run score restore
  would require retaining per-run scores (not done — scores are upserted latest-wins).
- The **model-comparison UI** is metric + drift level; per-record ranking-overlap /
  changed-priority comparison needs retained per-run scores — a documented follow-up.

## Next (remaining Increment 3)
- **3c — §7:** real biomedical embeddings (service + model selection + text representation).
- **3d — §12:** background-job scalability beyond the 5,000-record cap.
