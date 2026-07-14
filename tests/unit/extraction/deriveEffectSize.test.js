/**
 * 86.md P0.3 — a study extracted in the Pecan engine with complete RAW data but no
 * es must be derivable into a poolable analysis-scale effect size, so it enters the
 * meta-analysis. Pins the pure derivation.
 */
import { describe, it, expect } from 'vitest';
import { deriveEffectSizeFromRaw, hasEffectSize, rawInputsComplete } from '../../../src/research-engine/extraction/deriveEffectSize.js';
import { calcES } from '../../../src/research-engine/statistics/monolithStats.js';

describe('deriveEffectSizeFromRaw (P0.3)', () => {
  it('derives lnOR from a complete 2×2', () => {
    const study = { esType: 'OR', a: '12', b: '88', c: '25', d: '75' };
    const d = deriveEffectSizeFromRaw(study);
    expect(d).not.toBeNull();
    expect(d.esType).toBe('OR');
    // matches calcES directly
    const ref = calcES('OR', { a: 12, b: 88, c: 25, d: 75 });
    expect(+d.es).toBeCloseTo(ref.es, 6);
    expect(+d.lo).toBeCloseTo(ref.lo, 6);
    expect(+d.hi).toBeCloseTo(ref.hi, 6);
    expect(d.conversion.type).toBe('raw_to_es');
  });

  it('derives SMD from continuous arms', () => {
    const study = { esType: 'SMD', meanExp: '10', sdExp: '2', nExp: '30', meanCtrl: '12', sdCtrl: '2.5', nCtrl: '32' };
    const d = deriveEffectSizeFromRaw(study);
    expect(d).not.toBeNull();
    const ref = calcES('SMD', { m1: 10, sd1: 2, n1: 30, m2: 12, sd2: 2.5, n2: 32 });
    expect(+d.es).toBeCloseTo(ref.es, 6);
  });

  it('never overwrites an existing effect size', () => {
    const study = { esType: 'OR', a: '12', b: '88', c: '25', d: '75', es: '0.5', lo: '0.1', hi: '0.9' };
    expect(deriveEffectSizeFromRaw(study)).toBeNull();
  });

  it('returns null when the raw set is incomplete', () => {
    expect(deriveEffectSizeFromRaw({ esType: 'OR', a: '12', b: '88', c: '25' })).toBeNull();
    expect(rawInputsComplete({ esType: 'OR', a: '12', b: '88', c: '25' })).toBe(false);
  });

  it('returns null for a double-zero 2×2 (not estimable as OR)', () => {
    expect(deriveEffectSizeFromRaw({ esType: 'OR', a: '0', b: '50', c: '0', d: '50' })).toBeNull();
  });

  it('returns null for measures that are entered as value+CI, not raw', () => {
    expect(deriveEffectSizeFromRaw({ esType: 'HR', es: '', hr: '1.2' })).toBeNull();
    expect(deriveEffectSizeFromRaw({ esType: 'GENERIC', est: '1', lo: '0.5', hi: '2' })).toBeNull();
  });

  it('hasEffectSize reflects a usable es', () => {
    expect(hasEffectSize({ es: '0.4' })).toBe(true);
    expect(hasEffectSize({ es: '' })).toBe(false);
    expect(hasEffectSize({ es: 'x' })).toBe(false);
  });

  it('derives a diagnostic DOR from TP/FP/FN/TN', () => {
    const d = deriveEffectSizeFromRaw({ esType: 'DIAG', tp: '80', fp: '20', fn: '10', tn: '90' });
    expect(d).not.toBeNull();
    expect(+d.es).toBeCloseTo(calcES('DIAG', { tp: 80, fp: 20, fn: 10, tn: 90 }).es, 6);
  });
});
