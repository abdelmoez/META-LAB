/**
 * metaRegression.js
 * Random-effects (mixed-effects) meta-regression + bubble-plot geometry.
 *
 * A meta-regression is the continuous generalisation of a subgroup analysis:
 * each study carries an effect on the analysis scale (`es`, log-scale for ratio
 * measures) plus its sampling variance, and one or more study-level covariates
 * (moderators). We fit
 *
 *     y_i = x_i' β + u_i + e_i ,   e_i ~ N(0, v_i) ,   u_i ~ N(0, τ²)
 *
 * by weighted least squares with weights w*_i = 1/(v_i + τ²). Two τ² estimators:
 *
 *   • MM  — method-of-moments / DerSimonian–Laird residual estimator (the
 *           multivariable generalisation of the DL estimator used by runMeta):
 *              τ² = (Q_E − (k−p)) / c ,
 *              c  = Σ w_i − tr[(X'WX)⁻¹ X'W²X] ,   w_i = 1/v_i .
 *           For the intercept-only design (p=1) this collapses EXACTLY to
 *           runMeta's DL τ² = (Q − (k−1))/(W − W²/W), so the two engines agree.
 *
 *   • REML — restricted maximum likelihood via Fisher scoring (Viechtbauer 2005):
 *              τ²⁺ = τ² + (y'PPy − tr(P)) / tr(PP) ,
 *              P   = W* − W*X (X'W*X)⁻¹ X'W* ,   W* = diag(1/(v_i+τ²)) .
 *           Iterated to convergence, truncated at 0. Initialised from the MM
 *           estimate. Falls back to MM if the iteration is non-finite.
 *
 * Coefficient covariance is the standard random-effects GLS result Var(β) =
 * (X'W*X)⁻¹ with W* at the estimated τ²; Wald z-tests (normal) match metafor's
 * default output for method="DL". The residual heterogeneity test Q_E is the
 * weighted residual sum of squares from the moment (fixed-weight) fit, χ² with
 * df = k − p. R² = (τ²₀ − τ²)/τ²₀ (τ²₀ = intercept-only τ² under the SAME
 * estimator) and residual I² = 100·τ²/(τ² + s²), s² = (k−p)/c, follow metafor.
 *
 * Pure, deterministic, ESM. Reuses the NMA linear-algebra (Cholesky) and the
 * shared math-helpers CDFs — no other dependencies. Never throws: degenerate or
 * under-powered inputs return { ok:false, warnings:[…] }.
 *
 * The design-matrix code is written column-generically so MULTIVARIABLE
 * meta-regression (opts.covariates = [{name,type}, …]) is a natural extension;
 * the univariate case is just a one-element covariate list.
 */

import {
  zeros, matVec, choleskyInverse,
} from './nma/linalg.js';
import { Z975, normalCDF, chiSquareCDF } from './math-helpers.js';

export const ENGINE_VERSION = 'metaRegression-1.0.0';

// ── small numeric helpers ──────────────────────────────────────────────────
const num = (v) => (v !== '' && v !== null && v !== undefined && !isNaN(+v) ? +v : NaN);
const pFromZ = (z) => 2 * (1 - normalCDF(Math.abs(z)));

/** Sampling variance of a study: se² → variance/vi → recovered from a 95% CI. */
function studyVariance(s) {
  const se = num(s.se);
  if (se > 0) return se * se;
  let vi = num(s.variance);
  if (!(vi > 0)) vi = num(s.vi);
  if (!(vi > 0)) vi = num(s.v);
  if (vi > 0) return vi;
  const lo = num(s.lo), hi = num(s.hi);
  if (!isNaN(lo) && !isNaN(hi) && hi > lo) {
    const se2 = (hi - lo) / (2 * Z975);
    return se2 * se2;
  }
  return NaN;
}

const studyLabel = (s) =>
  ((s.author || s.label || s.study || 'Study') + (s.year ? ' ' + s.year : '')).trim();

// ── design-matrix construction (column-generic → multivariable-ready) ───────
/**
 * Build one or more design columns for a covariate spec over the retained rows.
 * Returns { cols: number[][] (k×c), out:[{name,level?,kind}], plotValue: fn|null,
 *           reference?, error? }.  `plotValue(rawValue)` maps a raw covariate to
 *   a numeric x for the bubble plot (null when not plottable on one axis).
 */
function buildCovariateColumns(spec, rows) {
  const name = spec.name;
  let type = spec.type;
  const raws = rows.map((r) => r._cov[name]);

  // Infer type when omitted: all-numeric → continuous, else categorical.
  if (!type) {
    type = raws.every((v) => !isNaN(num(v))) ? 'continuous' : 'categorical';
  }

  // Numeric moderators: continuous, ordinal (linear trend), numeric binary 0/1.
  if (type === 'continuous' || type === 'ordinal') {
    const col = raws.map((v) => num(v));
    return {
      cols: [col],
      out: [{ name, kind: type }],
      plotValue: (v) => num(v),
    };
  }

  if (type === 'binary') {
    const nums = raws.map((v) => num(v));
    const allNum = nums.every((v) => !isNaN(v));
    const numericSet = new Set(nums.filter((v) => !isNaN(v)));
    if (allNum && [...numericSet].every((v) => v === 0 || v === 1)) {
      // Genuine 0/1 numeric indicator — reference level is 0.
      return {
        cols: [nums],
        out: [{ name, kind: 'binary', reference: 0 }],
        plotValue: (v) => num(v),
      };
    }
    // Two (or more) labels — code the sorted-first level as the reference (0).
    const levels = [...new Set(raws.map((v) => String(v).trim()))].sort();
    if (levels.length === 2) {
      const [ref, one] = levels;
      return {
        cols: [raws.map((v) => (String(v).trim() === one ? 1 : 0))],
        out: [{ name, level: one, kind: 'binary', reference: ref }],
        plotValue: (v) => (String(v).trim() === one ? 1 : 0),
        reference: ref,
      };
    }
    // Fall through: a "binary" covariate with >2 levels is coded as categorical.
    type = 'categorical';
  }

  if (type === 'categorical') {
    const levels = [...new Set(raws.map((v) => String(v).trim()))].sort();
    if (levels.length < 2) return { error: `Covariate "${name}" has no variation (single level).` };
    const ref = levels[0];
    const dummyLevels = levels.slice(1);
    const cols = dummyLevels.map((lvl) => raws.map((v) => (String(v).trim() === lvl ? 1 : 0)));
    const levelIndex = new Map(levels.map((l, i) => [l, i]));
    return {
      cols,
      out: dummyLevels.map((lvl) => ({ name, level: lvl, kind: 'categorical', reference: ref })),
      // Categorical is not a single-axis line — plot on the level index.
      plotValue: (v) => levelIndex.get(String(v).trim()) ?? NaN,
      reference: ref,
    };
  }

  return { error: `Unknown covariate type "${spec.type}".` };
}

// ── weighted-least-squares primitives ──────────────────────────────────────
/** FE-WLS fit with weights w (=1/v for the moment fit). Returns null if singular. */
function wlsFit(X, y, w) {
  const k = X.length, p = X[0].length;
  const M = zeros(p, p);
  const Xtwy = new Array(p).fill(0);
  const A = zeros(p, p); // X'W²X — for the MM denominator
  for (let i = 0; i < k; i++) {
    const wi = w[i], xi = X[i], yi = y[i], wi2 = wi * wi;
    for (let a = 0; a < p; a++) {
      const xa = xi[a];
      Xtwy[a] += wi * xa * yi;
      for (let b = 0; b < p; b++) {
        M[a][b] += wi * xa * xi[b];
        A[a][b] += wi2 * xa * xi[b];
      }
    }
  }
  let cov;
  try { cov = choleskyInverse(M); }
  catch { return null; }
  const beta = matVec(cov, Xtwy);
  // Weighted residual sum of squares Q_E = Σ w_i (y_i − x_i'β)².
  let QE = 0;
  for (let i = 0; i < k; i++) {
    let fit = 0; const xi = X[i];
    for (let a = 0; a < p; a++) fit += xi[a] * beta[a];
    const e = y[i] - fit;
    QE += w[i] * e * e;
  }
  // c = Σ w_i − tr[(X'WX)⁻¹ X'W²X]  (both symmetric → double sum of Hadamard).
  const sumW = w.reduce((s, wi) => s + wi, 0);
  let trMinvA = 0;
  for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) trMinvA += cov[a][b] * A[a][b];
  const c = sumW - trMinvA;
  return { beta, cov, QE, c, sumW };
}

/** MM/DL residual τ² from a moment fit. */
function tau2MM(QE, k, p, c) {
  if (!(c > 0) || !isFinite(c)) return 0;
  return Math.max(0, (QE - (k - p)) / c);
}

/** Build the P matrix (k×k) at the given random-effects weights. */
function pMatrix(X, wstar) {
  const k = X.length, p = X[0].length;
  const M = zeros(p, p);
  for (let i = 0; i < k; i++) {
    const wi = wstar[i], xi = X[i];
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] += wi * xi[a] * xi[b];
  }
  const Minv = choleskyInverse(M); // may throw → caller guards
  // WX (k×p): (WX)_{i,a} = w*_i X_{i,a}
  const WX = zeros(k, p);
  for (let i = 0; i < k; i++) for (let a = 0; a < p; a++) WX[i][a] = wstar[i] * X[i][a];
  // P = diag(w*) − WX Minv WX'
  const P = zeros(k, k);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let a = 0; a < p; a++) {
        let t = 0;
        for (let b = 0; b < p; b++) t += Minv[a][b] * WX[j][b];
        s += WX[i][a] * t;
      }
      P[i][j] = (i === j ? wstar[i] : 0) - s;
    }
  }
  return P;
}

/** REML τ² via Fisher scoring. Returns { tau2, converged }. Falls back to init. */
function tau2REML(X, y, v, init) {
  let t2 = Math.max(0, init);
  let converged = false;
  for (let iter = 0; iter < 200; iter++) {
    const wstar = v.map((vi) => 1 / (vi + t2));
    let P;
    try { P = pMatrix(X, wstar); }
    catch { return { tau2: Math.max(0, init), converged: false }; }
    const Py = matVec(P, y);
    let trP = 0, trPP = 0, PyPy = 0;
    const k = P.length;
    for (let i = 0; i < k; i++) {
      trP += P[i][i];
      PyPy += Py[i] * Py[i];
      for (let j = 0; j < k; j++) trPP += P[i][j] * P[i][j]; // symmetric → tr(PP)
    }
    if (!(trPP > 0) || !isFinite(trPP)) return { tau2: Math.max(0, init), converged: false };
    let t2new = t2 + (PyPy - trP) / trPP;
    if (!isFinite(t2new)) return { tau2: Math.max(0, init), converged: false };
    if (t2new <= 0) { // boundary solution
      if (t2 === 0) { converged = true; t2 = 0; break; }
      t2new = 0;
    }
    if (Math.abs(t2new - t2) < 1e-9 * (1 + t2)) { t2 = t2new; converged = true; break; }
    t2 = t2new;
  }
  return { tau2: Math.max(0, t2), converged };
}

/** Estimate residual τ² for design X with the requested method. */
function estimateTau2(X, y, v, method, feFit) {
  const k = X.length, p = X[0].length;
  const mm = tau2MM(feFit.QE, k, p, feFit.c);
  if (method === 'REML') {
    const r = tau2REML(X, y, v, mm);
    return { tau2: r.tau2, converged: r.converged, mm };
  }
  return { tau2: mm, converged: true, mm };
}

// ── main entry point ────────────────────────────────────────────────────────
/**
 * metaRegression(studies, opts)
 *
 * @param {Array} studies  Each: { es|effect, se|variance|vi|(lo,hi), <covariate…>, id?, author?, year? }
 * @param {object} opts
 *   - covariate  {string}                  single covariate name (shorthand)
 *   - covariates {Array<{name,type}|string>} one or more covariates (multivariable-ready)
 *   - type       {'continuous'|'binary'|'categorical'|'ordinal'} type for `covariate`
 *   - method     {'MM'|'REML'}             τ² estimator (default 'MM')
 *   - measure    {string}                  effect-measure label (informational, stored in provenance)
 * @returns {object} result (see file header / README for the full shape)
 */
export function metaRegression(studies, opts = {}) {
  const method = opts.method === 'REML' ? 'REML' : 'MM';
  const warnings = [];
  const warn = (type, message, extra) => warnings.push({ type, message, ...(extra || {}) });

  // ── normalise the covariate spec list (univariate shorthand → list) ──
  let specs = [];
  if (Array.isArray(opts.covariates) && opts.covariates.length) {
    specs = opts.covariates.map((c) =>
      typeof c === 'string' ? { name: c, type: undefined } : { name: c.name, type: c.type });
  } else if (opts.covariate) {
    specs = [{ name: opts.covariate, type: opts.type }];
  }
  if (!specs.length || specs.some((s) => !s.name)) {
    warn('MISSING_COVARIATE_DATA', 'No covariate specified for meta-regression.');
    return degenerate(warnings, method, specs);
  }
  const covNames = specs.map((s) => s.name);

  if (!Array.isArray(studies) || studies.length === 0) {
    warn('TOO_FEW_STUDIES', 'No studies supplied.');
    return degenerate(warnings, method, specs);
  }

  // ── retain studies with a usable effect, variance and ALL covariate values ──
  const rows = [];
  let kDropped = 0;
  for (const s of studies) {
    const es = num(s.es !== undefined ? s.es : s.effect);
    const v = studyVariance(s);
    const cov = {};
    let covOk = true;
    for (const spec of specs) {
      const raw = s[spec.name];
      if (raw === '' || raw === null || raw === undefined) { covOk = false; break; }
      cov[spec.name] = raw;
    }
    if (isNaN(es) || !(v > 0) || !covOk) { kDropped++; continue; }
    rows.push({ _es: es, _v: v, _cov: cov, _id: s.id, _label: studyLabel(s), _raw: s });
  }
  const k = rows.length;
  if (kDropped > 0) {
    warn('MISSING_COVARIATE_DATA',
      `${kDropped} stud${kDropped === 1 ? 'y was' : 'ies were'} dropped for a missing effect, variance, or covariate value.`,
      { n: kDropped });
  }

  // ── build the design matrix (intercept + covariate columns) ──
  const modOut = [];
  const covCols = [];
  let primary = null; // the single covariate spec used for the bubble x-axis
  for (const spec of specs) {
    const built = buildCovariateColumns(spec, rows);
    if (built.error) {
      warn('DEGENERATE', built.error);
      return degenerate(warnings, method, specs, { k, kDropped });
    }
    built.cols.forEach((col) => covCols.push(col));
    built.out.forEach((o) => modOut.push(o));
    if (!primary) primary = { spec, built };
  }
  const nMod = covCols.length;             // number of moderator columns
  const p = nMod + 1;                       // + intercept

  // ── guardrails that decide analysability ──
  if (k < 3) {
    warn('TOO_FEW_STUDIES', `Only ${k} usable stud${k === 1 ? 'y' : 'ies'} — meta-regression needs at least 3.`);
    return degenerate(warnings, method, specs, { k, kDropped });
  }
  if (k < nMod + 2) {
    warn('TOO_FEW_STUDIES',
      `${k} studies cannot support ${nMod} moderator${nMod === 1 ? '' : 's'} (need at least ${nMod + 2} for any residual degrees of freedom).`);
    return degenerate(warnings, method, specs, { k, kDropped });
  }

  // Assemble X (k×p), y (k), v (k).
  const X = rows.map((r, i) => {
    const row = [1];
    for (let c = 0; c < nMod; c++) row.push(covCols[c][i]);
    return row;
  });
  const y = rows.map((r) => r._es);
  const v = rows.map((r) => r._v);

  // ── fit ──
  const wFE = v.map((vi) => 1 / vi);
  const feFit = wlsFit(X, y, wFE);
  if (!feFit) {
    warn('DEGENERATE', 'The design matrix is singular (constant or collinear covariate). Cannot estimate the model.');
    return degenerate(warnings, method, specs, { k, kDropped });
  }
  const dfE = k - p;
  const { tau2, converged, mm } = estimateTau2(X, y, v, method, feFit);
  if (method === 'REML' && !converged) {
    warn('REML_FALLBACK', 'REML did not converge; reporting the method-of-moments τ² instead.');
  }

  // Random-effects refit at the estimated τ².
  const wRE = v.map((vi) => 1 / (vi + tau2));
  const reFit = wlsFit(X, y, wRE);
  if (!reFit) {
    warn('DEGENERATE', 'The random-effects design matrix is singular. Cannot estimate the model.');
    return degenerate(warnings, method, specs, { k, kDropped });
  }
  const beta = reFit.beta;
  const cov = reFit.cov;

  // Intercept-only τ² (total), SAME estimator, for R².
  const X0 = rows.map(() => [1]);
  const fe0 = wlsFit(X0, y, wFE);
  let tau2Before = 0;
  if (fe0) {
    tau2Before = method === 'REML'
      ? tau2REML(X0, y, v, tau2MM(fe0.QE, k, 1, fe0.c)).tau2
      : tau2MM(fe0.QE, k, 1, fe0.c);
  }
  const tau2Reduction = Math.max(0, tau2Before - tau2);
  const R2 = tau2Before > 0 ? Math.max(0, (tau2Before - tau2) / tau2Before) : null;

  // Residual I² = 100·τ²/(τ² + s²), s² = (k−p)/c (typical within-study variance).
  const s2 = dfE > 0 && feFit.c > 0 ? (k - p) / feFit.c : NaN;
  const I2resid = isFinite(s2) && (tau2 + s2) > 0 ? 100 * tau2 / (tau2 + s2) : 0;

  // ── coefficient table ──
  const coefEntry = (idx, base) => {
    const coef = beta[idx];
    const se = Math.sqrt(Math.max(cov[idx][idx], 0));
    const z = se > 0 ? coef / se : 0;
    return {
      ...base,
      coef, se, z,
      pval: se > 0 ? pFromZ(z) : 1,
      ciLo: coef - Z975 * se,
      ciHi: coef + Z975 * se,
    };
  };
  const intercept = coefEntry(0, {});
  const moderators = modOut.map((m, j) => coefEntry(j + 1, m));

  // ── omnibus Wald test of all moderators (QM ~ χ²_nMod) ──
  let omnibus = null;
  if (nMod >= 1) {
    // Cov block for moderators = cov[1..p][1..p]; QM = βm' (block)⁻¹ βm.
    const block = zeros(nMod, nMod);
    for (let a = 0; a < nMod; a++) for (let b = 0; b < nMod; b++) block[a][b] = cov[a + 1][b + 1];
    try {
      const binv = choleskyInverse(block);
      const bm = beta.slice(1);
      const tmp = matVec(binv, bm);
      let QM = 0;
      for (let a = 0; a < nMod; a++) QM += bm[a] * tmp[a];
      omnibus = { QM, df: nMod, pval: 1 - chiSquareCDF(QM, nMod) };
    } catch { omnibus = null; }
  }

  // ── standard meta-regression caveats ──
  if (k < 10 * specs.length) {
    warn('TOO_FEW_STUDIES',
      `${k} studies for ${specs.length} covariate${specs.length === 1 ? '' : 's'} — the widely-cited rule of thumb is ≥10 studies per covariate. Interpret with caution (low power, unstable estimates).`);
  }
  if (nMod >= 2 && k / nMod < 10) {
    warn('TOO_MANY_COVARIATES',
      `${nMod} moderator terms on ${k} studies (<10 studies per term) risks overfitting and spurious associations.`);
  }
  if (nMod >= 2) {
    warn('MULTIPLE_TESTING',
      'Multiple moderators are tested — p-values are not adjusted for multiplicity; treat individual coefficients as exploratory.');
  }
  warn('ECOLOGICAL_BIAS',
    'Covariates are study-level aggregates; a relationship across studies need not hold within studies (ecological fallacy / aggregation bias).');
  warn('OBSERVATIONAL_COVARIATE',
    'Studies are not randomised to covariate values, so any association is observational and cannot establish that the covariate causes the effect.');

  // ── bubble-plot geometry ──
  const bubble = buildBubble(rows, beta, cov, primary, nMod, wRE);

  return {
    ok: true,
    k, kDropped,
    model: 'random',
    method,
    intercept,
    moderators,
    tau2, tau2Before, tau2Reduction,
    residual: {
      QE: feFit.QE,
      QEp: dfE > 0 ? 1 - chiSquareCDF(feFit.QE, dfE) : null,
      df: dfE,
    },
    R2,
    I2resid,
    omnibus,
    warnings,
    bubble,
    provenance: {
      engineVersion: ENGINE_VERSION,
      method,
      covariate: covNames.length === 1 ? covNames[0] : covNames,
      covariates: covNames,
      measure: opts.measure || null,
      n: k,
    },
  };
}

/** Bubble points + (single continuous covariate) regression line and 95% CI band. */
function buildBubble(rows, beta, cov, primary, nMod, wRE) {
  const points = rows.map((r, i) => {
    const rawX = primary ? r._cov[primary.spec.name] : undefined;
    const x = primary && primary.built.plotValue ? primary.built.plotValue(rawX) : NaN;
    return { x, y: r._es, weight: wRE[i], label: r._label, studyId: r._id ?? null };
  });

  let line = null, band = null;
  const singleNumeric =
    nMod === 1 && primary &&
    ['continuous', 'ordinal', 'binary'].includes(primary.built.out[0].kind);

  if (singleNumeric) {
    const xs = points.map((pt) => pt.x).filter((x) => isFinite(x));
    if (xs.length >= 2) {
      const x0 = Math.min(...xs), x1 = Math.max(...xs);
      const b0 = beta[0], b1 = beta[1];
      line = { slope: b1, intercept: b0, x0, x1 };

      // 95% CI band ONLY for a single continuous covariate.
      if (primary.built.out[0].kind === 'continuous' && x1 > x0) {
        const N = 30;
        band = [];
        const c00 = cov[0][0], c01 = cov[0][1], c11 = cov[1][1];
        for (let g = 0; g <= N; g++) {
          const x = x0 + (x1 - x0) * (g / N);
          const yhat = b0 + b1 * x;
          const varHat = c00 + 2 * x * c01 + x * x * c11;
          const half = Z975 * Math.sqrt(Math.max(varHat, 0));
          band.push({ x, lo: yhat - half, hi: yhat + half });
        }
      }
    }
  }
  return { points, line, band };
}

/** Structured non-result for degenerate / under-powered inputs (never throws). */
function degenerate(warnings, method, specs, extra = {}) {
  const covNames = (specs || []).map((s) => s.name).filter(Boolean);
  return {
    ok: false,
    k: extra.k ?? 0,
    kDropped: extra.kDropped ?? 0,
    model: 'random',
    method,
    intercept: null,
    moderators: [],
    tau2: null, tau2Before: null, tau2Reduction: null,
    residual: { QE: null, QEp: null, df: null },
    R2: null,
    I2resid: null,
    omnibus: null,
    warnings,
    bubble: { points: [], line: null, band: null },
    provenance: {
      engineVersion: ENGINE_VERSION,
      method,
      covariate: covNames.length === 1 ? covNames[0] : covNames,
      covariates: covNames,
      measure: null,
      n: extra.k ?? 0,
    },
  };
}
