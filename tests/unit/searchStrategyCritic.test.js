/**
 * searchStrategyCritic.test.js — P11 Task 2. Deterministic rule-based critique of a
 * generated strategy: every issue type fires on a crafted input and stays silent when
 * not applicable, the score reflects severity, and `revised` is a re-testable strategy.
 */
import { describe, it, expect } from 'vitest';
import { generateStrategyFor } from '../../src/research-engine/searchBuilder/strategyGenerator.js';
import {
  critiqueStrategy, syntaxProblems, sensitivityDelta, analyzeSensitivity, DEFAULT_CRITIC_CONFIG,
} from '../../src/research-engine/searchBuilder/strategyCritic.js';

const F0 = { dateFrom: '', dateTo: '', languages: [], pubTypes: [] };
const ft = (text, extra = {}) => ({ text, type: 'freetext', field: 'tiab', ...extra });
const gen = (cs, filters = F0, profile = 'balanced', db = 'pubmed') => generateStrategyFor(cs, db, filters, profile);

/** A well-formed 2-concept strategy: two synonyms each, distinct concepts, no filters. */
const healthyConcepts = [
  { id: 'p', label: 'Population', terms: [ft('sepsis'), ft('septic shock')] },
  { id: 'i', label: 'Intervention', terms: [ft('vasopressin'), ft('noradrenaline')] },
];
const types = (r) => r.issues.map((i) => i.type);

describe('healthy strategy → no issues, perfect score', () => {
  const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact', seedRecall: 0.9 });
  it('produces zero issues', () => { expect(r.issues).toEqual([]); });
  it('scores 1 and offers no forced revision', () => {
    expect(r.score).toBe(1);
    expect(r.revised).toBeNull();
  });
});

describe('TOO_FEW_HITS / TOO_MANY_HITS', () => {
  const s = gen(healthyConcepts);
  it('fires TOO_FEW_HITS below the floor and broadens', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: 12, hitKind: 'exact' });
    expect(types(r)).toContain('TOO_FEW_HITS');
    expect(r.revised).toBeTruthy();
    expect(r.revised.profile).toBe('broad');
  });
  it('marks a zero-hit search as an error', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: 0, hitKind: 'exact' });
    expect(r.issues.find((i) => i.type === 'TOO_FEW_HITS').severity).toBe('error');
  });
  it('fires TOO_MANY_HITS above the ceiling and tightens', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: 90000, hitKind: 'exact' });
    expect(types(r)).toContain('TOO_MANY_HITS');
    expect(r.revised.profile).toBe('precise');
  });
  it('treats a capped result as too many', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: 10000, hitKind: 'capped' });
    expect(types(r)).toContain('TOO_MANY_HITS');
  });
  it('stays silent on hit-count rules when the count is unavailable', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: null, hitKind: 'unavailable' });
    expect(types(r)).not.toContain('TOO_FEW_HITS');
    expect(types(r)).not.toContain('TOO_MANY_HITS');
  });
});

describe('MISSING_SYNONYMS', () => {
  const cs = [
    { id: 'p', label: 'Population', terms: [ft('diabetes')] }, // single term, known family
    { id: 'i', label: 'Intervention', terms: [ft('metformin'), ft('glucophage')] },
  ];
  const r = critiqueStrategy({ strategy: gen(cs), hitCount: 500, hitKind: 'exact' });
  it('fires when a concept has one free-text term and no synonyms', () => {
    expect(types(r)).toContain('MISSING_SYNONYMS');
  });
  it('revises by adding family synonyms, and the revision is re-testable + clean', () => {
    expect(r.revised).toBeTruthy();
    expect(r.revised.blocks[0].terms.length).toBeGreaterThan(1);
    const r2 = critiqueStrategy({ strategy: r.revised, hitCount: 500, hitKind: 'exact' });
    expect(types(r2)).not.toContain('MISSING_SYNONYMS');
  });
  it('stays silent when every concept has multiple terms', () => {
    expect(types(critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact' }))).not.toContain('MISSING_SYNONYMS');
  });
});

describe('RESTRICTIVE_FILTERS', () => {
  const s = gen(healthyConcepts, { dateFrom: '', dateTo: '', languages: ['en'], pubTypes: [] });
  it('fires (info) when limits are present but hits are healthy', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: 5000, hitKind: 'exact' });
    const i = r.issues.find((x) => x.type === 'RESTRICTIVE_FILTERS');
    expect(i).toBeTruthy();
    expect(i.severity).toBe('info');
  });
  it('escalates to warn + relaxes filters when hits are also low', () => {
    const r = critiqueStrategy({ strategy: s, hitCount: 40, hitKind: 'exact' });
    const i = r.issues.find((x) => x.type === 'RESTRICTIVE_FILTERS');
    expect(i.severity).toBe('warn');
    // (TOO_FEW_HITS is dominant → broaden, which itself drops language limits)
    expect(r.revised.filters.languages).toEqual([]);
  });
  it('stays silent with no restrictive filters', () => {
    expect(types(critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact' }))).not.toContain('RESTRICTIVE_FILTERS');
  });
});

describe('BROKEN_SYNTAX', () => {
  it('detects structural problems via syntaxProblems', () => {
    expect(syntaxProblems('(a OR b')).toContain('unbalanced parentheses');
    expect(syntaxProblems('()')).toContain('empty group ()');
    expect(syntaxProblems('AND foo[tiab]')).toContain('leading Boolean operator');
    expect(syntaxProblems('foo[tiab] AND')).toContain('trailing Boolean operator');
    expect(syntaxProblems('a AND OR b')).toContain('consecutive Boolean operators');
    expect(syntaxProblems('a[tiab] AND b[tiab]')).toEqual([]);
    expect(syntaxProblems('')).toContain('empty query');
  });
  it('fires on a broken search string and regenerates a clean revision', () => {
    const s = gen(healthyConcepts);
    const broken = { ...s, searchString: `${s.searchString} AND (` };
    const r = critiqueStrategy({ strategy: broken });
    expect(types(r)).toContain('BROKEN_SYNTAX');
    expect(syntaxProblems(r.revised.searchString)).toEqual([]);
  });
  it('handles a null strategy without throwing', () => {
    const r = critiqueStrategy({ strategy: null });
    expect(types(r)).toEqual(['BROKEN_SYNTAX']);
    expect(r.revised).toBeNull();
  });
});

describe('UNSUPPORTED_FIELD_TAG', () => {
  it('fires when a controlled term is used on a database without a subject-heading field', () => {
    const cs = [
      { id: 'p', label: 'Population', terms: [{ text: 'heart failure', type: 'controlled', field: 'mesh', vocab: { mesh: 'Heart Failure' } }, ft('HFrEF')] },
      { id: 'i', label: 'Intervention', terms: [ft('sacubitril'), ft('valsartan')] },
    ];
    const r = critiqueStrategy({ strategy: gen(cs, F0, 'balanced', 'openalex'), hitCount: 500, hitKind: 'exact' });
    expect(types(r)).toContain('UNSUPPORTED_FIELD_TAG');
  });
  it('stays silent on PubMed, which supports MeSH', () => {
    const cs = [
      { id: 'p', label: 'Population', terms: [{ text: 'heart failure', type: 'controlled', field: 'mesh', vocab: { mesh: 'Heart Failure' } }, ft('HFrEF')] },
      { id: 'i', label: 'Intervention', terms: [ft('sacubitril'), ft('valsartan')] },
    ];
    expect(types(critiqueStrategy({ strategy: gen(cs), hitCount: 500, hitKind: 'exact' }))).not.toContain('UNSUPPORTED_FIELD_TAG');
  });
});

describe('DUPLICATE_CONCEPTS', () => {
  const cs = [
    { id: 'p', label: 'Population', terms: [ft('endoscopic ultrasound'), ft('biliary obstruction')] },
    { id: 'i', label: 'Intervention', terms: [ft('EUS'), ft('drainage')] }, // EUS ≡ endoscopic ultrasound
  ];
  const r = critiqueStrategy({ strategy: gen(cs), hitCount: 500, hitKind: 'exact' });
  it('fires on an equivalent term shared across concepts', () => {
    expect(types(r)).toContain('DUPLICATE_CONCEPTS');
  });
  it('revises by removing the duplicate from all but the first concept', () => {
    expect(r.revised).toBeTruthy();
    const allTerms = r.revised.blocks.flatMap((b) => b.terms.map((t) => t.text.toLowerCase()));
    const eusCount = allTerms.filter((t) => t === 'eus' || t === 'endoscopic ultrasound').length;
    expect(eusCount).toBe(1);
  });
});

describe('IMBALANCED_BLOCKS + LOW_SENSITIVITY', () => {
  it('fires IMBALANCED_BLOCKS on a large term-count disparity', () => {
    const cs = [
      { id: 'a', label: 'Big', terms: Array.from({ length: 6 }, (_, i) => ft(`t${i}`)) },
      { id: 'b', label: 'Thin', terms: [ft('solo')] }, // 6/1 = 6 > ratio 4
    ];
    expect(types(critiqueStrategy({ strategy: gen(cs), hitCount: 500, hitKind: 'exact' }))).toContain('IMBALANCED_BLOCKS');
  });
  it('fires LOW_SENSITIVITY below the recall floor and broadens', () => {
    const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact', seedRecall: 0.55 });
    expect(types(r)).toContain('LOW_SENSITIVITY');
    expect(r.revised.profile).toBe('broad');
  });
  it('marks recall below 0.5 as an error', () => {
    const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact', seedRecall: 0.4 });
    expect(r.issues.find((i) => i.type === 'LOW_SENSITIVITY').severity).toBe('error');
  });
  it('stays silent at healthy recall', () => {
    expect(types(critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact', seedRecall: 0.95 }))).not.toContain('LOW_SENSITIVITY');
  });
});

describe('sensitivity of add/remove-term variants', () => {
  it('sensitivityDelta flags a meaningful change and ignores a tiny one', () => {
    expect(sensitivityDelta({ base: 1000, count: 200 }).meaningful).toBe(true);
    expect(sensitivityDelta({ base: 1000, count: 1050 }).meaningful).toBe(false);
    expect(sensitivityDelta({ base: 0, count: 10 }).meaningful).toBe(false); // guarded divide
  });
  it('analyzeSensitivity labels direction + meaningfulness per variant', () => {
    const out = analyzeSensitivity({ base: 1000, variants: [{ term: 'x', change: 'remove', count: 300 }, { term: 'y', change: 'add', count: 1020 }] });
    expect(out[0]).toMatchObject({ term: 'x', change: 'remove', meaningful: true, direction: 'decrease' });
    expect(out[1]).toMatchObject({ term: 'y', change: 'add', meaningful: false });
  });
  it('feeds sibling analysis into suggestedEdits when provided', () => {
    const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact', siblingCounts: { base: 1000, variants: [{ term: 'x', change: 'remove', count: 300 }] } });
    expect(r.suggestedEdits.some((e) => e.term === 'x' && e.meaningful)).toBe(true);
  });
  it('adds no sensitivity edits when siblingCounts is absent', () => {
    const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 500, hitKind: 'exact' });
    expect(r.suggestedEdits).toEqual([]);
  });
});

describe('score + config', () => {
  it('subtracts an error penalty from the perfect score', () => {
    const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 0, hitKind: 'exact' });
    expect(r.score).toBe(0.7); // one error (-0.3)
  });
  it('honours a custom threshold config', () => {
    const r = critiqueStrategy({ strategy: gen(healthyConcepts), hitCount: 300, hitKind: 'exact', config: { minHits: 1000 } });
    expect(types(r)).toContain('TOO_FEW_HITS'); // 300 < custom 1000
    expect(DEFAULT_CRITIC_CONFIG.minHits).toBe(50); // defaults untouched
  });
});
