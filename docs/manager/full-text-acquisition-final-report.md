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

## Recommended next steps
1. Build the Screening-Import UI (References | Upload PDFs | Find OA PDFs | Review
   unmatched) over the new endpoints.
2. Add a flagged PDF text/XMP metadata extractor feeding `match-pdfs`.
3. Move OA retrieval to a background-job runner for large projects.
4. Add live-server integration tests for `oa-retrieve`/`match-pdfs` in a richer CI job.
