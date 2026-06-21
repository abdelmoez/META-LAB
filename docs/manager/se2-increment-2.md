# SE2 — Increment 2: probability calibration + statistically-grounded stopping rules

> Implements `se2.md` §8 (probability calibration) and §9 (stopping rules).
> Additive + flag-gated (`aiScreening`, default OFF). One additive nullable column
> (`ScreenAiScore.calibratedProba`), no destructive migration. The deterministic,
> reproducible, in-process engine philosophy is preserved — all new math is pure.

## What shipped

### §8 — Probability calibration
The engine's ranking `score ∈ [0,1]` (a fused hybrid signal) and the classifier
`proba` (a raw, class-weighted sigmoid) are **not** trustworthy probabilities, so a
threshold like 0.65 had no defensible probabilistic meaning. New pure module
`src/research-engine/screening/ai/calibration.js`:

- **Platt scaling** — `fitPlatt` via Newton–Raphson (`fit1DLogistic`) with Platt's
  (1999) target smoothing so tiny calibration sets don't overfit.
- **Isotonic regression** — `fitIsotonic` via Pool-Adjacent-Violators (PAVA),
  monotone non-decreasing, applied by clamped piecewise-linear interpolation.
- **Method selection by sample size** — `selectCalibrationMethod`: below the floor
  (`minSamplesToCalibrate` 50, or <5 per class) → **`none`** (identity; the UI shows
  the uncalibrated score, stated as such); small → **Platt** (stable); ≥
  `isotonicMinSamples` (200) → **isotonic**.
- **Honest inputs** — the calibrator is fit on the **out-of-fold** CV predictions
  (`crossValidate` now returns the pooled `oof:{scores,labels,ids}` it previously
  discarded), never on in-sample scores.
- **Metrics** — `calibrationMetrics`: Brier score, log loss, ECE (binned), calibration
  slope + intercept (logistic of label on `logit(p)`; ≈1 / ≈0 = well-calibrated), and
  reliability bins.

`runScoring` fits the calibrator after CV, maps every record's score → calibrated
`P(include)` (persisted in the new `ScreenAiScore.calibratedProba`, null when
uncalibrated), and stores the calibration metadata (method, params, metrics, reason)
in the run's `metricsJson.calibration`.

### §9 — Statistically-grounded stopping rules
New pure module `src/research-engine/screening/ai/stopping.js`:

- **Recall estimator ("calibrated probability mass")** — `estimateRecall`: with
  calibrated inclusion probabilities for the unscreened records, expected remaining
  eligible = Σ pᵢ; estimated recall = found / (found + Σ pᵢ). Uncertainty from the
  Poisson-binomial variance Σ pᵢ(1−pᵢ) → a normal-approx interval, propagated to a
  recall interval. The target is judged against the **conservative lower bound**.
- **Hard preconditions** — `stoppingPreconditions` suppresses any recommendation when:
  too few includes found, too few decisions, calibration is `none`/poor (high ECE),
  recent inclusion yield is still high, the model is unstable, or unresolved conflicts
  exist. Every violated precondition is reported.
- **Cautious wording** — `STOPPING_LANGUAGE`: "Estimated recall has reached the project
  target" + an explicit uncertainty caveat. The engine **never** says "safe to stop" or
  "all relevant studies have been found" (unit-test-enforced).
- **Retrospective** — `retrospectiveStopping`: WSS@95 / WSS@100 work-saved + a stage
  curve from the held-out (or in-sample) pairs (§9 + §13).

`runScoring` computes `evaluateStopping` over the project's settled/unscreened split and
stores it in `metricsJson.stopping`, including a partial-coverage note when the project
exceeds the per-run cap (full >5k scalability is Increment 3).

### Frontend (precise language, §14)
`src/frontend/screening/ai/AiAssist.jsx`:
- **`AiScoreCard`** now shows **"Calibrated inclusion probability"** as a distinct,
  labelled value, separate from the ranking score (the big number is now labelled
  "/100 ranking"). Distinguishes raw ranking score vs calibrated probability vs
  uncertainty (no more conflating them as "confidence").
- **`AiStatusPanel`** (leader view) gained a **Probability calibration** block (method,
  Brier, log loss, ECE, slope/intercept + an inline **reliability curve** SVG) and a
  **Stopping estimate** block (cautious headline, target/estimated recall + 95%
  interval, eligible found / est. remaining, recent include rate, retrospective WSS@95,
  preconditions when unavailable, and the uncertainty caveat).

## DB / API / files
- **DB (additive `prisma db push`):** `ScreenAiScore.calibratedProba Float?`
  (nullable). No destructive change; no new table; run/score history preserved.
- **API:** no new endpoints. Calibration + stopping ride in the existing
  `latestRun.metrics` (status + `GET /ai/validation`); `calibratedProba` rides in the
  inline `aiScore` on `listRecords` and in `GET /ai/scores`.
- **New:** `calibration.js`, `stopping.js`, `tests/unit/screening/ai/{calibration,stopping}.test.js`.
- **Changed:** engine `config.js` (calibration + stopping config), `index.js` (exports),
  `activeLearning.js` (`crossValidate` returns OOF), `screeningAiService.js` (fit/apply/
  estimate + persist + chronoLabels), `screeningController.js` (inline `calibratedProba`),
  `AiAssist.jsx`.

## Verified
- **+28 pure unit tests** (calibration: Platt/isotonic monotonicity, Brier/logloss/ECE,
  slope, method selection, end-to-end Brier reduction; stopping: estimator + bounds,
  preconditions, recommend-only-when-met, forbidden-wording guard, retrospective).
- **Full suite `npm run test:ci`: 1666 passed / 96 files** (was 1635). Production build
  green.
- **Real-DB smoke:** a 638-record project with only 6 labels → calibration correctly
  `none` (honest reason), stopping correctly **unavailable** with the exact failed
  preconditions, `calibratedProba` persisted (null). No misleading numbers on thin data.

## Adversarial review (8 agents, 5 lenses + verify) — 3 findings, all fixed
- **HIGH (fixed):** the per-run cap dropped unscreened records from the stopping
  estimate's remaining-eligible mass (R = Σ pᵢ), inflating `recallLo` and potentially
  emitting a **falsely-confident stop** on large over-cap projects (the cap was only an
  informational note, never gating the recommendation). Fix: partial coverage is now a
  **hard precondition** — when any unscreened record was left unscored, `stoppingPreconditions`
  fails and the recommendation is suppressed (`unscoredUnscreened` threaded through
  `evaluateStopping`; +2 unit tests).
- **LOW (fixed):** the recall interval used only Poisson-binomial sampling variance,
  ignoring the calibrator's estimation uncertainty → interval slightly too narrow.
  Documented as an explicit limitation in `estimateRecall` + the caveat.
- **LOW (fixed):** the stopping block is now wrapped in try/catch (mirroring the
  calibration block) so a stopping-estimate error can never lose the scoring run.

## Honesty & limitations (§19)
- The calibrator is fit on out-of-fold predictions, but reported calibration metrics are
  **apparent** (computed on the same OOF pairs); nested-CV is a later refinement —
  documented in-code and in the UI ("apparent calibration can be optimistic on small
  sets").
- The stopping estimate only sees the **scored (capped)** records; full coverage beyond
  the 5k per-run cap is Increment 3. The UI flags partial coverage.
- Stopping guidance is **decision support only** — never actionable on its own, never
  finalises/skips a record; the human-final-decision policy is unchanged.

## Next
- **Increment 3** (§7/§10/§11/§12): real biomedical embedding service, duplicate-
  detection calibration (`verified:false` → validated), model versioning/drift/rollback,
  and background-job scalability beyond the 5k cap.
