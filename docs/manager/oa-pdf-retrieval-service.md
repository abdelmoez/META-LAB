# Open-Access PDF Retrieval Service (roadmap 1.4)

`server/services/oaPdfResolver.js` + `server/controllers/screeningOaController.js`.

## What it does
For a screening record with a DOI, find a **legitimately open-access** PDF and
attach it to that record — automatically, behind an admin flag.

## Providers (priority order, configurable)
1. **Unpaywall** — `GET /v2/{doi}?email=…`; used only when `is_oa` and a
   `best_oa_location.url_for_pdf` (or any `oa_locations[].url_for_pdf`) exists.
2. **OpenAlex** — `GET /works/doi:{doi}?mailto=…`; used only when
   `open_access.is_oa` and `best_oa_location.pdf_url`/`primary_location.pdf_url`.
3. **CrossRef** — `GET /works/{doi}`; a PDF link is used **only** when the work
   declares an explicit open (Creative-Commons-style) licence. Otherwise CrossRef
   contributes nothing (we never attach a possibly-paywalled link).

## Safety (non-negotiable)
- **Only open-access PDFs.** No paywall bypass, no Sci-Hub, no scraping. Unpaywall
  /OpenAlex gate on their own `is_oa`; CrossRef requires an open licence.
- Downloaded bytes are validated: `≤ 25 MB` and `%PDF-` magic bytes, else rejected.
- The service **never throws**; every outcome is a status. OA failure never blocks
  an import and never overwrites a manually-uploaded PDF.

## Architecture
- **All network I/O via an injected `fetch`** (default global `fetch`) → unit tests
  pass a mock; **CI makes zero live calls** (`tests/unit/oaPdfResolver.test.js`).
- **TTL cache** (in-memory `Map`, keyed by normalised DOI; default 24 h) — a cache
  hit avoids a second provider call.
- **Token-bucket rate limit** (default 30/min) — returns `rate_limited` when empty.
- `loadOaConfig(env, settings)` merges admin settings + env.

## Status enum (`OA_STATUS`)
`found · not_found · failed · rate_limited · skipped_no_doi · skipped_feature_disabled`.
Attachment provenance is stored on `ScreenPdfAttachment` (`source=oa_<provider>`,
`oaStatus`, `sourceUrl`, `resolvedDoi`, `matchedBy='doi'`, `matchConfidence=0.99`,
`retrievalAttemptedAt`).

## Endpoint
`POST /api/screening/projects/:pid/oa-retrieve` `{ recordIds?: string[] }` →
`{ attached, notFound, skipped, failed, processed, results[] }`. Flag-gated
(`autoPdfRetrieval`, **default OFF**); `canScreen||isLeader`; **bounded to 25
records per call** (no job queue — the client paginates); `writeAudit('PDF_OA_ATTACHED')`.

## Config (env + admin)
- Admin (`metaSiftSettings`): `autoPdfRetrieval` (default **false**), `oaProviderPriority`.
- Env: `OA_PDF_RETRIEVAL_ENABLED`, `UNPAYWALL_EMAIL`, `OPENALEX_EMAIL`,
  `CROSSREF_MAILTO`, `OA_PDF_CACHE_TTL_HOURS` (24), `OA_PDF_RATE_LIMIT_PER_MINUTE` (30).
  Unpaywall **requires** an email; without `UNPAYWALL_EMAIL` that provider is skipped.

## Rollback
Set `autoPdfRetrieval=false` (or unset `OA_PDF_RETRIEVAL_ENABLED`). Manual upload
is unaffected; the new schema columns are nullable/defaulted.
