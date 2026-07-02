# Model Card — PecanRev Screening Intelligence Engine

*This model card follows the 66.md P4.8 requirement. It documents the deterministic
lexical active-learning engine that ranks records for systematic-review title/abstract
and full-text screening. Metric values are produced by the committed benchmark
harness; only the two verified numbers already recorded in `config.js` are cited
inline (with provenance) — reproduce current numbers with
`npm run test:screening-benchmark`.*

---

## Overview

- **Name:** PecanRev Screening Intelligence Engine
- **Type:** Deterministic lexical active-learning ranker (TF-IDF + class-weighted
  logistic regression) with a transparent hybrid fusion of cold-start, semantic, and
  citation-graph sub-signals.
- **Default engine config version:** `v2-lexical-tuned` (see `ENGINE_CONFIG_VERSIONS`).
  `v1-hybrid-legacy` is preserved byte-for-byte for rollback.
- **Feature flag:** `aiScreening` (default OFF).
- **Location:** `src/research-engine/screening/ai/` (pure engine),
  `server/services/screeningAiService.js` (server adapter).

## Intended use

- Rank/prioritise candidate records by estimated relevance so reviewers screen the
  likely-includes first.
- Estimate work saved at a guaranteed recall (WSS@95 / WSS@100) to inform — not
  dictate — screening effort.
- Surface an honest, per-record explanation of why a record scored as it did.
- Provide validation metrics a methods section can cite.

## NOT intended use

- **Not** an automatic include/exclude decision-maker. The AI never writes a
  screening decision; a human always decides. This is a structural invariant, not a
  configuration.
- **Not** a replacement for dual independent screening or for reading full text.
- **Not** validated for auto-exclusion. Predictions below the operating point are a
  triage aid, not a licence to skip records.
- **Not** a general-purpose classifier — it is tuned for systematic-review screening
  where recall is paramount and includes are rare.

## Training signal

- **Labels:** derived from human screening decisions via `aggregateLabel` — a settled
  final status, else a clean unanimous reviewer vote. Conflicts and maybe-only records
  are left **unlabelled** so the model never learns from disagreement.
- **Active learning:** the model retrains as decisions accumulate; it trains only once
  `minLabelsToTrain` (10) with `minPositivesToTrain` / `minNegativesToTrain` (3) are
  met, else it uses the cold-start prior.

## Feature types

- **Text (TF-IDF):** unigrams + bigrams over title (weight 3), abstract, keywords/MeSH
  (weight 2), journal; sublinear TF, min-df 2, ≤ 20k features.
- **Cold-start prior:** PICO / inclusion-exclusion criteria / study-type / keyword
  match.
- **Semantic:** centroid cosine to the included minus excluded sets (lexical or dense
  embeddings), with leave-one-out for labelled records.
- **Citation-graph (66.md P4.3):** direct citation links + bibliographic coupling
  against the labelled sets, derived per scoring call from that call's own labels
  (leakage-free). Additive only.

## Embedding provider

`lexical` (default, in-process, nothing leaves the server), `hashing` (in-process
dependency-free), or `hosted` (env-configured external service; record text is sent
to the configured endpoint). Best-effort with all-or-nothing fallback to lexical.

## Citation provider

OpenAlex, via `citationEnrichmentService.js`. Only public identifiers (DOI / PMID)
leave the server; results are cached globally by identifier. Optional and additive —
any failure degrades to "no citation signal".

## Privacy mode

- **Default (lexical + no citation enrichment):** no record data leaves the server.
- **Citation enrichment ON:** only DOIs/PMIDs are sent to OpenAlex.
- **Hosted embeddings ON:** record text is sent to the configured embedding endpoint.
- See `docs/privacy-ai-providers.md` for env vars and the per-mode data-egress table.

## Calibration

Ranking score → `P(include)` via out-of-fold predictions (Platt below
`isotonicMinSamples`, isotonic at/above; no calibration below `minSamplesToCalibrate`
= 50). Reported ECE / slope / intercept are measured by **nested** CV
(`heldOutCalibrationMetrics`), not the optimistic apparent ECE; apparent values are
retained under `apparentMetrics`.

## Validation method

- **In-sample (apparent), held-out k-fold CV, and unbiased random-sample** metric sets
  — each labelled with its provenance (`random` / `prioritized` / `mixed`).
- **Metrics:** AUC, WSS@95, WSS@100, recall@k, per-stage recall/precision.
- **Confidence intervals:** 95% percentile bootstrap with a **seeded** PRNG
  (deterministic).
- **Random-seed protocol:** the benchmark harness fixes seed **1337** and 5-fold
  stratified CV by default; the seed and fold count are recorded in every output row.
  The validation sample uses a persisted seed so its metrics are reproducible.
- **Benchmark datasets:** bundled Cohen-2006 (15 datasets); optional user-provided
  SYNERGY and CLEF eHealth TAR layouts (nothing fabricated when a path is missing).

### Reference metrics (verified, committed in `config.js`)

On the Cohen-2006 family, 5-fold stratified CV, seed 1337
(`scripts/screening-benchmark.mjs`):

| Config                     | AUC    | WSS@95 |
|----------------------------|--------|--------|
| v1 (deployed / legacy)     | 0.848  | 0.310  |
| **v2-lexical-tuned (default)** | **≈0.858** | **≈0.303** |
| reference TF-IDF+LR (sklearn) | 0.855 | 0.319 |

*Provenance: these are the numbers recorded in the `ENGINE_CONFIG_VERSIONS` comments
in `src/research-engine/screening/ai/config.js`. All other per-dataset / per-metric
numbers (WSS@100, recall@k, held-out ECE, CIs) are produced fresh by
`npm run test:screening-benchmark` — this card does not hard-code them.*

## Known limitations

- Performance depends on class separability and label volume; early in a review
  (cold-start only) the ranking is weaker.
- Records with no usable abstract are flagged low-confidence; the text signal is
  thin.
- Citation and embedding signals depend on external coverage/availability and are
  absent when the provider has no data.
- Benchmarks are on English-language, mostly-clinical datasets; other domains/languages
  are not yet externally validated.
- Metric estimates below the small-sample floors are flagged unstable and should not
  be over-interpreted.

## Failure modes

- **Prioritized-screening bias:** labelling likely-includes first inflates apparent
  metrics; mitigated by the random validation sample and honest source labelling.
- **Miscalibration on small/noisy data:** surfaced by nested-CV ECE and suppressed
  below the calibration floor.
- **Model drift across runs:** each run is a version; drift vs the prior active
  version is computed and warned on.
- **Provider outage:** embedding/citation failures degrade silently to the lexical
  baseline — scores remain valid, just without the optional signal.

## Human oversight requirement

The engine is assistive by default (`policy = assist`). A human must record every
screening decision (`requireHumanFinalDecision`); the AI cannot finalise one. Scores
are hidden until enough human decisions exist. Blind review suppresses cross-reviewer
signals. A global kill switch can disable the engine everywhere.

## Versioning

- **Model version:** `ScreenAiRun` lineage (active / parent / rollback), with a
  reproducible snapshot hash of the training inputs + model-defining config.
- **Engine config version:** `ENGINE_CONFIG_VERSIONS` (named, frozen tunables) stamped
  on each run and selectable/rollback-able per project.
- **Feature version:** `FEATURE_VERSION` constant on each run row.

## Reproducibility

Deterministic end to end: the same records + decisions + config produce identical
scores. Seeds are fixed for shuffling, bootstrap CIs, and the validation sample. The
benchmark harness records the engine config version and seed in every JSON/CSV row.
Reproduce with `npm run test:screening-benchmark`.
