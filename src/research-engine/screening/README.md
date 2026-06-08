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

`findDuplicateGroups` runs three passes in priority order:
1. Exact DOI match (case-insensitive, trimmed)
2. Exact PMID match
3. Title similarity >= threshold (default `0.92`) — skips pairs with different years

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
