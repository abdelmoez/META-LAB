# SE2 — Increment 3d: scalability / chunked persistence (se2.md §12, part 1)

> Final slice of Increment 3. A focused, **honest** scalability step: bounded-batch score
> persistence + a higher configurable ceiling, without overclaiming untested scale (§12
> explicitly forbids claiming a scale that hasn't been tested). Additive; no schema change.

## What shipped
- **Chunked transactional persistence** (`runScoring`): the per-record score upserts now
  commit in **bounded `prisma.$transaction` batches** (`PERSIST_CHUNK = 500`) via a pure
  `chunk()` helper, instead of N sequential awaits. Fewer round-trips, a bounded write set,
  and scores become visible **progressively** as each chunk commits. Real-DB smoke: a
  638-record run persists all 638 rows (scored == persisted).
- **Pure helpers** (`src/research-engine/screening/ai/batch.js`): `chunk(arr, size)` and
  `progressFraction(done, total)` — small, deterministic, unit-tested (used for chunked
  persistence and available to the job layer for progress).
- **Configurable ceiling**: the per-run cap is already operator-configurable in Ops →
  Screening → AI Policy (`maxRecordsPerRun`, validated up to 100 000). Over-cap behaviour is
  already safe — Increment 2 made the stopping estimate treat dropped unscreened records as
  a hard precondition (no false "stop" on large reviews).

## Files
- **New:** `batch.js`, `tests/unit/screening/ai/batch.test.js` (4 tests).
- **Changed:** `index.js` (exports), `screeningAiService.js` (chunked persistence).

## Verified
- +4 pure unit tests; full suite **1706 green**; build green; real-DB smoke (638 scored ==
  638 persisted via the chunked transaction path).

## Honest scope & remaining §12 work
This increment improves the **write path** and removes the practical persistence bottleneck,
but it is deliberately **not** a claim of validated 100k-record scale. The remaining §12
items are documented as the next milestone, because they need an engine restructure +
real load testing that should not be asserted without measurement:

- **Streaming / chunked feature generation.** `trainAndScore` currently builds the TF-IDF
  vocabulary + vectors for all in-cap records **in memory**. True 50k–100k scale needs
  streaming/chunked feature generation so memory is bounded — the real ceiling lever.
- **Resumable background jobs**: checkpointing, retries, idempotent resume, dead-letter
  tracking, stale-job detection, per-project concurrency (the Increment 1 `ScreenAiJob` +
  the §11 `withRunLock` mutex are the foundation to build on).
- **Progressive initial-subset scoring** + visible coverage/progress in the UI.
- **Load testing** at 5k / 25k / 50k / 100k with measured import/feature/scoring/throughput
  numbers — only then should a supported scale be claimed.

The engine remains correct and safe at the currently-tested sizes; larger reviews work via
the configurable cap + chunked persistence, with the above as the honest path to validated
large-scale support.
