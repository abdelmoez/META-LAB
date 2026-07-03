/**
 * searchStrategyGenerator.test.js — P11 Task 1. Deterministic, network-free rendering
 * of the saved concept model into PubMed + OpenAlex Boolean strategies across the
 * broad / balanced / precise profiles, with per-block explanations + warnings.
 */
import { describe, it, expect } from 'vitest';
import {
  generateStrategies, generateStrategyFor, registerRenderer, listRenderers,
  hasRenderer, databaseSupportsControlled, PROFILES,
} from '../../src/research-engine/searchBuilder/strategyGenerator.js';

/** Population (MeSH + two free-text synonyms) AND Intervention (two synonyms). */
const concepts = [
  { id: 'p', label: 'Population', picoField: 'P', op: 'AND', terms: [
    { text: 'heart failure', type: 'controlled', field: 'mesh', vocab: { mesh: 'Heart Failure' } },
    { text: 'heart failure', type: 'freetext', field: 'tiab' },
    { text: 'HFrEF', type: 'freetext', field: 'tiab' },
  ] },
  { id: 'i', label: 'Intervention', picoField: 'I', op: 'AND', terms: [
    { text: 'endoscopic ultrasound', type: 'freetext', field: 'tiab' },
    { text: 'EUS', type: 'freetext', field: 'tiab' },
  ] },
];

const strat = (db, profile, filters) => generateStrategies({ concepts, databases: [db], filters, options: { profiles: [profile] } }).strategies[0];

describe('PubMed rendering (balanced)', () => {
  const s = strat('pubmed', 'balanced');
  it('renders MeSH via [Mesh] and free-text via [tiab]', () => {
    expect(s.searchString).toContain('"Heart Failure"[Mesh]');
    expect(s.searchString).toContain('"heart failure"[tiab]'); // phrase → quoted
    expect(s.searchString).toContain('HFrEF[tiab]');
    expect(s.searchString).toContain('"endoscopic ultrasound"[tiab]');
    expect(s.searchString).toContain('EUS[tiab]');
  });
  it('ORs synonyms within a concept and ANDs concepts', () => {
    expect(s.searchString).toContain(' OR ');
    expect(s.searchString).toContain(') AND (');
  });
  it('separates MeSH from free-text in the block, with field tags + explanation', () => {
    const p = s.blocks[0];
    expect(p.mesh).toEqual(['"Heart Failure"[Mesh]']);
    expect(p.freeText.length).toBe(2);
    expect(p.fieldTags).toContain('Mesh');
    expect(p.fieldTags).toContain('tiab');
    expect(p.explanation).toContain('subject heading');
    expect(p.explanation).toContain('free-text');
  });
});

describe('OpenAlex rendering', () => {
  const s = strat('openalex', 'balanced', { dateFrom: '2010', languages: ['en'] });
  it('uses the title_and_abstract.search field (balanced)', () => {
    expect(s.searchString.startsWith('title_and_abstract.search:')).toBe(true);
  });
  it('has no subject-heading field — MeSH terms searched as free text (warning)', () => {
    expect(s.warnings.some((w) => w.type === 'UNSUPPORTED_FIELD_TAG')).toBe(true);
    expect(databaseSupportsControlled('openalex')).toBe(false);
    expect(s.searchString).not.toContain('[Mesh]');
  });
  it('appends filters in OpenAlex comma syntax with ISO dates + language codes', () => {
    expect(s.searchString).toContain('from_publication_date:2010-01-01');
    expect(s.searchString).toContain('language:en');
  });
  it('scope field changes with the profile (broad=default, precise=title)', () => {
    expect(strat('openalex', 'broad').searchString.startsWith('default.search:')).toBe(true);
    expect(strat('openalex', 'precise').searchString.startsWith('title.search:')).toBe(true);
  });
});

describe('profiles differ correctly (broad vs balanced vs precise)', () => {
  const broad = strat('pubmed', 'broad');
  const balanced = strat('pubmed', 'balanced');
  const precise = strat('pubmed', 'precise');
  it('broad uses [tw] + exploded MeSH + truncates single words', () => {
    expect(broad.searchString).toContain('[tw]');
    expect(broad.searchString).toContain('"Heart Failure"[Mesh]');
    expect(broad.searchString).toContain('HFrEF*[tw]'); // single-word truncation
  });
  it('balanced uses [tiab] + exploded MeSH, no truncation', () => {
    expect(balanced.searchString).toContain('[tiab]');
    expect(balanced.searchString).toContain('"Heart Failure"[Mesh]');
    expect(balanced.searchString).not.toContain('HFrEF*');
  });
  it('precise uses major-topic non-exploded MeSH', () => {
    expect(precise.searchString).toContain('"Heart Failure"[Majr:NoExp]');
    expect(precise.searchString).not.toContain('[tw]');
  });
  it('all three rendered strings are distinct', () => {
    expect(new Set([broad.searchString, balanced.searchString, precise.searchString]).size).toBe(3);
  });
});

describe('filter strictness across profiles', () => {
  const filters = { dateFrom: '2015', languages: ['en'], pubTypes: ['Randomized Controlled Trial'] };
  it('balanced keeps all limits (date, language, pubtype)', () => {
    const s = strat('pubmed', 'balanced', filters);
    expect(s.searchString).toContain('"2015"[Date - Publication]');
    expect(s.searchString).toContain('English[Language]');
    expect(s.searchString).toContain('"Randomized Controlled Trial"[Publication Type]');
    expect(s.filters.languages).toEqual(['en']);
  });
  it('broad drops language + pubtype limits (keeps date) and warns', () => {
    const s = strat('pubmed', 'broad', filters);
    expect(s.filters.languages).toEqual([]);
    expect(s.filters.pubTypes).toEqual([]);
    expect(s.searchString).not.toContain('[Language]');
    expect(s.searchString).toContain('"2015"[Date - Publication]');
    expect(s.warnings.filter((w) => w.type === 'RELAXED_FILTER').length).toBe(2);
  });
});

describe('warnings: narrow + unbalanced + unsupported database', () => {
  it('warns on a single rare term with no known synonyms', () => {
    const c = [{ id: 'x', label: 'Topic', terms: [{ text: 'zulliximab', type: 'freetext', field: 'tiab' }] }];
    const s = generateStrategyFor(c, 'pubmed', { dateFrom: '', dateTo: '', languages: [], pubTypes: [] }, 'balanced');
    const w = s.warnings.find((x) => x.type === 'NARROW_CONCEPT');
    expect(w).toBeTruthy();
    expect(w.message).toContain('no known synonyms');
  });
  it('warns when concept term counts are unbalanced', () => {
    const c = [
      { id: 'a', label: 'Big', terms: Array.from({ length: 5 }, (_, i) => ({ text: `t${i}`, type: 'freetext', field: 'tiab' })) },
      { id: 'b', label: 'Thin', terms: [{ text: 'solo', type: 'freetext', field: 'tiab' }] },
    ];
    const s = generateStrategyFor(c, 'pubmed', { dateFrom: '', dateTo: '', languages: [], pubTypes: [] }, 'balanced');
    expect(s.warnings.some((w) => w.type === 'IMBALANCED_BLOCKS')).toBe(true);
  });
  it('falls back to a generic rendering + note for an unsupported database', () => {
    const out = generateStrategies({ concepts, databases: ['scopus'], options: { profiles: ['balanced'] } });
    expect(hasRenderer('scopus')).toBe(false);
    expect(out.notes.some((n) => n.includes('scopus'))).toBe(true);
    expect(out.strategies[0].warnings.some((w) => w.type === 'UNSUPPORTED_DATABASE')).toBe(true);
    expect(out.strategies[0].searchString).toContain(' AND '); // still AND-joins concepts
  });
});

describe('extension point + defaults', () => {
  it('registerRenderer adds a database to the registry', () => {
    registerRenderer({
      id: 'testdb', label: 'TestDB', supportsControlled: false,
      freeTagLabel: () => 'kw', freeToken: (t) => String(t.text),
      compose: (blockQs) => blockQs.join(' & '),
    });
    expect(listRenderers()).toContain('testdb');
    const s = strat('testdb', 'balanced');
    expect(s.searchString).toContain(' & ');
  });
  it('defaults to PubMed + all three profiles when unspecified', () => {
    const out = generateStrategies({ concepts });
    expect(out.strategies.map((x) => `${x.database}:${x.profile}`)).toEqual(PROFILES.map((p) => `pubmed:${p}`));
  });
});

describe('degenerate inputs never throw', () => {
  it('handles no concepts', () => {
    const out = generateStrategies({ concepts: [], databases: ['pubmed'] });
    expect(out.notes.some((n) => /No concepts/.test(n))).toBe(true);
    expect(out.strategies[0].searchString).toBe('');
    expect(out.strategies[0].warnings.some((w) => w.type === 'NO_CONCEPTS')).toBe(true);
  });
  it('handles a completely empty call', () => {
    expect(() => generateStrategies()).not.toThrow();
    expect(() => generateStrategies({})).not.toThrow();
  });
  it('drops empty concepts with a warning', () => {
    const c = [{ id: 'a', label: 'Has terms', terms: [{ text: 'sepsis', type: 'freetext', field: 'tiab' }] }, { id: 'b', label: 'Empty', terms: [] }];
    const s = generateStrategyFor(c, 'pubmed', { dateFrom: '', dateTo: '', languages: [], pubTypes: [] }, 'balanced');
    expect(s.blocks.length).toBe(1);
    expect(s.warnings.some((w) => w.type === 'EMPTY_CONCEPT')).toBe(true);
  });
});
