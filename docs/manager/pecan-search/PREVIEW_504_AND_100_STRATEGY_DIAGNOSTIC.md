# Pecan Search Engine — preview 504 fix + 100-strategy diagnostic

This round addresses two user reports against the Search & Discovery (Pecan Search
Engine) preview:

1. **"Some previews could not be fetched (HTTP 504). You can still run the search."**
2. *"Make 100 tests, each a different search strategy, so you can see all the errors
   and shortcomings."*

Everything below is **additive and behind the existing `pecanSearch` flag**. No Prisma
schema changed. Full CI gate: **2204 unit tests green**; production build green.

---

## 1. Root cause of the HTTP 504 preview error

The count-preview endpoint (`POST …/preview-count`) fanned out to every selected
provider with `Promise.all` and `await`ed **all** of them. Each provider's
`previewCount` ran with the **full run-time budget** — `requestTimeoutMs` (20 s) ×
`retryLimit` (4) + exponential backoff ≈ **100 s** worst case. One slow or sick
provider (e.g. DOAJ returning `502` with a 60 s `Retry-After` on a very long query
URL) therefore held the whole request open far longer than a reverse proxy's
`proxy_read_timeout` (~60 s) — so **nginx returned 504 to the browser** before Node
could send its graceful per-provider result.

A count preview is **interactive and best-effort**; it must never be able to push the
request past the proxy timeout.

### Fix — a bounded preview budget + fast-fail per provider

- **`server/pecanSearch/config.js`** — new engine settings (env-overridable, clamped):
  - `previewDeadlineMs` (default **12000**) — overall fan-out budget for one preview call.
  - `previewTimeoutMs` (default **7000**) — per-provider request timeout for previews.
  - `previewRetryLimit` (default **1**) — previews retry at most once (a run retries thoroughly).
- **All 7 connectors** — `previewCount(translated, { signal, timeoutMs, retryLimit })`
  now threads the fast-fail timeout/retry overrides down to the shared HTTP client
  (defaulting to the full run-time values when not supplied).
- **`pecanSearchController.postPreviewCount`** — each provider call now races against
  the remaining deadline behind an `AbortController`. At the deadline the in-flight
  request is **aborted** (frees the socket, stops retries) and that provider is
  reported as `kind: 'timeout'`. **The endpoint always returns within
  `previewDeadlineMs`, under any proxy timeout.** Only a real `exact`/`estimate`
  number is cached (never a transient `unavailable`/`timeout`).
- **UI** — `CountValue` renders the new `timeout` kind as *"timed out — runs in full"*
  (the full search still runs that source); the summed total already treats anything
  non-exact/estimate as a lower bound (`+`).

The preview can no longer 504: a sick provider degrades to a per-card "timed out"
note instead of failing the whole panel.

---

## 2. The 100-strategy diagnostic harness

`scripts/pecan-100-strategies.mjs` runs **106 diverse strategies × 7 connectors**:
- **translate** (offline, deterministic) — empty queries, translation errors,
  silent-weakening warnings, query anomalies (unbalanced parens, doubled operators).
- **previewCount** (live, bounded) — 0-result regressions, provider rejections,
  timeouts, and cross-provider disagreement (a provider returning 0 while ≥3 siblings
  are positive = a "suspicious zero").

Coverage: 20 realistic clinical PICO queries (SGLT2i/HFpEF, EUS-BD vs ERCP, metformin,
DOACs, immunotherapy, …), field-scoped + MeSH, truncation, every filter
(date/language/pub-type), structural edge cases, **dirty user input** (embedded
`AND`/`OR`/`NOT`, pasted field tags, pasted boolean lines), special characters,
unicode/CJK/emoji, and degenerate boundaries.

Run it with `node scripts/pecan-100-strategies.mjs` (live) or `--no-live` (instant
translate-only). It writes `scripts/pecan-harness-report.{json,md}` (git-ignored).

### Headline result

**The 20 realistic PICO queries had zero suspicious zeros** — the engine is sound for
real searches (confirming the earlier OR-synonyms root-cause fix end-to-end). All
findings were in **filters and field-scoping**.

---

## 3. Shortcomings found → fixed

| # | Shortcoming (evidence) | Fix |
|---|---|---|
| F1 | **Strategy display contradicted the engine**: synonyms within a concept were shown joined by the concept's `op` (AND), while the engine OR's them. This is exactly what the user saw — their `AND`-laden strategy was the misleading *display*, not the executed query. | `PecanSearchTab` StrategyCard now joins terms with **OR** and shows the inter-concept operator (`AND↓`) between concepts; the note explains "terms are alternatives (OR); concepts combine with AND." |
| F2 | **Literal booleans in a term** (`"stroke OR transient ischemic attack"`) were quoted as a phrase → ≈ 0 hits, silently. | New pure `ast.findLiteralBooleanTerms` (uppercase-only, high-precision) → a validation warning **and** a StrategyCard warning telling the user to split the term. |
| F3 | **EuropePMC language**: a full name like "English" was passed verbatim to `LANG:` → **0 results** (it needs ISO 639-2/B `eng`). | New `query/vocab.js` maps name/code → `eng`; unmappable values are dropped + warned. **Live: 0 → 180,073.** |
| F4 | **DOAJ language**: needs ISO 639-1 `en` (verified live — `eng`/`English` return 0). | Mapped via `vocab.toIso6391`. **Live: 0 → 31,935.** |
| F5 | **Crossref pub-type**: an invalid type (`type:review`) **errored the entire Crossref query** (`unavailable`). | Only valid Crossref work-type ids are emitted; study designs (review/RCT) are dropped + warned. **Live: unavailable → 119,552.** |
| F6 | **Semantic Scholar pub-type**: an unmapped `publicationTypes` value matched nothing → **0**. | Mapped to the S2 enum (`review→Review`, `RCT→ClinicalTrial`); unknowns dropped + warned. **Live: 0 → 77,864 / 4,328.** |
| F7 | **Invalid date bounds** (`"soon"`) were emitted verbatim, silently zeroing PubMed and erroring Crossref. | `vocab.parseDateBound` validates each bound; a bad bound is left open + warned. **Live: PubMed 0 → 18,641; Crossref unavailable → 16,073.** |
| F8 | **Crossref count labelled `exact`** though it is a dismax **relevance** total (routinely millions), dominating the summed preview. | Crossref `previewCount` now returns `kind: 'estimate'`. |
| F9 | **Inter-concept op defaulted to OR** in `normalizeCanonical` when missing — a latent "concepts silently OR'd" bug under the corrected semantics. | Default is now **AND** (the PICO intersection); only an explicit `OR` opts in. Docstring corrected. |

### Known limitations (documented, not silently weakened — expected behaviour)
- ClinicalTrials.gov has no author / DOI / PMID / journal field (trials have no
  authors) — field-scoped terms are approximated as free text + warned.
- Crossref/OpenAlex are relevance engines, not strict Boolean — already warned per query.
- A bare special-character-only term (e.g. `"!@#$%"`) can still confuse OpenAlex's
  analyzer; nobody searches that and it degrades to `unavailable`, never blocking other
  providers.

---

## Files touched
- `server/pecanSearch/config.js` — preview budget settings.
- `server/pecanSearch/query/vocab.js` — **new** shared language/pub-type/date vocabulary.
- `server/pecanSearch/query/ast.js` — default op AND; `findLiteralBooleanTerms`; validation warnings; docstring.
- `server/pecanSearch/connectors/{pubmed,europepmc,clinicaltrials,crossref,doaj,openalex,semanticscholar}.js` — fast-fail preview opts; language/pub-type/date mapping; Crossref estimate.
- `server/pecanSearch/pecanSearchController.js` — bounded preview deadline + per-provider abort.
- `src/features/pecanSearch/PecanSearchTab.jsx` — OR display + literal-boolean warning.
- `src/features/pecanSearch/components/parts.jsx` — `timeout` count label.
- `scripts/pecan-100-strategies.mjs` — **new** diagnostic harness.
- Tests: `tests/unit/pecanSearch/{vocab,queryAst,crossref,doaj,europepmc,pubmed,semanticscholar}.test.js` (+15 cases; 2204 total green).
