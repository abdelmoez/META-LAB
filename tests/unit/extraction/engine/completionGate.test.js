import { describe, it, expect } from 'vitest';
import { evaluateCompletion, completionBlockReason, SEVERITY } from '../../../../src/research-engine/extraction/engine/completionGate.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';

describe('completionGate.evaluateCompletion', () => {
  it('allows completion of a clean analysis-ready study', () => {
    const s = { ...mkStudy(), author: 'A', year: '2020', outcome: 'X', esType: 'OR', es: '0.1', lo: '-0.2', hi: '0.4', a: '5', b: '95', c: '10', d: '90' };
    const r = evaluateCompletion(s);
    expect(r.canComplete).toBe(true);
    expect(r.blocking).toHaveLength(0);
  });
  it('blocks completion when a data check fails (events>total)', () => {
    const s = { ...mkStudy(), esType: 'PROP', events: '50', total: '10', outcome: 'X' };
    const r = evaluateCompletion(s);
    expect(r.canComplete).toBe(false);
    expect(r.blocking.length).toBeGreaterThanOrEqual(1);
  });
  it('warnings never block completion', () => {
    // missing author/year are warnings only
    const s = { ...mkStudy(), outcome: 'X', esType: 'OR', es: '0.1', lo: '-0.2', hi: '0.4' };
    const r = evaluateCompletion(s);
    expect(r.canComplete).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });
  it('adds an informational note when values exist but no effect size yet', () => {
    // raw 2x2 cells present (hasAnyValue) but no es derived → the "no effect size" note
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'OR', a: '5', b: '95', c: '10', d: '90' };
    const r = evaluateCompletion(s);
    expect(r.info.some((i) => i.field === 'es')).toBe(true);
    expect(r.canComplete).toBe(true); // info never blocks
  });
  it('notes empty articles have nothing to analyse', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020' };
    const r = evaluateCompletion(s);
    expect(r.info.some((i) => i.field === 'values')).toBe(true);
  });
  it('has the three severity tiers', () => {
    expect(SEVERITY).toEqual({ INFO: 'info', WARN: 'warn', BLOCK: 'block' });
  });
});

describe('completionGate.completionBlockReason', () => {
  it('is empty when completion is allowed', () => {
    const s = { ...mkStudy(), outcome: 'X', es: '0.1', lo: '-0.2', hi: '0.4', esType: 'OR' };
    expect(completionBlockReason(s)).toBe('');
  });
  it('names the blocking count when blocked', () => {
    const s = { ...mkStudy(), esType: 'PROP', events: '50', total: '10' };
    const msg = completionBlockReason(s);
    expect(msg).toMatch(/blocking data check/i);
  });
});
