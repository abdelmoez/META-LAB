/**
 * crossConcept.test.js — SB4 Parts 4/8/9. Term-equivalence + cross-concept duplicate
 * detection, the Search Quality Check foundation, and the sensitivity signal.
 */
import { describe, it, expect } from 'vitest';
import {
  termEquivalenceKey, detectCrossConceptDuplicates, searchQualityCheck, sensitivitySignal,
} from '../../src/research-engine/searchBuilder/crossConcept.js';

const concept = (picoField, label, ...terms) => ({
  id: `c-${picoField || label}`, label, picoField: picoField || null,
  terms: terms.map((t, i) => (typeof t === 'string' ? { id: `${label}-${i}`, text: t, type: 'freetext' } : { id: `${label}-${i}`, type: 'freetext', ...t })),
});

describe('termEquivalenceKey', () => {
  it('collapses acronyms and expansions of the same family to one key', () => {
    expect(termEquivalenceKey('EUS')).toBe(termEquivalenceKey('endoscopic ultrasound'));
    expect(termEquivalenceKey('T2DM')).toBe(termEquivalenceKey('type 2 diabetes mellitus'));
    expect(termEquivalenceKey('EUS')).toBe('fam:eus');
  });
  it('falls back to normalized text for non-family terms', () => {
    expect(termEquivalenceKey('widget score')).toBe('widget score');
    expect(termEquivalenceKey('')).toBe('');
  });
});

describe('detectCrossConceptDuplicates', () => {
  it('flags an equivalent term living in two concepts (EUS ≡ endoscopic ultrasound)', () => {
    const concepts = [
      concept('P', 'Population', 'endoscopic ultrasound'),
      concept('I', 'Intervention / Exposure', 'EUS'),
      concept('O', 'Outcomes', 'mortality'),
    ];
    const dups = detectCrossConceptDuplicates(concepts);
    expect(dups.length).toBe(1);
    expect(dups[0].equivKey).toBe('fam:eus');
    expect(dups[0].occurrences.map((o) => o.picoField).sort()).toEqual(['I', 'P']);
  });
  it('does not flag distinct terms', () => {
    const concepts = [
      concept('P', 'Population', 'malignant biliary obstruction'),
      concept('I', 'Intervention / Exposure', 'transpapillary biliary drainage'),
      concept('C', 'Comparator / Control', 'transluminal biliary drainage'),
    ];
    expect(detectCrossConceptDuplicates(concepts)).toEqual([]);
  });
  it('counts an equivalence key once per concept (no self-duplicate)', () => {
    const concepts = [concept('P', 'Population', 'EUS', 'endoscopic ultrasound')]; // same family, one concept
    expect(detectCrossConceptDuplicates(concepts)).toEqual([]);
  });
});

describe('searchQualityCheck', () => {
  const concepts = [
    concept('P', 'Population', 'endoscopic ultrasound'),
    concept('I', 'Intervention / Exposure', 'EUS'),
    concept('O', 'Outcomes'), // empty major concept
  ];

  it('warns about a term in more than one concept and an empty major concept', () => {
    const w = searchQualityCheck(concepts);
    const ids = w.map((x) => x.id);
    expect(ids).toContain('multi:fam:eus');
    expect(ids).toContain('empty:O');
  });
  it('warns when a major concept with terms has no controlled vocabulary', () => {
    const ids = searchQualityCheck(concepts).map((x) => x.id);
    expect(ids).toContain('novocab:P');
  });
  it('does not warn novocab when a controlled (MeSH) term is present', () => {
    const withMesh = [concept('P', 'Population', { text: 'Obesity', type: 'controlled' })];
    expect(searchQualityCheck(withMesh).map((x) => x.id)).not.toContain('novocab:P');
  });
  it('respects dismissed warning ids', () => {
    const all = searchQualityCheck(concepts);
    const dismissed = ['multi:fam:eus'];
    const after = searchQualityCheck(concepts, { dismissed });
    expect(all.map((x) => x.id)).toContain('multi:fam:eus');
    expect(after.map((x) => x.id)).not.toContain('multi:fam:eus');
  });
  it('orders critical → warning → info', () => {
    const sev = searchQualityCheck(concepts).map((x) => x.severity);
    const rank = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < sev.length; i++) expect(rank[sev[i]]).toBeGreaterThanOrEqual(rank[sev[i - 1]]);
  });
  it('tolerates empty / missing input', () => {
    expect(searchQualityCheck(null)).toEqual([]);
    expect(searchQualityCheck([])).toEqual([]);
  });
});

describe('sensitivitySignal', () => {
  it('buckets counts into breadth labels', () => {
    expect(sensitivitySignal(80000).key).toBe('very-broad');
    expect(sensitivitySignal(20000).key).toBe('broad');
    expect(sensitivitySignal(300).key).toBe('balanced');
    expect(sensitivitySignal(50).key).toBe('narrow');
    expect(sensitivitySignal(5).key).toBe('very-narrow');
  });
  it('returns null for unknown counts (no fabricated number)', () => {
    expect(sensitivitySignal(null)).toBeNull();
    expect(sensitivitySignal(undefined)).toBeNull();
    expect(sensitivitySignal(NaN)).toBeNull();
  });
});
