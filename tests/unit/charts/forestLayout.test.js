/**
 * forestLayout.test.js — 116.md §22-§25, §33 (decision D15).
 *
 * WHAT IS PINNED (the shared forest geometry engine, pure, no DOM):
 *  1. §24 the measure's no-effect value is ALWAYS inside the visible domain, with a
 *     margin, and its x is strictly between the plot edges — never clamped onto one.
 *  2. §24 PROP (ES_TYPES.PROP.nullVal === null) has NO null line and NO favours
 *     labels; every other measure resolves its null from the registry.
 *  3. §24 log-scale correctness: ratio ticks come from the clinical candidate set,
 *     sit at log(r) and are LABELLED in ratio units — geometry and labels pass
 *     through the same transform.
 *  4. §23/§33 no tick-label box overlaps across the whole test matrix (2 studies,
 *     50 studies, very narrow CI, very wide CI, estimate outside the scale, a
 *     150-char study name, subgroup subsets, a single study).
 *  5. §22 out-of-scale estimates/CI ends get an explicit `clamped` direction (the
 *     arrow affordance) instead of a silent clamp.
 *  6. §25 favours labels are edge-anchored under the two axis halves, on their own
 *     row below the tick labels, and can never meet in the middle.
 *  7. §32 the live and publication variants agree on every scale-invariant property.
 *  8. No NaN/Infinity ever reaches a coordinate.
 */
import { describe, it, expect } from 'vitest';
import {
  computeForestLayout, measureScale, buildDomain, buildTicks, decollideTicks,
  approxTextWidth, truncateLabel, countsFor, RATIO_TICK_CANDIDATES, RATIO_TICK_CANDIDATES_FINE,
} from '../../../src/research-engine/charts/forestLayout.js';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const row = (o = {}) => ({
  id: o.id || 'r1', author: o.author || 'Smith', year: o.year || '2020',
  es: String(o.es), lo: String(o.lo), hi: String(o.hi),
  ...(o.extra || {}),
});

/** k OR studies, all on the LEFT of the null (the case that used to pin the null line). */
function orStudies(k = 4) {
  return Array.from({ length: k }, (_, i) => row({
    id: `s${i}`, author: `Author${i}`, year: 2000 + i,
    es: -0.30 - i * 0.01, lo: -0.60 - i * 0.01, hi: -0.05 - i * 0.01,
  }));
}
const mdStudies = () => [
  row({ id: 'm1', es: -3, lo: -6, hi: 0 }),
  row({ id: 'm2', es: -1, lo: -5, hi: 3 }),
  row({ id: 'm3', es: -8, lo: -12, hi: -4 }),
];
const propStudies = () => [
  row({ id: 'p1', es: -1.5, lo: -2.0, hi: -1.0 }),
  row({ id: 'p2', es: -1.1, lo: -1.6, hi: -0.6 }),
  row({ id: 'p3', es: -2.0, lo: -2.5, hi: -1.5 }),
];

const layoutOf = (rows, esType, opts = {}) =>
  computeForestLayout(runMeta(rows, opts.method || 'random'), { esType, ...opts });

/** Every numeric coordinate the renderers read. */
function allCoords(L) {
  const out = [L.W, L.H, L.columns.xPlot, L.columns.xPlotEnd, L.rowsGeom.axisY, L.rowsGeom.H];
  L.ticks.forEach((t) => out.push(t.x, t.v));
  L.rows.forEach((r) => out.push(r.y, r.markerY, r.es.x, r.lo.x, r.hi.x, r.size));
  L.diamonds.forEach((d) => out.push(d.es.x, d.lo.x, d.hi.x, d.y));
  if (L.pi) out.push(L.pi.lo.x, L.pi.hi.x, L.pi.y);
  if (L.nullLine.show) out.push(L.nullLine.x);
  return out;
}

/** Tick label boxes, left→right, as [x0,x1] pairs at the variant's own metrics. */
function tickBoxes(L) {
  return L.ticks.map((t) => {
    const w = approxTextWidth(t.label, L.metrics.tickSize, L.metrics.charW);
    return [t.x - w / 2, t.x + w / 2, t.label];
  });
}

/* ── 1/2. the no-effect value ─────────────────────────────────────────────── */

describe('116.md §24 — the no-effect value comes from the ES_TYPES registry', () => {
  it.each([
    ['OR', 0], ['RR', 0], ['HR', 0], ['PETO', 0], ['IRR', 0],
    ['MD', 0], ['SMD', 0], ['RD', 0], ['COR', 0], ['AUC', 0.5],
  ])('%s resolves a null at stored %s', (esType, nullStored) => {
    const s = measureScale(esType);
    expect(s.hasNull).toBe(true);
    expect(s.nullStored).toBe(nullStored);
  });

  it('PROP has NO no-effect value — a proportion is not "null" at 50%', () => {
    const s = measureScale('PROP');
    expect(s.hasNull).toBe(false);
    expect(s.nullStored).toBeNull();
  });

  it('ratio measures display their null as 1, difference measures as 0', () => {
    expect(measureScale('OR').nullDisplay).toBeCloseTo(1, 12);
    expect(measureScale('RR').nullDisplay).toBeCloseTo(1, 12);
    expect(measureScale('MD').nullDisplay).toBe(0);
    expect(measureScale('SMD').nullDisplay).toBe(0);
  });

  it('a raw nullLine override applies to LINEAR measures only (never to a ratio or a proportion)', () => {
    expect(measureScale('MD', { nullLine: 2 }).nullStored).toBe(2);
    expect(measureScale('OR', { nullLine: 2 }).nullStored).toBe(0);      // ln(1), always
    expect(measureScale('PROP', { nullLine: 2 }).hasNull).toBe(false);
  });
});

describe('116.md §22/§24 — the domain ALWAYS contains the null, never clamped to an edge', () => {
  it.each(['OR', 'RR', 'HR', 'MD', 'SMD'])('%s: every study on one side still frames the null', (esType) => {
    const L = layoutOf(orStudies(5), esType);
    const [minV, maxV] = L.domain;
    expect(L.scale.nullStored).toBeGreaterThan(minV);
    expect(L.scale.nullStored).toBeLessThan(maxV);
    expect(L.nullLine.show).toBe(true);
    expect(L.nullLine.clamped).toBe(0);
    // strictly INSIDE the plot band, not sitting on either edge
    expect(L.nullLine.x).toBeGreaterThan(L.columns.xPlot);
    expect(L.nullLine.x).toBeLessThan(L.columns.xPlotEnd);
  });

  it('PROP draws no null line and no favours labels', () => {
    const L = layoutOf(propStudies(), 'PROP');
    expect(L.nullLine.show).toBe(false);
    expect(L.favours.show).toBe(false);
  });

  it('buildDomain keeps a margin around the null even for a degenerate (zero-span) dataset', () => {
    const d = buildDomain({ points: [0.4, 0.4], intervals: [[0.4, 0.4]], nullStored: 0, hasNull: true });
    expect(d[0]).toBeLessThan(0);
    expect(d[1]).toBeGreaterThan(0.4);
  });
});

/* ── 3. log-scale tick correctness ────────────────────────────────────────── */

describe('116.md §24 — ticks, positions and labels all use the same scale transform', () => {
  it('ratio ticks are clinical candidates placed at log(r) and labelled in ratio units', () => {
    const L = layoutOf(orStudies(4), 'OR');
    expect(L.ticks.length).toBeGreaterThanOrEqual(2);
    L.ticks.forEach((t) => {
      const ratio = Number(t.label);
      expect([...RATIO_TICK_CANDIDATES, ...RATIO_TICK_CANDIDATES_FINE]).toContain(ratio);
      // the label is the back-transform of the position: exp(v) === ratio
      expect(Math.exp(t.v)).toBeCloseTo(ratio, 9);
      // and the position is the shared scale applied to the STORED value
      expect(t.x).toBeCloseTo(L.xRaw(Math.log(ratio)), 9);
    });
    expect(L.ticks.some((t) => t.label === '1' && t.isNull)).toBe(true);
  });

  it('the ratio axis never emits the old uniform-log mush (0.61 / 1.65 / 2.72)', () => {
    const L = layoutOf([
      row({ id: 'a', es: -0.5, lo: -1.2, hi: 0.2 }),
      row({ id: 'b', es: 0.7, lo: 0.1, hi: 1.3 }),
      row({ id: 'c', es: 0.2, lo: -0.4, hi: 0.8 }),
    ], 'OR');
    const labels = L.ticks.map((t) => t.label);
    ['0.61', '1.65', '2.72', '4.48'].forEach((bad) => expect(labels).not.toContain(bad));
  });

  it('linear measures get a 1-2-5 nice step, not a fixed 0.5 stored-unit loop', () => {
    const L = layoutOf(mdStudies(), 'MD');
    const vs = L.ticks.map((t) => t.v).sort((a, b) => a - b);
    const steps = vs.slice(1).map((v, i) => v - vs[i]);
    steps.forEach((s) => expect(s).toBeCloseTo(steps[0], 6));
    const mantissa = steps[0] / Math.pow(10, Math.floor(Math.log10(steps[0])));
    expect([1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-9)).toBe(true);
  });

  it('proportion ticks are percentages placed through the logit transform', () => {
    const L = layoutOf(propStudies(), 'PROP');
    expect(L.ticks.length).toBeGreaterThanOrEqual(2);
    L.ticks.forEach((t) => {
      const pct = Number(t.label);
      const p = pct / 100;
      expect(t.v).toBeCloseTo(Math.log(p / (1 - p)), 9);
    });
  });

  it('ticks are monotonic and inside the plot band for every measure', () => {
    ['OR', 'RR', 'HR', 'MD', 'SMD', 'COR'].forEach((esType) => {
      const L = layoutOf(orStudies(4), esType);
      const xs = L.ticks.map((t) => t.x);
      xs.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(xs[i]));
      xs.forEach((x) => {
        expect(x).toBeGreaterThanOrEqual(L.columns.xPlot - 1e-6);
        expect(x).toBeLessThanOrEqual(L.columns.xPlotEnd + 1e-6);
      });
    });
  });

  it('decollideTicks protects the null tick by REPLACING its crowded neighbour', () => {
    const ticks = [
      { v: 0, x: 100, label: '0.9', isNull: false },
      { v: 1, x: 104, label: '1', isNull: true },
      { v: 2, x: 300, label: '2', isNull: false },
    ];
    const kept = decollideTicks(ticks, 10, 0.6, 8);
    expect(kept.map((t) => t.label)).toEqual(['1', '2']);
  });
});

/* ── 4. the §33 matrix: no overlapping labels, no bad coordinates ─────────── */

describe('116.md §33 — the layout stays coherent across the whole matrix', () => {
  const NAME_150 = 'A'.repeat(150);
  const cases = [
    ['2 studies (OR)', orStudies(2), 'OR', {}],
    ['50 studies (OR)', orStudies(50), 'OR', {}],
    ['very narrow CIs', [row({ id: 'n1', es: 0.001, lo: 0.0005, hi: 0.0015 }), row({ id: 'n2', es: 0.0012, lo: 0.0008, hi: 0.0016 })], 'OR', {}],
    ['extremely wide CIs', [row({ id: 'w1', es: 0.2, lo: -8, hi: 8 }), row({ id: 'w2', es: -0.1, lo: -6, hi: 6 })], 'OR', {}],
    ['estimate outside the visible scale', [
      row({ id: 'o1', es: -0.3, lo: -0.6, hi: 0 }), row({ id: 'o2', es: -0.2, lo: -0.5, hi: 0.1 }),
      row({ id: 'o3', es: 9, lo: 8.5, hi: 9.5 }),
    ], 'OR', {}],
    ['150-character study name', orStudies(3).map((s, i) => (i === 0 ? { ...s, author: NAME_150 } : s)), 'OR', {}],
    ['MD (linear, raw units)', mdStudies(), 'MD', {}],
    ['SMD fixed-effect', orStudies(4), 'SMD', { method: 'fixed' }],
    ['PROP (logit)', propStudies(), 'PROP', {}],
    ['no counts, no weights', orStudies(3), 'OR', { showCounts: false, showWeights: false }],
    ['zero-event style rows (raw counts present)', [
      { ...row({ id: 'z1', es: -0.3, lo: -0.9, hi: 0.3 }), a: '0', b: '40', c: '5', d: '35' },
      { ...row({ id: 'z2', es: -0.1, lo: -0.7, hi: 0.5 }), a: '2', b: '38', c: '4', d: '36' },
    ], 'OR', {}],
  ];

  it.each(cases)('%s — live and pub both produce finite, ordered, non-overlapping geometry', (_name, rows, esType, opts) => {
    ['live', 'pub'].forEach((variant) => {
      const L = layoutOf(rows, esType, { ...opts, variant });
      expect(L).toBeTruthy();
      allCoords(L).forEach((n) => expect(Number.isFinite(n)).toBe(true));
      // tick label boxes never overlap
      const boxes = tickBoxes(L);
      boxes.slice(1).forEach((b, i) => expect(b[0]).toBeGreaterThanOrEqual(boxes[i][1] - 1e-9));
      // rows stay inside the study band and are evenly pitched
      L.rows.forEach((r, i) => {
        expect(r.y).toBeGreaterThan(L.rowsGeom.rowsTop);
        expect(r.y).toBeLessThan(L.rowsGeom.bandBottom + L.rowsGeom.ROW);
        if (i > 0) expect(r.y - L.rows[i - 1].y).toBeCloseTo(L.rowsGeom.ROW, 9);
      });
      // the study-name column can never bleed into the next column
      L.rows.forEach((r) => {
        expect(approxTextWidth(r.name, L.metrics.nameSize, L.metrics.charW))
          .toBeLessThanOrEqual(L.metrics.nameW);
      });
      // the diamond band sits BELOW the last study row and ABOVE the axis (§22 C10)
      expect(L.diamonds[0].y).toBeGreaterThan(L.rows[L.rows.length - 1].y);
      expect(L.rowsGeom.axisY).toBeGreaterThan(L.diamonds[L.diamonds.length - 1].y);
      // tick labels, favours and the axis name each own a row, in that order
      expect(L.rowsGeom.tickLabelY).toBeGreaterThan(L.rowsGeom.axisY);
      expect(L.rowsGeom.favY).toBeGreaterThan(L.rowsGeom.tickLabelY);
      expect(L.rowsGeom.axisLabelY).toBeGreaterThan(L.rowsGeom.favY);
      expect(L.H).toBeGreaterThan(L.rowsGeom.axisLabelY);
    });
  });

  it('a single-study result still lays out (hand-built result — runMeta needs k≥2)', () => {
    const one = {
      method: 'random', k: 1,
      studies: [{ id: 'x', author: 'Solo', year: '2024', _es: -0.2, _lo: -0.5, _hi: 0.1, _wFixedPct: 100, _wRandomPct: 100, _pct: 100 }],
      fixed: { es: -0.2, lo: -0.5, hi: 0.1 }, random: { es: -0.2, lo: -0.5, hi: 0.1 },
    };
    const L = computeForestLayout(one, { esType: 'OR' });
    expect(L.k).toBe(1);
    allCoords(L).forEach((n) => expect(Number.isFinite(n)).toBe(true));
    expect(L.nullLine.show).toBe(true);
  });

  it('subgroup plots: each subgroup subset lays out independently and coherently', () => {
    const all = orStudies(9).map((s, i) => ({ ...s, design: ['rct', 'cohort', 'case-control'][i % 3] }));
    ['rct', 'cohort', 'case-control'].forEach((g) => {
      const L = layoutOf(all.filter((s) => s.design === g), 'OR');
      expect(L.k).toBe(3);
      expect(L.nullLine.x).toBeGreaterThan(L.columns.xPlot);
      expect(L.nullLine.x).toBeLessThan(L.columns.xPlotEnd);
      tickBoxes(L).slice(1).forEach((b, i) => expect(b[0]).toBeGreaterThanOrEqual(tickBoxes(L)[i][1] - 1e-9));
    });
  });

  it('returns null rather than throwing when there is nothing to draw', () => {
    expect(computeForestLayout(null, {})).toBeNull();
    expect(computeForestLayout({ studies: [] }, {})).toBeNull();
  });
});

/* ── 5. out-of-scale → arrows, never a silent clamp ───────────────────────── */

describe('116.md §22 — values outside the visible scale are flagged, not clamped silently', () => {
  const rows = [
    row({ id: 'a', es: -0.3, lo: -0.6, hi: 0 }),
    row({ id: 'b', es: -0.2, lo: -0.5, hi: 0.1 }),
    row({ id: 'c', es: 0.1, lo: -12, hi: 12 }),
  ];

  it('a CI that runs past the frame reports its direction on BOTH ends', () => {
    const L = layoutOf(rows, 'OR');
    const wide = L.rows[2];
    expect(wide.lo.clamped).toBe(-1);
    expect(wide.hi.clamped).toBe(1);
    expect(wide.lo.x).toBe(L.columns.xPlot);
    expect(wide.hi.x).toBe(L.columns.xPlotEnd);
    // …and the interval it reports is still the REAL one (rendering, not rewriting)
    expect(wide.lo.v).toBe(-12);
    expect(wide.hi.v).toBe(12);
  });

  it('an in-range CI is never flagged', () => {
    const L = layoutOf(rows, 'OR');
    expect(L.rows[0].lo.clamped).toBe(0);
    expect(L.rows[0].hi.clamped).toBe(0);
    expect(L.rows[0].es.clamped).toBe(0);
  });

  it('an estimate outside the scale is flagged too (arrow marker, not an edge square)', () => {
    const L = layoutOf([
      row({ id: 'a', es: -0.3, lo: -0.35, hi: -0.25 }),
      row({ id: 'b', es: -0.31, lo: -0.36, hi: -0.26 }),
      row({ id: 'c', es: 40, lo: 25, hi: 55 }),   // far out AND imprecise ⇒ tiny weight
    ], 'OR');
    expect(L.rows[2].es.clamped).toBe(1);
  });

  it('one pathological CI does not squash every other row into a pixel', () => {
    const L = layoutOf(rows, 'OR');
    const width = L.rows[0].hi.x - L.rows[0].lo.x;
    expect(width).toBeGreaterThan(L.columns.plotW * 0.05);
  });
});

/* ── 6. favours labels ────────────────────────────────────────────────────── */

describe('116.md §25 — favours labels', () => {
  it('are edge-anchored under the two axis halves and cannot meet in the middle', () => {
    const L = layoutOf(orStudies(4), 'OR');
    expect(L.favours.show).toBe(true);
    expect(L.favours.low.anchor).toBe('start');
    expect(L.favours.high.anchor).toBe('end');
    expect(L.favours.low.x).toBeGreaterThanOrEqual(L.columns.xPlot);
    expect(L.favours.high.x).toBeLessThanOrEqual(L.columns.xPlotEnd);
    const wLow = approxTextWidth(L.favours.low.text, L.metrics.favSize, L.metrics.charW);
    const wHigh = approxTextWidth(L.favours.high.text, L.metrics.favSize, L.metrics.charW);
    expect(L.favours.low.x + wLow).toBeLessThan(L.favours.high.x - wHigh);
  });

  it('sit on their own row BELOW the tick labels (they never overlap them)', () => {
    const L = layoutOf(orStudies(4), 'OR');
    expect(L.favours.y).toBeGreaterThan(L.rowsGeom.tickLabelY);
  });

  it('default to direction-only text and never infer a clinical direction', () => {
    const L = layoutOf(orStudies(4), 'OR');
    expect(L.favours.low.text).toBe('favours lower');
    expect(L.favours.high.text).toBe('favours higher');
  });

  it('use the configured contextual text when the figure supplies it', () => {
    const L = layoutOf(orStudies(4), 'OR', { favLow: 'Favours intervention', favHigh: 'Favours control' });
    expect(L.favours.low.text).toBe('Favours intervention');
    expect(L.favours.high.text).toBe('Favours control');
  });

  it('ellipsise an over-long configured label instead of letting it collide', () => {
    const L = layoutOf(orStudies(4), 'OR', { favLow: 'Favours '.repeat(20), favHigh: 'Favours control forever and ever and ever' });
    expect(approxTextWidth(L.favours.low.text, L.metrics.favSize, L.metrics.charW))
      .toBeLessThanOrEqual(L.favours.maxWidth + 1e-9);
    expect(L.favours.high.text.endsWith('…')).toBe(true);
  });

  it('are suppressed when the plot band is too narrow to hold two of them', () => {
    const L = layoutOf(orStudies(3), 'OR', { metrics: { plotW: 60 } });
    expect(L.favours.show).toBe(false);
  });
});

/* ── 7. live ↔ publication parity ─────────────────────────────────────────── */

describe('116.md §32 — the live plot and the publication figure share one layout', () => {
  const rows = orStudies(5);

  it('identical inputs give identical tick VALUES and labels in both variants', () => {
    const live = layoutOf(rows, 'OR', { variant: 'live' });
    const pub = layoutOf(rows, 'OR', { variant: 'pub' });
    expect(live.ticks.map((t) => t.label)).toEqual(pub.ticks.map((t) => t.label));
    expect(live.ticks.map((t) => +t.v.toFixed(12))).toEqual(pub.ticks.map((t) => +t.v.toFixed(12)));
    expect(live.domain.map((d) => +d.toFixed(12))).toEqual(pub.domain.map((d) => +d.toFixed(12)));
  });

  it('the null line sits at the same FRACTION of the plot band in both variants', () => {
    const live = layoutOf(rows, 'OR', { variant: 'live' });
    const pub = layoutOf(rows, 'OR', { variant: 'pub' });
    const frac = (L) => (L.nullLine.x - L.columns.xPlot) / L.columns.plotW;
    expect(frac(live)).toBeCloseTo(frac(pub), 9);
  });

  it('both variants agree on out-of-scale flags, counts strings and study names', () => {
    const odd = [...rows, row({ id: 'x', author: 'Wide', es: 0.1, lo: -20, hi: 20 })];
    const live = layoutOf(odd, 'OR', { variant: 'live' });
    const pub = layoutOf(odd, 'OR', { variant: 'pub' });
    expect(live.rows.map((r) => [r.lo.clamped, r.hi.clamped, r.es.clamped]))
      .toEqual(pub.rows.map((r) => [r.lo.clamped, r.hi.clamped, r.es.clamped]));
    expect(live.rows.map((r) => r.counts.exp)).toEqual(pub.rows.map((r) => r.counts.exp));
    expect(live.rows.map((r) => r.nameFull)).toEqual(pub.rows.map((r) => r.nameFull));
  });

  it('both variants show BOTH pooled diamonds, with the selected model filled', () => {
    ['live', 'pub'].forEach((variant) => {
      const L = layoutOf(rows, 'OR', { variant, method: 'fixed' });
      expect(L.diamonds.map((d) => d.key)).toEqual(['fixed', 'random']);
      expect(L.diamonds.find((d) => d.key === 'fixed').strong).toBe(true);
      expect(L.diamonds.find((d) => d.key === 'random').strong).toBe(false);
    });
  });
});

/* ── 8. §124 render-don't-recompute + shared helpers ──────────────────────── */

describe('116.md §124 — the layout renders the analysis, it never recomputes it', () => {
  it('marker area tracks the DISPLAYED model weight (_pct), not always the fixed weight', () => {
    const fake = {
      method: 'random', k: 2,
      studies: [
        { id: 'a', author: 'A', _es: 0, _lo: -1, _hi: 1, _wFixedPct: 90, _wRandomPct: 50, _pct: 50 },
        { id: 'b', author: 'B', _es: 0.1, _lo: -0.9, _hi: 1.1, _wFixedPct: 10, _wRandomPct: 50, _pct: 50 },
      ],
      fixed: { es: 0.01, lo: -0.5, hi: 0.5 }, random: { es: 0.05, lo: -0.6, hi: 0.7 },
    };
    const L = computeForestLayout(fake, { esType: 'OR' });
    expect(L.rows[0].size).toBeCloseTo(L.rows[1].size, 9);   // equal random weights ⇒ equal squares
  });

  it('uses the pooled values from the RESULT even when they disagree with the studies', () => {
    const fake = {
      method: 'random', k: 2,
      studies: [
        { id: 'a', author: 'A', _es: -1, _lo: -1.2, _hi: -0.8, _wFixedPct: 50, _wRandomPct: 50, _pct: 50 },
        { id: 'b', author: 'B', _es: -1, _lo: -1.2, _hi: -0.8, _wFixedPct: 50, _wRandomPct: 50, _pct: 50 },
      ],
      // deliberately NOT the average of the studies
      fixed: { es: 2, lo: 1.5, hi: 2.5 }, random: { es: 2, lo: 1.5, hi: 2.5 },
    };
    const L = computeForestLayout(fake, { esType: 'OR' });
    expect(L.diamonds[0].value.es).toBe(2);
    expect(L.diamonds[1].value.es).toBe(2);
    expect(L.domain[1]).toBeGreaterThan(2);   // the frame follows the RESULT's numbers
  });
});

describe('shared text/counts helpers', () => {
  it('truncateLabel appends an ellipsis only when it actually cut', () => {
    expect(truncateLabel('Smith 2020', 26)).toBe('Smith 2020');
    expect(truncateLabel('A'.repeat(40), 10)).toBe(`${'A'.repeat(9)}…`);
  });

  it('countsFor prints one events/total convention for both renderers', () => {
    expect(countsFor({ a: '10', b: '30', c: '5', d: '35' })).toMatchObject({ exp: '10 / 40', ctrl: '5 / 40' });
    expect(countsFor({ events: '7', total: '20' })).toMatchObject({ exp: '7 / 20', ctrl: '—' });
    expect(countsFor({})).toMatchObject({ exp: '—', ctrl: '—' });
  });

  it('buildTicks always yields at least two ticks for a usable domain', () => {
    const scale = measureScale('OR');
    const xS = (v) => v;
    expect(buildTicks(scale, [-0.02, 0.02], xS).length).toBeGreaterThanOrEqual(2);
    expect(buildTicks(measureScale('MD'), [-1e-4, 1e-4], xS).length).toBeGreaterThanOrEqual(2);
  });
});
