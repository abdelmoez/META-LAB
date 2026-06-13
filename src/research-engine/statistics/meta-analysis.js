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
 * Egger's regression test for funnel-plot asymmetry / small-study effects
 * (publication bias). Canonical Egger (1997): an UNWEIGHTED ordinary
 * least-squares regression of the standard normal deviate (y = ES/SE) on
 * precision (x = 1/SE). The intercept is Egger's bias coefficient; an
 * intercept significantly different from zero indicates asymmetry.
 *
 * This is the published method and matches metafor::regtest(..., model = "lm").
 * The earlier implementation applied inverse-variance weights (w = 1/SE²),
 * which double-counts precision (y and x already carry 1/SE) and inflates the
 * intercept, t and p — it did NOT match Egger 1997 or metafor. Fixed to
 * ordinary least squares (every weight = 1).
 *
 * Ref: Egger M, Davey Smith G, Schneider M, Minder C. BMJ. 1997;315:629-634.
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

  // y = ES/SE (standard normal deviate), x = 1/SE (precision); SE from the 95% CI.
  const pts = [];
  for (const s of valid) {
    const es = +s.es, se = (+s.hi - +s.lo) / (2 * Z975);
    if (!(se > 0)) return null;            // degenerate SE — cannot regress
    pts.push({ y: es / se, x: 1 / se });
  }

  // Unweighted OLS: y = intercept + slope·x  (Σ closed form, all weights = 1)
  const k = pts.length;
  let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  pts.forEach(p => { Sx += p.x; Sy += p.y; Sxx += p.x * p.x; Sxy += p.x * p.y; });

  const denom = k * Sxx - Sx * Sx;
  if (denom === 0) return null;
  const slope     = (k * Sxy - Sx * Sy) / denom;
  const intercept = (Sy - slope * Sx) / k;   // Egger's bias coefficient

  const dof = k - 2;
  if (dof < 1) return null;

  // Residual variance and SE of the intercept (standard OLS results)
  let sse = 0;
  pts.forEach(p => { const e = p.y - (intercept + slope * p.x); sse += e * e; });
  const s2    = sse / dof;
  const seInt = Math.sqrt(s2 * Sxx / denom);
  const t     = intercept / seInt;
  const pv    = 2 * (1 - tCDF(Math.abs(t), dof));   // two-tailed t, df = k − 2

  return {
    intercept: +intercept.toFixed(4),
    seInt:     +seInt.toFixed(4),
    t:         +t.toFixed(3),
    pval:      +pv.toFixed(4),
    dof, k,
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
 * Reproduces metafor::trimfill(res) under the SELECTED model when the funnel's
 * over-represented side is unambiguous — k₀ and the adjusted estimate match metafor
 * to 4 d.p. on the validation fixture (random-effects k₀=0/0.6137, fixed-effect
 * k₀=4/0.2422). The centre that drives the L0 iteration (and the final mirror point)
 * is the pooled estimate of the *currently trimmed* set under the selected model —
 * fixed-effect inverse-variance, or DerSimonian–Laird random-effects with τ²
 * re-estimated each iteration. The rank statistic Tₙ and L0 are computed over the
 * FULL k studies.
 *
 * Side selection: the over-represented tail is chosen here by a signed-rank rule
 * (heavier side = larger Σ ranks of |yᵢ−μ|). metafor instead infers the side from a
 * regression slope; the two agree for clearly asymmetric funnels but can differ on
 * near-symmetric ones, where metafor's own docs note automatic side detection "is
 * not always reliable".
 *
 * (The earlier version always centred on the fixed-effect mean and ranked over the
 * trimmed subset with the trimmed count in L0, so a random-effects analysis
 * over-imputed — it matched neither metafor model. Fixed here.)
 *
 * Ref: Duval S, Tweedie R. Biometrics 2000;56:455-463.
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
  const mdl  = method || "random";
  const base = runMeta(valid, mdl);
  if (!base) return null;

  // Observed effects and SEs (Z975 keeps the SE→CI round-trip exact with runMeta).
  const obs = valid.map(s => {
    const es = +s.es, se = (+s.hi - +s.lo) / (2 * Z975);
    return { es, se };
  });
  const k = obs.length;

  // Pooled estimate of an {es,se} set under the SELECTED model (FE inverse-variance,
  // or DerSimonian–Laird random-effects with τ² re-estimated for this subset).
  const pooled = arr => {
    const wf = arr.map(x => 1 / (x.se * x.se));
    const Wf = wf.reduce((a, b) => a + b, 0);
    const muF = arr.reduce((a, x, i) => a + wf[i] * x.es, 0) / Wf;
    if (mdl === "fixed" || arr.length < 2) return muF;
    const Q  = arr.reduce((a, x, i) => a + wf[i] * (x.es - muF) ** 2, 0);
    const W2 = wf.reduce((a, w) => a + w * w, 0);
    const C  = Wf - W2 / Wf;
    const tau2 = C > 0 ? Math.max(0, (Q - (arr.length - 1)) / C) : 0;
    const wr = arr.map(x => 1 / (x.se * x.se + tau2));
    const Wr = wr.reduce((a, b) => a + b, 0);
    return arr.reduce((a, x, i) => a + wr[i] * x.es, 0) / Wr;
  };

  // Ranks of |yᵢ − μ| over the FULL set; split rank sums by side of μ.
  const rankSums = mu => {
    const dev = obs.map(x => x.es - mu);
    const order = dev.map((_, i) => i).sort((a, b) => Math.abs(dev[a]) - Math.abs(dev[b]));
    const rank = new Array(k);
    order.forEach((id, r) => { rank[id] = r + 1; });
    let Tr = 0, Tl = 0;
    dev.forEach((dv, i) => { if (dv > 0) Tr += rank[i]; else if (dv < 0) Tl += rank[i]; });
    return { Tr, Tl };
  };

  // Fix the heavy/over-represented side once from the full-data estimate; the
  // missing studies are imputed on the opposite ("side") tail.
  const beta0 = pooled(obs);
  const t0 = rankSums(beta0);
  const heavyRight = t0.Tr >= t0.Tl;     // right tail over-represented → impute left
  const side = heavyRight ? "left" : "right";
  const asc = obs.slice().sort((a, b) => a.es - b.es);

  let k0 = 0, prevK0 = -1, iter = 0, mu = beta0;
  while (k0 !== prevK0 && iter < 100) {
    prevK0 = k0; iter++;
    const trimmed = heavyRight ? asc.slice(0, k - k0) : asc.slice(k0);
    mu = pooled(trimmed);
    const t  = rankSums(mu);
    const Tn = heavyRight ? t.Tr : t.Tl;
    const L0 = (4 * Tn - k * (k + 1)) / (2 * k - 1);
    k0 = Math.max(0, Math.min(k - 1, Math.round(L0)));
  }

  if (k0 <= 0) {
    return { k0: 0, adjusted: base, imputed: [], side: null, base };
  }

  // Mirror the k0 most extreme studies on the heavy side about the final centre.
  const extreme = heavyRight ? asc.slice(k - k0) : asc.slice(0, k0);
  const imputed = extreme.map(x => {
    const mir = 2 * mu - x.es;
    return {
      es: +mir.toFixed(4), se: x.se,
      lo: +(mir - Z975 * x.se).toFixed(4),
      hi: +(mir + Z975 * x.se).toFixed(4),
      imputed: true,
    };
  });

  const augmented = valid.concat(imputed.map(x => ({ es: x.es, lo: x.lo, hi: x.hi })));
  const adjusted  = runMeta(augmented, mdl);
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
