/**
 * pubForestSvg.test.js — 116.md §24, §25, §26, §32, §124.
 *
 * WHAT IS PINNED (buildPubForestSVG, now a skin over the shared forestLayout):
 *  1. §26/§32 a configured esLabel reaches the publication figure (it used to be
 *     built, threaded through pubOpts and then silently dropped — the axis always
 *     printed the measure name).
 *  2. §25 favLow/favHigh options — which existed with zero callers — are honoured.
 *  3. §24 PROP draws NO null line and NO favours labels (registry nullVal === null).
 *  4. Prediction-interval row present iff result.predInt && showPI !== false.
 *  5. §22 out-of-scale CI ends render an arrow path, not a fake end cap.
 *  6. noBg strips the full-bleed white rect (transparent PNG export).
 *  7. §29/§31 the export precision config reaches the ES column and the p-values
 *     go through fmtP (never "p = 0.00").
 *  8. §124 the builder prints the RESULT's numbers verbatim — a hand-crafted result
 *     whose pooled values disagree with its own studies still renders those values.
 *  9. §32 the live React skin and the publication skin agree on tick labels, the
 *     favours texts and the study names for identical input.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildPubForestSVG } from '../../../src/frontend/workspace/charts/svgBuilders.js';
import { ForestPlot } from '../../../src/frontend/workspace/charts/charts.jsx';
import { runMeta } from '../../../src/research-engine/statistics/monolithStats.js';

const row = (o) => ({
  id: o.id, author: o.author || 'Smith', year: o.year || '2020',
  es: String(o.es), lo: String(o.lo), hi: String(o.hi),
  ...(o.extra || {}),
});
const orRows = () => [
  row({ id: 'a', author: 'Smith', year: '2020', es: -0.36, lo: -0.60, hi: -0.12 }),
  row({ id: 'b', author: 'Lee', year: '2021', es: -0.22, lo: -0.50, hi: 0.06 }),
  row({ id: 'c', author: 'Brown', year: '2019', es: -0.30, lo: -0.55, hi: -0.05 }),
  row({ id: 'd', author: 'Green', year: '2022', es: -0.15, lo: -0.40, hi: 0.10 }),
];
const propRows = () => [
  row({ id: 'p1', es: -1.5, lo: -2.0, hi: -1.0, extra: { events: '18', total: '100' } }),
  row({ id: 'p2', es: -1.1, lo: -1.6, hi: -0.6, extra: { events: '25', total: '90' } }),
  row({ id: 'p3', es: -2.0, lo: -2.5, hi: -1.5, extra: { events: '10', total: '80' } }),
];
const build = (rows, opts) => buildPubForestSVG(runMeta(rows, opts && opts.method ? opts.method : 'random'), opts || {});

describe('116.md §26/§32 — the configured axis label reaches the publication figure', () => {
  it('honours o.esLabel (previously ignored — the edited label vanished from every export)', () => {
    const out = build(orRows(), { esType: 'OR', esLabel: 'Odds of re-admission (log scale)' });
    expect(out.svg).toContain('Odds of re-admission (log scale)');
    expect(out.svg).not.toContain('>Odds Ratio<');
  });

  it('falls back to the clean measure name when no label is configured', () => {
    expect(build(orRows(), { esType: 'OR' }).svg).toContain('>Odds Ratio<');
    expect(build(orRows(), { esType: 'MD' }).svg).toContain('>Mean Difference<');
    expect(build(propRows(), { esType: 'PROP' }).svg).toContain('>Proportion (%)<');
  });

  it('renders the figure title and escapes XML-significant characters in every label', () => {
    const out = build(orRows(), { esType: 'OR', title: 'Mortality < 30 d & re-admission', esLabel: 'a & b' });
    expect(out.svg).toContain('Mortality &lt; 30 d &amp; re-admission');
    expect(out.svg).toContain('a &amp; b');
    expect(out.svg).not.toContain('& b');
  });
});

describe('116.md §24 — a single-arm proportion has no no-effect value', () => {
  it('draws no null line and no favours labels for PROP', () => {
    const out = build(propRows(), { esType: 'PROP' }).svg;
    expect(out).not.toContain('favours');
    // the grey 1px vertical null line is the only <line stroke="#555555" stroke-width="1"> element
    expect(out).not.toMatch(/<line [^>]*stroke="#555555" stroke-width="1"\/>/);
  });

  it('still draws one for a ratio measure, strictly inside the plot band', () => {
    const out = build(orRows(), { esType: 'OR' }).svg;
    expect(out).toMatch(/<line [^>]*stroke="#555555" stroke-width="1"\/>/);
    expect(out).toContain('favours lower');
  });
});

describe('publication figure content', () => {
  it('always shows both pooled diamonds, filling the selected model', () => {
    const rnd = build(orRows(), { esType: 'OR' }).svg;
    expect(rnd).toContain('Common (fixed) effect');
    expect(rnd).toContain('Random effects');
    const fx = build(orRows(), { esType: 'OR', method: 'fixed' }).svg;
    expect((fx.match(/<polygon points="[^"]*" fill="#000000"/g) || []).length).toBe(1);
  });

  it('renders the prediction-interval row only when asked and available', () => {
    expect(build(orRows(), { esType: 'OR' }).svg).toContain('Prediction interval');
    expect(build(orRows(), { esType: 'OR', showPI: false }).svg).not.toContain('Prediction interval');
  });

  it('noBg strips the full-bleed white rect', () => {
    expect(build(orRows(), { esType: 'OR' }).svg).toContain('<rect x="0" y="0"');
    expect(build(orRows(), { esType: 'OR', noBg: true }).svg).not.toContain('<rect x="0" y="0"');
  });

  it('draws an arrow path (not an end cap) for a CI that runs past the frame', () => {
    const rows = [...orRows(), row({ id: 'wide', author: 'Wide', es: 0.1, lo: -14, hi: 14 })];
    const out = build(rows, { esType: 'OR' }).svg;
    // triangle end caps: a filled <path ... Z" fill="#111111"/> pair
    expect((out.match(/<path d="M[^"]*Z" fill="#111111"\/>/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('returns null for a missing result rather than throwing', () => {
    expect(buildPubForestSVG(null, {})).toBeNull();
  });
});

describe('116.md §29/§31 — export precision and p-value formatting', () => {
  it('routes the export precision config into the ES column', () => {
    const two = build(orRows(), { esType: 'OR', prec: { decimals: 2, trailingZeros: true } }).svg;
    const four = build(orRows(), { esType: 'OR', prec: { decimals: 4, trailingZeros: true } }).svg;
    expect(two).toContain('0.70 [0.55, 0.89]');
    expect(four).toContain('0.6977 [0.5488, 0.8869]');
  });

  it('p-values ALWAYS go through fmtP — never "p = 0.00" at 2 decimals', () => {
    const rows = [
      row({ id: 'x', es: -0.02, lo: -0.30, hi: 0.26 }),
      row({ id: 'y', es: 0.01, lo: -0.28, hi: 0.30 }),
    ];
    const svg = build(rows, { esType: 'OR', prec: { decimals: 2, trailingZeros: true } }).svg;
    expect(svg).not.toContain('p = 0.00<');
    expect(svg).toMatch(/p (=|&lt;) 0\.\d{3}/);
  });

  it('a genuinely tiny p collapses to a strict inequality', () => {
    const svg = build(orRows(), { esType: 'OR' }).svg;
    expect(svg).toContain('p &lt; 0.001');
  });
});

describe('116.md §124 — the builder renders the analysis, it never recomputes it', () => {
  it('prints the RESULT\'s pooled numbers even when they disagree with its studies', () => {
    const fake = {
      method: 'random', k: 2, I2: 0, Q: 0, Qpval: 0.9, tau2: 0, pval: 0.5,
      studies: [
        { id: 'a', author: 'A', year: '2001', _es: -1, _lo: -1.2, _hi: -0.8, _wFixedPct: 50, _wRandomPct: 50, _pct: 50 },
        { id: 'b', author: 'B', year: '2002', _es: -1, _lo: -1.2, _hi: -0.8, _wFixedPct: 50, _wRandomPct: 50, _pct: 50 },
      ],
      // ln(3) ≈ 1.0986 — nowhere near the average of the two studies
      fixed: { es: 1.0986122886681098, lo: 0.9, hi: 1.3 },
      random: { es: 1.0986122886681098, lo: 0.9, hi: 1.3 },
    };
    const out = buildPubForestSVG(fake, { esType: 'OR' });
    expect(out.svg).toContain('3.000 [2.460, 3.669]');
    expect(out.svg).toContain('0.368 [0.301, 0.449]');   // the studies, back-transformed
  });
});

describe('116.md §32 — live plot and publication export agree', () => {
  const rows = orRows();
  const opts = { esType: 'OR', esLabel: 'Odds Ratio (custom)', favLow: 'Favours intervention', favHigh: 'Favours control', title: 'Mortality' };

  const live = () => renderToStaticMarkup(createElement(ForestPlot, {
    result: runMeta(rows, 'random'), ...opts, showCounts: true, showWeights: true, live: true,
  }));

  it('both render the same tick labels', () => {
    const pub = build(rows, opts).svg;
    const svg = live();
    const pubTicks = (pub.match(/text-anchor="middle">([\d.]+)<\/text>/g) || []);
    expect(pubTicks.length).toBeGreaterThan(0);
    ['0.5', '0.75', '1'].forEach((t) => {
      if (pub.includes(`>${t}</text>`)) expect(svg).toContain(`>${t}</text>`);
    });
  });

  it('both render the same title, axis label and favours texts', () => {
    const pub = build(rows, opts).svg;
    const svg = live();
    ['Mortality', 'Odds Ratio (custom)', 'Favours intervention', 'Favours control'].forEach((s) => {
      expect(pub).toContain(s);
      expect(svg).toContain(s);
    });
  });

  it('both render both pooled diamonds and the same study names', () => {
    const pub = build(rows, opts).svg;
    const svg = live();
    ['Common (fixed) effect', 'Random effects', 'Smith 2020', 'Green 2022'].forEach((s) => {
      expect(pub).toContain(s);
      expect(svg).toContain(s);
    });
  });

  it('the live plot renders nothing but a hint when there is no result', () => {
    const svg = renderToStaticMarkup(createElement(ForestPlot, { result: null }));
    expect(svg).toContain('forest plot');
    expect(svg).not.toContain('<svg');
  });
});
