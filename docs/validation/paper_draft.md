# DRAFT — NOT PEER REVIEWED — results pending benchmark runs

> **Status: DRAFT skeleton.** This is an internal working manuscript for the PecanRev
> screening engine. It has **not** been peer reviewed. Every quantitative result is a
> `[PLACEHOLDER — populate from benchmark harness output]` to be filled from
> `npm run test:screening-benchmark`; do not cite any number from this file. External
> validation has **not** been performed (see `VALIDATION_PROTOCOL.md` §8).

---

## Title

A deterministic, transparent active-learning engine for systematic-review screening
prioritisation with recall-targeted operating points and reproducible validation.

*(Working title — to be refined.)*

## Abstract

**Background.** Title/abstract screening is the most labour-intensive step of a
systematic review, and machine-assisted prioritisation can reduce it — but only if the
tool is transparent, reproducible, and recall-safe.

**Methods.** We describe a deterministic screening engine that fuses a TF-IDF +
class-weighted logistic-regression relevance classifier with cold-start (PICO/criteria),
semantic-similarity, and citation-graph sub-signals in a renormalized hybrid score. It
adds a recall-targeted operating point chosen on held-out predictions, probability
calibration measured by nested cross-validation, and an unbiased random-sample
validation protocol to counter prioritized-screening bias. We evaluate it out-of-sample
with stratified k-fold cross-validation on public benchmark datasets.

**Results.** `[PLACEHOLDER — populate from benchmark harness output: AUC, WSS@95,
WSS@100, recall@k, held-out ECE, with 95% bootstrap CIs, per dataset and family mean.]`

**Conclusions.** `[PLACEHOLDER — write after results.]` The engine is fully
deterministic and open to independent reproduction via the committed benchmark harness.

## 1. Introduction

Systematic reviews screen thousands of records to find a small set of eligible studies;
the include prevalence is typically low, so recall is paramount and false exclusions are
costly. Machine-assisted screening can prioritise likely-includes, but adoption in
evidence synthesis depends on three properties often missing from black-box tools:
determinism (same inputs → same output), transparency (an inspectable reason per
record), and honest, recall-first validation. We present an engine built around those
properties, used only as decision support — a human records every decision.

## 2. Methods

### 2.1 Engine

Deterministic lexical active-learning ranker. A TF-IDF vocabulary (unigrams + bigrams;
title weighted 3×, keywords/MeSH 2×) feeds a class-weighted logistic regression trained
once enough human labels accumulate; below that threshold a cold-start prior derived
from the PICO snapshot and inclusion/exclusion criteria drives the score. Semantic
similarity to the included-minus-excluded centroids (lexical or optional dense
embeddings, leave-one-out for labelled records) and an additive citation-graph signal
(direct citation + bibliographic coupling against the labelled sets, OpenAlex metadata)
are fused with the classifier and cold-start in a hybrid score that renormalizes over
only the available signals. The tuned default config (`v2-lexical-tuned`) differs from
the original deployed engine only in the optimiser (heavy-ball momentum + sklearn-style
inverse regularisation); the feature set and fusion are unchanged.

Labels come from human decisions (settled final status, else a clean unanimous reviewer
vote); conflicts and maybe-only records are left unlabelled. The engine never writes a
decision.

### 2.2 Recall-targeted operating point

Rather than a balanced 0.5 cut, the decision threshold is the highest score whose recall
on held-out cross-validated predictions is ≥ the target (default 0.95), with pessimistic
tie handling. It is flagged preliminary below small-sample floors and only drives
per-record predictions when the cross-validated estimate is reliable.

### 2.3 Calibration

Ranking scores are mapped to `P(include)` on out-of-fold predictions (Platt/isotonic by
sample size); reported calibration error is measured by nested CV to avoid the
optimistic apparent ECE.

### 2.4 Validation design

Three estimator tiers — in-sample (apparent), held-out stratified k-fold CV, and an
unbiased seeded random-sample estimate — each labelled with its provenance. Metrics: AUC,
WSS@95/@100 (Cohen 2006), recall@k, per-stage recall/precision, with 95% seeded
bootstrap CIs. Benchmark harness: `scripts/screening-benchmark.mjs`, 5-fold CV, seed
1337, on the bundled Cohen-2006 family (optional SYNERGY / CLEF via user-provided
paths). Full protocol: `VALIDATION_PROTOCOL.md`.

### 2.5 Reproducibility

All primitives are deterministic; seeds are fixed for shuffling, bootstrap, and the
validation sample. The engine config version and seed are recorded on every run and in
every benchmark output row.

## 3. Results

`[PLACEHOLDER — populate the following from npm run test:screening-benchmark]`

- **Table 1.** Per-dataset AUC, WSS@95, WSS@100, recall@k, held-out ECE (mean ± 95% CI).
  `[PLACEHOLDER]`
- **Table 2.** Family-mean metrics for `v1-hybrid-legacy` vs `v2-lexical-tuned` vs the
  reference TF-IDF+LR configuration. `[PLACEHOLDER — the two committed reference numbers
  are v1 AUC 0.848 / WSS@95 0.310 and v2 AUC ≈0.858 / WSS@95 ≈0.303; regenerate the full
  table rather than transcribing.]`
- **Figure 1.** Reliability (calibration) curves, in-sample vs held-out. `[PLACEHOLDER]`
- **Figure 2.** Work-saved vs recall operating curve. `[PLACEHOLDER]`
- **Table 3.** Random-sample vs prioritized-set metric comparison (bias quantification).
  `[PLACEHOLDER]`

## 4. Discussion

`[PLACEHOLDER — write after results.]` Anticipated themes: determinism and transparency
as adoption enablers; the value of a recall-targeted operating point over a balanced
threshold; the importance of an unbiased random sample for honest metrics under
prioritized screening; the citation signal as an additive, never-gating feature.

## 5. Limitations

- Internal validation only; **no external / prospective / cross-institution validation**
  has been performed (`VALIDATION_PROTOCOL.md` §8).
- Benchmarks are English-language, mostly clinical; generalisation is untested.
- Cold-start performance early in a review is weaker than the trained regime.
- Optional signals (citation, dense embeddings) depend on external coverage.
- Small-sample estimates are flagged unstable and must not be over-interpreted.

## 6. Data and code availability

The engine is deterministic and the benchmark harness is committed
(`scripts/screening-benchmark.mjs`); results are reproducible with
`npm run test:screening-benchmark`. Bundled Cohen-2006 datasets ship with the harness;
SYNERGY and CLEF require user-provided paths.

## 7. Ethics / governance statement

The engine is assistive only; a human records every screening decision and the AI has no
decision-write path. See the model card (`MODEL_CARD.md`) for the human-oversight
requirements and `docs/privacy-ai-providers.md` for the data-egress story.

---

*Reminder: DRAFT, not peer reviewed. Replace every `[PLACEHOLDER]` with harness output
before any circulation, and do not represent internal validation as external.*
