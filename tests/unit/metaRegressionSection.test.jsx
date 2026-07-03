/**
 * metaRegressionSection.test.jsx — P13 "Meta-Regression + bubble plots".
 *
 * SSR-safe smoke + contract tests (mirrors pecanSearchTab.test.jsx style):
 *  - the flag gate is a hard no-op (SSR render of MetaRegression is empty because
 *    the flag effect never runs → the Subgroup tab is unchanged when OFF);
 *  - covariate auto-detection (numeric → continuous, few strings → categorical,
 *    effect/identity columns blocked);
 *  - the presentational results block renders the coefficient table, the
 *    heterogeneity summary, guardrail warnings, and the ok:false path (warnings,
 *    no chart);
 *  - the bubble plot emits the expected SVG primitives (bubbles, band, axes);
 *  - nothing user-facing says "AI".
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MetaRegression, MetaRegressionResults, detectCovariates, detectRegressionMeasure, buildMetaRegNarrative,
} from '../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { BubblePlot, buildBubbleSVG, computeBubbleGeometry } from '../../src/frontend/workspace/BubblePlot.jsx';

const NO_AI = /\bAI\b|artificial intelligence/i;

const bubble = {
  points: [
    { x: 2000, y: 0.30, weight: 10, label: 'Alpha 2000', studyId: 'a' },
    { x: 2010, y: 0.10, weight: 20, label: 'Beta 2010', studyId: 'b' },
    { x: 2020, y: -0.10, weight: 15, label: 'Gamma 2020', studyId: 'c' },
  ],
  line: { slope: -0.02, intercept: 40, x0: 2000, x1: 2020 },
  band: [
    { x: 2000, lo: 0.20, hi: 0.50 },
    { x: 2010, lo: 0.00, hi: 0.25 },
    { x: 2020, lo: -0.25, hi: 0.05 },
  ],
};

const okResult = {
  ok: true, k: 12, kDropped: 1, model: 'random', method: 'MM',
  intercept: { coef: 0.12, se: 0.05, z: 2.4, pval: 0.016, ciLo: 0.02, ciHi: 0.22 },
  moderators: [{ name: 'Year', coef: -0.03, se: 0.01, z: -3.0, pval: 0.0027, ciLo: -0.05, ciHi: -0.01 }],
  tau2: 0.02, tau2Before: 0.05, tau2Reduction: 0.6, residual: { QE: 15.2, QEp: 0.12, df: 10 },
  R2: 0.62, I2resid: 35,
  bubble,
  warnings: [{ type: 'warning', message: 'Fewer than ten studies per covariate — treat as exploratory.' }],
  provenance: {},
};

describe('detectCovariates — auto type detection + blocklist', () => {
  const studies = [
    { id: '1', year: '2001', country: 'US', author: 'Smith', es: '0.2', esType: 'SMD', n: '100', design: 'RCT' },
    { id: '2', year: '2005', country: 'UK', author: 'Jones', es: '0.4', esType: 'SMD', n: '150', design: 'RCT' },
    { id: '3', year: '2010', country: 'US', author: 'Lee', es: '0.1', esType: 'SMD', n: '80', design: 'cohort' },
    { id: '4', year: '2015', country: 'DE', author: 'Kim', es: '0.5', esType: 'SMD', n: '200', design: 'cohort' },
  ];
  const byField = Object.fromEntries(detectCovariates(studies).map((c) => [c.field, c]));

  it('classifies numeric fields as continuous', () => {
    expect(byField.year && byField.year.type).toBe('continuous');
    expect(byField.n && byField.n.type).toBe('continuous');
  });
  it('classifies few-distinct string fields as categorical/binary', () => {
    expect(byField.country && byField.country.type).toBe('categorical'); // US/UK/DE
    expect(byField.design && byField.design.type).toBe('binary'); // RCT/cohort
  });
  it('blocks effect/identity columns (es, esType, id, author)', () => {
    expect(byField.es).toBeUndefined();
    expect(byField.esType).toBeUndefined();
    expect(byField.id).toBeUndefined();
    expect(byField.author).toBeUndefined();
  });
  it('returns nothing for empty input', () => {
    expect(detectCovariates([])).toEqual([]);
    expect(detectCovariates(null)).toEqual([]);
  });
});

describe('detectRegressionMeasure', () => {
  it('returns the dominant effect measure among studies with a numeric ES', () => {
    expect(detectRegressionMeasure([
      { es: '0.2', esType: 'OR' }, { es: '0.4', esType: 'OR' }, { es: '0.1', esType: 'RR' },
    ])).toBe('OR');
    expect(detectRegressionMeasure([])).toBe('');
  });
});

describe('MetaRegression — flag gate is a hard no-op in SSR', () => {
  it('renders nothing (flag effect never runs during static render → tab unchanged when OFF)', () => {
    const html = renderToStaticMarkup(createElement(MetaRegression, {
      project: { studies: [{ id: '1', year: '2001', es: '0.2', esType: 'SMD' }] },
    }));
    expect(html).toBe('');
  });
});

describe('MetaRegressionResults — ok:true render', () => {
  const html = renderToStaticMarkup(createElement(MetaRegressionResults, {
    result: okResult, measure: 'SMD', covLabel: 'Year', type: 'continuous', method: 'MM',
  }));
  it('renders the coefficient table with intercept + moderator', () => {
    expect(html).toContain('REGRESSION COEFFICIENTS');
    expect(html).toContain('Intercept');
    expect(html).toContain('Year');
  });
  it('renders the heterogeneity summary (R², residual, k)', () => {
    expect(html).toContain('HETEROGENEITY EXPLAINED');
    expect(html).toContain('R²');
    expect(html).toContain('Residual I²');
  });
  it('surfaces guardrail warnings', () => {
    expect(html).toContain('Fewer than ten studies per covariate');
  });
  it('renders the bubble plot SVG and export actions', () => {
    expect(html).toContain('<svg');
    expect(html).toContain('<circle');
    expect(html).toContain('EXPORT META-REGRESSION');
  });
  it('never says "AI"', () => {
    expect(NO_AI.test(html)).toBe(false);
  });
});

describe('MetaRegressionResults — ok:false shows warnings, not a chart', () => {
  const html = renderToStaticMarkup(createElement(MetaRegressionResults, {
    result: { ok: false, warnings: [{ type: 'error', message: 'Only 2 studies have the covariate.' }] },
    measure: 'SMD', covLabel: 'Year', type: 'continuous', method: 'MM',
  }));
  it('shows the warnings and a "could not be computed" note, no <svg chart>', () => {
    expect(html).toContain('Only 2 studies have the covariate.');
    expect(html).toContain('could not be computed');
    expect(html).not.toContain('<circle');
  });
});

describe('BubblePlot + geometry', () => {
  it('computeBubbleGeometry yields draw-ready points, a line, and a band path', () => {
    const g = computeBubbleGeometry(bubble, { isLog: false });
    expect(g.points).toHaveLength(3);
    expect(g.linePts).toBeTruthy();
    expect(g.bandPath).toContain('M');
    expect(g.points[0].r).toBeGreaterThan(0);
  });
  it('renders SVG bubbles + axis labels', () => {
    const html = renderToStaticMarkup(createElement(BubblePlot, { bubble, measure: 'SMD', covariateLabel: 'Year' }));
    expect(html).toContain('<svg');
    expect((html.match(/<circle/g) || []).length).toBe(3);
    expect(html).toContain('<path'); // confidence band
    expect(html).toContain('Year'); // x-axis label
  });
  it('buildBubbleSVG produces a self-contained artifact with hex colors', () => {
    const built = buildBubbleSVG(bubble, { measure: 'OR', covariateLabel: 'Year', title: 'MR' });
    expect(built).toBeTruthy();
    expect(built.svg).toContain('<circle');
    expect(built.svg).toContain('#0e1420'); // baked background, no theme var()
    expect(built.svg).not.toContain('var(--');
    expect(built.W).toBeGreaterThan(0);
  });
});

describe('buildMetaRegNarrative — association-only, no causal / no "AI"', () => {
  const n = buildMetaRegNarrative({ result: okResult, measure: 'SMD', covLabel: 'Year', type: 'continuous', method: 'MM' });
  it('states association not causation', () => {
    expect(n.results).toContain('does not establish');
    expect(n.methods).toContain('observational');
  });
  it('never says "AI"', () => {
    expect(NO_AI.test(n.results + n.methods + n.manuscript)).toBe(false);
  });
});
