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
 * CONVERSIONS
 * Array of conversion recipe objects.  Each recipe has:
 *   id      {string}   unique identifier
 *   group   {string}   display group label
 *   label   {string}   human-readable name
 *   inputs  {Array}    [[fieldName, displayLabel], …]
 *   method  {string}   citation / formula description
 *   run     {Function} (params: object) → { ok, values, formula, detail } | { ok:false, error }
 *
 * @type {Array<{id:string, group:string, label:string, inputs:Array, method:string, run:Function}>}
 */
export const CONVERSIONS = [
  {
    id: "median_iqr",
    group: "Continuous → Mean/SD",
    label: "Median + IQR → Mean & SD",
    inputs: [["q1","Q1 (25th pct)"],["med","Median (Q2)"],["q3","Q3 (75th pct)"],["n","Sample size n"]],
    method: "Wan et al. (2014), Box-Cox method",
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
];
