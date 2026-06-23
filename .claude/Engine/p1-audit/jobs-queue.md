# P1 Audit — Background Jobs / Queue / Worker Infrastructure

Scope: locate every background-job/queue/worker mechanism, document the durable
patterns precisely, and decide whether P1 (Pecan Search Engine: automated DB-API
search → auto-import → provenance/dedup/PRISMA-S) can reuse them.

TL;DR — there are TWO in-process job systems. One is the right reuse target:

| System | Durable? | Claim model | Boot recovery | Verdict for P1 |
|---|---|---|---|---|
| **ScreenImportJob worker** (`screeningImportWorker.js`) | YES (DB-backed) | atomic `updateMany` status flip queued→processing | YES — `startImportWorker()` re-queues stuck rows | **REUSE this pattern verbatim** |
| **ScreenAiJob rescore scheduler** (`screeningAiJobs.js`) | row is logged, but scheduling is IN-MEMORY | in-memory `Set` + `withRunLock` mutex | NO (in-memory maps lost on restart) | reference only; do NOT base P1 on it |

---

## 1. PRIMARY REUSE TARGET — Durable Import Worker (prompt50 WS2)

### 1.1 Worker file
`server/services/screeningImportWorker.js` (147 lines). Header comment explicitly
frames it as "the safest durable alternative that fits the architecture (single
Node process + SQLite, no Redis/Bull): the job + its source content live in the
DB, so the browser need not keep the dialog open, and a process restart resumes
unfinished work."

Key symbols (file:line):
- `const STUCK_MS = 10 * 60 * 1000` — L28. Abandoned-claim window.
- `let draining = false` — L30. Single-flight drain guard (per process).
- `async function patch(jobId, data)` — L33. Best-effort row update; never throws into loop.
- `async function fail(jobId, message)` — L38. Terminal failure; sets `status:'failed'`, `stage:'failed'`, clears `content:''`, stamps `completedAt`.
- `async function claimNext()` — **L47. THE ATOMIC CLAIM.** Pattern:
  1. `findFirst({ where:{ status:'queued' }, orderBy:{ createdAt:'asc' }, select:{id:true} })`
  2. `updateMany({ where:{ id:next.id, status:'queued' }, data:{ status:'processing', stage:'parsing', startedAt:new Date() } })`
  3. `if (claim.count !== 1) return claimNext()` — lost the race, try next (no double-process).
  4. return the freshly-claimed row.
- `async function processJob(job)` — L63. Parse → dedupe → insert; writes progress via `onProgress` callback (`patch(job.id, {processedRecords,importedRecords})`); on success sets `status: rejected>0 ? 'completed_with_warnings':'completed'`, clears `content`, emits `import.completed`. Catches `e.code==='CAPACITY'` → user-facing fail.
- `async function drain()` — L109. `if(draining)return; draining=true;` loop `claimNext()`→`processJob()` until empty; `finally{ draining=false }`.
- `export function kickImportWorker()` — **L126.** `setImmediate(()=>drain().catch(()=>{}))`. Idempotent, non-blocking. **Call this after enqueueing.**
- `export async function startImportWorker()` — **L134. BOOT HOOK.** Re-queues rows left `processing` with `startedAt==null OR startedAt < now-STUCK_MS` back to `queued`, logs count, then `kickImportWorker()`.

### 1.2 Durable model — `ScreenImportJob`
`server/prisma/schema.prisma` L640–674 (mirrored in `server/prisma/postgres/schema.prisma`).
```
model ScreenImportJob {
  id               String  @id @default(uuid())
  projectId        String
  project          ScreenProject @relation(fields:[projectId], references:[id], onDelete: Cascade)
  createdById      String
  createdByName    String  @default("")
  status           String  @default("queued")   // queued|processing|completed|completed_with_warnings|failed
  stage            String  @default("queued")    // queued|validating|detecting|parsing|deduplicating|saving|finalizing|done|failed
  filename         String  @default("")
  format           String  @default("")          // caller hint (auto = content-detected)
  detectedFormat   String  @default("")
  fileHash         String?
  fileSize         Int     @default(0)
  content          String  @default("")          // SOURCE TEXT; CLEARED on terminal state
  force            Boolean @default(false)
  totalRecords     Int     @default(0)
  processedRecords Int     @default(0)
  importedRecords  Int     @default(0)
  duplicateRecords Int     @default(0)
  rejectedRecords  Int     @default(0)
  warningCount     Int     @default(0)
  errorReport      String  @default("[]")        // JSON [{index,title,reason}]
  error            String  @default("")
  batchId          String?                        // linked ScreenImportBatch once saved
  startedAt        DateTime?
  completedAt      DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@index([projectId, status])
  @@index([status, createdAt])   // <- claimNext()'s ordering index
  @@index([projectId, fileHash]) // <- idempotency lookup index
}
```
Migration (pure additive, applies via `prisma db push` with no `--accept-data-loss`):
`server/prisma/migrations/20260622010000_prompt50_screen_import_job/migration.sql`.

### 1.3 Enqueue path (controller + route)
- Controller: `startImport(req,res)` in `server/controllers/screeningController.js`
  (~L1000–1077). Computes `fileHash = sha256(content with \r\n→\n)` (L1030).
  **Idempotency guard L1032–1056** (when `force!==true`): if a non-failed job with
  same `fileHash` is `queued|processing` → returns that job `202 {alreadyRunning:true}`;
  if a completed prior job/batch exists → `409 duplicate_import`. Then
  `prisma.screenImportJob.create({...})` (L1058) → `kickImportWorker()` (L1071) →
  `res.status(202).json({ jobId, status:'queued' })`.
  Import of worker at L13: `import { kickImportWorker } from '../services/screeningImportWorker.js'`.
- Poll: `getImportJob(req,res)` (L1080+) — returns progress/result, never raw `content`.
- Routes (`server/routes/screening.js`):
  - L119 `r.post('/projects/:pid/import/start', S.startImport)`
  - L120 `r.get('/projects/:pid/import/jobs/:jobId', S.getImportJob)`

### 1.4 Boot wiring
`server/index.js` L333–335 (inside the post-listen seed block):
```
startImportWorker().catch(err => console.error('[import-worker] start failed:', err.message));
```

### 1.5 Realtime nudge
On completion `processJob` calls `emitToProjectMembers(job.projectId, {type:'import.completed', jobId}, {exclude: job.createdById})` (`server/realtime/bus.js`, `emitToProjectMembers()` ~L99) plus `touchProjectActivity(linkedMetaLabProjectId)` (`server/store.js` L245). UI polls `GET …/import/jobs/:id` for progress; the SSE poke just nudges OTHER sessions to refresh.

---

## 2. SECONDARY (reference only) — ScreenAiJob rescore scheduler

### 2.1 Scheduler file
`server/services/screeningAiJobs.js` (125 lines). Header is explicit: "Single-node
in-process scheduler… a multi-node setup would swap the in-memory maps for a
shared queue (documented limitation — se2.md §12). The job table makes that
migration clean."

In-memory state (LOST on restart — this is why it is NOT the P1 target):
- `const debounceTimers = new Map()` — L23 (key→Timeout)
- `const active = new Set()` — L24 (key currently running)
- `const rerun = new Set()` — L25 (needs another run after current)
- `keyOf(projectId,stage)` — L27 → `${projectId}::${stage}`

Functions:
- `liveUpdateAllowed(projectId)` — L30. Flag/settings gate.
- `scheduleRescore(projectId,{stage,actor,debounceMs})` — L45. Debounce-coalesce (default 4000ms from `g.retrainDebounceMs`), `setTimeout`→`runJob`. Fire-and-forget. `t.unref()` so it never holds the process open.
- `runJob(projectId,stage,actor)` — L62. **In-memory coalescing, not a DB claim:** `if(active.has(key)){rerun.add(key);return}`. Creates a `ScreenAiJob` row `{status:'running', kind:'rescore', trigger:'decision'}` (L71) purely for observability/history, runs `runScoring()`, updates row to `completed`/`failed`. `finally` re-schedules if `rerun.has(key)`.
- `getJobStatus(projectId,stage)` — L98. Reads latest + last-completed `ScreenAiJob` rows; computes `pending` = `ScreenDecision` count since `lastCompleted.completedAt`. Surfaces `updating|queued|idle`.
- `_resetJobs()` — L124. Test-only reset.

Callers:
- `server/controllers/screeningController.js` L390/L391 (project create → seed both stages) and L1367 (`saveDecision`→`scheduleRescore`).
- `server/controllers/screeningAiController.js` L82 (`getJobStatus`).

### 2.2 The serialization mutex — `withRunLock`
`server/services/screeningAiService.js` L252–260. In-process per-`(project,stage)`
promise-chain mutex so ALL `runScoring` entry points (manual run, rollback,
background rescore) serialize:
```
const _runLocks = new Map();                       // L252
function withRunLock(key, fn) {                    // L253
  const prev = _runLocks.get(key) || Promise.resolve();
  const run = prev.then(()=>fn(), ()=>fn());        // never rejects → can't wedge
  const tail = run.then(()=>{}, ()=>{});
  _runLocks.set(key, tail);
  tail.then(()=>{ if(_runLocks.get(key)===tail) _runLocks.delete(key); });
  return run;
}
export async function runScoring(opts={}) {          // L262
  const stage = opts.stage||'title_abstract';
  return withRunLock(`${opts.projectId}::${stage}`, ()=>_runScoring({...opts,stage}));
}
```
Code comment (L246–251) flags the multi-process gap: "a multi-process deploy would
need a DB advisory lock — documented." This is an in-memory `Map`, NOT a DB lock.

### 2.3 ScreenAiJob model (observability row, not a claim queue)
`server/prisma/schema.prisma` L1116–1135:
```
model ScreenAiJob {
  id String @id @default(uuid())
  projectId String
  stage String @default("title_abstract")
  kind String @default("rescore")   // rescore|train
  status String @default("queued")  // queued|running|completed|failed|superseded
  trigger String @default("decision") // decision|manual|api
  reason String @default("")         // failure reason (no article text)
  runId String @default("")          // resulting ScreenAiRun id
  nScored Int @default(0)
  coalesced Int @default(0)
  durationMs Int?
  startedAt DateTime?  completedAt DateTime?
  createdAt DateTime @default(now())  updatedAt DateTime @updatedAt
  @@index([projectId, createdAt])  @@index([projectId, status])
}
```
NOTE: although the default is `queued` and a `superseded` state exists, the worker
never *claims* off this table — `runJob` writes rows straight to `running`. The
queue semantics live in the in-memory `active`/`rerun` Sets. So this table is a
history/observability log, not a durable work queue.

Related (engine output, not queue): `ScreenAiRun` (L1020), `ScreenAiScore` (L1059)
— model-version lineage + per-record scores. Not job infrastructure but the
DOWNSTREAM artifacts of a run; P1's "search-then-screen" flow eventually feeds these.

---

## 3. Other "background" mechanisms scanned (NOT durable queues)
- `server/index.js` seed block (post-listen): `backfillProjectActivity()` (L330),
  `startImportWorker()` (L335), waitlist config check (L337+). One-shot boot tasks,
  not recurring workers. No `setInterval` cron loop anywhere in `index.js`.
- Beta waitlist (`server/waitlist/`) — isolated DB, synchronous request handling,
  no job queue.
- No Redis / Bull / BullMQ / agenda / node-cron / separate worker *process*. Single
  Node process; "workers" = in-process async drains kicked via `setImmediate`.
  (The only OS "worker" reference in index.js L294 is the pdf.js `.mjs` web-worker
  MIME note — unrelated to job queues.)

---

## 4. VERDICT FOR P1 — Reuse the ScreenImportJob durable pattern; add a SearchJob table

**P1 can and SHOULD reuse the durable-job pattern from `screeningImportWorker.js`
verbatim. Do NOT build on the in-memory `ScreenAiJob` scheduler.** A long-running
DB-API search (PubMed/etc. paginated fetch → auto-import) is exactly the
"browser-closeable, crash-resumable, observable via polling" shape this worker was
built for.

### Precise reuse path (copy-adapt, do not extend the import job)
1. **New model** `ScreenSearchJob` (or `PecanSearchJob`) in BOTH
   `server/prisma/schema.prisma` AND `server/prisma/postgres/schema.prisma`, mirroring
   `ScreenImportJob`'s shape: `id, projectId(+FK onDelete:Cascade), createdById/Name,
   status(queued|processing|completed|completed_with_warnings|failed),
   stage(queued|querying|fetching|deduplicating|saving|done|failed),
   startedAt, completedAt, createdAt, updatedAt`, plus P1-specific columns
   (`databaseKey`/source, `queryJson` or `strategyHash`, `cursor`/`webenv`/`nextPage`
   for resumable pagination, `totalHits`, `fetchedRecords`, `importedRecords`,
   `duplicateRecords`, `provenanceJson`/PRISMA-S counts, `error`, `errorReport`).
   Keep the SAME three indexes — critically `@@index([status, createdAt])` which
   `claimNext()`'s `findFirst(orderBy createdAt asc)` depends on.
   Ship as a **pure additive migration** (new table) so VPS `prisma db push`
   needs no `--accept-data-loss` (follow the WS2 migration header exactly).
2. **New worker** `server/services/pecanSearchWorker.js` cloned from
   `screeningImportWorker.js`: keep `STUCK_MS`, `draining` guard, `patch`, `fail`,
   the **atomic `claimNext()` flip** (`updateMany where status:'queued' → processing`,
   `if(count!==1) recurse`), `drain()`, `kickSearchWorker()` (`setImmediate`), and
   `startSearchWorker()` boot-requeue.
3. **`processJob` body** = P1 logic: call the DB-API client(s), page through results
   (persist `cursor`/`nextPage` to the row after each page so a crash resumes — the
   import worker doesn't paginate, this is the one real addition), then feed parsed
   records into the EXISTING `dedupeAndInsertRecords(projectId, records, {...})`
   from `server/services/screeningImportService.js` (same dedupe/dedup-and-insert +
   `onProgress` callback the import worker already uses). This auto-reuses dedup,
   capacity caps (`DEFAULT_MAX_RECORDS_PER_PROJECT`), and `ScreenImportBatch` linkage.
4. **Enqueue** in a new controller fn mirroring `startImport`: create the row,
   `kickSearchWorker()`, return `202 {jobId,status:'queued'}`. Add an idempotency
   guard keyed on `strategyHash` (mirroring `startImport`'s `fileHash` guard at
   `screeningController.js` L1032–1056) so re-running the same query doesn't double-fetch.
5. **Poll endpoint** mirroring `getImportJob`; **routes** under
   `server/routes/screening.js` near L119–120.
6. **Boot wiring**: add `startSearchWorker().catch(...)` next to the
   `startImportWorker()` line in `server/index.js` L335.
7. **Realtime**: emit `search.completed`/`import.completed` via
   `emitToProjectMembers` + `touchProjectActivity`, same as L97–100.

### Top risks / gotchas
- **In-memory ≠ durable.** The `ScreenAiJob` path *looks* like a queue but the
  scheduling is in-memory (`active`/`rerun`/`debounceTimers` Maps lost on restart)
  and `withRunLock` is an in-process `Map`, NOT a DB lock. Reusing it would make
  P1 search jobs vanish on deploy/crash. Use the ImportJob path instead.
- **Single-process claim only.** `claimNext()`'s atomic flip is safe for ONE Node
  process (multiple concurrent drains in-process). It is NOT a cross-process lease
  (no `workerId`/lease-expiry column). Multi-node would still need a DB advisory
  lock / lease column — documented limitation in both files. P1 inherits the same
  single-node assumption; if P1 ever runs on >1 node, add a `claimedBy`+`leaseUntil`
  pair and filter `claimNext` by expiry.
- **`content` clearing convention.** ImportJob stores source text in `content` and
  CLEARS it on terminal state (privacy/size). P1 likewise should clear large
  intermediate payloads (raw API responses) on completion; persist only counts +
  provenance.
- **Stuck-job recovery is coarse.** Recovery = "re-queue rows `processing` older
  than STUCK_MS at boot." A job that crashed will FULLY re-run `processJob` from the
  top — so make P1's `processJob` **idempotent / resumable** (use the persisted
  `cursor`, and rely on `dedupeAndInsertRecords` to swallow re-inserted dupes).
- **No retry/backoff for transient API errors.** The import worker fails terminally
  on error (no auto-retry). DB-API search WILL hit rate limits / 5xx — P1's
  `processJob` must add its own in-job retry/backoff around the API client, since the
  queue layer offers none. Don't conflate a transient fetch error with a terminal
  `fail()`.
- **Schema parity.** Two schema files (`schema.prisma` + `postgres/schema.prisma`)
  must stay in sync (Postgres-readiness work, prompt49 #2). Add the new model to BOTH.
- **`@@index([status, createdAt])` is load-bearing** for FIFO claim ordering — don't omit it.

### Files to touch for P1 (concrete)
- NEW: `server/services/pecanSearchWorker.js` (clone of `screeningImportWorker.js`)
- EDIT: `server/prisma/schema.prisma` + `server/prisma/postgres/schema.prisma` (add `ScreenSearchJob`)
- NEW: `server/prisma/migrations/<ts>_pecan_search_job/migration.sql` (additive)
- EDIT: `server/controllers/screeningController.js` (add `startSearch`/`getSearchJob`, reuse idempotency pattern)
- EDIT: `server/routes/screening.js` (~L119–120, add two routes)
- EDIT: `server/index.js` (~L335, add `startSearchWorker()` boot hook)
- REUSE unchanged: `server/services/screeningImportService.js` (`dedupeAndInsertRecords`, `DEFAULT_MAX_RECORDS_PER_PROJECT`), `server/realtime/bus.js` (`emitToProjectMembers`), `server/store.js` (`touchProjectActivity`).
