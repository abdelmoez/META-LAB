/**
 * precision.js
 * Centralised numeric-precision / display-formatting system for META·LAB.
 *
 * ── Design contract ────────────────────────────────────────────────────────
 *  - Pure, framework-free ES module. Importable by the monolith UI
 *    (meta-lab-3-patched.jsx), the src/frontend components, the server, and
 *    tests — a SINGLE source of truth, replacing scattered `toFixed(2)` calls.
 *  - These functions ONLY format numbers for *display / export*. They never
 *    mutate their inputs and never participate in the statistical calculation.
 *    Underlying values are computed and stored at full precision; rounding
 *    happens here, at the very edge.
 *  - Default precision is 3 decimal places (matches what reviewers validate
 *    against metafor). Researchers can widen it to 2–6 decimals per project,
 *    and any export can request raw `full` precision.
 *
 * ── Precision config object ────────────────────────────────────────────────
 *    { decimals: 2|3|4|5|6, trailingZeros: boolean, full: boolean }
 *      decimals       how many places effect estimates / CIs use      (default 3)
 *      trailingZeros  keep "0.500" vs strip to "0.5"                   (default true —
 *                     validation tables & journal style prefer fixed)
 *      full           emit the raw value unrounded (export only)       (default false)
 *
 *  Helpers accept either a config object, a bare number (interpreted as
 *  `decimals`), or `undefined` (→ defaults), so call sites stay terse.
 */

export const DEFAULT_DECIMALS = 3;
export const DECIMAL_OPTIONS = [2, 3, 4, 5, 6];
export const MIN_DECIMALS = 0;
export const MAX_DECIMALS = 6;

/** P-values never display fewer than this many places (so a 2-dp project still shows p=0.001). */
export const P_MIN_DECIMALS = 3;
/** Percentages / I² / weights default to this many places unless the project widens past it. */
export const PCT_DEFAULT_DECIMALS = 1;

const DASH = '—';

/** Clamp/round an arbitrary value to a valid decimal-places integer in [0, 6]. */
export function clampDecimals(d, fallback = DEFAULT_DECIMALS) {
  const n = Math.round(Number(d));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_DECIMALS, Math.max(MIN_DECIMALS, n));
}

/**
 * Normalise any precision argument into a canonical config object.
 * Accepts: undefined | number (=decimals) | { decimals, trailingZeros, full }.
 */
export function normalizePrecision(p) {
  if (p === null || p === undefined) {
    return { decimals: DEFAULT_DECIMALS, trailingZeros: true, full: false };
  }
  if (typeof p === 'number') {
    return { decimals: clampDecimals(p), trailingZeros: true, full: false };
  }
  return {
    decimals: clampDecimals(p.decimals),
    // default ON — fixed decimals read cleaner in validation/journal tables
    trailingZeros: p.trailingZeros !== false,
    full: !!p.full,
  };
}

/** True for values that should render as an em-dash (missing / non-finite). */
function isBlank(x) {
  return x === null || x === undefined || x === '';
}

function toFiniteNumber(x) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Strip trailing zeros (and any dangling decimal point) from a fixed string. */
function stripTrailingZeros(s) {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * fmtNum — format a single number for display.
 * @param {*} x          number | numeric string | null
 * @param {*} prec       precision config | decimals | undefined
 * @param {string} dash  fallback for blank/invalid input (default "—")
 * @returns {string}
 */
export function fmtNum(x, prec, dash = DASH) {
  if (isBlank(x)) return dash;
  const n = toFiniteNumber(x);
  if (n === null) return dash;
  const c = normalizePrecision(prec);
  if (c.full) return String(n);                    // raw, unrounded (export)
  const s = n.toFixed(c.decimals);
  // Avoid the "-0.000" artefact.
  const cleaned = Object.is(parseFloat(s), -0) || s === '-' + (0).toFixed(c.decimals) ? s.replace(/^-/, '') : s;
  return c.trailingZeros ? cleaned : stripTrailingZeros(cleaned);
}

/** fmtES — pooled / single effect estimate at the project precision. */
export function fmtES(x, prec, dash = DASH) {
  return fmtNum(x, prec, dash);
}

/**
 * fmtCI — a confidence (or prediction) interval pair "lo, hi".
 * @returns {string}  e.g. "0.342, 1.110"
 */
export function fmtCI(lo, hi, prec, sep = ', ', dash = DASH) {
  return `${fmtNum(lo, prec, dash)}${sep}${fmtNum(hi, prec, dash)}`;
}

/**
 * fmtEstCI — estimate with its interval "est (lo, hi)".
 * @returns {string}  e.g. "0.616 (0.342, 1.110)"
 */
export function fmtEstCI(est, lo, hi, prec, dash = DASH) {
  return `${fmtNum(est, prec, dash)} (${fmtCI(lo, hi, prec, ', ', dash)})`;
}

/**
 * fmtP — p-value with the conventional small-p threshold.
 *   - At least P_MIN_DECIMALS (3) places, more if the project widens precision.
 *   - p below 10^-d renders as "<0.001" (or "<0.0001" at 4 dp, …).
 *   - `full` precision emits the raw value (no threshold collapsing).
 * @returns {string}
 */
export function fmtP(x, prec, dash = DASH) {
  if (isBlank(x)) return dash;
  const n = toFiniteNumber(x);
  if (n === null) return dash;
  const c = normalizePrecision(prec);
  if (c.full) return String(n);
  const d = Math.max(c.decimals, P_MIN_DECIMALS);
  const floor = Math.pow(10, -d);
  if (n >= 0 && n < floor) return `<${floor.toFixed(d)}`;
  const s = n.toFixed(d);
  return c.trailingZeros ? s : stripTrailingZeros(s);
}

/**
 * fmtPct — percentages (I², weights, proportions). These are inherently coarse,
 * so they use a fixed, predictable default of `dflt` places (1) rather than
 * tracking the project's effect-estimate precision — an I² that jumped to
 * "61.340%" because the user widened effect precision to 3 dp reads oddly, and
 * metafor itself reports I² to ~1 dp. `full` precision still emits the raw value
 * (so a full-precision export captures everything). Callers that genuinely want
 * more can pass an explicit `dflt`. The "%" sign is NOT appended — callers keep
 * their own, matching the strings they already render.
 * @returns {string}
 */
export function fmtPct(x, prec, dflt = PCT_DEFAULT_DECIMALS, dash = DASH) {
  if (isBlank(x)) return dash;
  const n = toFiniteNumber(x);
  if (n === null) return dash;
  const c = normalizePrecision(prec);
  if (c.full) return String(n);
  const s = n.toFixed(clampDecimals(dflt));
  return c.trailingZeros ? s : stripTrailingZeros(s);
}

/** fmtI2 — alias for a percentage-style quantity (I² heterogeneity). */
export function fmtI2(x, prec, dash = DASH) {
  return fmtPct(x, prec, PCT_DEFAULT_DECIMALS, dash);
}

/** fmtWeight — study weight percentage (forest plot). Defaults to 1 dp. */
export function fmtWeight(x, prec, dash = DASH) {
  return fmtPct(x, prec, PCT_DEFAULT_DECIMALS, dash);
}

/** fmtInt — integer counts (k, n, events). Never decimals; locale grouping for big numbers. */
export function fmtInt(x, dash = DASH) {
  if (isBlank(x)) return dash;
  const n = toFiniteNumber(x);
  if (n === null) return dash;
  return String(Math.round(n));
}

export default {
  DEFAULT_DECIMALS,
  DECIMAL_OPTIONS,
  MIN_DECIMALS,
  MAX_DECIMALS,
  P_MIN_DECIMALS,
  PCT_DEFAULT_DECIMALS,
  clampDecimals,
  normalizePrecision,
  fmtNum,
  fmtES,
  fmtCI,
  fmtEstCI,
  fmtP,
  fmtPct,
  fmtI2,
  fmtWeight,
  fmtInt,
};
