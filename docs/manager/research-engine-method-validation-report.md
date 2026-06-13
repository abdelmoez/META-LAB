# META·LAB — Research-Engine Method Validation Report

*Author: Opus (methodology / statistics analyst). Date: 2026-06-13. Prompt: prompt12, FG9.*

Scope: validate the meta-analysis engine in `src/research-engine/statistics/meta-analysis.js`
(helpers in `math-helpers.js`), against its unit tests in `tests/unit/meta-analysis.test.js`.
For each method: implemented? formula correct? tests exist? edge cases? needs-improvement?

**Bottom line:** the engine is **methodologically sound and matches the published formulas**.
Every method named in FG9 is implemented and unit-tested. The Egger fix from prompt10 (weighted →
unweighted OLS) is correct and is pinned by a canonical 14-study fixture. **No incorrect math was
found. Do not change the math.** The only items are *enhancements*, not corrections, all
low-priority.

All line references are to `src/research-engine/statistics/meta-analysis.js` unless noted.

---

## 1. Fixed-effect (inverse-variance) — CORRECT

- **Implemented:** yes (`runMeta`, `method:"fixed"`). `w_i = 1/SE_i²` where `SE_i = (hi−lo)/(2·Z₉₇₅)`
  with `Z₉₇₅ = 1.959963984540054` (exact `qnorm(0.975)`, `math-helpers.js:9`). Pooled
  `μ = Σw·es / Σw` (:39); `SE = √(1/Σw)` (:61); CI = `μ ± Z₉₇₅·SE` (:135-136).
- **Formula check:** matches the standard IV fixed-effect estimator exactly. Recovering SE from a
  95% CI via `(hi−lo)/(2·Z₉₇₅)` is the correct inversion and is internally consistent with how every
  other method recovers SE.
- **Tests:** `method "fixed" gives fixed-effects result` + `tau2===0`; `pooled fixed ES equals
  weighted mean`; weight-percent sum ≈100. **Adequate.**
- **Edge cases:** `<2 valid studies → null` (:29); non-numeric `es/lo/hi` filtered (:25-28). Good.
- **Verdict:** correct. No change.

## 2. Random-effects (DerSimonian–Laird) — CORRECT

- **Implemented:** yes (default). τ² (DL) `= max(0, (Q − (k−1)) / (W − W₂/W))` with `W = Σw`,
  `W₂ = Σw²` (:45) — the textbook DL moment estimator. RE weights `w*_i = 1/(SE_i² + τ²)` (:48);
  pooled with `w*`; `SE = √(1/Σw*)` (:79).
- **Formula check:** matches DerSimonian–Laird (1986) exactly, including the `max(0, …)` truncation
  at zero (correct — τ² cannot be negative).
- **Tests:** `tau2` non-negative; random CI ≥ fixed CI when heterogeneity exists; both `fixed` and
  `random` blocks present; weight-percent sums ≈100. **Adequate.**
- **Verdict:** correct. No change.

## 3. Heterogeneity — Q, Q p-value, I², τ², τ — CORRECT

- **Q** `= Σ w_i (es_i − μ_fixed)²` (:40) — fixed-weight Cochran's Q, correct.
- **Q p-value** `= 1 − χ²CDF(Q, k−1)` (:74) via `chiSquareCDF` (regularised lower incomplete gamma,
  Numerical-Recipes `gammp`, `math-helpers.js:161-196`). Correct df = k−1.
- **I²** `= max(0, (Q − (k−1))/Q)·100` (:42) — Higgins & Thompson, correct, floored at 0.
- **I²desc** thresholds 25/50/75 (:75) — matches the conventional low/moderate/substantial/
  considerable bands (Cochrane Handbook).
- **τ / τ²** reported (:122,142). Correct.
- **Tests:** I² ∈[0,100]; Qpval ∈[0,1]; tau2 ≥0. **Adequate.**
- **Edge case:** `k≤1 → I²=0, Qpval=1` (guarded). Good.
- **Verdict:** correct. No change.

## 4. Confidence intervals — CORRECT

- Pooled CI `μ ± Z₉₇₅·SE` (:127-128); fixed/random sub-block CIs likewise (:135-141). Uses the exact
  `Z₉₇₅` constant, not a rounded 1.96. Correct and consistent.
- **Verdict:** correct.

## 5. Prediction interval — CORRECT (with a documented convention)

- **Implemented:** yes, `k≥3` (:106-116). `PI = μ ± t_{k−2}·√(τ² + SE_μ²)` (:108-109), with
  `t_{k−2}` from `tCrit(0.95, k−2)`.
- **Formula check:** this is the **Higgins–Thompson–Spiegelhalter (2009)** prediction interval. The
  use of `t` with **df = k−2** is the HTS convention (IntHout 2016 uses k−2). Some packages use
  k−1; k−2 is defensible and is the more conservative, widely-cited choice. **Not a bug** — a valid
  methodological convention. Worth one sentence in user-facing docs.
- **Tests:** present for k≥3; **null for k==2** (correctly gated). **Adequate.**
- **Verdict:** correct. *Enhancement only:* document the k−2 df choice in the Methods text.

## 6. HKSJ (Hartung–Knapp–Sidik–Jonkman) — CORRECT

- **Implemented:** yes, `k≥2` (:85-102). `q = (1/(k−1)) Σ w*_i (es_i − μ*)²` (:87);
  `SE_HKSJ = √q · √(1/Σw*)` (:88); CI/test use `t_{k−1}` (:89-96).
- **Formula check:** matches the standard HKSJ variance correction and t-reference. The
  `max(qHK, 1e-12)` floor (:88) is a sensible guard against a degenerate q=0.
- **Caveat (methodological, not a bug):** the well-known HKSJ pitfall is that when `q < 1` the HKSJ
  CI can become *narrower* than the DL CI (the "anti-conservative" case). The textbook ad-hoc fix is
  to truncate the multiplier at 1 (`max(q,1)`). The engine does **not** apply that truncation, so it
  reports the *pure* HKSJ. This matches `metafor`'s default (which also does not truncate) — so it is
  a defensible, package-consistent choice, **not an error**. If a more conservative behaviour is ever
  wanted, the one-line change is `Math.max(qHK, 1)`; do it only with a test.
- **Tests:** HKSJ present for k≥2, has `es`/`pval`. **Adequate** (no numeric fixture — see §13).
- **Verdict:** correct / package-consistent. *Optional enhancement:* expose a truncation toggle.

## 7. Egger's test — CORRECT (prompt10 fix verified)

- **Implemented:** yes, `k≥3` (`eggersTest`, :167-210). **Unweighted OLS** of the standard normal
  deviate `y = ES/SE` on precision `x = 1/SE`; intercept = Egger's bias coefficient; t-test with
  df = k−2.
- **prompt10 fix:** the earlier implementation applied inverse-variance weights (`w = 1/SE²`), which
  double-counts precision (y and x already carry 1/SE) and inflated the intercept/t/p. It was
  corrected to **ordinary least squares (all weights = 1)** — the canonical Egger 1997 method, which
  matches `metafor::regtest(model="lm")`. The code comment (:149-162) documents this precisely.
- **Formula check:** the closed-form OLS (:184-199) is correct: `slope`, `intercept`, residual
  variance `s² = SSE/(k−2)`, `SE(intercept) = √(s²·Sxx/denom)`, two-tailed t with df=k−2. Standard
  and correct.
- **Tests:** **strong.** A **canonical 14-study fixture** (`matches canonical UNWEIGHTED Egger`,
  test :214-236) pins `intercept ≈ 1.86`, `t ≈ 1.01`, `p ≈ 0.334`, and adds **regression guards**
  (`intercept < 2.5`, `p > 0.28`) to prevent silent reversion to the old weighted numbers (3.94 /
  1.42 / 0.181). Degenerate-SE → null is tested. **Excellent coverage.**
- **Verdict:** correct and well-pinned. **Do not touch.**

## 8. Trim-and-fill (Duval & Tweedie) — CORRECT (L0 estimator)

- **Implemented:** yes, `k≥3` (`trimFill`, :250-310). Iterative L0 estimator: rank by absolute
  deviation, `L0 = (4·Tn − n(n+1))/(2n−1)` (:282), `k0 = max(0, round(L0))`, determine side, impute
  mirror studies `2μ − es` with the same SE (:297-305), re-pool the augmented set.
- **Formula check:** L0 is the published Duval & Tweedie (2000) linear estimator; the mirror-imputation
  and re-pool are standard. Iteration capped at 30 with convergence on stable k0 (:273) — safe.
- **Edge handling:** if trimming leaves `<2` studies it restores the full set and breaks (:287) —
  prevents a degenerate pool. `k0≤0 → adjusted == base` (:290-292), tested.
- **Tests:** k0 non-negative integer; `imputed.length === k0`; adjusted is valid or equals base.
  **Adequate.** *Enhancement:* no fixture pinning a *known* k0 against R's `trimfill` — would
  strengthen but is not required (the structural tests are sound).
- **Verdict:** correct. *Optional:* add one numeric fixture vs `metafor::trimfill`.

## 9. Leave-one-out — CORRECT

- **Implemented:** yes, `k≥3` (`leaveOneOut`, :220-239). Re-runs `runMeta` on each (k−1) subset;
  returns omitted label/id + pES/CI/I²/p. Correct and simple.
- **Tests:** length=k; all fields present; pES finite; omittedId matches removed study. **Adequate.**
- **Verdict:** correct.

## 10. Influence diagnostics — CORRECT (DFFITS-style)

- **Implemented:** yes, `k≥3` (`influenceDiagnostics`, :321-347). Per-study leave-one-out:
  `dffit = (μ_full − μ_(−i)) / SE_full` (:334), τ²/I² drops, and an `influential` flag
  (`|dffit|>1 OR |ΔI²|>25`).
- **Formula check:** a reasonable standardized-influence (DFFITS-like) measure. The thresholds
  (|dffit|>1, ΔI²>25) are heuristic but conventional and clearly labeled. Not a published exact
  DFFITS (which uses the deleted SE), but a defensible practical influence score. **Not wrong** —
  document it as "DFFITS-style" (the code comment already does).
- **Tests:** length=k; all fields present; `influential` is boolean. **Adequate.**
- **Verdict:** correct for its stated purpose. *Enhancement:* note in docs it is DFFITS-style, not
  exact Cook's D.

## 11. Subgroup analysis — CORRECT

- **Implemented:** yes (`subgroupAnalysis`, :359-389). Runs `runMeta` per group level; Q-between
  `= max(0, Q_overall − Σ Q_within)` (:378-379), df = (#groups − 1), `p = 1 − χ²CDF(Qb, df)`.
- **Formula check:** the standard Q-between (analogue-to-ANOVA) test for subgroup differences.
  Correct. Missing group key → "Unspecified" (:362); needs ≥2 groups or returns null Qbetween.
- **Tests:** groups correctly partitioned; df = #groups−1; Qbetween ≥0; pBetween ∈[0,1]; single-group
  and missing-key cases tested. **Adequate.**
- **Caveat (minor):** Q-between is computed from each group's **own-model** Q summed against the
  overall Q. This is the common implementation; a purist random-effects subgroup test would pool with
  a common or separate τ². The current approach matches the typical fixed-effect Q-between and is
  acceptable; worth a docs note that subgroup tests assume the chosen model per group.
- **Verdict:** correct for the standard test.

## 12. Numerical helpers — SOUND

- `normalCDF` (Abramowitz–Stegun, max err ≈1.5e-7), `invNorm` (Acklam), `lgamma` (Lanczos),
  `betacf`/`ibeta` (Lentz continued fraction), `gammp` → `chiSquareCDF`, `tCDF`/`tCrit` (bisection)
  — all are standard, well-known approximations copied verbatim from the monolith to preserve exact
  numerical behaviour. `tCrit` falls back to the normal quantile when df is infinite/≤0 (:218).
  Tested in `tests/unit/math-helpers.test.js`. **Sound.**

---

## 13. Summary table

| Method | Implemented | Formula correct | Tests | Needs improvement |
|---|---|---|---|---|
| Fixed (IV) | ✓ | ✓ | ✓ | no |
| Random (DL τ²) | ✓ | ✓ | ✓ | no |
| Q / Qpval | ✓ | ✓ | ✓ | no |
| I² | ✓ | ✓ | ✓ | no |
| Confidence intervals | ✓ | ✓ | ✓ | no |
| Prediction interval | ✓ | ✓ (HTS, df=k−2) | ✓ | doc the df convention |
| HKSJ | ✓ | ✓ (metafor-consistent, untruncated) | ✓ (structural) | optional truncation toggle; add a numeric fixture |
| Egger (unweighted OLS) | ✓ | ✓ (prompt10 fix) | ✓✓ (canonical fixture + guards) | no |
| Trim-and-fill (L0) | ✓ | ✓ | ✓ (structural) | optional: 1 numeric fixture vs metafor |
| Leave-one-out | ✓ | ✓ | ✓ | no |
| Influence (DFFITS-style) | ✓ | ✓ (for stated purpose) | ✓ | doc "DFFITS-style" |
| Subgroup (Q-between) | ✓ | ✓ | ✓ | doc per-group model assumption |

## 14. Recommendations (all low-priority enhancements — no corrections needed)

1. **Leave the math alone.** Nothing is incorrect. The roadmap's own rule ("do not change correct
   math unnecessarily; fix incorrect math only with tests") applies — there is nothing to fix.
2. **Documentation, not code:** add Methods-text notes for (a) prediction-interval df = k−2 (HTS),
   (b) HKSJ untruncated / metafor-consistent, (c) influence is DFFITS-style, (d) subgroup Q-between
   model assumption. These are transparency wins, zero risk.
3. **Optional test strengthening (additive, safe):** add one numeric fixture each for trim-and-fill
   (vs `metafor::trimfill`) and HKSJ (vs `metafor::rma(test="knha")`), mirroring the excellent Egger
   fixture pattern. Pure test additions; no engine change.
4. **Caveat for the UI, not the engine:** because `runMeta` recovers SE from the 95% CI
   (`(hi−lo)/(2·Z₉₇₅)`), asymmetric or non-normal input CIs (e.g. exact small-sample CIs entered by
   the user) will be approximated as symmetric on the analysis scale. This is standard for CI-based
   MA input and already implied by the extraction model, but the Analysis Readiness layer
   (`checkPoolability`) is the right place to keep warning when CIs look implausible. No engine change.

**Net:** the research engine is publication-grade and correctly tested. This stage of the roadmap
(FG9) is **done**; the recommended actions are documentation and optional extra fixtures only.
