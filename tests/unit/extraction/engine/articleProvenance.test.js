import { describe, it, expect } from 'vitest';
import {
  mkValueProvenance, attachProvenance, attachProvenanceMany, readProvenance,
  listProvenance, hasSourceEvidence, VALUE_PROVENANCE_METHODS,
} from '../../../../src/research-engine/extraction/engine/articleProvenance.js';
import { mkStudy } from '../../../../src/research-engine/project-model/defaults.js';

describe('articleProvenance.mkValueProvenance', () => {
  it('keeps a valid page + bbox in user space', () => {
    const p = mkValueProvenance({ field: 'es', method: 'click', page: 3, bbox: { x0: 10, y0: 20, x1: 30, y1: 40 }, excerpt: 'HR 0.74' });
    expect(p.page).toBe(3);
    expect(p.bbox).toEqual({ x0: 10, y0: 20, x1: 30, y1: 40 });
    expect(p.method).toBe('click');
  });
  it('drops a malformed bbox and non-positive page', () => {
    const p = mkValueProvenance({ field: 'es', page: 0, bbox: { x0: 1, y0: 2 } });
    expect(p.page).toBe(null);
    expect(p.bbox).toBe(null);
  });
  it('coerces an unknown method to manual and accepts ocr', () => {
    expect(mkValueProvenance({ method: 'bogus' }).method).toBe('manual');
    expect(mkValueProvenance({ method: 'ocr', ocr: true }).method).toBe('ocr');
    expect(VALUE_PROVENANCE_METHODS).toContain('ocr');
  });
  it('truncates a very long excerpt', () => {
    const p = mkValueProvenance({ excerpt: 'x'.repeat(2000) });
    expect(p.excerpt.length).toBeLessThanOrEqual(600);
  });
});

describe('articleProvenance.attach/read', () => {
  it('attaches per-field provenance without mutating the input', () => {
    const s = mkStudy();
    const s2 = attachProvenance(s, 'es', { method: 'click', page: 2, excerpt: '0.74' });
    expect(s.extractionMeta).toBeUndefined();
    expect(readProvenance(s2, 'es').page).toBe(2);
  });
  it('attaches many at once (smart CI → es/lo/hi)', () => {
    const s = attachProvenanceMany(mkStudy(), {
      es: { method: 'click', page: 4 }, lo: { method: 'click', page: 4 }, hi: { method: 'click', page: 4 },
    });
    expect(listProvenance(s).map((p) => p.field).sort()).toEqual(['es', 'hi', 'lo']);
  });
  it('hasSourceEvidence reflects a jumpable page/bbox', () => {
    const s = attachProvenance(mkStudy(), 'a', { method: 'table', page: 1 });
    expect(hasSourceEvidence(s, 'a')).toBe(true);
    expect(hasSourceEvidence(s, 'b')).toBe(false);
  });
  it('later attach overwrites the same field', () => {
    let s = attachProvenance(mkStudy(), 'es', { method: 'manual', page: 1 });
    s = attachProvenance(s, 'es', { method: 'click', page: 9 });
    expect(readProvenance(s, 'es').page).toBe(9);
    expect(readProvenance(s, 'es').method).toBe('click');
  });
});
