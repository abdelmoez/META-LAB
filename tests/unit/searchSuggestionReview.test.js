/**
 * searchSuggestionReview.test.js — 85.md A1. The pure suggestion-review model:
 * rejection keys (family-aware, persisted), pending suggestions per concept,
 * counts, and the "Restore all clears BOTH memories" contract.
 */
import { describe, it, expect } from 'vitest';
import {
  rejectionKey, pendingSuggestions, suggestionCount, resetSuggestionMemory,
} from '../../src/research-engine/searchBuilder/suggestionReview.js';

const freetext = (text, extra = {}) => ({ id: `t-${text}`, text, type: 'freetext', field: 'tiab', ...extra });
const controlled = (text, extra = {}) => ({ id: `t-${text}`, text, type: 'controlled', field: 'tiab', ...extra });
const concept = (id, label, terms, extra = {}) => ({ id, label, op: 'AND', terms, ...extra });

describe('rejectionKey', () => {
  it('scopes by picoField when present, else by the normalized concept label', () => {
    expect(rejectionKey({ picoField: 'P', label: 'Population' }, 'widget score')).toBe('rej:P:widget score');
    expect(rejectionKey({ label: 'My Concept' }, 'widget score')).toBe('rej:my concept:widget score');
    // family terms collapse to the family key ("obesity" is a known family)
    expect(rejectionKey({ picoField: 'P' }, 'obesity')).toBe('rej:P:fam:obesity');
  });
  it('collapses family variants to one key (EUS ≡ endoscopic ultrasound)', () => {
    const c = { picoField: 'I', label: 'Intervention / Exposure' };
    expect(rejectionKey(c, 'EUS')).toBe(rejectionKey(c, 'endoscopic ultrasound'));
    expect(rejectionKey(c, 'EUS')).toBe('rej:I:fam:eus');
  });
  it('different scopes yield different keys (a rejection in P never hides an I suggestion)', () => {
    expect(rejectionKey({ picoField: 'P' }, 'EUS')).not.toBe(rejectionKey({ picoField: 'I' }, 'EUS'));
  });
});

describe('pendingSuggestions — kind "mesh" (convertible freetext)', () => {
  const c = concept('cP', 'Population', [
    freetext('obesity', { vocab: { mesh: 'Obesity', synonyms: ['obese'] } }),
    freetext('overweight'), // no vocab → nothing to suggest
  ], { picoField: 'P' });

  it('suggests the standard heading for a freetext term with vocab', () => {
    const out = pendingSuggestions(c);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: 'mesh', text: 'Obesity', sourceText: 'obesity',
      why: 'Standard subject heading for "obesity"', key: rejectionKey(c, 'obesity'),
    });
    expect(out[0].vocab.mesh).toBe('Obesity');
  });

  it('excludes rejected keys (Set or array)', () => {
    expect(pendingSuggestions(c, new Set([rejectionKey(c, 'obesity')]))).toEqual([]);
    expect(pendingSuggestions(c, [rejectionKey(c, 'obesity')])).toEqual([]);
    expect(pendingSuggestions(c, ['rej:I:unrelated'])).toHaveLength(1);
  });

  it('excludes a suggestion whose target heading already exists as a controlled term', () => {
    const withHeading = concept('cP', 'Population', [
      ...c.terms,
      controlled('Obesity', { vocab: { mesh: 'Obesity' } }),
    ], { picoField: 'P' });
    expect(pendingSuggestions(withHeading).filter((s) => s.kind === 'mesh')).toEqual([]);
  });

  it('ignores disabled source terms (a switched-off term must not nag)', () => {
    const off = concept('cP', 'Population', [
      freetext('obesity', { vocab: { mesh: 'Obesity' }, disabled: true }),
    ], { picoField: 'P' });
    expect(pendingSuggestions(off)).toEqual([]);
  });

  it('family variants collapse to ONE suggestion (one entry per rejection key)', () => {
    const fam = concept('cI', 'Intervention / Exposure', [
      freetext('EUS', { vocab: { mesh: 'Endosonography' } }),
      freetext('endoscopic ultrasound', { vocab: { mesh: 'Endosonography' } }),
    ], { picoField: 'I' });
    expect(pendingSuggestions(fam)).toHaveLength(1);
  });
});

describe('pendingSuggestions — kind "synonyms" (entry terms of a controlled term)', () => {
  const c = concept('cI', 'Intervention', [
    controlled('Sodium-Glucose Transporter 2 Inhibitors', {
      vocab: { mesh: 'Sodium-Glucose Transporter 2 Inhibitors', synonyms: ['SGLT2 inhibitor', 'gliflozin', 'empagliflozin'] },
    }),
    freetext('gliflozin'), // one synonym already added
  ], { picoField: 'I' });

  it('suggests only the UNADDED entry terms', () => {
    const out = pendingSuggestions(c);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('synonyms');
    expect(out[0].why).toBe('Entry terms for "Sodium-Glucose Transporter 2 Inhibitors"');
    expect(out[0].synonyms).toEqual(['SGLT2 inhibitor', 'empagliflozin']); // gliflozin excluded
  });

  it('no suggestion when every entry term already exists (target exists)', () => {
    const full = concept('cI', 'Intervention', [
      controlled('X', { vocab: { mesh: 'X', synonyms: ['a', 'b'] } }),
      freetext('a'), freetext('b'),
    ], { picoField: 'I' });
    expect(pendingSuggestions(full)).toEqual([]);
  });

  it('respects rejection', () => {
    expect(pendingSuggestions(c, [rejectionKey(c, 'Sodium-Glucose Transporter 2 Inhibitors')])).toEqual([]);
  });

  it('a controlled term without synonyms suggests nothing', () => {
    const bare = concept('cI', 'Intervention', [controlled('X', { vocab: { mesh: 'X' } })], { picoField: 'I' });
    expect(pendingSuggestions(bare)).toEqual([]);
  });
});

describe('suggestionCount', () => {
  const concepts = [
    concept('cP', 'Population', [freetext('obesity', { vocab: { mesh: 'Obesity' } })], { picoField: 'P' }),
    concept('cI', 'Intervention', [controlled('X', { vocab: { mesh: 'X', synonyms: ['y'] } })], { picoField: 'I' }),
    concept('cO', 'Outcomes', [freetext('mortality')], { picoField: 'O' }),
  ];
  it('counts per concept + total', () => {
    const { total, perConcept } = suggestionCount(concepts);
    expect(total).toBe(2);
    expect(perConcept).toEqual({ cP: 1, cI: 1, cO: 0 });
  });
  it('rejections reduce the count', () => {
    const rejected = [rejectionKey(concepts[0], 'obesity')];
    expect(suggestionCount(concepts, rejected).total).toBe(1);
  });
  it('tolerates junk', () => {
    expect(suggestionCount(null)).toEqual({ total: 0, perConcept: {} });
  });
});

describe('resetSuggestionMemory — the "Restore all" contract', () => {
  it('clears BOTH "user said no" lists together and keeps every other key', () => {
    const state = {
      concepts: [{ id: 'c1' }], overrides: { pubmed: 'x' },
      ignored: [{ text: 'gone', field: 'P', label: 'Population' }],
      rejectedSuggestions: ['rej:P:obesity'],
      dismissedWarnings: ['narrow:O'],
    };
    const out = resetSuggestionMemory(state);
    expect(out.ignored).toEqual([]);
    expect(out.rejectedSuggestions).toEqual([]);
    expect(out.concepts).toBe(state.concepts);
    expect(out.overrides).toBe(state.overrides);
    expect(out.dismissedWarnings).toEqual(['narrow:O']); // dismissals are a different memory
    expect(state.ignored).toHaveLength(1); // pure — input untouched
  });
  it('tolerates junk input', () => {
    expect(resetSuggestionMemory(null)).toEqual({ ignored: [], rejectedSuggestions: [] });
  });
});
