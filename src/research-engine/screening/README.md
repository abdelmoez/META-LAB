# META·SIFT Beta — Screening Engine

Pure JavaScript functions for systematic review title/abstract screening logic.
No database, no Express, no React — these are computation-only modules safe to
import in any environment (Node.js, browser, workers).

## Files

### `deduplication.js`

Identifies duplicate records across an imported corpus.

| Export | Description |
|--------|-------------|
| `normalizeTitle(t)` | Lowercase, strip punctuation, collapse whitespace |
| `levenshtein(a, b)` | Edit distance between two strings |
| `titleSimilarity(a, b)` | Normalized similarity score 0–1 based on Levenshtein |
| `findDuplicateGroups(records, threshold?)` | Returns arrays of record IDs that are likely duplicates |
| `scorePair(a, b)` | Explainable duplicate-likelihood score between two records |
| `findDuplicateGroupsScored(records, threshold?)` | Like `findDuplicateGroups` but each group carries a score, reason and per-pair breakdown |
| `parseSurnames(authors)` | Parses a `Set` of lowercase author surnames from an `authors` string |

`findDuplicateGroups` runs three passes in priority order:
1. Exact DOI match (case-insensitive, trimmed)
2. Exact PMID match
3. Title similarity >= threshold (default `0.92`) — skips pairs with different years

#### Scored deduplication

`scorePair(a, b)` returns `{ score, reason, signals }`:

- `score` — integer `0–100`.
- `reason` — short human-readable explanation naming the strongest signal(s),
  e.g. `"92% title similarity; authors overlap; same year"`.
- `signals` — `{ titleSim, authorJaccard, yearMatch, doiMatch, pmidMatch }`.

Scoring rules:
1. Matching non-empty DOIs → `100`, reason `"Exact DOI match"`.
2. Else matching non-empty PMIDs → `100`, reason `"Exact PMID match"`.
3. Else a weighted blend: title similarity (weight `0.7`, dominant), author
   surname Jaccard overlap (`0.15`), and year match (`0.15`). Year only counts
   when present in both records; when missing it is dropped from the denominator
   (neutral) rather than penalized.

`findDuplicateGroupsScored(records, titleThreshold = 0.85)` reuses the same
3-pass grouping and returns
`Array<{ ids, score, reason, pairs: [{ a, b, score, reason }] }>`. The group
`score` is the maximum pairwise score within the group and `reason` is that
strongest pair's explanation. `findDuplicateGroups` is unchanged and remains the
boolean-grouping API.

### `keywords.js`

Derives inclusion / exclusion highlight phrases from a PICO + eligibility
object.

| Export | Description |
|--------|-------------|
| `extractKeywords(pico)` | Returns `{ inclusion: string[], exclusion: string[] }` from `{ P, I, C, O, question, incl, excl, keywords }` (all optional) |
| `STOPWORDS` | A `Set` of English stopwords used for filtering (exported for reuse/testing) |

Behavior:
- `incl` → inclusion terms; `excl` → exclusion terms. P/I/C/O, `keywords` and
  `question` are folded into inclusion candidates (they describe what we want).
- Multi-word **phrases** are preferred over single words. Criteria text is split
  on line breaks, bullets (`-`, `*`, `•`, `1.`, `2)`), semicolons and commas.
- Stopword-only and `<3`-char single-word phrases are dropped; multi-word
  phrases containing stopwords are kept.
- Lowercase-deduped, deterministically ordered (phrases first, then longer, then
  alphabetical) and capped at 40 items per list.

### `highlight.js`

Computes non-overlapping highlight ranges over title/abstract text.

| Export | Description |
|--------|-------------|
| `computeHighlightRanges(text, { inclusion, exclusion })` | Returns a sorted, non-overlapping `Array<{ start, end, type }>` where `type` is `'inclusion'` or `'exclusion'` |
| `escapeRegExp(s)` | Escapes a string for literal use in a `RegExp` |

Behavior:
- Case-insensitive, word-boundary-aware matching (won't highlight `art` inside
  `start`).
- Overlap resolution: longer match wins; on an exact-length tie, exclusion wins
  (safety). Greedy claiming yields a clean, non-overlapping, in-bounds set.
- Returns `[]` for empty text or empty term lists.

### `conflicts.js`

Detects reviewer disagreements on individual records.

| Export | Description |
|--------|-------------|
| `detectConflict(decisions)` | Given `[{reviewerId, decision}]`, returns conflict status and map |
| `findAllConflicts(recordDecisions)` | Batch conflict check across a `recordId → decisions[]` map |

`undecided` decisions are ignored when computing conflicts. A conflict requires
at least two real decisions that differ.

### `stats.js`

Computes screening progress statistics and PRISMA-compatible flow numbers.

| Export | Description |
|--------|-------------|
| `computeStats(total, decisions)` | Returns `{total, screened, included, excluded, maybe, undecided, progress}` |
| `computePrismaNumbers(stats)` | Returns PRISMA 2020 flow counts: `{identified, deduplicated, screened, excluded_title, full_text, included_final}` |

## Running tests

From the project root:

```bash
# All screening unit tests
npx vitest run tests/screening/unit/

# All screening tests (unit + integration)
npx vitest run tests/screening/

# Watch mode during development
npx vitest tests/screening/unit/
```

Integration tests in `tests/screening/integration/` require the META·LAB
server to be running on `http://localhost:3001`. They are automatically skipped
when the server is not available.

## Design notes

- All functions are stateless and have no side effects.
- No `import` from Prisma, Express, or any server-side module.
- Safe to bundle into the browser or import from server-side route handlers.
- The `findDuplicateGroups` year filter is intentional: same title in different
  years is treated as a different article (e.g. retraction vs. original).
