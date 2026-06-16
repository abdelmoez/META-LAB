# Statistical Tests and Validation Rules

This document describes every statistical test and validation rule implemented
in the META·LAB Research Engine.

---

## 1. Meta-analysis Models (`statistics/meta-analysis.js`)

### 1.1 Fixed-Effects (Common-Effect) Model

Uses inverse-variance weighting.

```
w_i = 1 / SE_i²         (weight for study i)
SE_i = (hi - lo) / (2 × Z_0.975)

pooled ES = Σ(w_i × ES_i) / Σ(w_i)
pooled SE = √(1 / Σw_i)
95% CI: pooled ES ± 1.959963985 × pooled SE
```

**Z_0.975 = 1.959963984540054** (exact value of qnorm(0.975)).

The fixed-effects model assumes all studies estimate the same true effect.
Use it only when this assumption is scientifically justified.

---

### 1.2 Random-Effects Model (DerSimonian–Laird)

Adds between-study heterogeneity (τ²) to the within-study variance.

**τ² (DerSimonian–Laird estimator):**
```
τ² = max(0, (Q - (k-1)) / (W - W²/W))
  where W  = Σw_i
        W² = Σw_i²
        Q  = Σ w_i (ES_i - ES_fixed)²
```

**Random-effects weights:**
```
w*_i = 1 / (SE_i² + τ²)

pooled ES* = Σ(w*_i × ES_i) / Σw*_i
pooled SE* = √(1 / Σw*_i)
```

Both τ² and the fixed-effects estimate are always computed; the `method`
parameter controls which model's CI and p-value are promoted to the headline.
Both sets of weights are attached to every study in the output (`_wFixedPct`,
`_wRandomPct`).

---

### 1.3 Heterogeneity Statistics

**Q statistic (Cochran):**
```
Q = Σ w_i (ES_i - ES_fixed)²   ~  χ²(k-1) under H₀: τ²=0
```
P-value for Q is computed via `chiSquareCDF(Q, k-1)`.

**I² (Higgins & Thompson):**
```
I² = max(0, (Q - (k-1)) / Q) × 100%
```
Descriptive bands: < 25% low · 25–49% moderate · 50–74% substantial · ≥ 75% considerable.

**τ (between-study SD):**
```
τ = √τ²
```

---

### 1.4 Hartung–Knapp–Sidik–Jonkman (HKSJ) Adjustment

An alternative variance estimator for the random-effects model that uses a
t-distribution reference instead of normal. Recommended when k is small (< 10).

```
q_HK = [Σ w*_i (ES_i - ES*)²] / (k-1)
SE_HK = √(max(q_HK, 1e-12)) × √(1/Σw*_i)

CI: ES* ± t(k-1, 0.975) × SE_HK
t-statistic: ES* / SE_HK  ~  t(k-1) under H₀
```

**When to use:** Preferred over the normal approximation when k < 10. The
HKSJ interval is always reported alongside the standard random-effects interval.

---

### 1.5 Prediction Interval

Estimates where a *future* study's true effect would plausibly fall.
Requires k ≥ 3 (needs at least 2 df for t-distribution).

```
PI = ES* ± t(k-2, 0.975) × √(τ² + SE_μ²)
  where SE_μ = pooled SE of the random-effects estimate
```

A wide prediction interval spanning the null indicates that the treatment
may be ineffective (or harmful) in some populations even if the pooled
estimate is significant.

---

### 1.6 Overall p-value

Two-sided test of the null hypothesis that the pooled effect = 0:
```
z = ES_pooled / SE_pooled
p = 2 × (1 - Φ(|z|))
```

---

## 2. Publication-Bias Tests (`statistics/meta-analysis.js`)

### 2.1 Egger's Regression Test (unweighted OLS)

Tests for funnel-plot asymmetry, a proxy for small-study effects and
publication bias. This is the canonical Egger (1997) test and matches
`metafor::regtest(model = "lm")`.

Regresses the standard normal deviate (y = ES / SE) on precision (x = 1/SE)
by **ordinary, UNWEIGHTED least squares**. The intercept b₀ is Egger's bias
coefficient. The regression is intentionally unweighted: y and x already
embed the precision, so applying inverse-variance weights (w = 1/SE²) would
double-count it and inflate the intercept, t and p (it did not match Egger
1997 / metafor — fixed).
```
y = b₀ + b₁·x        (all weights = 1)

Sx = Σx, Sy = Σy, Sxx = Σx², Sxy = Σxy
slope     b₁ = (k·Sxy − Sx·Sy) / (k·Sxx − Sx²)
intercept b₀ = (Sy − b₁·Sx) / k          ← Egger's bias coefficient

s²        = Σ(y − ŷ)² / (k − 2)
SE(b₀)    = √( s² · Sxx / (k·Sxx − Sx²) )
t         = b₀ / SE(b₀)  ~  t(k − 2)
p         = 2 · (1 − T_cdf(|t|, k − 2))
```

**Interpretation:** A significant intercept (p < 0.10) suggests funnel
asymmetry. Requires k ≥ 3. A degenerate SE (≤ 0) makes the test not
computable (returns null).

---

### 2.2 Trim-and-Fill (Duval & Tweedie L0 Estimator)

Estimates the number of missing studies (k₀) needed to restore funnel
symmetry, imputes their mirror-image effects, and re-pools.

**Algorithm:**
1. Compute pooled mean μ (inverse-variance weighted).
2. Center observations, rank by absolute deviation, compute signed-rank
   sum T_n (positive-side ranks only) and S_r (signed ranks).
3. L0 = (4T_n - n(n+1)) / (2n-1); k₀ = max(0, round(L0)).
4. Trim k₀ most extreme observations, recompute μ, repeat until convergence
   (≤ 30 iterations).
5. Determine which side is over-represented from S_r sign.
6. Impute k₀ mirror-image studies: ES_imputed = 2μ - ES_extreme.
7. Pool augmented dataset.

**Output:** `{ k0, adjusted (pooled with imputed), imputed[], side, base }`.

**Limitation:** Trim-and-fill assumes asymmetry is purely due to publication
bias. Other causes of asymmetry (clinical heterogeneity, chance in small
meta-analyses) produce false-positive k₀ estimates.

---

## 3. Sensitivity Analyses (`statistics/meta-analysis.js`)

### 3.1 Leave-One-Out (LOO)

Removes each study in turn, re-pools the remaining k-1 studies, and reports:
- Pooled ES without the omitted study
- 95% CI and p-value
- I²

Requires k ≥ 3 (need at least 2 studies after removal).

Useful for identifying studies that drive the pooled estimate or inflate I².

---

### 3.2 Influence Diagnostics

Combines LOO results with a standardised influence score (DFFITS-style):
```
DFFIT_i = (ES_full - ES_without_i) / SE_full
```

A study is flagged as **influential** if:
- |DFFIT| > 1, OR
- The I² changes by more than 25 percentage points when it is omitted.

Also reports τ²-drop (how much between-study heterogeneity the study adds).

---

## 4. Subgroup Analysis (`statistics/meta-analysis.js`)

Runs `runMeta` within each level of a chosen grouping variable.

**Between-group Q test:**
```
Q_between = Q_overall - Σ Q_within_groups  (approximate)
p ≈ 1 - χ²CDF(Q_between, df = n_groups - 1)
```

**Limitation:** This test assumes no within-group heterogeneity and has low
power with few studies per subgroup. Pre-specification is required to avoid
inflated false-positive rates.

---

## 5. Math Library (`statistics/math-helpers.js`)

### 5.1 normalCDF(z)
Abramowitz & Stegun rational approximation (max error ≈ 1.5 × 10⁻⁷).

### 5.2 invNorm(p)
Acklam's rational approximation of the inverse normal CDF.
Three-region algorithm: lower tail (p < 0.02425), central (p ≤ 0.97575), upper tail.

### 5.3 chiSquareCDF(x, df)
`chiSquareCDF(x, df) = gammp(df/2, x/2)`
where `gammp` is the regularised lower incomplete gamma P(a, x) computed via
Numerical Recipes series (x < a+1) or continued fraction (otherwise).

### 5.4 tCDF(t, df)
`tCDF(t, df) = 1 - 0.5 × I_x(df/2, 0.5)` for t > 0, where x = df/(df+t²).
`ibeta` uses Lentz continued fraction.

### 5.5 tCrit(conf, df)
Bisection search on tCDF over [0, 200] to find t* such that P(-t* < T < t*) = conf.
Falls back to `invNormAbs` when df is infinite.

---

## 6. Per-Study Validation Rules (`validation/study-validator.js`)

`validateStudy(s)` checks each study and returns a list of
`{ sev: "error"|"warn", field, msg }` objects.

### Error conditions (will block analysis if not resolved):
| Rule | Trigger |
|---|---|
| Group sizes mismatch | `nExp + nCtrl` differs from `n` by more than 0.5 |
| Negative SD | `sdExp` or `sdCtrl` < 0 |
| Negative count | Any of n, a, b, c, d, events, total, tp, fp, fn, tn < 0 |
| Zero 2×2 group | `a+b = 0` or `c+d = 0` |
| Events exceed total | `events > total` for single-arm proportion |
| CI inverted | `lo > hi` |
| ES outside CI | `es < lo` or `es > hi` (tolerance 1e-6) |

### Warning conditions (informational, do not block):
| Rule | Trigger |
|---|---|
| No author | `author` is empty |
| No year | `year` is empty |
| No outcome | `outcome` is empty |
| Partial 2×2 | Some but not all of a, b, c, d are filled |
| Partial diagnostic 2×2 | Some but not all of tp, fp, fn, tn are filled |
| ES without CI | `es` present but `lo` and `hi` absent |
| CI without ES | `lo` or `hi` present but `es` absent |
| No effect-measure type | `esType` not set when `es` is present |
| Probable raw ratio | OR/RR/HR with `es > 1.6` and `lo > 0.3` (likely not log-transformed) |
| Means without SDs | Continuous means entered but no SDs and no direct ES |
| "do not pool" flag | `noconfirm` in flags |
| High-risk flag | `highrisk` in flags |
| Converted without source | `converted=true` or `conv` flag but `source` is empty |
| Figure flag mismatch | `figure` flag but `source !== "figure"` |
| Converted without record | `converted=true` but `conversions` array is empty |

---

## 7. Analysis-Type Warnings (`validation/study-validator.js`)

`analysisTypeWarnings(studies)` flags cross-study mismatches between raw data
and the chosen effect measure.

| Condition | Severity |
|---|---|
| Two-arm 2×2 data (a/b/c/d) present but esType = PROP | error |
| esType = OR or RR but only single-arm events/total (no 2×2) | warn |
| Continuous means/SDs present but esType = OR, RR, or PROP | warn |
| Complete 2×2 present but esType = SMD or MD (no continuous data) | warn |
| Diagnostic cells (tp/fp/fn/tn) present but esType ≠ DIAG | warn |

---

## 8. Poolability Gate (`validation/study-validator.js`)

`checkPoolability(studies)` evaluates whether studies should be pooled at all.
Returns `{ ok, blockers[], warnings[], valid[], composition }`.

**Hard blockers (ok = false):**
- Fewer than 2 studies with a usable ES + CI.
- Mixed effect measures (e.g. OR alongside SMD).
- Any study flagged `noconfirm`.

**Warnings (ok can still be true):**
- Some studies have no `esType` set.
- Mixed study designs (RCTs with observational studies).
- Multiple time points present.
- Mix of unadjusted and adjusted estimates.
- Studies label different outcomes.
- Mixed data roles (primary vs. secondary/subgroup/post-hoc).
- ≥ 50% of pooled values are non-primary.
- Converted values mixed with non-converted, with unlabelled conversions.

---

## 9. Effect-Size Calculators (`effect-sizes/calculators.js`)

All calculators use the standard normal z = 1.96 for 95% CI construction.

| Type | Formula |
|---|---|
| SMD | Cohen's d = (m1-m2)/SD_pooled; SE = √((n1+n2)/(n1·n2) + d²/(2(n1+n2))) (large-sample variance of d) |
| MD  | m1-m2; SE = √(SD1²/n1 + SD2²/n2) |
| OR  | ln(ad/bc); SE = √(1/a+1/b+1/c+1/d); Haldane–Anscombe +0.5 if any cell = 0 |
| RR  | ln[(a/(a+b)) / (c/(c+d))]; SE = √(1/a - 1/(a+b) + 1/c - 1/(c+d)); Haldane–Anscombe +0.5 if any cell = 0 |
| RD  | a/(a+b) − c/(c+d); SE = √(p₁(1-p₁)/n₁ + p₂(1-p₂)/n₂) (Wald; zeros natural, no correction) |
| HR  | ln(HR); SE = (ln(hi)-ln(lo))/(2×1.96) |
| COR | Fisher z = 0.5×ln((1+r)/(1-r)); SE = 1/√(n-3) |
| PROP | logit(p) with 0.5 correction at extremes; SE = 1/√(n×p×(1-p)) |
| DIAG | ln(TP×TN / FP×FN); SE = √(1/TP+1/FP+1/FN+1/TN); Haldane correction |

**Note on the SMD:** the implementation is **Cohen's d** (pooled-SD
standardiser). The Hedges' g small-sample correction
J = 1 − 3/(4(n1+n2−2) − 1) is **not** applied; d therefore slightly
overestimates the population effect in small samples. Applying the J
correction is a recommended next step — it would change every SMD result
(and the pinned unit-test expectations), so it must be introduced
deliberately, not silently.

**Note on zero cells (dichotomous measures).** A zero event count is valid
clinical data, not an error. For **OR/RR** (computed on the log scale) a
single zero cell makes the log/SE undefined, so a **Haldane–Anscombe
continuity correction** adds 0.5 to all four cells when any cell is 0; the
result is flagged (`continuityCorrectionApplied`, `correctionMethod =
"Haldane-Anscombe"`). A **double-zero-event** table (a = 0 and c = 0) carries
no information about a relative effect and is returned as **not estimable** —
use **RD** (Risk Difference), whose absolute scale admits zero cells without
correction. Negative, non-integer and missing counts remain hard errors.

---

## 10. Data Conversions (`conversions/catalogue.js`)

| ID | Formula | Reference |
|---|---|---|
| median_iqr | mean ≈ (Q1+med+Q3)/3; SD ≈ (Q3-Q1)/[2Φ⁻¹((0.75n-0.125)/(n+0.25))] | Wan et al. 2014 |
| median_range | mean ≈ (min+2med+max)/4; SD ≈ (max-min)/[2Φ⁻¹((n-0.375)/(n+0.25))] | Wan 2014 / Hozo 2005 |
| se_sd | SD = SE × √n | — |
| ci_sd | SD = √n × (hi-lo) / (2×1.96) | — |
| pval_se | z = Φ⁻¹(1-p/2); SE = |effect|/z | — |
| pct_events | events = round(% / 100 × n) | — |
| events_pct | % = events / n × 100 | — |
| ratio_log | lnES = ln(est); SE = (ln(hi)-ln(lo))/(2×1.96) | — |
| unit_scale | converted = value × factor | — |

---

## 11. Golden-test validation method & tolerances (roadmap 0.1)

The statistics engine is locked by golden tests under `tests/unit/statistics/**`,
backed by canonical datasets in `tests/fixtures/meta/canonical.js`. Because R is
not available inside CI, two kinds of **external reference** are used (neither is
read back from the engine under test):

1. **Hand-computed fixtures** (`HC2`, `HC3`) — tiny datasets whose every pooled
   quantity is worked out by hand from the formulae in §1–§3 (the arithmetic is
   written out in the fixture comments). These give an absolute, auditable anchor
   that is independent of the engine's code path.
2. **metafor-pinned fixture** (`D14`, 14 Cohen's d studies) — pinned literals from
   R `metafor` 4.x: `rma(method="DL")` pooled = **0.6137**;
   `regtest(model="lm")` intercept **1.86** / t **1.01** / p **0.334**;
   `trimfill` RE **k0=0** (no shift), FE **k0=4** / adjusted **0.2422** (side left).
3. **Independent reimplementation cross-checks** — for derived quantities (fixed/
   random pooled ES & SE, Q, I², τ²) the test recomputes the published formula
   inline from raw inputs and asserts the engine matches it (two independent
   implementations agreeing).

| Quantity | Reference | Tolerance |
|---|---|---|
| Fixed/random pooled ES, pooled SE | hand-computed (HC2/HC3) | abs `1e-9` (`toBeCloseTo(.,9)`) |
| Q, I², τ², τ | hand-computed (HC2/HC3) | abs `1e-9` |
| Engine vs. independent reimplementation (ES, SE, Q, τ²) | inline reference | abs `1e-12` |
| HKSJ SE / t / df | hand-computed (HC3) | abs `1e-9` / exact df |
| z statistic | hand-computed (HC3) | abs `1e-9` |
| Two-sided p (z-test) | Φ from §6 | abs `5e-4` (`toBeCloseTo(.,3)`) |
| DL pooled (D14) | metafor `rma(DL)` | abs `5e-4` (`toBeCloseTo(.,3)`) |
| Egger intercept / t | metafor `regtest(lm)` | abs `0.05` (`toBeCloseTo(.,1)`) |
| Egger p | metafor `regtest(lm)` | abs `5e-3` (`toBeCloseTo(.,2)`) |
| Trim-and-fill k0 | metafor `trimfill` | exact integer |
| Trim-and-fill adjusted ES | metafor `trimfill` | abs `5e-4` (`toBeCloseTo(.,3)`) |

**Guard test.** `tests/unit/statistics/contract-coverage.test.js` fails if any
export of `statistics/meta-analysis.js` or `statistics/math-helpers.js` is missing
from `agent-contract.md` — keeping the binding contract in sync with the code.

**CI deploy gate.** `.github/workflows/deploy.yml` runs `npm run test:ci` (this
golden suite + all pure units) as a `test` job that the `deploy` job `needs:`; a
failing statistics test provably blocks the production deploy. The
Egger/trim-fill side-rule caveat from §2 still applies (near-symmetric funnels).

---

## 12. Inter-rater agreement (`screening/agreement.js`, roadmap 1.3)

### 12.1 Cohen's κ (two raters)
```
po = observed agreement (proportion of items both raters labelled the same)
pe = Σ_k p1k · p2k          (chance agreement; p_·k = each rater's marginal)
κ  = (po − pe) / (1 − pe)
SE = √( po(1−po) / (n(1−pe)²) )      (normal approximation)
95% CI: κ ± 1.959963984540054 · SE
```

### 12.2 Fleiss' κ (m raters, constant per subject)
```
P_i  = (Σ_j n_ij² − m) / (m(m−1))           per-subject agreement
Pbar = mean_i P_i
p_j  = (1/(N·m)) Σ_i n_ij                    category proportion
Pe   = Σ_j p_j²
κ    = (Pbar − Pe) / (1 − Pe)
Asymptotic SE under H0:κ=0 (Fleiss, Levin & Paik 2003):
  A = Σ_j p_j(1−p_j) ; B = Σ_j p_j(1−p_j)(1−2p_j)
  SE = √(2(A² − B)) / (A · √(N·m·(m−1)))
```

### 12.3 Interpretation bands (Landis & Koch 1977, inclusive upper bounds)
`<0` poor · `≤0.20` slight · `≤0.40` fair · `≤0.60` moderate · `≤0.80` substantial · else almost perfect.

### 12.4 Validation method & tolerances
Validated against **hand-computed** worked examples (the arithmetic is written
out in `tests/unit/screening/agreement.test.js`), per roadmap A.3 ("hand-computed
κ for agreement"):

| Quantity | Example | Expected | Tolerance |
|---|---|---|---|
| Cohen κ, po, pe | 2×2: 20/15/5/10 (n=50) | κ=0.40, po=0.70, pe=0.50 | abs `1e-9` |
| Cohen SE | same | 0.129615 | abs `1e-5` |
| Fleiss κ, Pbar, Pe | [[3,0],[0,3],[2,1]] | κ=0.5500, Pbar=0.77778, Pe=0.50617 | abs `1e-4` |
| Fleiss SE (H0) | same | 0.333348 | abs `1e-4` |

### 12.5 Reproducible sampling (`screening/sampling.js`)
`seededSample(items, n, seed)` draws a calibration subset deterministically from a
stored integer seed (mulberry32 PRNG + seeded Fisher–Yates), so a pilot sample is
re-derivable and auditable (PART A.5). The same seed always reproduces the same
indices.
