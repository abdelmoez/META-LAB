/**
 * charts/forestFigureConfig.js — 116.md §26 / §32 / §124 (decision D15).
 *
 * THE single resolver for "what does this forest figure SAY". `forestLayout.js`
 * owns the geometry; this module owns the text and the no-effect authority, so
 * that every surface that draws a forest plot — the live plot, the Forest-tab
 * download, the Meta-Analysis-tab download, the report HTML, the journal ZIP,
 * the manuscript DOCX, the reproducibility bundle and the manuscript figure
 * preview — is configured from ONE place.
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
 * ── Contract ───────────────────────────────────────────────────────────────
 *   resolveForestFigure(project, pair, {defaultTitle}) -> {title, esLabel, favLow, favHigh}
 *   forestFigureLabels(project, pair)                  -> {esLabel, favLow, favHigh}
 *
 * TWO rules make this a resolver rather than another opinion:
 *
 *   1. An unset label resolves to `''` — NOT to a locally invented default.
 *      Empty means "auto", and `forestLayout.js` derives the axis name from the
 *      measure registry (`Odds Ratio`, `Proportion (%)`, …) and the favours text
 *      from the direction-only defaults. One default, everywhere.
 *   2. NO `nullLine` is ever emitted. The no-effect value comes from
 *      `ES_TYPES[esType].nullVal` and from nowhere else (116.md §24): PROP has
 *      none (no null line, no favours labels), AUC's is 0.5, everything else 0.
 *
 * Pure, framework-free ES module (no React, no DOM). Importable by the engine,
 * the frontend, the manuscript export and Node tests.
 */

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
 * The full figure configuration for one outcome pair.
 * `opts.defaultTitle` is the caller's own title when the reviewer set none —
 * `''` for surfaces that caption the figure outside the image.
 */
export function resolveForestFigure(project, pair, opts = {}) {
  const fl = figureLabelsFor(project, pair);
  const labels = forestFigureLabels(project, pair);
  return {
    title: clean(fl.title) || clean(opts.defaultTitle),
    esLabel: labels.esLabel,
    favLow: labels.favLow,
    favHigh: labels.favHigh,
  };
}

export default { resolveForestFigure, forestFigureLabels, figureLabelsFor, forestPairKey, EMPTY_FOREST_LABELS };
