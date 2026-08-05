import { describe, it, expect } from 'vitest';
import {
  normalizeCanonical, validateCanonical, renderPlain, hashQuery, normalizeField,
  flattenTerms, quoteIfPhrase, findLiteralBooleanTerms, foldUnicodePunctuation,
  FIELD, QUERY_LIMITS,
} from '../../../server/pecanSearch/query/ast.js';

describe('query/ast — canonical model', () => {
  it('normalizes + caps a messy query, dropping empty terms/concepts', () => {
    const c = normalizeCanonical({
      concepts: [
        { id: 'a', label: 'A', op: 'OR', terms: [{ text: ' cancer ' }, { text: '' }] },
        { id: 'b', label: 'B', terms: [] }, // no terms → dropped
        { terms: [{ text: 'x', field: 'ti', truncate: true }] },
      ],
      filters: { dateFrom: '2010', languages: ['English', ''], pubTypes: [] },
    });
    expect(c.concepts).toHaveLength(2);
    expect(c.concepts[0].terms).toHaveLength(1);
    expect(c.concepts[0].terms[0].text).toBe('cancer');
    expect(c.concepts[1].terms[0].field).toBe(FIELD.TITLE);
    expect(c.filters.languages).toEqual(['English']);
  });

  it('normalizeField maps aliases and defaults to tiab', () => {
    expect(normalizeField('ti')).toBe(FIELD.TITLE);
    expect(normalizeField('AU')).toBe(FIELD.AUTHOR);
    expect(normalizeField('mesh')).toBe(FIELD.MESH);
    expect(normalizeField('garbage')).toBe(FIELD.TIAB);
  });

  it('validateCanonical fails an empty query and warns on a bad date', () => {
    expect(validateCanonical({ concepts: [] }).ok).toBe(false);
    const v = validateCanonical({ concepts: [{ terms: [{ text: 'x' }] }], filters: { dateFrom: 'soon' } });
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/date/i);
  });

  it('quoteIfPhrase only quotes multi-word terms', () => {
    expect(quoteIfPhrase('metformin')).toBe('metformin');
    expect(quoteIfPhrase('heart failure')).toBe('"heart failure"');
  });

  it('renderPlain ORs synonyms within a concept and joins concepts by the inter-concept op', () => {
    const s = renderPlain({ concepts: [{ op: 'AND', terms: [{ text: 'a' }, { text: 'b' }] }, { op: 'AND', terms: [{ text: 'c' }, { text: 'd' }] }], filters: { dateFrom: '2010', dateTo: '2020' } });
    expect(s).toContain('(a OR b)');     // terms within a concept are SYNONYMS → OR
    expect(s).toContain('(c OR d)');
    expect(s).toContain(') AND (');      // concepts joined by inter-concept op (default AND)
    expect(s).toMatch(/2010\.\.2020/);
  });

  it('honors an inter-concept OR operator between concepts', () => {
    const s = renderPlain({ concepts: [{ op: 'OR', terms: [{ text: 'a' }, { text: 'b' }] }, { op: 'AND', terms: [{ text: 'c' }] }], filters: {} });
    expect(s).toBe('(a OR b) OR c'); // concept[0].op='OR' joins it to the next concept with OR
  });

  it('defaults a missing inter-concept op to AND (never silently ORs concepts)', () => {
    const c = normalizeCanonical({ concepts: [{ terms: [{ text: 'a' }] }, { terms: [{ text: 'b' }] }] });
    expect(c.concepts[0].op).toBe('AND');
    expect(renderPlain(c)).toBe('a AND b');
  });

  it('findLiteralBooleanTerms flags standalone uppercase AND/OR/NOT inside a term', () => {
    const hits = findLiteralBooleanTerms({ concepts: [{ terms: [
      { text: 'stroke OR transient ischemic attack' },
      { text: 'heart failure' },          // clean phrase → not flagged
      { text: 'signs and symptoms' },      // lowercase "and" → not flagged
      { text: 'diabetes NOT type 1' },
    ] }] });
    expect(hits.map((h) => h.op).sort()).toEqual(['NOT', 'OR']);
    expect(validateCanonical({ concepts: [{ terms: [{ text: 'a AND b' }] }] }).warnings.join(' ')).toMatch(/searched literally/i);
  });

  it('hashQuery is stable and order-sensitive', () => {
    expect(hashQuery('abc')).toBe(hashQuery('abc'));
    expect(hashQuery('abc')).not.toBe(hashQuery('acb'));
    expect(hashQuery('abc')).toHaveLength(16);
  });

  it('enforces concept/term caps', () => {
    const many = { concepts: Array.from({ length: 100 }, (_, i) => ({ id: String(i), terms: [{ text: 't' + i }] })) };
    expect(normalizeCanonical(many).concepts.length).toBeLessThanOrEqual(QUERY_LIMITS.MAX_CONCEPTS);
  });

  it('flattenTerms returns every term', () => {
    expect(flattenTerms({ concepts: [{ op: 'OR', terms: [{ text: 'a' }, { text: 'b' }] }] })).toHaveLength(2);
  });
});

/* ══════════ 98.md §12 — normalizeCanonical field coercion + Unicode folding ═════ */

describe('query/ast — 98.md §12 builder-default controlled terms coerce to FIELD.MESH', () => {
  const vocab = { mesh: 'Diabetes Mellitus, Type 2' };

  it("coerces a builder-shaped controlled term (field:'tiab', vocab.mesh) to 'mesh'", () => {
    // The Search Builder stamps controlled terms with field:'tiab' (its field
    // selector is a free-text concept); without the coercion the manual preview
    // showed "X"[Mesh] while the automated run executed "X"[Title/Abstract].
    const c = normalizeCanonical({ concepts: [{ terms: [{ text: 't2dm', type: 'controlled', field: 'tiab', vocab }] }] });
    expect(c.concepts[0].terms[0].field).toBe(FIELD.MESH);
    expect(c.concepts[0].terms[0].type).toBe('controlled');
    expect(c.concepts[0].terms[0].vocab).toEqual(vocab);
  });

  it("every builder default (blank / 'tiab' / 'all' / 'tw') coerces for controlled terms", () => {
    for (const field of ['', 'tiab', 'all', 'tw', undefined]) {
      const c = normalizeCanonical({ concepts: [{ terms: [{ text: 'x', type: 'controlled', field, vocab }] }] });
      expect(c.concepts[0].terms[0].field).toBe(FIELD.MESH);
    }
  });

  it('only VOCABULARY fields (mesh/kw) pass through; ti/ab coerce too (review M13 — the client renderers ignore term.field for controlled terms, so field-respecting runs would silently diverge from the [Mesh] preview)', () => {
    const kw = normalizeCanonical({ concepts: [{ terms: [{ text: 'x', type: 'controlled', field: 'kw', vocab }] }] });
    expect(kw.concepts[0].terms[0].field).toBe(FIELD.KEYWORD);
    const ti = normalizeCanonical({ concepts: [{ terms: [{ text: 'x', type: 'controlled', field: 'ti', vocab }] }] });
    expect(ti.concepts[0].terms[0].field).toBe(FIELD.MESH);
    const ab = normalizeCanonical({ concepts: [{ terms: [{ text: 'x', type: 'controlled', field: 'ab', vocab }] }] });
    expect(ab.concepts[0].terms[0].field).toBe(FIELD.MESH);
    const mh = normalizeCanonical({ concepts: [{ terms: [{ text: 'x', type: 'controlled', field: 'mesh', vocab }] }] });
    expect(mh.concepts[0].terms[0].field).toBe(FIELD.MESH);
  });

  it('freetext terms NEVER coerce — their builder default stays tiab', () => {
    const c = normalizeCanonical({ concepts: [{ terms: [{ text: 'metformin', type: 'freetext', field: 'tiab' }] }] });
    expect(c.concepts[0].terms[0].field).toBe(FIELD.TIAB);
  });
});

describe('query/ast — 98.md §12 foldUnicodePunctuation rides normalization', () => {
  it('folds curly quotes/apostrophes to ASCII and NFC-normalizes term text', () => {
    expect(foldUnicodePunctuation('Crohn\u2019s \u201Cdisease\u201D')).toBe('Crohn\'s "disease"');
    expect(foldUnicodePunctuation('cafe\u0301')).toBe('caf\u00e9'); // NFC
  });
  it('normalizeCanonical applies the folding to every term text', () => {
    const c = normalizeCanonical({ concepts: [{ terms: [{ text: 'Crohn\u2019s disease' }] }] });
    expect(c.concepts[0].terms[0].text).toBe("Crohn's disease");
    // renderPlain therefore emits the ASCII form inside its quoted phrase
    expect(renderPlain(c)).toBe('"Crohn\'s disease"');
  });
});
