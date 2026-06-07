/**
 * meta-analysis.js
 * Core meta-analysis engine: pooling, heterogeneity, sensitivity analyses,
 * publication-bias tests, and subgroup analysis.
 *
 * All formulas are copied verbatim from meta-lab-3-patched.jsx.
 */

import { Z975, normalCDF, chiSquareCDF, tCDF, tCrit } from './math-helpers.js';

/**
 * runMeta(studies, method)
 * Fixed-effects (inverse-variance) and random-effects (DerSimonian–Laird)
 * pooled meta-analysis with HKSJ adjustment and prediction interval.
 *
 * @param {Array}  studies  Array of study objects; each must have {es, lo, hi} as strings or numbers.
 * @param {string} method   "fixed" | "random" (default "random")
 * @returns {object|null}   Full result object, or null if fewer than 2 valid studies.
 *
 * Result shape:
 *   { studies, k, Q, Qpval, I2, I2desc, tau2, pES, pSE, lo95, hi95, pval, z,
 *     method, W, tau, fixed, random, hksj, predInt }
 */
export function runMeta(studies, method = "random") {
  const valid = studies.filter(
    s => s.es !== "" && s.lo !== "" && s.hi !== "" &&
         !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)
  );
  if (valid.length < 2) return null;

  const d = valid.map(s => {
    const es = +s.es, lo = +s.lo, hi = +s.hi;
    const se = (hi - lo) / (2 * Z975), w = 1 / (se * se);
    return { ...s, _es: es, _lo: lo, _hi: hi, _se: se, _w: w, _pct: 0 };
  });

  const W  = d.reduce((a, x) => a + x._w, 0);
  const W2 = d.reduce((a, x) => a + x._w ** 2, 0);
  const fixES = d.reduce((a, x) => a + x._w * x._es, 0) / W;
  const Q = d.reduce((a, x) => a + x._w * (x._es - fixES) ** 2, 0);
  const k = d.length;
  const I2 = k > 1 ? Math.max(0, ((Q - (k - 1)) / Q) * 100) : 0;

  // τ² (DerSimonian–Laird) — always computed so both models can be reported
  const tau2all = Math.max(0, (Q - (k - 1)) / (W - W2 / W));

  // random-effects weights (always available for side-by-side reporting)
  const rwAll = d.map(x => 1 / (x._se ** 2 + tau2all));
  const rWall = rwAll.reduce((a, w) => a + w, 0);

  // expose both fixed and random weight percentages on every study
  d.forEach((x, i) => {
    x._wFixed    = x._w;
    x._wRandom   = rwAll[i];
    x._wFixedPct  = (x._w / W) * 100;
    x._wRandomPct = (rwAll[i] / rWall) * 100;
  });

  let pES, pSE, tau2 = 0;
  if (method === "fixed") {
    pES = fixES; pSE = Math.sqrt(1 / W);
    d.forEach(x => { x._pct = x._wFixedPct; });
  } else {
    tau2 = tau2all;
    pES = rwAll.reduce((a, w, i) => a + w * d[i]._es, 0) / rWall;
    pSE = Math.sqrt(1 / rWall);
    d.forEach((x, i) => { x._rw = rwAll[i]; x._pct = x._wRandomPct; });
  }

  const z    = pES / pSE;
  const pval = 2 * (1 - normalCDF(Math.abs(z)));

  // Q-test p-value for heterogeneity (chi-square, df = k-1)
  const Qpval = k > 1 ? (1 - chiSquareCDF(Q, k - 1)) : 1;
  const I2desc = I2 < 25 ? "low" : I2 < 50 ? "moderate" : I2 < 75 ? "substantial" : "considerable";

  // fixed and random pooled estimates (for side-by-side reporting)
  const fixSE = Math.sqrt(1 / W);
  const ranSE = Math.sqrt(1 / rWall);
  const ranES = rwAll.reduce((a, w, i) => a + w * d[i]._es, 0) / rWall;

  // ── Hartung–Knapp–Sidik–Jonkman (HKSJ) adjustment (random-effects) ──
  // q = (1/(k-1)) Σ w*_i (y_i − μ*)²  with random-effects weights
  // SE_hksj = sqrt(q) * sqrt(1/Σw*)
  let hksj = null;
  if (k >= 2) {
    const qHK = rwAll.reduce((a, w, i) => a + w * (d[i]._es - ranES) ** 2, 0) / (k - 1);
    const seHK = Math.sqrt(Math.max(qHK, 1e-12)) * Math.sqrt(1 / rWall);
    const tc   = tCrit(0.95, k - 1);
    const tStat = ranES / seHK;
    const pHK  = 2 * (1 - tCDF(Math.abs(tStat), k - 1));
    hksj = {
      es:    +ranES.toFixed(4),
      se:    +seHK.toFixed(4),
      lo:    +(ranES - tc * seHK).toFixed(4),
      hi:    +(ranES + tc * seHK).toFixed(4),
      t:     +tStat.toFixed(3),
      df:    k - 1,
      tcrit: +tc.toFixed(3),
      pval:  +pHK.toFixed(4),
    };
  }

  // ── Prediction interval (where a future study's true effect would likely fall) ──
  // PI = μ ± t(k-2) * sqrt(τ² + SE_μ²) ; needs k ≥ 3
  let predInt = null;
  if (k >= 3) {
    const tcP    = tCrit(0.95, k - 2);
    const sePred = Math.sqrt(tau2all + ranSE * ranSE);
    predInt = {
      lo:     +(ranES - tcP * sePred).toFixed(4),
      hi:     +(ranES + tcP * sePred).toFixed(4),
      df:     k - 2,
      sePred: +sePred.toFixed(4),
    };
  }

  return {
    studies: d, k,
    Q:      +Q.toFixed(3),
    Qpval:  +Qpval.toFixed(4),
    I2:     +I2.toFixed(1),
    I2desc,
    tau2:   +tau2.toFixed(5),
    pES:    +pES.toFixed(4),
    pSE:    +pSE.toFixed(4),
    lo95:   +(pES - Z975 * pSE).toFixed(4),
    hi95:   +(pES + Z975 * pSE).toFixed(4),
    pval:   +pval.toFixed(4),
    z:      +z.toFixed(3),
    method, W: +W.toFixed(4),
    tau:    +Math.sqrt(tau2all).toFixed(4),
    fixed: {
      es: +fixES.toFixed(4), se: +fixSE.toFixed(4),
      lo: +(fixES - Z975 * fixSE).toFixed(4),
      hi: +(fixES + Z975 * fixSE).toFixed(4),
    },
    random: {
      es:   +ranES.toFixed(4), se: +ranSE.toFixed(4),
      lo:   +(ranES - Z975 * ranSE).toFixed(4),
      hi:   +(ranES + Z975 * ranSE).toFixed(4),
      tau2: +tau2all.toFixed(5),
    },
    hksj, predInt,
  };
}

/**
 * eggersTest(studies)
 * Egger's weighted linear regression test for small-study effects
 * (publication bias).  Regresses standardised effect (y = ES/SE) on
 * precision (x = 1/SE) with inverse-variance weights.
 *
 * @param {Array} studies
 * @returns {object|null}  { intercept, seInt, t, pval, dof, k } or null if k < 3
 */
export function eggersTest(studies) {
  const valid = studies.filter(
    s => s.es !== "" && s.lo !== "" && s.hi !== "" &&
         !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)
  );
  if (valid.length < 3) return null;

  const pts = valid.map(s => {
    const es = +s.es, se = (+s.hi - +s.lo) / (2 * Z975);
    return { y: es / se, x: 1 / se, w: 1 / (se * se) };
  });

  const n = pts.length;
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  pts.forEach(p => { sw += p.w; sx += p.w * p.x; sy += p.w * p.y; sxx += p.w * p.x * p.x; sxy += p.w * p.x * p.y; });

  const mx = sx / sw, my = sy / sw;
  const slope     = (sxy - sw * mx * my) / (sxx - sw * mx * mx);
  const intercept = my - slope * mx;

  // SE of intercept
  let resid = 0;
  pts.forEach(p => { const fit = intercept + slope * p.x; resid += p.w * (p.y - fit) ** 2; });
  const dof = n - 2;
  if (dof < 1) return null;

  const s2    = resid / dof;
  const seInt = Math.sqrt(s2 * (sxx / sw) / (sxx - sw * mx * mx));
  const t     = intercept / seInt;
  const pv    = 2 * (1 - tCDF(Math.abs(t), dof));

  return {
    intercept: +intercept.toFixed(4),
    seInt:     +seInt.toFixed(4),
    t:         +t.toFixed(3),
    pval:      +pv.toFixed(4),
    dof, k: n,
  };
}

/**
 * leaveOneOut(studies, method)
 * Leave-one-out sensitivity analysis: re-pools after removing each study.
 *
 * @param {Array}  studies
 * @param {string} method  "fixed" | "random"
 * @returns {Array}  Array of { omitted, omittedId, pES, lo95, hi95, I2, pval }
 */
export function leaveOneOut(studies, method) {
  const valid = studies.filter(
    s => s.es !== "" && s.lo !== "" && s.hi !== "" &&
         !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)
  );
  if (valid.length < 3) return [];
  return valid.map((omitted, idx) => {
    const subset = valid.filter((_, i) => i !== idx);
    const res    = runMeta(subset, method || "random");
    return {
      omitted:   (omitted.author || "Study") + (omitted.year ? " " + omitted.year : ""),
      omittedId: omitted.id,
      pES:  res ? res.pES  : null,
      lo95: res ? res.lo95 : null,
      hi95: res ? res.hi95 : null,
      I2:   res ? res.I2   : null,
      pval: res ? res.pval : null,
    };
  });
}

/**
 * trimFill(studies, method)
 * Duval & Tweedie L0 trim-and-fill estimator for publication-bias adjustment.
 * Imputes mirror-image studies on the under-represented side and re-pools.
 *
 * @param {Array}  studies
 * @param {string} method  "fixed" | "random"
 * @returns {object|null}  { k0, adjusted, imputed, side, base } or null
 */
export function trimFill(studies, method) {
  const valid = studies.filter(
    s => s.es !== "" && s.lo !== "" && s.hi !== "" &&
         !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)
  );
  if (valid.length < 3) return null;
  const base = runMeta(valid, method || "random");
  if (!base) return null;

  const d = valid.map(s => {
    const es = +s.es, se = (+s.hi - +s.lo) / (2 * 1.96);
    return { es, se };
  });

  function poolMean(arr) {
    const w = arr.map(x => 1 / (x.se * x.se));
    const W = w.reduce((a, b) => a + b, 0);
    return arr.reduce((a, x, i) => a + w[i] * x.es, 0) / W;
  }

  let side = null, k0 = 0, prevK0 = -1, iter = 0;
  let working = d.slice();

  while (k0 !== prevK0 && iter < 30) {
    prevK0 = k0; iter++;
    const mu  = poolMean(working);
    const dev = working.map(x => ({ v: x.es - mu, es: x.es, se: x.se }));
    const sorted = dev.slice().sort((a, b) => Math.abs(a.v) - Math.abs(b.v));
    let Tn = 0, Sr = 0;
    sorted.forEach((x, i) => { if (x.v > 0) Tn += (i + 1); });
    sorted.forEach((x, i) => { Sr += (x.v > 0 ? 1 : -1) * (i + 1); });
    const n  = working.length;
    const L0 = (4 * Tn - n * (n + 1)) / (2 * n - 1);
    k0 = Math.max(0, Math.round(L0));
    side = Sr < 0 ? "right" : "left";
    const trimmed = d.slice().sort((a, b) => Math.abs(b.es - mu) - Math.abs(a.es - mu));
    working = trimmed.slice(k0);
    if (working.length < 2) { working = d.slice(); break; }
  }

  if (k0 <= 0) {
    return { k0: 0, adjusted: base, imputed: [], side: null, base };
  }

  const muFinal = poolMean(working);
  const bySide  = d.slice().sort((a, b) => (b.es - muFinal) - (a.es - muFinal));
  const extreme = side === "left" ? bySide.slice(0, k0) : bySide.slice(-k0);
  const imputed = extreme.map(x => {
    const mir = 2 * muFinal - x.es;
    return {
      es: +mir.toFixed(4), se: x.se,
      lo: +(mir - 1.96 * x.se).toFixed(4),
      hi: +(mir + 1.96 * x.se).toFixed(4),
      imputed: true,
    };
  });

  const augmented = valid.concat(imputed.map(x => ({ es: x.es, lo: x.lo, hi: x.hi })));
  const adjusted  = runMeta(augmented, method || "random");
  return { k0, adjusted, imputed, side, base };
}

/**
 * influenceDiagnostics(studies, method)
 * Per-study leave-one-out influence metrics: τ², I² shift, and a
 * standardised influence score (DFFITS-style).
 *
 * @param {Array}  studies
 * @param {string} method  "fixed" | "random"
 * @returns {Array}  Array of { id, label, pES, tau2, I2, dffit, tau2Drop, i2Drop, influential }
 */
export function influenceDiagnostics(studies, method) {
  const valid = studies.filter(
    s => s.es !== "" && s.lo !== "" && s.hi !== "" &&
         !isNaN(+s.es) && !isNaN(+s.lo) && !isNaN(+s.hi)
  );
  if (valid.length < 3) return [];
  const full = runMeta(valid, method || "random");
  if (!full) return [];

  return valid.map((omit, idx) => {
    const subset = valid.filter((_, i) => i !== idx);
    const r = runMeta(subset, method || "random");
    if (!r) return null;
    const dffit = (full.pES - r.pES) / (full.pSE || 1);
    return {
      id:       omit.id,
      label:    (omit.author || "Study") + (omit.year ? " " + omit.year : ""),
      pES:      r.pES,
      tau2:     r.tau2,
      I2:       r.I2,
      dffit:    +dffit.toFixed(3),
      tau2Drop: +(full.tau2 - r.tau2).toFixed(4),
      i2Drop:   +(full.I2 - r.I2).toFixed(1),
      influential: Math.abs(dffit) > 1 || Math.abs(full.I2 - r.I2) > 25,
    };
  }).filter(Boolean);
}

/**
 * subgroupAnalysis(studies, groupKey, method)
 * Runs runMeta within each level of groupKey; then tests for between-group
 * differences via the Q-between statistic (approximate chi-square).
 *
 * @param {Array}  studies
 * @param {string} groupKey  property name on study objects used for grouping
 * @param {string} method    "fixed" | "random"
 * @returns {{ groups: Array, Qbetween: number|null, df: number, pBetween: number|null }}
 */
export function subgroupAnalysis(studies, groupKey, method) {
  const groups = {};
  studies.forEach(s => {
    const k = ((s[groupKey] || "Unspecified").toString().trim()) || "Unspecified";
    if (!groups[k]) groups[k] = [];
    groups[k].push(s);
  });

  const results = [];
  Object.keys(groups).forEach(k => {
    const r = runMeta(groups[k], method || "random");
    if (r) results.push({ group: k, n: groups[k].length, ...r });
  });

  if (results.length < 2) return { groups: results, Qbetween: null, pBetween: null };

  const overall = runMeta(studies, method || "random");
  if (!overall) return { groups: results, Qbetween: null, pBetween: null };

  const Qw = results.reduce((a, r) => a + r.Q, 0);
  const Qb = Math.max(0, overall.Q - Qw);
  const df = results.length - 1;
  const p  = df > 0 ? 1 - chiSquareCDF(Qb, df) : null;

  return {
    groups:    results,
    Qbetween:  +Qb.toFixed(3),
    df,
    pBetween:  p !== null ? +p.toFixed(4) : null,
  };
}
