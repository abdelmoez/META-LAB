import { describe, it, expect } from 'vitest';
import { evaluateCompletion, completionBlockReason, SEVERITY } from '../../../../src/research-engine/extraction/engine/completionGate.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';
import { poolableStudyView } from '../../../../src/research-engine/statistics/monolithStats.js';
import { deriveEffectSizeFromRaw } from '../../../../src/research-engine/extraction/deriveEffectSize.js';
import { rowIneligibilityReason } from '../../../../src/research-engine/statistics/analysisEligibility.js';

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

/* ══════════ 116.md §41/§46 (r2) — the §41 line means DERIVED, not "has an effect" ══════════
   The derivation message was gated on `hasUsableEffect`, which is true for ANY row with a
   stored numeric es. Every clause of the sentence was then false for such a row: nothing
   is derived (`_derivedEs` is false — poolableStudyView returns the row untouched),
   events/total is not even a concept for an SMD/OR row, `deriveEffectSizeFromRaw` returns
   null so "marking complete also stores it" cannot happen, and runMeta drops the row for
   want of a CI while the Analysis tab reports it as 'missingCI' — the extraction-says-
   analyzable / analysis-says-no contradiction §46 exists to remove, in reverse. */
const DERIVED_MSG = 'Effect size is derived automatically from events/total for analysis — marking complete also stores it on the row.';
const NO_CI_MSG = 'Effect size has no usable 95% confidence interval — enter both bounds or it cannot be weighted in the meta-analysis.';

describe('116.md §41/§46 (r2) — the derivation info line is gated on ACTUAL derivation', () => {
  const infoMsgs = (s) => evaluateCompletion(s).info.map((i) => i.msg);

  it('a raw-only PROP row — the one row the analysis really derives — still gets it', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'PROP', events: '18', total: '100' };
    expect(poolableStudyView(s)._derivedEs).toBe(true);
    expect(infoMsgs(s)).toContain(DERIVED_MSG);
    // and the claim "marking complete also stores it" is true for exactly this row
    expect(deriveEffectSizeFromRaw(s)).not.toBeNull();
  });

  it('an OR row with a stored es and no CI does NOT claim an events/total derivation', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'OR', es: '0.50', lo: '', hi: '' };
    expect(poolableStudyView(s)._derivedEs).toBeUndefined();
    expect(deriveEffectSizeFromRaw(s)).toBeNull();      // nothing would be stored
    expect(infoMsgs(s)).not.toContain(DERIVED_MSG);
  });

  it('a PROP row whose stored es wins over its raw data does NOT claim a derivation', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'PROP', es: '-1.5', lo: '', hi: '', events: '18', total: '100' };
    expect(poolableStudyView(s)._derivedEs).toBeUndefined();
    expect(infoMsgs(s)).not.toContain(DERIVED_MSG);
  });

  it('an SMD row with es only does NOT claim a derivation (no raw path exists for it)', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'SMD', es: '0.5', lo: '', hi: '' };
    expect(infoMsgs(s)).not.toContain(DERIVED_MSG);
  });

  it('a PARTIALLY filled CI — silent before — now gets the honest missing-CI line', () => {
    // study-validator only warns when BOTH bounds are blank, so this row's ONLY guidance
    // used to be the false derivation message.
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'SMD', es: '0.5', lo: '-0.2', hi: '' };
    const r = evaluateCompletion(s);
    expect(r.warnings.some((w) => /confidence interval/i.test(w.msg))).toBe(false);
    expect(r.info.map((i) => i.msg)).toContain(NO_CI_MSG);
    expect(r.info.map((i) => i.msg)).not.toContain(DERIVED_MSG);
  });

  it('does not duplicate the validator when BOTH bounds are blank', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'OR', es: '0.5', lo: '', hi: '' };
    const r = evaluateCompletion(s);
    expect(r.warnings.some((w) => /confidence interval/i.test(w.msg))).toBe(true);
    expect(r.info.map((i) => i.msg)).not.toContain(NO_CI_MSG);
  });

  it('the wording agrees with the Analysis tab for the same row (missingCI, not noEffect)', () => {
    const s = { ...mkStudy(), outcome: 'X', author: 'A', year: '2020', esType: 'OR', es: '0.5', lo: '-0.2', hi: '' };
    expect(rowIneligibilityReason(s)).toBe('missingCI');
    expect(evaluateCompletion(s).info.map((i) => i.msg)).toContain(NO_CI_MSG);
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
