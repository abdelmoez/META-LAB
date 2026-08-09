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

## Detection status semantics (107.md §1)

The job row is the **only** authoritative source of "has detection run, and how
did it end". Before 107.md the Overview endpoint inferred it from results —
`duplicateDetectionRun: dupGroups.length > 0` — which is wrong in three ways: a
completed run finding **zero** duplicates read as never-run (the stepper's
permanent "Pending"), a failed run was indistinguishable from never-run, and the
flag silently regressed whenever an import-batch delete or a scoped reset removed
the last group rows.

`GET …/overview` → `dataSummary` now carries both:

- **`duplicateDetectionRun`** (unchanged name; many callers/tests read it) —
  `dupGroups.length > 0 || a completed job exists`. The coarse "is there a valid
  dedup result?" flag; gates the Overview duplicate stat tiles.
- **`duplicateDetection`** — the explicit state:

  | field | meaning |
  |---|---|
  | `status` | `never_run` \| `queued` \| `processing` \| `completed` \| `failed` \| `cancelled` — the status of the **latest** job row (newest `createdAt`, id as tiebreak) |
  | `lastCompletedAt` | `completedAt` of the newest `completed` job, else `null` |
  | `lastError` | the failed job's user-facing `error`, truncated to 300 chars; `null` unless `status === 'failed'` |
  | `stale` | the last completed sweep no longer covers the current record set |
  | `staleReason` | `records_added` \| `record_count_changed` \| `null` |

Both come from two indexed `findFirst`s on `ScreenDuplicateJob` plus one
`_max: { createdAt }` aggregate over `ScreenRecord` — no extra record loads.

### Staleness rule (explicit and deterministic)

There is no input fingerprint on `ScreenDuplicateJob` (and 107.md needed none —
no schema change). Staleness is derived, and only ever evaluated when a completed
job exists:

1. **`records_added`** — the newest `ScreenRecord.createdAt` is later than the
   last completed job's `completedAt`. Such a record was provably never scanned.
2. **`record_count_changed`** — the project's current record count differs from
   the count the sweep saw. **Not** `job.totalRecords`: that column counts only
   the records the sweep *considered* (members of resolved groups are frozen out),
   so comparing it against the project total would report a false "stale" for
   every project with a resolved group. The worker instead records the project-wide
   count in `statsJson.projectRecordCount` at completion, and the overview compares
   against that.

Known gap: jobs that completed **before** `statsJson.projectRecordCount` existed
have no count to compare, so for them rule 2 is skipped and only rule 1 applies
(a pure deletion would go unnoticed until the next run). This degrades honestly
rather than fabricating a comparison; the first rerun fixes it permanently.

Staleness never rewrites the status and never triggers an automatic rerun — the
Duplicates tab shows an inline note ("Records have changed since the last
detection — rerun to update results.") beside the existing Detect button.

### Realtime + out-of-order protection (107.md §1)

- The worker emits `duplicates.completed` **and** `project.updated` on **every**
  terminal transition — completed, failed, cancelled (including the admin
  kill-switch path and a queued job cancelled before the worker ever claims it) —
  and **no longer excludes the initiating user**. The old
  `{ exclude: job.createdById }` assumed the initiator's own polling covered them;
  it did not. The Duplicates tab's `refreshProject` updates *SiftProject's* summary,
  while the Stitch white vertical stepper reads a **separate** summary owned by
  `useScreeningSummary` that the tab cannot reach and that has no polling loop. The
  person who clicked Detect was therefore the only one who never saw their own
  result land. The extra refetch they now perform is idempotent.
- Both summary owners subscribe to `duplicates.completed`:
  `src/frontend/stitch/shell/useScreeningSummary.js` and the realtime map in
  `src/frontend/screening/pages/SiftProject.jsx`.
- `src/research-engine/screening/duplicateJobState.js` (pure) exports
  `pickNewerJob(prev, next)`, used at **every** `setJob` site in `DuplicatesTab`
  that is fed by a network response (reconnect fetch, 1.5 s poll, 10 s idle poll,
  detect and cancel replies). Same job id → status may only advance
  (queued < processing < terminal), equal rank resolved by `updatedAt` (now
  included in `publicDuplicateJob`), identical observations return the previous
  object so an idle poll of a settled job causes no re-render. Different job id →
  the newer `createdAt` wins, so a fresh retry job supersedes an old completed run
  while a stale response for the previous run cannot displace it.
- The 10 s idle poll now also refreshes the shell summary on a terminal transition
  (it previously refreshed only the group list, leaving the stepper stale), and its
  data-load side effect was moved OUT of the `setJob` functional updater — React 18
  StrictMode double-invokes updaters.

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

## Rec round (adversarial review of 3886815 — 65 agents, 24 confirmed findings, all addressed)

- **P1 — mid-run reviewer resolutions won lost races**: the save phase now
  REVALIDATES inside each transaction (skips any plan whose target/absorbed
  group gained `resolvedAt` after the snapshot; re-reads the live primary) and
  the resolve endpoints return **409** while a detection job is active for the
  project. `statsJson.skippedResolvedMidRun` records reviewer wins.
- **Engine correctness**: `maxDistFor` fixes the IEEE-float threshold bug
  (`floor((1-0.92)·maxLen)` rejected pairs at exactly 0.92 whenever maxLen was a
  multiple of 25); blocking gained `m:` (middle) + `u:` (second token tier) keys
  (evading comparison now needs ≥5 spread-out edits); exact-id buckets union all
  non-excluded pairs (an excluded pair can no longer eject a record from its own
  DOI group) and identifier buckets over `maxBlockSize` are skipped as junk data
  (`oversizedIdBuckets`); compared titles are capped at 400 normalized chars so a
  dirty abstract-in-title cannot make comparisons quadratic; bucket build yields.
- **Worker resilience**: claims zero the progress counters (no percent
  regressions on retry); a failed post-claim read re-queues instead of stranding
  `processing`; a periodic unref'd recovery tick heals orphaned jobs without a
  restart; drain has a lost-wakeup guard; queued jobs honour the admin
  kill-switch at claim time; save transactions carry explicit
  `maxWait/timeout`; the primary write is `updateMany` (a mid-window record
  delete can't abort the batch); groups left half-resolved by the historical
  keepAll 500 (labels written, group not resolved) are HEALED into resolved
  keep-alls instead of being re-flagged.
- **API/UX**: `publicDuplicateJob` strips host cpu/heap metrics (server-log-only);
  the client shows the server's actionable 403 message; job state resets on
  project switch and a slow idle status-poll keeps other members' open tabs in
  sync (plus a `project.updated` completion poke); members with
  `canManageDuplicates` now see the same Detect/Cancel/Retry/resolve controls the
  server already granted them; completion/failure are announced to screen
  readers (`role="status"`/`role="alert"`).
- **Rec round 2**: per-user fairness cap (`SCREEN_DUP_MAX_ACTIVE_PER_USER`,
  default 3 active jobs across projects → 429 `DUP_JOB_LIMIT` with an
  actionable message) and a mega-group save guard
  (`SCREEN_DUP_MAX_GROUP_SIZE`, default 1000 — junk-data chains are skipped +
  counted in `statsJson.skippedOversizedGroups`, never dragged through one
  transaction). A DB-level unique active-key was prototyped and REVERTED:
  adding `@unique` to an existing table fails the non-interactive VPS
  `prisma db push` deploy (deploy.yml passes no `--accept-data-loss`), which is
  the same invariant the schema's plain-@@index notes document. The enqueue
  race therefore stays oldest-wins convergence.
- **Accepted + documented** (split findings): enqueue convergence is
  narrow-not-atomic (harmless — the worker is serial and saves are idempotent);
  engine peak memory ≈180 MB at 100k records (bounded by `maxComparisons`);
  blocking remains deliberately approximate (see `blockKeysFor` docs).
- **Pre-existing repairs shipped alongside**: prompt6/prompt7 mod-RBAC
  integration tests were stale (audit-86 revokes sessions on role change — the
  tests now re-login after promotion); `api-ai-citation-sample` asserted the
  pre-audit-90 contract (403 is now valid for non-admins).

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
  keep-all survival, 401/404 access, safe cancellation, and (107.md §1) the
  zero-duplicate completed run reading as run in the overview, staleness
  flipping after a post-completion import, and a cancelled run never claiming a
  completed sweep.
- `tests/unit/screening/duplicateJobState.test.js` — (107.md §1) forward-only
  job state: pending→processing→completed/failed, stale same-id responses
  dropped, older-job responses ignored, a newer queued retry superseding an old
  completed run, null/garbage tolerance.
- `tests/unit/screeningSteps.test.js` — (107.md §1) the duplicates step's
  as-built states, including the regression case: completed with zero groups →
  `done` / "No duplicates" (previously a permanent "Pending").
