# Full-Text Acquisition — Current System Map (roadmap 1.4)

*Produced by a 5-agent inspection team (read-only) before coding. Do not guess — this reflects the live code as of branch `roadmap/phase-1.4-fulltext`.*

## 1. Reference parsers (pure engine)
- `src/research-engine/import-export/parsers.js` — `parseRIS / parseNBIB / parseBibTeX / parseEndNoteXML`, `detectAndParse(text, filename)`, `mkRecord(r)`, `normTitle`, `dedupeRecords`. All pure (text in → records out). `detectAndParse` dispatches by **extension first, then content sniff**; falls back RIS→BibTeX→NBIB.
- Canonical record shape: `{ id, title, authors, year, journal, doi, pmid, abstract, source, decision:'', reviewer2:'', notes:'', dupOf:null }`.
- **Gap (1.4):** no CSV/TXT/CIW. → Added `parseCSV/parseTXT/parseCIW` + extended `detectAndParse` (extension + guarded content sniff), new parsers attach `url`/`keywords` only when present so `mkRecord` shape and existing tests are untouched.

## 2. Screening reference import (server)
- `POST /api/screening/projects/:pid/import` → `screeningController.importRecords` (L798–942). Resolves access via `getProjectAccess`; SHA-256 file fingerprint → `ScreenImportBatch` (409 on re-import unless `force`); `detectAndParse`; exact dedup (DOI/PMID/normTitle) vs existing rows; `prisma.screenRecord.createMany` in 100-row chunks. Returns `{ imported, skippedDuplicates, total, batchId }`.
- `ScreenRecord` (schema L309–353): `title, authors, year, journal, doi, pmid, abstract, keywords, sourceDb, rawData`, screening fields, `mergedIntoId`, relation `pdfAttachments[]`.

## 3. PDF attachments (META·SIFT)
- Model `ScreenPdfAttachment` (schema L501–512): `id, projectId (plain string scope), recordId (FK→ScreenRecord cascade), fileName, storedName, fileSize, mimeType, uploadedBy, createdAt`.
- `server/controllers/screeningPdfController.js`: `uploadPdf` (multipart, validates %PDF magic bytes, **replaces** the record's existing PDF, writes `storage/screening-pdfs/[projectId]/[uuid].pdf`, `writeAudit('PDF_UPLOADED')`), `listPdf`, `downloadPdf` (range-aware stream, inline), `deletePdf` (`writeAudit('PDF_REMOVED')`), `pdfUploadMiddleware` (gates on `allowPdfUpload`, 25 MB), `shape()`.
- Routes: `server/routes/screening.js` L106–110. Perms via `getProjectAccess` (`canScreen||isLeader` to upload; uploader|leader to delete).
- **Gaps (1.4):** no OA auto-fetch, no PDF↔record matching, no text extraction, one-PDF-per-record (replace), no storage abstraction beyond disk.

## 4. Infrastructure
- **Feature flags:** global `server/controllers/settingsController.js` `DEFAULTS.featureFlags` (now incl. `relationalProjectStore`); screening-specific `server/screening/settings.js` `getMetaSiftSettings()` (`allowImport`, `allowPdfUpload`, `maxRecordsPerProject`, …). Admin updates bust caches.
- **Env:** `server/load-env.js` (dotenv, first import) → `process.env`. New: `OA_PDF_RETRIEVAL_ENABLED`, `UNPAYWALL_EMAIL`, `OPENALEX_EMAIL`, `OA_PDF_CACHE_TTL_HOURS`, `OA_PDF_RATE_LIMIT_PER_MINUTE`.
- **Caching:** only `maintenance.js` (10 s in-memory). No Redis/general cache → the OA service ships its own small in-memory TTL cache.
- **Rate limiting:** `express-rate-limit` for HTTP routes only; **no outbound limiter** → the OA service ships a small token-bucket for provider calls.
- **Background jobs:** **none** (no bull/bree/agenda; only an SSE heartbeat). → OA retrieval runs as a **bounded, rate-limited batch** per request (client paginates), not a queue.
- **Audit:** `server/screening/access.js` `writeAudit(...)`; admin `server/utils/audit.js` `logAdminAction`.
- **fetch:** Node ≥18 global `fetch` available; the OA service takes `fetch` as an **injected dependency** (default global) so tests use a mock and CI makes **no live network calls**.

## 5. Tests
- Parser units + fixtures: `tests/unit/parsers.test.js`. New: `tests/unit/parsers-broader.test.js` + `tests/fixtures/import/*`.
- Hermetic network mocking pattern (cf. `emailService` tests): inject the transport/fetch; assert behavior without a socket. The OA service + matching engine are tested this way and run inside the `npm run test:ci` gate.
- Screening integration tests need a live server (not in the hermetic gate) — endpoint tests are written to self-skip without `:3001`.

## 6. Safest integration plan (followed)
1. **Engine (pure):** new parsers + a pure `pdfMatching.js` (filename/metadata → ranked record matches w/ confidence). Gate-tested.
2. **Service (impure, DI):** `oaPdfResolver.js` — Unpaywall→OpenAlex→CrossRef via injected fetch, TTL cache, token-bucket rate-limit, status enum; never throws; flag-gated. Mocked tests.
3. **Schema:** additive nullable fields on `ScreenPdfAttachment` (`source, oaStatus, sourceUrl, resolvedDoi, matchConfidence, matchedBy, retrievalAttemptedAt, retrievalError`). Additive migration. Existing viewer untouched.
4. **Endpoints:** flag-gated OA-retrieve batch + a match-suggestions endpoint; reuse the existing attachment write path; `writeAudit`.
5. **Flag default OFF**, cached, rate-limited, mockable. Only legitimately open-access PDFs are fetched.
6. **Deferred + documented:** deep PDF *text* extraction (needs a PDF lib — not added) and a multi-PDF upload-staging UI; uploaded-PDF matching uses filename/metadata hints via the pure engine.
