/**
 * rValidation.test.js — prompt44 item 2. The R validation engine is a PURE script
 * generator (no execution); these tests pin its statistical mapping + structure.
 */
import { describe, it, expect } from 'vitest';
import {
  rNum, rString, studyVectors, rmaCall, buildOutcomeBlock,
  buildMetaValidationR, buildExecutionRequest, R_VALIDATION_VERSION,
} from '../../src/research-engine/r-validation/rValidation.js';

describe('rNum / rString', () => {
  it('formats finite numbers and NA, trims trailing zeros', () => {
    expect(rNum(1.5)).toBe('1.5');
    expect(rNum(2)).toBe('2');
    expect(rNum(0)).toBe('0');
    expect(rNum('x')).toBe('NA');
    expect(rNum(Infinity)).toBe('NA');
    expect(rNum(null)).toBe('NA');
  });
  it('does NOT strip significant trailing zeros of whole numbers (dp=0)', () => {
    expect(rNum(10, 0)).toBe('10');
    expect(rNum(100, 0)).toBe('100');
    expect(rNum(30, 0)).toBe('30');
    expect(rNum(7, 0)).toBe('7');
  });
  it('escapes R strings and strips newlines', () => {
    expect(rString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(rString('line1\nline2')).toBe('line1 line2');
    expect(rString(null)).toBe('');
  });
});

describe('studyVectors', () => {
  it('keeps only rows with finite es/lo/hi and computes sei from the 95% CI', () => {
    const v = studyVectors([
      { label: 'A', es: 0.5, lo: 0.2, hi: 0.8 },
      { es: '', lo: 1, hi: 2 },            // dropped (blank es)
      { name: 'C', es: 1, lo: 0.5, hi: 1.5 },
    ]);
    expect(v.labels).toEqual(['A', 'C']);
    expect(v.yi).toEqual([0.5, 1]);
    // sei = (hi-lo)/(2*1.959964) → (0.8-0.2)/3.91993 ≈ 0.15306
    expect(v.sei[0]).toBeCloseTo(0.15306, 4);
  });
});

describe('rmaCall', () => {
  it('maps models to the matching metafor estimators', () => {
    expect(rmaCall('random', false)).toBe('rma(yi = yi, sei = sei, method = "DL")');
    expect(rmaCall('random', true)).toBe('rma(yi = yi, sei = sei, method = "DL", test = "knha")');
    expect(rmaCall('fixed', true)).toBe('rma(yi = yi, sei = sei, method = "FE")'); // HKSJ ignored for FE
  });
});

describe('buildOutcomeBlock', () => {
  const studies = [
    { label: 'S1', es: 0.10, lo: -0.10, hi: 0.30 },
    { label: 'S2', es: 0.20, lo: 0.00, hi: 0.40 },
    { label: 'S3', es: 0.15, lo: -0.05, hi: 0.35 },
  ];
  it('emits an rma call + summary + heterogeneity and the PecanRev comparison footer', () => {
    const { block, k } = buildOutcomeBlock({
      label: 'HbA1c', esType: 'MD', esTypeLabel: 'Mean Difference', isLog: false,
      model: 'random', hksj: false, studies,
      app: { k: 3, pooled: 0.15, lo: 0.02, hi: 0.28, I2: 0, tau2: 0, Q: 0.5, Qp: 0.78, predLo: -0.1, predHi: 0.4 },
    }, 1);
    expect(k).toBe(3);
    expect(block).toContain('method = "DL"');
    expect(block).toContain('predict(o1_res)');
    expect(block).toContain('PecanRev reported values');
    expect(block).toContain('I^2');
  });
  it('back-transforms ratio measures with exp()', () => {
    const { block } = buildOutcomeBlock({
      label: 'Mortality', esType: 'OR', esTypeLabel: 'Odds Ratio', isLog: true,
      model: 'random', hksj: true, studies, app: { pooled: 0.15 },
    }, 2);
    expect(block).toContain('transf = exp');
    expect(block).toContain('test = "knha"');
  });
  it('skips an outcome with fewer than 2 usable studies', () => {
    const { block, skipped } = buildOutcomeBlock({ label: 'Sparse', studies: [{ es: 1, lo: 0.5, hi: 1.5 }] }, 3);
    expect(skipped).toBe('not enough studies');
    expect(block).toContain('Skipped');
  });
});

describe('buildMetaValidationR', () => {
  it('produces a self-contained script with metafor guard + per-outcome blocks', () => {
    const r = buildMetaValidationR({
      projectName: 'My SR', generatedAt: '2026-06-19T00:00:00Z', appVersion: '3.26.0',
      outcomes: [{
        label: 'HbA1c', esType: 'MD', esTypeLabel: 'Mean Difference', isLog: false, model: 'random', hksj: false,
        studies: [{ es: 0.1, lo: -0.1, hi: 0.3 }, { es: 0.2, lo: 0, hi: 0.4 }],
      }],
    });
    expect(r).toContain('library(metafor)');
    expect(r).toContain('requireNamespace("metafor"');
    expect(r).toContain('Project: My SR');
    expect(r).toContain('Outcome 1: HbA1c');
    expect(r).toMatch(/method = "DL"/);
  });
  it('handles a project with no poolable outcomes gracefully', () => {
    const r = buildMetaValidationR({ projectName: 'Empty', outcomes: [] });
    expect(r).toContain('No outcomes with effect sizes');
    expect(r).toContain('library(metafor)');
  });
});

describe('buildExecutionRequest (inert service boundary)', () => {
  it('never executes — returns a structured not_executed request', () => {
    const req = buildExecutionRequest({ script: 'library(metafor)', projectId: 'p1', outcomeId: 'o1' });
    expect(req.status).toBe('not_executed');
    expect(req.engine).toBe('R');
    expect(req.script).toContain('metafor');
    expect(req.projectId).toBe('p1');
    expect(req.version).toBe(R_VALIDATION_VERSION);
  });
});
