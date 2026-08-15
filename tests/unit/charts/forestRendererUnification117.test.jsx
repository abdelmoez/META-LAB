/**
 * forestRendererUnification117.test.jsx — 117.md §J.11 / §K.7, closing 116.md §10.4.
 *
 * 116.md §22-§25 (D15) made `computeForestLayout` THE source of forest geometry and
 * migrated two of the four renderers onto it (the live React plot and the
 * publication string builder). Two were left drawing their own coordinates and were
 * recorded as a shipped limitation: the PUBLIC synthesis page's InteractiveForest
 * and the NMA tab's per-treatment mini forest. This file pins the third and fourth
 * migrations.
 *
 * WHAT IS PINNED:
 *
 *  1. THE BUG THIS CLOSES. Both renderers drew a dashed reference line at stored 0
 *     unconditionally. Stored 0 is logit 0 — 50% — for a single-arm PROPORTION,
 *     which has no no-effect value at all (ES_TYPES.PROP.nullVal === null), and it
 *     is 0.0 for AUC, whose no-effect value is 0.5 and whose statistic cannot even
 *     reach 0. After the rebase the ES_TYPES registry is the ONLY authority: PROP
 *     draws no line and no favours labels, AUC's line sits at 0.5, and 0 is not
 *     even inside an AUC figure's domain.
 *  2. Out-of-scale values get the conventional truncation ARROW (place().clamped),
 *     never a silent squash onto the frame.
 *  3. Ticks are measure-aware — clinical ratio ticks for OR/RR, percent ticks
 *     through logit for PROP — where both renderers previously drew no axis at all.
 *  4. ROW ORDER PARITY: the layout preserves the payload's / the network's own row
 *     order, so a published figure still reads in the order it was published in.
 *  5. The public renderer stays SELF-CONTAINED: no project-dependent configuration
 *     (`resolveForestFigure` and the persisted presentation record) reaches a
 *     frozen public snapshot, and a payload missing any field still renders.
 *  6. CANVAS PINS. Neither renderer had a test before this stage, so the numbers
 *     below are pinned DELIBERATELY for the first time, against the reference
 *     payloads in this file — they are the shared engine's output for the two local
 *     metric packs, and a change to either pack must be a deliberate re-pin.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import InteractiveForest, {
  adaptPublicOutcome, buildPublicForestLayout, formatPublicValue,
} from '../../../src/features/publicSynthesis/InteractiveForest.jsx';
import { NmaForest, buildNmaForestLayout, nmaEsType } from '../../../src/frontend/workspace/tabs/nmaTab.jsx';
import { measureScale, FOREST_METRICS } from '../../../src/research-engine/charts/forestLayout.js';
import { SUPPORTED_MEASURES } from '../../../src/research-engine/statistics/nma/index.js';
import { isLogScale } from '../../../src/research-engine/statistics/nma/contrasts.js';
import { readSource } from '../../helpers/readSource.js';

/* ── fixtures: FROZEN public payloads (the exact shape deriveMa publishes) ──── */

const OR_PAYLOAD = {
  outcome: 'Mortality', timepoint: '12mo', esType: 'OR', k: 2,
  es: -0.22, lo: -0.45, hi: 0.01, pval: 0.06, i2: 30, method: 'random',
  studies: [
    { label: 'Smith 2019', es: -0.3, lo: -0.6, hi: 0.0, weight: 55 },
    { label: 'Jones 2021', es: -0.1, lo: -0.5, hi: 0.3, weight: 45 },
  ],
};
/** A single-arm proportion: stored values are LOGITS, and there is no null. */
const PROP_PAYLOAD = {
  outcome: 'Prevalence', timepoint: '', esType: 'PROP', k: 3,
  es: -1.4, lo: -1.8, hi: -1.0, i2: 12, method: 'random',
  studies: [
    { label: 'A 2018', es: -1.5, lo: -2.0, hi: -1.0, weight: 33 },
    { label: 'B 2019', es: -1.1, lo: -1.6, hi: -0.6, weight: 34 },
    { label: 'C 2020', es: -2.0, lo: -2.5, hi: -1.5, weight: 33 },
  ],
};
/** AUC is pooled on the RAW 0-1 scale and its no-effect value is 0.5. */
const AUC_PAYLOAD = {
  outcome: 'Discrimination', timepoint: '', esType: 'AUC', k: 3,
  es: 0.81, lo: 0.76, hi: 0.86, method: 'random',
  studies: [
    { label: 'A 2018', es: 0.80, lo: 0.74, hi: 0.86, weight: 33 },
    { label: 'B 2019', es: 0.84, lo: 0.78, hi: 0.90, weight: 34 },
    { label: 'C 2020', es: 0.79, lo: 0.71, hi: 0.87, weight: 33 },
  ],
};
/** Two tight studies and one whose CI is three orders of magnitude wider. */
const WIDE_PAYLOAD = {
  outcome: 'Extreme', timepoint: '', esType: 'OR', k: 3,
  es: -0.2, lo: -0.4, hi: 0.0, method: 'random',
  studies: [
    { label: 'Tight A', es: -0.2, lo: -0.3, hi: -0.1, weight: 49 },
    { label: 'Tight B', es: -0.25, lo: -0.35, hi: -0.15, weight: 49 },
    { label: 'Huge C', es: 5, lo: -30, hi: 30, weight: 2 },
  ],
};

/* ── fixtures: NMA results (the shape runNetworkMetaAnalysis returns) ───────── */

const PREC = { decimals: 2, trailingZeros: true };
const nmaResult = (over = {}) => ({
  sm: 'OR', isLog: true, reference: 'Placebo',
  forest: [
    { t1: 'Placebo', t2: 'DrugA', est: -0.45, se: 0.23, lo: -0.90, hi: 0.00 },
    { t1: 'Placebo', t2: 'DrugB', est: -0.30, se: 0.26, lo: -0.80, hi: 0.20 },
    { t1: 'Placebo', t2: 'DrugC', est: -0.10, se: 0.30, lo: -0.69, hi: 0.49 },
  ],
  ...over,
});

const html = (el) => renderToStaticMarkup(el);
const publicHtml = (payload) => html(createElement(InteractiveForest, { outcome: payload }));
const nmaHtml = (result) => html(createElement(NmaForest, { result, prec: PREC }));
/** Occurrences of a substring — the SSR string is the only DOM this repo has. */
const count = (s, needle) => s.split(needle).length - 1;

/* ══════════ 1. the no-effect line comes from ES_TYPES, in BOTH renderers ══════ */

describe('117.md §J.11 — PROP has no no-effect value, so neither renderer draws one', () => {
  it('public: a PROP payload renders NO null line and NO favours labels', () => {
    const L = buildPublicForestLayout(PROP_PAYLOAD);
    expect(L.scale.hasNull).toBe(false);
    expect(L.nullLine.show).toBe(false);
    expect(L.nullLine.x).toBeNull();
    expect(L.favours.show).toBe(false);
    const markup = publicHtml(PROP_PAYLOAD);
    expect(markup).not.toContain('stroke-dasharray="3 3"');   // the null line's dash
    expect(markup).not.toContain('favours lower');
    expect(markup).not.toContain('favours higher');
  });

  it('public: the SAME renderer DOES draw one for a measure that has a null', () => {
    const L = buildPublicForestLayout(OR_PAYLOAD);
    expect(L.nullLine.show).toBe(true);
    expect(L.scale.nullStored).toBe(0);          // ln(1)
    expect(L.scale.nullDisplay).toBeCloseTo(1, 12);
    expect(publicHtml(OR_PAYLOAD)).toContain('stroke-dasharray="3 3"');
  });

  it('nma: a PROP measure renders NO null line and NO favours labels', () => {
    const { layout } = buildNmaForestLayout(nmaResult({ sm: 'PROP', isLog: false }), PREC);
    expect(layout.scale.hasNull).toBe(false);
    expect(layout.nullLine.show).toBe(false);
    expect(layout.favours.show).toBe(false);
    const markup = nmaHtml(nmaResult({ sm: 'PROP', isLog: false }));
    expect(markup).not.toContain('stroke-dasharray="4 3"');   // the null line's dash
    expect(markup).not.toContain('favours lower');
  });

  it('nma: the SAME renderer DOES draw one for OR', () => {
    const { layout } = buildNmaForestLayout(nmaResult(), PREC);
    expect(layout.nullLine.show).toBe(true);
    expect(nmaHtml(nmaResult())).toContain('stroke-dasharray="4 3"');
  });

  it('the null line is strictly INSIDE the plot band, never pinned to an edge', () => {
    // Every treatment on one side of the reference: the old min(lo,0)/max(hi,0)
    // domain put the reference line exactly ON the right-hand edge.
    const oneSided = nmaResult({
      forest: [
        { t1: 'Placebo', t2: 'DrugA', est: -0.90, lo: -1.30, hi: -0.50 },
        { t1: 'Placebo', t2: 'DrugB', est: -0.70, lo: -1.10, hi: -0.30 },
      ],
    });
    const { layout } = buildNmaForestLayout(oneSided, PREC);
    expect(layout.nullLine.x).toBeGreaterThan(layout.columns.xPlot);
    expect(layout.nullLine.x).toBeLessThan(layout.columns.xPlotEnd);
    const P = buildPublicForestLayout(OR_PAYLOAD);
    expect(P.nullLine.x).toBeGreaterThan(P.columns.xPlot);
    expect(P.nullLine.x).toBeLessThan(P.columns.xPlotEnd);
  });
});

describe('117.md §J.11 — AUC\'s no-effect value is 0.5, not 0', () => {
  it('public: the line sits at 0.5 and 0 is not even in the domain', () => {
    const L = buildPublicForestLayout(AUC_PAYLOAD);
    expect(L.scale.nullStored).toBe(0.5);
    expect(L.nullLine.show).toBe(true);
    expect(L.nullLine.clamped).toBe(0);
    expect(L.nullLine.x).toBeCloseTo(L.place(0.5).x, 10);
    const [minV, maxV] = L.domain;
    expect(minV).toBeLessThan(0.5);
    expect(maxV).toBeGreaterThan(0.5);
    // The pre-117 renderer drew "no effect" at 0 and dragged the frame down to it.
    expect(minV).toBeGreaterThan(0);
  });

  it('public: an AUC axis is labelled in AUC units, and 0.5 is a tick', () => {
    const L = buildPublicForestLayout(AUC_PAYLOAD);
    expect(L.ticks.map((t) => t.label)).toContain('0.5');
    expect(L.axisLabel).toBe('Effect size');
  });

  it('nma: an unmapped measure the ES_TYPES registry knows keeps ITS null', () => {
    // NMA does not offer AUC, but the fallback must not invent a null at 0 for a
    // measure the shared registry has an answer for.
    const { layout } = buildNmaForestLayout(nmaResult({ sm: 'AUC', isLog: false, forest: [
      { t1: 'A', t2: 'B', est: 0.78, lo: 0.70, hi: 0.86 },
    ] }), PREC);
    expect(layout.scale.nullStored).toBe(0.5);
    expect(layout.domain[0]).toBeGreaterThan(0);
  });
});

/* ══════════ 2. truncation arrows ══════════ */

describe('117.md §J.11 — out-of-scale values get an arrow, never a silent clamp', () => {
  it('public: the extreme row reports clamped ends and the markup grows 3 polygons', () => {
    const L = buildPublicForestLayout(WIDE_PAYLOAD);
    const huge = L.rows[2];
    expect(huge.nameFull).toBe('Huge C');
    expect(huge.lo.clamped).toBe(-1);
    expect(huge.hi.clamped).toBe(1);
    expect(huge.es.clamped).toBe(1);
    L.rows.slice(0, 2).forEach((r) => {
      expect(r.lo.clamped).toBe(0);
      expect(r.hi.clamped).toBe(0);
      expect(r.es.clamped).toBe(0);
    });
    // Baseline polygons: the pooled diamond + the two favours arrowheads.
    expect(count(publicHtml(OR_PAYLOAD), '<polygon')).toBe(3);
    // Plus one arrow per clamped CI end and a triangle for the off-scale estimate.
    expect(count(publicHtml(WIDE_PAYLOAD), '<polygon')).toBe(6);
  });

  it('nma: a treatment far off the network scale gets arrows (no other polygons exist)', () => {
    const extreme = nmaResult({
      forest: [
        { t1: 'Placebo', t2: 'DrugA', est: -0.45, lo: -0.60, hi: -0.30 },
        { t1: 'Placebo', t2: 'DrugB', est: -0.30, lo: -0.45, hi: -0.15 },
        { t1: 'Placebo', t2: 'DrugX', est: 6.0, lo: -25, hi: 30 },
      ],
    });
    const { layout } = buildNmaForestLayout(extreme, PREC);
    expect(layout.rows[2].lo.clamped).toBe(-1);
    expect(layout.rows[2].hi.clamped).toBe(1);
    // A network forest has no pooled diamond, so the domain has no anchors of its
    // own and every point estimate WIDENS the frame instead of falling off it.
    // Only the intervals can run past the clip factor — which is the whole reason
    // the arrow affordance is needed here.
    expect(layout.rows[2].es.clamped).toBe(0);
    expect(count(nmaHtml(nmaResult()), '<polygon')).toBe(0);
    expect(count(nmaHtml(extreme), '<polygon')).toBe(2);
  });
});

/* ══════════ 3. measure-aware ticks ══════════ */

describe('117.md §J.11 — measure-aware ticks replace "no axis at all"', () => {
  it('public: a proportion axis is labelled in PERCENT, placed through logit', () => {
    const L = buildPublicForestLayout(PROP_PAYLOAD);
    expect(L.ticks.length).toBeGreaterThanOrEqual(2);
    expect(L.ticks.map((t) => t.label)).toEqual(['10', '20', '30']);
    L.ticks.forEach((t) => {
      const pct = Number(t.label) / 100;
      expect(t.v).toBeCloseTo(Math.log(pct / (1 - pct)), 10);
    });
    expect(L.axisLabel).toBe('Proportion (%)');
  });

  it('public: a ratio axis carries clinical ratio labels at log positions', () => {
    const L = buildPublicForestLayout(WIDE_PAYLOAD);
    expect(L.ticks.map((t) => t.label)).toContain('1');
    L.ticks.forEach((t) => expect(t.v).toBeCloseTo(Math.log(Number(t.label)), 10));
    expect(L.axisLabel).toBe('Odds Ratio');
  });

  it('nma: the mini forest gets the same ratio ticks and a measure name', () => {
    const { layout } = buildNmaForestLayout(nmaResult(), PREC);
    expect(layout.ticks.length).toBeGreaterThanOrEqual(2);
    layout.ticks.forEach((t) => expect(t.v).toBeCloseTo(Math.log(Number(t.label)), 10));
    expect(layout.axisLabel).toBe('Odds Ratio');
    expect(nmaHtml(nmaResult())).toContain('Odds Ratio');
  });

  it('nma: MD stays linear and is named as a mean difference', () => {
    const { layout } = buildNmaForestLayout(nmaResult({ sm: 'MD', isLog: false }), PREC);
    expect(layout.scale.isLog).toBe(false);
    expect(layout.axisLabel).toBe('Mean Difference');
  });
});

/* ══════════ 4. row-order parity ══════════ */

describe('117.md §J.11 — row order is the payload / network order, unchanged', () => {
  it('public: rows follow the published studies[] order exactly', () => {
    const L = buildPublicForestLayout(PROP_PAYLOAD);
    expect(L.rows.map((r) => r.nameFull)).toEqual(PROP_PAYLOAD.studies.map((s) => s.label));
    expect(L.rows.map((r) => r.es.v)).toEqual(PROP_PAYLOAD.studies.map((s) => s.es));
  });

  it('nma: rows follow result.forest order and name the CONTRAST treatment', () => {
    const r = nmaResult();
    const { layout } = buildNmaForestLayout(r, PREC);
    expect(layout.rows.map((x) => x.nameFull)).toEqual(r.forest.map((f) => f.t2));
    expect(layout.rows.map((x) => x.es.v)).toEqual(r.forest.map((f) => f.est));
    const markup = nmaHtml(r);
    expect(markup.indexOf('DrugA')).toBeLessThan(markup.indexOf('DrugB'));
    expect(markup.indexOf('DrugB')).toBeLessThan(markup.indexOf('DrugC'));
  });

  it('values are RENDERED, never recomputed (116.md §124)', () => {
    const adapted = adaptPublicOutcome(OR_PAYLOAD);
    expect(adapted.studies.map((s) => [s._es, s._lo, s._hi]))
      .toEqual(OR_PAYLOAD.studies.map((s) => [s.es, s.lo, s.hi]));
    expect(adapted.random).toEqual({ es: OR_PAYLOAD.es, lo: OR_PAYLOAD.lo, hi: OR_PAYLOAD.hi });
    expect(adapted.fixed).toBeNull();
  });

  it('a fixed-effect snapshot puts its ONE diamond on the fixed model', () => {
    const adapted = adaptPublicOutcome({ ...OR_PAYLOAD, method: 'fixed' });
    expect(adapted.method).toBe('fixed');
    expect(adapted.fixed).toEqual({ es: OR_PAYLOAD.es, lo: OR_PAYLOAD.lo, hi: OR_PAYLOAD.hi });
    expect(adapted.random).toBeNull();
    const L = buildPublicForestLayout({ ...OR_PAYLOAD, method: 'fixed' });
    expect(L.diamonds.map((d) => d.key)).toEqual(['fixed']);
  });
});

/* ══════════ 5. frozen payloads: soft defaults, no project config ══════════ */

describe('117.md §J.11 — a FROZEN public payload renders whatever it is missing', () => {
  it('the renderer imports no project-dependent forest configuration', () => {
    const src = readSource(new URL('../../../src/features/publicSynthesis/InteractiveForest.jsx', import.meta.url));
    // The WHOLE import list: React plus the pure geometry engine, nothing else.
    // `forestFigureConfig` (resolveForestFigure / the persisted presentation
    // record) must never appear — a frozen snapshot cannot re-read live project
    // settings, and the workspace presentation controls are deliberately a
    // workspace feature.
    const imported = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imported).toEqual(['react', '../../research-engine/charts/forestLayout.js']);
    // and it states WHY, so the next reader does not "fix" the omission
    expect(src).toContain('do not reach public pages');
  });

  it('missing weights, method, k and esType still draw', () => {
    const bare = {
      outcome: 'Bare', studies: [
        { label: 'A', es: -0.3, lo: -0.6, hi: 0.0 },
        { label: 'B', es: -0.1, lo: -0.5, hi: 0.3 },
      ],
    };
    const L = buildPublicForestLayout(bare);
    expect(L).toBeTruthy();
    expect(L.rows).toHaveLength(2);
    expect(L.diamonds).toEqual([]);           // no pooled estimate published
    const markup = publicHtml(bare);
    expect(markup).toContain('Study');
    expect(markup).not.toContain('Weight');
    expect(markup).toContain('k = 2');        // falls back to the drawn row count
  });

  it('a MISSING bound is not silently read as 0 (which is where most nulls sit)', () => {
    const holes = {
      outcome: 'Holes', esType: 'OR', k: 2, method: 'random',
      studies: [
        { label: 'A', es: -0.3, lo: null, hi: '' },
        { label: 'B', es: -0.1, lo: -0.5, hi: 0.3 },
      ],
    };
    const adapted = adaptPublicOutcome(holes);
    expect(Number.isNaN(adapted.studies[0]._lo)).toBe(true);
    expect(Number.isNaN(adapted.studies[0]._hi)).toBe(true);
    const L = buildPublicForestLayout(holes);
    expect(L.rows[0].lo.off).toBe(true);
    expect(L.rows[0].hi.off).toBe(true);
    expect(L.rows[0].es.off).toBe(false);
    expect(() => publicHtml(holes)).not.toThrow();
  });

  it('a payload with no per-study rows falls back to an honest text summary', () => {
    const pooledOnly = { outcome: 'Pooled only', esType: 'OR', k: 4, es: -0.22, lo: -0.45, hi: 0.01 };
    expect(buildPublicForestLayout(pooledOnly)).toBeNull();
    const markup = publicHtml(pooledOnly);
    expect(markup).toContain('Pooled estimate');
    expect(markup).toContain('0.80');
    expect(markup).not.toContain('<svg');
  });

  it('an empty / absent outcome never throws', () => {
    expect(() => publicHtml(undefined)).not.toThrow();
    expect(() => publicHtml({})).not.toThrow();
    expect(publicHtml({})).toContain('No pooled result was published');
  });

  it('displayed values are back-transformed per measure, stored values untouched', () => {
    expect(formatPublicValue(0, measureScale('OR'))).toBe('1.00');
    expect(formatPublicValue(-0.22, measureScale('OR'))).toBe('0.80');
    expect(formatPublicValue(1.4, measureScale('MD'))).toBe('1.40');
    expect(formatPublicValue(-1.5, measureScale('PROP'))).toBe('18.2%');
    expect(formatPublicValue(0.81, measureScale('AUC'))).toBe('0.81');
    expect(formatPublicValue(null, measureScale('OR'))).toBe('—');
    expect(formatPublicValue('', measureScale('OR'))).toBe('—');
  });

  it('the honest analysis-scale note names the scale the payload was pooled on', () => {
    expect(publicHtml(OR_PAYLOAD)).toContain('analysis scale: log — displayed values back-transformed');
    expect(publicHtml(PROP_PAYLOAD)).toContain('analysis scale: logit — displayed values back-transformed to %');
    expect(publicHtml(AUC_PAYLOAD)).not.toContain('analysis scale');
  });
});

/* ══════════ 6. the NMA measure map ══════════ */

describe('117.md §J.11 — the NMA measure code maps onto the ES_TYPES registry', () => {
  it('every supported NMA measure agrees with the shared registry about log scale', () => {
    for (const sm of SUPPORTED_MEASURES) {
      expect(measureScale(nmaEsType(sm)).isLog, sm).toBe(isLogScale(sm));
    }
  });

  it("NMA's GENERIC is the LOG-scale generic effect (ES_TYPES.GENERIC is not)", () => {
    expect(nmaEsType('GENERIC')).toBe('GENERIC_LOG');
    expect(measureScale('GENERIC_LOG').isLog).toBe(true);
    expect(measureScale('GENERIC').isLog).toBe(false);   // the trap this map avoids
  });

  it('an unknown code degrades to the registry default rather than throwing', () => {
    expect(nmaEsType(undefined)).toBe('');
    const { layout } = buildNmaForestLayout(nmaResult({ sm: undefined }), PREC);
    expect(layout).toBeTruthy();
    expect(layout.scale.isLog).toBe(false);
  });

  it('a network with no contrasts renders an honest note, not an empty frame', () => {
    expect(buildNmaForestLayout({ sm: 'OR', reference: 'Placebo', forest: [] }, PREC).layout).toBeNull();
    const markup = nmaHtml({ sm: 'OR', reference: 'Placebo', forest: [] });
    expect(markup).toContain('No treatment contrasts to plot.');
    expect(markup).not.toContain('<svg');
  });
});

/* ══════════ 7. canvas pins (first-time, deliberate) ══════════ */

describe('117.md §J.11 — canvas geometry, pinned deliberately for the first time', () => {
  it('the public figure uses the shared live pack with a wider name column', () => {
    const L = buildPublicForestLayout(OR_PAYLOAD);
    expect(L.variant).toBe('live');
    expect(L.metrics.charW).toBe(FOREST_METRICS.live.charW);
    expect(L.metrics.plotW).toBe(FOREST_METRICS.live.plotW);   // 300, unchanged
    expect(L.metrics.nameW).toBe(190);                          // local override
    expect(L.metrics.ROW).toBe(30);
    expect(L.metrics.diamondH).toBe(9);
    expect(L.metrics.fontScale).toBe(1);
    // 12 (marginL) + 190 (name) + 300 (plot) + 10 (gap) + 128 (effect) + 16 (marginR)
    expect(L.W).toBe(656);
    expect(L.H).toBe(255);
    expect(L.showCounts).toBe(false);
    expect(L.showWeights).toBe(false);
    expect(L.showPI).toBe(false);
  });

  it('the effect column WIDENS for a raw-unit value instead of overprinting', () => {
    const narrow = buildPublicForestLayout(OR_PAYLOAD).columns.cEff;
    const wide = buildPublicForestLayout(WIDE_PAYLOAD).columns.cEff;
    expect(narrow).toBe(FOREST_METRICS.live.effW);
    expect(wide).toBeGreaterThan(narrow);
  });

  it('the NMA mini forest keeps its compact pack (no counts, no weights)', () => {
    const { layout } = buildNmaForestLayout(nmaResult(), PREC);
    expect(layout.metrics.nameW).toBe(140);
    expect(layout.metrics.plotW).toBe(260);
    expect(layout.metrics.ROW).toBe(26);
    expect(layout.W).toBe(566);
    expect(layout.showCounts).toBe(false);
    expect(layout.showWeights).toBe(false);
    const markup = nmaHtml(nmaResult());
    expect(markup).not.toContain('events / total');
    expect(markup).not.toContain('Weight');
  });

  it('no NaN or Infinity ever reaches a coordinate in either renderer', () => {
    const coords = (L) => {
      const out = [L.W, L.H, L.columns.xPlot, L.columns.xPlotEnd, L.rowsGeom.axisY];
      L.ticks.forEach((t) => out.push(t.x));
      L.rows.forEach((r) => out.push(r.y, r.markerY, r.es.x, r.lo.x, r.hi.x, r.size));
      L.diamonds.forEach((d) => out.push(d.es.x, d.lo.x, d.hi.x, d.y));
      if (L.nullLine.show) out.push(L.nullLine.x);
      return out;
    };
    [OR_PAYLOAD, PROP_PAYLOAD, AUC_PAYLOAD, WIDE_PAYLOAD].forEach((p) => {
      coords(buildPublicForestLayout(p)).forEach((n) => expect(Number.isFinite(n)).toBe(true));
    });
    ['OR', 'RR', 'RD', 'MD', 'GENERIC'].forEach((sm) => {
      const { layout } = buildNmaForestLayout(nmaResult({ sm, isLog: isLogScale(sm) }), PREC);
      coords(layout).forEach((n) => expect(Number.isFinite(n)).toBe(true));
    });
  });
});
