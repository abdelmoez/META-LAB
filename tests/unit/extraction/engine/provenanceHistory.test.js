/**
 * 77.md §2 — click-to-pick REPLACE keeps an audit history. mkValueProvenance persists a
 * bounded `history[]` of replaced values so an immediate replacement is never a silent
 * data loss.
 */
import { describe, it, expect } from 'vitest';
import { mkValueProvenance, attachProvenanceMany, readProvenance } from '../../../../src/research-engine/extraction/engine/articleProvenance.js';

describe('mkValueProvenance history', () => {
  it('preserves a replaced-value history, normalising entries', () => {
    const p = mkValueProvenance({ field: 'es', method: 'click', page: 3, history: [{ value: 1.2, method: 'click', at: 't1' }, { value: '1.5', method: 'bogus' }] });
    expect(p.history).toEqual([
      { value: '1.2', method: 'click', at: 't1' },
      { value: '1.5', method: 'manual', at: undefined },
    ]);
  });
  it('caps history to the last 10 entries', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ value: String(i), method: 'click', at: `t${i}` }));
    const p = mkValueProvenance({ field: 'a', history: many });
    expect(p.history).toHaveLength(10);
    expect(p.history[0].value).toBe('5');
  });
  it('omits history when none is supplied', () => {
    const p = mkValueProvenance({ field: 'a', method: 'manual' });
    expect(p.history).toBeUndefined();
  });
});

describe('attachProvenanceMany with history', () => {
  it('round-trips history through attach/read', () => {
    const study = { id: 's', extractionMeta: {} };
    const next = attachProvenanceMany(study, { es: { method: 'click', page: 2, history: [{ value: '0.9', method: 'click', at: 't' }] } });
    const prov = readProvenance(next, 'es');
    expect(prov.method).toBe('click');
    expect(prov.history).toEqual([{ value: '0.9', method: 'click', at: 't' }]);
    // Purity: original study untouched.
    expect(study.extractionMeta.provenance).toBeUndefined();
  });
});
