/**
 * forestExport116.test.js — 116.md §22, §24, §26, §32, §124 (decision D15).
 *
 * The adversarial-review pack for the forest work: five defects that survived the
 * D15 centralisation because a SURFACE kept its own opinion after the shared layout
 * engine landed. Each `it` below fails on the pre-fix tree.
 *
 *  1. §22 (c) — the live plot drew the PREDICTION INTERVAL as a bare dashed line and
 *     never looked at `place()`'s `clamped` flag, unlike its own study rows and unlike
 *     the publication builder. Because the layout deliberately keeps predInt OUT of the
 *     domain anchors, a clamped PI is the NORMAL case (a fuzz over random 3–10-study
 *     random-effects analyses clamps one end in most of them), so the on-screen bar
 *     ended flush against the frame as though the interval stopped there — the exact
 *     silent clamping this stage set out to remove, surviving for one element.
 *  2. §24 — two export call sites passed a raw stored-scale no-effect override. It is a
 *     no-op for every measure whose registry nullVal is 0 and a silent corruption for
 *     AUC (nullVal 0.5): the figure drew "no effect" at AUC = 0, a value outside the
 *     range of the statistic, and stretched the axis to −0.09…1.03 where the screen
 *     showed 0.45…0.98. ES_TYPES is the ONLY source of that value.
 *  3. §32 — three export call sites named the axis from ES_TYPES[esType].scale, the
 *     STORED-scale name, so the same figure said "Odds Ratio" on screen and
 *     "lnOR (back-transformed)" in the report / ZIP / Meta-Analysis download, and a
 *     percent axis was captioned with the transform it had been back-transformed out of.
 *  4. §22 — the "ES [95% CI]" cell was the one cell nothing bounded: a raw-unit mean
 *     difference was drawn straight over both weight columns at the same baseline.
 *  5. Byte-compat — a caller that supplies no value formatter keeps the historical
 *     fixed column geometry exactly.
 *
 * Pure geometry / builder assertions plus renderToStaticMarkup. No jsdom.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeForestLayout, approxTextWidth, FOREST_METRICS } from '../../../src/research-engine/charts/forestLayout.js';
import {
  resolveForestFigure, forestFigureLabels, figureLabelsFor,
} from '../../../src/research-engine/charts/forestFigureConfig.js';
import { buildPubForestSVG } from '../../../src/frontend/workspace/charts/svgBuilders.js';
import { ForestPlot } from '../../../src/frontend/workspace/charts/charts.jsx';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const row = (o) => ({
  id: o.id, author: o.author || 'Author', year: o.year || 2020,
  es: String(o.es), lo: String(o.lo), hi: String(o.hi),
});

/** A heterogeneous OR set (I² ≈ 80%): tight study CIs, a PI far wider than the frame. */
const heteroOr = () => [
  row({ id: 's1', author: 'Alpha', year: 2016, es: Math.log(0.55), lo: Math.log(0.35), hi: Math.log(0.86) }),
  row({ id: 's2', author: 'Bravo', year: 2017, es: Math.log(0.70), lo: Math.log(0.50), hi: Math.log(0.98) }),
  row({ id: 's3', author: 'Cizek', year: 2018, es: Math.log(1.30), lo: Math.log(0.95), hi: Math.log(1.78) }),
  row({ id: 's4', author: 'Delta', year: 2019, es: Math.log(0.90), lo: Math.log(0.65), hi: Math.log(1.25) }),
  row({ id: 's5', author: 'Echo', year: 2020, es: Math.log(1.60), lo: Math.log(1.10), hi: Math.log(2.33) }),
];

/** A four-study AUC / C-statistic meta-analysis — the ONLY measure with nullVal ≠ 0. */
const aucStudies = () => [
  row({ id: 'a1', es: 0.86, lo: 0.82, hi: 0.90 }),
  row({ id: 'a2', es: 0.88, lo: 0.84, hi: 0.92 }),
  row({ id: 'a3', es: 0.83, lo: 0.79, hi: 0.87 }),
  row({ id: 'a4', es: 0.90, lo: 0.86, hi: 0.94 }),
];

/** Raw-unit mean differences with four-digit magnitudes (platelet count, cost, …). */
const rawUnitMd = () => [
  row({ id: 'm1', es: -1234.5, lo: -2345.6, hi: -123.4 }),
  row({ id: 'm2', es: -1100.2, lo: -2200.3, hi: -100.1 }),
  row({ id: 'm3', es: -900.7, lo: -1800.9, hi: -50.2 }),
];

const propStudies = () => [
  row({ id: 'p1', es: -1.5, lo: -2.0, hi: -1.0 }),
  row({ id: 'p2', es: -1.1, lo: -1.6, hi: -0.6 }),
  row({ id: 'p3', es: -2.0, lo: -2.5, hi: -1.5 }),
];

const PREC = { decimals: 3, trailingZeros: true };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Every line of a source file that CONFIGURES a publication forest figure. */
const forestOptionLines = (src) => src.split('\n')
  .filter((l) => l.includes('buildPubForestSVG(') || l.includes('pubOpts='));

/* ── 1. §22 (c) — the prediction interval gets truncation arrows ───────────── */

describe('116.md §22 (c) — the live plot never clamps the prediction interval silently', () => {
  const result = runMeta(heteroOr(), 'random');
  const layout = () => computeForestLayout(result, { variant: 'live', esType: 'OR' });

  it('the fixture is the case that matters: the PI runs past BOTH frame edges while every study CI fits', () => {
    const L = layout();
    expect(L.pi).toBeTruthy();
    expect(L.pi.lo.clamped).toBe(-1);
    expect(L.pi.hi.clamped).toBe(1);
    // …and no study row is clamped, so any truncation arrow found below is the PI's.
    L.rows.forEach((r) => {
      expect(r.lo.clamped).toBe(0);
      expect(r.hi.clamped).toBe(0);
      expect(r.es.clamped).toBe(0);
    });
  });

  it('draws a truncation arrow at each clamped PI end (it used to draw a bare dashed line)', () => {
    const L = layout();
    const svg = renderToStaticMarkup(createElement(ForestPlot, {
      result, esType: 'OR', showCounts: true, showWeights: true, prec: PREC,
    }));
    const cy = L.pi.markerY;
    // endCap geometry: a left-pointing triangle at the left edge, right-pointing at the right.
    const loArrow = `${L.pi.lo.x},${cy} ${L.pi.lo.x + 7},${cy - 4} ${L.pi.lo.x + 7},${cy + 4}`;
    const hiArrow = `${L.pi.hi.x},${cy} ${L.pi.hi.x - 7},${cy - 4} ${L.pi.hi.x - 7},${cy + 4}`;
    expect(svg).toContain(`points="${loArrow}"`);
    expect(svg).toContain(`points="${hiArrow}"`);
  });

  it('an in-range PI still gets plain end caps, not arrows (no false truncation claim)', () => {
    // Homogeneous studies at k = 12 ⇒ τ² = 0 and a small t-quantile ⇒ the PI fits.
    const tight = runMeta(
      Array.from({ length: 12 }, (_, i) => row({ id: `h${i}`, es: -0.30, lo: -0.55, hi: -0.05 })),
      'random',
    );
    const L = computeForestLayout(tight, { variant: 'live', esType: 'OR' });
    expect(L.pi.lo.clamped).toBe(0);
    expect(L.pi.hi.clamped).toBe(0);
    const svg = renderToStaticMarkup(createElement(ForestPlot, { result: tight, esType: 'OR', prec: PREC }));
    expect(svg).not.toContain(`points="${L.pi.lo.x},${L.pi.markerY}`);
  });

  it('the publication builder and the live plot agree on the PI clamp flags (§32)', () => {
    const live = computeForestLayout(result, { variant: 'live', esType: 'OR' });
    const pub = computeForestLayout(result, { variant: 'pub', esType: 'OR' });
    expect([live.pi.lo.clamped, live.pi.hi.clamped]).toEqual([pub.pi.lo.clamped, pub.pi.hi.clamped]);
    // the publication figure draws its arrows as filled <path> triangles
    const built = buildPubForestSVG(result, { esType: 'OR', prec: PREC });
    expect((built.svg.match(/<path d="M[^"]*Z" fill="#555555"\/>/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ── 2. §24 — ES_TYPES is the only no-effect authority at every call site ──── */

describe('116.md §24 — the registry is the ONLY source of the no-effect value', () => {
  it('the shared resolver never emits a no-effect override', () => {
    const project = { analysisSettings: { figureLabels: { 'MACE|||': { esLabel: 'X', favLow: 'L', favHigh: 'R', title: 'T' } } } };
    const fig = resolveForestFigure(project, { key: 'MACE|||' });
    expect(Object.keys(fig).sort()).toEqual(['esLabel', 'favHigh', 'favLow', 'title']);
    expect('nullLine' in fig).toBe(false);
    expect('nullLine' in forestFigureLabels(project, { key: 'MACE|||' })).toBe(false);
  });

  it('no forest export call site passes a no-effect override any more', () => {
    [
      '../../../src/frontend/workspace/Workspace.jsx',
      '../../../src/frontend/workspace/tabs/analysisTabs.jsx',
    ].forEach((rel) => {
      forestOptionLines(read(rel)).forEach((line) => {
        expect(line).not.toMatch(/nullLine/);
      });
    });
  });

  it('AUC keeps its 0.5 null: the exported figure matches the screen, tick for tick', () => {
    const res = runMeta(aucStudies(), 'random');
    const opts = { esType: 'AUC', ...resolveForestFigure(null, null), prec: PREC };
    const exported = computeForestLayout(res, { variant: 'pub', ...opts });
    const screen = computeForestLayout(res, { variant: 'live', esType: 'AUC' });
    expect(exported.scale.nullStored).toBe(0.5);
    expect(exported.ticks.map((t) => t.label)).toEqual(screen.ticks.map((t) => t.label));
    expect(exported.domain[0]).toBeGreaterThan(0);          // 0 is NOT in an AUC frame
    expect(exported.ticks.map((t) => t.label)).toContain('0.5');
    expect(exported.ticks.map((t) => t.label)).not.toContain('0');
    // and the drawn line really sits at AUC 0.5
    const frac = (exported.nullLine.x - exported.columns.xPlot) / exported.columns.plotW;
    expect(exported.domain[0] + frac * (exported.domain[1] - exported.domain[0])).toBeCloseTo(0.5, 9);
  });

  it('PROP still gets no null line and no favours labels through the resolver', () => {
    const res = runMeta(propStudies(), 'random');
    const svg = buildPubForestSVG(res, { esType: 'PROP', ...resolveForestFigure(null, null), prec: PREC }).svg;
    expect(svg).not.toContain('favours');
    expect(svg).not.toMatch(/<line [^>]*stroke="#555555" stroke-width="1"\/>/);
  });
});

/* ── 3. §32 — one axis name, every surface ────────────────────────────────── */

describe('116.md §32 — preview and export name the axis the same way', () => {
  it('an unset label resolves to "" (= auto), so the layout derives the one measure name', () => {
    expect(resolveForestFigure({}, { key: 'k' })).toEqual({ title: '', esLabel: '', favLow: '', favHigh: '' });
    expect(figureLabelsFor(null, null)).toEqual({});
    const res = runMeta(heteroOr(), 'random');
    const auto = computeForestLayout(res, { esType: 'OR', ...resolveForestFigure({}, { key: 'k' }) });
    expect(auto.axisLabel).toBe('Odds Ratio');
  });

  it('no forest export call site builds the axis name from the STORED scale', () => {
    [
      '../../../src/frontend/workspace/Workspace.jsx',
      '../../../src/frontend/workspace/tabs/analysisTabs.jsx',
    ].forEach((rel) => {
      read(rel).split('\n').forEach((line) => {
        expect(line).not.toMatch(/esLabel\s*[:=][^\n]*\bscale\b/);
      });
    });
  });

  it('a ratio export is captioned "Odds Ratio", never the stored-scale name', () => {
    const res = runMeta(heteroOr(), 'random');
    const svg = buildPubForestSVG(res, { esType: 'OR', ...resolveForestFigure(null, null), prec: PREC }).svg;
    expect(svg).toContain('>Odds Ratio<');
    expect(svg).not.toContain('lnOR');
    expect(svg).not.toContain('back-transformed');
  });

  it('a proportion export is captioned "Proportion (%)", never "logit (%)"', () => {
    const res = runMeta(propStudies(), 'random');
    const svg = buildPubForestSVG(res, { esType: 'PROP', ...resolveForestFigure(null, null), prec: PREC }).svg;
    expect(svg).toContain('>Proportion (%)<');
    expect(svg).not.toContain('logit');
  });

  it('a persisted label still wins everywhere (the resolver forwards, it does not invent)', () => {
    const project = {
      analysisSettings: {
        figureLabels: { 'MACE|||30d': { esLabel: 'Odds ratio (adjusted)', favLow: 'Favours intervention', favHigh: 'Favours control', title: 'Primary outcome' } },
      },
    };
    const fig = resolveForestFigure(project, { key: 'MACE|||30d' }, { defaultTitle: 'ignored' });
    expect(fig).toEqual({
      title: 'Primary outcome', esLabel: 'Odds ratio (adjusted)',
      favLow: 'Favours intervention', favHigh: 'Favours control',
    });
    const svg = buildPubForestSVG(runMeta(heteroOr(), 'random'), { esType: 'OR', ...fig, prec: PREC }).svg;
    ['Odds ratio (adjusted)', 'Favours intervention', 'Favours control', 'Primary outcome'].forEach((s) => {
      expect(svg).toContain(s);
    });
  });

  it('the caller default title is used only when the reviewer set none', () => {
    expect(resolveForestFigure({}, { key: 'k' }, { defaultTitle: 'Mortality @ 30d' }).title).toBe('Mortality @ 30d');
  });
});

/* ── 4/5. §22 — the ES [95% CI] cell owns its column ──────────────────────── */

describe('116.md §22 — the effect column fits its own text', () => {
  const res = runMeta(rawUnitMd(), 'random');
  const fmt = (v) => (+v).toFixed(3);
  const cellW = (L, text) => approxTextWidth(text, L.metrics.cellSize, L.metrics.charW);

  it('a raw-unit mean difference no longer runs across the weight columns (live)', () => {
    const L = computeForestLayout(res, { variant: 'live', esType: 'MD', formatValue: fmt });
    expect(L.rows[0].esText).toBe('-1234.500 [-2345.600, -123.400]');
    // start-anchored at xEff: the widest cell must END before the first weight column
    [...L.rows.map((r) => r.esText), ...L.diamonds.map((d) => d.esText), L.pi ? L.pi.esText : '']
      .filter(Boolean)
      .forEach((text) => {
        expect(L.columns.xEff + cellW(L, text)).toBeLessThanOrEqual(L.columns.xW);
      });
  });

  it('and never reaches back across the plot band (publication, end-anchored)', () => {
    const L = computeForestLayout(res, { variant: 'pub', esType: 'MD', formatValue: fmt });
    [...L.rows.map((r) => r.esText), ...L.diamonds.map((d) => d.esText)]
      .filter(Boolean)
      .forEach((text) => {
        expect(L.columns.xEff + L.columns.cEff - cellW(L, text)).toBeGreaterThanOrEqual(L.columns.xEff);
      });
  });

  it('the values are never truncated — the COLUMN gives way, not the number', () => {
    const L = computeForestLayout(res, { variant: 'live', esType: 'MD', formatValue: fmt });
    L.rows.forEach((r) => {
      expect(r.esText).not.toContain('…');
      expect(r.esText).toContain(fmt(r.study._es));
      expect(r.esText).toContain(fmt(r.study._lo));
      expect(r.esText).toContain(fmt(r.study._hi));
    });
  });

  it('ordinary values keep the historical column width exactly (byte-compat)', () => {
    const or = runMeta(heteroOr(), 'random');
    ['live', 'pub'].forEach((variant) => {
      const L = computeForestLayout(or, { variant, esType: 'OR', formatValue: (v) => Math.exp(v).toFixed(3) });
      expect(L.columns.cEff).toBe(FOREST_METRICS[variant].effW);
    });
  });

  it('a caller that supplies no formatter gets the fixed geometry and no cell strings', () => {
    ['live', 'pub'].forEach((variant) => {
      const L = computeForestLayout(res, { variant, esType: 'MD' });
      expect(L.columns.cEff).toBe(FOREST_METRICS[variant].effW);
      expect(L.rows[0].esText).toBe('');
    });
  });

  it('the live plot prints exactly the string the layout measured', () => {
    const svg = renderToStaticMarkup(createElement(ForestPlot, {
      result: res, esType: 'MD', showCounts: false, showWeights: true, prec: PREC,
    }));
    const L = computeForestLayout(res, { variant: 'live', esType: 'MD', showCounts: false, formatValue: fmt });
    expect(svg).toContain(L.rows[0].esText);
  });
});
