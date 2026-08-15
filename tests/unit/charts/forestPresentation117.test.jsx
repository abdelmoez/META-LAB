/**
 * forestPresentation117.test.jsx — 117.md §23, §24, §25, §81.
 *
 * WHAT IS PINNED (forest presentation controls, persisted and override-safe):
 *
 *  1. §81 "saved preferences" — the column toggles are PERSISTED, not React state.
 *     Before this stage `showCounts`/`showWeights` were `useState(true)` on the
 *     Forest tab: a reviewer who hid the weight columns got them back on the next
 *     reload, and no export ever knew they had been hidden.
 *  2. §23/§24 — ONE resolved record drives EVERY forest surface. The D15 drift class
 *     is that a surface keeps its own opinion after the shared resolver lands, so the
 *     parity block below follows a single persisted field into the live plot, the
 *     HIDDEN dark render (the "Dark (screen)" download's source), the publication
 *     string builder and the manuscript figure options.
 *  3. §24 — the geometry overrides are BOUNDED, clamped by the same table at write
 *     AND at resolve, so no stored value can produce a canvas the renderers cannot
 *     lay out (and a hand-edited blob is clamped on the way out, not trusted).
 *  4. §25 — NO statistical value overrides. Any combination of presentation options
 *     leaves es/lo/hi and both weight columns bit-identical in the layout output.
 *     This is the "the user should not accidentally alter a meta-analysis result
 *     merely because they moved a label" invariant, asserted rather than asserted-in-prose.
 *  5. Byte-stability — a project that never opened the panel serialises identically,
 *     and "Reset to defaults" deletes the entry (and the container) again.
 *  6. 108.md §6 rails — every control is one undoable op with a human-readable label,
 *     and the executor's read/apply/expect surface round-trips.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveForestFigure, resolveForestPresentation, normalizeFigurePresentation,
  clampForestMetric, clampForestMetrics, FOREST_PRESENTATION_BOUNDS, FOREST_METRIC_NAMES,
  FIGURE_PRESENTATION_KEYS, EMPTY_FOREST_FIGURE,
} from '../../../src/research-engine/charts/forestFigureConfig.js';
import {
  computeForestLayout, FOREST_METRICS, mergeForestMetrics, applyForestFontScale,
} from '../../../src/research-engine/charts/forestLayout.js';
import { buildPubForestSVG } from '../../../src/frontend/workspace/charts/svgBuilders.js';
import { ForestPlot } from '../../../src/frontend/workspace/charts/charts.jsx';
import {
  ForestTab, PlotOptionsPanel, PlotSizeInput,
  writeFigurePresentation, writeFigureLabels, applyAnalysisConfig, readAnalysisConfig,
  analysisConfigLabel, ANALYSIS_CONFIG_TARGETS, FIGURE_PRESENTATION_LABELS,
} from '../../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { renameOutcome, outcomePairKey } from '../../../src/research-engine/project-model/renameOutcome.js';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const OUTCOME = 'Mortality';
const KEY = `${OUTCOME}|||`;

/** Rows WITH events/totals, so the counts columns are genuinely available. */
const study = (o = {}) => ({
  id: o.id || 's1', author: o.author || 'Smith', year: o.year || '2020',
  outcome: OUTCOME, timepoint: '', esType: 'OR',
  es: String(o.es), lo: String(o.lo), hi: String(o.hi),
  a: o.a, b: o.b, c: o.c, d: o.d,
  design: 'rct', adjusted: 'unadjusted', dataNature: 'primary', source: 'reported',
});
const STUDIES = [
  study({ id: 's1', es: -0.36, lo: -0.60, hi: -0.12, a: '12', b: '88', c: '20', d: '80' }),
  study({ id: 's2', author: 'Lee', es: -0.22, lo: -0.50, hi: 0.06, a: '15', b: '85', c: '18', d: '82' }),
  study({ id: 's3', author: 'Brown', es: -0.30, lo: -0.55, hi: -0.05, a: '10', b: '90', c: '14', d: '86' }),
];
const proj = (figureRecord) => ({
  id: 'p1', name: 'Review', studies: STUDIES,
  ...(figureRecord ? { analysisSettings: { figureLabels: { [KEY]: figureRecord } } } : {}),
});
const noop = () => {};
const RESULT = runMeta(STUDIES, 'random');
const forestTabHtml = (p) => renderToStaticMarkup(createElement(ForestTab, { project: p, updateProject: noop }));

/* ════════════ 1. §81 — the toggles are persisted, not component state ════════════ */

describe('117.md §81 — column visibility is a SAVED preference', () => {
  it('absence reads as ON for all three columns (a pre-117 project is unchanged)', () => {
    const fig = resolveForestFigure(proj(null), { key: KEY });
    expect([fig.showCounts, fig.showWeights, fig.showPI]).toEqual([true, true, true]);
  });

  it('a persisted `false` survives a reload — it is read from the project, not from useState', () => {
    const fig = resolveForestFigure(proj({ showWeights: false }), { key: KEY });
    expect(fig.showWeights).toBe(false);
    expect(fig.showCounts).toBe(true);
  });

  it('the Forest tab renders the persisted choice (the weight columns are gone)', () => {
    expect(forestTabHtml(proj(null))).toContain('Weight');
    expect(forestTabHtml(proj({ showWeights: false }))).not.toContain('Weight');
  });

  it('the Forest tab honours a persisted events/total choice', () => {
    expect(forestTabHtml(proj(null))).toContain('events / total');
    expect(forestTabHtml(proj({ showCounts: false }))).not.toContain('events / total');
  });

  it('the Forest tab honours a persisted prediction-interval choice', () => {
    expect(forestTabHtml(proj(null))).toContain('Prediction interval');
    expect(forestTabHtml(proj({ showPI: false }))).not.toContain('Prediction interval');
  });

  it('the tab no longer keeps a second, ephemeral copy of the toggles (no duplicated state)', async () => {
    const { readSource } = await import('../../helpers/readSource.js');
    const src = readSource('src/frontend/workspace/tabs/analysisTabs.jsx');
    expect(src).not.toMatch(/useState\(true\)\s*;\s*\n\s*const\s*\[\s*showWeights/);
    expect(src).not.toContain('setShowCounts');
    expect(src).not.toContain('setShowWeights');
  });
});

/* ════════════ 2. §23/§24 — ONE record reaches EVERY surface (the D15 drift class) ════════════ */

describe('117.md §23/§24 — a persisted presentation field reaches every forest surface', () => {
  const RECORD = {
    subtitle: 'Intention-to-treat population',
    note: 'Two trials reported adjudicated events only.',
    showWeights: false,
    decimals: 2,
    metrics: { plotW: 420, fontScale: 1.2 },
  };
  const p = proj(RECORD);
  const figure = resolveForestFigure(p, { key: KEY }, { defaultTitle: 'Review — Mortality' });

  it('the resolver carries all of it, and never a no-effect override or a value', () => {
    expect(figure.subtitle).toBe(RECORD.subtitle);
    expect(figure.note).toBe(RECORD.note);
    expect(figure.showWeights).toBe(false);
    expect(figure.decimals).toBe(2);
    expect(figure.metrics).toEqual({ plotW: 420, fontScale: 1.2 });
    expect('nullLine' in figure).toBe(false);
  });

  it('the LIVE plot draws it', () => {
    const html = renderToStaticMarkup(createElement(ForestPlot, { result: RESULT, ...figure, esType: 'OR', live: true }));
    expect(html).toContain(RECORD.subtitle);
    expect(html).toContain(RECORD.note);
    expect(html).not.toContain('Weight');
  });

  it('the HIDDEN dark render draws it too — the "Dark (screen)" download is the same figure', () => {
    const html = forestTabHtml(p);
    const dark = html.slice(html.indexOf('id="forestplot-svg"'));
    expect(dark).toContain(RECORD.subtitle);
    expect(dark).toContain(RECORD.note);
    // …and BOTH renders are present and configured (the live one comes first).
    expect(html).toContain('id="forestplot-live"');
    expect(html.indexOf('id="forestplot-live"')).toBeLessThan(html.indexOf('id="forestplot-svg"'));
  });

  it('the PUBLICATION string builder draws it', () => {
    const svg = buildPubForestSVG(RESULT, { esType: 'OR', ...figure }).svg;
    expect(svg).toContain(RECORD.subtitle);
    expect(svg).toContain('adjudicated events only');
    expect(svg).not.toContain('>Weight<');
  });

  it('the per-figure decimals override the project setting on the figure only', () => {
    const projectPrec = { decimals: 4, trailingZeros: true };
    const four = buildPubForestSVG(RESULT, { esType: 'OR', ...resolveForestFigure(proj(null), { key: KEY }), prec: projectPrec }).svg;
    const two = buildPubForestSVG(RESULT, { esType: 'OR', ...figure, prec: projectPrec }).svg;
    expect(four).toContain('0.6977');
    expect(two).not.toContain('0.6977');
    expect(two).toContain('0.70 [');
  });

  it('the bounded geometry actually moves the geometry (and only within bounds)', () => {
    const L = computeForestLayout(RESULT, { variant: 'pub', esType: 'OR', metrics: figure.metrics });
    const base = computeForestLayout(RESULT, { variant: 'pub', esType: 'OR' });
    expect(L.columns.plotW).toBe(420);
    expect(base.columns.plotW).toBe(FOREST_METRICS.pub.plotW);
    expect(L.metrics.fontScale).toBe(1.2);
    expect(L.metrics.nameSize).toBeCloseTo(FOREST_METRICS.pub.nameSize * 1.2, 6);
  });

  it('the export whitelist admits every key the resolver emits (nothing silently dropped)', async () => {
    const { FOREST_PRESENTATION_OPT_KEYS } = await import('../../../src/features/manuscript/export/figures.js');
    Object.keys(resolveForestPresentation(null, null)).forEach((k) => {
      expect(FOREST_PRESENTATION_OPT_KEYS).toContain(k);
    });
  });
});

/* ════════════ 3. §24 — bounds, clamped at write AND at resolve ════════════ */

describe('117.md §24 — bounded geometry, one table, clamped at both ends', () => {
  it('the bounds table mirrors the live metric pack (the two can never drift)', () => {
    FOREST_METRIC_NAMES.forEach((name) => {
      const b = FOREST_PRESENTATION_BOUNDS[name];
      expect(FOREST_METRICS.live[b.metric]).toBe(b.defaultLive);
      expect(b.min).toBeLessThan(b.max);
      expect(b.defaultLive).toBeGreaterThanOrEqual(b.min);
      expect(b.defaultLive).toBeLessThanOrEqual(b.max);
    });
  });

  it.each(FOREST_METRIC_NAMES)('%s clamps below the floor and above the ceiling', (name) => {
    const b = FOREST_PRESENTATION_BOUNDS[name];
    expect(clampForestMetric(name, b.min - 1000)).toBe(b.min);
    expect(clampForestMetric(name, b.max + 1000)).toBe(b.max);
    expect(clampForestMetric(name, b.min)).toBe(b.min);
  });

  it('rejects everything that is not a usable number', () => {
    ['', null, undefined, NaN, Infinity, 'wide', {}].forEach((v) => {
      expect(clampForestMetric('plotW', v)).toBeNull();
    });
    expect(clampForestMetric('notAControl', 10)).toBeNull();
    expect(clampForestMetrics({ notAControl: 10 })).toEqual({});
  });

  it('accepts the stored name AND the metric key it maps to', () => {
    expect(clampForestMetrics({ rowGap: 30 })).toEqual({ ROW: 30 });
    expect(clampForestMetrics({ ROW: 30 })).toEqual({ ROW: 30 });
  });

  it('a float slider never persists a 17-digit artefact', () => {
    expect(clampForestMetric('fontScale', 1.0500000000000003)).toBe(1.05);
  });

  it('WRITE clamps: an out-of-range value can never be stored', () => {
    const p = writeFigurePresentation(proj(null), KEY, { metrics: { plotW: 9999, rowGap: 1 } });
    expect(p.analysisSettings.figureLabels[KEY].metrics).toEqual({
      plotW: FOREST_PRESENTATION_BOUNDS.plotW.max,
      rowGap: FOREST_PRESENTATION_BOUNDS.rowGap.min,
    });
  });

  it('RESOLVE clamps too: a hand-edited blob is corrected on the way out, not trusted', () => {
    const fig = resolveForestFigure(proj({ metrics: { plotW: 5000, fontScale: 40 } }), { key: KEY });
    expect(fig.metrics).toEqual({
      plotW: FOREST_PRESENTATION_BOUNDS.plotW.max,
      fontScale: FOREST_PRESENTATION_BOUNDS.fontScale.max,
    });
  });

  it('and the LAYOUT clamps a third time — no caller can bypass the table', () => {
    const L = computeForestLayout(RESULT, { variant: 'live', esType: 'OR', metrics: { plotW: 5000 } });
    expect(L.columns.plotW).toBe(FOREST_PRESENTATION_BOUNDS.plotW.max);
    expect(Number.isFinite(L.W)).toBe(true);
    expect(Number.isFinite(L.H)).toBe(true);
  });

  it('engine-internal metric keys still pass through (the pack seam is not a reviewer control)', () => {
    const merged = mergeForestMetrics(FOREST_METRICS.live, { favMinPlotW: 400, plotW: 10 });
    expect(merged.favMinPlotW).toBe(400);
    expect(merged.plotW).toBe(FOREST_PRESENTATION_BOUNDS.plotW.min);
  });

  it('fontScale 1 returns the SAME metrics object (an unconfigured figure never re-computes)', () => {
    const pack = FOREST_METRICS.live;
    expect(applyForestFontScale(pack)).toBe(pack);
    expect(applyForestFontScale({ ...pack, fontScale: 1.5 })).not.toBe(pack);
  });

  it('per-figure decimals are clamped to the documented range; "cleared" is not zero', () => {
    expect(normalizeFigurePresentation({ decimals: 99 }).decimals).toBe(6);
    expect(normalizeFigurePresentation({ decimals: -3 }).decimals).toBe(0);
    expect(normalizeFigurePresentation({ decimals: '4' }).decimals).toBe(4);
    // Number(true) === 1, Number('') === 0, Number(null) === 0 — none of them is a choice.
    [true, false, '', '   ', null, undefined, {}, 'four'].forEach((v) => {
      expect(normalizeFigurePresentation({ decimals: v })).toBeNull();
    });
    expect(resolveForestFigure(proj({ decimals: '' }), { key: KEY }).decimals).toBeNull();
  });
});

/* ════════════ 4. §25 — presentation NEVER moves a statistical value ════════════ */

describe('117.md §25 — no presentation option can change an analysis value', () => {
  /** Every value a reader of the layout could mistake for an analysis result.
   *  The prediction-interval ROW is a visibility control (`showPI`), so it is
   *  compared only when the row is drawn — hiding a row is presentation, changing
   *  the number in it would not be. */
  const valuesOf = (L) => ({
    rows: L.rows.map((r) => [r.study._es, r.study._lo, r.study._hi, r.weightFixedPct, r.weightRandomPct]),
    pooled: L.diamonds.map((d) => [d.value.es, d.value.lo, d.value.hi]),
    ...(L.pi ? { pi: [L.pi.value.lo, L.pi.value.hi] } : {}),
    domainSpanIsFinite: Number.isFinite(L.domain[1] - L.domain[0]),
  });

  /* Every combination that the panel can produce, plus the extremes of every bound. */
  const OPTION_SETS = [
    {},
    { showCounts: false },
    { showWeights: false },
    { showPI: false },
    { showCounts: false, showWeights: false, showPI: false },
    { subtitle: 'A subtitle', note: 'A footer note' },
    { title: 'A title', esLabel: 'Custom axis', favLow: 'L', favHigh: 'R' },
    { decimals: 0 },
    { decimals: 6 },
    ...FOREST_METRIC_NAMES.flatMap((n) => [
      { metrics: { [n]: FOREST_PRESENTATION_BOUNDS[n].min } },
      { metrics: { [n]: FOREST_PRESENTATION_BOUNDS[n].max } },
    ]),
    { metrics: FOREST_METRIC_NAMES.reduce((a, n) => ({ ...a, [n]: FOREST_PRESENTATION_BOUNDS[n].max }), {}) },
  ];

  it.each(['live', 'pub'])('%s: es / lo / hi / both weights are identical under every option set', (variant) => {
    const baseline = valuesOf(computeForestLayout(RESULT, { variant, esType: 'OR' }));
    OPTION_SETS.forEach((opts) => {
      const L = computeForestLayout(RESULT, { variant, esType: 'OR', ...opts });
      expect(valuesOf(L)).toEqual(opts.showPI === false ? { ...baseline, pi: undefined } : baseline);
    });
  });

  it('the pooled diamonds and the domain scale-invariants are untouched too', () => {
    const base = computeForestLayout(RESULT, { variant: 'pub', esType: 'OR' });
    OPTION_SETS.forEach((opts) => {
      const L = computeForestLayout(RESULT, { variant: 'pub', esType: 'OR', ...opts });
      expect(L.domain).toEqual(base.domain);
      expect(L.ticks.map((t) => t.label)).toEqual(base.ticks.map((t) => t.label));
      expect(L.scale.nullStored).toBe(base.scale.nullStored);
      // the null still sits at the same FRACTION of the (possibly wider) plot band
      const frac = (L.nullLine.x - L.columns.xPlot) / L.columns.plotW;
      const baseFrac = (base.nullLine.x - base.columns.xPlot) / base.columns.plotW;
      expect(frac).toBeCloseTo(baseFrac, 9);
    });
  });

  it('the persisted record has no field that could carry a value in the first place', () => {
    const stored = normalizeFigurePresentation({
      showCounts: false, decimals: 2, metrics: { plotW: 400 },
      // a hand-edited blob trying to smuggle statistics in:
      es: 1.23, lo: 0.5, hi: 2.0, weight: 99, pooled: 0.4, tau2: 0.1, nullLine: 0,
    });
    expect(Object.keys(stored).sort()).toEqual(['decimals', 'metrics', 'showCounts']);
    expect(FIGURE_PRESENTATION_KEYS).toEqual(['showCounts', 'showWeights', 'showPI', 'decimals', 'metrics']);
  });

  it('and a smuggled field never survives the writer either', () => {
    const p = writeFigurePresentation(proj(null), KEY, { es: 5, nullLine: 0, showPI: false });
    expect(p.analysisSettings.figureLabels[KEY]).toEqual({ showPI: false });
  });
});

/* ════════════ 5. byte-stability + reset ════════════ */

describe('117.md §24 — byte-stability: default figures never grow a key', () => {
  const ser = (p) => JSON.stringify(p);

  it('a project that never opened the panel serialises identically', () => {
    const before = proj(null);
    const after = writeFigurePresentation(before, KEY, { showCounts: true, showWeights: true, showPI: true, decimals: null, metrics: {} });
    expect(ser(after)).toBe(ser(before));
    expect('analysisSettings' in after).toBe(false);
  });

  it('a defaults-only record is stored as ABSENCE (booleans only persist when false)', () => {
    expect(normalizeFigurePresentation({ showCounts: true, showWeights: true, showPI: true })).toBeNull();
    expect(normalizeFigurePresentation({})).toBeNull();
    expect(normalizeFigurePresentation(null)).toBeNull();
  });

  it('turning a column off and back on leaves the blob byte-identical again', () => {
    const before = proj(null);
    const off = writeFigurePresentation(before, KEY, { showWeights: false });
    expect(off.analysisSettings.figureLabels[KEY]).toEqual({ showWeights: false });
    const on = writeFigurePresentation(off, KEY, { showWeights: true });
    expect(ser(on)).toBe(ser(before));
  });

  it('"Reset to defaults" deletes the entry AND the container', () => {
    let p = proj(null);
    p = writeFigurePresentation(p, KEY, { showCounts: false, decimals: 2, metrics: { plotW: 400 } });
    expect(Object.keys(p.analysisSettings.figureLabels[KEY]).sort()).toEqual(['decimals', 'metrics', 'showCounts']);
    p = writeFigurePresentation(p, KEY, null);
    expect('analysisSettings' in p).toBe(false);
  });

  it('a reset keeps the figure LABELS — the two writers own disjoint keys', () => {
    let p = writeFigureLabels(proj(null), KEY, { title: 'Figure 2', note: 'Adjudicated' });
    p = writeFigurePresentation(p, KEY, { showPI: false, metrics: { rowGap: 30 } });
    expect(p.analysisSettings.figureLabels[KEY]).toEqual({
      title: 'Figure 2', note: 'Adjudicated', showPI: false, metrics: { rowGap: 30 },
    });
    p = writeFigurePresentation(p, KEY, null);
    expect(p.analysisSettings.figureLabels[KEY]).toEqual({ title: 'Figure 2', note: 'Adjudicated' });
    // …and clearing the labels afterwards empties the container completely
    p = writeFigureLabels(p, KEY, { title: '', note: '' });
    expect('analysisSettings' in p).toBe(false);
  });

  it('the presentation writer never touches studies[] or any other setting', () => {
    const p = { ...proj(null), analysisSettings: { tau2Method: 'REML' } };
    const next = writeFigurePresentation(p, KEY, { showCounts: false });
    expect(next.studies).toBe(p.studies);
    expect(next.analysisSettings.tau2Method).toBe('REML');
  });
});

/* ════════════ 6. 108.md §6 rails — undo / redo ════════════ */

describe('117.md §24 + 108.md §6 — every plot option is one undoable op', () => {
  const addr = (field) => ({ target: ANALYSIS_CONFIG_TARGETS.FIGURE_PRESENTATION, outcomeKey: KEY, field });

  it('read → apply → read round-trips, and ABSENCE restores as absence', () => {
    const base = proj(null);
    expect(readAnalysisConfig(base, addr('showPI'))).toBeNull();
    const set = applyAnalysisConfig(base, { ...addr('showPI'), value: { showPI: false } });
    expect(readAnalysisConfig(set, addr('showPI'))).toEqual({ showPI: false });
    const undone = applyAnalysisConfig(set, { ...addr('showPI'), value: null });
    expect(readAnalysisConfig(undone, addr('showPI'))).toBeNull();
    expect(JSON.stringify(undone)).toBe(JSON.stringify(base));
  });

  it('the whole record is the op value, so a reset is ONE step, not N', () => {
    const set = applyAnalysisConfig(proj(null), {
      ...addr('reset'),
      value: { showCounts: false, showWeights: false, decimals: 3, metrics: { plotW: 400, rowGap: 30 } },
    });
    expect(readAnalysisConfig(set, addr('reset'))).toEqual({
      showCounts: false, showWeights: false, decimals: 3, metrics: { plotW: 400, rowGap: 30 },
    });
    expect(JSON.stringify(applyAnalysisConfig(set, { ...addr('reset'), value: null })))
      .toBe(JSON.stringify(proj(null)));
  });

  it('an out-of-range value cannot enter through the undo rails either', () => {
    const set = applyAnalysisConfig(proj(null), { ...addr('plotW'), value: { metrics: { plotW: 1e9 } } });
    expect(set.analysisSettings.figureLabels[KEY].metrics.plotW).toBe(FOREST_PRESENTATION_BOUNDS.plotW.max);
  });

  it('every control has human-readable undo wording', () => {
    ['showCounts', 'showWeights', 'showPI', 'decimals', ...FOREST_METRIC_NAMES, 'reset'].forEach((field) => {
      const label = analysisConfigLabel(addr(field));
      expect(FIGURE_PRESENTATION_LABELS[field]).toBeTruthy();
      expect(label).toBe(FIGURE_PRESENTATION_LABELS[field]);
      expect(label).not.toMatch(/^(undefined|null)/);
    });
    expect(analysisConfigLabel(addr(''))).toBe('Plot options change');
  });
});

/* ════════════ 7. §27 (116) — the rename carries the new fields ════════════ */

describe('117.md §24 + 116.md §27 — an outcome rename carries the presentation across', () => {
  const OLD = 'Mortalty';
  const NEW = 'Mortality';
  const renameFixture = () => {
    let p = {
      id: 'p1', name: 'Review',
      studies: [{ ...study({ id: 's1', es: -0.3, lo: -0.6, hi: -0.05 }), outcome: OLD, timepoint: '30 d' }],
    };
    p = writeFigureLabels(p, outcomePairKey(OLD, '30 d'), { title: 'Primary figure', subtitle: 'ITT', note: 'Adjudicated' });
    p = writeFigurePresentation(p, outcomePairKey(OLD, '30 d'), {
      showWeights: false, decimals: 2, metrics: { plotW: 400, fontScale: 1.1 },
    });
    return p;
  };

  it('the whole record — labels AND presentation — moves to the new pair key', () => {
    const { project: p } = renameOutcome(renameFixture(), OLD, NEW);
    const entry = p.analysisSettings.figureLabels[outcomePairKey(NEW, '30 d')];
    expect(entry).toEqual({
      title: 'Primary figure', subtitle: 'ITT', note: 'Adjudicated',
      showWeights: false, decimals: 2, metrics: { plotW: 400, fontScale: 1.1 },
    });
    expect(outcomePairKey(OLD, '30 d') in p.analysisSettings.figureLabels).toBe(false);
  });

  it('and the resolver reads it back off the renamed pair unchanged', () => {
    const { project: p } = renameOutcome(renameFixture(), OLD, NEW);
    const fig = resolveForestFigure(p, { key: outcomePairKey(NEW, '30 d') });
    expect(fig.showWeights).toBe(false);
    expect(fig.decimals).toBe(2);
    expect(fig.subtitle).toBe('ITT');
    expect(fig.metrics).toEqual({ plotW: 400, fontScale: 1.1 });
  });
});

/* ════════════ 8. the panel itself ════════════ */

describe('117.md §24/§86 — the Plot options panel', () => {
  it('is an opt-in disclosure: the Forest tab shows the button, not the panel', () => {
    const html = forestTabHtml(proj(null));
    expect(html).toContain('⚙ Plot options');
    expect(html).not.toContain('PLOT OPTIONS — THIS FIGURE ONLY');
    // the label editor is still its own separate affordance (116.md §28)
    expect(html).toContain('✎ Edit labels');
  });

  it('a read-only shell (no updateProject) offers no controls at all', () => {
    const html = renderToStaticMarkup(createElement(ForestTab, { project: proj(null) }));
    expect(html).not.toContain('⚙ Plot options');
    expect(html).not.toContain('✎ Edit labels');
  });

  it('renders every control, grouped, with the §25 promise stated in the UI', () => {
    const html = renderToStaticMarkup(createElement(PlotOptionsPanel, { figure: EMPTY_FOREST_FIGURE, onChange: noop }));
    ['COLUMNS', 'PRECISION', 'SIZE', 'events/total', 'weights', 'prediction interval', 'Project default', 'Reset to defaults']
      .forEach((s) => expect(html).toContain(s));
    FOREST_METRIC_NAMES.forEach((n) => expect(html).toContain(FOREST_PRESENTATION_BOUNDS[n].label));
    expect(html).toContain('stay linked to the analysis engine and are never edited here');
  });

  it('reflects the persisted record rather than local state', () => {
    // `rowGap` is stored under its panel name but resolves to the metric key `ROW`;
    // a typo in that mapping would silently render an empty field, so pin both.
    const figure = resolveForestFigure(proj({ showWeights: false, decimals: 4, metrics: { plotW: 400, rowGap: 30 } }), { key: KEY });
    const html = renderToStaticMarkup(createElement(PlotOptionsPanel, { figure, onChange: noop }));
    expect(figure.metrics).toEqual({ plotW: 400, ROW: 30 });
    expect(html).toContain('value="400"');
    expect(html).toContain('value="30"');
    expect(html).toContain('<option value="4" selected="">4</option>');
    // exactly two of the three column checkboxes are checked (weights is off)
    expect((html.match(/checked=""/g) || []).length).toBe(2);
    expect(html).toMatch(/<input type="checkbox"[^>]*\/>weights/);
  });

  it('"Reset to defaults" is disabled while there is nothing to reset', () => {
    const clean = renderToStaticMarkup(createElement(PlotOptionsPanel, { figure: EMPTY_FOREST_FIGURE, onChange: noop }));
    expect(clean).toMatch(/disabled=""[^>]*>Reset to defaults|Reset to defaults/);
    expect(clean).toContain('disabled=""');
    const dirty = renderToStaticMarkup(createElement(PlotOptionsPanel, {
      figure: resolveForestFigure(proj({ showPI: false }), { key: KEY }), onChange: noop,
    }));
    expect(dirty).not.toContain('disabled=""');
  });

  it('each size input advertises its own bounds to the browser AND to a screen reader', () => {
    FOREST_METRIC_NAMES.forEach((name) => {
      const b = FOREST_PRESENTATION_BOUNDS[name];
      const html = renderToStaticMarkup(createElement(PlotSizeInput, { name, value: null, onCommit: noop }));
      expect(html).toContain(`min="${b.min}"`);
      expect(html).toContain(`max="${b.max}"`);
      expect(html).toContain(`step="${b.step}"`);
      expect(html).toContain(`aria-label="${b.label} (${b.min}–${b.max} ${b.unit})"`);
    });
  });
});
