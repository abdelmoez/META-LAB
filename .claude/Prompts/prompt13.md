# META·LAB — fixes for the Sensitivity & Bias module

Two methods in META·LAB's Sensitivity & Bias tab diverge from the reference
implementation (R package `metafor`). Both were found during an external
validation in which every other method (pooling, CIs, I², Q, τ², prediction
interval, HKSJ interval, subgroup Q-between) matched metafor exactly.

The two issues are independent. Each prompt below is self-contained and includes
a unit-test fixture with metafor-verified expected values.

Shared test fixture (standardised mean difference, Cohen's d; k = 14):

```
es = [1.4623, 1.3832, 1.1427, -0.1032, -0.3918, 2.1994, 1.1561,
      0.0732, 0.7774, 0.1620, 0.1659, 0.5937, 0.6990, -0.3172]
se = [0.6017, 0.5950, 0.3946, 0.2377, 0.2289, 0.3028, 0.6237,
      0.5775, 0.2968, 0.5008, 0.5009, 0.2867, 0.2540, 0.3803]
```

R reference setup:

```r
library(metafor)
yi  <- c(1.4623,1.3832,1.1427,-0.1032,-0.3918,2.1994,1.1561,
         0.0732,0.7774,0.1620,0.1659,0.5937,0.6990,-0.3172)
sei <- c(0.6017,0.5950,0.3946,0.2377,0.2289,0.3028,0.6237,
         0.5775,0.2968,0.5008,0.5009,0.2867,0.2540,0.3803)
res <- rma(yi, sei = sei, method = "DL")
```

---

## Prompt 1 — Egger's regression test

```
TASK: Fix Egger's regression test so it matches the canonical Egger (1997) test
and metafor::regtest(model = "lm").

FILE / FUNCTION
  eggersTest() in src/research-engine/statistics/meta-analysis.js
  (UI runs the identical copy in meta-lab-3-patched.jsx — update both.)
  Update the "Egger's regression test" entry in the Methods & Equations page.

THE BUG
  The current code runs a WEIGHTED least-squares regression with weights
  w_i = 1/SE_i^2 of y_i = ES_i/SE_i on x_i = 1/SE_i. The canonical Egger test is
  an UNWEIGHTED ordinary least-squares regression of the standard normal deviate
  on precision. The 1/SE^2 weights double-count precision and change the
  intercept, t, and p-value.

THE FIX
  Use ordinary (unweighted) least squares. Concretely, set every regression
  weight to 1 (remove the 1/SE^2 weighting). Keep the rest of the structure.

  Over the k studies, with y_i = ES_i/SE_i and x_i = 1/SE_i:
    Sx = sum(x), Sy = sum(y), Sxx = sum(x^2), Sxy = sum(x*y)
    slope     b1 = (k*Sxy - Sx*Sy) / (k*Sxx - Sx^2)
    intercept b0 = (Sy - b1*Sx) / k            <- Egger's bias coefficient
    residuals e_i = y_i - (b0 + b1*x_i)
    s2 = sum(e_i^2) / (k - 2)
    SE(b0) = sqrt( s2 * Sxx / (k*Sxx - Sx^2) )
    t = b0 / SE(b0)        df = k - 2
    p = 2 * (1 - tCDF(|t|, k-2))
  Test asymmetry via the INTERCEPT b0. Keep k >= 3 and the p < 0.10 wording.

UNIT TEST (use the shared fixture above)
  EXPECTED AFTER FIX:   intercept ~ 1.86,  t ~ 1.01 (df 12),  p ~ 0.334
  CURRENT BUGGY OUTPUT: intercept ~ 3.94,  t ~ 1.42 (df 12),  p ~ 0.181
  R cross-check: regtest(res, model = "lm")  ->  t = 1.0059, df = 12, p = 0.3343

DOC UPDATE
  Change "weighted OLS, w = 1/SE^2" to "ordinary (unweighted) least squares of
  ES/SE on 1/SE". Reference: Egger M, Davey Smith G, Schneider M, Minder C.
  BMJ 1997;315:629-634.
```

---

## Prompt 2 — Trim-and-fill (Duval & Tweedie)

```
TASK: Reconcile trim-and-fill with metafor::trimfill so a random-effects
analysis returns the same number of imputed studies and adjusted estimate.

FILE / FUNCTION
  trimFill() in src/research-engine/statistics/meta-analysis.js
  (UI runs the identical copy in meta-lab-3-patched.jsx — update both.)
  Update the "Trim-and-fill (Duval-Tweedie L0)" entry in the Methods & Equations page.

THE BUG
  For a random-effects (DerSimonian-Laird) analysis, trim-and-fill imputes too
  many studies. The observed estimate shown is the random-effects pooled value
  (0.614 for the fixture), but the L0 trimming iteration centres/trims on a
  different, more fixed-effect-like estimate, so it over-imputes. The result
  matches neither metafor's random-effects nor fixed-effect trim-and-fill.

REQUIRED BEHAVIOUR
  The centre used in each L0 iteration (to compute deviations y_i - mu and the
  rank statistic) MUST be the pooled estimate under the currently selected model.
  When the headline model is random-effects, centre and re-estimate under
  random-effects throughout; impute and re-pool under the same model. This must
  reproduce metafor::trimfill(res) for a random-effects res.

  Algorithm (Duval-Tweedie L0), per iteration (max 30):
    1. mu = pooled estimate of the CURRENT (trimmed) set under the selected model.
    2. d_i = y_i - mu over the FULL set; R_i = rank(|d_i|).
    3. Tn = sum of R_i for studies on the heavier side (positive d_i if right-heavy).
    4. L0 = (4*Tn - n(n+1)) / (2n - 1);  k0 = max(0, round(L0)).
    5. Trim the k0 most extreme studies on the heavy side; repeat until k0 stable.
  Then impute k0 mirror studies (2*mu_final - y_i, same variance) and re-pool
  under the selected model for the adjusted estimate.

UNIT TEST (use the shared fixture above)
  EXPECTED, random-effects (DL):  k0 = 0,  adjusted = observed = 0.614 (no shift)
  EXPECTED, fixed-effect:         k0 = 4,  adjusted = 0.242
  CURRENT BUGGY (random headline): k0 = 3, adjusted = 0.320
  R cross-check:
    trimfill(res)                                 # 0 imputed, estimate 0.6137
    trimfill(rma(yi, sei = sei, method = "FE"))   # 4 imputed, estimate 0.2422

DOC UPDATE
  State explicitly which pooled estimate centres the L0 iteration (it should be
  the selected model) and that the adjusted estimate is re-pooled under the same
  model. Note that trim-and-fill is implementation-sensitive and that META·LAB
  now matches metafor::trimfill under the same model.
  Reference: Duval S, Tweedie R. Biometrics 2000;56:455-463.
```

---

## Acceptance summary

| Method | Current META·LAB | Target (metafor) |
|---|---|---|
| Egger intercept / t / p | 3.94 / 1.42 / 0.181 | 1.86 / 1.01 / 0.334 |
| Trim-and-fill k0 (random-effects) | 3 (estimate 0.614 → 0.320) | 0 (estimate unchanged, 0.614) |

After both fixes, re-run the shared fixture and confirm the targets above.
Neither change affects the rest of the engine (pooling, CIs, I², Q, τ²,
prediction interval, HKSJ, subgroup), which already matches metafor.
