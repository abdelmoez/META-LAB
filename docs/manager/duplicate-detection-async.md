# Duplicate Detection — durable background job (92.md)

## Root cause of the server freeze (measured)

`POST /api/screening/projects/:pid/duplicates/detect` ran the ENTIRE detection
synchronously inside the HTTP request (`detectDuplicatesInProject`):

1. **O(n²) pairwise fuzzy pass on the event loop.** Every ungrouped record was
   compared against every other; no `await` inside the loops, so the single Node
   event loop was blocked for the whole sweep. Measured with realistic ~90-char
   titles: **500 records ≈ 30 s frozen, 2,000 records ≈ 479 s (8 min) frozen**;
   10k+ records extrapolate to hours. While frozen, every other request (any
   user, any project, health checks) queued → 502/503/504 at the proxy.
2. **Full-matrix Levenshtein per pair.** Each comparison allocated an
   (m+1)×(n+1) array-of-arrays (~8k cells + GC pressure per pair at title
   lengths ~90).
3. **Repeated normalization.** `normalizeTitle` ran inside the inner pair loop —
   O(n²) normalizations of the same strings.
4. **O(g) `groups.find(...)` scans inside the pair loop** (quadratic again).
5. **N+1, non-transactional persistence.** One `findFirst` + `create` +
   `updateMany` + `update` per group; a crash mid-way left half the groups
   written.
6. **No job model.** A double click (or two members) started two concurrent
   full sweeps with racing writes; a refresh lost all feedback; nothing was
   resumable.

## Fix — architecture

Reuses the platform's established durable-job pattern (ScreenImportJob /
ScreenExportJob: DB row as queue, in-process drain, atomic claim, retry cap,
boot recovery). No new infrastructure.

- **`ScreenDuplicateJob`** (both Prisma schemas, additive): status/stage,
  progress counters (`totalRecords/processedRecords/comparisonsTotal/
  comparisonsDone/groupsFound/savedGroups/…`), `cancelRequested`, `attempts`,
  `heartbeatAt`, `statsJson` (stage durations, cpu/mem, engine stats).
- **`server/services/screeningDuplicateWorker.js`** — enqueue (ONE active job
  per project; concurrent starts converge on the same job), atomic claim,
  cursor-paginated record loads, cooperative yields (`setImmediate`) every
  batch/2k comparisons, throttled progress+heartbeat writes (750 ms), batched
  `$transaction` persistence (25 groups/tx), cancellation at every beat +
  save-batch boundary, heartbeat-based crash recovery under the shared
  `jobRetry.js` attempts cap.
- **`src/research-engine/screening/duplicateDetectionEngine.js`** (pure) —
  normalize once per record; exact DOI/PMID passes over hash buckets with
  union-find; fuzzy matching only between blocking-key candidates (title
  prefix `p:`, suffix `s:`, top-4-token `t:` keys); banded early-exit
  Levenshtein (O(L·k), two reused rows). Caps: `maxBlockSize` (default 400,
  degenerate buckets skipped + counted), `maxComparisons` (default 2M,
  `stats.truncated` when hit). 10k records: seconds, <2M comparisons (test-
  enforced), event loop yielded throughout.
- **`duplicateGroupPlan.js`** (pure) — maps the detected partition onto
  existing rows: unchanged groups → no writes (idempotent reruns), overlaps
  extend the OLDEST open group (reviewer's primary kept), merged suggestions
  absorb deterministically.
- **API** — `POST …/duplicates/detect` → **202 { job, alreadyRunning }**;
  `GET …/duplicates/detect/status` (latest job — refresh reconnect);
  `GET …/duplicates/jobs/:jobId` (poll); `POST …/duplicates/jobs/:jobId/cancel`.
  Same permission gates as before (owner/leader/canManageDuplicates; outsider
  404; admin `allowDuplicateDetection` switch).
- **Frontend (DuplicatesTab)** — persistent progress panel driven ONLY by the
  job row via pure `duplicateJobProgress.js` (stage label, honest %, records/
  comparisons/groups counters, elapsed, ETA once meaningful, who started it,
  running/retrying/cancelling states; never 100% mid-run). Button becomes
  "Detection in progress…" while active; refresh re-attaches via
  `detect/status`; completion auto-refreshes the group list and shows a
  summary ("no duplicates found" included); failures show the user-facing
  error + safe Retry.

## Data integrity rules

- Members of **resolved** groups are frozen — never re-detected, so keep-all /
  merge decisions are never overwritten.
- Reviewer-labelled `not_duplicate` pairs are never linked directly again.
- Existing **unresolved** groups are pre-unioned: re-detection extends them
  instead of duplicating them; reruns on unchanged data write nothing.
- Detection never deletes records and never auto-merges — it only creates or
  extends suggestion groups and flags non-primary members (unchanged
  semantics).
- Saves are transactional per batch; a crash/cancel between batches leaves
  only complete, valid groups. New records imported later are picked up by the
  next run; records edited mid-run are matched on their snapshot.

## Resource protection & observability

- Global worker concurrency: 1 (sequential drain, like import/export);
  per-project: 1 active job (enqueue-level lock). Env-tunable:
  `SCREEN_DUP_STUCK_MS`, `SCREEN_DUP_READ_BATCH`, `SCREEN_DUP_SAVE_BATCH`,
  `SCREEN_DUP_MAX_BLOCK`, `SCREEN_DUP_MAX_COMPARISONS`,
  `SCREEN_DUP_YIELD_EVERY`, `SCREEN_DUP_PROGRESS_MS`. Ready for tier-based
  limits later (job rows carry creator + project).
- `[dup-worker]` structured logs (job/project ids, dataset size, stage
  durations, comparison counts, failure stacks). `statsJson` on the row keeps
  engine stats + per-stage durations + cpu/heap usage for admins; users only
  ever see the friendly `error` message.

## Indexes

- `ScreenDuplicateJob`: `(projectId,status)`, `(projectId,createdAt)`,
  `(status,createdAt)`.
- `ScreenRecord.duplicateGroupId` and `ScreenDuplicateGroup.projectId` — both
  previously unindexed full scans on resolve/list paths.

## Tests

- `tests/unit/screening/duplicateDetectionEngine.test.js` — banded-Levenshtein
  equivalence vs reference, exact/fuzzy/year/unicode rules, legacy brute-force
  partition equivalence, exclusion + pre-union, caps, determinism, yielding,
  10k-record perf smoke (<30 s, <2M comparisons, full planted-pair recall).
- `tests/unit/screening/duplicateJobProgress.test.js` — monotonic honest %,
  terminal/retrying/cancelling states, ETA gating.
- `tests/unit/screening/duplicateGroupPlan.test.js` — idempotent no-ops,
  extend/absorb determinism, primary preservation.
- `tests/screening/integration/duplicate-jobs.test.js` — 202 lifecycle,
  rerun idempotency, concurrent-start convergence, refresh reconnect, manual
  keep-all survival, 401/404 access, safe cancellation.
