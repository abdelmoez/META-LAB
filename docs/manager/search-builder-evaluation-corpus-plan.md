# Search Builder — Evaluation Corpus & Intelligence Benchmark (SB5)

**Status:** implemented · **Scope:** Search Builder engine only · **Flag:** `searchEngine` (default OFF)

SB5 turns the Search Builder from a keyword splitter into a search assistant. The
centerpiece is a **reusable evaluation harness** so engine changes are measured, not
guessed: a hand-authored gold set, a programmatically-generated corpus of 1,000+
realistic cases, and a benchmark runner that scores the engine on seven dimensions.

## Why a corpus

The SB4 fixes (noise filtering, role-based PICO reassignment, duplicate detection)
were validated on a handful of cases. SB5's accuracy goals span dozens of review
patterns where the engine must not confuse disease vs intervention, procedure vs
comparator, or outcome vs population. A benchmark makes regressions visible and gives
an honest, repeatable number for "how good is the engine".

## Files

| File | Role |
|---|---|
| `src/research-engine/searchBuilder/__fixtures__/searchBuilderGoldCases.js` | Hand-authored gold cases (≥25), incl. the EUS-biliary-drainage gold case. Each carries expected P/I/C/O terms, noise to reject, terms that must NOT be in Population, expected duplicates, vocab, synonyms, and reasoning notes. |
| `src/research-engine/searchBuilder/__fixtures__/searchBuilderCorpus.js` | `generateCorpus(n)` — deterministic, template-driven generator producing 1,000+ cases across many domains (no `Math.random`; index-seeded so runs are reproducible). |
| `src/research-engine/searchBuilder/searchBuilderBenchmark.js` | Pure `runBenchmark(cases)` — runs each case through the engine and scores the seven dimensions; returns an aggregate report. No network, no fabricated numbers. |
| `tests/unit/searchBuilderBenchmark.test.js` | Asserts the EUS gold case passes and the aggregate stays above regression thresholds. |
| `scripts/search-builder-benchmark.mjs` | CLI (`npm run test:search-builder-intelligence`) — prints a human-readable report + per-dimension pass rates and the worst failures. |

## Case shape

```
{ caseId, reviewTitle, researchQuestion, pico:{question,P,I,C,O,timeframe?},
  expected:{ population:[...], intervention:[...], comparator:[...], outcomes:[...] },
  rejectNoise:[...],          // words that must NOT be offered as keywords
  notInPopulation:[...],      // terms that must NOT land in Population (e.g. EUS)
  expectedDuplicates:[...],   // equivalence keys expected to be flagged across concepts
  expectedVocab:[...],        // controlled-vocab headings expected (if known)
  expectedSynonyms:[...],     // acronym/expansion/variant pairs
  notes }
```

## Benchmark dimensions (per case → aggregated)

1. **Noise rejection** — every `rejectNoise` word is non-selectable (`isFillerWord`).
2. **Phrase preservation** — expected multi-word phrases survive tokenization (not split into fragments).
3. **PICO assignment** — each expected P/I/C/O term lands in the right concept (family-equivalence aware).
4. **Cross-concept leakage** — no `notInPopulation` term in Population; no auto-duplicate equivalence key across AND-ed concepts.
5. **Controlled-vocabulary safety** — the offline MeSH suggestion for a term is either a known-good heading or flagged low-confidence (never a silent close-but-wrong term).
6. **Synonym / acronym expansion** — expected expansions (EUS ↔ endoscopic ultrasound) are reachable from the engine.
7. **Strategy safety** — the generated PubMed strategy repeats no equivalence key across AND-ed blocks (would over-narrow).

The benchmark is intentionally **construction-aligned** for the generated corpus
(expectations derive from the template that built each case), so it is a strong
*regression net* and a broad measure of noise/phrase/role behavior — not a claim of
human-level NLP. The gold cases are the harder, hand-judged bar.

## Generator domains

GI procedures · EUS/ERCP/biliary drainage · IBD medications · hepatology/cirrhosis ·
colonoscopy/polypectomy · bariatric surgery · cardiology · endocrinology/diabetes ·
oncology · infectious disease · nephrology · pulmonology · critical care · surgery ·
diagnostic test accuracy · drug-vs-placebo · procedure-vs-procedure · exposure/risk
factor · prognosis · screening · non-inferiority/comparative effectiveness. Each case
mixes family terms (to test role classification) with generic phrases (to test
no-fragmentation / no-leakage) and injected noise words (to test rejection).

## Assumptions

1. "1,000 cases" = a generated benchmark dataset, not 1,000 hardcoded rules. Expected
   labels come from the generating template, so they are correct by construction.
2. Controlled-vocabulary scoring is offline-only (no live NLM in CI); live MeSH/Emtree
   disambiguation is next-phase ([search-builder-next-phase-roadmap.md](search-builder-next-phase-roadmap.md)).
3. The benchmark reports pass rates and the worst failures; the CI test asserts the
   EUS gold case + conservative aggregate thresholds so the bar can only rise.
