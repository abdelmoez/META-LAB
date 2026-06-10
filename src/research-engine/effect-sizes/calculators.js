/**
 * calculators.js
 * Effect-size calculators for all supported measure types.
 * All formulas are copied verbatim from meta-lab-3-patched.jsx.
 *
 * Every calculator returns { es, se, lo, hi, [display] } on success,
 * or null on invalid/insufficient input.
 */

/**
 * calcES(type, params)
 * Unified effect-size calculator.
 *
 * @param {string} type   One of: "SMD" | "MD" | "OR" | "RR" | "HR" | "COR" | "PROP" | "DIAG"
 * @param {object} params Raw data parameters (see per-type breakdown below)
 * @returns {object|null} { es, se, lo, hi, [display] } or null
 *
 * Supported types and required params:
 *
 *   SMD  — Cohen's d (pooled-SD standardiser; NO Hedges' g small-sample correction)
 *          { n1, n2, sd1, sd2, m1, m2 }
 *
 *   MD   — Raw mean difference
 *          { n1, n2, sd1, sd2, m1, m2 }
 *
 *   OR   — Odds Ratio (returned on log scale)
 *          { a, b, c, d }  2×2 table: a=event/exp, b=no-event/exp, c=event/ctrl, d=no-event/ctrl
 *
 *   RR   — Risk Ratio (returned on log scale)
 *          { a, b, c, d }
 *
 *   HR   — Hazard Ratio (returned on log scale; CI back-transformed from reported CI)
 *          { hr, lo, hi }  — reported HR and its 95% CI
 *
 *   COR  — Pearson correlation (returned as Fisher z)
 *          { r, n }
 *
 *   PROP — Single-arm proportion (returned on logit scale; continuity correction at extremes)
 *          { events, total }
 *
 *   DIAG — Diagnostic Odds Ratio (returned on log scale; Haldane correction if any cell is 0)
 *          { tp, fp, fn, tn }
 */
export function calcES(type, p) {
  try {
    if (type === "SMD" || type === "MD") {
      const n1 = +p.n1, n2 = +p.n2, sd1 = +p.sd1, sd2 = +p.sd2, m1 = +p.m1, m2 = +p.m2;
      if ([n1, n2, sd1, sd2, m1, m2].some(isNaN) || n1 < 2 || n2 < 2) return null;

      if (type === "MD") {
        const es = m1 - m2;
        const se = Math.sqrt(sd1 ** 2 / n1 + sd2 ** 2 / n2);
        return {
          es: +es.toFixed(4), se: +se.toFixed(4),
          lo: +(es - 1.96 * se).toFixed(4),
          hi: +(es + 1.96 * se).toFixed(4),
        };
      }

      // SMD — Cohen's d with the pooled-SD standardiser and the large-sample
      // variance of d. The Hedges' g small-sample correction
      // J = 1 − 3/(4(n1+n2−2) − 1) is NOT applied (recommended next step —
      // adding it would change every SMD result pinned by the unit tests).
      const poolSD = Math.sqrt(((n1 - 1) * sd1 ** 2 + (n2 - 1) * sd2 ** 2) / (n1 + n2 - 2));
      const d  = (m1 - m2) / poolSD;
      const se = Math.sqrt((n1 + n2) / (n1 * n2) + d ** 2 / (2 * (n1 + n2)));
      return {
        es: +d.toFixed(4), se: +se.toFixed(4),
        lo: +(d - 1.96 * se).toFixed(4),
        hi: +(d + 1.96 * se).toFixed(4),
      };
    }

    if (type === "OR" || type === "RR") {
      const a = +p.a, b = +p.b, c = +p.c, d2 = +p.d;
      if ([a, b, c, d2].some(v => isNaN(v) || v <= 0)) return null;
      const lnE = type === "OR"
        ? Math.log((a * d2) / (b * c))
        : Math.log((a / (a + b)) / (c / (c + d2)));
      const se = type === "OR"
        ? Math.sqrt(1/a + 1/b + 1/c + 1/d2)
        : Math.sqrt(1/a - 1/(a + b) + 1/c - 1/(c + d2));
      return {
        es: +lnE.toFixed(4), se: +se.toFixed(4),
        lo: +(lnE - 1.96 * se).toFixed(4),
        hi: +(lnE + 1.96 * se).toFixed(4),
        display: `${type}=${Math.exp(lnE).toFixed(3)} [${Math.exp(lnE - 1.96*se).toFixed(3)}, ${Math.exp(lnE + 1.96*se).toFixed(3)}]`,
      };
    }

    if (type === "HR") {
      const hr = +p.hr, lo = +p.lo, hi = +p.hi;
      if ([hr, lo, hi].some(isNaN) || hr <= 0 || lo <= 0 || hi <= 0) return null;
      const lnHR = Math.log(hr);
      const se   = (Math.log(hi) - Math.log(lo)) / (2 * 1.96);
      return {
        es: +lnHR.toFixed(4), se: +se.toFixed(4),
        lo: +(lnHR - 1.96 * se).toFixed(4),
        hi: +(lnHR + 1.96 * se).toFixed(4),
        display: `HR=${hr} [${lo}, ${hi}]`,
      };
    }

    if (type === "COR") {
      const r = +p.r, n = +p.n;
      if (isNaN(r) || isNaN(n) || Math.abs(r) >= 1 || n < 4) return null;
      const z  = 0.5 * Math.log((1 + r) / (1 - r));
      const se = 1 / Math.sqrt(n - 3);
      return {
        es: +z.toFixed(4), se: +se.toFixed(4),
        lo: +(z - 1.96 * se).toFixed(4),
        hi: +(z + 1.96 * se).toFixed(4),
        display: `r=${r}, z=${z.toFixed(3)} [${(z - 1.96*se).toFixed(3)}, ${(z + 1.96*se).toFixed(3)}]`,
      };
    }

    if (type === "PROP") {
      // single-arm proportion on the logit scale (with 0.5 continuity correction at extremes)
      let ev = +p.events, tot = +p.total;
      if (isNaN(ev) || isNaN(tot) || tot < 1 || ev < 0 || ev > tot) return null;
      let pr = ev / tot;
      if (ev === 0 || ev === tot) { ev += 0.5; tot += 1; pr = ev / tot; } // correction
      const logit = Math.log(pr / (1 - pr));
      const se    = Math.sqrt(1 / (tot * pr * (1 - pr)));
      const back  = x => { const e = Math.exp(x); return e / (1 + e); };
      return {
        es: +logit.toFixed(4), se: +se.toFixed(4),
        lo: +(logit - 1.96 * se).toFixed(4),
        hi: +(logit + 1.96 * se).toFixed(4),
        display: `proportion=${(ev/tot).toFixed(3)} (logit ${logit.toFixed(3)}) → ${(100*back(logit - 1.96*se)).toFixed(1)}%–${(100*back(logit + 1.96*se)).toFixed(1)}%`,
      };
    }

    if (type === "DIAG") {
      // diagnostic odds ratio on log scale from TP/FP/FN/TN (Haldane correction if any zero)
      let tp = +p.tp, fp = +p.fp, fn = +p.fn, tn = +p.tn;
      if ([tp, fp, fn, tn].some(isNaN) || [tp, fp, fn, tn].some(v => v < 0)) return null;
      if ([tp, fp, fn, tn].some(v => v === 0)) { tp += 0.5; fp += 0.5; fn += 0.5; tn += 0.5; }
      const lnDOR = Math.log((tp * tn) / (fp * fn));
      const se    = Math.sqrt(1/tp + 1/fp + 1/fn + 1/tn);
      const sens  = tp / (tp + fn), spec = tn / (tn + fp);
      return {
        es: +lnDOR.toFixed(4), se: +se.toFixed(4),
        lo: +(lnDOR - 1.96 * se).toFixed(4),
        hi: +(lnDOR + 1.96 * se).toFixed(4),
        display: `Sens=${(sens*100).toFixed(1)}% Spec=${(spec*100).toFixed(1)}% · DOR=${Math.exp(lnDOR).toFixed(2)} [${Math.exp(lnDOR - 1.96*se).toFixed(2)}, ${Math.exp(lnDOR + 1.96*se).toFixed(2)}]`,
      };
    }
  } catch (_) {}
  return null;
}
