/**
 * searchInterpretation.test.js — 100.md §§6-10.
 *
 * The plain-language interpretation of a search strategy. Two properties matter most:
 *  1. it says the SAME thing the compilers do (same live-term rule, same operator
 *     chaining) — otherwise it explains a search Pecan is not running (100.md §9);
 *  2. it never leaks Boolean / MeSH / field-tag syntax into the beginner layer.
 */
import { describe, it, expect } from 'vitest';
import {
  interpretStrategy, describeTerm, describeLimits, joinWords, TERM_KIND,
} from '../../src/research-engine/searchBuilder/interpretation.js';
import { compileStrategy } from '../../src/research-engine/searchBuilder/compilers/index.js';

const ft = (text, extra = {}) => ({ id: text, text, type: 'freetext', field: 'tiab', ...extra });
const mesh = (text, heading, extra = {}) => ({ id: text, text, type: 'controlled', field: 'tiab', vocab: { mesh: heading, meshUI: 'D000000' }, ...extra });
const grp = (id, label, terms, op = 'AND') => ({ id, label, op, terms });

describe('describeTerm — one plain sentence per term', () => {
  it('reads a single word, a phrase and a truncated stem differently', () => {
    expect(describeTerm(ft('metformin'))).toMatchObject({
      kind: TERM_KIND.WORD, reading: 'the word “metformin” in the title or abstract',
    });
    expect(describeTerm(ft('type 2 diabetes'))).toMatchObject({
      kind: TERM_KIND.PHRASE, reading: 'the exact phrase “type 2 diabetes” in the title or abstract',
    });
    expect(describeTerm(ft('diabet', { truncate: true }))).toMatchObject({
      kind: TERM_KIND.PREFIX, reading: 'any word starting with “diabet” in the title or abstract',
    });
  });

  it('names the field scope in words, never as a tag', () => {
    expect(describeTerm(ft('x', { field: 'ti' })).reading).toContain('in the title');
    expect(describeTerm(ft('x', { field: 'ab' })).reading).toContain('in the abstract');
    expect(describeTerm(ft('x', { field: 'all' })).reading).toContain('anywhere in the record');
  });

  it('describes a subject heading by its MEANING and its cross-database behaviour', () => {
    const d = describeTerm(mesh('type 2 diabetes', 'Diabetes Mellitus, Type 2'));
    expect(d.kind).toBe(TERM_KIND.SUBJECT);
    // The natural form, because that is what non-MeSH databases actually search.
    expect(d.text).toBe('Type 2 Diabetes Mellitus');
    expect(d.reading).toContain('filed under the topic');
    expect(d.reading).toContain('where a database has no subject list');
    // No syntax anywhere.
    expect(d.reading).not.toMatch(/\[Mesh\]|MESH:|\/exp|MH |tiab/);
  });

  it('mentions narrower topics only when explosion is on AND we have the data', () => {
    const withKids = { ...mesh('t2d', 'Diabetes Mellitus, Type 2'), vocab: { mesh: 'Diabetes Mellitus, Type 2', children: ['Prediabetic State'] } };
    expect(describeTerm(withKids).reading).toContain('plus the 1 more specific topic under it');
    expect(describeTerm({ ...withKids, noExplode: true }).reading).not.toContain('more specific topic');
    expect(describeTerm(mesh('x', 'X')).reading).not.toContain('more specific topic');
  });

  it('drops blank terms', () => {
    expect(describeTerm(ft('   '))).toBeNull();
    expect(describeTerm(null)).toBeNull();
  });
});

describe('describeLimits + joinWords', () => {
  it('renders every limit shape in words', () => {
    expect(describeLimits({ dateFrom: '2010', dateTo: '2025' })).toEqual(['Published between 2010 and 2025.']);
    expect(describeLimits({ dateFrom: '2010' })).toEqual(['Published in 2010 or later.']);
    expect(describeLimits({ dateTo: '2025' })).toEqual(['Published up to 2025.']);
    expect(describeLimits({ languages: ['en', 'es'] })).toEqual(['Written in English or Spanish.']);
    expect(describeLimits({ pubTypes: ['Randomized Controlled Trial'] })).toEqual(['Only Randomized Controlled Trial articles.']);
    expect(describeLimits({})).toEqual([]);
    expect(describeLimits(null)).toEqual([]);
  });
  it('joins lists grammatically', () => {
    expect(joinWords([])).toBe('');
    expect(joinWords(['a'])).toBe('a');
    expect(joinWords(['a', 'b'])).toBe('a and b');
    expect(joinWords(['a', 'b', 'c'], 'or')).toBe('a, b or c');
  });
});

describe('interpretStrategy', () => {
  const STRATEGY = {
    concepts: [
      grp('c1', 'Type 2 Diabetes', [mesh('type 2 diabetes', 'Diabetes Mellitus, Type 2'), ft('type 2 diabetes')]),
      grp('c2', 'Metformin', [ft('metformin'), ft('glucophage')]),
      grp('c3', 'Mortality', [ft('mortality'), ft('death')]),
    ],
    filters: {},
  };

  it('produces the 100.md §7 shape: a summary plus one block per concept', () => {
    const m = interpretStrategy(STRATEGY);
    expect(m.isEmpty).toBe(false);
    expect(m.summary).toBe('Find articles about Type 2 Diabetes, and also about Metformin, and also about Mortality.');
    expect(m.groups.map((g) => g.name)).toEqual(['Type 2 Diabetes', 'Metformin', 'Mortality']);
    expect(m.groups[0].join).toBeNull();
    expect(m.groups[1].join).toBe('AND');
    expect(m.groups[1].joinReading).toBe('the article must ALSO be about:');
    expect(m.groups[0].anyReading).toBe('The article can match any one of these:');
  });

  it('reads a single-term concept as a requirement, not a choice', () => {
    const m = interpretStrategy({ concepts: [grp('c1', 'Aspirin', [ft('aspirin')])], filters: {} });
    expect(m.groups[0].anyReading).toBe('The article has to match:');
  });

  it('follows the SAME operator-chaining rule as the compiler (§9)', () => {
    // concept.op joins to the NEXT concept, and only concepts with live terms take part.
    const s = {
      concepts: [
        grp('a', 'A', [ft('a')], 'OR'),
        grp('empty', 'Empty', []),
        grp('b', 'B', [ft('b')], 'AND'),
        grp('c', 'C', [ft('c')]),
      ],
      filters: {},
    };
    const m = interpretStrategy(s);
    expect(m.groups.map((g) => [g.name, g.join])).toEqual([['A', null], ['B', 'OR'], ['C', 'AND']]);
    expect(m.summary).toBe('Find articles about A, or about B, and also about C.');
    expect(m.skipped).toEqual(['Empty']);
    // The compiler agrees: A OR B, then AND C.
    expect(compileStrategy(s, 'pubmed').query).toBe('((a[tiab] OR b[tiab]) AND c[tiab])');
  });

  it('ignores disabled terms exactly as the compiler does (85.md A1 liveness)', () => {
    const s = { concepts: [grp('c1', 'C', [ft('kept'), ft('dropped', { disabled: true })])], filters: {} };
    const m = interpretStrategy(s);
    expect(m.groups[0].terms).toHaveLength(1);
    expect(m.groups[0].terms[0].text).toBe('kept');
    expect(compileStrategy(s, 'pubmed').query).toBe('kept[tiab]');
  });

  it('excludes the legacy time-frame group (it never compiles)', () => {
    const s = { concepts: [grp('c1', 'C', [ft('x')]), { id: 't', label: 'Timeframe', picoField: 'T', op: 'AND', terms: [], note: '2010-2020' }], filters: {} };
    const m = interpretStrategy(s);
    expect(m.groups).toHaveLength(1);
    expect(m.skipped).toEqual([]);
  });

  it('carries the limits and stays empty-safe', () => {
    expect(interpretStrategy({ ...STRATEGY, filters: { dateFrom: '2010' } }).limits).toEqual(['Published in 2010 or later.']);
    const empty = interpretStrategy({ concepts: [], filters: {} });
    expect(empty).toMatchObject({ isEmpty: true, summary: '', groups: [], limits: [] });
    expect(interpretStrategy(null).isEmpty).toBe(true);
    expect(interpretStrategy({ concepts: 'junk' }).isEmpty).toBe(true);
  });

  it('falls back to a positional name for an unnamed concept', () => {
    const m = interpretStrategy({ concepts: [grp('c1', '', [ft('x')])], filters: {} });
    expect(m.groups[0].name).toBe('Concept 1');
  });

  it('never emits Boolean or database syntax anywhere in the model (100.md §6)', () => {
    const all = JSON.stringify(interpretStrategy({ ...STRATEGY, filters: { dateFrom: '2010', languages: ['en'] } }));
    for (const syntax of ['[Mesh]', '[tiab]', 'TITLE-ABS-KEY', '/exp', '(MH ', 'DE "', 'MESH:', ':ti,ab']) {
      expect(all).not.toContain(syntax);
    }
  });

  it('stays in sync with the strategy across every edit 100.md §9 lists', () => {
    // Pure function of the state ⇒ "live" is structural, not a refresh mechanism.
    const base = { concepts: [grp('c1', 'A', [ft('a')])], filters: {} };
    const addConcept = { concepts: [...base.concepts, grp('c2', 'B', [ft('b')])], filters: {} };
    expect(interpretStrategy(addConcept).groups).toHaveLength(2);

    const addSynonym = { concepts: [grp('c1', 'A', [ft('a'), ft('a2')])], filters: {} };
    expect(interpretStrategy(addSynonym).groups[0].terms).toHaveLength(2);

    const flipped = { concepts: [grp('c1', 'A', [ft('a')], 'OR'), grp('c2', 'B', [ft('b')])], filters: {} };
    expect(interpretStrategy(flipped).groups[1].join).toBe('OR');

    const withVocab = { concepts: [grp('c1', 'A', [ft('a'), mesh('a', 'Alpha')])], filters: {} };
    expect(interpretStrategy(withVocab).groups[0].terms.map((t) => t.kind))
      .toEqual([TERM_KIND.WORD, TERM_KIND.SUBJECT]);

    const reordered = { concepts: [addConcept.concepts[1], addConcept.concepts[0]], filters: {} };
    expect(interpretStrategy(reordered).groups.map((g) => g.name)).toEqual(['B', 'A']);
  });
});
