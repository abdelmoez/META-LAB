/**
 * charts/forestLayout.js — 116.md §22-§25 (decision D15).
 *
 * THE single source of forest-plot geometry. Before this module there were four
 * independent forest renderers (the live React SVG in
 * frontend/workspace/charts/charts.jsx, the publication string builder
 * buildPubForestSVG, the public-page InteractiveForest and the NMA mini-forest),
 * each with its own domain, tick algorithm, null-line handling and favours
 * placement. That is why the on-screen plot pinned its null line to an edge, drew
 * a gridline every 0.5 stored units (0.61 / 1.65 / 2.72 back-transformed "ticks")
 * and let the favours labels overflow into the neighbouring columns.
 *
 * 116.md migrated the first two; 117.md §J.11 / §K.7 migrated the remaining two
 * (closing 116.md §10.4), so ALL FOUR are now skins over this module. The last two
 * are the reason `hasNull` is not a boolean convenience: both of them drew a
 * dashed "null" line at stored 0 unconditionally, which is logit 0 (= 50%) for a
 * single-arm PROPORTION — a measure with no no-effect value at all — and 0.0 for
 * AUC, whose no-effect value is 0.5 and which cannot even reach 0.
 * Neither renderer takes an `opts.metrics` pack from persisted project config:
 * the public page is a frozen snapshot and the NMA mini forest is a fixed
 * compact figure, so each passes a small literal pack and nothing else.
 *
 * ── Contract ───────────────────────────────────────────────────────────────
 *   computeForestLayout(result, opts) -> layout | null
 *     result   a runMeta() result — RENDERED, never recomputed (116.md §124).
 *              Needs: studies[{_es,_lo,_hi,_wFixedPct,_wRandomPct,_pct,…}],
 *              fixed{es,lo,hi}, random{es,lo,hi}, optional predInt{lo,hi}, method.
 *     opts     { variant:'live'|'pub', esType, showCounts, showWeights, showPI,
 *                title, subtitle, esLabel, favLow, favHigh, nullLine, logScale,
 *                metrics:{plotW,nameW,ROW,diamondH,fontScale},  // 117.md §24, BOUNDED
 *                formatValue:(storedValue)=>string, footerTexts:string[] }
 *
 *   117.md §24/§25 — `metrics` is the ONLY presentation input that touches
 *   geometry and it is clamped through forestFigureConfig's bounds table before
 *   anything reads it. NOTHING in opts can change a value: `es`/`lo`/`hi` and the
 *   weights are read verbatim off `result` (116.md §124), so presentation and
 *   analysis cannot be confused for one another.
 *
 *   The layout is PURE data: numbers, strings and small records. It contains no
 *   colours, no fonts, no markup — the two renderers are thin skins that decide
 *   only how a coordinate is painted. Both therefore agree on tick values, the
 *   null position, truncation, out-of-scale flags and favours anchoring, which is
 *   what 116.md §32 (export parity) actually asks for. Pixel widths still differ
 *   per variant because the live plot is 11px IBM Plex Mono and the publication
 *   figure is 10.5px Georgia; parity is asserted on the scale-invariant
 *   properties (tick values/labels, null fraction, clamp flags), not on pixels.
 *
 * ── Invariants (pinned by tests/unit/charts/forestLayout.test.js) ───────────
 *   1. The domain ALWAYS contains the measure's no-effect value, with a margin,
 *      whenever that measure has one. Never clamp the null line to an edge.
 *   2. Geometry is laid out on the STORED analysis scale (ln for ratio measures,
 *      logit for proportions, raw otherwise) and labels are back-transformed.
 *      Positions, ticks, CI ends and labels all pass through the same transform —
 *      116.md §24's "do not merely log-transform the labels".
 *   3. Values outside the visible domain are reported with an explicit
 *      `clamped` direction so the renderer can draw an arrow. Nothing is ever
 *      silently clamped.
 *   4. Tick labels are de-collided against their own approximate text width, so
 *      an axis is readable at 2 studies and at 50, for a 0.1-wide and a 40-wide
 *      domain alike.
 *   5. EVERY text cell owns its column. Study names are truncated to the name
 *      band; the "ES [95% CI]" cell instead WIDENS its column to fit, because a
 *      truncated number is a wrong number. A raw-unit mean difference
 *      ("-1234.500 [-2345.600, -123.400]") used to be drawn straight over the
 *      two weight columns at the same baseline on the live plot.
 *
 * Pure, framework-free ES module (no React, no DOM). Importable by the engine,
 * the frontend and Node tests.
 */

import { ES_TYPES } from '../project-model/monolithConstants.js';
// 117.md §24 — the ONE bounds table for the reviewer-settable geometry. The
// layout does not decide what is settable or how far; it only refuses to lay out
// a figure with an out-of-range metric (an unbounded plotW/fontScale produces a
// canvas no renderer can honour). Config module → geometry module: one way, no cycle.
import { clampForestMetrics, FOREST_BOUNDED_METRIC_KEYS } from './forestFigureConfig.js';

/* ════════════ measure metadata ════════════ */

/**
 * 116.md §24 — clinically standard ratio ticks. Geometry sits at log(r); the
 * label is the ratio itself. Ported from buildPubForestSVG (the only renderer
 * that ever had a measure-aware tick algorithm).
 */
export const RATIO_TICK_CANDIDATES = [0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 20, 50, 100];

/**
 * Second-tier ratio ticks, used only when the clinical set leaves fewer than three
 * ticks visible (a narrow domain such as OR 0.55-1.05). Previously the builder fell
 * back to the raw domain endpoints, which printed values like "0.50" that were not
 * actually at 0.5 — the label and the position disagreed by a hair.
 */
export const RATIO_TICK_CANDIDATES_FINE = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
  1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.5, 3, 4, 5, 6, 8, 10,
];

/**
 * Percent candidates for a logit-scale proportion axis. The old 0/20/40/60/80/100
 * loop produced 0–2 visible ticks for the common 5–40% band (0% and 100% are at
 * ±infinity on the logit scale and were approximated at 0.1%/99.9%).
 */
export const PROP_TICK_CANDIDATES = [0.5, 1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98, 99, 99.5];

/** Journal-clean measure name for the effect axis — shared with the funnel builder. */
export function esMeasureName(esType) {
  return esType === 'OR' ? 'Odds Ratio' : esType === 'RR' ? 'Risk Ratio' : esType === 'HR' ? 'Hazard Ratio'
    : esType === 'SMD' ? 'Standardised Mean Difference' : esType === 'MD' ? 'Mean Difference'
      : esType === 'COR' ? 'Correlation (Fisher z)' : esType === 'PROP' ? 'Proportion (%)' : 'Effect size';
}

/**
 * measureScale(esType, opts) — everything the axis needs to know about a measure.
 *
 * 116.md §24 — the no-effect value comes from the ES_TYPES registry `nullVal`
 * field (which existed but was read by no renderer), interpreted in STORED units:
 *
 *   measure                    stored scale   nullVal   axis
 *   OR/RR/HR/PETO/IRR/GEN_LOG  ln             0         log geometry, ratio labels, null at 1
 *   MD/SMD/RD/BETA/GENERIC     raw            0         linear, null at 0
 *   COR                        Fisher z       0         linear (z), null at 0
 *   AUC                        raw            0.5       linear, null at 0.5 (no discrimination)
 *   PROP                       logit          null      logit geometry, % labels, NO null line
 *
 * PROP DECISION (116.md §24): a single-arm proportion has no "no-effect" value —
 * 30% is not "null" and neither is 50%. Both renderers previously drew a line at
 * logit 0 (= 50%), which reads as though half the studies "favour" something.
 * `nullVal: null` is honoured literally: no null line, no null gridline emphasis
 * and no favours labels for PROP. The registry stays the authority.
 *
 * `opts.nullLine` (a raw stored-scale override) is honoured for LINEAR measures
 * only — exactly the pre-existing buildPubForestSVG semantics. A ratio measure's
 * null is ln(1) = 0 by construction and a proportion has none, so an override
 * there could only ever be a footgun.
 */
export function measureScale(esType, opts = {}) {
  const key = String(esType || '').trim().toUpperCase();
  const t = ES_TYPES[key] || {};
  const isLog = !!t.log;
  const isProp = key === 'PROP';
  const logScale = !!opts.logScale;            // opt-in: label a ratio axis in log units
  const ratioScale = isLog && !logScale;
  let nullStored = Object.prototype.hasOwnProperty.call(t, 'nullVal') ? t.nullVal : 0;
  if (!isLog && !isProp && opts.nullLine != null && Number.isFinite(+opts.nullLine)) nullStored = +opts.nullLine;
  const hasNull = nullStored != null && Number.isFinite(+nullStored);
  const backTransform = (x) => {
    const n = +x;
    if (!Number.isFinite(n)) return NaN;
    if (isLog) return Math.exp(n);
    if (isProp) { const e = Math.exp(n); return e / (1 + e); }
    return n;
  };
  return {
    esType: key,
    isLog,
    isProp,
    logScale,
    ratioScale,
    hasNull,
    nullStored: hasNull ? +nullStored : null,
    nullDisplay: hasNull ? backTransform(+nullStored) : null,
    backTransform,
    measureName: esMeasureName(key),
  };
}

/* ════════════ text metrics (approximate, but centralised) ════════════ */

/** Approximate rendered width of a string. One place, so both skins agree. */
export function approxTextWidth(text, fontSize, charW) {
  return String(text == null ? '' : text).length * fontSize * charW;
}

/** How many characters of `fontSize` text fit in `boxW`. */
export function fitChars(boxW, fontSize, charW) {
  return Math.max(1, Math.floor(boxW / Math.max(0.0001, fontSize * charW)));
}

/** Truncate to `maxChars`, appending an ellipsis when it actually cut. */
export function truncateLabel(text, maxChars) {
  const s = String(text == null ? '' : text);
  if (!(maxChars > 0) || s.length <= maxChars) return s;
  return s.slice(0, Math.max(1, maxChars - 1)) + '…';
}

/** Greedy word wrap to at most `maxLines` lines of `maxW` px. Last line ellipsised. */
export function wrapText(text, maxW, fontSize, charW, maxLines = 2) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return [];
  const per = Math.max(1, Math.floor(maxW / Math.max(0.0001, fontSize * charW)));
  const words = s.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length <= per || !cur) { cur = next; } else { lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && cur && lines[lines.length - 1] !== cur) {
    lines[lines.length - 1] = truncateLabel(lines[lines.length - 1] + ' ' + cur, per);
  } else if (lines.length) {
    lines[lines.length - 1] = truncateLabel(lines[lines.length - 1], per);
  }
  return lines;
}

/* ════════════ per-variant metric packs ════════════ */

/* Column widths / font sizes are the ONLY thing that differs between the two
   skins. Everything below this line is shared arithmetic. */
export const FOREST_METRICS = Object.freeze({
  live: Object.freeze({
    charW: 0.60,                                  // IBM Plex Mono
    marginL: 12, marginR: 16, marginT: 12, marginB: 14,
    nameW: 150, countW: 70, gapBefore: 0, plotW: 300, gapAfter: 10, effW: 128, weightW: 54,
    ROW: 24, rowsGap: 8, headH2: 34, headH1: 20,
    titleSize: 12, nameSize: 11, cellSize: 10, headSize: 9, headMainSize: 11,
    tickSize: 10, favSize: 9, axisLabelSize: 11, footSize: 10, footLead: 13,
    tickLabelGap: 15, favGap: 16, axisLabelGap: 18, footGap: 24, footPad: 6,
    markerMin: 5, markerMax: 13, markerF: 2.2, diamondH: 7,
    tickMinGap: 8, favMinPlotW: 130, favArrowW: 6, nameCap: 26, effPad: 8,
    // 117.md §24 — 1 = the historical figure exactly. Both skins read it off the
    // returned layout and multiply their own ink sizes by it, so the string the
    // layout MEASURES stays the string the renderer PRINTS at any scale.
    fontScale: 1,
  }),
  pub: Object.freeze({
    charW: 0.52,                                  // Georgia
    marginL: 28, marginR: 28, marginT: 20, marginB: 20,
    nameW: 160, countW: 92, gapBefore: 20, plotW: 300, gapAfter: 20, effW: 160, weightW: 62,
    ROW: 25, rowsGap: 10, headH2: 34, headH1: 20,
    titleSize: 15, nameSize: 10.5, cellSize: 10, headSize: 9.5, headMainSize: 11.5,
    tickSize: 9.5, favSize: 9, axisLabelSize: 11, footSize: 9.5, footLead: 13,
    tickLabelGap: 15, favGap: 16, axisLabelGap: 18, footGap: 24, footPad: 18,
    markerMin: 5, markerMax: 13, markerF: 2.2, diamondH: 6.5,
    tickMinGap: 8, favMinPlotW: 130, favArrowW: 6, nameCap: 26, effPad: 8,
    fontScale: 1,
  }),
});

/**
 * Every metric that is a TEXT SIZE, so `fontScale` can move all of them together
 * (117.md §24 "font scaling"). Gaps and column widths are deliberately NOT here:
 * they have their own bounded controls, and scaling them too would make one
 * slider silently resize the whole canvas.
 */
export const FOREST_FONT_METRIC_KEYS = Object.freeze([
  'titleSize', 'nameSize', 'cellSize', 'headSize', 'headMainSize',
  'tickSize', 'favSize', 'axisLabelSize', 'footSize', 'footLead',
]);

const BOUNDED_METRIC_KEY_SET = new Set(FOREST_BOUNDED_METRIC_KEYS);

/**
 * Merge a caller's `opts.metrics` onto a variant pack.
 *
 * 117.md §24 — the FIVE reviewer-settable metrics go through the bounds table,
 * always, whatever the caller claims: an out-of-range (or non-numeric) value is
 * dropped back to the pack default rather than producing a canvas no renderer
 * can lay out. Any OTHER metric key is an engine-internal seam (a pack detail
 * such as `favMinPlotW` or `countW`) and passes through untouched — no persisted
 * record can ever carry one, because `resolveForestPresentation` emits only the
 * five. Exported so the validation itself is unit-testable.
 */
export function mergeForestMetrics(base, raw) {
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  for (const k of Object.keys(raw)) {
    if (!BOUNDED_METRIC_KEY_SET.has(k)) out[k] = raw[k];
  }
  return { ...out, ...clampForestMetrics(raw) };
}

/**
 * Apply `M.fontScale` to every text size. Returns the SAME object when the scale
 * is 1 (or absent), so an unconfigured figure is byte-identical to the pre-117
 * geometry — the multiplication never runs.
 */
export function applyForestFontScale(M) {
  const fs = Number(M && M.fontScale);
  if (!Number.isFinite(fs) || fs === 1) return M;
  const out = { ...M };
  FOREST_FONT_METRIC_KEYS.forEach((k) => {
    const v = Number(out[k]);
    if (Number.isFinite(v)) out[k] = Math.round(v * fs * 100) / 100;
  });
  return out;
}

/* ════════════ domain ════════════ */

/**
 * 116.md §22/§33 — the visible domain.
 *
 * ANCHORS are the values that must ALWAYS be on screen: both pooled estimates
 * with their CIs, and the measure's null. Study estimates and CIs then widen the
 * frame, but only while they stay within `clipFactor` anchor spans — a single
 * study with a 10^6-wide CI (or an estimate three orders of magnitude away) must
 * not squash every other row into one pixel. Whatever falls outside is reported
 * as clamped so the renderer draws the conventional truncation arrow
 * (116.md §22 (c)) instead of quietly pretending the interval ended there.
 */
export function buildDomain({ anchors = [], points = [], intervals = [], nullStored = null, hasNull = false, clipFactor = 2.5, pad = 0.10 }) {
  const pts = points.map(Number).filter(Number.isFinite);
  const anc = anchors.map(Number).filter(Number.isFinite);
  const ivs = intervals
    .map(([lo, hi]) => [Number(lo), Number(hi)])
    .filter(([lo, hi]) => Number.isFinite(lo) || Number.isFinite(hi));
  let coreMin = anc.length ? Math.min(...anc) : (pts.length ? Math.min(...pts) : null);
  let coreMax = anc.length ? Math.max(...anc) : (pts.length ? Math.max(...pts) : null);
  if (hasNull) {
    coreMin = coreMin === null ? nullStored : Math.min(coreMin, nullStored);
    coreMax = coreMax === null ? nullStored : Math.max(coreMax, nullStored);
  }
  if (coreMin === null || coreMax === null) { coreMin = 0; coreMax = 0; }

  const widths = ivs.map(([lo, hi]) => (Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : NaN))
    .filter((w) => Number.isFinite(w) && w > 0).sort((a, b) => a - b);
  const medianWidth = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const coreSpan = Math.max(coreMax - coreMin, medianWidth, 1e-6);
  const limLo = coreMin - clipFactor * coreSpan;
  const limHi = coreMax + clipFactor * coreSpan;

  let minV = coreMin, maxV = coreMax;
  pts.forEach((p) => { minV = Math.min(minV, Math.max(p, limLo)); maxV = Math.max(maxV, Math.min(p, limHi)); });
  ivs.forEach(([lo, hi]) => {
    if (Number.isFinite(lo)) minV = Math.min(minV, Math.max(lo, limLo));
    if (Number.isFinite(hi)) maxV = Math.max(maxV, Math.min(hi, limHi));
  });

  let span = maxV - minV;
  if (!(span > 0)) { const h = Math.max(1e-3, Math.abs(minV) * 0.25, 0.5); minV -= h; maxV += h; span = maxV - minV; }
  minV -= span * pad; maxV += span * pad;
  // Invariant 1 — the null value is inside the frame WITH a margin, never on it.
  if (hasNull) {
    const m = Math.max(span * 0.05, 0.05);
    minV = Math.min(minV, nullStored - m);
    maxV = Math.max(maxV, nullStored + m);
  }
  return [minV, maxV];
}

/* ════════════ ticks ════════════ */

function linearTickLabel(v, step) {
  const d = Math.min(4, Math.max(0, Math.ceil(-Math.log10(Math.abs(step) || 1))));
  let s = (+v).toFixed(d);
  if (parseFloat(s) === 0) s = (0).toFixed(d);
  return d > 0 ? String(parseFloat(s)) : s;
}

/**
 * De-collide ticks against their own label width (116.md §23 "tick labels do not
 * overlap"). The null tick is protected: when it collides with the previously
 * kept tick it REPLACES it rather than being dropped.
 */
export function decollideTicks(ticks, fontSize, charW, minGap) {
  const kept = [];
  for (const tk of ticks) {
    const w = approxTextWidth(tk.label, fontSize, charW);
    const cur = { ...tk, w };
    if (!kept.length) { kept.push(cur); continue; }
    const last = kept[kept.length - 1];
    if (cur.x - last.x >= (last.w + w) / 2 + minGap) kept.push(cur);
    else if (cur.isNull && !last.isNull) kept[kept.length - 1] = cur;
  }
  if (kept.length < 2 && ticks.length >= 2) {
    const first = ticks[0], last = ticks[ticks.length - 1];
    return [first, last].map((t) => ({ ...t, w: approxTextWidth(t.label, fontSize, charW) }));
  }
  return kept;
}

/**
 * buildTicks — measure-aware tick VALUES on the stored scale plus their
 * back-transformed labels. Ratio measures get clinical 0.5/1/2/5 ticks (not
 * uniform log steps back-transformed into 0.61/1.65/2.72 mush); proportions get
 * percent ticks placed through logit; linear measures get a 1-2-5 "nice step".
 */
export function buildTicks(scale, domain, xS) {
  const [minV, maxV] = domain;
  const out = [];
  const seen = new Set();
  const push = (v, label, isNull) => {
    const key = (+v).toFixed(6);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ v: +v, x: xS(v), label: String(label), isNull: !!isNull });
  };
  if (scale.ratioScale) {
    // A candidate is kept only when its POSITION is inside the domain — a tick
    // drawn a few pixels outside the plot band is a defect, not a nicety.
    const inRange = (r) => { const lv = Math.log(r); return lv >= minV - 1e-9 && lv <= maxV + 1e-9; };
    let cand = RATIO_TICK_CANDIDATES.filter(inRange);
    if (cand.length < 3) {
      const fine = RATIO_TICK_CANDIDATES_FINE.filter(inRange);
      if (fine.length > cand.length) cand = fine;
    }
    cand.forEach((r) => push(Math.log(r), String(r), r === 1));
    if (out.length < 2) {
      // Pathologically narrow ratio window — label the endpoints themselves, at a
      // precision that actually describes where they are.
      [Math.exp(minV), Math.exp(maxV)].forEach((r) => {
        if (r > 0) push(Math.log(r), String(+r.toPrecision(3)), false);
      });
    }
  } else if (scale.isProp) {
    PROP_TICK_CANDIDATES.forEach((pct) => {
      const pr = pct / 100;
      const lv = Math.log(pr / (1 - pr));
      if (lv >= minV - 1e-9 && lv <= maxV + 1e-9) push(lv, String(pct), false);
    });
    if (out.length < 2) {
      [minV, maxV].forEach((lv) => push(lv, ((Math.exp(lv) / (1 + Math.exp(lv))) * 100).toFixed(0), false));
    }
  } else {
    const range = (maxV - minV) || 1;
    const raw = range / 5;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    for (let v = Math.ceil(minV / step) * step; v <= maxV + 1e-9; v += step) {
      push(v, linearTickLabel(v, step), scale.hasNull && Math.abs(v - scale.nullStored) < step * 1e-6);
    }
    if (scale.hasNull && !out.some((t) => t.isNull)) push(scale.nullStored, linearTickLabel(scale.nullStored, step), true);
  }
  out.sort((a, b) => a.v - b.v);
  return out;
}

/* ════════════ counts + names ════════════ */

/** Events/total cell strings — one implementation so both skins print the same. */
export function countsFor(s) {
  const has = (v) => v !== '' && v != null;
  const eN = has(s.a) ? s.a : (has(s.events) ? s.events : '');
  const eT = has(s.a) ? ((+s.a) + (+s.b || 0) || s.nExp || '') : (has(s.total) ? s.total : '');
  const cN = has(s.c) ? s.c : '';
  const cT = has(s.c) ? ((+s.c) + (+s.d || 0) || s.nCtrl || '') : '';
  return {
    exp: eN === '' ? '—' : `${eN} / ${eT || '?'}`,
    ctrl: cN === '' ? '—' : `${cN} / ${cT || '?'}`,
    hasExp: eN !== '',
    hasCtrl: cN !== '',
  };
}

/** Study display name — the extraction row is the ONLY source (116.md §27). */
export function studyDisplayName(s) {
  return `${(s && s.author) || 'Study'}${s && s.year ? ` ${s.year}` : ''}`;
}

/* ════════════ the layout ════════════ */

/**
 * computeForestLayout(result, opts) — see the module header for the contract.
 * Returns null when there is nothing to draw (no result / no studies).
 */
export function computeForestLayout(result, opts = {}) {
  if (!result || !Array.isArray(result.studies) || !result.studies.length) return null;
  const variant = opts.variant === 'pub' ? 'pub' : 'live';
  // 117.md §24 — an override reaches the geometry ONLY through the bounds table.
  // `clampForestMetrics` returns a shared frozen `{}` for an unconfigured figure,
  // so the historical metric pack survives spread-for-spread.
  const M = applyForestFontScale(mergeForestMetrics(FOREST_METRICS[variant], opts.metrics));
  const studies = result.studies;
  const k = studies.length;

  const scale = measureScale(opts.esType, opts);
  const showWeights = opts.showWeights !== false;
  const anyExp = studies.some((s) => s.a !== '' && s.a != null);
  const anyCtrl = studies.some((s) => s.c !== '' && s.c != null);
  const showCounts = opts.showCounts !== false && (anyExp || anyCtrl);
  const showPI = !!(result.predInt && opts.showPI !== false);

  /* ── effect / CI cell strings (invariant 5) ──────────────────────────────
     A skin hands in its OWN value formatter (the live plot's bounded chart
     formatter, the publication builder's export-precision one) and the layout
     builds the cell strings from it. Two things follow: the string the layout
     MEASURES is exactly the string the renderer PRINTS, and the effect column
     can size itself to the widest cell instead of letting a raw-unit mean
     difference run across the weight columns. A caller that passes no formatter
     gets no strings and the fixed column width, byte-for-byte as before. */
  const fmtCell = typeof opts.formatValue === 'function' ? opts.formatValue : null;
  const ciCell = fmtCell ? ((es, lo, hi) => `${fmtCell(es)} [${fmtCell(lo)}, ${fmtCell(hi)}]`) : null;
  const rowEsTexts = ciCell ? studies.map((s) => ciCell(s._es, s._lo, s._hi)) : null;
  const diamondEsText = ciCell ? {
    fixed: result.fixed ? ciCell(result.fixed.es, result.fixed.lo, result.fixed.hi) : '',
    random: result.random ? ciCell(result.random.es, result.random.lo, result.random.hi) : '',
  } : null;
  const piEsText = (ciCell && showPI) ? `${fmtCell(result.predInt.lo)} to ${fmtCell(result.predInt.hi)}` : '';
  // The column grows only when something genuinely does not fit, so a project
  // with ordinary values keeps the historical geometry exactly.
  const effTexts = ciCell
    ? [...rowEsTexts, diamondEsText.fixed, diamondEsText.random, piEsText].filter(Boolean)
    : [];
  const effW = effTexts.reduce(
    (w, t) => Math.max(w, Math.ceil(approxTextWidth(t, M.cellSize, M.charW)) + M.effPad),
    M.effW,
  );

  /* ── columns ─────────────────────────────────────────────────────────── */
  const cExp = showCounts ? M.countW : 0;
  const cCtrl = showCounts ? M.countW : 0;
  const cW = showWeights ? M.weightW : 0;
  const cW2 = showWeights ? M.weightW : 0;
  const xName = M.marginL;
  const xExp = xName + M.nameW;
  const xCtrl = xExp + cExp;
  const xPlot = xCtrl + cCtrl + M.gapBefore;
  const plotW = M.plotW;
  const xPlotEnd = xPlot + plotW;
  const xEff = xPlotEnd + M.gapAfter;
  const xW = xEff + effW;
  const xW2 = xW + cW;
  const W = xW2 + cW2 + M.marginR;
  const contentW = W - M.marginL - M.marginR;
  // 116.md §23 — study labels own their band: truncation is derived from the
  // column width and the variant's own character metric, so a 150-char study name
  // can never bleed into the counts column at either font size.
  const maxNameChars = Math.min(M.nameCap, fitChars(M.nameW - 8, M.nameSize, M.charW));

  /* ── title + subtitle (own block above the header) ───────────────────── */
  const rawTitle = String(opts.title || '').trim();
  let titleSize = M.titleSize;
  let titleLines = [];
  if (rawTitle) {
    titleLines = wrapText(rawTitle, contentW, titleSize, M.charW, 2);
    if (titleLines.length === 2 && variant === 'pub') titleSize = M.titleSize - 2;
  }
  // 117.md §24 — the optional subtitle is a SECOND, smaller centred block under
  // the title, wrapped and measured like everything else. Additive by
  // construction: with no subtitle every number below is what it was pre-117.
  const rawSubtitle = String(opts.subtitle || '').trim();
  const subtitleSize = Math.max(8, Math.round((M.titleSize - 3) * 100) / 100);
  const subtitleLines = rawSubtitle ? wrapText(rawSubtitle, contentW, subtitleSize, M.charW, 2) : [];
  const subtitleLead = subtitleSize + 4;
  const titleH = titleLines.length * (titleSize + 5);
  const subtitleH = subtitleLines.length * subtitleLead;
  const titleBlockH = (titleH || subtitleH) ? titleH + subtitleH + 10 : 0;

  /* ── rows ────────────────────────────────────────────────────────────── */
  const headTop = M.marginT + titleBlockH;
  const headH = (showCounts || showWeights) ? M.headH2 : M.headH1;
  const headBottom = headTop + headH;
  const rowsTop = headBottom + M.rowsGap;
  const ROW = M.ROW;
  const yStudy = (i) => rowsTop + ROW * 0.7 + i * ROW;
  const bandBottom = rowsTop + k * ROW + 2;
  const ySep = bandBottom + 6;
  const yFixed = ySep + ROW * 0.9;
  const yRandom = yFixed + ROW;
  const yPI = showPI ? yRandom + ROW * 0.85 : yRandom;
  // 116.md §22 (C10) — the axis gets its own y BELOW the diamond band, so the
  // pooled diamond's bottom tip can never touch the tick numbers again.
  const axisY = yPI + ROW * 0.7;
  const tickLabelY = axisY + M.tickLabelGap;
  const favY = tickLabelY + M.favGap;
  const axisLabelY = favY + M.axisLabelGap;
  const footerTop = axisLabelY + M.footGap;

  /* ── scale ───────────────────────────────────────────────────────────── */
  const anchors = [
    result.fixed && +result.fixed.es, result.random && +result.random.es,
    result.fixed && +result.fixed.lo, result.fixed && +result.fixed.hi,
    result.random && +result.random.lo, result.random && +result.random.hi,
  ].filter((v) => Number.isFinite(v));
  const points = studies.map((s) => +s._es).filter((v) => Number.isFinite(v));
  // The prediction interval deliberately does NOT drive the domain: at small k it
  // is an order of magnitude wider than the data and would squash every study row
  // into a few pixels. It is drawn like any other interval and, when it runs past
  // the frame, gets the same explicit truncation arrows (116.md §22 (c)).
  const intervals = studies.map((s) => [+s._lo, +s._hi]);
  const domain = buildDomain({ anchors, points, intervals, nullStored: scale.nullStored, hasNull: scale.hasNull });
  const [minV, maxV] = domain;
  const range = (maxV - minV) || 1;
  /** Raw (unclamped) stored-value → x. Only `place()` is safe to draw with. */
  const xRaw = (v) => xPlot + ((+v - minV) / range) * plotW;
  /**
   * place(v) — the ONLY way a renderer turns a value into a coordinate.
   * `clamped` is -1 (off the left edge), 1 (off the right edge) or 0. A non-zero
   * clamp is an instruction to draw a truncation arrow, never a silent squash.
   */
  const place = (v) => {
    const n = +v;
    if (!Number.isFinite(n)) return { v: NaN, x: xPlot, clamped: 0, off: true };
    if (n < minV) return { v: n, x: xPlot, clamped: -1, off: false };
    if (n > maxV) return { v: n, x: xPlotEnd, clamped: 1, off: false };
    return { v: n, x: xRaw(n), clamped: 0, off: false };
  };
  const xS = (v) => place(v).x;

  /* ── ticks ───────────────────────────────────────────────────────────── */
  const ticks = decollideTicks(buildTicks(scale, domain, xRaw), M.tickSize, M.charW, M.tickMinGap);
  const nullPlace = scale.hasNull ? place(scale.nullStored) : null;

  /* ── study rows ──────────────────────────────────────────────────────── */
  // 116.md §124 — marker area tracks the weight of the DISPLAYED model (`_pct`,
  // which runMeta already computed) instead of always the fixed-effect weight.
  const markerSize = (pct) => Math.max(M.markerMin, Math.min(M.markerMax, Math.sqrt(Math.max(0, +pct || 0)) * M.markerF));
  const rows = studies.map((s, i) => {
    const y = yStudy(i);
    const counts = countsFor(s);
    const pct = (s._pct != null && +s._pct > 0) ? +s._pct : (+s._wFixedPct || 0);
    return {
      index: i,
      id: s.id != null ? s.id : i,
      y,
      markerY: y - 3.5,
      name: truncateLabel(studyDisplayName(s), maxNameChars),
      nameFull: studyDisplayName(s),
      es: place(s._es),
      lo: place(s._lo),
      hi: place(s._hi),
      esText: rowEsTexts ? rowEsTexts[i] : '',
      size: markerSize(pct),
      weightFixedPct: +s._wFixedPct || 0,
      weightRandomPct: +s._wRandomPct || 0,
      counts,
      study: s,
    };
  });

  /* ── pooled diamonds + prediction interval ───────────────────────────── */
  const method = result.method === 'fixed' ? 'fixed' : 'random';
  const mkDiamond = (key, obj, label, y) => (obj ? {
    key, label, y, markerY: y - 3.5, strong: method === key,
    es: place(obj.es), lo: place(obj.lo), hi: place(obj.hi),
    esText: diamondEsText ? diamondEsText[key] : '',
    value: obj, height: M.diamondH,
  } : null);
  const diamonds = [
    mkDiamond('fixed', result.fixed, 'Common (fixed) effect', yFixed),
    mkDiamond('random', result.random, 'Random effects', yRandom),
  ].filter(Boolean);
  const pi = showPI ? {
    y: yPI, markerY: yPI - 3.5, label: 'Prediction interval',
    lo: place(result.predInt.lo), hi: place(result.predInt.hi),
    centre: place(result.random ? result.random.es : result.pES), value: result.predInt,
    esText: piEsText,
  } : null;

  /* ── favours labels (116.md §25) ─────────────────────────────────────── */
  /* Edge-anchored under the two axis halves, on their own row, ellipsised so the
     two texts can never meet in the middle or spill into a neighbouring column.
     Defaults are DIRECTION-descriptive only: "favours lower/higher" states which
     way the axis runs and claims nothing clinical. A harm outcome inverts the
     clinical reading, and PICO arm names cannot tell us which — so contextual
     text ("Favours intervention"/"Favours control") is used ONLY when the figure
     is explicitly configured with it (analysisSettings.figureLabels). */
  const favMaxW = plotW / 2 - (M.favArrowW + 12);
  const favMaxChars = fitChars(favMaxW, M.favSize, M.charW);
  const favLowText = String(opts.favLow || '').trim() || 'favours lower';
  const favHighText = String(opts.favHigh || '').trim() || 'favours higher';
  const favours = {
    // No no-effect value ⇒ no "favours" direction to state (PROP).
    show: scale.hasNull && plotW >= M.favMinPlotW,
    y: favY,
    low: { text: truncateLabel(favLowText, favMaxChars), x: xPlot + M.favArrowW + 5, anchor: 'start', arrowX: xPlot + 2, dir: 1 },
    high: { text: truncateLabel(favHighText, favMaxChars), x: xPlotEnd - M.favArrowW - 5, anchor: 'end', arrowX: xPlotEnd - 2, dir: -1 },
    maxWidth: favMaxW,
    arrowW: M.favArrowW,
  };

  /* ── axis label + footer ─────────────────────────────────────────────── */
  // 116.md §26/§32 — a configured esLabel is the axis name EVERYWHERE (the
  // publication builder used to ignore it and always print the measure name).
  const configuredAxis = String(opts.esLabel || '').trim();
  const defaultAxis = scale.ratioScale ? scale.measureName
    : scale.isProp ? 'Proportion (%)'
      : (scale.isLog && scale.logScale) ? `log ${scale.measureName}` : scale.measureName;
  const axisLabel = configuredAxis || defaultAxis;

  const footerTexts = (Array.isArray(opts.footerTexts) ? opts.footerTexts : []).filter((t) => t != null && String(t).trim() !== '');
  const footerLines = [];
  let fy = footerTop;
  footerTexts.forEach((text) => {
    wrapText(text, contentW, M.footSize, M.charW, 3).forEach((ln) => { footerLines.push({ text: ln, y: fy }); fy += M.footLead; });
  });
  const H = (footerLines.length ? fy - M.footLead : footerTop - M.footGap) + M.footPad + M.marginB;

  return {
    variant, metrics: M, esType: scale.esType, scale, method,
    k, showCounts, showWeights, showPI,
    columns: {
      xName, nameW: M.nameW, xExp, cExp, xCtrl, cCtrl,
      xPlot, plotW, xPlotEnd, xEff, cEff: effW, xW, cW, xW2, cW2,
      W, contentW, maxNameChars,
    },
    title: { text: rawTitle, lines: titleLines, size: titleSize, blockH: titleBlockH, y: M.marginT + titleSize, lead: titleSize + 5 },
    subtitle: {
      text: rawSubtitle, lines: subtitleLines, size: subtitleSize,
      y: M.marginT + titleH + subtitleSize, lead: subtitleLead,
    },
    rowsGeom: {
      headTop, headH, headBottom, rowsTop, ROW, bandBottom, ySep,
      yFixed, yRandom, yPI, axisY, tickLabelY, favY, axisLabelY, footerTop, H,
      yStudy,
    },
    domain, range, xS, xRaw, place,
    ticks,
    nullLine: nullPlace ? { ...nullPlace, show: true } : { show: false, x: null, clamped: 0 },
    rows,
    diamonds,
    pi,
    favours,
    axisLabel,
    footerLines,
    H, W,
  };
}

export default {
  computeForestLayout,
  measureScale,
  buildDomain,
  buildTicks,
  decollideTicks,
  countsFor,
  studyDisplayName,
  truncateLabel,
  wrapText,
  approxTextWidth,
  fitChars,
  esMeasureName,
  applyForestFontScale,
  mergeForestMetrics,
  RATIO_TICK_CANDIDATES,
  PROP_TICK_CANDIDATES,
  FOREST_METRICS,
  FOREST_FONT_METRIC_KEYS,
};
