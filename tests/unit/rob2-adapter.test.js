/**
 * rob2-adapter.test.js — unit tests for the legacy RoB adapter and the synthesis
 * hook stubs (both pure). See server/rob/legacyAdapter.js and
 * src/research-engine/rob/synthesisHooks.js.
 */
import { describe, it, expect } from 'vitest';
import { legacyRobView, assessmentToLegacyRob } from '../../server/rob/legacyAdapter.js';
import { annotateForestRows, gradeRiskOfBiasInput } from '../../src/research-engine/rob/synthesisHooks.js';

describe('legacyAdapter.legacyRobView', () => {
  it('normalises a legacy per-domain rob object', () => {
    const v = legacyRobView({ rob: { D1: 'low', D2: 'High risk', D3: { judgment: 'some' }, D4: 'unclear', D5: 'nonsense' } });
    expect(v.hasLegacy).toBe(true);
    expect(v.domains.D1).toBe('low');
    expect(v.domains.D2).toBe('high');
    expect(v.domains.D3).toBe('some');
    expect(v.domains.D4).toBe('some');   // "unclear" → some
    expect(v.domains.D5).toBeNull();     // unrecognised → null
  });
  it('empty/missing rob → no legacy data', () => {
    expect(legacyRobView({}).hasLegacy).toBe(false);
    expect(legacyRobView({ rob: {} }).hasLegacy).toBe(false);
    expect(legacyRobView(null).hasLegacy).toBe(false);
  });
});

describe('legacyAdapter.assessmentToLegacyRob', () => {
  it('prefers finalJudgment over proposedJudgment', () => {
    const out = assessmentToLegacyRob([
      { domainId: 'D1', proposedJudgment: 'low', finalJudgment: 'high' },
      { domainId: 'D2', proposedJudgment: 'some' },
    ]);
    expect(out).toEqual({ D1: 'high', D2: 'some' });
  });
});

describe('synthesisHooks.annotateForestRows (stub)', () => {
  it('joins RoB onto forest rows; null when no RoB for a study', () => {
    const rows = annotateForestRows(
      [{ studyId: 'a' }, { studyId: 'b' }],
      { a: { overall: 'high', domains: { D1: 'high' } } },
    );
    expect(rows[0]).toEqual({ studyId: 'a', rob: { overall: 'high', domains: { D1: 'high' } } });
    expect(rows[1]).toEqual({ studyId: 'b', rob: null });
  });
});

describe('synthesisHooks.gradeRiskOfBiasInput (stub)', () => {
  it('tallies overall judgements and exposes a placeholder concern level', () => {
    expect(gradeRiskOfBiasInput([{ overall: 'low' }, { overall: 'low' }])).toMatchObject({ counts: { low: 2, some: 0, high: 0 }, total: 2, gradeConcern: 'none' });
    expect(gradeRiskOfBiasInput([{ overall: 'low' }, { overall: 'high' }]).gradeConcern).toBe('serious');
    expect(gradeRiskOfBiasInput([]).gradeConcern).toBe('unknown');
  });
});
