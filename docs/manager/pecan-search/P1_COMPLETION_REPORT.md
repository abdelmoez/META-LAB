# P1 — Pecan Search Engine: Completion Report

**Version:** v3.49.0 · **Flag:** `pecanSearch` (default **OFF**) · **Scope:** P1 only

This is the structured final report required by `p1.md` §31. Companion docs:
`ARCHITECTURE.md`, `PROVIDERS.md`, `OPERATIONS.md`, `USER_GUIDE.md`, and the ADRs in
`adr/`.

---

## A. Executive summary

A researcher can now, entirely inside PecanRev, take a Boolean strategy built in the
Search Builder and **execute it against up to seven open bibliographic providers**
(PubMed, Europe PMC, ClinicalTrials.gov, Crossref, DOAJ, OpenAlex, Semantic Scholar),
preview per-source hit counts, run the search as a **durable background job**, watch
honest per-source progress, and have results **normalized, deduplicated (with the
project's existing explainable engine), provenance-tracked, and auto-imported** into
the screening workflow with stable identity. The run produces auto-filled PRISMA
identification counts and a **PRISMA-S-oriented search report** (in-app / JSON / CSV /
print HTML). Manual RIS/BibTeX/NBIB import, screening, deduplication and PRISMA are
unchanged. Provider API keys never leave the server.

## B. Repository audit findings (reused, not rebuilt)

- **Landing pipeline:** `dedupeAndInsertRecords` (`server/services/screeningImportService.js`) — P1 lands `ScreenRecord` rows through it, so screening/conflicts/extraction/PRISMA consume them unchanged.
- **Dedup engine:** `scorePair` / `classifyPair` (`src/research-engine/screening/deduplication.js`) — reused verbatim; P1 only orchestrates blocking + outcomes.
- **Durable worker pattern:** `screeningImportWorker.js` (atomic claim, boot re-queue) — cloned for the search worker.
- **Realtime:** `emitToMetaLabProject` (`server/realtime/bus.js`) + `useRealtime` — new `search.run.progress` event type, additive.
- **Auth:** `resolveProjectAccess` / `requireAdmin` / `validateBody`. **Flags/Ops:** `SiteSetting featureFlags`, `defaultFeatureFlags()`, AdminConsole `FLAG_META`/`NAV_SECTIONS`. **HTTP etiquette:** `nlmClient`/`oaPdfResolver` throttle + TTL-cache + DI-fetch patterns. **Sequence:** `AppSequence`/`allocateNumber`.

## C. Architecture implemented

Separate engine under `server/pecanSearch/`: typed errors, secret redaction, config
loader (env secrets + admin policy), hardened DI HTTP client, per-provider throttle,
canonical query AST + per-provider translators, normalization, connector contract +
7 connectors + registry, dedup orchestration, streaming pipeline, run service, durable
worker, duplicate-review, PRISMA-S report, HTTP controller + routes, Ops admin
controller. Frontend `src/features/pecanSearch/` Search & Discovery workspace + a
flag-gated workspace tab. Ops Console "Search Providers" section. See `ARCHITECTURE.md`.

## D. Providers implemented

| Provider | Search | Count preview | Pagination | Credentials | Key limitation |
|---|---|---|---|---|---|
| PubMed | ✅ | exact | history (WebEnv) | optional `NCBI_API_KEY` | — |
| Europe PMC | ✅ | exact | cursorMark | none | no native MeSH field (best-effort + warned); abstracts may retain inline tags |
| ClinicalTrials.gov v2 | ✅ | exact | pageToken | none | registry, not field-Boolean — field tags approximated as free text (warned); no DOI/PMID/authors |
| Crossref | ✅ | exact | cursor=* | polite `mailto` | dismax ranking, not strict Boolean (warned) |
| DOAJ | ✅ | exact | page | none | OA-only corpus |
| OpenAlex | ✅ | exact | cursor=* | polite `mailto` | filter-AND vs in-filter-OR approximation (warned); abstract reconstructed from inverted index |
| Semantic Scholar | ✅ | estimate | token | optional `S2_API_KEY` | bulk total is an estimate; aggressive rate limits |

All seven are functional (target met; min-4 requirement exceeded). 102 connector
contract tests. Each verified against live API docs (review dates in file headers).

## E. Data model and migrations

5 additive models (`PecanSearchRun`, `PecanSearchSource`, `PecanSourceRecord`,
`PecanDedupDecision`, `PecanSearchJob`). Brand-new empty tables → `prisma db push`
applies with no `--accept-data-loss`. Composite `@@unique([runId,provider,
providerRecordId])` (source-record idempotency) and `@@unique([metaLabProjectId,
idempotencyKey])` (nullable key → no-key starts don't collide). Frequently-queried
identifiers (doi/pmid) are indexed columns, not JSON. Postgres mirror kept in lockstep
via `scripts/sync-postgres-schema.mjs`. No existing model/column was renamed or
dropped. **Rollback:** turn the flag OFF (endpoints 404, tab hidden); the additive
tables are inert.

## F. Query translation

Structured canonical AST (`query/ast.js`) → per-provider translators. No string
replacement. Every approximated/unsupported clause (field scope, truncation, MeSH,
Boolean nuance, reserved-character stripping) emits an explicit warning surfaced in the
UI translation inspector and the report — **no silent semantic weakening**. The exact
executed query string + a stable hash are stored per source. Per-source manual override
is supported (verbatim, length-capped, flagged).

## G. Ingestion and deduplication

Streaming page-by-page pipeline; one malformed record never kills a source. Source
records persisted idempotently (composite unique + DB-seeded seen-set + cursor → safe
re-fetch/resume). Dedup outcomes: `existing_match` / `exact_dup` / `fuzzy_dup`
(auto-merge, PROBABLE only) / `ambiguous` (POSSIBLE/RELATED/FAMILY → human review,
never auto-merged — precision-first, §16.5) / `new`. Provenance: every
`PecanSourceRecord` links to its landed `ScreenRecord`, back-filled from the shared
index so a record the landing function deduped away still links. Stable Ref IDs =
`ScreenRecord` ids (assigned transactionally by the existing import path). Ambiguous
review reuses the existing screening duplicate-group model.

## H. PRISMA and PRISMA-S

`recordsIdentified` = raw records retrieved (NOT deduped); `duplicatesRemoved` =
exact + auto-merged fuzzy; per-source `bySource` breakdown; counts are page-committed
so a retry/resume never double-counts. Report (`report.js`) renders the full per-source
PRISMA-S record (executed query, hash, override, warnings, filters, caps, preview vs
retrieved, dedup counts, connector/dedup versions, timestamps, state) as in-app JSON /
CSV (formula-injection guarded) / print HTML (fully escaped).

## I. Security

Every endpoint gated on flag + `resolveProjectAccess` (404 existence-hiding,
mutations require `canEdit`→403) + run-belongs-to-project cross-project guard. Ops
endpoints behind `requireAdmin`. Keys server-side only (query-param + header, both
redacted in logs). SSRF-closed (provider base URLs are fixed server config; `buildUrl`
encodes all params). Injection: Prisma params, CSV formula guard, HTML escaping,
log/URL redaction. Abuse: per-IP limiter, preview cache + per-(user,provider) throttle,
per-project active-run quota (`QUOTA_EXCEEDED`/429), max-response-size guard, circuit
breaker, query/override length caps. Idempotency is atomic (DB unique + P2002 catch).

## J. Performance

DI HTTP client with timeouts, exponential backoff+jitter, Retry-After, circuit breaker,
25 MB response cap. Streaming pipeline never buffers all records; chunked `createMany`;
identifier columns indexed; history/duplicates/runs paginated. Bounded fan-out
concurrency (default 3). Honest indeterminate progress (no fabricated %). Load behavior
documented in `OPERATIONS.md`; deterministic CI uses mock fetch (no live calls).

## K. Testing

162 deterministic tests for the engine: query AST, normalization, dedup, HTTP client
(retry/backoff/size/breaker), report (injection/escaping), PRISMA-S, **7 connector
contract suites**, the workspace tab, and **12 DB integration scenarios** (end-to-end
run, existing-record match, idempotent resume, partial success, cancel, retry, report,
plus idempotency-key dedup, active-run guard, quota, cancel-queued finalize,
retry-active no-op). Full repo CI gate green: **2187 passing**; production build green.

## L. Files changed

- **Schema:** `server/prisma/schema.prisma` (+ postgres mirror).
- **Backend:** `server/pecanSearch/**` (errors, redact, config, httpClient, throttle, normalize, query/ast, connectors/* ×7 + base/registry/urlUtil/pubmedXml, dedup, pipeline, runService, duplicates, report, controllers, worker), `server/routes/pecanSearch.js`, `server/routes/admin.js`, `server/controllers/{adminController,settingsController}.js`, `server/index.js`.
- **Frontend:** `src/features/pecanSearch/**`, `src/frontend/workspace/{projectHelpers.js,Workspace.jsx,tabs/protocolTabs.jsx}`, `src/frontend/pages/admin/{AdminConsole.jsx,adminApiClient.js}`, `src/frontend/stitch/pages/StitchOpsConsole.jsx`.
- **Tests:** `tests/unit/pecanSearch/**`, `tests/unit/pecanSearchTab.test.jsx`, `tests/integration/pecanSearch.integration.test.js`.
- **Docs:** `docs/manager/pecan-search/**`.

## M. Deployment instructions

1. `prisma db push` (additive) + `node scripts/sync-postgres-schema.mjs` for PG. 2. Set
optional env: `NCBI_API_KEY`, `S2_API_KEY`, `PECAN_SEARCH_CONTACT_EMAIL`, per-provider
`<PROVIDER>_API_BASE`/`_TIMEOUT_MS`. 3. The durable worker starts automatically
(`startPecanSearchWorker` boot hook). 4. Enable per Ops › Feature Flags `pecanSearch`;
tune Ops › Search Providers. 5. Roll out: dev → tests → admin-only → beta project → GA.
Keep the flag until validated. See `OPERATIONS.md` + `PROVIDERS.md`.

## N. Known limitations (honest)

- **Boolean NOT / nested groups** are not yet in the canonical model (the upstream Search Builder doesn't emit them, so nothing is silently dropped). Documented in `query/ast.js`; a follow-up (pairs with P11 AI search).
- **Provider field fidelity varies** (see §D): ClinicalTrials.gov and Crossref/OpenAlex approximate field/Boolean semantics — always surfaced as translation warnings, never silent.
- **Fuzzy-against-existing dedup is bounded** by a configurable ceiling (default 20k records) to cap memory; beyond it the standard post-import duplicate-detection pass still applies (documented backpressure). Auto-merge is conservative (exact + PROBABLE only) by design — precision over recall.
- **95% auto-merge precision target:** the reused engine's `classifyPair` is `verified:false` pending a labeled-set evaluation; P1 inherits its conservative thresholds and the existing `evaluateDuplicateLabels` harness. A formal labeled benchmark for the cross-source setting is a follow-up.
- **Single-process worker** (no Redis): correct for the current single-Node + SQLite/PG deployment; `claimedBy`/`leaseUntil` columns are present as multi-node scaffolding but multi-node leasing is not implemented.
- **Semantic Scholar count preview is an estimate** (corpus match), labeled as such in the UI. **Europe PMC abstracts** may retain inline section tags.
- **Search & Discovery is a legacy-design tool** (Stitch is admin-only; deep tools fall back to legacy). It reaches from Stitch via the established `?ui=legacy&tab=` hand-off; no Stitch-native page (consistent with PICO/screening/RoB/extraction).

## O. Scope confirmation

Only **P1** and its directly-required foundations (durable jobs, connector platform,
query translation, provenance, search-related Ops + flags + audit) were implemented.
**P2–P15 were NOT implemented:** no NMA, no manuscript/Word editor, no embedding
upgrades, no AI extraction, **no scheduler / recurring or living search**, no qualitative
tagging, no public dashboards, **no PDF/full-text retrieval**, **no LLM screening**, **no
AI Boolean-search generation**, no GRADE, no meta-regression, no AI RoB, no citation
mining. No fake buttons or "coming soon" workflows were added.
