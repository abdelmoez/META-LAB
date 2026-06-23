# Pecan Search Engine — Architecture (P1)

The Pecan Search Engine ("P1") executes a Boolean literature-search strategy against
multiple bibliographic providers, normalizes and auto-imports the results into a
project's screening flow, deduplicates them with PecanRev's existing explainable
engine, preserves per-source provenance, and produces a PRISMA-S–oriented search
report. It is gated behind the `pecanSearch` feature flag (default **OFF** → all
endpoints 404) and is fully additive — every table is new, no existing table changes.

All code lives under `server/pecanSearch/` (engine) + `server/routes/pecanSearch.js`
(routes) + `server/pecanSearch/connectors/` (providers). The five Prisma models live
in `server/prisma/schema.prisma` (canonical SQLite) with derived Postgres copies.

---

## 1. System diagram

```
                              BROWSER (search workspace UI)
                                       │  HTTPS (JWT cookie)
                                       ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Express app  (server/index.js)                                            │
   │   app.use('/api/pecan-search', requireAuth, pecanSearchLimiter, router)    │
   └──────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
   server/routes/pecanSearch.js  ──►  pecanSearchController.js
        (route table)                  │  gate(): flag(404) + project access + canEdit(403)
                                       │  loadOwnedRun(): cross-project guard
        ┌──────────────────────────────┼───────────────────────────────────────┐
        ▼ (synchronous helpers)        ▼ (enqueue)              ▼ (read models)
   query/ast.js                  runService.startRun       runService.getRunSummary
   connectors[*].translateQuery   → PecanSearchRun           / listRuns / getReport
   connectors[*].previewCount     → PecanSearchSource[]      duplicates.listRunDuplicates
   (config.js, registry.js)       → PecanSearchJob (queued)  report.buildReport
                                       │
                                       │  kickPecanSearchWorker()  (setImmediate)
                                       ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  pecanSearchWorker.js   (in-process, DB-backed, single job at a time)       │
   │   claimNext(): atomic queued→processing flip   ─►  processRun(job)          │
   └──────────────────────────────────────────────────────────────────────────┘
                                       │  runService.processRun
                                       ▼
        seed dedup index ◄── ScreenRecord (project's current records)
        fan out sources (bounded concurrency = engine.concurrency)
                                       │
                                       ▼  pipeline.runSource (one per source)
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  per page:  connector.search ─► httpClient ─► PROVIDER (PubMed, EPMC, …)    │
   │             normalize ─► dedup.classify ─► dedupeAndInsertRecords (landing)  │
   │             persist PecanSourceRecord + PecanDedupDecision + cursor          │
   │             emit SSE  search.run.progress   (realtime/bus.js)                │
   └──────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
        ScreenRecord (landed) ─► existing screening / duplicates / PRISMA flow
```

Key boundary: the **controller and synchronous helpers never call a provider for a
long fetch**. `validate` / `translate` / `preview-count` make at most one short
external call (preview count); the actual multi-page retrieval only happens inside the
worker, off the request thread, so a search survives the browser closing the tab.

---

## 2. Connector interface

Every provider is a **connector** built by a factory and registered in
`connectors/registry.js → CONNECTOR_FACTORIES`. The frozen contract lives in
`server/pecanSearch/CONTRACT.md`; `connectors/base.js` documents it in code and
`connectors/pubmed.js` is the reference implementation.

```
createXConnector(providerConfig, deps) => Connector
  providerConfig : one entry of config.providers[id] (id,label,baseUrl,apiKey[secret],
                   timeoutMs,pageSize,maxCap,defaultCap,supportedFields,…)
  deps           : { http, now, sleep, logger, contact, retryLimit }
                   http = createHttpClient(...) — the ONLY thing that calls fetch
```

Return object (`connectors/base.js` header, `CONTRACT.md`):

| Method | Contract |
|--------|----------|
| `provider` | string id |
| `capabilities()` | `{ id, label, platform, requiresCredentials, configured, available, supportsCountPreview, maxResults, supportedFields }` |
| `translateQuery(canonical, { override })` | canonical AST → provider string + `TranslatedQuery` (`query`, `queryHash`, `supported[]`, `unsupported[]`, `warnings[]`, `assumptions[]`, `hasOverride`) via `ast.makeTranslated`. NEVER silently drops an unsupported field — it pushes a warning. A non-empty `override` is used verbatim. |
| `validateQuery(canonical)` | `{ ok, errors[], warnings[] }` (usually `ast.validateCanonical`) |
| `previewCount(translated, { signal })` | `{ count\|null, kind, at }` where `kind ∈ exact\|estimate\|unavailable\|unsupported`. Never throws. |
| `search(translated, cursor\|null, { signal, pageSize, capRemaining })` | one page: `{ records: RawItem[], nextCursor: string\|null, total: number\|null, rateLimit }`. `cursor` is an opaque JSON string the connector owns. Throws a typed `PecanError` on hard failure. |
| `normalize(rawItem)` | `NormalizedRecord` via `normalize.normalizeRecord(...)` + a stable `providerRecordId` + a small `raw` snapshot. |

Implemented connectors: `pubmed`, `europepmc`, `clinicaltrials`, `crossref`, `doaj`,
`openalex`, `semanticscholar`. A provider with no factory in `CONNECTOR_FACTORIES` is
reported `implemented: false` / not selectable (see `registry.isProviderImplemented`).

The shared HTTP client (`httpClient.js`) is the single egress point: per-request
timeout (AbortController), max-response-size guard (OOM protection), Retry-After +
exponential backoff with jitter, per-host circuit breaker, correlation ids, and secret
redaction. **No connector calls `fetch` directly.**

---

## 3. Search lifecycle (a run)

`runService.startRun(params)` (called by `postStartRun`):

1. **Idempotency** — if an `Idempotency-Key` header (or `body.idempotencyKey`) matches
   an existing run for this project, return that run (`created: false`); no duplicate run.
2. **Build engine** — `buildEngine()` → `createEngineContext(env, adminSettings)`
   resolves config + the shared HTTP client + connector instances.
3. **Normalize + validate** the canonical query (`ast.normalizeCanonical` /
   `validateCanonical`); invalid → `INVALID_QUERY` (400).
4. **Resolve sources** — drop unknown / unimplemented / disabled / unconfigured
   providers, each with a warning; at least one usable source is required.
5. **Resolve landing project** — find (or create) the linked `ScreenProject` so results
   always have a screening destination (`resolveLandingProject` →
   `createLinkedScreenProject`).
6. **Persist** a `PecanSearchRun` (`state: queued`, canonical snapshot, plain-text
   render, config, warnings) + one `PecanSearchSource` per provider (with the **exact
   translated query** and its hash stored) + a `PecanSearchJob` (`status: queued`).
7. **Kick the worker** (`kickPecanSearchWorker()`) and emit `search.run.progress`.

State machine (`PecanSearchRun.state`):

```
queued ──► running ──► completed        (all sources completed)
                  ├──► partial          (some succeeded, some failed/cap/cancel)
                  ├──► failed            (all sources failed, none partial)
                  └──► cancelled         (user cancel observed)
                  retry: partial/failed ──► queued (retryRun, resumes per-source cursor)
```

`deriveRunState(sources, cancelled)` computes the **honest** terminal state from
per-source outcomes — a single failing source never fails the whole run.

---

## 4. Job lifecycle (the worker)

`pecanSearchWorker.js` is an in-process, DB-backed, single-process worker modeled on
the proven `screeningImportWorker.js` pattern.

```
PecanSearchJob.status:  queued → processing → completed
                                            ├─► failed
                                            └─► cancelled
```

- **Claim** (`claimNext`): pick the oldest `queued` job, then an **atomic**
  `updateMany({ where: status:'queued' }, { status:'processing', … })`. If
  `claim.count !== 1` another worker pass won the race → try the next. (Safe even with a
  future multi-node lease: `claimedBy`/`leaseUntil` columns exist for that.)
- **Process** (`processRun`): re-load the run; skip if already terminal; honor a pending
  cancel; set `running`; seed the dedup index; fan out sources with bounded concurrency;
  aggregate counts; finalize. Heartbeats (`heartbeatAt`) are written on every page.
- **Resume / crash recovery** (`startPecanSearchWorker`, the boot hook in
  `server/index.js`): any job left `processing` with no heartbeat within `STUCK_MS`
  (10 min) is re-queued at boot, then the queue drains. `processRun` resumes each source
  from its persisted `cursor` / `lastCompletedPage` and never double-imports.
- **Kick** (`kickPecanSearchWorker`): `setImmediate(drain)`; idempotent and
  non-blocking; a single `draining` guard prevents overlapping drains.

---

## 5. Data model — the five Pecan* tables

All in `server/prisma/schema.prisma`. Every column is nullable or defaulted; every table
is new → `prisma db push` stays additive-safe (no `--accept-data-loss`).

| Table | Purpose | Key columns / constraints |
|-------|---------|---------------------------|
| **PecanSearchRun** | one search execution | `state`, `canonicalQuery` (AST JSON), `canonicalText`, `config`, `counts`, `warningSummary`, `errorSummary`, `idempotencyKey`, `screenProjectId`, `engineVersion`; `@@index([metaLabProjectId, createdAt])`, `@@index([state])`, `@@index([idempotencyKey])` |
| **PecanSearchSource** | per-provider execution state | `provider`, `generatedQuery`, `finalQuery` (exact executed), `queryHash`, `translationWarnings`, the per-source counts (`rawCount`, `normalizedCount`, `importedCount`, `existingMatchCount`, `exactDupCount`, `fuzzyDupCount`, `ambiguousDupCount`, `failedRecordCount`), `cursor`, `lastCompletedPage`, `cap`, `capReached`, `stage`, `state`, `errorClass`, `errorDetail`; `@@index([runId])`, `@@index([runId, provider])` |
| **PecanSourceRecord** | one retrieved record + full provenance | `providerRecordId`, `screenRecordId` (provenance link to the landed record), normalized bibliographic fields, `rawPayload` (safe snapshot), `normalized`, `dedupOutcome`; idempotency key `@@unique([runId, provider, providerRecordId])` |
| **PecanDedupDecision** | one dedup decision (auto / identity / human) | `score` (0–100), `scoreComponents`, `ruleVersion`, `matchType`, `decision` (`pending\|merged\|kept_separate\|deferred`), `decisionSource` (`automatic\|manual\|identity`), `reasons`, `conflicts`; `@@index([runId, decision])` |
| **PecanSearchJob** | durable background job | `status`, `stage`, `progress`, `attempts`, `heartbeatAt`, `claimedBy`/`leaseUntil` (future multi-node), `payload`, `error`; `@@index([status, createdAt])`, `@@index([runId])` |

Relations: `PecanSearchRun 1—* PecanSearchSource / PecanSourceRecord / PecanDedupDecision`
(all `onDelete: Cascade`). A landed record points back to `ScreenRecord` via
`screenRecordId` (string link, not an FK — provenance survives merges).

---

## 6. Deduplication lifecycle

P1 **reuses** PecanRev's existing explainable engine
(`src/research-engine/screening/deduplication.js` — `scorePair` / `classifyPair` /
`normalizeTitle` / `DUP_TYPES` / `DUP_MODEL_VERSION`). It is not reimplemented. The
P1 layer (`dedup.js`) only builds a fast index and maps verdicts to pipeline outcomes;
the policy is **precision-first** (a false merge can hide an eligible study).

```
processRun seeds: createDedupIndex(project's CURRENT ScreenRecords)
                    (DOI map, PMID map, normalized-title map, title-prefix blocks)
                                       │
per incoming normalized record  ──►  index.classify(record):
  1. DOI / PMID identity hit?  ──► existing_match (pre-existing) | exact_dup (in-run)
  2. exact normalized-title hit (no shared id)? ──► classifyPair → PROBABLE→fuzzy_dup
                                                     | POSSIBLE/RELATED/FAMILY→ambiguous
  3. fuzzy block candidates ──► classifyPair best ──► fuzzy_dup | ambiguous
  4. else ──► new
```

Outcome → action (`pipeline.runSource`):

| Outcome | Landed? | PecanDedupDecision | Notes |
|---------|---------|--------------------|-------|
| `new` | yes (new ScreenRecord) | none | net import |
| `existing_match` | no | none (identity) | provenance attaches to the existing record |
| `exact_dup` | no | `merged` / `identity` | duplicate within the run |
| `fuzzy_dup` | no | `merged` / `automatic` | PROBABLE + mergeable → auto-merge |
| `ambiguous` | **yes** (distinct record) | `pending` / `pending` | POSSIBLE/RELATED/FAMILY → human review |

Human review (`duplicates.js`): `listRunDuplicates` returns pending decisions with both
records + the explainable breakdown; `resolveRunDuplicate(action)` where
`action ∈ merge | keep_separate | defer`. A `merge` reuses the **existing screening
duplicate model** (`ScreenDuplicateGroup` + `ScreenRecord.isDuplicate/isPrimary/
duplicateGroupId`) so the existing Duplicates UI and PRISMA "duplicates removed" stay
consistent — dedup uncertainty never leaks into screening conflicts.

Scalability: exact matches are O(1) map lookups; fuzzy comparison is bounded to records
sharing a 12-char title-prefix block, with a configurable `fuzzyCeiling` (default 20000).
Beyond the ceiling, the standard post-import `detectDuplicatesInProject` pass still
catches fuzzy duplicates (documented backpressure).

---

## 7. Progress flow

```
worker page loop ─► pipeline.onPageProgress(patch)
                      ├─► PecanSearchJob.update({ heartbeatAt, stage:'fetching:<provider>' })
                      └─► emitRunEvent ─► realtime/bus.emitToMetaLabProject(
                                            metaLabProjectId, ownerId,
                                            { type:'search.run.progress', runId, state, stage, provider })
                                       └─► SSE to the project's subscribers
browser ─► useRealtime sees search.run.progress ─► re-fetch getRunSummary
           (per-source stage + live counts: rawCount, importedCount, …)
```

`PecanSearchSource.stage` carries the fine-grained phase
(`queued→validating→counting→fetching→normalizing→deduplicating→importing→…→completed`).
`PecanSearchJob.progress` is `0..100` or `-1` (indeterminate when the total is unknown).
Run-level and source-level states reconcile at finalize (`finalizeRun` →
`aggregateCounts`), so completion counts always match the persisted source rows.

---

## 8. PRISMA count flow

Every PRISMA figure derives from persisted source rows — never reconstructed
approximately (`report.js`).

```
PecanSearchSource[*] ─► aggregateCounts(sources)  (runService.js)
   rawRetrieved, normalized, imported, existingMatched,
   exactDup, fuzzyDup, ambiguousDup, failedRecords, perSource{…}
                                       │
                                       ▼  report.prismaCounts(counts)
   recordsIdentified  = rawRetrieved                 (total raw, NOT deduped)
   duplicatesRemoved  = exactDup + fuzzyDup          (exact + auto-merged fuzzy)
   existingMatched    = existingMatched              (already in project; not re-added)
   recordsToScreening = imported                     (net new into screening)
   ambiguousPending   = ambiguousDup                 (awaiting human review; informational)
   failedRecords      = failedRecords
   bySource           = perSource{ provider → {raw, imported, …} }
```

`buildReport(runId)` assembles the full PRISMA-S–oriented object (search name, run date,
initiator, canonical strategy text, engine + dedup method, per-source executed queries +
hashes + counts + warnings). Exporters: structured JSON, CSV (`reportToCsv`, with
spreadsheet formula-injection guarding), and a self-contained print-friendly HTML
(`reportToHtml`, all dynamic text HTML-escaped).

---

## 9. Security boundaries

| Boundary | Enforcement |
|----------|-------------|
| **Feature flag** | every handler calls `pecanSearchEnabled()` first → 404 when OFF (existence-hiding). |
| **Auth** | mounted behind `requireAuth` at `/api/pecan-search` (`server/index.js`). |
| **Project access** | `gate()` → `resolveProjectAccess(projectId, userId)`; no view access → 404 (existence-hiding); mutations require `canEdit` → 403. |
| **Cross-project enumeration** | `loadOwnedRun()` verifies the run/decision belongs to the path project before any read/write. |
| **Rate limiting** | dedicated `pecanSearchLimiter` at the mount (400/15 min in prod), tighter than the search-builder budget since previews fan out across providers. |
| **Secrets never leave the server** | API keys are read from ENV into `config.providers[id].apiKey`, returned to the browser only as a boolean (`publicProviderConfig` drops `apiKey`, exposes `configured`/`hasKey` only). |
| **Log/error redaction** | `redact.js` scrubs sensitive URL params (e.g. NCBI `api_key`, `mailto`), headers, and secret values; `errors.js` separates a user-safe surface (`userMessage`, `httpStatus`) from the diagnostic surface (never serialized to the browser); `sanitizeErrorDetail` caps + scrubs every stored `errorDetail`. |
| **Response-size guard** | `httpClient.readCapped` enforces `maxResponseBytes` (default 25 MB) → `RESPONSE_TOO_LARGE`, preventing a hostile/oversized provider response from OOM-ing the worker. |
| **Output escaping** | report HTML escapes all dynamic text; report CSV neutralizes `=,+,-,@` formula injection. |
| **Admin surface** | the Ops "Search Providers" controller (`adminController.js`) is mounted behind `requireAdmin`; it edits only the **non-secret** `searchProviderSettings` policy and never accepts or returns a key value; all writes are `logAdminAction`-audited. |

User-facing audit events: `PECAN_SEARCH_STARTED / CANCELLED / RETRIED` (via
`recordWorkflowAudit`); admin events: `PECAN_SEARCH_SETTINGS_UPDATED`,
`PECAN_SEARCH_JOB_REQUEUED`.

---

## See also

- `PROVIDERS.md` — per-provider config, keys, ENV vars, rate limits, disable.
- `OPERATIONS.md` — worker startup, queue monitoring, recovery, rollback, migration.
- `USER_GUIDE.md` — building a query through exporting the report.
- `adr/` — the eight architecture decision records.
- Source of truth: `server/pecanSearch/` + `server/pecanSearch/CONTRACT.md`.
