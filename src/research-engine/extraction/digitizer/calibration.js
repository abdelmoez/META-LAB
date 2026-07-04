/**
 * extraction/digitizer/calibration.js — figure-digitizer axis calibration.
 * Pure, dependency-free: no I/O, no React, no DOM — safe to import from the
 * server, the client, and unit tests.
 *
 * COORDINATE SYSTEM
 *   All pixel coordinates are region-local CANVAS pixels: x grows RIGHT and
 *   y grows DOWN (the browser canvas convention). Data coordinates are
 *   whatever the figure's axes say (data y grows UP on a normal plot).
 *
 * TWO-POINT CALIBRATION
 *   Each axis is calibrated from two reference clicks: p1 = { px, value } and
 *   p2 = { px, value }. The mapping is a straight line through those two
 *   points — in pixel↔value space for a linear axis, in pixel↔log10(value)
 *   space for a log axis.
 *
 * Y-AXIS INVERSION (why no special-casing is needed)
 *   On a normal plot the y calibration points naturally arrive inverted:
 *   the LARGER data value sits at the SMALLER canvas py (nearer the top).
 *   Because the mapping is defined by the two points themselves, the negative
 *   slope falls out of the interpolation — py growing DOWN while data y grows
 *   up is handled with zero extra code. The same is true of a reversed x axis.
 *
 * PRECISION
 *   toPx(toData(px)) round-trips within 1e-9 for linear axes and 1e-6 for log
 *   axes (log10/pow introduces a little float noise).
 *
 * DEFENSIVE INPUTS
 *   mkAxis/mkCalibration never throw: malformed specs return
 *   { ok: false, error }. Axis toData/toPx return NaN for non-finite (or, in
 *   log mode, non-positive) inputs.
 */

/** Coerce to a finite number or null. */
function finiteOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * mkAxis({ p1, p2, log }) — build a single-axis pixel↔data mapping from two
 * calibration points.
 *
 * @param {object} spec
 * @param {{px:number, value:number}} spec.p1  first calibration point
 * @param {{px:number, value:number}} spec.p2  second calibration point
 * @param {boolean} [spec.log=false]  log10 axis (both values must be > 0)
 * @returns {{ok:true, axis:{log:boolean, toData:(px:number)=>number, toPx:(value:number)=>number}} | {ok:false, error:string}}
 */
export function mkAxis(spec = {}) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const log = !!s.log;
  const p1 = s.p1 && typeof s.p1 === 'object' ? s.p1 : {};
  const p2 = s.p2 && typeof s.p2 === 'object' ? s.p2 : {};
  const px1 = finiteOrNull(p1.px);
  const v1 = finiteOrNull(p1.value);
  const px2 = finiteOrNull(p2.px);
  const v2 = finiteOrNull(p2.value);

  if (px1 === null || v1 === null) return { ok: false, error: 'p1 must have numeric px and value' };
  if (px2 === null || v2 === null) return { ok: false, error: 'p2 must have numeric px and value' };
  if (px1 === px2) return { ok: false, error: 'calibration points must have different px' };
  if (v1 === v2) return { ok: false, error: 'calibration points must have different values' };
  if (log && (v1 <= 0 || v2 <= 0)) {
    return { ok: false, error: 'log axis requires both calibration values > 0' };
  }

  // Interpolate in "u-space": u = value (linear) or u = log10(value) (log).
  const u1 = log ? Math.log10(v1) : v1;
  const u2 = log ? Math.log10(v2) : v2;
  const uPerPx = (u2 - u1) / (px2 - px1); // slope; sign carries any axis inversion

  const toData = (px) => {
    const x = finiteOrNull(px);
    if (x === null) return NaN;
    const u = u1 + (x - px1) * uPerPx;
    return log ? Math.pow(10, u) : u;
  };

  const toPx = (value) => {
    const v = finiteOrNull(value);
    if (v === null) return NaN;
    if (log && v <= 0) return NaN;
    const u = log ? Math.log10(v) : v;
    return px1 + (u - u1) / uPerPx;
  };

  return { ok: true, axis: { log, toData, toPx } };
}

/**
 * mkCalibration({ x, y }) — build a full 2-D pixel↔data calibration from one
 * mkAxis spec per axis.
 *
 * The y axis is calibrated exactly like the x axis; because canvas py grows
 * DOWN while data y grows up, a normal plot simply supplies its y calibration
 * points with a negative pixel slope (larger value ↔ smaller py) and the
 * two-point mapping inverts naturally — see the file header.
 *
 * @param {object} spec
 * @param {object} spec.x  mkAxis spec for the x axis
 * @param {object} spec.y  mkAxis spec for the y axis
 * @returns {{ok:true, cal:{x:object, y:object, toData:(p:{px:number,py:number})=>{x:number,y:number}, toPx:(d:{x:number,y:number})=>{px:number,py:number}}} | {ok:false, error:string}}
 */
export function mkCalibration(spec = {}) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const rx = mkAxis(s.x);
  if (!rx.ok) return { ok: false, error: `x axis: ${rx.error}` };
  const ry = mkAxis(s.y);
  if (!ry.ok) return { ok: false, error: `y axis: ${ry.error}` };

  const xAxis = rx.axis;
  const yAxis = ry.axis;

  const cal = {
    x: xAxis,
    y: yAxis,
    /** Canvas point → data point. */
    toData(p) {
      const o = p && typeof p === 'object' ? p : {};
      return { x: xAxis.toData(o.px), y: yAxis.toData(o.py) };
    },
    /** Data point → canvas point. */
    toPx(d) {
      const o = d && typeof d === 'object' ? d : {};
      return { px: xAxis.toPx(o.x), py: yAxis.toPx(o.y) };
    },
  };

  return { ok: true, cal };
}
