/**
 * catalogue.js
 * Data-conversion catalogue used by the conversion panel.
 *
 * Each entry describes how to transform a reported statistic into a form
 * usable by the meta-analysis engine.  Formulas copied verbatim from
 * meta-lab-3-patched.jsx.
 *
 * invNorm is re-exported from math-helpers so callers can import everything
 * they need from this module alone if desired.
 */

import { invNorm } from '../statistics/math-helpers.js';

export { invNorm };

/**
 * CONVERSION_ENGINE_VERSION — bumped whenever any formula changes so a persisted
 * conversion can record which engine produced it (82.md Part 3/7). A stored
 * conversion whose `engineVersion` differs from this is treated as potentially
 * stale by harmonize.js. Additive metadata only — the `run()` contract is stable.
 */
export const CONVERSION_ENGINE_VERSION = '2026-07-13';

/**
 * CONVERSIONS
 * Array of conversion recipe objects.  Each recipe has:
 *   id         {string}   unique identifier
 *   group      {string}   display group label
 *   label      {string}   human-readable name
 *   inputs     {Array}    [[fieldName, displayLabel], …]
 *   method     {string}   citation / formula description
 *   run        {Function} (params: object) → { ok, values, formula, detail } | { ok:false, error }
 * Additive declarative metadata (82.md Part 7 — does NOT change run()):
 *   version    {string}   per-method version (bump when its formula changes)
 *   outputs    {string[]} the value keys run() produces on success
 *   required   {string[]} input field names that must be present + numeric
 *   assumptions{string[]} methodological assumptions a reviewer should know
 *   reference  {string}   short citation / methodology reference
 *   caution    {'low'|'medium'|'high'} default reliability tier
 *   warn       {Function} (p)→string[]  SOFT, non-blocking reliability warnings
 *                         (specific + actionable; never fails the conversion)
 *
 * @type {Array<object>}
 */
export const CONVERSIONS = [
  {
    id: "median_iqr",
    group: "Continuous → Mean/SD",
    label: "Median + IQR → Mean & SD",
    inputs: [["q1","Q1 (25th pct)"],["med","Median (Q2)"],["q3","Q3 (75th pct)"],["n","Sample size n"]],
    method: "Wan et al. (2014), Box-Cox method",
    version: "1.0",
    outputs: ["mean", "sd"],
    required: ["q1", "med", "q3", "n"],
    reference: "Wan X, Wang W, Liu J, Tong T. BMC Med Res Methodol 2014;14:135 (Scenario C3).",
    caution: "medium",
    assumptions: [
      "The underlying distribution is approximately normal.",
      "Q1/Q3 are the true 25th/75th percentiles (not a non-standard interquartile summary).",
    ],
    warn: p => {
      const q1 = +p.q1, med = +p.med, q3 = +p.q3, n = +p.n;
      const w = [];
      if (Number.isFinite(med) && Number.isFinite(q1) && med < q1) w.push("Median is below Q1 — check the reported quartiles (expect Q1 ≤ median ≤ Q3).");
      if (Number.isFinite(med) && Number.isFinite(q3) && med > q3) w.push("Median is above Q3 — check the reported quartiles (expect Q1 ≤ median ≤ Q3).");
      if (Number.isFinite(n) && n > 0 && n < 25) w.push("Small sample (n < 25): the normal-approximation estimate of SD is less reliable; consider extracting mean/SD directly if reported.");
      return w;
    },
    run: p => {
      const q1 = +p.q1, med = +p.med, q3 = +p.q3, n = +p.n;
      if ([q1,med,q3,n].some(isNaN) || n < 2 || q3 < q1)
        return { ok:false, error:"Need Q1 ≤ Q3 and n ≥ 2." };
      const mean  = (q1 + med + q3) / 3;
      const denom = 2 * invNorm((0.75*n - 0.125) / (n + 0.25));
      const sd    = (q3 - q1) / denom;
      return {
        ok: true,
        values: { mean: +mean.toFixed(4), sd: +sd.toFixed(4) },
        formula: "mean ≈ (Q1+median+Q3)/3 ;  SD ≈ (Q3−Q1) / [2·Φ⁻¹((0.75n−0.125)/(n+0.25))]",
        detail:  `mean = ${mean.toFixed(3)}, SD = ${sd.toFixed(3)}`,
      };
    },
  },

  {
    id: "median_range",
    group: "Continuous → Mean/SD",
    label: "Median + Range (min–max) → Mean & SD",
    inputs: [["min","Minimum"],["med","Median"],["max","Maximum"],["n","Sample size n"]],
    method: "Wan et al. (2014) / Hozo et al. (2005)",
    version: "1.0",
    outputs: ["mean", "sd"],
    required: ["min", "med", "max", "n"],
    reference: "Wan X et al. BMC Med Res Methodol 2014;14:135 (Scenario C1); Hozo SP et al. 2005.",
    caution: "high",
    assumptions: [
      "The underlying distribution is approximately normal.",
      "Range (min/max) is a weaker basis for SD than the IQR — prefer median+IQR when available.",
    ],
    warn: p => {
      const min = +p.min, med = +p.med, max = +p.max, n = +p.n;
      const w = [];
      if (Number.isFinite(med) && Number.isFinite(min) && med < min) w.push("Median is below the minimum — check the reported values (expect min ≤ median ≤ max).");
      if (Number.isFinite(med) && Number.isFinite(max) && med > max) w.push("Median is above the maximum — check the reported values (expect min ≤ median ≤ max).");
      if (Number.isFinite(n) && n > 0 && n < 15) w.push("Very small sample (n < 15): range-based SD is unstable; treat the estimate with caution.");
      return w;
    },
    run: p => {
      const min = +p.min, med = +p.med, max = +p.max, n = +p.n;
      if ([min,med,max,n].some(isNaN) || n < 2 || max < min)
        return { ok:false, error:"Need min ≤ max and n ≥ 2." };
      const mean  = (min + 2*med + max) / 4;
      const denom = 2 * invNorm((n - 0.375) / (n + 0.25));
      const sd    = (max - min) / denom;
      return {
        ok: true,
        values: { mean: +mean.toFixed(4), sd: +sd.toFixed(4) },
        formula: "mean ≈ (min+2·median+max)/4 ;  SD ≈ (max−min) / [2·Φ⁻¹((n−0.375)/(n+0.25))]",
        detail:  `mean = ${mean.toFixed(3)}, SD = ${sd.toFixed(3)}`,
      };
    },
  },

  {
    id: "se_sd",
    group: "Spread → SD",
    label: "Standard Error (SE) → SD",
    inputs: [["se","SE"],["n","Group n"]],
    method: "SD = SE × √n",
    version: "1.0",
    outputs: ["sd"],
    required: ["se", "n"],
    reference: "Cochrane Handbook §6.5.2.2 (SD = SE × √N).",
    caution: "low",
    assumptions: ["The reported SE is the SE of the group mean (not of a difference)."],
    warn: () => [],
    run: p => {
      const se = +p.se, n = +p.n;
      if ([se,n].some(isNaN) || n < 1 || se < 0)
        return { ok:false, error:"Need SE ≥ 0 and n ≥ 1." };
      const sd = se * Math.sqrt(n);
      return {
        ok: true,
        values: { sd: +sd.toFixed(4) },
        formula: "SD = SE × √n",
        detail:  `SD = ${sd.toFixed(3)}`,
      };
    },
  },

  {
    id: "ci_sd",
    group: "Spread → SD",
    label: "95% CI of a mean → SD",
    inputs: [["lo","CI lower"],["hi","CI upper"],["n","Group n"]],
    method: "SD = √n × (upper − lower) / (2 × 1.96)",
    version: "1.0",
    outputs: ["sd"],
    required: ["lo", "hi", "n"],
    reference: "Cochrane Handbook §6.5.2.3 (SD from a 95% CI of the mean).",
    caution: "medium",
    assumptions: [
      "The CI is a 95% confidence interval of the group MEAN.",
      "Uses z = 1.96; for small n the true t multiplier is larger, so SD is slightly underestimated.",
    ],
    warn: p => {
      const n = +p.n;
      return Number.isFinite(n) && n > 0 && n < 60
        ? ["Small sample (n < 60): the z = 1.96 approximation understates SD; the true t-multiplier is larger."]
        : [];
    },
    run: p => {
      const lo = +p.lo, hi = +p.hi, n = +p.n;
      if ([lo,hi,n].some(isNaN) || n < 1 || hi < lo)
        return { ok:false, error:"Need lower ≤ upper and n ≥ 1." };
      // mild small-n nudge toward t (informational only; formula keeps 1.96)
      const sd = Math.sqrt(n) * (hi - lo) / (2 * 1.96);
      return {
        ok: true,
        values: { sd: +sd.toFixed(4) },
        formula: "SD = √n × (upper − lower) / (2 × 1.96)",
        detail:  `SD = ${sd.toFixed(3)} (uses z=1.96; for small n the true t-value is slightly larger)`,
      };
    },
  },

  {
    id: "pval_se",
    group: "Spread → SD",
    label: "P-value + effect → SE",
    inputs: [["effect","Effect estimate (e.g. mean diff or log ratio)"],["p","Two-sided P-value"]],
    method: "z from P, then SE = |effect| / z",
    version: "1.0",
    outputs: ["se"],
    required: ["effect", "p"],
    reference: "Cochrane Handbook §6.5.2.4 (SE from a P-value and effect estimate).",
    caution: "medium",
    assumptions: [
      "The P-value is the two-sided P for the SAME effect estimate provided.",
      "For a ratio measure the effect must be the LOG effect (ln OR/RR/HR), not the ratio itself.",
    ],
    warn: p => {
      const pv = +p.p;
      return Number.isFinite(pv) && pv > 0.5
        ? ["Large P-value (> 0.5): the recovered SE is imprecise and sensitive to rounding of P."]
        : [];
    },
    run: p => {
      const eff = +p.effect, pv = +p.p;
      if ([eff,pv].some(isNaN) || pv <= 0 || pv >= 1)
        return { ok:false, error:"Need 0 < P < 1 and a numeric effect." };
      const z = Math.abs(invNorm(pv / 2));
      if (z === 0) return { ok:false, error:"P too close to 1 to recover SE." };
      const se = Math.abs(eff) / z;
      return {
        ok: true,
        values: { se: +se.toFixed(4) },
        formula: "z = Φ⁻¹(1 − P/2) ;  SE = |effect| / z",
        detail:  `z = ${z.toFixed(3)}, SE = ${se.toFixed(4)}`,
      };
    },
  },

  {
    id: "pct_events",
    group: "Counts ↔ Percent",
    label: "Percentage → Event count",
    inputs: [["pct","Percentage (%)"],["n","Group total n"]],
    method: "events = round(% / 100 × n)",
    version: "1.0",
    outputs: ["events", "total"],
    required: ["pct", "n"],
    reference: "Direct arithmetic (rounding to the nearest integer event count).",
    caution: "medium",
    assumptions: ["The percentage applies to the whole group n (not a subgroup)."],
    warn: p => {
      const pct = +p.pct, n = +p.n;
      const raw = pct / 100 * n;
      return Number.isFinite(raw) && Math.abs(raw - Math.round(raw)) > 0.05
        ? [`% × n = ${raw.toFixed(2)} is not close to a whole number — the reported percentage may be rounded; verify the event count.`]
        : [];
    },
    run: p => {
      const pct = +p.pct, n = +p.n;
      if ([pct,n].some(isNaN) || n < 1 || pct < 0 || pct > 100)
        return { ok:false, error:"Need 0 ≤ % ≤ 100 and n ≥ 1." };
      const ev = Math.round(pct / 100 * n);
      return {
        ok: true,
        values: { events: ev, total: n },
        formula: "events = round(% / 100 × n)",
        detail:  `events = ${ev} of ${n}`,
      };
    },
  },

  {
    id: "events_pct",
    group: "Counts ↔ Percent",
    label: "Event count → Percentage",
    inputs: [["events","Events"],["n","Group total n"]],
    method: "% = events / n × 100",
    version: "1.0",
    outputs: ["pct"],
    required: ["events", "n"],
    reference: "Direct arithmetic.",
    caution: "low",
    assumptions: [],
    warn: () => [],
    run: p => {
      const ev = +p.events, n = +p.n;
      if ([ev,n].some(isNaN) || n < 1 || ev < 0 || ev > n)
        return { ok:false, error:"Need 0 ≤ events ≤ n." };
      const pct = ev / n * 100;
      return {
        ok: true,
        values: { pct: +pct.toFixed(2) },
        formula: "% = events / n × 100",
        detail:  `${pct.toFixed(2)}%`,
      };
    },
  },

  {
    id: "ratio_log",
    group: "Ratio measures",
    label: "OR / RR / HR → log + SE from CI",
    inputs: [["est","Point estimate (OR/RR/HR)"],["lo","95% CI lower"],["hi","95% CI upper"]],
    method: "ln(estimate); SE = (ln(upper) − ln(lower)) / (2 × 1.96)",
    version: "1.0",
    outputs: ["es", "lo", "hi", "se"],
    required: ["est", "lo", "hi"],
    reference: "Cochrane Handbook §6.7 (log-transform a ratio measure + its 95% CI).",
    caution: "low",
    assumptions: [
      "The CI is a 95% confidence interval on the natural (ratio) scale.",
      "Output es/lo/hi are on the LOG scale (the analysis scale for ratio measures).",
    ],
    warn: p => {
      const est = +p.est, lo = +p.lo, hi = +p.hi;
      const w = [];
      if ([est, lo, hi].every(Number.isFinite) && (est < lo || est > hi)) w.push("Point estimate lies outside its confidence interval — check the reported values.");
      return w;
    },
    run: p => {
      const est = +p.est, lo = +p.lo, hi = +p.hi;
      if ([est,lo,hi].some(isNaN) || est <= 0 || lo <= 0 || hi <= 0 || hi < lo)
        return { ok:false, error:"Need positive estimate with lower ≤ upper." };
      const lnE = Math.log(est);
      const se  = (Math.log(hi) - Math.log(lo)) / (2 * 1.96);
      return {
        ok: true,
        values: { es: +lnE.toFixed(4), lo: +Math.log(lo).toFixed(4), hi: +Math.log(hi).toFixed(4), se: +se.toFixed(4) },
        formula: "ES = ln(estimate) ;  CI on log scale = ln(lower), ln(upper) ;  SE = (ln(upper) − ln(lower)) / (2×1.96)",
        detail:  `lnES = ${lnE.toFixed(4)}, log-CI [${Math.log(lo).toFixed(4)}, ${Math.log(hi).toFixed(4)}], SE = ${se.toFixed(4)}`,
      };
    },
  },

  {
    id: "unit_scale",
    group: "Other",
    label: "Unit conversion (linear scale factor)",
    inputs: [["val","Reported value"],["factor","Multiply by factor"]],
    method: "value × factor (e.g. mg→g use 0.001)",
    version: "1.0",
    outputs: ["value"],
    required: ["val", "factor"],
    reference: "Linear unit rescaling.",
    caution: "low",
    assumptions: ["The scale is linear (a single multiplicative factor)."],
    warn: () => [],
    run: p => {
      const v = +p.val, f = +p.factor;
      if ([v,f].some(isNaN)) return { ok:false, error:"Need numeric value and factor." };
      return {
        ok: true,
        values: { value: +(v * f).toFixed(6) },
        formula: "converted = value × factor",
        detail:  `${v} × ${f} = ${v * f}`,
      };
    },
  },

  {
    id: "variance_sd",
    group: "Spread → SD",
    label: "Variance → SD",
    inputs: [["variance","Variance (SD²)"]],
    method: "SD = √variance",
    version: "1.0",
    outputs: ["sd"],
    required: ["variance"],
    reference: "Definitional (SD is the square root of the variance).",
    caution: "low",
    assumptions: ["The reported value is the variance of the group (not of a difference or a regression residual)."],
    warn: () => [],
    run: p => {
      const variance = +p.variance;
      if (isNaN(variance) || variance < 0) return { ok:false, error:"Variance must be ≥ 0." };
      const sd = Math.sqrt(variance);
      return {
        ok: true,
        values: { sd: +sd.toFixed(4) },
        formula: "SD = √variance",
        detail:  `SD = ${sd.toFixed(4)}`,
      };
    },
  },

  {
    id: "ci_se",
    group: "Spread → SD",
    label: "95% CI → SE",
    inputs: [["lo","CI lower"],["hi","CI upper"]],
    method: "SE = (upper − lower) / (2 × 1.96)",
    version: "1.0",
    outputs: ["se"],
    required: ["lo", "hi"],
    reference: "Cochrane Handbook §6.5.2.3 (SE from a 95% CI).",
    caution: "low",
    assumptions: [
      "The CI is a 95% confidence interval for the estimate provided.",
      "For a ratio measure, apply this to the LOG-scale CI limits.",
    ],
    warn: () => [],
    run: p => {
      const lo = +p.lo, hi = +p.hi;
      if ([lo,hi].some(isNaN) || hi < lo) return { ok:false, error:"Need lower ≤ upper." };
      const se = (hi - lo) / (2 * 1.96);
      return {
        ok: true,
        values: { se: +se.toFixed(4) },
        formula: "SE = (upper − lower) / (2 × 1.96)",
        detail:  `SE = ${se.toFixed(4)}`,
      };
    },
  },
];

/** conversionById(id) — look up a single recipe by id, or null. */
export function conversionById(id) {
  return CONVERSIONS.find((c) => c.id === id) || null;
}

/** softWarnings(id, params) — run a recipe's non-blocking reliability warnings. */
export function softWarnings(id, params = {}) {
  const c = conversionById(id);
  if (!c || typeof c.warn !== 'function') return [];
  try { return c.warn(params) || []; } catch { return []; }
}
