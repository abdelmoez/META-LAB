# Living Reviews (P6)

Feature flag: `livingReview` (default **OFF**). Automated re-runs additionally require the Pecan Search
engine (`pecanSearch` + `searchEngine` flags); manual snapshots and the dashboard work without them.
Global policy: Ops → Living Reviews (`livingReviewSettings` SiteSetting).

## What it does

A living review project can:

1. **Save searches** — each `LivingSavedSearch` stores the *exact* canonical query snapshot
   (`canonicalQuery` AST + human-readable `canonicalText`), the provider subset, cadence
   (manual/daily/weekly/monthly) and enabled state.
2. **Re-run on a schedule** — `server/living/scheduler.js` runs one unref'd interval loop (default
   5-minute tick, `LIVING_SCHEDULER_TICK_MS`): due searches launch Pecan Search runs through the existing
   durable worker (dedup, PRISMA-S accounting and crash-resume all reused). Scheduled runs are idempotent
   per period (`idempotencyKey = living:{searchId}:{nextRunAt}`) so restarts never double-run. The
   scheduler is triple-gated: flag + admin `schedulerEnabled` + `LIVING_SCHEDULER_ENABLED` env.
3. **Queue new records** — the Pecan pipeline already lands only-new records; the update queue
   (`GET /api/living/:mlpid/queue`) lists records from living runs with no reviewer decision, sorted by AI
   priority.
4. **Pre-score with the project model** — completed runs trigger the existing debounced rescore job, so
   new records carry current-model scores (marked as update-run predictions by run lineage).
5. **Notify** — in-app notifications to the owner + leaders: `LIVING_RUN_COMPLETED`, `LIVING_RUN_FAILED`,
   `EVIDENCE_SHIFT`.
6. **Snapshot** — every completed update (and any manual request) creates a `ReviewSnapshot`:
   summary-only JSON (PRISMA counts, screening counts, extraction counts, per-outcome meta-analysis
   results computed server-side with the canonical engine, AI model version, search provenance,
   app version). Snapshots are compared with `diffSnapshots` and retention-pruned
   (`snapshotRetention`, default 100).
7. **Alert on evidence shifts** — see `docs/evidence-shift-alerts.md`.

## PRISMA in living mode

Per-run PRISMA-S counts come from the existing Pecan run reports; the dashboard distinguishes the original
review from update runs and shows cumulative counts from live screening data. The manuscript engine's
`computePrismaCounts` reads live screening summaries, so manuscript PRISMA content reflects updates
automatically.

## API

`/api/living/:mlpid/…` — overview, preview, queue, searches CRUD + run, snapshots (list/get/compare/create),
alerts ack. View = project members; manage = owner/leader/`canManageExtraction`. All endpoints 404 when the
flag is off.

## Honest limitations

- MA snapshots pool by (outcome, timepoint, esType) with the random-effects default; project-specific
  method choices made in the Analysis tab are not replayed.
- The scheduler is single-process (matches the app's worker architecture); multi-node deploys would need a
  shared lease (the Pecan job model already reserves `claimedBy/leaseUntil`).
- Search sources that have no Pecan connector (e.g. Embase) remain manual by design.
