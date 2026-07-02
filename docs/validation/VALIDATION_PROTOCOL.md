# Validation Protocol — PecanRev Screening Intelligence Engine

This document specifies how the screening AI is validated: the estimator hierarchy
(in-sample vs held-out vs unbiased random-sample), the prioritized-screening bias and
how the seed sample fixes it, the benchmark datasets, the metric definitions, how
confidence intervals are computed, and what would constitute external validation
(clearly marked as **not yet performed**).

The engine is deterministic, so every number below is reproducible from the same
inputs, config version, and seed.

---

## 1. Estimator hierarchy

The engine reports three metric sets, each labelled with its provenance so a reader
knows exactly how optimistic it is.

### 1.1 In-sample (apparent)

AI scores vs settled human labels on the **same** records the model trained on.
Optimistic — it measures fit, not generalisation. Shown for transparency; never the
headline number.

### 1.2 Held-out k-fold cross-validation

Stratified k-fold CV (default 5). For each fold the held-out records' labels are
**removed** (not merely unused) before training, the TF-IDF vocabulary is fit on the
training folds only, and the held-out fold is transformed against that train-only
vocabulary (strict anti-leakage). The pooled out-of-fold (score, label) pairs are the
honest inputs to `computeValidation` and to probability calibration. This is the
default headline estimate for a live project.

Requirements: enough labels that every training split still clears the supervised
thresholds with margin; otherwise CV reports `insufficient` rather than silently
measuring cold-start.

### 1.3 Unbiased random-sample estimate (66.md P4.6)

Even held-out CV inherits the bias of **which** records got labelled. When a seeded
uniform-random validation sample exists, the engine **also** cross-validates on the
sample's labels alone and reports it as `crossValUnbiased` with source
`random_sample`. Each metric set is tagged `random`, `prioritized`, or `mixed`.

---

## 2. Prioritized-screening bias and the seed sample

Active-learning prioritisation surfaces likely-includes first, so early human labels
are **not** a random sample of the corpus — they over-represent easy positives and the
negatives that happened to be adjacent. Metrics computed on that biased set overstate
real-world performance.

The fix is a **representative validation sample**: before or during screening, draw a
seeded uniform-random subset of records (seeded Fisher–Yates partial shuffle) and
persist the seed, method, and membership. As those records get labelled in the normal
workflow, they form an unbiased hold-out. Metrics computed on the random sample
estimate performance on the whole corpus, not just the prioritised head.

Because the seed is persisted, the sample — and every metric computed on it — is
reproducible.

---

## 3. Benchmark datasets

Loaders live in `scripts/benchmark/loaders.mjs`; the harness is
`scripts/screening-benchmark.mjs`.

- **`cohen`** — the bundled 15 Cohen-2006 drug-class-review datasets (the historical
  default; the only bundled family).
- **`synergy`** — the asreview/synergy-dataset (user-provided path; nothing bundled).
- **`clef`** — CLEF eHealth TAR 2017–2019 in a prepared layout (user-provided path).

A missing/empty path for `synergy`/`clef` prints setup instructions and exits
non-zero **without producing fabricated results**.

---

## 4. Metric definitions

- **ROC AUC** — probability a random positive outranks a random negative; via the
  Mann–Whitney rank-sum identity with average-rank tie handling. 0.5 = random.
- **WSS@r (Work Saved over Sampling at recall r, Cohen 2006)** —
  `WSS@r = (TN + FN)/N − (1 − r)`, evaluated at the rank where recall first reaches r.
  Operationally: rank by score descending, read until `ceil(r·P)` positives are found;
  the unread remainder is the work saved. Random ranking → ≈ 0 (can be slightly
  negative). WSS@95 and WSS@100 are both reported.
- **recall@k** — fraction of all positives captured in the top-k ranked records.
- **precision@k** — positives in the top-k divided by k.
- **Per-stage recall/precision** — quality after screening the top f·N records, for
  f ∈ {5, 10, 20, 40, 60, 80}%.
- **Held-out ECE** — nested-CV expected calibration error; the deployed panel's
  estimator, not the optimistic apparent ECE.

**Tie handling (pessimistic):** within an equal-score block, excludes are ranked above
includes before input index. This reports the worst case within ties — a conservative
lower bound for WSS / recall@k / the operating point — instead of letting arbitrary
input order inflate the estimate. (AUC is unaffected; it uses average-rank ties.)

---

## 5. Confidence intervals

95% **percentile bootstrap** CIs on the headline metrics (AUC, WSS@95, sensitivity),
resampling (score, label) pairs with a **seeded** PRNG (default 300 iterations). The
seed makes the interval deterministic — a hard requirement for a citable number.

---

## 6. Small-sample honesty

Below ~30 settled decisions, or fewer than 10 includes/excludes, metrics are flagged
unstable (`smallSampleWarning`). The recall-targeted operating point is flagged
`preliminary` below `minLabels` (30) or `minPositives` (10). These flags travel with
the metrics into the UI and exports so a reader never over-interprets a thin sample.

---

## 7. Recall-targeted operating point

The default decision threshold is chosen on held-out predictions to achieve the target
recall (default 0.95), not a balanced 0.5. It is reported with achieved recall,
specificity, precision, screened fraction, and work-saved fraction, and only drives
per-record predictions when the cross-validated estimate is reliable. Hand-computed
test cases: `tests/unit/screening/ai/recallThreshold.test.js`.

---

## 8. External validation — NOT yet performed

The estimates above are **internal**: held-out CV and a within-project random sample on
the same corpus a review is screening, plus retrospective benchmarks on public
datasets. None of the following has been done, and this document must not be read as
claiming otherwise:

- **Prospective external validation** on independent reviews not used in any tuning.
- **Cross-institution / cross-domain validation** beyond the mostly-clinical,
  English-language benchmark families.
- **Comparative trials** against other screening tools under a pre-registered protocol.
- **Reviewer-in-the-loop outcome studies** measuring real missed-include rates and time
  saved in production.

Establishing external validity would require: a pre-registered protocol; held-out
review corpora never seen during development; reporting per the relevant AI reporting
guidelines (e.g. TRIPOD+AI); and independent replication using the deterministic engine
and the committed benchmark harness. Until then, all performance claims are internal
and dataset-specific.

---

## 9. Reproducing

```
npm run test:screening-benchmark            # cohen family, 5-fold, seed 1337
npm run test:screening-benchmark -- --dataset synergy --path <dir>
npm run test:screening-benchmark -- --config v1-hybrid-legacy
```

Every JSON/CSV row records the engine config version and seed. The two reference
numbers cited in the model card (v2 AUC ≈ 0.858 / WSS@95 ≈ 0.303 on Cohen-2006) come
from the committed `config.js` comments; reproduce and extend them with the harness.
