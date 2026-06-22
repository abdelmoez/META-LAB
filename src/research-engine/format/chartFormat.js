/**
 * chartFormat.js
 * Chart-DISPLAY number formatting for the INTERACTIVE on-screen plots
 * (forest plot, funnel plot). Workstream 4 of prompt 50.
 *
 * ── Why this exists, separate from precision.js ────────────────────────────
 *  precision.js is the shared display/export formatter. It honours a project's
 *  precision config — including `full: true`, which emits the RAW unrounded
 *  value (`String(n)`). That is correct for a CSV/report EXPORT the user opted
 *  into, but on an interactive chart a raw value renders as unreadable noise
 *  such as `0.00000000000000000` (the prompt-50 WS4 bug).
 *
 *  The chart formatters below are a thin, defensive wrapper over precision.js
 *  that GUARANTEE a readable, bounded label no matter what precision config is
 *  passed:
 *    - `full` is ALWAYS ignored (a chart never renders raw, unbounded values).
 *    - decimals are capped at CHART_MAX_DECIMALS so a 6-dp project still gets a
 *      readable axis/label, while a 2-dp project is respected as-is.
 *    - genuinely huge magnitudes collapse to scientific notation instead of a
 *      wall of digits; values that round to zero render a clean `0.00` (never a
 *      misleading `-0.00`).
 *    - non-finite inputs render an em-dash; ±Infinity render the ∞ glyph.
 *
 *  EXPORT precision is unaffected: the publication SVG builder (svgBuilders.js),
 *  the CSV/report export (ExportDialog.jsx / ResearchExport) keep calling
 *  precision.js with the user-selected `choice.precision`. Chart ≠ export by
 *  construction — they share no formatter.
 *
 *  Pure, framework-free ES module: importable by the frontend charts, the
 *  server, and tests. Never mutates inputs; never participates in calculation.
 */

import {
  normalizePrecision,
  PCT_DEFAULT_DECIMALS,
  P_MIN_DECIMALS,
} from './precision.js';

const DASH = '—';

/** Hard ceiling on decimals shown on an interactive chart (readability). */
export const CHART_MAX_DECIMALS = 4;
/** Magnitudes at or above this collapse to scientific notation on a chart. */
export const CHART_SCI_HIGH = 1e7;

/** Strip trailing zeros (and any dangling decimal point) from a fixed string. */
function stripTrailingZeros(s) {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** Coerce to a finite number, or null. Blank (null/undefined/"") → null. */
function toFiniteNumber(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve a CHART-safe decimals count from any precision arg.
 * Honours the project's decimals but caps them (and never trusts `full`).
 */
export function chartDecimals(prec, cap = CHART_MAX_DECIMALS) {
  const c = normalizePrecision(prec);
  return Math.min(c.decimals, cap);
}

/**
 * Compact scientific notation, e.g. 1.5e7 → "1.5e+7", 2.3e-8 → "2.3e-8".
 * Trims a trailing ".0" mantissa so it reads cleanly.
 */
function toCompactExponential(n, sig = 2) {
  let s = n.toExponential(sig);
  // 1.50e+7 → 1.5e+7 ; 1.00e-8 → 1e-8
  s = s.replace(/(\.\d*?)0+e/, '$1e').replace(/\.e/, 'e');
  return s;
}

/**
 * chartNum — the core chart number formatter.
 *   - blank / NaN → dash
 *   - ±Infinity   → ∞ / −∞
 *   - |x| ≥ CHART_SCI_HIGH → scientific notation
 *   - otherwise   → fixed at min(projectDecimals, cap) places, -0 normalised to 0
 * `full` precision is intentionally ignored (charts never render raw values).
 */
export function chartNum(x, prec, { dash = DASH, cap = CHART_MAX_DECIMALS, trailingZeros } = {}) {
  if (x === null || x === undefined || x === '') return dash;
  const raw = typeof x === 'number' ? x : Number(x);
  if (Number.isNaN(raw)) return dash;
  if (raw === Infinity) return '∞';
  if (raw === -Infinity) return '−∞';

  const c = normalizePrecision(prec);
  const keepZeros = trailingZeros === undefined ? c.trailingZeros : trailingZeros;
  const decimals = Math.min(c.decimals, cap);
  const abs = Math.abs(raw);

  // Very large magnitudes → scientific (avoid a wall of digits on the axis/label).
  if (abs >= CHART_SCI_HIGH) return toCompactExponential(raw, Math.min(decimals, 2));

  let s = raw.toFixed(decimals);
  // Normalise "-0", "-0.00", … to a clean zero (no misleading negative zero).
  if (parseFloat(s) === 0) s = (0).toFixed(decimals);
  return keepZeros ? s : stripTrailingZeros(s);
}

/** chartES — effect estimate / CI bound on a chart (caps at 3 dp for readability). */
export function chartES(x, prec, dash = DASH) {
  return chartNum(x, prec, { dash, cap: Math.min(CHART_MAX_DECIMALS, 3) });
}

/** chartCI — a "lo, hi" interval pair at chart precision. */
export function chartCI(lo, hi, prec, sep = ', ', dash = DASH) {
  return `${chartES(lo, prec, dash)}${sep}${chartES(hi, prec, dash)}`;
}

/**
 * chartPct — percentages (I², weights, proportions) on a chart. Fixed, coarse
 * default (1 dp) regardless of the effect-estimate precision, matching how
 * metafor reports these. The caller keeps the "%" sign.
 */
export function chartPct(x, dflt = PCT_DEFAULT_DECIMALS, dash = DASH) {
  const n = toFiniteNumber(x);
  if (n === null) {
    if (x === Infinity) return '∞';
    if (x === -Infinity) return '−∞';
    return dash;
  }
  let s = n.toFixed(Math.max(0, Math.min(CHART_MAX_DECIMALS, Math.round(dflt))));
  if (parseFloat(s) === 0) s = (0).toFixed(Math.max(0, Math.round(dflt)));
  return s;
}

/** chartI2 / chartWeight — percentage-style chart quantities (1 dp). */
export function chartI2(x, dash = DASH) { return chartPct(x, PCT_DEFAULT_DECIMALS, dash); }
export function chartWeight(x, dash = DASH) { return chartPct(x, PCT_DEFAULT_DECIMALS, dash); }

/**
 * chartP — p-value on a chart. At least P_MIN_DECIMALS places; a value below the
 * smallest representable threshold collapses to "<0.001" (never a row of zeros).
 */
export function chartP(x, prec, dash = DASH) {
  const n = toFiniteNumber(x);
  if (n === null) return dash;
  const c = normalizePrecision(prec);
  const d = Math.max(Math.min(c.decimals, CHART_MAX_DECIMALS), P_MIN_DECIMALS);
  const floor = Math.pow(10, -d);
  if (n >= 0 && n < floor) return `<${floor.toFixed(d)}`;
  return n.toFixed(d);
}

/**
 * chartAxisTick — a back-transformed axis tick label for the forest plot.
 *   - isProp : value is a proportion in [0,1] → percentage with 0–1 dp
 *   - isLog  : value is a back-transformed ratio (OR/RR/HR) → ratio with ≤2 dp
 *   - else   : a linear-scale grid value → ≤2 dp
 * Always bounded and readable; never emits a long decimal run.
 */
export function chartAxisTick(value, { isLog = false, isProp = false } = {}) {
  const n = toFiniteNumber(value);
  if (n === null) return '';
  if (isProp) {
    const pct = n * 100;
    // whole percent when it lands cleanly, else 1 dp
    return (Math.abs(pct - Math.round(pct)) < 1e-9 ? String(Math.round(pct)) : pct.toFixed(1)) + '%';
  }
  if (isLog) {
    // Ratio scale: keep the canonical tick readable. Tiny→clamp, huge→scientific.
    if (n !== 0 && Math.abs(n) < 0.001) return chartNum(n, { decimals: 3 }, { cap: 3 });
    if (Math.abs(n) >= 1000) return chartNum(n, { decimals: 0 }, { cap: 0 });
    // 0.5, 1, 2, 5, 10 … render without trailing zeros; 1.5 keeps its dp.
    return chartNum(n, { decimals: 2 }, { cap: 2, trailingZeros: false });
  }
  // Linear grid value (already a clean 0.5 step in practice).
  return chartNum(n, { decimals: 2 }, { cap: 2, trailingZeros: false });
}

export default {
  CHART_MAX_DECIMALS,
  CHART_SCI_HIGH,
  chartDecimals,
  chartNum,
  chartES,
  chartCI,
  chartPct,
  chartI2,
  chartWeight,
  chartP,
  chartAxisTick,
};
