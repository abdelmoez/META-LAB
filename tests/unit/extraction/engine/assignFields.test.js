/**
 * 77.md §7 — click-to-pick active-field mapping. The measure decides which fields a PDF
 * click can fill, and auto-advance walks the empty ones so all four 2×2 boxes fill with
 * four clicks. These pure helpers are the fix for "selecting Risk Ratio breaks picking".
 */
import { describe, it, expect } from 'vitest';
import { assignableFieldsFor, usesEffectSlot, nextAssignableField } from '../../../../src/research-engine/extraction/engine/articleStatus.js';

describe('assignableFieldsFor', () => {
  it('maps RR/OR to the 2×2 cells a,b,c,d', () => {
    expect(assignableFieldsFor({ esType: 'RR' })).toEqual(['a', 'b', 'c', 'd']);
    expect(assignableFieldsFor({ esType: 'OR' })).toEqual(['a', 'b', 'c', 'd']);
  });
  it('maps DIAG to tp,fp,fn,tn (previously unfillable by click)', () => {
    expect(assignableFieldsFor({ esType: 'DIAG' })).toEqual(['tp', 'fp', 'fn', 'tn']);
  });
  it('maps SMD/MD to the six continuous fields', () => {
    expect(assignableFieldsFor({ esType: 'SMD' })).toEqual(['nExp', 'meanExp', 'sdExp', 'nCtrl', 'meanCtrl', 'sdCtrl']);
  });
  it('maps PROP to events,total', () => {
    expect(assignableFieldsFor({ esType: 'PROP' })).toEqual(['events', 'total']);
  });
  it('maps HR/COR/IRR and unset to the generic effect slot es,lo,hi', () => {
    expect(assignableFieldsFor({ esType: 'HR' })).toEqual(['es', 'lo', 'hi']);
    expect(assignableFieldsFor({ esType: '' })).toEqual(['es', 'lo', 'hi']);
  });
});

describe('usesEffectSlot', () => {
  it('is true only for es/lo/hi measures', () => {
    expect(usesEffectSlot({ esType: 'HR' })).toBe(true);
    expect(usesEffectSlot({ esType: '' })).toBe(true);
    expect(usesEffectSlot({ esType: 'RR' })).toBe(false);
    expect(usesEffectSlot({ esType: 'SMD' })).toBe(false);
  });
});

describe('nextAssignableField (auto-advance)', () => {
  it('walks empty 2×2 cells in order for RR', () => {
    const s = { esType: 'RR' };
    expect(nextAssignableField(s, 'a')).toBe('b');
    expect(nextAssignableField({ ...s, a: '10', b: '5' }, 'b')).toBe('c');
  });
  it('skips already-filled fields', () => {
    const s = { esType: 'RR', a: '10', b: '5', c: '8' };
    expect(nextAssignableField(s, 'a')).toBe('d');
  });
  it('returns "" when every expected field is filled', () => {
    const s = { esType: 'RR', a: '1', b: '2', c: '3', d: '4' };
    expect(nextAssignableField(s, 'd')).toBe('');
  });
  it('wraps around to an earlier empty field', () => {
    const s = { esType: 'RR', b: '2', c: '3', d: '4' }; // a empty
    expect(nextAssignableField(s, 'd')).toBe('a');
  });
});
