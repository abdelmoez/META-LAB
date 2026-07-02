/**
 * searchVersionDiff.test.js — 69.md §7. Pure diff between two saved Search-Builder
 * strategy snapshots (concepts/terms/databases/filters). Deterministic, no I/O.
 */
import { describe, it, expect } from 'vitest';
import { diffStrategies } from '../../src/research-engine/searchBuilder/versionDiff.js';

const concept = (label, terms, extra = {}) => ({
  id: Math.random().toString(36).slice(2), // volatile render id — must NOT affect the diff
  label,
  op: 'AND',
  terms: terms.map((t) => (typeof t === 'string' ? { text: t, field: 'tiab' } : t)),
  ...extra,
});

describe('diffStrategies — no change', () => {
  it('two identical strategies produce an empty, unchanged diff', () => {
    const a = { concepts: [concept('Population', ['diabetes', 'T2DM'])], databases: ['pubmed'], filters: {} };
    const b = { concepts: [concept('Population', ['diabetes', 'T2DM'])], databases: ['pubmed'], filters: {} };
    const d = diffStrategies(a, b);
    expect(d.changed).toBe(false);
    expect(d.concepts).toEqual({ added: [], removed: [] });
    expect(d.terms).toEqual([]);
    expect(d.databases).toEqual({ added: [], removed: [] });
    expect(d.filters).toEqual([]);
  });

  it('ignores volatile render ids and term key order (matches by label + normalized text)', () => {
    const a = { concepts: [concept('Population', ['Diabetes', 'T2DM'])] };
    const b = { concepts: [concept('Population', ['T2DM', 'diabetes'])] }; // reordered + case
    expect(diffStrategies(a, b).changed).toBe(false);
  });
});

describe('diffStrategies — concepts added / removed', () => {
  it('detects a concept added in B and one removed from A', () => {
    const a = { concepts: [concept('Population', ['diabetes']), concept('Outcome', ['mortality'])] };
    const b = { concepts: [concept('Population', ['diabetes']), concept('Intervention', ['SGLT2'])] };
    const d = diffStrategies(a, b);
    expect(d.concepts.added).toEqual(['Intervention']);
    expect(d.concepts.removed).toEqual(['Outcome']);
    expect(d.changed).toBe(true);
    // A wholly-new/removed concept is NOT double-reported under terms.
    expect(d.terms.map((t) => t.concept)).not.toContain('Intervention');
    expect(d.terms.map((t) => t.concept)).not.toContain('Outcome');
  });

  it('matches concepts by PICO field key even when the label was renamed', () => {
    const a = { concepts: [concept('Population', ['diabetes'], { picoField: 'P' })] };
    const b = { concepts: [concept('Patients', ['diabetes', 'T2DM'], { picoField: 'P' })] };
    const d = diffStrategies(a, b);
    // Same PICO field → same concept; only a term was added, no add/remove of concepts.
    expect(d.concepts).toEqual({ added: [], removed: [] });
    expect(d.terms).toEqual([{ concept: 'Patients', added: ['T2DM'], removed: [] }]);
  });
});

describe('diffStrategies — terms per concept', () => {
  it('reports term additions and removals within a shared concept', () => {
    const a = { concepts: [concept('Population', ['diabetes', 'obesity'])] };
    const b = { concepts: [concept('Population', ['diabetes', 'T2DM'])] };
    const d = diffStrategies(a, b);
    expect(d.terms).toEqual([{ concept: 'Population', added: ['T2DM'], removed: ['obesity'] }]);
    expect(d.changed).toBe(true);
  });

  it('a term is "changed" when its field changes (field is part of the identity)', () => {
    const a = { concepts: [concept('Population', [{ text: 'diabetes', field: 'tiab' }])] };
    const b = { concepts: [concept('Population', [{ text: 'diabetes', field: 'title' }])] };
    const d = diffStrategies(a, b);
    expect(d.terms).toEqual([{ concept: 'Population', added: ['diabetes'], removed: ['diabetes'] }]);
  });
});

describe('diffStrategies — databases', () => {
  it('reports databases toggled on and off', () => {
    const a = { concepts: [], databases: ['pubmed', 'embase'] };
    const b = { concepts: [], databases: ['pubmed', 'scopus'] };
    const d = diffStrategies(a, b);
    expect(d.databases.added).toEqual(['scopus']);
    expect(d.databases.removed).toEqual(['embase']);
    expect(d.changed).toBe(true);
  });
});

describe('diffStrategies — filters', () => {
  it('reports per-field filter changes with from/to values', () => {
    const a = { concepts: [], filters: { dateFrom: '2010', dateTo: '', languages: ['en'], pubTypes: [] } };
    const b = { concepts: [], filters: { dateFrom: '2015', dateTo: '2025', languages: ['en', 'es'], pubTypes: ['RCT'] } };
    const d = diffStrategies(a, b);
    const byField = Object.fromEntries(d.filters.map((f) => [f.field, f]));
    expect(byField.dateFrom).toEqual({ field: 'dateFrom', from: '2010', to: '2015' });
    expect(byField.dateTo).toEqual({ field: 'dateTo', from: '', to: '2025' });
    expect(byField.languages).toEqual({ field: 'languages', from: ['en'], to: ['en', 'es'] });
    expect(byField.pubTypes).toEqual({ field: 'pubTypes', from: [], to: ['RCT'] });
    expect(d.changed).toBe(true);
  });

  it('language order does not count as a change', () => {
    const a = { concepts: [], filters: { languages: ['en', 'es'] } };
    const b = { concepts: [], filters: { languages: ['es', 'en'] } };
    expect(diffStrategies(a, b).filters).toEqual([]);
  });
});

describe('diffStrategies — defensive input handling', () => {
  it('tolerates null / empty / malformed strategies', () => {
    expect(diffStrategies(null, null).changed).toBe(false);
    expect(diffStrategies({}, {}).changed).toBe(false);
    expect(diffStrategies({ concepts: 'bad' }, { concepts: null }).changed).toBe(false);
  });

  it('an empty strategy vs a populated one reports the populated concepts as added', () => {
    const b = { concepts: [concept('Population', ['diabetes'])], databases: ['pubmed'] };
    const d = diffStrategies({}, b);
    expect(d.concepts.added).toEqual(['Population']);
    expect(d.databases.added).toEqual(['pubmed']);
    expect(d.changed).toBe(true);
  });

  it('drops empty-text terms so they never appear as phantom diffs', () => {
    const a = { concepts: [concept('Population', [{ text: '  ', field: 'tiab' }, { text: 'diabetes' }])] };
    const b = { concepts: [concept('Population', [{ text: 'diabetes' }])] };
    expect(diffStrategies(a, b).changed).toBe(false);
  });
});
