# PDF ↔ Record Matching (roadmap 1.4, reused by 68.md P9)

The PDF matching engine decides which screening record an uploaded PDF belongs to.
It is a **pure, framework-free** module:
`src/research-engine/screening/pdfMatching.js`.

Guiding rule (stated in the source): **a wrong attachment is worse than no
attachment.** Only high-confidence matches auto-attach; everything else is left for
manual handling.

## API

| Export | Purpose |
|---|---|
| `AUTO_ATTACH_THRESHOLD = 0.90` | confidence ≥ this → disposition `auto` |
| `REVIEW_THRESHOLD = 0.70` | confidence ≥ this (but < auto) → `review`; below → `unmatched` |
| `classifyMatch(confidence)` | maps a confidence to `auto` / `review` / `unmatched` |
| `normalizeDoi(doi)` | lower-case, strip URL prefix + trailing punctuation |
| `findDoiInText(text)` | best-effort DOI recovery from decoded PDF text (tagged DOI preferred) |
| `extractIdentifiersFromFilename(filename)` | pull `{doi, pmid, year, titleHint}` from a filename |
| `matchPdfToRecords(pdf, records)` | ranked candidates, sorted desc by confidence |
| `bestPdfMatch(pdf, records)` | the single best match, or `null` below the review floor |

The `pdf` descriptor accepts `{ doi?, pmid?, title?, year?, filename?, pdfText? }`.
Identifiers are taken from explicit fields first, then recovered from filename
hints, then (for DOI only) from `pdfText`.

## Confidence model (as implemented)

`matchPdfToRecords` scores each record and returns the first signal that fires,
strongest first:

| Signal | Condition | Confidence | `matchedBy` |
|---|---|---|---|
| Exact DOI | normalized PDF DOI == normalized record DOI | **0.99** | `doi` |
| Exact PMID | PDF PMID == record PMID | **0.96** | `pmid` |
| Title similarity | `titleSimilarity ≥ 0.70` | `min(0.95, sim)` (+0.03 if year also matches, re-capped at 0.95) | `title` or `title+year` |
| None | no signal | 0 (dropped) | `none` |

`bestPdfMatch` takes the top candidate, returns `null` if it is below
`REVIEW_THRESHOLD` (0.70), and adds an **ambiguity guard**: if the runner-up is a
title match within 0.05 confidence of the top title match, the disposition is
demoted from `auto` to `review` rather than risk attaching the wrong PDF. It also
returns the top-5 `candidates`.

Note the interaction with `AUTO_ATTACH_THRESHOLD` (0.90): title matches cap at
0.95, so a strong title+year match *can* reach `auto`, but a borderline or
ambiguous title match cannot. Only exact DOI (0.99) and exact PMID (0.96) are
reliably above the auto floor.

## Bulk-upload behavior (68.md P9)

`POST /api/full-text/:pid/bulk-upload` (`fullTextController.bulkUpload_`) is where
the engine is used against uploaded PDFs. For each file, exactly:

1. Reject files that are not a real PDF (`%PDF-` magic bytes) or exceed the size
   cap → recorded in the response as `matched: false` with a reason; **not stored**.
2. Run `bestPdfMatch({ filename, pdfText: <first 200KB as latin1> }, records)`.
3. **Auto-attach only when** `best.confidence ≥ AUTO_ATTACH_THRESHOLD` **and**
   `best.disposition === 'auto'` **and** the matched record has **no PDF yet**.
   On attach: `savePdf` + a `ScreenPdfAttachment` with `source: 'uploaded_matched'`,
   `matchedBy`, `matchConfidence`.
4. Everything else is **NOT persisted**:
   - below-threshold / non-`auto` → `matched: false`, reason "confidence below
     auto-attach threshold — attach manually per record", with the best `recordId`
     + `confidence` echoed back for context;
   - no match at all → reason "no matching record found";
   - matched but the record already has a PDF → `matched: false`, reason "record
     already has a PDF" (never auto-overwritten).

The response includes a `note` telling the user that unmatched/low-confidence PDFs
were **not** stored and must be attached from each record's page. This is the
honest, safe default: a wrong attachment is worse than none, and **no orphaned
file is ever left on disk** for an unmatched upload (the bytes are simply
discarded — nothing is saved unless it auto-attaches).

## Suggestion-only path (no side effects)

`screeningOaController.matchPdfs` (`POST /projects/:pid/match-pdfs`) runs the same
engine over a list of PDF descriptors and returns ranked suggestions
(`recordId`, `confidence`, `matchedBy`, `disposition`, top-5 `candidates`) **with
no attachment side effects** — this feeds a review queue where a human confirms
each match.

## Not implemented

- **Compressed PDF content streams are not decoded.** `findDoiInText` works on
  XMP / Info-dict / uncompressed content only (decoding compressed streams would
  need a PDF library; this is the dependency-free subset). The bulk-upload path
  passes the first 200KB of raw bytes as latin1, so DOI recovery from a compressed
  body may miss — in which case the file falls to filename/metadata signals or is
  left unmatched.
- There is **no persistence of unmatched files** and no separate "unmatched queue"
  table on the bulk path; unmatched files are reported in the HTTP response only.
