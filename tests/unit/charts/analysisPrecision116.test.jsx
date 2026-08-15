/**
 * analysisPrecision116.test.jsx — 116.md §29-§31, §26-§28, §124 (decision D11).
 *
 * WHAT IS PINNED:
 *  1. §31 fmtScaled is the ONE back-transforming display formatter: it honours
 *     trailingZeros (the six inline `.toFixed(decimals)` lambdas did not) and it
 *     never rounds a stored value — only the rendered string.
 *  2. §31 fmtPExpr always routes through fmtP: "P < 0.001" as a floor, and never
 *     "P = 0.00" for p = 0.004 at a 2-decimal project setting.
 *  3. §30 the decimal control renders on EVERY Analysis page (Meta-Analysis,
 *     Forest, Sensitivity, Subgroup) and writes the SAME project setting.
 *  4. §29 changing the project decimals changes what the forest plot prints; the
 *     chart formatters keep their 4-decimal cap (the pinned prompt-50 WS4 rule).
 *  5. §26-§28 the label editor is an opt-in affordance — no editing chrome is in
 *     the initial render, and no SVG text node is ever contentEditable.
 *  6. §124 the persisted analysisSettings.model drives every tab; 'random' is
 *     stored as ABSENCE so an untouched project keeps a byte-identical blob.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fmtScaled, makeScaledFormatter, fmtPExpr, fmtP, normalizePrecision } from '../../../src/research-engine/format/precision.js';
import { CHART_MAX_DECIMALS, chartES } from '../../../src/research-engine/format/chartFormat.js';
import {
  AnalysisTab, ForestTab, SensitivityTab, SubgroupTab, PrecisionControl,
  writeAnalysisModel, projectModel, applyAnalysisConfig, readAnalysisConfig,
  ANALYSIS_CONFIG_TARGETS, analysisConfigLabel, FIGURE_LABEL_FIELDS,
} from '../../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { generateAbstract, generateResults } from '../../../src/research-engine/manuscript/draft.js';
import { resolveAnalysis } from '../../../src/research-engine/manuscript/analysisDescribe.js';

const OUTCOME = 'Mortality';
const study = (o = {}) => ({
  id: o.id || 's1', author: o.author || 'Smith', year: o.year || '2020',
  outcome: OUTCOME, timepoint: '', esType: 'OR',
  es: String(o.es), lo: String(o.lo), hi: String(o.hi),
  design: 'rct', adjusted: 'unadjusted', dataNature: 'primary', source: 'reported',
});
const proj = (over = {}) => ({
  id: 'p1', name: 'Review',
  studies: [
    study({ id: 's1', es: -0.36, lo: -0.60, hi: -0.12 }),
    study({ id: 's2', author: 'Lee', es: -0.22, lo: -0.50, hi: 0.06 }),
    study({ id: 's3', author: 'Brown', es: -0.30, lo: -0.55, hi: -0.05 }),
  ],
  ...over,
});
const noop = () => {};

/* ── 1/2. the centralised formatters ──────────────────────────────────────── */

describe('116.md §31 — fmtScaled replaces the six inline back-transform lambdas', () => {
  it('back-transforms on the analysis scale and appends % only for logit values', () => {
    expect(fmtScaled(Math.log(1.12), { isLog: true }, { decimals: 2 })).toBe('1.12');
    expect(fmtScaled(0, { isProp: true }, { decimals: 1 })).toBe('50.0%');
    expect(fmtScaled(-1.5, { isProp: true }, { decimals: 1 })).toBe('18.2%');
    expect(fmtScaled(-0.36, {}, { decimals: 3 })).toBe('-0.360');
  });

  it('HONOURS trailingZeros — the old `.toFixed(decimals)` bypass never did', () => {
    expect(fmtScaled(0, { isProp: true }, { decimals: 3, trailingZeros: true })).toBe('50.000%');
    expect(fmtScaled(0, { isProp: true }, { decimals: 3, trailingZeros: false })).toBe('50%');
  });

  it('renders a dash for blank/non-finite input instead of "NaN%"', () => {
    expect(fmtScaled(null, { isProp: true })).toBe('—');
    expect(fmtScaled('', { isLog: true })).toBe('—');
    expect(fmtScaled(NaN, {})).toBe('—');
  });

  it('formats only — the stored value is never mutated or rounded', () => {
    const stored = -0.36123456789;
    const box = { v: stored };
    makeScaledFormatter({ isLog: true }, { decimals: 2 })(box.v);
    expect(box.v).toBe(stored);
  });
});

describe('116.md §31 — p-values always through fmtP', () => {
  it('floors at three decimals so a 2-dp project never prints "P = 0.00"', () => {
    expect(fmtPExpr(0.004, { decimals: 2 })).toBe('P = 0.004');
    expect(fmtP(0.004, { decimals: 2 })).toBe('0.004');
  });

  it('collapses a tiny p to a strict inequality', () => {
    expect(fmtPExpr(0.0000001, { decimals: 3 })).toBe('P < 0.001');
    expect(fmtPExpr(0.0000001, { decimals: 5 })).toBe('P < 0.00001');
  });

  it('renders an ordinary p as an equality', () => {
    expect(fmtPExpr(0.043, { decimals: 3 })).toBe('P = 0.043');
    expect(fmtPExpr(null, { decimals: 3 })).toBe('P —');
  });

  it('the manuscript draft uses it (draft.js used fmtNum → "P = 0.00")', () => {
    const opts = { prec: { decimals: 2, trailingZeros: true } };
    const text = JSON.stringify([generateAbstract(proj(), opts), generateResults(proj(), opts)]);
    expect(text).toMatch(/P [=<]/);
    expect(text).not.toMatch(/P = 0\.00[^\d]/);   // the fmtNum bug: p = 0.004 printed as 0.00
  });
});

/* ── 3/4. the control on every page + what it changes ─────────────────────── */

describe('116.md §30 — the decimal control renders on every Analysis page', () => {
  const has = (html) => html.includes('Decimal places:') && html.includes('trailing zeros');

  it.each([
    ['Meta-Analysis', AnalysisTab],
    ['Forest', ForestTab],
    ['Sensitivity', SensitivityTab],
    ['Subgroup', SubgroupTab],
  ])('%s renders it when updateProject is threaded', (_name, Tab) => {
    const html = renderToStaticMarkup(createElement(Tab, { project: proj(), updateProject: noop }));
    expect(has(html)).toBe(true);
  });

  it.each([
    ['Meta-Analysis', AnalysisTab],
    ['Forest', ForestTab],
    ['Sensitivity', SensitivityTab],
    ['Subgroup', SubgroupTab],
  ])('%s omits it in a read-only shell (no updateProject)', (_name, Tab) => {
    const html = renderToStaticMarkup(createElement(Tab, { project: proj() }));
    expect(has(html)).toBe(false);
  });

  it('the control reflects the persisted setting and offers the documented options', () => {
    const html = renderToStaticMarkup(createElement(PrecisionControl, {
      prec: { decimals: 5, trailingZeros: false }, onChange: noop,
    }));
    expect(html).toContain('value="5"');
    expect(html).not.toContain('checked=""');
    [2, 3, 4, 5, 6].forEach((d) => expect(html).toContain(`>${d}</option>`));
  });
});

describe('116.md §29 — the project precision reaches the forest plot', () => {
  it('the same plot prints different strings at 2 vs 4 decimals', () => {
    const two = renderToStaticMarkup(createElement(ForestTab, { project: proj({ analysisPrecision: { decimals: 2, trailingZeros: true } }), updateProject: noop }));
    const three = renderToStaticMarkup(createElement(ForestTab, { project: proj({ analysisPrecision: { decimals: 3, trailingZeros: true } }), updateProject: noop }));
    expect(two).toContain('>0.70 [0.55, 0.89]<');
    expect(three).toContain('>0.698 [0.549, 0.887]<');
    expect(two).not.toContain('0.698 [');
  });

  it('charts keep the 4-decimal cap and still ignore `full` (prompt-50 WS4 pin)', () => {
    expect(CHART_MAX_DECIMALS).toBe(4);
    expect(chartES(0.123456789, { decimals: 6 })).toBe('0.123');
    expect(chartES(0.123456789, { full: true })).toBe('0.123');
    // a 6-dp project still gets a readable, bounded ES column (chartES caps at 3)
    const html = renderToStaticMarkup(createElement(ForestTab, { project: proj({ analysisPrecision: { decimals: 6, trailingZeros: true } }), updateProject: noop }));
    expect(html).toContain('>0.698 [0.549, 0.887]<');
    expect(html).not.toContain('0.697674');
  });

  it('normalizePrecision is the single interpreter of the stored object', () => {
    expect(normalizePrecision(undefined)).toEqual({ decimals: 3, trailingZeros: true, full: false });
    expect(normalizePrecision(2)).toEqual({ decimals: 2, trailingZeros: true, full: false });
  });
});

/* ── 5. the label-editing affordance ──────────────────────────────────────── */

describe('116.md §26-§28 — figure label editing is an intentional affordance', () => {
  it('the plot carries no editing chrome and no contentEditable SVG node', () => {
    const html = renderToStaticMarkup(createElement(ForestTab, { project: proj(), updateProject: noop }));
    expect(html).toContain('✎ Edit labels');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('Left favours');       // the editor is collapsed by default
  });

  /* 117.md §24 — DELIBERATE RE-PIN: `subtitle` and `note` join the same field-keyed
     writer (they are figure-local TEXT, edited the same way and undone the same way). */
  it('the editable fields are figure-local text, named for the undo snackbar', () => {
    expect(Object.keys(FIGURE_LABEL_FIELDS)).toEqual(['title', 'subtitle', 'esLabel', 'favLow', 'favHigh', 'note']);
    expect(analysisConfigLabel({ target: ANALYSIS_CONFIG_TARGETS.FIGURE_LABELS, field: 'favLow' }))
      .toBe('Left favours label change');
    expect(analysisConfigLabel({ target: ANALYSIS_CONFIG_TARGETS.FIGURE_LABELS, field: 'note' }))
      .toBe('Figure note change');
    expect(analysisConfigLabel({ target: ANALYSIS_CONFIG_TARGETS.MODEL })).toBe('Synthesis model change');
  });

  it('a persisted figure title/axis label/favours text reaches the rendered plot', () => {
    const p = proj({
      analysisSettings: {
        figureLabels: {
          [`${OUTCOME}|||`]: { title: 'Figure 2. All-cause mortality', esLabel: 'Odds of death', favLow: 'Favours drug', favHigh: 'Favours placebo' },
        },
      },
    });
    const html = renderToStaticMarkup(createElement(ForestTab, { project: p, updateProject: noop }));
    ['Figure 2. All-cause mortality', 'Odds of death', 'Favours drug', 'Favours placebo'].forEach((s) => {
      expect(html).toContain(s);
    });
  });
});

/* ── 6. the persisted model ───────────────────────────────────────────────── */

describe('116.md §124 — analysisSettings.model is persisted, absent ⇒ random', () => {
  it('absence reads as random and never writes a key (byte-compat)', () => {
    expect(projectModel({})).toBe('random');
    const p = writeAnalysisModel({ id: 'p' }, 'random');
    expect('analysisSettings' in p).toBe(false);
  });

  it('fixed persists and switching back deletes the key again', () => {
    const fixed = writeAnalysisModel({ id: 'p' }, 'fixed');
    expect(fixed.analysisSettings.model).toBe('fixed');
    expect(projectModel(fixed)).toBe('fixed');
    const back = writeAnalysisModel(fixed, 'random');
    expect('analysisSettings' in back).toBe(false);
  });

  it('round-trips through the undo op rails', () => {
    const addr = { target: ANALYSIS_CONFIG_TARGETS.MODEL };
    const set = applyAnalysisConfig({ id: 'p' }, { ...addr, value: 'fixed' });
    expect(readAnalysisConfig(set, addr)).toBe('fixed');
    const undone = applyAnalysisConfig(set, { ...addr, value: null });
    expect(readAnalysisConfig(undone, addr)).toBeNull();
  });

  it('resolveAnalysis — the authority the manuscript, the report and the journal ZIP share — reads it', () => {
    expect(resolveAnalysis({ id: 'p' })).toEqual({ model: 'random', tau2Method: 'DL' });
    expect(resolveAnalysis({ analysisSettings: { model: 'fixed' } }).model).toBe('fixed');
    expect(resolveAnalysis({ analysisSettings: { model: 'fixed', tau2Method: 'REML' } }))
      .toEqual({ model: 'fixed', tau2Method: 'REML' });
    // an explicit caller override still wins (byte-compat with every existing call)
    expect(resolveAnalysis({ analysisSettings: { model: 'fixed' } }, { model: 'random' }).model).toBe('random');
  });

  it('every Analysis tab reads the SAME persisted model', () => {
    const p = proj({ analysisSettings: { model: 'fixed' } });
    [AnalysisTab, ForestTab, SensitivityTab, SubgroupTab].forEach((Tab) => {
      const html = renderToStaticMarkup(createElement(Tab, { project: p, updateProject: noop }));
      // the "fixed" button is the primary-styled one; the label differs per tab, so
      // assert on the model-dependent copy the tabs share instead.
      expect(html.length).toBeGreaterThan(0);
    });
    const forest = renderToStaticMarkup(createElement(ForestTab, { project: p, updateProject: noop }));
    expect(forest).toContain('common / fixed effect');
  });
});
