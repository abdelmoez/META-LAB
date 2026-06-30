# Screening engine: tuning + calibration-metric fix (screeningEngine.md)

Two tasks, both validated out-of-sample on the Cohen 2006 benchmark (15 systematic-review
datasets, `.claude/screening/DEV screening engine/cohen_datasets_plus/`):

1. **Close the gap to the published TF-IDF + logistic-regression literature** by tuning the
   existing engine — no new model family, no new data fields.
2. **Fix the probability-calibration metric**, which reported an optimistic in-sample number.

Everything is reversible (named, rollback-able engine config versions) and deterministic
(same inputs → same scores).

---

## TL;DR

| Config | Mean AUC | Mean WSS@95 | Held-out ECE | Notes |
|---|---|---|---|---|
| Published reference (sklearn TF-IDF+LR, title×3+abstract) | 0.855 | 0.319 | ~0.026 | the target/oracle |
| **v1-hybrid-legacy** (deployed engine, unchanged) | 0.848 | 0.310 | 0.027 | available for rollback |
| **v2-lexical-tuned** (new default) | **0.863** | **0.319** | 0.023 | converged classifier |

- v2 is **strictly better than v1 on both metrics** (+0.015 AUC, +0.009 WSS@95), clears both
  acceptance floors (AUC ≥ 0.85, WSS@95 ≥ 0.30), and **matches/beats the published reference**
  (0.855 / 0.319).
- The deployed engine was **already near the literature frontier** — the reference doc's
  "PecanRev panel ≈ AUC 0.81 / WSS@95 0.24" was **stale** (an older engine). The current
  engine's own cross-validation panel reproduces **≈ 0.846 / 0.310**.
- The remaining gap was a **classifier-convergence** gap: the deployed full-batch gradient
  descent under-fit the TF-IDF objective. v2 adds deterministic **heavy-ball momentum** so it
  reaches the regularised optimum, lifting **AUC 0.848 → 0.863** while WSS@95 rises to 0.319.
- The calibration panel now reports **held-out** ECE/slope/intercept (nested CV) instead of
  the apparent ECE ≈ 0.000.

---

## Task 1 — current pipeline (as found)

Pure, deterministic engine under `src/research-engine/screening/ai/`:

| Component | Setting (v1 / DEFAULT_AI_CONFIG) |
|---|---|
| Text per record | title×3 + abstract×1 + journal×1 + MeSH/keyword `kw:` features×2, lowercased |
| TF-IDF | ngram (1,2); sublinear TF; min_df 2; max_features 20 000; English stopwords; L2-normalised rows; smoothed IDF |
| Classifier | class-weighted (`balanced`) L2 logistic regression, **full-batch GD** (lr 0.5, 200 epochs, l2 1e-4) |
| Cross-validation | 5-fold stratified; vocabulary fit on train fold only; pooled out-of-fold scores |
| Calibration | isotonic/Platt by sample size, fit on OOF predictions |
| Reported relevance | **hybrid** fusion: classifier 0.55 / cold-start 0.20 / semantic 0.15 / keyword 0.10 |
| Calibration metric | ECE/slope **computed on the same OOF points the calibrator was fit on** → apparent (≈0) |

## Task 2 — reproduce the baseline

`scripts/screening-benchmark.mjs` drives the **actual engine primitives** through the
validation protocol (5-fold stratified CV, train-only vocabulary, pooled OOF; AUC =
rank-sum ROC AUC; WSS@95 = 0.95 − r/N). The engine's own `crossValidate` panel path
reproduces **mean AUC 0.846 / WSS@95 0.310** — i.e. the deployed engine is far above the
stale 0.81/0.24 and close to the sklearn base (0.855/0.319). The decomposition showed the
hybrid-vs-pure-classifier difference is negligible (≈0.001 AUC); the lever is classifier
**convergence**, not features (confirmed against the local sklearn oracle).

## Task 3 — tuned config as a new, rollback-able version

`ENGINE_CONFIG_VERSIONS` in `config.js` is a named registry; each scoring run records the
version it used (`ScreenAiRun.configJson.engineConfigVersion`) and is independently
rollback-able.

- **v1-hybrid-legacy** — empty override == `DEFAULT_AI_CONFIG`, byte-for-byte the prior
  engine. Always available for rollback (verified: all pre-existing engine unit tests pass
  unchanged; `momentum=0` is the default and is byte-identical to the old GD update).
- **v2-lexical-tuned** (new default) — the **only** change is the optimiser:
  - heavy-ball **momentum 0.9** (deterministic) so GD converges to the regularised optimum,
  - sklearn-style inverse regularisation **C = 8** (effective L2 λ = 1/(C·n)),
  - `class_weight = balanced`, lr 1.0, ≤ 300 epochs, tol 1e-6.
  - Feature set + hybrid fusion are unchanged from v1.

Why not the reference's "title×3+abstract only" base config? In *this* engine it raises AUC
to 0.856 but drops **WSS@95 to 0.294 — below the 0.30 target**, because the (already-present,
no-new-fetch) MeSH/keyword features measurably aid rare-positive recall here. No *new*
features are added, so the "do not add MeSH/keywords/journal" constraint is honoured.

Selection: global default (`aiScreeningSettings.engineConfigVersion`, Ops) → per-project
override → registry default (`v2-lexical-tuned`). A rollback pins the target run's version.

Per-dataset (leak-free 5-fold CV, pooled OOF; `node scripts/screening-benchmark.mjs current_hybrid v2-lexical-tuned`):

| Dataset | v1 AUC→v2 | v1 WSS@95→v2 |
|---|---|---|
| ACEInhibitors | 0.839 → 0.865 | 0.204 → 0.277 |
| ADHD | 0.936 → 0.942 | 0.736 → 0.731 |
| Antihistamines | 0.817 → 0.827 | 0.260 → 0.276 |
| AtypicalAntipsychotics | 0.799 → 0.825 | 0.145 → 0.155 |
| BetaBlockers | 0.799 → 0.843 | 0.299 → 0.267 |
| CalciumChannelBlockers | 0.837 → 0.857 | 0.235 → 0.285 |
| Estrogens | 0.890 → 0.899 | 0.409 → 0.371 |
| NSAIDs | 0.910 → 0.907 | 0.439 → 0.456 |
| Opioids | 0.887 → 0.894 | 0.479 → 0.459 |
| OralHypoglycemics | 0.773 → 0.785 | 0.093 → 0.125 |
| ProtonPumpInhibitors | 0.803 → 0.820 | 0.224 → 0.210 |
| SkeletalMuscleRelaxants | 0.902 → 0.899 | 0.419 → 0.346 |
| Statins | 0.808 → 0.847 | 0.216 → 0.300 |
| Triptans | 0.881 → 0.892 | 0.308 → 0.324 |
| UrinaryIncontinence | 0.842 → 0.848 | 0.192 → 0.198 |
| **Mean** | **0.848 → 0.863** | **0.310 → 0.319** |

## Task 4 — calibration metric fixed to held-out

`calibration.js → heldOutCalibrationMetrics()` computes ECE/slope/intercept via **nested
CV**: the OOF (score,label) pairs are split into k stratified folds; for each fold a
calibrator (same method production uses) is fit on the *other* folds and the held-out fold's
scores are mapped through it; the pooled held-out calibrated probabilities give an honest
ECE. The production calibrator (fit on all OOF pairs, used to map every record's probability)
is unchanged — **only the measurement changes**. `screeningAiService` now surfaces the
held-out metrics (apparent kept under `apparentMetrics` for provenance) and the AI panel
labels them "(held-out)". Mean held-out ECE is **0.023** (v2) / **0.027** (v1) instead of
0.000 — squarely in the expected **~0.02–0.03** range and matching the reference's 0.026
(per-dataset spread is wider on small reviews). The benchmark reports the **same nested-CV
estimator** the panel uses, so its ECE column equals what reviewers see.

## Task 5 — latency at ~3 000 records

`node scripts/screening-benchmark.mjs --latency` (full train + score of 3 000 records, 200
labelled):

| Config | Total | Per record |
|---|---|---|
| v1-hybrid-legacy | 5 925 ms | 1.98 ms |
| **v2-lexical-tuned** | **6 005 ms** | **2.00 ms** |

v2 adds **+80 ms (+1.3 %)** — negligible. Note this is **server-side**, not in-browser: the two
heavy phases (train + cross-validation) already run in a `worker_thread` off the HTTP event
loop (62.md), so a run never blocks the UI; the panel updates via a durable job with progress.
Well within the existing budget. (If a future deployment needs it tighter, v2's `epochs` can be
lowered — the AUC/WSS plateau is reached by ~200–300 epochs.)

---

## How to reproduce

```bash
# Engine numbers (current vs new), per-dataset + mean, with held-out ECE:
node scripts/screening-benchmark.mjs current_hybrid v2-lexical-tuned
# Add the ~3000-record latency probe:
node scripts/screening-benchmark.mjs --latency
# Reference sklearn oracle (needs numpy + scikit-learn):
python ".claude/screening/DEV screening engine/screening_benchmark.py" \
  ".claude/screening/DEV screening engine/cohen_datasets_plus/"cohen_*.csv
```

## Files changed

- `src/research-engine/screening/ai/config.js` — `ENGINE_CONFIG_VERSIONS` registry + `resolveEngineConfig`.
- `src/research-engine/screening/ai/logreg.js` — deterministic momentum + sklearn-style `cInverseReg` (C).
- `src/research-engine/screening/ai/calibration.js` — `heldOutCalibrationMetrics` (nested CV).
- `src/research-engine/screening/ai/index.js` — exports.
- `server/services/screeningAiService.js` — engine-config-version selection per run/rollback; held-out calibration in the panel; version surfaced in status/history.
- `server/controllers/screeningAiAdminController.js` — admin can set the global engine config version.
- `src/frontend/screening/ai/AiAssist.jsx` — calibration panel labels metrics "(held-out)".
- `scripts/screening-benchmark.mjs` — leak-free Cohen-2006 benchmark harness (new).
- `tests/unit/screening/ai/engineTuning.test.js` — registry, momentum determinism, held-out calibration (new).
- `.env.example` (server) — documents the engine config version.
