/**
 * tau2.js — RoadMap/2.md. Between-study variance (τ²) estimators for random-effects
 * meta-analysis. Pure, dependency-free (imports nothing). DerSimonian–Laird stays the
 * DEFAULT everywhere; this module only supplies the OPT-IN alternatives, so every
 * existing result is unchanged.
 *
 * Inputs are the per-study effect sizes `y` and their within-study variances `v`
 * (v = SE²). All estimators floor τ² at 0. Iterative estimators (PM/EB/ML/REML) fall
 * back to DL when k < 3, when they fail to converge, or when the iterate is
 * non-finite; the return carries `fallback:'DL'` so callers can note it.
 *
 * References (one per estimator):
 *   DL   DerSimonian R, Laird N. Control Clin Trials 1986;7:177-188.
 *   HO   Hedges LV, Olkin I. Statistical Methods for Meta-Analysis. 1985 (a_i = 1).
 *   HS   Hunter JE, Schmidt FL. Methods of Meta-Analysis. 2004.
 *   PM   Paule RC, Mandel J. J Res Natl Bur Stand 1982;87:377-385.
 *   EB   Morris CN. JASA 1983;78:47-55 (Empirical Bayes; equals Paule–Mandel — see below).
 *   SJ   Sidik K, Jonkman JN. Comput Stat Data Anal 2007;51:3681-3701.
 *   ML   Hardy RJ, Thompson SG. Stat Med 1996;15:619-629.
 *   REML Viechtbauer W. J Educ Behav Stat 2005;30:261-293.
 * General moment forms: DerSimonian R, Kacker R. Contemp Clin Trials 2007;28:105-114.
 * Overview & recommendations: Veroniki AA, et al. Res Synth Methods 2016;7:55-79.
 */

export const TAU2_METHODS = ['DL', 'REML', 'ML', 'PM', 'EB', 'SJ', 'HO', 'HS'];

export const TAU2_LABELS = {
  DL: 'DerSimonian–Laird',
  REML: 'Restricted maximum likelihood (REML)',
  ML: 'Maximum likelihood (ML)',
  PM: 'Paule–Mandel',
  EB: 'Empirical Bayes (Morris)',
  SJ: 'Sidik–Jonkman',
  HO: 'Hedges–Olkin',
  HS: 'Hunter–Schmidt',
};

/**
 * estimateTau2(y, v, opts) -> { tau2, method, converged, iterations, fallback }
 * @param {number[]} y  effect sizes
 * @param {number[]} v  within-study variances (SE²), all > 0
 * @param {{method?:string, maxIter?:number, tol?:number}} [opts]
 */
export function estimateTau2(y, v, opts = {}) {
  const method = TAU2_METHODS.includes(opts.method) ? opts.method : 'DL';
  const maxIter = opts.maxIter || 200;
  const tol = opts.tol || 1e-10;
  const k = y.length;

  // Guard: need ≥2 studies and positive variances for any estimator.
  if (k < 2 || v.some((x) => !(x > 0)) || y.some((x) => !Number.isFinite(x))) {
    return { tau2: 0, method, converged: true, iterations: 0, fallback: null };
  }

  const dl = tau2DL(y, v);
  if (method === 'DL') return { tau2: dl, method, converged: true, iterations: 0, fallback: null };
  if (method === 'HO') return { tau2: Math.max(0, tau2HO(y, v)), method, converged: true, iterations: 0, fallback: null };
  if (method === 'HS') return { tau2: Math.max(0, tau2HS(y, v)), method, converged: true, iterations: 0, fallback: null };
  if (method === 'SJ') return { tau2: Math.max(0, tau2SJ(y, v)), method, converged: true, iterations: 0, fallback: null };

  // Iterative estimators fall back to DL for very small k where they are unstable.
  if (k < 3) return { tau2: dl, method, converged: false, iterations: 0, fallback: 'DL' };

  let res;
  if (method === 'PM' || method === 'EB') res = tau2PM(y, v, maxIter, tol);
  else res = tau2Iterative(y, v, method, dl, maxIter, tol); // ML | REML

  if (!res || !Number.isFinite(res.tau2) || !res.converged) {
    return { tau2: dl, method, converged: false, iterations: res ? res.iterations : 0, fallback: 'DL' };
  }
  return { tau2: Math.max(0, res.tau2), method, converged: true, iterations: res.iterations, fallback: null };
}

/* ── Weighted mean helper for a given weight vector ───────────────────────────── */
function wmean(y, w) {
  let sw = 0, swy = 0;
  for (let i = 0; i < y.length; i++) { sw += w[i]; swy += w[i] * y[i]; }
  return swy / sw;
}

/* ── DerSimonian–Laird (closed form) — MUST equal runMeta's inline formula ────── */
export function tau2DL(y, v) {
  const k = y.length;
  const w = v.map((x) => 1 / x);
  const S1 = w.reduce((a, b) => a + b, 0);
  const S2 = w.reduce((a, b) => a + b * b, 0);
  const mu = wmean(y, w);
  let Q = 0;
  for (let i = 0; i < k; i++) Q += w[i] * (y[i] - mu) ** 2;
  const c = S1 - S2 / S1;
  return c > 0 ? Math.max(0, (Q - (k - 1)) / c) : 0;
}

/* ── Hedges–Olkin (unweighted, a_i = 1) ───────────────────────────────────────── */
export function tau2HO(y, v) {
  const k = y.length;
  const ybar = y.reduce((a, b) => a + b, 0) / k;
  const s2 = y.reduce((a, yi) => a + (yi - ybar) ** 2, 0) / (k - 1);
  const vbar = v.reduce((a, b) => a + b, 0) / k;
  return s2 - vbar;
}

/* ── Hunter–Schmidt: (Q − k)/ΣW with fixed weights ────────────────────────────── */
export function tau2HS(y, v) {
  const k = y.length;
  const w = v.map((x) => 1 / x);
  const S1 = w.reduce((a, b) => a + b, 0);
  const mu = wmean(y, w);
  let Q = 0;
  for (let i = 0; i < k; i++) Q += w[i] * (y[i] - mu) ** 2;
  return (Q - k) / S1;
}

/* ── Sidik–Jonkman two-step (model-error variance; always > 0) ────────────────── */
export function tau2SJ(y, v) {
  const k = y.length;
  const ybar = y.reduce((a, b) => a + b, 0) / k;
  // Initial estimate of total variance (guaranteed > 0 unless all y equal).
  let t0 = y.reduce((a, yi) => a + (yi - ybar) ** 2, 0) / k;
  if (!(t0 > 0)) t0 = 1e-8; // degenerate: all effects identical
  const r = v.map((x) => x / t0);          // r_i = v_i / τ²₀
  const w = r.map((ri) => 1 / (ri + 1));   // dimensionless weights
  const muw = wmean(y, w);
  let s = 0;
  for (let i = 0; i < k; i++) s += w[i] * (y[i] - muw) ** 2;
  return s / (k - 1);
}

/* ── Paule–Mandel / Empirical Bayes: solve Q(τ²) = k−1 ────────────────────────── */
export function tau2PM(y, v, maxIter = 200, tol = 1e-10) {
  const k = y.length;
  // F(t) = Σ w*(y − μ*)² − (k−1), decreasing in t; root ≥ 0 (else τ²=0).
  const F = (t) => {
    const w = v.map((x) => 1 / (x + t));
    const mu = wmean(y, w);
    let q = 0;
    for (let i = 0; i < k; i++) q += w[i] * (y[i] - mu) ** 2;
    return q - (k - 1);
  };
  if (F(0) <= 0) return { tau2: 0, converged: true, iterations: 0 };
  // Bracket the root: grow the upper bound until F < 0.
  let lo = 0, hi = Math.max(1, ...v);
  let iter = 0;
  while (F(hi) > 0 && iter < 60) { hi *= 2; iter++; }
  if (F(hi) > 0) return { tau2: hi, converged: false, iterations: iter };
  // Bisection.
  for (; iter < maxIter; iter++) {
    const mid = 0.5 * (lo + hi);
    const f = F(mid);
    if (Math.abs(f) < tol || (hi - lo) < tol) return { tau2: mid, converged: true, iterations: iter };
    if (f > 0) lo = mid; else hi = mid;
  }
  return { tau2: 0.5 * (lo + hi), converged: true, iterations: iter };
}

/* ── ML / REML fixed-point iteration (Fisher-scoring equivalent) ──────────────────
   w_i = 1/(v_i + τ²), μ* = Σ w_i y_i / Σ w_i.
   ML:   τ²_{new} = Σ w_i²[(y_i − μ*)² − v_i] / Σ w_i²
   REML: τ²_{new} = ML numerator/Σw_i²  +  1/Σ w_i        (the REML df correction)
   Both floored at 0; iterate to convergence.                                        */
export function tau2Iterative(y, v, method, init, maxIter = 200, tol = 1e-10) {
  const k = y.length;
  let t = Math.max(0, Number.isFinite(init) ? init : 0);
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const w = v.map((x) => 1 / (x + t));
    const sw = w.reduce((a, b) => a + b, 0);
    const sw2 = w.reduce((a, b) => a + b * b, 0);
    const mu = wmean(y, w);
    let num = 0;
    for (let i = 0; i < k; i++) num += w[i] * w[i] * ((y[i] - mu) ** 2 - v[i]);
    let tNew = num / sw2;
    if (method === 'REML') tNew += 1 / sw;
    tNew = Math.max(0, tNew);
    if (!Number.isFinite(tNew)) return { tau2: t, converged: false, iterations: iter };
    if (Math.abs(tNew - t) < tol) return { tau2: tNew, converged: true, iterations: iter + 1 };
    t = tNew;
  }
  return { tau2: t, converged: false, iterations: iter };
}
