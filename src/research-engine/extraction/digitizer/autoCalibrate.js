/**
 * extraction/digitizer/autoCalibrate.js — RoadMap/4.md §22.1–22.5. Deterministic
 * least-squares auto-calibration of ONE figure axis from harvested numeric tick
 * labels. Pure, dependency-free: no DOM, no pdf.js, no I/O, no Date.now(), no
 * Math.random() — the same ticks in always produce a byte-identical AxisFit out.
 *
 * Given ticks [{ px, value, raw? }] the fitter compares a LINEAR model
 * (value = a·px + b) against a LOG model (ln(value) = a·px + b, only when every
 * value is > 0) by R² (§22.4). The log model is only preferred over a near-tied
 * linear fit when opts.ratioMeasure is true (HR/OR/RR forest plots get a MODEST
 * log prior — never an unconditional choice, §22.4).
 *
 * The returned AxisFit is fully SERIALIZABLE (§22.1): pxToValue/valueToPx are
 * exported as standalone pure helpers that reconstruct the mapping from the
 * stored { scale, a, b } — no closures live on the fit object.
 *
 * AUTOMATIC-ACCEPTANCE GATES (§22.5): auto is true only when R² ≥ 0.999, tick
 * values AND pixels are monotonic in harvested order, spacing is near-even in
 * the fitted domain, ≥3 valid ticks survived cleaning, and no tick had to be
 * dropped (non-finite or duplicate px). Any failed gate appends a warning and
 * sets auto:false — the best fit is STILL returned so the UI can enter
 * confirm-mode with a highlighted best guess instead of a blank setup.
 *
 * Never throws: malformed input returns null (or a fit with warnings).
 */

/** R² floor for automatic acceptance (§22.5). */
const R2_GATE = 0.999;

/** Near-tie margin for the linear-vs-log choice (§22.4). */
const LOG_TIE_MARGIN = 0.002;

/** Max relative deviation of a px gap from the mean gap ("near-even" spacing). */
const SPACING_TOLERANCE = 0.3;

/** Coerce to a finite number or null. */
function finiteOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * leastSquares(xs, ys) — deterministic ordinary least squares y ~ x.
 * Returns { slope, intercept, r2 } or null when degenerate (no x or y variance).
 */
function leastSquares(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let styy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    styy += dy * dy;
  }
  if (sxx === 0 || styy === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const r = ys[i] - (slope * xs[i] + intercept);
    ssRes += r * r;
  }
  const r2 = 1 - ssRes / styy;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept) || !Number.isFinite(r2)) return null;
  return { slope, intercept, r2 };
}

/** strictlyMonotonic(arr) — true when the sequence strictly increases OR strictly decreases. */
function strictlyMonotonic(arr) {
  if (arr.length < 2) return true;
  let inc = true;
  let dec = true;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i - 1]) inc = false;
    if (arr[i] >= arr[i - 1]) dec = false;
  }
  return inc || dec;
}

/** nearEvenSpacing(pxs) — true when sorted px gaps all sit within tolerance of the mean gap. */
function nearEvenSpacing(pxs) {
  const sorted = pxs.slice().sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  if (gaps.length < 2) return true;
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean <= 0) return false;
  return gaps.every((g) => Math.abs(g - mean) <= SPACING_TOLERANCE * mean);
}

/**
 * autoCalibrateAxis(ticks, opts?) — fit a value↔pixel relationship from harvested
 * numeric axis ticks (§22.1, §22.4, §22.5).
 *
 * @param {Array<{px:number, value:number, raw?:string}>} ticks  harvested tick
 *   labels: px is the pixel position along the axis, value the numeric label
 * @param {{ratioMeasure?:boolean}} [opts]  ratioMeasure applies the modest log
 *   prior for HR/OR/RR plots (§22.4)
 * @returns {{
 *   scale:'linear'|'log',
 *   a:number, b:number,           // linear: value = a·px + b; log: ln(value) = a·px + b
 *   r2:number,
 *   ticks:Array<{px:number, value:number, raw?:string}>,
 *   domain:[number, number],
 *   warnings:string[],
 *   auto:boolean
 * } | null}
 *   null when fewer than 3 valid ticks survive cleaning or the fit is degenerate;
 *   auto:false + warnings (confirm-mode) when any §22.5 gate fails.
 */
export function autoCalibrateAxis(ticks, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const list = Array.isArray(ticks) ? ticks : [];
  const warnings = [];

  /* ── Clean the harvest: drop non-finite ticks and duplicate px positions ── */
  const clean = [];
  const seenPx = new Set();
  let dropped = 0;
  let duplicates = 0;
  for (const t of list) {
    const px = finiteOrNull(t && t.px);
    const value = finiteOrNull(t && t.value);
    if (px === null || value === null) {
      dropped++;
      continue;
    }
    if (seenPx.has(px)) {
      duplicates++;
      continue;
    }
    seenPx.add(px);
    const kept = { px, value };
    if (t && t.raw != null) kept.raw = String(t.raw);
    clean.push(kept);
  }
  if (dropped) warnings.push(`${dropped} non-numeric tick(s) were ignored`);
  if (duplicates) warnings.push(`${duplicates} duplicate-pixel tick(s) were ignored`);
  if (clean.length < 3) return null;

  const pxs = clean.map((t) => t.px);
  const vals = clean.map((t) => t.value);

  /* ── Fit both models (§22.4) ────────────────────────────────────────────── */
  const lin = leastSquares(pxs, vals);
  const allPositive = vals.every((v) => v > 0);
  const log = allPositive ? leastSquares(pxs, vals.map((v) => Math.log(v))) : null;
  if (!lin && !log) return null;

  let useLog;
  if (!log) useLog = false;
  else if (!lin) useLog = true;
  else if (o.ratioMeasure) useLog = log.r2 >= lin.r2 - LOG_TIE_MARGIN;
  else useLog = log.r2 > lin.r2 + LOG_TIE_MARGIN;

  const fit = useLog ? log : lin;
  const scale = useLog ? 'log' : 'linear';

  /* ── Acceptance gates (§22.5) — any failure → confirm-mode, never silent ── */
  if (fit.r2 < R2_GATE) warnings.push(`R² ${fit.r2.toFixed(6)} is below the 0.999 acceptance gate`);
  if (!strictlyMonotonic(pxs)) warnings.push('tick pixels are not monotonic');
  if (!strictlyMonotonic(vals)) warnings.push('tick values are not monotonic');
  if (!nearEvenSpacing(pxs)) warnings.push('tick spacing is uneven in the fitted domain');

  const auto = warnings.length === 0;
  const domain = [Math.min.apply(null, vals), Math.max.apply(null, vals)];

  return { scale, a: fit.slope, b: fit.intercept, r2: fit.r2, ticks: clean, domain, warnings, auto };
}

/**
 * pxToValue(fit, px) — reconstruct the pixel→value mapping from a serialized
 * AxisFit (§22.1: "functions can be reconstructed from fit parameters").
 *
 * @param {{scale:string, a:number, b:number}} fit  an autoCalibrateAxis() result
 * @param {number} px  pixel position along the axis
 * @returns {number} the data value, or NaN on malformed input
 */
export function pxToValue(fit, px) {
  const f = fit && typeof fit === 'object' ? fit : null;
  const x = finiteOrNull(px);
  if (!f || x === null || !Number.isFinite(f.a) || !Number.isFinite(f.b)) return NaN;
  const u = f.a * x + f.b;
  return f.scale === 'log' ? Math.exp(u) : u;
}

/**
 * valueToPx(fit, value) — reconstruct the value→pixel mapping from a serialized
 * AxisFit. Inverse of pxToValue.
 *
 * @param {{scale:string, a:number, b:number}} fit  an autoCalibrateAxis() result
 * @param {number} value  data value on the axis
 * @returns {number} the pixel position, or NaN on malformed input (incl. value ≤ 0 on a log axis)
 */
export function valueToPx(fit, value) {
  const f = fit && typeof fit === 'object' ? fit : null;
  const v = finiteOrNull(value);
  if (!f || v === null || !Number.isFinite(f.a) || !Number.isFinite(f.b) || f.a === 0) return NaN;
  if (f.scale === 'log') {
    if (v <= 0) return NaN;
    return (Math.log(v) - f.b) / f.a;
  }
  return (v - f.b) / f.a;
}
