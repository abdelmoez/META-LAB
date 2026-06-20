/**
 * methods-content.js
 * Content for the "Methods & Equations" reference tab (prompt6 Task 13).
 *
 * Engine-owned data module: every entry documents ONE statistical method that
 * is ACTUALLY IMPLEMENTED in the research engine (and the monolith's verbatim
 * runtime copies in meta-lab-3-patched.jsx). Equations were verified
 * symbol-for-symbol against the source files listed in `implementedIn`:
 *   - src/research-engine/statistics/meta-analysis.js
 *   - src/research-engine/statistics/math-helpers.js
 *   - src/research-engine/effect-sizes/calculators.js
 *   - src/research-engine/conversions/catalogue.js
 *   - src/research-engine/screening/deduplication.js
 *
 * Entry shape (contract — consumed by the monolith MethodsTab and
 * tests/unit/methods-content.test.js):
 *   {
 *     id:            string   — unique kebab-case id
 *     title:         string   — display title
 *     equations:     Array<{label: string, text: string}> — plain Unicode math
 *     plainEnglish:  string   — what it does, for researchers
 *     usedIn:        string   — actual UI surface(s) where the method runs
 *     implementedIn: string   — real function name(s) + file(s)
 *     references:    string[] — verified citations only (do NOT add extras)
 *     limitations:   string   — assumptions / caveats
 *     verified:      boolean  — false ⇒ render a "needs verification" badge
 *   }
 *
 * Do NOT "round out" the reference list with plausible extras — the citation
 * whitelist is a reviewed contract (see docs/manager/team-opinion-and-
 * implementation-plan.md §4 and the research-engine opinion file).
 */

// ── Canonical verified references (the whitelist) ────────────────────────────
const REF = {
  COCHRAN_1954:
    'Cochran WG. The combination of estimates from different experiments. Biometrics 1954;10:101-129.',
  DERSIMONIAN_LAIRD_1986:
    'DerSimonian R, Laird N. Meta-analysis in clinical trials. Control Clin Trials 1986;7:177-188.',
  HIGGINS_THOMPSON_2002:
    'Higgins JPT, Thompson SG. Quantifying heterogeneity in a meta-analysis. Stat Med 2002;21:1539-1558.',
  HARTUNG_KNAPP_2001:
    'Hartung J, Knapp G. On tests of the overall treatment effect in meta-analysis with normally distributed responses. Stat Med 2001;20:1771-1782.',
  SIDIK_JONKMAN_2002:
    'Sidik K, Jonkman JN. A simple confidence interval for meta-analysis. Stat Med 2002;21:3153-3159.',
  INTHOUT_2014:
    'IntHout J, Ioannidis JPA, Borm GF. The Hartung-Knapp-Sidik-Jonkman method for random effects meta-analysis is straightforward and considerably outperforms the standard DerSimonian-Laird method. BMC Med Res Methodol 2014;14:25.',
  HIGGINS_2009_PI:
    'Higgins JPT, Thompson SG, Spiegelhalter DJ. A re-evaluation of random-effects meta-analysis. J R Stat Soc Ser A 2009;172:137-159.',
  RILEY_2011:
    'Riley RD, Higgins JPT, Deeks JJ. Interpretation of random effects meta-analyses. BMJ 2011;342:d549.',
  EGGER_1997:
    'Egger M, Davey Smith G, Schneider M, Minder C. Bias in meta-analysis detected by a simple, graphical test. BMJ 1997;315:629-634.',
  DUVAL_TWEEDIE_2000:
    'Duval S, Tweedie R. Trim and fill: a simple funnel-plot-based method of testing and adjusting for publication bias in meta-analysis. Biometrics 2000;56:455-463.',
  VIECHTBAUER_CHEUNG_2010:
    'Viechtbauer W, Cheung MWL. Outlier and influence diagnostics for meta-analysis. Res Synth Methods 2010;1:112-125.',
  BORENSTEIN_2009:
    'Borenstein M, Hedges LV, Higgins JPT, Rothstein HR. Introduction to Meta-Analysis. Wiley 2009.',
  COHEN_1988:
    'Cohen J. Statistical Power Analysis for the Behavioral Sciences. 2nd ed. Lawrence Erlbaum 1988.',
  HEDGES_OLKIN_1985:
    'Hedges LV, Olkin I. Statistical Methods for Meta-Analysis. Academic Press 1985.',
  FISHER_1921:
    'Fisher RA. On the "probable error" of a coefficient of correlation deduced from a small sample. Metron 1921;1:3-32.',
  GLAS_2003:
    'Glas AS, Lijmer JG, Prins MH, Bonsel GJ, Bossuyt PMM. The diagnostic odds ratio: a single indicator of test performance. J Clin Epidemiol 2003;56:1129-1135.',
  HALDANE_1956:
    'Haldane JBS. The estimation and significance of the logarithm of a ratio of frequencies. Ann Hum Genet 1956;20:309-311.',
  TIERNEY_2007:
    'Tierney JF, Stewart LA, Ghersi D, Burdett S, Sydes MR. Practical methods for incorporating summary time-to-event data into meta-analysis. Trials 2007;8:16.',
  PARMAR_1998:
    'Parmar MK, Torri V, Stewart L. Extracting summary statistics to perform meta-analyses of the published literature for survival endpoints. Stat Med 1998;17:2815-2834.',
  COCHRANE_6_3:
    'Cochrane Handbook for Systematic Reviews of Interventions, version 6, section 6.3.',
  COCHRANE_6_5_2:
    'Cochrane Handbook for Systematic Reviews of Interventions, version 6, section 6.5.2.',
  WAN_2014:
    'Wan X, Wang W, Liu J, Tong T. Estimating the sample mean and standard deviation from the sample size, median, range and/or interquartile range. BMC Med Res Methodol 2014;14:135.',
  HOZO_2005:
    'Hozo SP, Djulbegovic B, Hozo I. Estimating the mean and variance from the median, range, and the size of a sample. BMC Med Res Methodol 2005;5:13.',
  LEVENSHTEIN_1966:
    'Levenshtein VI. Binary codes capable of correcting deletions, insertions, and reversals. Sov Phys Dokl 1966;10:707-710.',
  JACCARD_1912:
    'Jaccard P. The distribution of the flora in the alpine zone. New Phytol 1912;11:37-50.',
  ABRAMOWITZ_STEGUN_1964:
    'Abramowitz M, Stegun IA. Handbook of Mathematical Functions. National Bureau of Standards 1964.',
  NUMERICAL_RECIPES:
    'Press WH, Teukolsky SA, Vetterling WT, Flannery BP. Numerical Recipes: The Art of Scientific Computing. Cambridge University Press.',
  LANCZOS_1964:
    'Lanczos C. A precision approximation of the gamma function. SIAM J Numer Anal 1964;1:86-96.',
};

const ENGINE_META = 'src/research-engine/statistics/meta-analysis.js (UI runs the identical copy in meta-lab-3-patched.jsx)';
const ENGINE_CALC = 'src/research-engine/effect-sizes/calculators.js (UI runs the identical copy in meta-lab-3-patched.jsx)';
const ENGINE_CONV = 'src/research-engine/conversions/catalogue.js (UI runs the identical copy in meta-lab-3-patched.jsx)';

export const METHODS_CONTENT = [
  // ── 1. Pooling models ──────────────────────────────────────────────────────
  {
    id: 'fixed-effect-inverse-variance',
    title: 'Inverse-variance fixed-effect model',
    equations: [
      { label: 'Standard error from the reported 95% CI', text: 'SEᵢ = (hiᵢ − loᵢ) / (2 × 1.959963984540054)' },
      { label: 'Study weight', text: 'wᵢ = 1 / SEᵢ²' },
      { label: 'Pooled effect', text: 'ES_fixed = Σ(wᵢ × ESᵢ) / Σwᵢ' },
      { label: 'Pooled standard error', text: 'SE_fixed = √(1 / Σwᵢ)' },
    ],
    plainEnglish:
      'Each study contributes in proportion to its precision: studies with narrower confidence intervals (smaller standard errors) get larger weights. The pooled estimate is the weighted average of the study effects under the assumption that every study estimates the same single true effect.',
    usedIn: 'Analysis tab and Forest plot tab (model = "fixed"; the fixed-effect estimate is always reported alongside the random-effects estimate for comparison).',
    implementedIn: 'runMeta(studies, "fixed") — ' + ENGINE_META,
    references: [REF.BORENSTEIN_2009],
    limitations:
      'Assumes a single common true effect across all studies; inappropriate when real between-study heterogeneity exists. Each study SE is back-derived from its reported 95% CI assuming normality and a symmetric interval.',
    verified: true,
  },
  {
    id: 'cochran-q',
    title: "Cochran's Q heterogeneity test",
    equations: [
      { label: 'Q statistic', text: 'Q = Σ wᵢ (ESᵢ − ES_fixed)²' },
      { label: 'p-value (chi-square, df = k − 1)', text: 'p = 1 − χ²CDF(Q, k − 1)' },
    ],
    plainEnglish:
      'Tests whether the observed spread of study effects is larger than would be expected from sampling error alone. A small p-value suggests the studies do not all share the same true effect (heterogeneity).',
    usedIn: 'Analysis tab heterogeneity panel; also reported per subgroup in the Subgroup tab.',
    implementedIn: 'runMeta() — ' + ENGINE_META,
    references: [REF.COCHRAN_1954],
    limitations:
      'Low statistical power with few studies and over-sensitivity with many studies; a non-significant Q does not prove homogeneity. Uses fixed-effect weights by construction.',
    verified: true,
  },
  {
    id: 'i-squared',
    title: 'I² heterogeneity index',
    equations: [
      { label: 'I²', text: 'I² = max(0, (Q − (k − 1)) / Q) × 100%' },
      { label: 'Descriptive bands', text: '< 25% low · 25–49% moderate · 50–74% substantial · ≥ 75% considerable' },
    ],
    plainEnglish:
      'The percentage of total variability across studies that is attributable to real between-study heterogeneity rather than chance. Unlike Q, it does not depend directly on the number of studies.',
    usedIn: 'Analysis tab heterogeneity panel, Forest plot tab footer, Sensitivity tab (leave-one-out I² shifts), Subgroup tab.',
    implementedIn: 'runMeta() — ' + ENGINE_META,
    references: [REF.HIGGINS_THOMPSON_2002],
    limitations:
      'I² is an uncertain estimate in small meta-analyses; its confidence interval (not computed here) can be very wide. The verbal bands are conventions, not strict thresholds.',
    verified: true,
  },
  {
    id: 'dersimonian-laird-tau2',
    title: 'DerSimonian–Laird τ² estimator',
    equations: [
      { label: 'Between-study variance (method of moments)', text: 'τ² = max(0, (Q − (k − 1)) / (W − W₂/W)),  where W = Σwᵢ,  W₂ = Σwᵢ²' },
      { label: 'Between-study SD', text: 'τ = √τ²' },
    ],
    plainEnglish:
      'Estimates how much the true effects themselves vary from study to study. It is added to each study’s own sampling variance when computing random-effects weights. τ² is always computed so both models can be reported side by side.',
    usedIn: 'Analysis tab (random-effects model and heterogeneity panel), Forest plot tab, Sensitivity tab (τ² shifts in influence diagnostics).',
    implementedIn: 'runMeta() — ' + ENGINE_META,
    references: [REF.DERSIMONIAN_LAIRD_1986],
    limitations:
      'A method-of-moments estimator that can be biased with few studies; iterative estimators such as REML or Paule-Mandel are not implemented (truncation at 0 means τ² is never negative).',
    verified: true,
  },
  {
    id: 'random-effects-dl',
    title: 'DerSimonian–Laird random-effects model',
    equations: [
      { label: 'Random-effects weight', text: 'w*ᵢ = 1 / (SEᵢ² + τ²)' },
      { label: 'Pooled effect', text: 'ES* = Σ(w*ᵢ × ESᵢ) / Σw*ᵢ' },
      { label: 'Pooled standard error', text: 'SE* = √(1 / Σw*ᵢ)' },
    ],
    plainEnglish:
      'Allows the true effect to differ between studies: each study’s weight combines its own sampling variance with the between-study variance τ². The pooled value estimates the mean of the distribution of true effects, and weights are more equal across studies than under the fixed-effect model.',
    usedIn: 'Analysis tab and Forest plot tab (model = "random", the default); both fixed and random weight percentages are shown for every study.',
    implementedIn: 'runMeta(studies, "random") — ' + ENGINE_META,
    references: [REF.DERSIMONIAN_LAIRD_1986, REF.BORENSTEIN_2009],
    limitations:
      'The standard random-effects CI uses a normal reference and can be too narrow when k is small — compare with the HKSJ interval, which is always reported alongside. Requires at least 2 studies with a usable effect and CI.',
    verified: true,
  },
  {
    id: 'z-statistic-p-value',
    title: 'z statistic and two-sided p-value',
    equations: [
      { label: 'z statistic', text: 'z = ES_pooled / SE_pooled' },
      { label: 'Two-sided p-value', text: 'p = 2 × (1 − Φ(|z|))' },
    ],
    plainEnglish:
      'Tests the null hypothesis that the pooled effect equals zero (no effect) by comparing the pooled estimate to its standard error against the standard normal distribution.',
    usedIn: 'Analysis tab headline result and Forest plot tab summary row (both models).',
    implementedIn: 'runMeta() with normalCDF() — ' + ENGINE_META + ' and src/research-engine/statistics/math-helpers.js',
    references: [REF.BORENSTEIN_2009],
    limitations:
      'Normal approximation; can be anti-conservative for random-effects pooling with few studies (the HKSJ t-based test is preferable when k < 10).',
    verified: true,
  },
  {
    id: 'confidence-interval-95',
    title: '95% confidence interval',
    equations: [
      { label: '95% CI', text: 'ES_pooled ± 1.959963984540054 × SE_pooled' },
    ],
    plainEnglish:
      'The range of pooled-effect values compatible with the data at the 95% level, using the exact 97.5th percentile of the standard normal distribution (qnorm(0.975)) rather than the rounded 1.96.',
    usedIn: 'Analysis tab, Forest plot tab (per-study and pooled rows), Sensitivity tab (leave-one-out re-pooled CIs).',
    implementedIn: 'runMeta() with Z975 — ' + ENGINE_META + ' and src/research-engine/statistics/math-helpers.js',
    references: [REF.BORENSTEIN_2009],
    limitations:
      'Normal-theory interval; describes uncertainty in the mean effect, not the spread of true effects (see prediction interval). Per-study effect-size calculators use the rounded z = 1.96.',
    verified: true,
  },
  {
    id: 'hksj-adjustment',
    title: 'Hartung–Knapp–Sidik–Jonkman (HKSJ) adjustment',
    equations: [
      { label: 'Variance scaling factor', text: 'q = Σ w*ᵢ (ESᵢ − ES*)² / (k − 1)' },
      { label: 'Adjusted standard error', text: 'SE_HKSJ = √(max(q, 10⁻¹²)) × √(1 / Σw*ᵢ)' },
      { label: 'Confidence interval (t, df = k − 1)', text: 'ES* ± t(k−1, 0.975) × SE_HKSJ' },
      { label: 't test of the pooled effect', text: 't = ES* / SE_HKSJ  ~  t(k − 1) under H₀' },
    ],
    plainEnglish:
      'A small-sample correction for the random-effects model: it rescales the standard error using the observed spread of effects and uses a t distribution with k − 1 degrees of freedom instead of the normal. Intervals are usually wider and more honest when there are few studies.',
    usedIn: 'Analysis tab — the HKSJ interval is always reported alongside the standard random-effects interval (requires k ≥ 2).',
    implementedIn: 'runMeta() (hksj result block) with tCrit()/tCDF() — ' + ENGINE_META,
    references: [REF.HARTUNG_KNAPP_2001, REF.SIDIK_JONKMAN_2002, REF.INTHOUT_2014],
    limitations:
      'Can occasionally produce narrower intervals than the normal-based interval when effects are unusually homogeneous (q < 1; the implementation floors q at 10⁻¹² but applies no q ≥ 1 modification). Recommended particularly when k < 10.',
    verified: true,
  },
  {
    id: 'prediction-interval',
    title: 'Prediction interval',
    equations: [
      { label: '95% prediction interval (df = k − 2)', text: 'PI = ES* ± t(k−2, 0.975) × √(τ² + SE*²)' },
    ],
    plainEnglish:
      'Estimates where the true effect of a single new (future) study would plausibly fall, accounting for both the uncertainty in the pooled mean and the between-study variability τ². A prediction interval spanning the null warns that the intervention may be ineffective in some settings even when the pooled effect is significant.',
    usedIn: 'Analysis tab random-effects panel (requires k ≥ 3; always computed on the random-effects estimate).',
    implementedIn: 'runMeta() (predInt result block) — ' + ENGINE_META,
    references: [REF.HIGGINS_2009_PI, REF.RILEY_2011],
    limitations:
      'Assumes normally distributed true effects; unreliable when k is small or τ² is poorly estimated. Computed from the random-effects estimate even when the fixed-effect model is selected as the headline.',
    verified: true,
  },

  // ── 2. Publication bias ────────────────────────────────────────────────────
  {
    id: 'eggers-test',
    title: "Egger's regression test for funnel-plot asymmetry",
    equations: [
      { label: 'Regression (unweighted OLS)', text: 'standard normal deviate y = ES/SE regressed on precision x = 1/SE:  y = b₀ + b₁·x' },
      { label: "Egger's bias coefficient", text: 'b₀ = intercept;  H₀: b₀ = 0 (funnel symmetry)' },
      { label: 'Residual variance', text: 's² = Σ(y − ŷ)² / (k − 2)' },
      { label: 'SE of the intercept', text: 'SE(b₀) = √( s² · Σx² / (k·Σx² − (Σx)²) )' },
      { label: 'Test', text: 't = b₀ / SE(b₀) ~ t(k − 2);  p = 2·(1 − T_cdf(|t|, k − 2))' },
    ],
    plainEnglish:
      'Regresses each study’s standardized effect (ES/SE) on its precision (1/SE) by ordinary (UNWEIGHTED) least squares — the canonical Egger (1997) test, matching metafor::regtest(model="lm"). The intercept is the bias coefficient: when small, imprecise studies systematically show larger effects (a typical signature of publication bias), the intercept departs from zero. The regression is intentionally unweighted — y and x already embed the precision, so inverse-variance weights would double-count it.',
    usedIn: 'Sensitivity tab, publication-bias panel (requires k ≥ 3).',
    implementedIn: 'eggersTest() — ' + ENGINE_META,
    references: [REF.EGGER_1997],
    limitations:
      'Asymmetry is a proxy, not proof, of publication bias — heterogeneity and chance also produce asymmetry. Very low power when k < 10; conventionally interpreted at p < 0.10.',
    verified: true,
  },
  {
    id: 'trim-and-fill',
    title: 'Trim-and-fill (Duval–Tweedie L0 estimator)',
    equations: [
      { label: 'Estimated number of missing studies', text: 'L0 = (4 × Tn − k(k + 1)) / (2k − 1);   k₀ = max(0, round(L0))   (k = total studies; Tn = sum of ranks of |yᵢ − μ| on the heavy side, ranked over all k)' },
      { label: 'Imputed mirror-image effect', text: 'ES_imputed = 2μ − ES_extreme   (μ = pooled estimate of the trimmed set under the selected model)' },
    ],
    plainEnglish:
      'Estimates how many studies are "missing" from one side of the funnel plot. Each iteration it trims the most extreme studies on the over-represented side, re-estimates the centre μ from the *trimmed* set under the SELECTED model (fixed-effect inverse-variance, or DerSimonian–Laird random-effects with τ² re-estimated each pass), and computes the rank statistic Tn over the *full* set of k studies. On convergence it imputes mirror-image counterparts of the trimmed studies about μ and re-pools under the same model for a bias-adjusted estimate. Because the centre tracks the selected model, the result reproduces metafor::trimfill(res) for both fixed- and random-effects analyses — a random-effects analysis with a symmetric funnel correctly returns k₀ = 0 rather than over-imputing.',
    usedIn: 'Sensitivity tab, publication-bias panel (requires k ≥ 3); imputed studies are displayed alongside the adjusted pooled estimate.',
    implementedIn: 'trimFill() (centres/re-pools via the selected model) — ' + ENGINE_META,
    references: [REF.DUVAL_TWEEDIE_2000],
    limitations:
      'Assumes asymmetry is caused purely by publication bias; heterogeneity or chance in small meta-analyses produces false-positive k₀. Trim-and-fill is implementation-sensitive — PecanRev matches metafor::trimfill under the same model for clearly asymmetric funnels; the over-represented side is chosen by a signed-rank rule, which can differ from metafor’s regression-based side detection on near-symmetric funnels (where trim-and-fill is least reliable for any method). The adjusted estimate is a sensitivity analysis, not a corrected truth.',
    verified: true,
  },

  // ── 3. Sensitivity analyses ────────────────────────────────────────────────
  {
    id: 'leave-one-out',
    title: 'Leave-one-out sensitivity analysis',
    equations: [
      { label: 'For each study i', text: 'ES₍₋ᵢ₎ = pooled estimate of the remaining k − 1 studies (full re-pooling)' },
    ],
    plainEnglish:
      'Removes each study in turn and re-runs the full meta-analysis on the remainder, reporting the pooled effect, CI, p-value and I² without that study. Reveals whether any single study drives the overall conclusion.',
    usedIn: 'Sensitivity tab, leave-one-out table (requires k ≥ 3).',
    implementedIn: 'leaveOneOut() (re-pools via runMeta()) — ' + ENGINE_META,
    references: [REF.VIECHTBAUER_CHEUNG_2010],
    limitations:
      'Examines one study at a time; cannot detect joint influence of clusters of studies. With small k each omission changes τ² estimation noticeably.',
    verified: true,
  },
  {
    id: 'influence-dffits',
    title: 'Influence diagnostics (DFFITS-style)',
    equations: [
      { label: 'Standardized influence', text: 'DFFITᵢ = (ES_full − ES₍₋ᵢ₎) / SE_full' },
      { label: 'Influence flag', text: 'influential if |DFFITᵢ| > 1  or  |I²_full − I²₍₋ᵢ₎| > 25 percentage points' },
    ],
    plainEnglish:
      'Quantifies how much each study shifts the pooled estimate (in standard-error units) and how much heterogeneity it contributes (τ² and I² drop when omitted). Studies exceeding the thresholds are flagged for inspection.',
    usedIn: 'Sensitivity tab, influence table (requires k ≥ 3).',
    implementedIn: 'influenceDiagnostics() (re-pools via runMeta()) — ' + ENGINE_META,
    references: [REF.VIECHTBAUER_CHEUNG_2010],
    limitations:
      'The |DFFIT| > 1 and ΔI² > 25 cut-offs are screening conventions, not formal tests; flagged studies warrant inspection, not automatic exclusion. This is a simplified DFFITS analogue (denominator is the full-model SE, not a leave-one-out SE).',
    verified: true,
  },
  {
    id: 'subgroup-q-between',
    title: 'Subgroup analysis (Q-between test)',
    equations: [
      { label: 'Between-group heterogeneity', text: 'Q_between = max(0, Q_overall − Σ Q_within)' },
      { label: 'Test', text: 'p = 1 − χ²CDF(Q_between, df = n_groups − 1)' },
    ],
    plainEnglish:
      'Runs the full meta-analysis separately within each level of a grouping variable, then asks whether the pooled effects differ between groups more than chance would allow, by decomposing the overall Q statistic.',
    usedIn: 'Subgroup tab (per-group forest rows plus the Q-between test; requires ≥ 2 groups with poolable studies).',
    implementedIn: 'subgroupAnalysis() (per-group runMeta()) — ' + ENGINE_META,
    references: [REF.BORENSTEIN_2009],
    limitations:
      'Approximate fixed-effect decomposition; assumes no residual within-group heterogeneity. Low power with few studies per subgroup. Subgroups must be pre-specified to avoid inflated false-positive rates — post-hoc subgroup findings are hypothesis-generating only.',
    verified: true,
  },

  // ── 4. Effect-size calculators ─────────────────────────────────────────────
  {
    id: 'es-mean-difference',
    title: 'Mean difference (MD)',
    equations: [
      { label: 'Effect size', text: 'MD = m₁ − m₂' },
      { label: 'Standard error', text: 'SE = √(sd₁²/n₁ + sd₂²/n₂)' },
    ],
    plainEnglish:
      'The raw difference between two group means, kept in the original measurement units. Appropriate when all studies measured the outcome on the same scale.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "MD").',
    implementedIn: "calcES('MD', {n1, n2, sd1, sd2, m1, m2}) — " + ENGINE_CALC,
    references: [REF.BORENSTEIN_2009],
    limitations:
      'Not comparable across different measurement scales (use SMD instead). Requires n ≥ 2 per group; 95% CI uses z = 1.96.',
    verified: true,
  },
  {
    id: 'es-smd-cohens-d',
    title: "Standardized mean difference (Cohen's d)",
    equations: [
      { label: 'Pooled SD', text: 'SD_pooled = √( ((n₁−1)sd₁² + (n₂−1)sd₂²) / (n₁ + n₂ − 2) )' },
      { label: 'Effect size', text: 'd = (m₁ − m₂) / SD_pooled' },
      { label: 'Standard error (large-sample variance of d)', text: 'SE = √( (n₁+n₂)/(n₁×n₂) + d²/(2(n₁+n₂)) )' },
    ],
    plainEnglish:
      "The difference between group means expressed in pooled standard-deviation units, making studies on different scales comparable. This implementation is Cohen's d with the pooled-SD standardizer: no Hedges' small-sample correction is applied — the J factor (J = 1 − 3/(4(n₁+n₂−2) − 1)) that converts d to Hedges' g is NOT used.",
    usedIn: 'Effect size calculator in the Data Extraction tab (type "SMD").',
    implementedIn: "calcES('SMD', {n1, n2, sd1, sd2, m1, m2}) — " + ENGINE_CALC,
    references: [REF.COHEN_1988, REF.HEDGES_OLKIN_1985, REF.BORENSTEIN_2009],
    limitations:
      "No Hedges' small-sample correction applied: d slightly overestimates the population effect in small samples (bias is noticeable when group sizes are below ~20). Applying the J correction is a recommended future step (it would change every SMD result, so it is documented rather than silently introduced). Hedges & Olkin is cited for the pooled-SD standardizer and variance only.",
    verified: true,
  },
  {
    id: 'es-log-odds-ratio',
    title: 'Log odds ratio (log OR)',
    equations: [
      { label: 'Effect size (2×2 table a/b/c/d)', text: 'ln OR = ln( (a × d) / (b × c) )' },
      { label: 'Standard error', text: 'SE = √(1/a + 1/b + 1/c + 1/d)' },
      { label: 'Zero-cell continuity correction', text: 'if any of a,b,c,d = 0, add 0.5 to all four cells (Haldane–Anscombe) before taking logs' },
    ],
    plainEnglish:
      'The odds ratio from a 2×2 table, analyzed on the natural-log scale where its sampling distribution is approximately normal. Results are back-transformed (exponentiated) for display.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "OR"); pooled log ORs feed the Analysis and Forest plot tabs.',
    implementedIn: "calcES('OR', {a, b, c, d}) — " + ENGINE_CALC,
    references: [REF.BORENSTEIN_2009, REF.HALDANE_1956],
    limitations:
      'Zero event cells are valid clinical data. When any cell is zero a Haldane–Anscombe continuity correction adds 0.5 to all four cells so log OR and its SE stay finite (flagged in the result metadata: continuityCorrectionApplied / correctionMethod). A double-zero-event table (a = 0 AND c = 0) carries no information about a relative effect and is returned as not estimable — use Risk Difference instead. Negative, non-integer or missing counts are rejected. 95% CI uses z = 1.96.',
    verified: true,
  },
  {
    id: 'es-log-risk-ratio',
    title: 'Log risk ratio (log RR)',
    equations: [
      { label: 'Effect size (2×2 table a/b/c/d)', text: 'ln RR = ln( (a/(a+b)) / (c/(c+d)) )' },
      { label: 'Standard error', text: 'SE = √(1/a − 1/(a+b) + 1/c − 1/(c+d))' },
      { label: 'Zero-cell continuity correction', text: 'if any of a,b,c,d = 0, add 0.5 to all four cells (Haldane–Anscombe) before taking logs' },
    ],
    plainEnglish:
      'The ratio of event risks between two groups, analyzed on the natural-log scale. More directly interpretable than the odds ratio when events are common.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "RR"); pooled log RRs feed the Analysis and Forest plot tabs.',
    implementedIn: "calcES('RR', {a, b, c, d}) — " + ENGINE_CALC,
    references: [REF.BORENSTEIN_2009, REF.HALDANE_1956],
    limitations:
      'Zero event cells are valid clinical data. When any cell is zero a Haldane–Anscombe continuity correction adds 0.5 to all four cells so log RR and its SE stay finite (flagged in the result metadata: continuityCorrectionApplied / correctionMethod). A double-zero-event table (a = 0 AND c = 0) carries no information about a relative effect and is returned as not estimable — use Risk Difference instead. Negative, non-integer or missing counts are rejected. 95% CI uses z = 1.96.',
    verified: true,
  },
  {
    id: 'es-risk-difference',
    title: 'Risk difference (RD)',
    equations: [
      { label: 'Effect size (2×2 table a/b/c/d)', text: 'RD = a/(a+b) − c/(c+d)' },
      { label: 'Standard error (Wald)', text: 'SE = √( p₁(1−p₁)/n₁ + p₂(1−p₂)/n₂ ),  p₁=a/(a+b), n₁=a+b,  p₂=c/(c+d), n₂=c+d' },
    ],
    plainEnglish:
      'The absolute difference in event risk between the two arms, kept on the natural (untransformed) scale. Because it is an absolute measure, zero event cells are admissible with no continuity correction, which makes RD a sensible alternative when a study has zero events in one or both arms and the relative measures (OR/RR) are unstable or not estimable.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "RD").',
    implementedIn: "calcES('RD', {a, b, c, d}) — " + ENGINE_CALC,
    references: [REF.BORENSTEIN_2009],
    limitations:
      'Uses the Wald (large-sample normal) variance, which is unreliable for very small samples or risks near 0 or 1. A study with zero events in BOTH arms has RD = 0 with a degenerate (zero) Wald SE and is returned as not estimable, since it cannot be inverse-variance weighted. 95% CI uses z = 1.96.',
    verified: true,
  },
  {
    id: 'es-log-hazard-ratio',
    title: 'Log hazard ratio from reported CI (log HR)',
    equations: [
      { label: 'Effect size', text: 'ln HR = ln(HR_reported)' },
      { label: 'Standard error from the reported 95% CI', text: 'SE = (ln(hi) − ln(lo)) / (2 × 1.96)' },
    ],
    plainEnglish:
      'Converts a published hazard ratio and its 95% confidence interval to the log scale for pooling, recovering the standard error from the width of the log-scale interval.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "HR").',
    implementedIn: "calcES('HR', {hr, lo, hi}) — " + ENGINE_CALC,
    references: [REF.TIERNEY_2007, REF.PARMAR_1998],
    limitations:
      'Requires HR, lo and hi all > 0 and a symmetric log-scale interval reported at exactly the 95% level. Individual-patient data or events/logrank statistics (Tierney/Parmar indirect methods) are not implemented — only the direct CI conversion.',
    verified: true,
  },
  {
    id: 'es-fisher-z',
    title: 'Fisher z transformation (correlation)',
    equations: [
      { label: 'Effect size', text: 'z = 0.5 × ln( (1 + r) / (1 − r) )' },
      { label: 'Standard error', text: 'SE = 1 / √(n − 3)' },
    ],
    plainEnglish:
      'Transforms a Pearson correlation onto a scale where its sampling distribution is approximately normal with a variance that depends only on the sample size, making correlations poolable.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "COR").',
    implementedIn: "calcES('COR', {r, n}) — " + ENGINE_CALC,
    references: [REF.FISHER_1921, REF.BORENSTEIN_2009],
    limitations:
      'Requires |r| < 1 and n ≥ 4. Assumes bivariate normality of the underlying variables. Pooled results should be back-transformed to r for interpretation.',
    verified: true,
  },
  {
    id: 'es-logit-proportion',
    title: 'Logit-transformed proportion',
    equations: [
      { label: 'Effect size', text: 'logit(p) = ln( p / (1 − p) ),  p = events/total' },
      { label: 'Standard error', text: 'SE = √( 1 / (total × p × (1 − p)) )' },
      { label: 'Continuity correction at extremes (events = 0 or events = total)', text: 'events → events + 0.5,  total → total + 1' },
    ],
    plainEnglish:
      'A single-arm proportion analyzed on the log-odds (logit) scale, which removes the 0–1 boundary and stabilizes the variance. When all or none of the participants have the event, a 0.5/1 continuity correction keeps the transform finite. Displayed values are back-transformed to proportions.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "PROP").',
    implementedIn: "calcES('PROP', {events, total}) — " + ENGINE_CALC,
    references: [REF.BORENSTEIN_2009],
    limitations:
      'The SE formula is the standard delta-method result for the logit transform; the cited handbook coverage is general rather than formula-specific — needs verification against a formula-specific source. The continuity correction (events + 0.5, total + 1) distorts estimates when many studies sit at the extremes; exact or GLMM methods are not implemented.',
    verified: false,
  },
  {
    id: 'es-log-dor',
    title: 'Log diagnostic odds ratio (log DOR)',
    equations: [
      { label: 'Effect size (TP/FP/FN/TN)', text: 'ln DOR = ln( (TP × TN) / (FP × FN) )' },
      { label: 'Standard error', text: 'SE = √(1/TP + 1/FP + 1/FN + 1/TN)' },
      { label: 'Haldane correction (if any cell = 0)', text: 'add 0.5 to all four cells' },
      { label: 'Also reported', text: 'Sensitivity = TP/(TP+FN),  Specificity = TN/(TN+FP)' },
    ],
    plainEnglish:
      'A single summary of diagnostic test performance: the odds of a positive test in the diseased divided by the odds of a positive test in the non-diseased, analyzed on the log scale. When any cell of the diagnostic 2×2 table is zero, 0.5 is added to every cell (Haldane correction) so the estimate stays finite.',
    usedIn: 'Effect size calculator in the Data Extraction tab (type "DIAG").',
    implementedIn: "calcES('DIAG', {tp, fp, fn, tn}) — " + ENGINE_CALC,
    references: [REF.GLAS_2003, REF.HALDANE_1956],
    limitations:
      'The DOR collapses sensitivity and specificity into one number and hides the threshold; bivariate/HSROC models for diagnostic meta-analysis are not implemented. The Haldane correction biases estimates from sparse tables.',
    verified: true,
  },

  // ── 5. Data-conversion recipes ─────────────────────────────────────────────
  {
    id: 'conv-median-iqr',
    title: 'Conversion: median + IQR → mean and SD',
    equations: [
      { label: 'Mean', text: 'mean ≈ (Q1 + median + Q3) / 3' },
      { label: 'SD', text: 'SD ≈ (Q3 − Q1) / [ 2 × Φ⁻¹( (0.75n − 0.125) / (n + 0.25) ) ]' },
    ],
    plainEnglish:
      'Estimates the mean and standard deviation when a paper reports only the median and interquartile range, using sample-size-dependent normal-quantile formulas so the converted values can enter a mean-difference analysis.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "Median + IQR → Mean & SD").',
    implementedIn: "CONVERSIONS['median_iqr'].run() — " + ENGINE_CONV,
    references: [REF.WAN_2014],
    limitations:
      'Assumes approximately normal underlying data — biased for skewed outcomes. The exact Wan et al. equation variant implemented here has not been re-verified against a specific equation number in the paper — needs verification. Requires Q1 ≤ Q3 and n ≥ 2.',
    verified: false,
  },
  {
    id: 'conv-median-range',
    title: 'Conversion: median + range → mean and SD',
    equations: [
      { label: 'Mean', text: 'mean ≈ (min + 2 × median + max) / 4' },
      { label: 'SD', text: 'SD ≈ (max − min) / [ 2 × Φ⁻¹( (n − 0.375) / (n + 0.25) ) ]' },
    ],
    plainEnglish:
      'Estimates the mean and standard deviation when a paper reports only the median and the minimum–maximum range, combining the Hozo mean estimator with the Wan range-based SD estimator.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "Median + Range (min–max) → Mean & SD").',
    implementedIn: "CONVERSIONS['median_range'].run() — " + ENGINE_CONV,
    references: [REF.WAN_2014, REF.HOZO_2005],
    limitations:
      'Range-based estimates are sensitive to outliers and assume approximate normality; less reliable than the IQR-based conversion when both are available. Requires min ≤ max and n ≥ 2.',
    verified: true,
  },
  {
    id: 'conv-se-to-sd',
    title: 'Conversion: SE → SD',
    equations: [
      { label: 'SD from standard error of a mean', text: 'SD = SE × √n' },
    ],
    plainEnglish:
      'Recovers the standard deviation of individual observations from a reported standard error of the mean — papers frequently report SE where the analysis needs SD.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "Standard Error (SE) → SD").',
    implementedIn: "CONVERSIONS['se_sd'].run() — " + ENGINE_CONV,
    references: [REF.COCHRANE_6_5_2],
    limitations:
      'Only valid if the reported value really is the SE of the mean of n observations (not, e.g., an SE from a model or a different n). Requires SE ≥ 0 and n ≥ 1.',
    verified: true,
  },
  {
    id: 'conv-ci-to-sd',
    title: 'Conversion: 95% CI of a mean → SD',
    equations: [
      { label: 'SD from a 95% CI', text: 'SD = √n × (upper − lower) / (2 × 1.96)' },
    ],
    plainEnglish:
      'Recovers the standard deviation from a 95% confidence interval of a single group mean, by converting the interval width to an SE and multiplying by √n.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "95% CI of a mean → SD").',
    implementedIn: "CONVERSIONS['ci_sd'].run() — " + ENGINE_CONV,
    references: [REF.COCHRANE_6_5_2],
    limitations:
      'Uses z = 1.96; for small samples the source CI was likely built with a larger t-multiplier, so this slightly overestimates SD precision (the panel notes this). Requires lower ≤ upper, n ≥ 1, and a genuinely 95% normal-theory interval.',
    verified: true,
  },
  {
    id: 'conv-pvalue-to-se',
    title: 'Conversion: p-value + effect → SE',
    equations: [
      { label: 'z from the two-sided p-value', text: 'z = Φ⁻¹(1 − P/2)' },
      { label: 'Standard error', text: 'SE = |effect| / z' },
    ],
    plainEnglish:
      'When a paper reports an effect estimate and an exact two-sided p-value but no SE or CI, the z-score implied by the p-value is used to back-calculate the standard error.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "P-value + effect → SE").',
    implementedIn: "CONVERSIONS['pval_se'].run() with invNorm() — " + ENGINE_CONV,
    references: [REF.COCHRANE_6_5_2],
    limitations:
      'Requires an exact p-value (fails for thresholds like "p < 0.05") with 0 < P < 1; unusable as P approaches 1 (z → 0). Assumes the original test was a two-sided z-type (Wald) test of that same effect.',
    verified: true,
  },
  {
    id: 'conv-percent-to-events',
    title: 'Conversion: percentage → event count',
    equations: [
      { label: 'Events', text: 'events = round( % / 100 × n )' },
    ],
    plainEnglish:
      'Reconstructs the event count from a reported percentage and group size so that 2×2-table effect sizes (OR/RR) can be computed.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "Percentage → Event count").',
    implementedIn: "CONVERSIONS['pct_events'].run() — " + ENGINE_CONV,
    references: [REF.COCHRANE_6_3],
    limitations:
      'Elementary arithmetic; rounding may not exactly reproduce the original count when the paper rounded the percentage. Requires 0 ≤ % ≤ 100 and n ≥ 1.',
    verified: true,
  },
  {
    id: 'conv-events-to-percent',
    title: 'Conversion: event count → percentage',
    equations: [
      { label: 'Percentage', text: '% = events / n × 100' },
    ],
    plainEnglish:
      'The inverse of the previous recipe: expresses an event count as a percentage of the group size.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "Event count → Percentage").',
    implementedIn: "CONVERSIONS['events_pct'].run() — " + ENGINE_CONV,
    references: [REF.COCHRANE_6_3],
    limitations: 'Elementary arithmetic; requires 0 ≤ events ≤ n and n ≥ 1.',
    verified: true,
  },
  {
    id: 'conv-ratio-to-log',
    title: 'Conversion: OR/RR/HR → log scale + SE from CI',
    equations: [
      { label: 'Log effect', text: 'ES = ln(estimate)' },
      { label: 'Log-scale CI', text: 'ln(lower), ln(upper)' },
      { label: 'Standard error', text: 'SE = (ln(upper) − ln(lower)) / (2 × 1.96)' },
    ],
    plainEnglish:
      'Converts any reported ratio measure (OR, RR or HR) with its 95% CI onto the natural-log scale used for pooling, recovering the SE from the log-interval width.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "OR / RR / HR → log + SE from CI").',
    implementedIn: "CONVERSIONS['ratio_log'].run() — " + ENGINE_CONV,
    references: [REF.TIERNEY_2007, REF.PARMAR_1998, REF.COCHRANE_6_3],
    limitations:
      'Requires a positive estimate with lower ≤ upper, reported at exactly the 95% level with a symmetric log-scale interval. Asymmetric (e.g. profile-likelihood) intervals give a distorted SE.',
    verified: true,
  },
  {
    id: 'conv-unit-scale',
    title: 'Conversion: unit scaling (linear factor)',
    equations: [
      { label: 'Converted value', text: 'converted = value × factor   (e.g. mg → g uses 0.001)' },
    ],
    plainEnglish:
      'Multiplies a reported value by a linear scale factor so all studies express the outcome in the same units before pooling raw mean differences.',
    usedIn: 'Conversion panel in the Data Extraction tab (recipe "Unit conversion (linear scale factor)").',
    implementedIn: "CONVERSIONS['unit_scale'].run() — " + ENGINE_CONV,
    references: [REF.COCHRANE_6_5_2],
    limitations:
      'Linear factors only — not valid for non-linear unit transformations (e.g. log-scaled measures or temperature offsets). Both mean and SD must be scaled by the same factor.',
    verified: true,
  },

  // ── 6. Screening (META·SIFT) ───────────────────────────────────────────────
  {
    id: 'duplicate-similarity-scorepair',
    title: 'Duplicate similarity score (scorePair)',
    equations: [
      { label: 'Hard identifiers', text: 'exact DOI match or exact PMID match ⇒ score = 100' },
      { label: 'Weighted fuzzy score', text: 'score = 100 × (0.7 × titleSim + 0.15 × authorJaccard + 0.15 × yearMatch) / Σweights' },
      { label: 'Title similarity (normalized titles)', text: 'titleSim = (maxLen − Levenshtein(a, b)) / maxLen' },
      { label: 'Author overlap (parsed surnames)', text: 'authorJaccard = |A ∩ B| / |A ∪ B|' },
      { label: 'Missing-year handling', text: 'if either year is missing, the 0.15 year weight is dropped from the denominator (treated as neutral)' },
    ],
    plainEnglish:
      'An explainable 0–100 duplicate-likelihood score between two screening records. Exact DOI or PMID matches win outright; otherwise the score blends title edit-distance similarity (dominant), author-surname overlap and year agreement. Grouping uses a 3-pass strategy (exact DOI → exact PMID → fuzzy title, threshold 0.92 for boolean grouping and 0.85 for scored grouping); a group’s score is its strongest pair.',
    usedIn: 'Screening Duplicates tab (duplicate detection, group scores and per-pair explanations).',
    implementedIn: 'scorePair(), findDuplicateGroups(), findDuplicateGroupsScored() — src/research-engine/screening/deduplication.js',
    references: [REF.LEVENSHTEIN_1966, REF.JACCARD_1912],
    limitations:
      'PecanRev in-house heuristic: the weights (0.7/0.15/0.15) and title thresholds (0.92/0.85) are internal choices with no external citation or published calibration — needs verification. Levenshtein and Jaccard are cited for the underlying string/set metrics only. Titles shorter than 10 normalized characters and records with conflicting years are skipped in fuzzy grouping.',
    verified: false,
  },

  // ── 7. Numerical foundations ───────────────────────────────────────────────
  {
    id: 'numerical-methods',
    title: 'Numerical methods (distribution functions)',
    equations: [
      { label: 'Standard normal CDF Φ(z)', text: 'Abramowitz–Stegun rational approximation (max error ≈ 1.5 × 10⁻⁷)' },
      { label: 'Inverse normal Φ⁻¹(p)', text: "Acklam's three-region rational approximation" },
      { label: 'Chi-square CDF', text: 'χ²CDF(x, df) = P(df/2, x/2) — regularized lower incomplete gamma (series / continued fraction)' },
      { label: 't CDF', text: 'tCDF(t, df) = 1 − 0.5 × I_x(df/2, 1/2),  x = df/(df + t²) — regularized incomplete beta (Lentz continued fraction)' },
      { label: 't critical value', text: 'tCrit(conf, df): bisection on tCDF over [0, 200]; normal fallback when df = ∞' },
      { label: 'ln Γ(z)', text: 'Lanczos approximation' },
    ],
    plainEnglish:
      'The self-contained math library behind every p-value, critical value and quantile in the engine: normal CDF and inverse, chi-square and t distributions via incomplete gamma/beta functions, and the log-gamma function. No external statistics dependency is used.',
    usedIn: 'Used internally by all analyses: Analysis/Forest/Sensitivity/Subgroup tabs (p-values, t critical values) and the Conversion panel (normal quantiles).',
    implementedIn: 'normalCDF(), invNorm(), invNormAbs(), lgamma(), ibeta(), gammp(), chiSquareCDF(), tCDF(), tCrit() — src/research-engine/statistics/math-helpers.js',
    references: [REF.ABRAMOWITZ_STEGUN_1964, REF.NUMERICAL_RECIPES, REF.LANCZOS_1964],
    limitations:
      "The Acklam inverse-normal algorithm is a web-published rational approximation with no peer-reviewed journal citation — needs verification (it is widely reproduced and accurate to ~1.15 × 10⁻⁹, but cannot be attributed to a journal source). All approximations have finite precision; extreme tail probabilities (p < 10⁻⁸) are not exact.",
    verified: false,
  },
];

/**
 * NOT_IMPLEMENTED
 * Methods researchers commonly expect that the engine does NOT provide.
 * Rendered as a closing "Not implemented" note so nobody assumes availability.
 */
export const NOT_IMPLEMENTED = [
  'REML and Paule-Mandel tau² estimators',
  'Peters test',
  'Begg rank correlation test',
  'meta-regression',
  'network meta-analysis',
];
