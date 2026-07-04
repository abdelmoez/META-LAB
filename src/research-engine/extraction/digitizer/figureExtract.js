/**
 * extraction/digitizer/figureExtract.js — click-based figure extraction.
 * Pure, dependency-free: no I/O, no React, no DOM — safe to import from the
 * server, the client, and unit tests.
 *
 * Every function takes a calibration `cal` from mkCalibration
 * (./calibration.js) plus region-local CANVAS pixel clicks (x right, y DOWN)
 * and returns values in DATA units. The calibration handles the y-axis
 * inversion, so nothing here special-cases the canvas y direction.
 *
 * FUNCTIONS
 *   - forestFromClicks   one forest-plot row (point + CI whisker ends)
 *   - barsFromClicks     bar chart arms (bar top + optional error-bar cap)
 *   - boxFromClicks      box plot → mean/SD via Wan et al. (2014)
 *   - scatterFromClicks  raw point cloud
 *   - kmPointsFromTrace  Kaplan–Meier curve trace cleaning
 *
 * DEFENSIVE INPUTS
 *   Never throws on malformed input: list-shaped functions return [] (or an
 *   empty result object), single-result functions return null, and
 *   boxFromClicks returns { ok:false, error } (it has a hard statistical
 *   precondition to report). Full precision internally — no rounding.
 */

import { invNorm } from '../../statistics/math-helpers.js';

/** True when `cal` looks like an mkCalibration cal (both axes + mappers). */
function isCal(cal) {
  return !!(
    cal &&
    typeof cal === 'object' &&
    cal.x && typeof cal.x.toData === 'function' && typeof cal.x.toPx === 'function' &&
    cal.y && typeof cal.y.toData === 'function' && typeof cal.y.toPx === 'function'
  );
}

/** Coerce to a finite number or null. */
function finiteOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a click coordinate along ONE axis. Accepts a bare pixel number or a
 * { px, py } point object (the relevant component is picked by `axisKey`).
 */
function clickCoord(click, axisKey) {
  if (click && typeof click === 'object') {
    return finiteOrNull(axisKey === 'y' ? click.py : click.px);
  }
  return finiteOrNull(click);
}

/**
 * forestFromClicks({ pointPx, loPx, hiPx, cal, orientation }) — one forest-plot
 * row: the point estimate click plus the two CI whisker-end clicks.
 *
 * Orientation 'h' (default): values run along the x axis (the usual forest
 * layout), so each click is an x-pixel. Orientation 'v': values run along the
 * y axis, so each click is a y-pixel. Clicks may be bare numbers or
 * { px, py } objects.
 *
 * The three mapped values are sorted so lo ≤ est ≤ hi — whisker clicks can
 * arrive in either order (and on a log axis "left" vs "right" is easy to mix
 * up), so the middle value is taken as the estimate.
 *
 * @returns {{est:number, lo:number, hi:number} | null}
 */
export function forestFromClicks({ pointPx, loPx, hiPx, cal, orientation = 'h' } = {}) {
  if (!isCal(cal)) return null;
  const axisKey = orientation === 'v' ? 'y' : 'x';
  const axis = orientation === 'v' ? cal.y : cal.x;
  const coords = [pointPx, loPx, hiPx].map((c) => clickCoord(c, axisKey));
  if (coords.some((c) => c === null)) return null;
  const values = coords.map((c) => axis.toData(c));
  if (values.some((v) => !Number.isFinite(v))) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return { est: sorted[1], lo: sorted[0], hi: sorted[2] };
}

/**
 * barsFromClicks({ arms, zeroPx, cal, errorType }) — bar chart extraction.
 *
 * Each arm is { label, topPx, capPx, n }: topPx = the bar-top click (y-pixel),
 * capPx = the error-bar cap click (optional), n = arm sample size (optional).
 *
 *   - mean   = y-value of the bar top.
 *   - spread = |y(capPx) − mean| when capPx was clicked, else null.
 *   - sd     = spread            when errorType is 'SD';
 *              spread·√n         when errorType is 'SE' and n is present
 *              (else null + a warning);
 *              null + a warning  when errorType is missing/unknown but a
 *              spread was measured (we refuse to guess SD vs SE).
 *
 * zeroPx (optional) is the bar BASELINE click. When it maps to a data value
 * meaningfully away from 0 the axis is truncated, so a warning is added —
 * bar heights on a truncated axis do not represent the means.
 *
 * @returns {{arms:Array<{label:string, mean:number|null, spread:number|null, sd:number|null, n:number|null}>, warnings:string[]}}
 */
export function barsFromClicks({ arms, zeroPx, cal, errorType } = {}) {
  const warnings = [];
  if (!isCal(cal) || !Array.isArray(arms)) return { arms: [], warnings };

  const type = errorType === 'SD' || errorType === 'SE' ? errorType : null;

  const zPx = clickCoord(zeroPx, 'y');
  if (zPx !== null) {
    // Compare in PIXEL space against where data-0 maps, with a few-pixel tolerance.
    // An absolute DATA-space threshold (1e-6) false-alarmed on any axis whose
    // units-per-pixel exceed it — i.e. essentially every real bar chart.
    const zeroDataPx = cal.y.toPx(0);
    const TOL_PX = 5;
    if (Number.isFinite(zeroDataPx) && Math.abs(zPx - zeroDataPx) > TOL_PX) {
      const baseline = cal.y.toData(zPx);
      warnings.push(
        `bar baseline maps to ${baseline} (not 0) — the value axis appears truncated; bar heights do not represent the means`
      );
    }
  }

  const out = [];
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i] && typeof arms[i] === 'object' ? arms[i] : {};
    const label = typeof a.label === 'string' ? a.label : `arm ${i + 1}`;
    const n = finiteOrNull(a.n);
    const topPx = clickCoord(a.topPx, 'y');
    if (topPx === null) {
      warnings.push(`${label}: missing/invalid topPx — arm skipped`);
      continue;
    }
    const mean = cal.y.toData(topPx);
    if (!Number.isFinite(mean)) {
      warnings.push(`${label}: bar top maps outside the calibrated axis — arm skipped`);
      continue;
    }

    let spread = null;
    const capPx = clickCoord(a.capPx, 'y');
    if (capPx !== null) {
      const capVal = cal.y.toData(capPx);
      if (Number.isFinite(capVal)) spread = Math.abs(capVal - mean);
      else warnings.push(`${label}: error-bar cap maps outside the calibrated axis — spread ignored`);
    }

    let sd = null;
    if (spread !== null) {
      if (type === 'SD') {
        sd = spread;
      } else if (type === 'SE') {
        if (n !== null && n > 0) sd = spread * Math.sqrt(n);
        else warnings.push(`${label}: errorType SE needs n to convert to SD — sd left null`);
      } else {
        warnings.push(`${label}: errorType not specified (SD or SE) — sd left null`);
      }
    }

    out.push({ label, mean, spread, sd, n });
  }

  return { arms: out, warnings };
}

/**
 * boxFromClicks({ q1Px, medianPx, q3Px, n, cal }) — box plot → mean/SD via
 * Wan et al. (2014):
 *
 *   mean = (q1 + median + q3) / 3
 *   sd   = (q3 − q1) / (2 · Φ⁻¹((0.75n − 0.125) / (n + 0.25)))
 *
 * The three clicks are y-pixels on the value axis (bare numbers or { px, py }
 * objects). After mapping to data units the quartiles must satisfy
 * q1 ≤ median ≤ q3 — on a canvas y-down axis that means q1 is clicked BELOW
 * the median which is below q3; a violation means the clicks are mislabelled,
 * so an error is returned instead of silently reordering. Requires n ≥ 2.
 *
 * @returns {{ok:true, q1:number, median:number, q3:number, mean:number, sd:number} | {ok:false, error:string}}
 */
export function boxFromClicks({ q1Px, medianPx, q3Px, n, cal } = {}) {
  if (!isCal(cal)) return { ok: false, error: 'invalid calibration' };
  const nn = finiteOrNull(n);
  if (nn === null || nn < 2) return { ok: false, error: 'n must be a number ≥ 2' };

  const coords = [q1Px, medianPx, q3Px].map((c) => clickCoord(c, 'y'));
  if (coords.some((c) => c === null)) {
    return { ok: false, error: 'q1Px, medianPx and q3Px must all be numeric pixel coordinates' };
  }
  const [q1, median, q3] = coords.map((c) => cal.y.toData(c));
  if (![q1, median, q3].every(Number.isFinite)) {
    return { ok: false, error: 'a quartile click maps outside the calibrated axis' };
  }
  if (!(q1 <= median && median <= q3)) {
    return { ok: false, error: 'mapped quartiles must satisfy q1 ≤ median ≤ q3 — check which click is which' };
  }

  const mean = (q1 + median + q3) / 3;
  const denom = 2 * invNorm((0.75 * nn - 0.125) / (nn + 0.25));
  const sd = (q3 - q1) / denom;
  if (!Number.isFinite(sd)) return { ok: false, error: 'sd could not be computed for this n' };

  return { ok: true, q1, median, q3, mean, sd };
}

/**
 * scatterFromClicks({ points, cal }) — map a clicked point cloud to data units.
 * Malformed entries (non-finite px/py, or points that map outside the
 * calibrated axes) are skipped, not errored.
 *
 * @param {{points:Array<{px:number, py:number}>, cal:object}} args
 * @returns {Array<{x:number, y:number}>}
 */
export function scatterFromClicks({ points, cal } = {}) {
  if (!isCal(cal) || !Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    const o = p && typeof p === 'object' ? p : {};
    const px = finiteOrNull(o.px);
    const py = finiteOrNull(o.py);
    if (px === null || py === null) continue;
    const d = cal.toData({ px, py });
    if (Number.isFinite(d.x) && Number.isFinite(d.y)) out.push(d);
  }
  return out;
}

/**
 * kmPointsFromTrace({ points, cal, clampMonotone }) — clean a traced
 * Kaplan–Meier curve into { t, s } survival points:
 *
 *   1. map each { px, py } click to data units (t = x axis, s = y axis);
 *   2. drop malformed/non-finite points;
 *   3. sort by t ascending (stable for ties);
 *   4. clamp s into [0, 1] (tracing noise routinely lands just above 1);
 *   5. when clampMonotone (default true), force s non-increasing in t —
 *      survival can never rise, so each point is capped at the running
 *      minimum. Pass clampMonotone:false to keep the raw wiggles (steps 1–4
 *      still apply).
 *
 * NOTE: this produces the cleaned digitized curve only. Reconstruction of
 * individual patient data from it (Guyot et al.) lives in kmGuyot.js — not here.
 *
 * @param {{points:Array<{px:number, py:number}>, cal:object, clampMonotone?:boolean}} args
 * @returns {Array<{t:number, s:number}>}
 */
export function kmPointsFromTrace({ points, cal, clampMonotone = true } = {}) {
  if (!isCal(cal) || !Array.isArray(points)) return [];

  const mapped = [];
  for (const p of points) {
    const o = p && typeof p === 'object' ? p : {};
    const px = finiteOrNull(o.px);
    const py = finiteOrNull(o.py);
    if (px === null || py === null) continue;
    const t = cal.x.toData(px);
    const s = cal.y.toData(py);
    if (!Number.isFinite(t) || !Number.isFinite(s)) continue;
    mapped.push({ t, s });
  }

  mapped.sort((a, b) => a.t - b.t);

  let runningMin = Infinity;
  const out = [];
  for (const p of mapped) {
    let s = Math.min(1, Math.max(0, p.s));
    if (clampMonotone) {
      s = Math.min(s, runningMin);
      runningMin = s;
    }
    out.push({ t: p.t, s });
  }
  return out;
}
