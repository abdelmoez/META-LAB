/**
 * charts/forestFigureConfig.js — 116.md §26 / §32 / §124 (decision D15),
 * extended by 117.md §23-§25 / §81 (forest presentation controls).
 *
 * THE single resolver for "what does this forest figure SAY and LOOK LIKE".
 * `forestLayout.js` owns the geometry arithmetic; this module owns the persisted
 * configuration and the no-effect authority, so that every surface that draws a
 * forest plot — the live plot, the Forest-tab download, the Meta-Analysis-tab
 * download, the report HTML, the journal ZIP, the manuscript DOCX, the
 * reproducibility bundle and the manuscript figure preview — is configured from
 * ONE place.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * D15 persisted per-figure labels at
 * `project.analysisSettings.figureLabels[pairKey] = {title?, esLabel?, favLow?, favHigh?}`
 * and the Forest tab threaded them into the layout. Every OTHER forest surface
 * kept building its own options inline, and each one drifted:
 *
 *   • two export paths passed `nullLine: 0`, a raw stored-scale override that
 *     BEAT the registry for the one measure whose no-effect value is not zero
 *     (AUC, ES_TYPES.AUC.nullVal === 0.5) — the exported figure drew "no effect"
 *     at AUC 0, a value outside the range of the statistic, and stretched the
 *     domain to −0.09…1.03 while the screen showed 0.45…0.98;
 *   • three export paths built the axis name from `ES_TYPES[esType].scale`, the
 *     STORED-scale name, so a back-transformed ratio axis was captioned
 *     "lnOR (back-transformed)" and a percent axis "logit (%)" while the screen
 *     said "Odds Ratio" / "Proportion (%)";
 *   • the manuscript DOCX, the repro bundle and the manuscript figure preview
 *     passed no labels at all, so a reviewer's "Favours intervention" /
 *     "Favours control" survived into the ZIP but not into the Word file that is
 *     actually submitted.
 *
 * 117.md §81 ("saved preferences") adds the second half of the same defect: the
 * two column toggles a reviewer flipped on the Forest tab were React `useState`
 * and evaporated on reload, and `showPI` / the layout's `opts.metrics` hook
 * existed with no UI at all. Everything a reviewer can change about how the
 * figure LOOKS is now one persisted record, resolved here.
 *
 * ── Contract ───────────────────────────────────────────────────────────────
 *   resolveForestFigure(project, pair, {defaultTitle}) -> full presentation + title
 *   resolveForestPresentation(project, pair)           -> the same, WITHOUT title
 *   forestFigureLabels(project, pair)                  -> {esLabel, favLow, favHigh}
 *
 * The resolved presentation is:
 *   { title?, subtitle, note, esLabel, favLow, favHigh,
 *     showCounts, showWeights, showPI, decimals, metrics }
 *
 * THREE rules make this a resolver rather than another opinion:
 *
 *   1. An unset label resolves to `''` — NOT to a locally invented default.
 *      Empty means "auto", and `forestLayout.js` derives the axis name from the
 *      measure registry (`Odds Ratio`, `Proportion (%)`, …) and the favours text
 *      from the direction-only defaults. One default, everywhere.
 *   2. NO `nullLine` is ever emitted. The no-effect value comes from
 *      `ES_TYPES[esType].nullVal` and from nowhere else (116.md §24): PROP has
 *      none (no null line, no favours labels), AUC's is 0.5, everything else 0.
 *      That asymmetry is deliberate — see the AUC corruption above.
 *   3. 117.md §25 — NOTHING here can move a statistical value. The record holds
 *      text, visibility, display precision and bounded geometry; `es`/`lo`/`hi`
 *      and the weights stay linked to the analysis engine, which is what §25
 *      asks for ("ideally statistical data should remain linked"). There is
 *      deliberately no value-override field to resolve.
 *
 * Pure, framework-free ES module (no React, no DOM). Importable by the engine,
 * the frontend, the manuscript export and Node tests.
 */

import { clampDecimals } from '../format/precision.js';

/** Frozen "nothing configured" record — shared so callers never allocate. */
export const EMPTY_FOREST_LABELS = Object.freeze({ esLabel: '', favLow: '', favHigh: '' });

/** The pair key a figureLabels entry is addressed by (`outcome|||timepoint`). */
export function forestPairKey(pair) {
  if (typeof pair === 'string') return pair;
  return (pair && pair.key) || '';
}

/** The RAW persisted record for one pair, or `{}`. Never mutated, never stamped. */
export function figureLabelsFor(project, pair) {
  const map = project && project.analysisSettings && project.analysisSettings.figureLabels;
  const key = forestPairKey(pair);
  const rec = key && map ? map[key] : null;
  return (rec && typeof rec === 'object') ? rec : EMPTY_FIGURE_RECORD;
}
const EMPTY_FIGURE_RECORD = Object.freeze({});

const clean = (v) => String(v == null ? '' : v).trim();

/**
 * Per-figure decimals, or null ("use the project setting").
 * Only a number or a numeric string counts: `Number(true)`, `Number('')` and
 * `Number(null)` are all finite, so a bare clampDecimals would turn a cleared
 * select — or a boolean in a hand-edited blob — into a real precision override.
 */
function figureDecimals(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '') return null;
  return clampDecimals(s, null);
}

/* ════════════ 117.md §24 — the ONE bounds table ════════════ */

/**
 * The bounded geometry a reviewer may override, in ONE table.
 *
 * 117.md §24 lists more candidate controls than a usable panel can carry
 * ("expose useful controls without creating an overwhelming interface"), and
 * several of them are already decided by the engine and must stay that way:
 * the x-axis range is derived so the measure's no-effect value is always inside
 * the frame (forestLayout invariant 1), tick spacing is measure-aware and
 * de-collided against real label widths (invariant 4), and the effect column
 * sizes itself to its own text (invariant 5). Handing those to a slider would
 * re-open exactly the defects D15 closed. What is left is the geometry a
 * reviewer legitimately needs for a journal's column width — and it is bounded,
 * because an unbounded plot width silently produces a figure no renderer can
 * lay out.
 *
 *   name        metric key   what it moves
 *   plotW       plotW        width of the forest band itself
 *   nameW       nameW        the study-label column
 *   rowGap      ROW          row pitch (row spacing)
 *   diamondH    diamondH     pooled-diamond half-height
 *   fontScale   fontScale    multiplies EVERY text size in the figure
 *
 * `defaultLive` mirrors FOREST_METRICS.live and is pinned by a test, so the two
 * tables can never drift. The publication variant's own defaults differ slightly
 * (Georgia vs IBM Plex Mono); an override deliberately applies to BOTH skins —
 * the reviewer is configuring one figure, not two.
 */
export const FOREST_PRESENTATION_BOUNDS = Object.freeze({
  plotW: Object.freeze({ metric: 'plotW', min: 180, max: 720, step: 10, defaultLive: 300, label: 'Plot width', unit: 'px' }),
  nameW: Object.freeze({ metric: 'nameW', min: 90, max: 340, step: 10, defaultLive: 150, label: 'Study column width', unit: 'px' }),
  rowGap: Object.freeze({ metric: 'ROW', min: 16, max: 48, step: 1, defaultLive: 24, label: 'Row spacing', unit: 'px' }),
  diamondH: Object.freeze({ metric: 'diamondH', min: 4, max: 16, step: 0.5, defaultLive: 7, label: 'Diamond size', unit: 'px' }),
  fontScale: Object.freeze({ metric: 'fontScale', min: 0.8, max: 1.5, step: 0.05, defaultLive: 1, label: 'Font scale', unit: '×' }),
});

/** The bounded-metric names, in panel order. */
export const FOREST_METRIC_NAMES = Object.freeze(Object.keys(FOREST_PRESENTATION_BOUNDS));

/**
 * Every key `clampForestMetrics` owns — both the stored user-facing name and the
 * FOREST_METRICS key it maps to. `computeForestLayout` uses this to tell a
 * reviewer-settable metric (which must go through the bounds table) from an
 * engine-internal one (a metric pack detail such as `favMinPlotW`, which no
 * persisted record can ever carry because the resolver never emits it).
 */
export const FOREST_BOUNDED_METRIC_KEYS = Object.freeze(
  FOREST_METRIC_NAMES.flatMap((n) => [n, FOREST_PRESENTATION_BOUNDS[n].metric])
    .filter((k, i, a) => a.indexOf(k) === i),
);

/** The persisted presentation keys (everything that is NOT free text). */
export const FIGURE_PRESENTATION_KEYS = Object.freeze(['showCounts', 'showWeights', 'showPI', 'decimals', 'metrics']);

const EMPTY_METRICS = Object.freeze({});

/**
 * Clamp ONE bounded metric. Returns null for anything unusable, so a caller can
 * treat "not set" and "not a number" identically. Rounded to 2 places so a
 * float-arithmetic slider can never persist 1.0500000000000003.
 */
export function clampForestMetric(name, value) {
  const b = FOREST_PRESENTATION_BOUNDS[name];
  if (!b) return null;
  // Only a number or a numeric string is a value here. `Number('')`, `Number(null)`
  // and `Number([])` are all 0, which would silently clamp "cleared" and "not a
  // number" up to the floor instead of removing the override.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const s = typeof value === 'string' ? value.trim() : value;
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(b.max, Math.max(b.min, n)) * 100) / 100;
}

/**
 * Clamp a whole metric-override record into the FOREST_METRICS key space that
 * `computeForestLayout` merges. Accepts either the stored user-facing names
 * (`rowGap`) or the metric keys themselves (`ROW`), so the layout can validate
 * a hand-built `opts.metrics` with the same table the writer uses.
 * Returns a SHARED frozen `{}` when nothing survives, so the common case
 * allocates nothing and spreads to a no-op.
 */
export function clampForestMetrics(raw) {
  if (!raw || typeof raw !== 'object') return EMPTY_METRICS;
  const out = {};
  let any = false;
  for (const name of FOREST_METRIC_NAMES) {
    const b = FOREST_PRESENTATION_BOUNDS[name];
    const v = raw[name] !== undefined ? raw[name] : raw[b.metric];
    const n = clampForestMetric(name, v);
    if (n != null) { out[b.metric] = n; any = true; }
  }
  return any ? out : EMPTY_METRICS;
}

/**
 * The STORAGE form of a presentation record: only what differs from the default,
 * in a stable key order, or `null` when the figure is entirely default.
 *
 * Booleans default TRUE and are therefore stored ONLY when false; `decimals`
 * only when it is a usable integer; metric overrides only when in bounds — so a
 * project that never opened the panel keeps a byte-identical blob, and one that
 * resets the panel gets its container deleted again.
 */
export function normalizeFigurePresentation(record) {
  if (!record || typeof record !== 'object') return null;
  const out = {};
  for (const k of ['showCounts', 'showWeights', 'showPI']) {
    if (record[k] === false) out[k] = false;
  }
  const d = figureDecimals(record.decimals);
  if (d != null) out.decimals = d;
  const clamped = clampForestMetrics(record.metrics);
  const stored = {};
  let anyMetric = false;
  for (const name of FOREST_METRIC_NAMES) {
    const v = clamped[FOREST_PRESENTATION_BOUNDS[name].metric];
    if (v !== undefined) { stored[name] = v; anyMetric = true; }
  }
  if (anyMetric) out.metrics = stored;
  return Object.keys(out).length ? out : null;
}

/**
 * The three TEXT labels a forest figure carries, resolved for one outcome pair.
 * Deliberately excludes the title: the DOCX numbers and captions its figures in
 * Word, so it must not bake a title into the image.
 */
export function forestFigureLabels(project, pair) {
  const fl = figureLabelsFor(project, pair);
  const esLabel = clean(fl.esLabel);
  const favLow = clean(fl.favLow);
  const favHigh = clean(fl.favHigh);
  if (!esLabel && !favLow && !favHigh) return EMPTY_FOREST_LABELS;
  return { esLabel, favLow, favHigh };
}

/**
 * resolveForestPresentation(project, pair) — 117.md §23/§24/§81.
 *
 * EVERYTHING a forest surface needs except the title, as ONE object that every
 * caller spreads verbatim. Adding a control here reaches the live plot, the
 * hidden dark render, both export dialogs, the report HTML, the journal ZIP,
 * the DOCX, the repro bundle and the manuscript preview at once — which is the
 * D15 drift class, closed structurally rather than by discipline.
 */
export function resolveForestPresentation(project, pair) {
  const fl = figureLabelsFor(project, pair);
  const labels = forestFigureLabels(project, pair);
  return {
    subtitle: clean(fl.subtitle),
    note: clean(fl.note),
    esLabel: labels.esLabel,
    favLow: labels.favLow,
    favHigh: labels.favHigh,
    // Absent ⇒ ON. Stored only when the reviewer turned a column off.
    showCounts: fl.showCounts !== false,
    showWeights: fl.showWeights !== false,
    showPI: fl.showPI !== false,
    // null ⇒ "use the project-level analysisPrecision" (117.md §24 decimal precision).
    decimals: figureDecimals(fl.decimals),
    // Always an object (possibly the shared empty one) so `{...(opts.metrics||{})}`
    // in the layout is a no-op for an unconfigured figure.
    metrics: clampForestMetrics(fl.metrics),
  };
}

/**
 * The full figure configuration for one outcome pair.
 * `opts.defaultTitle` is the caller's own title when the reviewer set none —
 * `''` for surfaces that caption the figure outside the image.
 */
export function resolveForestFigure(project, pair, opts = {}) {
  const fl = figureLabelsFor(project, pair);
  return {
    title: clean(fl.title) || clean(opts.defaultTitle),
    ...resolveForestPresentation(project, pair),
  };
}

/** The resolved shape of a project/pair that configured nothing (default props, tests). */
export const EMPTY_FOREST_FIGURE = Object.freeze(resolveForestFigure(null, null));

export default {
  resolveForestFigure,
  resolveForestPresentation,
  forestFigureLabels,
  figureLabelsFor,
  forestPairKey,
  normalizeFigurePresentation,
  clampForestMetric,
  clampForestMetrics,
  FOREST_PRESENTATION_BOUNDS,
  FOREST_METRIC_NAMES,
  FOREST_BOUNDED_METRIC_KEYS,
  FIGURE_PRESENTATION_KEYS,
  EMPTY_FOREST_LABELS,
  EMPTY_FOREST_FIGURE,
};
