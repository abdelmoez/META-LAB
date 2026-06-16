# PDF ↔ Record Matching (roadmap 1.4)

Pure engine `src/research-engine/screening/pdfMatching.js`; backend endpoint
`POST /api/screening/projects/:pid/match-pdfs`.

## Principle
**A wrong attachment is worse than no attachment.** Only high-confidence matches
auto-attach; everything else goes to a review/unmatched queue.

## Signals & confidence
For each PDF descriptor `{ filename?, doi?, pmid?, title?, year? }`:
1. **Exact DOI** (normalised) → confidence **0.99**, `matchedBy:'doi'`.
2. **Exact PMID** → **0.96**, `matchedBy:'pmid'`.
3. **Title similarity** (Levenshtein ratio via `titleSimilarity`) ≥ 0.70 →
   confidence `min(0.95, sim)` (+0.03 if the year also matches), `matchedBy:'title'`
   or `'title+year'`.

`classifyMatch(confidence)` → **auto** ≥ 0.90 · **review** 0.70–0.89 · **unmatched** < 0.70.

## Filename hints (`extractIdentifiersFromFilename`)
Recovers a DOI written directly or with `/`→`_`, a `pmid…` number, a 4-digit year,
and a cleaned title hint. A wrongly-recovered DOI simply matches no record (safe —
never a mis-attach).

## Ambiguity guard (`bestPdfMatch`)
Returns the top candidate **only** if it clears the review floor; if the runner-up
is within 0.05 of a title-based top match, the result is **demoted to `review`**
(too close to call → a human decides). Returns `null` below the floor.

## Endpoint
`match-pdfs` `{ pdfs:[…] }` → `{ suggestions:[{ filename, match, candidates }] }`.
**No side effects** — it only suggests; attachment happens via the existing upload
path once a record is chosen. (Auto-attach for OA-found PDFs is DOI-based, 0.99.)

## Tests
`tests/unit/screening/pdfMatching.test.js` (16 cases): exact DOI/PMID, URL/upper-
case DOI normalisation, title(+year), filename-derived DOI, ambiguity demotion,
empty results, banding.
