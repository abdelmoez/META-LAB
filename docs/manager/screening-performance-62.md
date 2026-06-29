# 62.md — Screening AI scoring + export: production-grade performance fix

**Problem (reported):** on large Screening projects, running **AI scoring** or **exporting** made the whole app/server slow or unusable, and deployed export sometimes returned **504**. Production-blocking.

## 1. Root cause — CPU-heavy work ran synchronously on the single Node event loop, inside HTTP requests

PecanRev runs **one Node process** serving HTTP. Node is single-threaded: while a synchronous CPU task runs, **no other request can be served**. Two request handlers did exactly that.

1. **AI scoring** — `POST /api/screening/projects/:pid/ai/run` did `await runScoring(...)` *inside the handler* (`screeningAiController.postAiRun`). `runScoring` calls the pure engine's `trainAndScore` + k-fold `crossValidate`, which are **monolithic synchronous** functions. For thousands of records this froze the entire server for the whole run (tens of seconds) and held the request open past the proxy timeout. (The decision-triggered auto-rescorer ran the same blocking call from an in-memory `setTimeout`, just decoupled from the click.)

2. **Export** — `GET /api/screening/projects/:pid/export` was worse: it ran **uncapped** per-record cross-validation (`computeExportCvScores → crossValidatePerRecord`, i.e. training *k* models over **every** record) synchronously in the request, **loaded all records + decisions into memory**, then **built the entire CSV/JSON as one string** before sending. Three compounding event-loop blockers, all holding the request open → **504** behind the proxy, plus an OOM risk on large datasets.

Amplifiers: no `@@index([projectId])` on `ScreenRecord`/`ScreenDecision` (full-table scans before the CPU even started), and no HTTP `server.requestTimeout` (a slow request hung until a silent upstream 504).

The engine itself is fine (already optimised, ~55s @ 10k for a full run). The bug was **integration**: heavy CPU on the request thread.

## 2. Fix — durable DB-backed jobs + true CPU isolation (worker_threads) + streaming export

Reuses the project's proven in-process, DB-backed durable-job pattern (`screeningImportWorker` + `server/utils/jobRetry.js`). **No Redis required.**

### AI scoring
- `postAiRun` now **enqueues** a `ScreenAiJob` and returns **202 `{ jobId }`** immediately (never blocks the request).
- New durable worker in `server/services/screeningAiJobs.js`: atomic `claimNext` (`queued→running`), `drain` via `setImmediate`, progress + heartbeat written to the row, crash recovery at boot (`recoverStuckAiJobs` — re-queue under a retry cap, permanently fail a poison pill), and `enqueueManualRun` which **de-dupes** an in-flight run (an impatient double-click can't start two). The decision-triggered rescorer now enqueues a coalesced durable job too (crash-safe).
- **CPU is moved off the event loop**: `trainAndScore` + `crossValidate` now run in a **worker_thread** via a small pool (`server/services/aiCompute.js` + `aiComputeWorker.js`). One long-lived worker bounds CPU to one heavy compute at a time, so a large project can't oversubscribe the box; the HTTP loop stays free. Output is byte-identical (deterministic engine, same inputs). Falls back to inline execution under Vitest / `AI_COMPUTE_INLINE=1` / if worker_threads are unavailable.

### Export
- `GET /export` keeps the **instant** one-click download for typical projects, but now **caps** the synchronous path (413 `{ useAsync:true }` above `EXPORT_SYNC_MAX`, default 5000) and runs CV off the event loop. CSV/JSON/RIS output is unchanged for small projects.
- New durable async export: `POST /export/start` → `ScreenExportJob` (202 `{ jobId }`); `screeningExportWorker` computes **capped** CV in the worker_thread and **streams** rows to a file page-by-page (bounded memory); `GET /export/jobs/:id` polls progress; `GET /export/jobs/:id/download` **re-checks permission** and streams the finished file. Crash recovery + a TTL reaper for old files.
- Shared render logic (`server/services/screeningExportService.js`) keeps **one CSV schema** for both paths. CV above the cap exports blank columns with a clear status (schema preserved).

### Frontend
- "Run AI scoring" enqueues, then polls `…/ai/job-status` and shows live progress (`Scoring… NN%`); the button stays disabled while a job is queued/running (no duplicate jobs); the user can keep working.
- Export tries the sync path; on **413** it transparently switches to the async job, shows "Preparing export… (NN%)", then downloads when ready. Meaningful errors instead of a raw 504.

### Deployment / runtime
- `server/index.js` now boots `startAiJobsWorker()` + `startExportWorker()` alongside the import/pecan workers, and sets `server.requestTimeout` / `headersTimeout` / `keepAliveTimeout` (env-tunable) as **defense-in-depth** (clean failure, not the fix).

## 3. Files changed / added

**Schema** (`server/prisma/schema.prisma`, additive/nullable — `prisma db push` safe; Postgres mirror regenerated via `scripts/sync-postgres-schema.mjs`):
- `ScreenAiJob` +durable fields (`attempts`, `processed`, `total`, `heartbeatAt`, `createdById/Name`) + `@@index([status, createdAt])`.
- **New** `ScreenExportJob` model.
- `@@index([projectId])` on `ScreenRecord` and `ScreenDecision`.

**New backend:** `server/services/aiCompute.js`, `server/services/aiComputeWorker.js`, `server/services/screeningExportService.js`, `server/services/screeningExportWorker.js`.

**Modified backend:** `server/controllers/screeningAiController.js` (202 enqueue), `server/services/screeningAiService.js` (pool + progress + yields), `server/services/screeningAiJobs.js` (durable worker), `server/controllers/screeningController.js` (export split: guard + sync + start/status/download), `server/routes/screening.js` (export job routes), `server/index.js` (boot + timeouts).

**Frontend:** `src/frontend/screening/ai/useScreeningAi.js`, `AiAssist.jsx`, `src/frontend/screening/tabs/ExportTab.jsx`, `src/frontend/screening/api-client/screeningApi.js`.

**Tests / tooling:** `tests/unit/screening/ai/aiCompute.test.js`, `tests/integration/screening-perf-jobs.test.js`, `scripts/load-test-screening-perf.mjs`.

## 4. Tests added
- **aiCompute parity** — the worker pool reproduces the engine's `trainAndScore` / `crossValidate` / `crossValidatePerRecord` output exactly.
- **Non-blocking regression** — a real worker_thread compute runs while a 20ms main-thread ticker keeps cadence (max gap < 300ms): proves scoring does not freeze the loop.
- **Durable jobs (DB-backed)** — `recoverStuckAiJobs` / `recoverStuckExportJobs` honour the retry cap (poison-pill → failed; under-cap → re-queue; fresh → untouched); `enqueueManualRun` / `enqueueExportJob` de-dupe in-flight jobs.
- **Export** — `streamExportToSink` renders CSV/JSON off a paged DB read with the canonical schema + filter; `computeExportCvScores` degrades safely (blank, never leaky) and respects the cap.

### Load test (run manually)
`node scripts/load-test-screening-perf.mjs [N]` — example at N=4000 (2000 labelled):

| Path | wall | max event-loop block |
|---|---|---|
| INLINE (old in-request) | 3747ms | **3747ms** (loop frozen the whole run) |
| WORKER (62.md fix) | 4637ms | **238ms** (~94% less) |

Export: 1.2MB CSV streamed with only ~2.9MB RSS growth (memory bounded to one page).

## 5. How to verify on the deployed server
1. Deploy runs `prisma db push` (Postgres) — additive, no data migration. Confirm boot logs show `[ai-worker]` and `[export-worker]` starting.
2. On a large project, click **Run AI scoring** → the call returns immediately with progress; open another tab and navigate — the app stays responsive; scoring completes and scores appear.
3. Export a large project → "Preparing export…" with progress, then a download; **no 504**; server memory stays flat.
4. `GET /api/screening/projects/:pid/export` on a >5000-record project returns **413** `{ useAsync:true }` (the client auto-switches).

## 6. Deployment notes / remaining risks
- **No new infra required** (single process, DB-backed queue, in-process workers). Export files live under `server/storage/exports/` (gitignored; same convention as PDFs) with a 24h TTL reaper — on an ephemeral filesystem they simply regenerate on demand.
- **Single node only** (matches current deploy). For multi-node, swap the in-memory debounce/`withRunLock` for a DB advisory lock or shared queue — the durable rows make that migration clean. A separate worker dyno is an optional future step, not needed to stop the 504.
- Set `REQUEST_TIMEOUT_MS` ≥ the reverse-proxy timeout; `EXPORT_SYNC_MAX` / `EXPORT_CV_MAX` tune the sync-vs-async threshold.
- The worker_thread serialises a project's records to/from the thread (~hundreds of ms one-time for very large N); this is the only residual main-thread cost and is far below the old multi-second freeze.

## 7. Rec-round hardening (adversarial review of the first commit)
- **CRITICAL — export is now creator-only.** An async export bakes in the *creator's* per-reviewer decision columns. `getExportJob` + `downloadExport` now require `job.createdById === req.user.id` (404 otherwise), and the worker no longer broadcasts the `export.completed` jobId to other members — so one reviewer's decisions/notes can never leak to another member who also has export permission.
- **Configurable export dir** — `SCREEN_EXPORT_DIR` env override (default `server/storage/exports`) lets a containerized/multi-instance deploy point at a shared persistent mount.
- **Bounded AI-job growth** — `cleanupOldAiJobs` prunes terminal `ScreenAiJob` rows older than `AI_JOB_RETENTION_HOURS` (default 30d) at boot (the rescorer appends a row per burst).
- **Frontend robustness** — the AI poller does a final score refresh if it hits its fallback cap; the export poll loop stops if the tab unmounts (no 12-min background polling); skipped rescores now log at debug level.
- Accepted-with-doc (low risk): single global compute worker serialises heavy compute (throughput ceiling, not a freeze); `drain()` relies on SQLite `busy_timeout` + Prisma pool timeouts; orphaned export files are reaped by the 24h TTL regardless of project deletion.
