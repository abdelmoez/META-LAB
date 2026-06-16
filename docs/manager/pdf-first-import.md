# PDF-First Import (roadmap 1.4) — design + current limitation

## Goal
Let a user upload PDFs *before* importing references and still end up with records
that have the PDF attached.

## What ships now (safe path)
- **Filename/metadata-driven matching.** The pure engine
  (`pdfMatching.js`) extracts a DOI/PMID/year/title hint from each PDF's filename
  (or any metadata the client supplies) and `match-pdfs` returns the best record
  match with a confidence and disposition (auto / review / unmatched).
- **Drafts from hints.** A PDF whose filename yields a DOI can seed a draft record
  (DOI → `parseCSV`/manual entry, or DOI metadata via the OA resolver's CrossRef
  path), which the user confirms before it enters screening. PDFs with no usable
  hint produce an incomplete draft the user completes — **no bad records are
  created silently**.

## Documented limitation (deliberate)
**Deep PDF *text* extraction is NOT implemented.** The repo has no PDF-parsing
dependency, and the roadmap explicitly says not to add a heavy dependency without
checking. So metadata extraction is limited to **filename + client-supplied
fields**, not the PDF's internal text/XMP. Consequences:
- A PDF named opaquely (e.g. `download.pdf`) yields only a weak title hint and will
  land in the **unmatched** queue for manual attachment — correct and safe.
- Auto-population of title/abstract/authors from inside the PDF is a **follow-up**
  that should add a vetted PDF text/metadata library (e.g. `pdfjs-dist` text layer
  or an XMP reader) behind its own flag.

## Recommended next step
Add a small, flagged PDF-metadata extractor (text first page + XMP DOI) feeding the
existing `match-pdfs` engine, plus a multi-PDF upload-staging model/UI
(`Matched / Needs review / Unmatched`). The pure matching engine and the OA
attachment path are already in place to consume it.

## Safety
No silent record creation; matching never auto-attaches below 0.90; manual upload
remains the always-available fallback.
