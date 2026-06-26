# P2 — Network Meta-Analysis: methodology, validation & architecture

Status: **frequentist engine complete + validated AND fully integrated** into the
PecanRev project workflow (server API, native workspace tab, Ops flag, exports).
Bayesian NMA and the R-`netmeta` numeric oracle are precisely-scoped follow-ons
(see "Deferred / blocked", below) — they are NOT faked.

## 0. Integration (server API + native workspace tab)

- **Feature flag** `networkMetaAnalysis` (default OFF) in the standard featureFlags
  block — auto-surfaces in Ops › Feature Flags (the admin/public settings merge
  `defaultFeatureFlags()`).
- **Server API** `/api/nma` (mirrors the stateless `/api/meta` pattern): `POST
  /validate` (readiness) and `POST /run` (full analysis). Auth-required +
  flag-gated (404 when OFF) + input-bounded (max studies/treatments) + structured
  errors (400 invalid, 422 not-analysable, 404 disabled). The deterministic engine
  runs **server-side** on user-supplied arm/contrast data — no project data leaves
  the server, no arbitrary code is executed.
- **Native workspace tab** `nma` ("Network Meta-Analysis", Analyze phase) added to
  the workflow `TABS`. It renders inside the SAME project shell (legacy
  `Workspace.jsx` dispatch + the unified Stitch `StitchProjectWorkspace` via
  `?tab=nma`) — NOT a standalone engine; project context, rail, header and presence
  are preserved. The dataset lives in `project.nma` (blob autosave; zero migration).
  Views: Evidence data editor + live readiness, Overview (+ transparency warnings),
  Network geometry (SVG + accessible table), League table, per-treatment Forest,
  Ranking (P-scores), Consistency (node-split + global Q decomposition),
  Contribution matrix, and Methods/reproducibility. Exports: league + ranking CSV,
  full result JSON, auto-generated methods text. Flag-OFF shows a disabled note
  (mirroring Search & Discovery), never a broken UI.
- **Tests**: `tests/unit/nma/controller.test.js` (flag-gate 404, validation 400,
  run 200 with full result, validate 200, not-analysable 422) against the real
  engine. Full suite green (2301).

## 1. Architecture

The NMA engine is a **pure, isomorphic** module under
`src/research-engine/statistics/nma/` (runs identically in the browser and on the
server — matching the existing pairwise engine's "self-contained, reproducible
numerics" philosophy). It has **no external dependencies** and no GPL `netmeta` code.

| File | Responsibility |
|---|---|
| `linalg.js` | Dense linear algebra: Cholesky inverse/solve (SPD), symmetric Jacobi eigen → Moore–Penrose pseudo-inverse, matrix ops. Throws on non-PD/singular so callers can surface a structured error. |
| `contrasts.js` | Arm-level → contrast-level derivation per effect measure (OR/RR/RD/MD + GENERIC contrast-level), **multi-arm covariance** (shared-baseline), and recorded continuity correction. |
| `frequentist.js` | GLS **consistency model** (common + random effects), **multivariate DerSimonian–Laird τ²**, league table, `pairEffect`, **P-scores** (Rücker & Schwarzer). |
| `geometry.js` | Network nodes/edges, connected components (union–find), connectivity checks. |
| `inconsistency.js` | Direct pooling, **node-splitting** (direct vs indirect via network exclusion), **global inconsistency** (design-by-treatment Q decomposition). |
| `contribution.js` | **Contribution matrix** (aggregate hat-matrix method). |
| `index.js` | Orchestrator: `validateNetwork` (readiness) + `runNetworkMetaAnalysis` (full analysis), provenance fingerprint, CINeMA-style transparency warnings. |

The engine separation is real: it is its own statistical domain, consumed by the
(future) `/api/nma` server module and the workspace UI without entangling the pairwise
engine.

## 2. Statistical methodology (independently implemented)

**Model.** Contrast-synthesis **consistency model** (Lu & Ades 2006; the GLS that
underlies `netmeta`/Rücker 2012), with a single shared between-study heterogeneity
variance τ² across the network. For a study contributing (m−1) contrasts against its
baseline, the within-study covariance is

```
S_s[j][k] = v_baseline                (j ≠ k, shared-baseline correlation)
S_s[k][k] = v_k + v_baseline
```

and the random-effects inflation is τ²·Δ_s with Δ_s = I on the diagonal and 0.5
off-diagonal (homogeneous-heterogeneity multi-arm structure; Higgins 1996). The
estimator is assembled **per study** (small per-study blocks inverted directly), so
multi-arm correlation is exact and no dense N×N matrix is formed.

**Estimation.** θ = (Xᵀ V⁻¹ X)⁻¹ Xᵀ V⁻¹ y with Cov(θ) = (Xᵀ V⁻¹ X)⁻¹, basic
parameters relative to a reference treatment; all-pairs network effects are linear
contrasts of θ. **τ²** uses the multivariate moment (DerSimonian–Laird) estimator
τ² = max(0, (Q − df)/C), C = tr(V⁻¹Δ) − tr(M⁻¹ ΣXᵀV⁻¹ΔV⁻¹X) (Jackson, White & Riley
2013) — which reduces exactly to the classic pairwise DL.

**Effect measures.** OR, RR (log scale), RD, MD (natural scale) from arm-level data;
GENERIC (pre-computed contrast + SE, e.g. log hazard ratio) for two-arm contrasts.
**Continuity correction** (0.5) is applied inside the transformation only, recorded,
and never mutates raw counts.

**Ranking.** **P-scores** (Rücker & Schwarzer 2015) — a deterministic frequentist
analogue of SUCRA; we deliberately do NOT call them SUCRA (SUCRA is reserved for the
Bayesian pathway). Orientation respects a `smallerBetter` flag.

**Inconsistency.** Local: node-splitting via network exclusion (direct vs indirect).
Global: design-by-treatment Q decomposition (Q_total = Q_within-design + Q_between-
design; Krahn 2013). Both carry honest interpretation guards ("a non-significant test
does not prove consistency; power is low in sparse networks").

**Effect orientation** is centralized: a contrast "t2 vs t1" is the effect of t2
relative to t1; league cell (row i, col j) is j-vs-i; reciprocals are exact sign
flips; ratio measures are carried on the log scale and exponentiated only at display.

## 3. Validation (committed automated tests)

`tests/unit/nma/frequentist.test.js` + `engine.test.js` (19 tests, all green). The
headline validation needs **no external oracle**:

- **Two-treatment NMA reduces EXACTLY to the PecanRev pairwise engine** (`runMeta`):
  common effect ↔ fixed inverse-variance and random effects ↔ DerSimonian–Laird —
  matching pooled effect, SE, **Q, τ² and I²**. This validates the GLS assembly, the
  multi-arm covariance, and the multivariate DL τ² against an already-R-validated
  engine.
- **Multi-arm covariance** is correct: a 3-arm study's B-vs-C variance is v_B + v_C
  (shared baseline cancels) — NOT inflated — so multi-arm trials are not double-counted.
- **Coherence** (effect A→C = A→B + B→C), **reciprocity**, **reference-treatment
  invariance**, **treatment-relabelling invariance**, and P-score validity (each in
  [0,1], mean 0.5).
- **Node-splitting** flags a designed inconsistent loop (p<0.05) and shows
  direct≈indirect on a consistent loop.
- **Global inconsistency** Q decomposition gives the right loop df and significance.
- **Contribution** rows sum to 1; **determinism** (order-independent provenance hash,
  identical estimates on reordered input); disconnected networks analyse the largest
  connected component (no cross-component league).

## 4. Deferred / blocked (precisely scoped — not faked)

- **Bayesian NMA** (P2.10): a genuine MCMC pathway (posterior effects, credible
  intervals, SUCRA, rankograms, R-hat/ESS diagnostics) requires a durable background-
  job + sampler runtime. The job seam is identified (the in-process DB-backed worker
  pattern from `screeningImportWorker`); a self-hostable sampler decision is documented
  for the next sub-phase. **No fake Bayesian mode** (resampling frequentist estimates)
  is shipped.
- **R-`netmeta` numeric oracle**: R is not available in this build environment, so the
  primary external oracle is replaced by the **pairwise-engine equivalence** oracle
  (itself validated against R `meta`/`metafor`) plus hand-derived multi-arm/coherence
  checks. The validation harness is structured to accept committed `netmeta` reference
  fixtures when an R toolchain is available.
- **SMD** and **multi-arm GENERIC (contrast-level)** covariance: MD/OR/RR/RD multi-arm
  are exact; SMD and supplied-covariance multi-arm contrasts are the next extension
  (the contrast layer is structured for it).
- **Comparison-adjusted funnel** + **flow/streams contribution**: the aggregate
  hat-matrix contribution is shipped; the elaborate streams decomposition and the
  network funnel are scoped follow-ons.

## 5. How to run the NMA tests locally

```
npx vitest run tests/unit/nma/
```
