# Pecan Search Engine — Operations (P1)

Operator runbook for the Pecan Search Engine: worker startup, queue monitoring,
failed-job recovery, provider outage handling, secret rotation, quota adjustment,
database migration, rollback, observability, and troubleshooting.

Audience: operators / admins. All file paths are repo-relative.

---

## 1. Worker startup

The search worker is **in-process and DB-backed** (`server/pecanSearch/pecanSearchWorker.js`)
— there is no separate process, no Redis, no external queue. It boots with the app.

- **Boot hook:** `server/index.js` (≈ L358) calls
  `startPecanSearchWorker().catch(err => console.error('[pecan-search-worker] start failed:', err.message))`
  inside the post-listen seed block (alongside `startImportWorker`).
- **What boot does** (`startPecanSearchWorker`):
  1. Re-queue any job left `processing` by a crash — i.e. `status:'processing'` with
     `heartbeatAt` null or older than `STUCK_MS` (10 minutes) → flipped back to `queued`.
     It logs `re-queued N stuck search job(s)`.
  2. `kickPecanSearchWorker()` → `setImmediate(drain)` to drain the queue off the request
     thread.
- **Per-enqueue kick:** `startRun` / `retryRun` / admin requeue all call
  `kickPecanSearchWorker()` after writing a `queued` job; it is idempotent and
  non-blocking (a single `draining` guard prevents overlapping drains).
- **No manual start is required.** If the app is running, the worker is running. A
  restart safely resumes everything (jobs survive worker restart; each source resumes
  from its persisted `cursor` / `lastCompletedPage` and never double-imports).

**Concurrency model:** one **job** is claimed at a time (atomic `queued→processing`
flip in `claimNext`); within a job, sources fan out with bounded concurrency
(`engine.concurrency`, default 3, admin-tunable 1–8). `claimedBy` / `leaseUntil` columns
exist on `PecanSearchJob` for a future multi-node lease but are unused single-node.

---

## 2. Queue monitoring — Ops › Search Providers

`GET /api/admin/search-providers` (`adminController.getSearchProviders`, `requireAdmin`)
is the single operational dashboard. It returns:

- `engine` — the resolved engine config (caps, concurrency, retries, timeouts).
- `defaults` — `ENGINE_DEFAULTS` for reference.
- `settings` — the raw editable `searchProviderSettings` policy (non-secret).
- `providers` — each provider's `enabled` / `configured` / `available` / `implemented`
  (**never a key value**).
- `queue` — live `PecanSearchJob` counts: `{ queued, processing, completed, failed,
  cancelled, stale }`. `stale` = jobs `processing` with no heartbeat within `STUCK_MS`
  (the crash signal).
- `runs` — `{ total, completed, partial, failed }` from `PecanSearchRun`.
- `recentFailedJobs` — last 10 failed jobs (`id`, `runId`, sanitized `error`,
  `attempts`).
- `recentFailedSources` — last 10 failed sources (`provider`, `errorClass`,
  sanitized `errorDetail`).

**What to watch:**
- `queue.stale > 0` → a worker crashed mid-job; it will be re-queued on the next boot (or
  requeue it manually — see §3).
- `queue.processing` stuck > 0 for a long time with a healthy app → check logs for a hung
  provider (the HTTP client times out per request, so a true hang is rare).
- rising `runs.partial` / `runs.failed` or repeated `recentFailedSources` for one
  provider → a provider outage or quota problem (see §4, §6).

---

## 3. Failed-job recovery / requeue

- **Automatic:** a crashed (`stale`) job is re-queued at the next app boot
  (`startPecanSearchWorker`) and resumes from each source's cursor.
- **Manual requeue (admin):** `POST /api/admin/search-providers/jobs/:jobId/requeue`
  (`adminController.requeueJob`). It accepts only `failed` or stuck `processing` jobs,
  flips the job to `queued` + clears its error, resets the run to `queued`
  (`cancelRequested:false`), kicks the worker, and audits `PECAN_SEARCH_JOB_REQUEUED`.
- **User-initiated retry (per run):** `POST …/runs/:runId/retry`
  (`runService.retryRun`) re-queues only the run's `failed` / `partial` sources (resuming
  from each cursor, bumping `retryCount`), creates a fresh job, and kicks the worker.
  Idempotent and safe — completed sources are skipped, so retry never double-imports.
- Requeue/retry is **always safe**: the per-source idempotency key
  `@@unique([runId, provider, providerRecordId])` plus a dedup index re-seeded from the
  project's current records guarantee no duplicate `PecanSourceRecord` and no
  double-landing.

---

## 4. Provider outage handling

The engine degrades gracefully — one sick provider never fails a whole run.

- **Per-request resilience (`httpClient.js`):** timeout via AbortController; Retry-After
  honored; exponential backoff + jitter on 429 / 5xx / timeout / network up to
  `retryLimit`; a **per-host circuit breaker** opens after 5 consecutive failures and
  fails fast for a 30 s cooldown, shedding load from a sick host.
- **Per-source outcome:** a transient failure → the source is `partial` (retryable);
  a hard failure → `failed`. The run becomes `partial` if any source succeeded
  (`deriveRunState`). The honest partial result is reported, not hidden.
- **Operator response to a sustained outage:**
  1. Confirm in `recentFailedSources` which provider + `errorClass`
     (`PROVIDER_UNAVAILABLE` / `PROVIDER_TIMEOUT` / `PROVIDER_RATE_LIMITED`).
  2. Optionally **disable** the provider (Ops › Search Providers → `enabled:false`) so new
     runs skip it cleanly while it recovers.
  3. When it recovers, re-enable and let users **retry** the affected runs (per-source
     retry resumes from the cursor).
- **Persistent rate-limiting (429):** raise the per-provider spacing indirectly by
  lowering `concurrency`, and/or add a key (PubMed `NCBI_API_KEY`, S2 `S2_API_KEY`), and
  ensure `PECAN_SEARCH_CONTACT_EMAIL` is set (Crossref/OpenAlex polite pool).

---

## 5. Secret rotation

Secrets are **environment-only** (`NCBI_API_KEY`, `S2_API_KEY`, and the contact identity
`PECAN_SEARCH_CONTACT_EMAIL` / `PECAN_SEARCH_TOOL`). They are never stored in the DB,
never in a `SiteSetting`, never returned to the browser, and redacted from logs
(`redact.js`).

To rotate a provider key:
1. Obtain the new key from the provider (NCBI / Semantic Scholar).
2. Update the environment variable on the host (e.g. the systemd unit / `.env` /
   secrets manager) — replace `NCBI_API_KEY` or `S2_API_KEY`.
3. **Restart the app.** Config is read from `process.env` when the engine context is
   built (`buildEngine` → `createEngineContext`); a restart picks up the new value.
4. Verify in Ops › Search Providers that the provider still shows `configured:true`, then
   run a count preview to confirm a live round-trip.
- There is no key to revoke in the DB — removing the env var (and restarting) fully
  de-configures the provider; it falls back to key-less behavior where the provider
  supports it (PubMed/S2 still work key-less, just at the lower rate limit).

---

## 6. Quota / cap adjustment

All non-secret tuning lives in `searchProviderSettings` (Ops › Search Providers,
`adminController.updateSearchProviders`, validated + bounded server-side, audited
`PECAN_SEARCH_SETTINGS_UPDATED`):

| Knob | Meaning | Bounds |
|------|---------|--------|
| `defaultResultCap` | per-source default cap if the user sets none | 1–50000 |
| `maxResultCap` | hard per-source ceiling a user cannot exceed | 1–50000 |
| `concurrency` | simultaneous provider fetches within one run | 1–8 |
| `retryLimit` | transient-error retries per request | 0–10 |
| `requestTimeoutMs` | engine default per external request | 1000–120000 |
| `previewThrottleMs` | min spacing between count-preview calls | 0–60000 |
| `pageDelayMs` | optional extra spacing between page fetches | 0–10000 |
| `institutionalMode` | only explicitly-enabled providers run | boolean |
| per-provider `defaultCap` / `maxCap` / `timeoutMs` / `enabled` | override per provider | clamped to engine caps |

Each provider is additionally bounded by its registry `maxResults` (the documented
provider ceiling) — `maxCap` is `min(policy, registry.maxResults, engine.maxResultCap)`.
Lower `concurrency` and raise `pageDelayMs`/`previewThrottleMs` to be gentler on a
rate-limiting provider; raise caps for exhaustive systematic-review runs.

---

## 7. Database migration

P1 adds **five new tables** (`PecanSearchRun`, `PecanSearchSource`, `PecanSourceRecord`,
`PecanDedupDecision`, `PecanSearchJob`) and **no changes to existing tables** — every
column is nullable or defaulted, so the migration is additive-safe.

**SQLite (current deployment) — the convention is `prisma db push`, NOT `prisma migrate`**
(there is no `prisma/migrations/` directory; the schema is written additive-safe so
`db push` never needs `--accept-data-loss`):

```bash
cd server
npx prisma db push            # applies schema.prisma additively; creates the 5 new tables
npx prisma generate           # regenerate the client (if schema types changed)
# restart the app → startPecanSearchWorker drains any queued jobs
```

**Postgres (migration target).** The canonical models are SQLite; the Postgres schema is
mechanically derived so the two never drift (`server/scripts/sync-postgres-schema.mjs`).
Operator steps (from `server/`, scripts in `server/package.json`):

```bash
npm run db:sync-postgres-schema   # regenerate prisma/postgres/schema.prisma from canonical
npm run db:generate:postgres      # sync + prisma generate (main + waitlist PG clients)
npm run db:push:postgres          # prisma db push against POSTGRES_DATABASE_URL (additive)
npm run db:verify:postgres        # verify-migration.mjs
```

A drift test asserts the generated Postgres files are in sync, so CI fails if the
canonical schema changes without re-running the sync. The five Pecan models use only
portable column types and constraints, so they are identical across SQLite and Postgres.

No backfill is needed — the tables start empty; runs populate them.

---

## 8. Rollback

P1 is built to roll back cleanly with **no data loss**:

1. **Disable the feature** — turn the `pecanSearch` flag OFF (Ops › Feature Flags). Every
   `/api/pecan-search/*` endpoint immediately 404s (`pecanSearchEnabled()` is checked
   first in every handler and in `startRun`), the UI gates off, and the worker simply has
   no new jobs to drain. Existing landed `ScreenRecord`s stay in screening exactly as
   before (they are normal screening records).
2. **Drain in flight (optional)** — let any `processing` job finish, or cancel runs
   (`POST …/runs/:runId/cancel`, durable cancel observed between pages).
3. **Tables are additive** — leaving the five Pecan tables in place is harmless; they are
   never read while the flag is OFF. There is no destructive down-migration to run.
4. **Code rollback** — reverting the P1 commit removes the routes/worker; because all
   tables are additive and unreferenced by existing features, the rest of the app is
   unaffected. (If the worker boot hook is reverted, no search jobs run.)

---

## 9. Observability

- **Structured logs (sanitized):**
  - `[pecan-search-worker]` — boot requeue count, drain errors, per-job failures.
  - `[pecan-http]` — retry warnings with provider, **redacted** URL, code, attempt,
    correlation id (`cid`). Secrets and raw bodies are never logged (`redact.js`).
  - `[pecan-search] <where>:` and `[pecan-search-admin] <where>:` — controller errors
    (message only; 500s return a generic body).
- **Correlation ids:** every logical HTTP request gets a `cid` (`pq_…`) propagated into
  logs, so a single provider call can be traced across retries.
- **Realtime progress:** `search.run.progress` SSE events
  (`realtime/bus.emitToMetaLabProject`) carry `{ runId, state, stage, provider }` for live
  UI; heartbeats (`PecanSearchJob.heartbeatAt`) are written every page.
- **Durable state = the observability store:** `PecanSearchRun.counts` (aggregate),
  per-`PecanSearchSource` counts + `errorClass`/`errorDetail`, `PecanSearchJob.attempts`
  /`error`, and `PecanDedupDecision` rows are all queryable. The admin endpoint surfaces
  the operationally important slices.
- **Circuit-breaker state:** `httpClient.breakerState()` exposes per-host
  `{ failures, open }` for diagnostics.
- **Audit trail:** user actions (`PECAN_SEARCH_STARTED / CANCELLED / RETRIED`) via
  `recordWorkflowAudit`; admin actions (`PECAN_SEARCH_SETTINGS_UPDATED`,
  `PECAN_SEARCH_JOB_REQUEUED`) via `logAdminAction`.

---

## 10. Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| All P1 endpoints 404 | `pecanSearch` flag OFF | Enable it in Ops › Feature Flags. |
| A provider is greyed-out / not selectable | `enabled:false`, not `configured`, or no connector (`implemented:false`) | Check Ops › Search Providers; enable it / set the key env var + restart. |
| Count preview returns `null` (`unavailable`) | live provider call failed (network, quota, disabled, circuit open) | Check `recentFailedSources` + logs; retry; the circuit breaker clears after 30 s. |
| Run stuck in `queued` | worker not draining | Confirm the app booted past the seed block; check `[pecan-search-worker]` logs; a manual `kick` happens on the next enqueue, or restart. |
| Job `processing` forever / `queue.stale > 0` | worker crashed mid-job | Restart (boot re-queues stale jobs) or `…/jobs/:jobId/requeue`. Resumes from cursor. |
| Run finished `partial` | one or more sources failed/capped/cancelled | Open the report → per-source `errorClass`/`errorDetail`; retry the run (resumes failed sources). |
| Repeated `PROVIDER_RATE_LIMITED` | hitting the provider's rate limit | Lower `concurrency`, raise `pageDelayMs`, add the optional key, set `PECAN_SEARCH_CONTACT_EMAIL`. |
| `RESPONSE_TOO_LARGE` | provider returned more than `maxResponseBytes` (25 MB) | Narrow the query / lower the per-source cap; this is a hard, non-retryable guard. |
| Fewer "to screening" than "identified" | dedup removed exact/fuzzy dups + existing matches | Expected — see the PRISMA counts in the report; ambiguous pairs await review. |
| Counts don't add up in the UI | stale client | Counts reconcile from persisted source rows at finalize; re-fetch `getRunSummary` / the report. |

---

## See also
- `PROVIDERS.md` — per-provider keys, ENV vars, disable.
- `ARCHITECTURE.md` §4 (job lifecycle), §9 (security boundaries).
- `adr/background-job-technology.md`, `adr/raw-payload-retention.md`.
- Source: `server/pecanSearch/pecanSearchWorker.js`, `adminController.js`,
  `server/scripts/sync-postgres-schema.mjs`.
