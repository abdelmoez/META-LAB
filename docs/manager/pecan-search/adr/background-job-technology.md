# ADR: Background-job technology — DB-backed single-process worker

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

A search run fetches many pages from several external providers and must survive the
browser closing the tab and a worker restart, be idempotent, cancellable, and retryable.
We need a durable background-job mechanism.

## Decision

Use an **in-process, DB-backed, single-process worker** — `PecanSearchJob` rows in the
main database, claimed and drained by `server/pecanSearch/pecanSearchWorker.js`. This is
the proven pattern already in the codebase (`screeningImportWorker.js` / `ScreenImportJob`).

- A job is claimed via an **atomic `queued→processing` flip** (`claimNext` →
  `updateMany` guarded on `status:'queued'`; `count !== 1` means another pass won the
  race).
- One job runs at a time; per-source concurrency is handled inside `processRun`.
- A **boot hook** (`startPecanSearchWorker`, wired in `server/index.js`) re-queues jobs
  left `processing` past the heartbeat lease (`STUCK_MS` = 10 min) and resumes from each
  source's persisted cursor.
- `heartbeatAt` distinguishes a healthy long job from a crashed one.
- `claimedBy` / `leaseUntil` columns exist for a future multi-node lease but are unused.

## Why not Redis / BullMQ / an external queue

- **Zero new infrastructure.** The current deployment is a single Node process with
  SQLite (Postgres-ready). Adding Redis would add an operational dependency, a failure
  mode, and a secret to manage — for no functional gain at current scale.
- **Durability already lives in the DB.** The run + its per-source cursors are the source
  of truth; a separate queue would duplicate that state and risk drift.
- **Consistency with the codebase.** The screening-import worker proves the pattern under
  real load; reusing it means one mental model, one set of operational runbooks.
- **Portability.** The atomic claim uses only `updateMany` with a `where` guard —
  identical on SQLite and Postgres. No DB-specific locking.

## Consequences

- Throughput is bounded to one job at a time on one node. Acceptable for P1; the lease
  columns leave a clean path to multi-node if needed.
- If the process is down, no jobs run — but they are durable and resume on next boot.
- Operators monitor the queue via Ops › Search Providers (`queue` counts + `stale`).

## References
`pecanSearchWorker.js`, `runService.processRun`, `schema.prisma` (`PecanSearchJob`),
`OPERATIONS.md` §1, §3.
