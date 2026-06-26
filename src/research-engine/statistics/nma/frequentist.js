/**
 * frequentist.js — frequentist Network Meta-Analysis core (P2).
 *
 * Independently implemented from published methodology (Lu & Ades contrast
 * synthesis / the generalized-least-squares consistency model that underlies
 * `netmeta`; Rücker 2012; White 2012; Jackson, White & Riley 2013 for the
 * multivariate DerSimonian–Laird τ²; Rücker & Schwarzer 2015 for P-scores). NO
 * GPL `netmeta` source is used — `netmeta` is only a validation oracle.
 *
 * Model: contrast-synthesis consistency model with a single shared between-study
 * heterogeneity variance τ² across the network. For a study contributing (m−1)
 * contrasts against its baseline, the within-study covariance is S_s (from
 * contrasts.js) and the between-study (random-effects) inflation is τ²·Δ_s with
 * Δ_s = I on the diagonal and 0.5 off-diagonal — the standard homogeneous-
 * heterogeneity multi-arm structure (Higgins 1996; Lu & Ades 2006). This makes the
 * two-treatment case reduce EXACTLY to the pairwise inverse-variance / DerSimonian–
 * Laird meta-analysis (validated against the PecanRev pairwise engine).
 *
 * The estimator is assembled per study (small per-study blocks inverted directly)
 * so multi-arm correlation is exact and no dense N×N matrix is formed.
 */
import { choleskyInverse, matMul, transpose } from './linalg.js';
import { Z975, normalCDF, chiSquareCDF } from '../math-helpers.js';

/** Δ_s: unit between-study covariance for an m-contrast study (1 diag, 0.5 off). */
function deltaBlock(m) {
  const D = [];
  for (let i = 0; i < m; i++) { D.push(new Array(m)); for (let j = 0; j < m; j++) D[i][j] = i === j ? 1 : 0.5; }
  return D;
}

/** trace(A·B) for square same-size matrices. */
function traceProduct(A, B) {
  let t = 0; const n = A.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) t += A[i][j] * B[j][i];
  return t;
}

/**
 * Build the per-study design block: rows in the basic-parameter space.
 * params: non-reference treatments → column index. A contrast (t1=baseline, t2)
 * maps to (e[t2] − e[t1]) in basic-parameter space (reference contributes 0).
 */
function studyDesign(study, paramIndex, p) {
  const rows = study.contrasts.map((c) => {
    const row = new Array(p).fill(0);
    if (c.t2 in paramIndex) row[paramIndex[c.t2]] += 1;
    if (c.t1 in paramIndex) row[paramIndex[c.t1]] -= 1;
    return row;
  });
  const y = study.contrasts.map((c) => c.y);
  return { X: rows, y };
}

/**
 * fitConsistency(network, opts) → fitted consistency model.
 * opts: { model:'common'|'random', reference, tau2 (override) }
 *
 * Returns {
 *   ok, model, reference, treatments, p (=t−1),
 *   d:        basic effects vs reference (length t, reference = 0),
 *   cov:      t×t covariance of the full effect vector (reference row/col = 0),
 *   tau2, tau, Q, df, Qpval, I2,
 *   N (#contrasts), ...
 * } or { ok:false, error }.
 */
export function fitConsistency(network, opts = {}) {
  const treatments = network.treatments;
  const t = treatments.length;
  if (t < 2) return { ok: false, error: 'NMA needs at least two treatments' };
  const reference = opts.reference && treatments.includes(opts.reference) ? opts.reference : treatments[0];

  // Basic parameters = non-reference treatments.
  const nonRef = treatments.filter((x) => x !== reference);
  const paramIndex = {}; nonRef.forEach((x, i) => { paramIndex[x] = i; });
  const p = nonRef.length; // = t − 1

  const studies = network.studies;
  let N = 0; studies.forEach((s) => { N += s.contrasts.length; });
  const df = N - p;
  if (N < p) return { ok: false, error: 'Insufficient data: fewer contrasts than free parameters (network likely disconnected or under-identified)' };

  // ── pass 1: common-effect fit (τ²=0) → needed for Q and the DL τ² estimator ──
  const assemble = (tau2) => {
    let M = []; for (let i = 0; i < p; i++) M.push(new Array(p).fill(0));
    let rhs = new Array(p).fill(0);
    const blocks = [];
    for (const s of studies) {
      const { X, y } = studyDesign(s, paramIndex, p);
      const m = s.contrasts.length;
      // Study covariance under this model: S_s + τ²·Δ_s.
      let cov = s.S.map((r) => r.slice());
      if (tau2 > 0) { const D = deltaBlock(m); for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) cov[i][j] += tau2 * D[i][j]; }
      const Sinv = choleskyInverse(cov);
      // Accumulate M += Xᵀ Sinv X ; rhs += Xᵀ Sinv y
      const SinvX = matMul(Sinv, X);          // m×p
      const Xt = transpose(X);                 // p×m
      const contribM = matMul(Xt, SinvX);      // p×p
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) M[i][j] += contribM[i][j];
      const Sy = new Array(m).fill(0);
      for (let i = 0; i < m; i++) { let acc = 0; for (let j = 0; j < m; j++) acc += Sinv[i][j] * y[j]; Sy[i] = acc; }
      for (let i = 0; i < p; i++) { let acc = 0; for (let j = 0; j < m; j++) acc += Xt[i][j] * Sy[j]; rhs[i] += acc; }
      blocks.push({ s, X, y, Sinv, m });
    }
    let Minv;
    try { Minv = choleskyInverse(M); }
    catch { return { singular: true }; }
    // d_nonref = Minv rhs
    const dNon = new Array(p).fill(0);
    for (let i = 0; i < p; i++) { let acc = 0; for (let j = 0; j < p; j++) acc += Minv[i][j] * rhs[j]; dNon[i] = acc; }
    // Generalized Q at this fit = Σ (y − X d)ᵀ Sinv (y − X d)
    let Q = 0;
    for (const b of blocks) {
      const fitted = matMul(b.X, dNon.map((v) => [v])).map((r) => r[0]); // X d
      const resid = b.y.map((yi, i) => yi - fitted[i]);
      let q = 0; for (let i = 0; i < b.m; i++) for (let j = 0; j < b.m; j++) q += resid[i] * b.Sinv[i][j] * resid[j];
      Q += q;
    }
    return { M, Minv, dNon, Q, blocks };
  };

  const common = assemble(0);
  if (common.singular) return { ok: false, error: 'Network design is singular (disconnected components or collinear comparisons) — estimates are not identifiable' };

  // ── multivariate DerSimonian–Laird τ² (Jackson/White/Riley) ──
  // τ² = max(0, (Q − df) / C),  C = tr(Vinv Δ) − tr(Minv · Σ Xᵀ Sinv Δ Sinv X)
  let tau2 = 0;
  if (opts.tau2 != null) {
    tau2 = Math.max(0, opts.tau2);
  } else if (df > 0) {
    let trVinvDelta = 0;
    let acc = []; for (let i = 0; i < p; i++) acc.push(new Array(p).fill(0)); // Σ Xᵀ Sinv Δ Sinv X
    for (const b of common.blocks) {
      const D = deltaBlock(b.m);
      // tr(Sinv Δ)
      trVinvDelta += traceProduct(b.Sinv, D);
      // Xᵀ Sinv Δ Sinv X
      const SinvD = matMul(b.Sinv, D);
      const SinvDSinv = matMul(SinvD, b.Sinv);
      const Xt = transpose(b.X);
      const tmp = matMul(matMul(Xt, SinvDSinv), b.X); // p×p
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) acc[i][j] += tmp[i][j];
    }
    const C = trVinvDelta - traceProduct(common.Minv, acc);
    tau2 = C > 0 ? Math.max(0, (common.Q - df) / C) : 0;
  }

  const model = opts.model === 'common' ? 'common' : 'random';
  const useTau2 = model === 'common' ? 0 : tau2;

  const fit = useTau2 === 0 ? common : assemble(useTau2);
  if (fit.singular) return { ok: false, error: 'Random-effects network design is singular' };

  // Full effect vector (reference = 0) + covariance.
  const d = new Array(t).fill(0);
  const cov = []; for (let i = 0; i < t; i++) cov.push(new Array(t).fill(0));
  const tIndex = {}; treatments.forEach((x, i) => { tIndex[x] = i; });
  nonRef.forEach((x, i) => { d[tIndex[x]] = fit.dNon[i]; });
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
    cov[tIndex[nonRef[i]]][tIndex[nonRef[j]]] = fit.Minv[i][j];
  }

  // Heterogeneity stats use the COMMON-effect Q (the standard reporting).
  const Q = common.Q;
  const Qpval = df > 0 ? Math.max(0, 1 - chiSquareCDF(Q, df)) : 1;
  const I2 = df > 0 && Q > 0 ? Math.max(0, (Q - df) / Q) * 100 : 0;

  return {
    ok: true, model, reference, treatments, tIndex, p,
    d, cov, tau2, tau: Math.sqrt(tau2), Q, df, Qpval, I2,
    N, sm: network.sm, isLog: network.isLog,
  };
}

/** Effect of t2 vs t1 (t2 relative to t1) + variance/SE/CI from a fit. */
export function pairEffect(fit, t1, t2) {
  const i1 = fit.tIndex[t1], i2 = fit.tIndex[t2];
  if (i1 == null || i2 == null) return null;
  const est = fit.d[i2] - fit.d[i1];
  const v = fit.cov[i2][i2] + fit.cov[i1][i1] - 2 * fit.cov[i1][i2];
  const se = Math.sqrt(Math.max(v, 0));
  const z = se > 0 ? est / se : 0;
  const pval = 2 * (1 - normalCDF(Math.abs(z)));
  return { t1, t2, est, se, lo: est - Z975 * se, hi: est + Z975 * se, z, pval };
}

/**
 * leagueTable(fit) → all ordered pairs {t1,t2,...pairEffect}. Cell (row=i,col=j)
 * is the effect of treatment j versus treatment i (j relative to i). The reciprocal
 * cell (i vs j) is the sign-flipped estimate with swapped/negated CI bounds — the
 * SAME convention used by the forest plots and exports (orientation.js).
 */
export function leagueTable(fit) {
  const T = fit.treatments;
  const cells = {};
  for (const a of T) { cells[a] = {}; for (const b of T) { cells[a][b] = a === b ? null : pairEffect(fit, a, b); } }
  return { treatments: T, cells, reference: fit.reference, model: fit.model, sm: fit.sm, isLog: fit.isLog };
}

/**
 * pScores(fit, { smallerBetter }) → Rücker & Schwarzer (2015) frequentist ranking.
 * P-score_i = mean over j≠i of P(treatment i is better than treatment j), where the
 * probability uses the network estimate of the i-vs-j contrast and its SE. This is a
 * deterministic frequentist analogue of SUCRA (do NOT call it SUCRA).
 * `smallerBetter`: when true a smaller effect favours a treatment (e.g. mortality OR).
 */
export function pScores(fit, opts = {}) {
  const smallerBetter = !!opts.smallerBetter;
  const T = fit.treatments;
  const out = [];
  for (const i of T) {
    let sum = 0, cnt = 0;
    for (const j of T) {
      if (i === j) continue;
      const e = pairEffect(fit, j, i); // effect of i vs j
      if (!e || !(e.se > 0)) { continue; }
      // "i better than j": if smallerBetter, i better when (i−j) < 0 → P(Z < −est/se);
      // else better when (i−j) > 0 → P(Z > −est/se) = Φ(est/se).
      const zstat = e.est / e.se;
      const pBetter = smallerBetter ? normalCDF(-zstat) : normalCDF(zstat);
      sum += pBetter; cnt++;
    }
    out.push({ treatment: i, pScore: cnt ? sum / cnt : null });
  }
  // Rank: higher P-score = better.
  const ranked = out.slice().filter((o) => o.pScore != null).sort((a, b) => b.pScore - a.pScore);
  ranked.forEach((o, idx) => { o.rank = idx + 1; });
  const rankByTreat = {}; ranked.forEach((o) => { rankByTreat[o.treatment] = o; });
  return out.map((o) => ({ ...o, rank: rankByTreat[o.treatment] ? rankByTreat[o.treatment].rank : null })).sort((a, b) => (b.pScore ?? -1) - (a.pScore ?? -1));
}
