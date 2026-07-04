# Analysis: τ² estimators, effect measures & analysis types — plan (RoadMap/2.md)

PecanRev v3.67.0. ADD capability to the Analysis engine only — no restructure of the tab or
its flow. Numerical correctness is paramount; DerSimonian–Laird stays the DEFAULT and
existing results stay **bit-for-bit** reproducible.

## 1. Current state (inspected)

- `runMeta(studies, method="random")` exists in TWO intentionally-separate copies (monolith
  note, `monolithStats.js:6-8`): the UI copy `src/research-engine/statistics/monolithStats.js:27`
  and the server/engine copy `src/research-engine/statistics/meta-analysis.js:24`. Both are
  byte-identical inverse-variance pooling; τ² is the closed-form DerSimonian–Laird
  method-of-moments estimator, hardcoded (`monolithStats.js:39`). `method` accepts only
  `"fixed"|"random"`. No `tau2Method`.
- `math-helpers.js` provides `Z975`, `normalCDF`, `chiSquareCDF`, `tCDF`, `tCrit`, `invNorm`,
  `lgamma` — everything an iterative estimator + HKSJ + PI need.
- `ES_TYPES` (`monolithConstants.js:39`) already includes `RD`. Keys: SMD, MD, OR, RR, RD,
  HR, COR, PROP. Consumers read only `.log`, `.scale`, `.label` (+ `PROP`/`COR` special cases).
- The stray `"REML"` in `analysisTabs.jsx` (lines 1564/1617/1365/1435) belongs to the
  **meta-regression** estimator selector (`MonolithStats.metaRegression`, which DOES implement
  REML via Fisher scoring, `metaRegression.js:218`). It is NOT the AnalysisTab pooling model —
  do not confuse them. The pooling model toggle is `fixed|random` (`analysisTabs.jsx:39,203`).
- NMA already exists: `src/research-engine/statistics/nma/` (geometry, frequentist, inconsistency,
  contribution, contrasts, linalg) with `nmaTab.jsx` behind a flag. So "phase 2" NMA is mostly a
  design/wiring doc, not a from-scratch build.
- Tests: `tests/unit/statistics/*` (meta-fixed, meta-random-dl, heterogeneity, leaveoneout,
  trimfill, egger, subgroup, contract-coverage) + `tests/unit/meta-analysis.test.js`. Style:
  vitest describe/it, `toBeCloseTo` tolerances, some golden values. (R/metafor is NOT installed
  in this environment — cross-checks use published golden datasets with values computed by
  metafor in the literature, cited inline.)

## 2. τ² estimators (DL stays default)

New pure module `src/research-engine/statistics/tau2.js` (dependency-free, imports only
math-helpers). Single entry point:

```
estimateTau2(y, v, { method='DL', maxIter=200, tol=1e-8 }) -> { tau2, method, converged, iterations, fallback }
```

`y` = effect sizes, `v` = within-study variances (SE²). Implements, each with a reference:

| method | approach | reference |
|--------|----------|-----------|
| `DL` | DerSimonian–Laird method of moments (closed form) | DerSimonian & Laird, Control Clin Trials 1986;7:177 |
| `PM` | Paule–Mandel iterate Q(τ²)=k−1 (Brent/bisection) | Paule & Mandel, J Res NBS 1982;87:377; Veroniki 2016 |
| `REML` | restricted maximum likelihood, Fisher scoring | Viechtbauer, J Educ Behav Stat 2005;30:261 |
| `ML` | maximum likelihood, Fisher scoring | Hardy & Thompson, Stat Med 1996;15:619 |
| `EB` | Empirical Bayes = Paule–Mandel (Morris) — alias to PM iterate | Morris 1983; Veroniki 2016 §note EB≡PM |
| `SJ` | Sidik–Jonkman (two-step, model-error variance) | Sidik & Jonkman, Comput Stat Data Anal 2007;51:3681 |
| `HO` | Hedges–Olkin (Cochran ANOVA-type, unweighted) | Hedges & Olkin 1985 |
| `HS` | Hunter–Schmidt | Hunter & Schmidt 2004 |

Rules:
- **DL default & unchanged:** when `method` is absent or `'DL'`, `runMeta` keeps using its
  existing inline closed form — `estimateTau2` is only invoked for non-DL methods. This
  guarantees every current result is byte-for-bit identical. (A unit test also asserts
  `estimateTau2(y,v,{method:'DL'})` equals the inline value.)
- **Non-negativity:** all estimators floored at 0.
- **Small-k / non-convergence fallback:** iterative estimators (PM/REML/ML/EB/SJ) fall back to
  DL when `k<3`, when they fail to converge in `maxIter`, or when the iterate is non-finite;
  the result carries `fallback:'DL'` so the UI can note it.
- HKSJ + prediction interval are computed from whatever τ² is returned — they already only
  depend on τ² and the random-effects weights, so they work with every estimator unchanged.

### runMeta wiring (both copies, identical edit)
`runMeta(studies, method="random", opts={})` — new optional third arg `opts.tau2Method`
(default `'DL'`). Backward compatible: all existing 2-arg calls behave exactly as before.
When `method==='random'` and `tau2Method!=='DL'`, compute `tau2all` via `estimateTau2`;
random-effects weights, pooled estimate, HKSJ, PI, and the returned `random.tau2`/`tau`
all use it. The `fixed` branch and the `I2`/`Q` reporting are untouched (I² is defined off
the DL/Q relationship and stays as-is; τ²-derived quantities update). Result gains
`tau2Method` and `tau2Converged`/`tau2Fallback` fields.

Every caller that passes only `(studies, method)` is unaffected. `trimFill`,
`leaveOneOut`, `influenceDiagnostics`, `subgroupAnalysis` gain an optional passthrough of
`tau2Method` (default DL) so a chosen estimator flows through sensitivity analyses.

### UI (no layout change)
`analysisTabs.jsx AnalysisTab`: a small `τ² estimator` `<select>` next to the existing
model toggle (only meaningful in random-effects mode; disabled/greyed in fixed mode),
default "DerSimonian–Laird". `methodLabel` and the hardcoded "DerSimonian–Laird" strings
(`:97,:310,:394,:598,:621,:708,:732`) become a `tauLabel(tau2Method)` helper so Methods
text, exports, and the audit trail name the actual estimator. `ResultsWriteup` methods
sentence updates the same way. The separate manuscript builders (`methodsText.js`,
`manuscript/draft.js`) get the estimator name threaded through where they already emit the
DL sentence, so on-screen and exported prose agree.

## 3. Effect measures (binary): RD + Peto OR

- **RD** already flows (`ES_TYPES.RD`, `calcES('RD')` in monolithStats.js:383). Confirm it is
  reachable in the extraction measure picker and analysis (it is — `Object.keys(ES_TYPES)`),
  add a unit test, and fix the mild mislabel `family:'ratio'` → `'difference'` (display-only;
  `.log` already false so pooling is correct — verified no consumer branches on `family`).
- **Peto OR** — add `esType` key `PETO` to `ES_TYPES` (`{label:'Peto Odds Ratio (log)', family:'ratio', log:true, nullVal:0, scale:'lnOR'}`) and a `calcES('PETO', {a,b,c,d})` branch:
  per-study Peto OR uses O−E and hypergeometric variance,
  `ψ_i = exp((O_i−E_i)/V_i)`, `ln = (O_i−E_i)/V_i`, `SE = 1/√V_i`, where for a 2×2 with
  `a` events/`n1` intervention, `c` events/`n2` control: `O=a`, `E=n1·(a+c)/N`,
  `V=n1·n2·(a+c)·(b+d)/(N²·(N−1))`. No continuity correction needed (handles single zero
  cells; drops double-zero / degenerate V). Reference: Yusuf, Peto et al., Prog Cardiovasc
  Dis 1985;27:335. Peto is best for rare events / balanced arms — add a poolability note when
  arms are very unbalanced or ORs far from 1 (known Peto bias), reusing the warnings channel.

## 4. Analysis types (contained — done now)

Add as `ES_TYPES` keys + `calcES` branches (each on its natural analysis scale, generic
inverse-variance pooling with zero new plumbing since consumers are measure-agnostic):

- **IRR** — Incidence Rate Ratio. `{log:true, scale:'lnIRR'}`. Inputs: events + person-time
  per arm `{e1,t1,e2,t2}` → `lnIRR=ln((e1/t1)/(e2/t2))`, `SE=√(1/e1+1/e2)`. Ref: Rothman.
- **AUC** — diagnostic C-statistic. `{log:false, scale:'logit AUC'}`. Pool on the logit of
  AUC (bounded 0–1, like PROP). Inputs `{auc, se}` or `{auc, lo, hi}` → logit transform, back-
  transform for display. Ref: Hanley & McNeil / Zhou meta-analysis of AUC.
- **BETA** — regression coefficient (generic continuous). `{log:false, scale:'β'}`. Inputs
  `{beta, se}` or `{beta, lo, hi}`. Additive, null 0.
- **GENERIC** — pre-computed effect + CI on whatever scale the user states. `{log:false,
  scale:'effect'}`. Inputs `{est, lo, hi}` used verbatim; user attests the scale. Companion
  `GENERIC_LOG` variant (log:true) for pre-computed ratio measures. Ref: generic
  inverse-variance (Cochrane Handbook §6.3).

Each new measure: `calcES` branch (validate + degenerate handling), extraction picker note
array update (`extractionTabs.jsx:126`), `analysisTypeWarnings` left permissive (won't fire
false warnings on new measures), and a plain-language interpretation that falls through the
existing log/additive/proportion branches in `interpretResult` — AUC uses the PROP-style
logit special case (added at the same call sites as PROP, guarded by a shared
`isLogit(esType)` helper to avoid scattering `esType==='PROP'` further).

## 5. NMA + Network DTA (phase 2 — design only)

Documented, NOT shipped in this PR. The frequentist NMA engine already exists
(`statistics/nma/`: `geometry.js` network geometry, `frequentist.js` pooled contrasts,
`inconsistency.js` node-splitting/design-by-treatment, `contribution.js`) with `nmaTab.jsx`
behind a flag. Remaining phase-2 work: SUCRA/P-score ranking surface, a Network DTA
(bivariate/HSROC network) engine, and consistent UI. Tracked here; ship later behind the
existing NMA flag. No code change to NMA in this PR.

## 6. Guardrails & test plan

- **DL bit-for-bit:** golden test asserts current `runMeta(studies,'random')` output is
  unchanged (reuse existing golden fixtures) AND that new `estimateTau2(...,{method:'DL'})`
  equals the inline formula on random fixtures.
- **Estimator unit tests** (`tests/unit/statistics/tau2.test.js`): each estimator on the
  canonical published datasets —
  - Rubin/education (18 studies) and the DerSimonian–Laird lung-cancer set,
  - assert τ² ordering & values against metafor-published numbers (cited in comments) within
    tolerance; PM==EB; REML/ML sanity (ML ≤ REML ≤ small differences); SJ never zero; HO/HS
    closed forms exact.
  - convergence: fabricated homogeneous data → all estimators → τ²≈0; k=2 → iterative
    methods fall back to DL.
- **RD/Peto tests:** `calcES('RD')` and `calcES('PETO')` against hand-computed values
  (Peto O−E/V on a known 2×2), zero-cell behavior, degenerate drops.
- **New-type tests:** IRR/AUC/BETA/GENERIC `calcES` round-trips + back-transform.
- HKSJ + PI still correct under a non-DL estimator (compare structure, not DL numbers).
- The "verify key results in R/metafor for regulatory use" disclaimer stays in the UI.
- `npm run test` (vitest) + `npm run build` green; tab layout/flow untouched (existing e2e
  `meta-analysis` spec must still pass).
