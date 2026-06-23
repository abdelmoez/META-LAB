import { describe, it, expect } from 'vitest';
import {
  normalizeDoi, normalizePmid, normalizePmcid, normalizeYear, normalizeAuthors,
  cleanText, decodeEntities, normalizeRecord, toScreeningRecord,
} from '../../../server/pecanSearch/normalize.js';

describe('normalize — identifiers', () => {
  it('lowercases DOI + strips URL/doi: prefixes + trailing punctuation', () => {
    expect(normalizeDoi('https://doi.org/10.1000/ABC.123')).toBe('10.1000/abc.123');
    expect(normalizeDoi('doi: 10.5/X')).toBe('10.5/x');
    expect(normalizeDoi('10.1/y.')).toBe('10.1/y');
    expect(normalizeDoi('not-a-doi')).toBe('');
  });
  it('PMID keeps digits only; PMCID canonicalizes', () => {
    expect(normalizePmid('PMID: 12,345')).toBe('12345');
    expect(normalizePmcid('pmc 9999')).toBe('PMC9999');
    expect(normalizePmcid('PMC0007')).toBe('PMC7');
    expect(normalizePmcid('12345')).toBe('PMC12345');
  });
  it('year extracts a 4-digit publication year from messy dates', () => {
    expect(normalizeYear('2019 Jan-Feb')).toBe('2019');
    expect(normalizeYear('Spring 2008')).toBe('2008');
    expect(normalizeYear('n/a')).toBe('');
  });
});

describe('normalize — text + authors', () => {
  it('decodes entities and collapses whitespace', () => {
    expect(decodeEntities('A &amp; B &#x2014; C')).toBe('A & B — C');
    expect(cleanText('  hello\t\n  world  ')).toBe('hello world');
  });
  it('normalizes authors from array of objects and strings', () => {
    expect(normalizeAuthors([{ family: 'Smith', given: 'Jane' }, { family: 'Doe' }])).toBe('Smith Jane; Doe');
    expect(normalizeAuthors('A. Author; B. Writer')).toBe('A. Author; B. Writer');
  });
});

describe('normalize — record + screening shape', () => {
  it('produces a canonical record with safe url + arrays', () => {
    const r = normalizeRecord({
      title: 'A &amp; B', doi: '10.1/x', pmid: '7', authors: [{ family: 'Q' }],
      year: '2021 Jan', keywords: ['a', 'b'], url: 'javascript:alert(1)',
    }, { provider: 'pubmed' });
    expect(r.title).toBe('A & B');
    expect(r.url).toBe('');                 // unsafe scheme stripped
    expect(r.keywords).toEqual(['a', 'b']);
    expect(r.normalizationVersion).toMatch(/pecan-norm/);
  });
  it('toScreeningRecord matches the import landing shape', () => {
    const r = normalizeRecord({ title: 'T', authors: [{ family: 'Q' }], year: '2020', doi: '10.1/x' }, { provider: 'crossref' });
    const s = toScreeningRecord(r, { sourceDb: 'crossref' });
    expect(s).toMatchObject({ title: 'T', authors: 'Q', year: '2020', doi: '10.1/x', sourceDb: 'crossref', source: 'crossref' });
    expect(typeof s.keywords).toBe('string');
  });
  it('never throws on a malformed input', () => {
    expect(() => normalizeRecord(null, {})).not.toThrow();
    expect(() => normalizeRecord({ authors: 42, keywords: {} }, {})).not.toThrow();
  });
});
