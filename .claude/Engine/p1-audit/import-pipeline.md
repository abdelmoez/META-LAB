# P1 Audit — Import Pipeline (RIS/BibTeX/NBIB → screening records)

Audit date: 2026-06-22. READ-ONLY. Scope: where parsed reference records become
screening records, dedup-on-import, and PRISMA "records identified". Identifies
the seam where P1 (Pecan Search Engine) normalized records join the SAME landing
path so screening works unchanged.

---

## 0. TL;DR — the seam P1 must target

There are TWO import worlds in this repo. P1 MUST target the **screening
(META·SIFT) world**, NOT the monolith/Project.data world.

**The single canonical landing function P1 should call:**

```
dedupeAndInsertRecords(projectId, records, opts)
  → server/services/screeningImportService.js:69
```

It dedupes (against existing project records + intra-batch), enforces the
per-project cap, creates a `ScreenImportBatch` provenance row, and bulk-inserts
`ScreenRecord` rows. Both the sync endpoint and the async worker already funnel
through it. If P1 produces canonical parsed records and calls this with a
`sourceDb`/`parser` label, screening, dedup, and PRISMA counts all work with
ZERO changes downstream.

---

## 1. Two parallel import worlds (do not confuse them)

### World A — Monolith / Project.data blob (META·LAB workspace) — NOT the P1 target
- Pure parsers: `src/research-engine/import-export/referenceParsers.js`
  (older copy) and `src/research-engine/import-export/parsers.js` (canonical,
  richer copy). The monolith UI uses `referenceParsers.js`.
- Records live inside the `Project.data` JSON blob (`records: [...]`), saved via
  autosave. Record shape = `mkRecord()` (see §3).
- Server import endpoint for this world: `server/routes/importExport.js` +
  `server/controllers/importExportController.js`, validated by
  `importReferencesSchema` (`server/schemas/requestSchemas.js:29` —
  `{ text, projectId }`). This writes into the blob, NOT into `ScreenRecord`.
- Frontend: `src/frontend/workspace/tabs/screeningTabs.jsx:13,40` imports
  `parseReferences`/`dedupeRecords` from `referenceParsers.js` and parses
  client-side.
- **P1 should ignore this path** unless it also wants legacy-blob behavior.

### World B — Screening (META·SIFT) DB-backed — THE P1 TARGET
- Real DB tables (`ScreenRecord`, `ScreenImportBatch`, `ScreenImportJob`).
- This is what the screening UI (Title&Abstract, decisions, duplicates,
  conflicts, PRISMA, extraction handoff) actually reads.
- Server-side parse + dedup + insert. This is the path documented below.

---

## 2. World B request/route surface (the public seam)

`server/routes/screening.js`:
```
L118  r.post('/projects/:pid/import',            S.importRecords)  // sync, small files
L119  r.post('/projects/:pid/import/start',      S.startImport)    // durable async job (prompt50 WS2)
L120  r.get ('/projects/:pid/import/jobs/:jobId', S.getImportJob)  // poll progress
L121  r.get ('/projects/:pid/export',            S.exportRecords)
```
NOTE: these routes have NO Zod middleware — validation is inline in the
controller (content presence, fingerprint, size caps). `importReferencesSchema`
does NOT apply here (it belongs to World A).

Controller: `server/controllers/screeningController.js`
- `importRecords(req,res)` — **L926**
- `startImport(req,res)` — **L1008** (creates `ScreenImportJob`, L1058; `kickImportWorker()` L1071; returns 202 `{jobId}`)
- `getImportJob(req,res)` — **L1080**

### Request body (sync `POST /api/screening/:pid/import`)
```json
{ "format": "ris|pubmed|nbib|csv|...|auto", "content": "<full file text>",
  "filename": "optional.ris", "force": false }
```
Contract: `server/docs/screening-api-contract.md:179-231` (Import section).
Response 200: `{ imported, skippedDuplicates, rejected, total, batchId, format }`.

### `importRecords` flow (L926–1006)
1. `getProjectAccess(pid, user)` → 404 outsider / 403 if not
   (`isOwner || (active && (isLeader || perms.canImportRecords))`) (L932-935).
2. `getMetaSiftSettings()` → 403 if `!allowImport` (admin kill switch) (L938-939).
3. **File fingerprint**: `sha256` over CRLF→LF-normalized `content`, computed
   SERVER-side (`createHash`, L949). If a prior `ScreenImportBatch` with same
   `fileHash` exists in this project and `force !== true` → **409
   duplicate_import** (L950-964). `force:true` overrides file-level block but
   record-level dedup still applies.
4. **Parse**: `parseImportContent(content, { format, filename })` (L969).
5. Empty → 400; `records.length > MAX_RECORDS_PER_IMPORT` (200000) → 413.
6. `maxRecords` = `settings.maxRecordsPerProject` or default 100000.
7. **`dedupeAndInsertRecords(p.id, records, {...})`** (L980) — the landing call.
   `code:'CAPACITY'` → 400.
8. `touchProjectActivity(p.linkedMetaLabProjectId)` if imported>0 (L992).

---

## 3. Canonical parsed-record shape

### `mkRecord(r)` — the canonical parser output
Two near-identical copies (verbatim from monolith). P1 should match this shape:

- `src/research-engine/import-export/parsers.js:47` (CANONICAL, used server-side):
  ```js
  { id, title, authors, year, journal, doi, pmid, abstract, source,
    decision:"", reviewer2:"", notes:"", dupOf:null }
  ```
  DOI URL prefix stripped; `id = uid()`.
- `src/research-engine/import-export/referenceParsers.js:14` — same fields (older
  copy used by the monolith UI). NOTE the two `mkRecord` copies differ subtly;
  do not dedupe them blindly (project trap noted in MEMORY).

Extra optional fields some parsers attach (parsers.js): `url`, `keywords`
(CSV/CIW/TXT via `rowToRecord` L307, `parseCIW` L387).

`authors` is a single `"A; B; C"` string (joined with `"; "`).

### Field mapping into `ScreenRecord` (the insert)
`dedupeAndInsertRecords` (screeningImportService.js:129-142) maps canonical →
DB columns, with length caps:
```
title    ≤1000   authors  "; "-joined ≤500   year (string)   journal/source ≤300
doi ≤200   pmid ≤50   abstract ≤5000   keywords "; "-joined
sourceDb = r.sourceDb || r.source || format   (≤100)
rawData  = JSON.stringify(r) ≤2000   importBatchId = batch.id
```
So P1 can set **`sourceDb`** (e.g. "PubMed", "Embase", "Pecan") directly, or it
falls back to the parser/format label. This is the provenance hook.

---

## 4. The parser registry (server-side parse entry)

`parseImportContent(content, {format, filename})`
  → `server/services/screeningImportService.js:44`
  → calls `parseByFormat(text, format, filename)`
  → `src/research-engine/import-export/parsers.js:533`

`parseByFormat` logic (parsers.js:533-542):
- If `format` is an explicit key in `PARSER_REGISTRY` and yields >0 records → use it.
- Else fall back to `detectAndParse` (content/extension auto-detect, L459).
- Always BOM-tolerant (`stripBom`, L21).

`PARSER_REGISTRY` (parsers.js:494-510) keys:
`ris, bibtex, nbib, medline, pubmed, endnote, xml, ciw, wos, scopus, embase,
cochrane, csv, tsv, txt`. Each `{ label, parse(text) }`.

`SUPPORTED_IMPORT_FORMATS` (parsers.js:514-524) is the UI-facing list with
extensions (auto, ris, nbib, ciw, bibtex, endnote, csv, tsv, txt).

Individual parsers (all PURE, text→records[]):
`parseRIS` L72, `parseNBIB` L121, `parseBibTeX` L160, `parseEndNoteXML` L206
(needs DOMParser — browser/jsdom only), `parseCSV` L343, `parseTXT` L364,
`parseCIW` L387. Auto-detect: `detectAndParse` L459 / `detectFormat` L545.

**P1 reuse decision:** if Pecan fetches structured JSON from DB APIs (PubMed
eutils, Crossref, etc.), P1 does NOT need to round-trip through RIS/NBIB text.
P1 can build canonical `mkRecord`-shaped objects directly and call
`dedupeAndInsertRecords` with `format:'pecan'` / a real `sourceDb`, skipping
`parseImportContent` entirely. Reuse `mkRecord` (parsers.js:47) and `normTitle`
(parsers.js:35) to stay byte-identical with the dedup keys.

---

## 5. Dedup on import — YES, two layers

### Layer 1 (always, on import) — `dedupeAndInsertRecords`
`server/services/screeningImportService.js:69-156`. Exact-identity dedup:
- Loads existing project identity columns only: `screenRecord.findMany({ where:{projectId}, select:{doi,pmid,title} })` (L79-82) → indexed, O(n) memory.
- `keysOf(r)` (L50): `doi.toLowerCase()`, `pmid.trim()`, `normTitle(title)`.
- For each incoming record (L94-105):
  - rejected if no title AND no doi AND no pmid (`truthyId`, L36) → `rejected++`.
  - skipped if doi OR pmid OR normTitle already seen (existing OR earlier in
    batch) → `skippedDuplicates++`.
  - else kept + keys added to seen-sets (intra-batch dedup).
- Cap check: `existing.length + kept.length > cap` → throws `{code:'CAPACITY'}` (L108).
- Bulk insert via `createMany` in `INSERT_CHUNK=400` chunks (L25, L126-149).
- Returns `{ imported, skippedDuplicates, rejected, batchId, total, keptCount }`.
- IMPORTANT: this is EXACT-MATCH dedup (lowercased DOI, exact PMID, normalized
  title). It does NOT set `isDuplicate`/`duplicateGroup` — survivors are simply
  inserted; near-duplicate skips are dropped (not stored).

### Layer 2 (on demand, post-import) — fuzzy duplicate detection
`POST /api/screening/:pid/duplicates/detect` →
`detectDuplicatesInProject` in `server/services/screeningDuplicateService.js`
(imported at screeningController.js:6). Uses
`src/research-engine/screening/deduplication.js` (`scorePair`, `normalizeTitle`,
`classifyPair`, `DUP_TYPES`, imported at L21). Normalized title similarity
≥0.92. THIS is what sets `isDuplicate=true` + `ScreenDuplicateGroup` rows, and
THIS feeds the PRISMA `duplicatesRemoved` count (§6).

**For P1:** records that arrive via `dedupeAndInsertRecords` are auto-protected
from exact re-import dupes; cross-source near-dupes (same paper from PubMed +
Embase with different title casing/DOI variant) still rely on Layer 2's manual
"Detect duplicates" run, exactly like a file import does. P1 inherits this for
free — no special handling needed.

The pure record-list dedup `dedupeRecords(existing, incoming)` (parsers.js:561
and referenceParsers.js:133) is the World-A monolith helper (tags `dupOf`); NOT
used by the screening DB path.

---

## 6. PRISMA "records identified" — how it's computed

There is NO per-import increment of a stored counter. PRISMA numbers are derived
LIVE from `ScreenRecord` rows at read time.

`getMetaLabSummary(req,res)` — `server/controllers/screeningController.js:1760`
(endpoint `GET /api/screening/metalab/:mlpid/summary`), L1779-1823:
```
total              = records.length                         // = PRISMA "identified"
duplicatesRemoved  = records.filter(isDuplicate).length     // set by Layer-2 detection
screened           = total - duplicatesRemoved
fullTextAssessed   = records where currentStage==='full_text'
excludedTitleAbstract = screened - fullTextAssessed
fullTextExcluded   = records where finalStatus==='rejected'
included           = records where finalStatus==='accepted'
```
Returned as:
```
prisma: { identified, duplicatesRemoved, screened, excludedTitleAbstract,
          fullTextAssessed, fullTextExcluded, included }    // L1823
```

`getStats` (screeningController.js:1717) is the lighter per-reviewer stats
endpoint (`GET /:pid/stats`, contract L470-490): `{ total, screened, included,
excluded, maybe, undecided, conflicts, duplicates, progress }` — `total` =
record count, `duplicates` = isDuplicate count.

**Consequence for P1:** "records identified" automatically increases the moment
P1's records land in `ScreenRecord` via `dedupeAndInsertRecords`. No counter to
bump. PRISMA-S "records identified per database" would need `sourceDb` grouping —
the data is ALREADY captured per row (`ScreenRecord.sourceDb`) and per batch
(`ScreenImportBatch.format/parser/filename`), but no endpoint currently groups
by `sourceDb`. That grouping query is the one NEW read P1/PRISMA-S may want.

---

## 7. Async/durable path (large imports) — already built

`POST /api/screening/:pid/import/start` → `startImport` (controller L1008-1077):
- Same access + fingerprint + force gating; idempotent by `(projectId,
  fileHash)`: in-flight job reused (202, `alreadyRunning`), completed → 409.
- Creates `ScreenImportJob` (content persisted in row), returns `202 {jobId}`,
  calls `kickImportWorker()`.

Worker: `server/services/screeningImportWorker.js`
- `claimNext()` L47 — atomic `queued → processing` flip (no double-process).
- `processJob(job)` L63 — `parseImportContent` → `dedupeAndInsertRecords` with
  `onProgress` writing `processedRecords/importedRecords` back to the row.
- `kickImportWorker()` L126 (`setImmediate` drain), `startImportWorker()` L134
  (boot hook; re-queues `processing` jobs older than `STUCK_MS`=10min).
- Emits `import.completed` SSE poke (L100) via `emitToProjectMembers`.

**For P1:** if a single Pecan search yields a large result set, P1 can either (a)
call `dedupeAndInsertRecords` directly in its own job, or (b) enqueue a
`ScreenImportJob` (but that table's `content` is raw text — P1's JSON would need
a registry parser, OR P1 runs its own async + calls the service directly, which
is cleaner).

---

## 8. Data model (server/prisma/schema.prisma; postgres mirror at /prisma/postgres/)

### `ScreenRecord` — L484-528
Key columns: `id, projectId, importBatchId?, duplicateGroupId?, isPrimary,
isDuplicate, title, authors, year, journal, doi, pmid, abstract, keywords,
sourceDb, rawData, currentStage('title_abstract'|'full_text'), finalStatus(''|
accepted|rejected), promotedAt, promotedVia, acceptedAt, handoffStatus/At/StudyId
/Error (META·LAB extraction handoff), revertedExtractionSnapshot, createdAt,
updatedAt`. Relations: decisions, conflicts, pdfAttachments, openStates.

### `ScreenImportBatch` — L613-631 (PROVENANCE row)
`id, projectId, filename, format, recordCount, fileHash?, fileSize?,
importedById?, importedByName, parser, createdAt`. `@@index([projectId,
fileHash])`. Every import (sync or async) creates exactly one batch; every
inserted record points to it via `importBatchId`. **This is the provenance
anchor P1 should reuse** (set `filename`="Pecan search: <query>",
`parser`="pecan", `format`="pecan").

### `ScreenImportJob` — L640-674
Durable async job (status/stage/content/progress counters/fileHash/batchId).
`@@index` on `(projectId,status)`, `(status,createdAt)`, `(projectId,fileHash)`.

All import additions are nullable/defaulted → `prisma db push` stays additive.

---

## 9. Frontend seam (UI integration point)

- Screening import UI lives in the screening workspace (not the monolith). The
  monolith `screeningTabs.jsx` parses client-side (World A,
  `referenceParsers.js`). The META·SIFT screening UI posts to
  `/api/screening/:pid/import` (and `/import/start` + `/import/jobs/:jobId`).
- `SUPPORTED_IMPORT_FORMATS` (parsers.js:514) drives the format dropdown — P1
  would add a `pecan`/search-driven entry or a separate "Search" action that
  calls the same backend landing.

---

## 10. Integration recommendation for P1 (the seam)

1. P1 fetches from DB APIs and normalizes each hit into a canonical record using
   **`mkRecord` (parsers.js:47)** — set `title, authors("; "-joined), year,
   journal, doi, pmid, abstract`, plus `sourceDb` ("PubMed"/"Embase"/etc) and
   optional `url`/`keywords`.
2. P1 calls **`dedupeAndInsertRecords(projectId, records, { format:'pecan',
   filename:'Pecan: <query>', fileHash:<sha256 of canonicalized query+results>,
   importedById, importedByName, parser:'pecan', maxRecords })`** (service L69).
   - This gives free exact-dedup, the per-project cap, a `ScreenImportBatch`
     provenance row, and `ScreenRecord` rows the entire screening pipeline reads.
3. Screening, Title&Abstract, decisions, conflicts, the manual fuzzy
   duplicate-detect, PRISMA counts (§6), and the META·LAB extraction handoff all
   work UNCHANGED — they only read `ScreenRecord`.
4. For PRISMA-S per-database identified counts, add ONE read query grouping
   `ScreenRecord`/`ScreenImportBatch` by `sourceDb`/`format` (data already
   present; no schema change).
5. For file-level idempotency, compute a deterministic `fileHash` per
   (search-source + query + dedup-of-result-ids) so re-running the same Pecan
   search 409s instead of re-inserting — mirrors the file-fingerprint behavior.

---

## 11. Risks / gotchas

- **Two `mkRecord` / `parseRIS` / `dedupeRecords` copies** (parsers.js vs
  referenceParsers.js). They differ subtly; the screening server path uses
  `parsers.js`. P1 must import from `parsers.js`, NOT `referenceParsers.js`
  (which is the monolith/World-A copy). Do not "dedupe the duplication."
- **Two import worlds.** Calling the World-A `importExportController` /
  `importReferencesSchema` would write the legacy blob, NOT `ScreenRecord` —
  screening would not see the records. Always target World B.
- **Exact vs fuzzy dedup are different stages.** `dedupeAndInsertRecords` is
  exact-only and DROPS skipped dupes (does not store them or set isDuplicate).
  Cross-source near-dupes still need the on-demand `duplicates/detect` run; only
  THAT feeds PRISMA `duplicatesRemoved`. A reviewer must still click "Detect
  duplicates" — P1 does not change this. (Consider auto-triggering detection
  after a Pecan import, but that is a behavior change to weigh.)
- **`importBatch` provenance only stores `format/parser/filename`**, not the full
  search strategy. PRISMA-S wants the executed query string + date + hit count
  per source. That metadata has NO home today — `ScreenImportBatch` would need a
  nullable `searchQuery`/`searchSource`/`searchDate`/`rawHitCount` column set (or
  a sibling table) for full PRISMA-S provenance. This is the main NEW persistence
  P1 likely needs.
- **`importReferencesSchema`** (requestSchemas.js:29) is a red herring for World
  B — the screening routes are NOT Zod-validated; validation is inline in the
  controller. If P1 adds a new endpoint, follow the inline pattern or add a
  schema deliberately.
- **`maxRecordsPerProject` cap** (default 100000) and `MAX_RECORDS_PER_IMPORT`
  (200000) apply. A large multi-database Pecan pull can hit `CAPACITY` (400) — P1
  should surface that the same way the import dialog does.
- **`ScreenImportJob.content` is raw TEXT** parsed by the registry. P1's
  structured records do not fit that field cleanly; prefer calling
  `dedupeAndInsertRecords` directly (in P1's own async job) over enqueuing a
  `ScreenImportJob` unless P1 first serializes to a registry-parseable format.
- **`parseEndNoteXML` needs a DOM** (DOMParser) — only relevant if P1 ever round-
  trips XML; not an issue for direct record construction.
