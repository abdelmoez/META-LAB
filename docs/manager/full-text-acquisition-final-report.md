# Full-Text Acquisition & Broader Import — Final Report (roadmap 1.4)

**Version:** 3.8.0 · **Branch:** `roadmap/phase-1.4-fulltext` → merged to `main`.
**Lead:** Opus (architect). Inspection by a 5-agent read-only team; implementation
by the lead with test gates.

## Delivered (safe, tested, flag-gated)
| Area | What | Where | Tests |
|---|---|---|---|
| Broader import | CSV / delimited-TXT / CIW (Web of Science) parsers; `detectAndParse` extended; existing formats preserved | `import-export/parsers.js` (pure) | `parsers-broader.test.js` + fixtures; existing `parsers.test.js` green |
| PDF↔record matching | Pure confidence-scored matcher (DOI/PMID/title[+year]) + filename hint extraction + ambiguity guard | `screening/pdfMatching.js` (pure) | `pdfMatching.test.js` (16) |
| OA resolution | Unpaywall→OpenAlex→CrossRef, OA-only, injected fetch, TTL cache, token-bucket rate-limit, status enum | `services/oaPdfResolver.js` | `oaPdfResolver.test.js` (12, **mocked, no live net**) |
| Schema | Additive `ScreenPdfAttachment` provenance fields (`source, oaStatus, sourceUrl, resolvedDoi, matchedBy, matchConfidence, retrievalAttemptedAt, retrievalError`) | `schema.prisma` + migration `20260616010000_…` | `prisma db push` clean (no data loss) |
| Endpoints | `POST …/oa-retrieve` (flag-gated, bounded, auto-attach), `POST …/match-pdfs` (suggestion-only) | `controllers/screeningOaController.js`, `screening/pdfStorage.js`, routes | load-verified; integration needs live server |
| Flag/ops | `autoPdfRetrieval` (**default OFF**) + `oaProviderPriority` in `metaSiftSettings`; env config | `screening/settings.js` | covered by `loadOaConfig` tests |

**Gate:** `npm run test:ci` → **1045 green**; `npm run build` exit 0; zero regressions.

## Architecture confirmation
- **Parsers are pure** — no network/DB/fs; text in → records out.
- **All OA network I/O is in the backend service via an injected `fetch`** — never
  in the engine; **no live network in CI**.
- **Schema is additive/nullable** — `db push` safe; existing PDF viewer untouched.

## Safety / legal
- **Only legitimately open-access PDFs**: Unpaywall/OpenAlex gate on `is_oa`;
  CrossRef only with an explicit open licence. No paywall bypass, no scraping.
- Downloads validated (`≤25 MB`, `%PDF-` magic). Service never throws; OA failure
  never blocks import. Manual PDFs are never overwritten.

## Known limitations (documented)
1. **No deep PDF text extraction** (no PDF lib added per the roadmap's caution) →
   uploaded-PDF matching uses filename/metadata hints; PDF-first import is a staged
   draft flow. See `pdf-first-import.md`.
2. **No multi-PDF upload-staging UI / Screening-Import redesign in this pass** — the
   backend endpoints + pure engine are ready to wire; the polished UI is the
   follow-up (can't be visually validated in a headless session).
3. **`oa-retrieve` is bounded to 25 records/call** (no job queue exists) — the
   client paginates; a background-job runner is a scale follow-up.
4. **Endpoint integration tests** need a live server (not in the hermetic gate);
   engine + service are fully gate-covered.

## Rollback
Set `autoPdfRetrieval=false` (default) → zero outbound calls. New parsers are
isolated and additive. Schema columns are nullable/defaulted. Manual upload path is
unchanged.

## Follow-up shipped (post-1.4, v3.8.1)
- **Account-linked email** — OA lookups now send the **requesting user's account
  email** (`req.user.email`) as the provider polite-pool identifier (per-call
  override; env email is only a fallback; 400 if the account has no email). A
  shared module-level resolver makes the TTL cache + rate-limiter persist across
  requests. (+3 resolver tests.)
- **Feature enabled** — `autoPdfRetrieval` default **ON** (acts only on an explicit
  user click; admin-disable-able).
- **UI** — a **“🔍 Find open-access PDF”** action in the per-record PDF panel
  (`PdfViewer`) over `oa-retrieve`, with friendly status handling.
- **Integration tests** — `tests/screening/integration/oa-fulltext.test.js`
  (self-skipping; 4 tests) verify `match-pdfs` (DOI match + null) and `oa-retrieve`
  (contract shape + 404) end-to-end against a live server, **without** any external
  provider call. Verified green locally with the server up.

## Still recommended (larger follow-ups)
1. Full Screening-Import landing (References | Upload PDFs | Find OA PDFs | Review
   unmatched) — the per-record button covers the common case now.
2. A flagged PDF text/XMP extractor with a vetted library for **compressed**
   content streams (uncompressed XMP/Info DOI already covered, dependency-free).
3. A background-job runner for OA at scale (currently bounded to 25/call).
