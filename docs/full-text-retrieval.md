# Automated Full-Text Retrieval (68.md P9)

Automated OA full-text retrieval resolves identifiers on screening records to
**legally open-access PDFs** and attaches them to the existing screening PDF store,
with full provenance. It is behind the `fullTextRetrieval` feature flag
(default **OFF**). Only legal OA PDFs handed to us by an OA API are fetched; there
is **no paywall bypassing or scraping** (see `docs/full-text-privacy-and-licensing.md`).

Implementation:
- `server/fullText/providers.js` — the OA provider chain (see `docs/full-text-providers.md`)
- `server/fullText/fullTextService.js` — settings, coverage, download+attach
- `server/fullText/fullTextWorker.js` — durable retrieval worker
- `server/controllers/fullTextController.js` + `server/routes/fullText.js` — API (`/api/full-text`)
- `src/features/fullText/` — client: flag reader, API wrappers, and `FullTextPanel.jsx`
  (coverage header, retrieve job with live progress, per-record statuses + link-out/request
  workflow, bulk PDF upload with match results), lazily mounted at the top of the
  screening **Second Review** tab (`src/frontend/screening/tabs/SecondReviewTab.jsx`).

> **Implementation status.** Server engine, worker, API and the client panel are
> all implemented; the panel renders only when the `fullTextRetrieval` flag is on.

## Flow

For each in-scope record that has **no existing PDF attachment**:

1. **Resolve identifiers** — the worker loads the record's `doi`, `pmid`,
   `sourceDb`, and `rawData` (an NCT id is scanned out of `rawData`/`doi`/`url`).
2. **Provider chain** — run the configured providers **in order** until one returns
   `status: 'found'` **with a `pdfUrl`**. Every provider outcome (found / no_oa /
   not_found / failed) is persisted as a `FullTextCandidate` row — the retrieval
   audit trail.
3. **Candidates** — a "found" outcome carries a `pdfUrl` and/or a `landingUrl`,
   plus `oaStatus`, `license`, and `version` metadata the OA API supplied.
4. **Legal OA PDF download** — `downloadAndAttach` fetches the `pdfUrl`, enforces
   the size cap, and validates it is a **real PDF** (content-type check **and**
   `%PDF` magic bytes). A paywall HTML page or an error body is rejected and
   **nothing is stored**.
5. **Attach with provenance** — a valid PDF is saved via the shared
   `savePdf` path and a `ScreenPdfAttachment` row is created with
   `source: 'oa-auto'`, `oaStatus`, `sourceUrl` (the OA PDF URL), `resolvedDoi`,
   `matchedBy: 'oa-retrieval'`, `matchConfidence: 1`, and `retrievalAttemptedAt`.

Records that already have a PDF are counted as `alreadyHad` and skipped **without
any network call** — a human-attached PDF is never re-fetched or overwritten.

## Scopes

A retrieval job (`enqueueFullTextJob` / `POST /:pid/retrieve`) targets one of:

| Scope | Records |
|---|---|
| `included` (default) | records with `finalStatus === 'accepted'` |
| `selected` | the explicit `recordIds` array (intersected with the project; requires a non-empty array) |
| `missing` | every record with no `ScreenPdfAttachment` |

`recordIds` is capped at 2000 per job.

## Job architecture (durable 4-part worker)

`fullTextWorker.js` mirrors the screening-export worker's durable pattern:

- **`claimNext`** — atomically flips the oldest `queued` job to `running`
  (`updateMany` guarded on `status: 'queued'`, `attempts` incremented) so two
  workers never claim the same job.
- **`drain`** — claims + processes jobs one at a time until the queue is empty;
  reentrancy-guarded by a `draining` flag.
- **`kickFullTextWorker`** — non-blocking `setImmediate` trigger, called after
  enqueue; idempotent.
- **`recoverStuckFullTextJobs`** — boot recovery: a job left `running` past the
  15-minute heartbeat lease is re-queued under the shared retry cap
  (`server/utils/jobRetry.js`); a job whose retry budget is spent (poison pill) is
  permanently **failed**.

Politeness / safety: 300ms between records that hit the network
(`FULLTEXT_RECORD_DELAY_MS`), heartbeat/progress writes throttled to 750ms, and a
**cooperative cancel** check every 20 records (a job flipped to `cancelled`
mid-run stops cleanly). `enqueueFullTextJob` **reuses** an existing queued/running
job for the same project, so a double-click never spawns two runs.

## Coverage / statuses

`coverage(projectId)` returns honest counts for the status card:

| Field | Meaning |
|---|---|
| `totalRecords` | all records in the project |
| `included` | `finalStatus === 'accepted'` |
| `withPdf` | distinct records (any stage) with ≥1 PDF attachment |
| `includedWithPdf` / `includedMissing` | accepted records with / without a PDF |
| `candidatesFound` | records with ≥1 `FullTextCandidate` of status `found` |
| `requested` / `received` | open / fulfilled `FullTextRequest` rows |
| `noOa` | records whose every candidate is `no_oa`/`not_found` and none `found`, with no PDF |

Per-run job counts (`fullTextWorker`):

| Count | Meaning |
|---|---|
| `fetched` | a PDF was downloaded + attached this run |
| `alreadyHad` | the record already had a PDF (skipped, no network call) |
| `found` | a provider returned an OA hit (PDF or landing) — a superset overlay |
| `linkOut` | a landing/registry page was found but no downloadable PDF |
| `noOa` | no OA copy anywhere |
| `failed` | every provider errored for the record |

`fetched` / `linkOut` / `noOa` / `failed` are the mutually-exclusive per-record
buckets; `found` overlays them.

## Request (link-out) workflow

When a record has no downloadable OA PDF (a `linkOut` or `noOa` record), a
leader/importer can track a manual document request via
`POST /:pid/records/:rid/request { status, note }` (`upsertRequest`):
`status ∈ requested | received | none`. This is the "we've asked the author / ILL
for this paper" bookkeeping row (`FullTextRequest`), surfaced in coverage as
`requested` / `received`. It does not itself fetch anything.

## API surface

`/api/full-text/:pid/*` (`requireAuth`; flag-gated 404 when off; per-project
screening access via `getProjectAccess`). `:pid` is the **ScreenProject** id.
Triggering retrieval, upserting a request, and bulk upload additionally require
`isLeader || canImportRecords`:

| Method + path | Purpose |
|---|---|
| `GET /:pid/status` | coverage + settings-lite + last job + `canTrigger` |
| `POST /:pid/retrieve` | enqueue a retrieval job → `202` (reuses queued/running) |
| `GET /:pid/jobs/:jobId` | one job's status |
| `GET /:pid/records?filter=missing\|linkout\|all` | per-record retrieval state (capped 500) |
| `GET /:pid/records/:rid/candidates` | full candidate history for a record |
| `POST /:pid/records/:rid/request` | upsert the link-out / document-request row |
| `POST /:pid/bulk-upload` | multipart PDF upload → match → auto-attach high-confidence (see `docs/pdf-matching.md`) |

Provider internals never reach the client — handlers return only normalized
statuses/urls the OA APIs published (`shapeCandidate`).
