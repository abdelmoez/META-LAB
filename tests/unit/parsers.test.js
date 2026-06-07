/**
 * parsers.test.js
 * Unit tests for reference import parsers: parseRIS, parseBibTeX, parseNBIB,
 * detectAndParse, normTitle, dedupeRecords, and mkRecord.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRIS,
  parseBibTeX,
  parseNBIB,
  detectAndParse,
  normTitle,
  dedupeRecords,
  mkRecord,
} from '../../src/research-engine/import-export/parsers.js';

// ── Sample fixtures ────────────────────────────────────────────────────────────

const risText = `TY  - JOUR
AU  - Smith, J
AU  - Doe, A
TI  - Test Article Title
PY  - 2023
JO  - Test Journal
DO  - 10.1234/test.2023
AB  - This is the abstract text.
ER  -`;

const risTextTwo = `TY  - JOUR
AU  - Jones, B
TI  - Second Article
PY  - 2022
JO  - Another Journal
ER  -

TY  - JOUR
AU  - Brown, C
TI  - Third Article
PY  - 2021
JO  - Third Journal
ER  -`;

const bibtexText = `@article{smith2023,
  title = {BibTeX Test Article},
  author = {Smith, John and Doe, Jane},
  year = {2023},
  journal = {BibTeX Journal},
  doi = {10.5678/bibtex.2023},
  abstract = {BibTeX abstract here.}
}`;

const bibtexTextTwo = `@article{first2023,
  title = {First BibTeX Article},
  author = {Alpha, A},
  year = {2023},
  journal = {Journal One}
}

@article{second2022,
  title = {Second BibTeX Article},
  author = {Beta, B},
  year = {2022},
  journal = {Journal Two}
}`;

const nbibText = `PMID- 12345678
TI  - NBIB Test Article
AU  - Wilson, W
DP  - 2023 Jan
JT  - NBIB Journal
AB  - NBIB abstract.
LID - 10.9999/nbib.2023 [doi]`;

// ── normTitle ─────────────────────────────────────────────────────────────────
describe('normTitle', () => {
  it('lowercases input', () => {
    expect(normTitle('Hello World')).toBe('hello world');
  });

  it('replaces non-alphanumeric runs with a single space', () => {
    expect(normTitle('A: Test—Article!')).toBe('a test article');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normTitle('  title  ')).toBe('title');
  });

  it('handles empty string', () => {
    expect(normTitle('')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(normTitle(null)).toBe('');
    expect(normTitle(undefined)).toBe('');
  });

  it('collapses multiple spaces to one', () => {
    expect(normTitle('a   b   c')).toBe('a b c');
  });
});

// ── mkRecord ──────────────────────────────────────────────────────────────────
describe('mkRecord', () => {
  it('returns an object with all canonical fields', () => {
    const r = mkRecord({ title: 'Test', authors: 'Smith', year: '2023' });
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('title');
    expect(r).toHaveProperty('authors');
    expect(r).toHaveProperty('year');
    expect(r).toHaveProperty('journal');
    expect(r).toHaveProperty('doi');
    expect(r).toHaveProperty('pmid');
    expect(r).toHaveProperty('abstract');
    expect(r).toHaveProperty('source');
    expect(r).toHaveProperty('decision');
    expect(r).toHaveProperty('dupOf');
  });

  it('generates a unique id for each call', () => {
    const r1 = mkRecord({ title: 'A' });
    const r2 = mkRecord({ title: 'B' });
    expect(r1.id).not.toBe(r2.id);
  });

  it('strips DOI URL prefix', () => {
    const r = mkRecord({ doi: 'https://doi.org/10.1234/test' });
    expect(r.doi).toBe('10.1234/test');
  });

  it('strips dx.doi.org prefix', () => {
    const r = mkRecord({ doi: 'https://dx.doi.org/10.1234/test' });
    expect(r.doi).toBe('10.1234/test');
  });

  it('fills empty defaults for missing fields', () => {
    const r = mkRecord({});
    expect(r.title).toBe('');
    expect(r.authors).toBe('');
    expect(r.year).toBe('');
    expect(r.decision).toBe('');
    expect(r.dupOf).toBeNull();
  });
});

// ── parseRIS ──────────────────────────────────────────────────────────────────
describe('parseRIS', () => {
  it('parses a single RIS record', () => {
    const recs = parseRIS(risText);
    expect(recs).toHaveLength(1);
  });

  it('parsed record has correct title', () => {
    const recs = parseRIS(risText);
    expect(recs[0].title).toBe('Test Article Title');
  });

  it('parsed record has correct authors (joined by ;)', () => {
    const recs = parseRIS(risText);
    expect(recs[0].authors).toContain('Smith, J');
    expect(recs[0].authors).toContain('Doe, A');
  });

  it('parsed record has correct year', () => {
    const recs = parseRIS(risText);
    expect(recs[0].year).toBe('2023');
  });

  it('parsed record has correct journal', () => {
    const recs = parseRIS(risText);
    expect(recs[0].journal).toBe('Test Journal');
  });

  it('parsed record has correct DOI (stripped of URL prefix)', () => {
    const recs = parseRIS(risText);
    expect(recs[0].doi).toBe('10.1234/test.2023');
  });

  it('parsed record has abstract', () => {
    const recs = parseRIS(risText);
    expect(recs[0].abstract).toContain('abstract text');
  });

  it('parsed record has source set to "RIS"', () => {
    const recs = parseRIS(risText);
    expect(recs[0].source).toBe('RIS');
  });

  it('parses multiple records', () => {
    const recs = parseRIS(risTextTwo);
    expect(recs).toHaveLength(2);
  });

  it('returns empty array for empty string', () => {
    expect(parseRIS('')).toEqual([]);
  });

  it('returns empty array for text with no recognisable RIS tags', () => {
    expect(parseRIS('This is not a RIS file at all.')).toEqual([]);
  });

  it('each record has a unique id', () => {
    const recs = parseRIS(risTextTwo);
    const ids = recs.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ── parseBibTeX ───────────────────────────────────────────────────────────────
describe('parseBibTeX', () => {
  it('parses a single BibTeX entry', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs).toHaveLength(1);
  });

  it('parsed record has correct title', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs[0].title).toBe('BibTeX Test Article');
  });

  it('parsed record joins authors with ;', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs[0].authors).toContain('Smith, John');
    expect(recs[0].authors).toContain('Doe, Jane');
  });

  it('parsed record has correct year', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs[0].year).toBe('2023');
  });

  it('parsed record has correct journal', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs[0].journal).toBe('BibTeX Journal');
  });

  it('parsed record has correct DOI', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs[0].doi).toBe('10.5678/bibtex.2023');
  });

  it('parsed record has source set to "BibTeX"', () => {
    const recs = parseBibTeX(bibtexText);
    expect(recs[0].source).toBe('BibTeX');
  });

  it('parses multiple BibTeX entries', () => {
    const recs = parseBibTeX(bibtexTextTwo);
    expect(recs).toHaveLength(2);
  });

  it('returns empty array for empty string', () => {
    expect(parseBibTeX('')).toEqual([]);
  });
});

// ── parseNBIB ─────────────────────────────────────────────────────────────────
describe('parseNBIB', () => {
  it('parses a single NBIB record', () => {
    const recs = parseNBIB(nbibText);
    expect(recs).toHaveLength(1);
  });

  it('parsed record has correct title', () => {
    const recs = parseNBIB(nbibText);
    expect(recs[0].title).toBe('NBIB Test Article');
  });

  it('parsed record has correct pmid', () => {
    const recs = parseNBIB(nbibText);
    expect(recs[0].pmid).toBe('12345678');
  });

  it('parsed record has correct year', () => {
    const recs = parseNBIB(nbibText);
    expect(recs[0].year).toBe('2023');
  });

  it('parsed record has correct journal', () => {
    const recs = parseNBIB(nbibText);
    expect(recs[0].journal).toBe('NBIB Journal');
  });

  it('parsed record extracts doi from LID tag', () => {
    const recs = parseNBIB(nbibText);
    expect(recs[0].doi).toBe('10.9999/nbib.2023');
  });

  it('parsed record has source set to "PubMed"', () => {
    const recs = parseNBIB(nbibText);
    expect(recs[0].source).toBe('PubMed');
  });

  it('returns empty array for empty string', () => {
    expect(parseNBIB('')).toEqual([]);
  });
});

// ── detectAndParse ────────────────────────────────────────────────────────────
describe('detectAndParse', () => {
  it('detects RIS format from content', () => {
    const { records, format } = detectAndParse(risText);
    expect(format).toBe('RIS');
    expect(records).toHaveLength(1);
  });

  it('detects RIS from .ris extension', () => {
    const { format } = detectAndParse(risText, 'refs.ris');
    expect(format).toBe('RIS');
  });

  it('detects BibTeX format from content', () => {
    const { records, format } = detectAndParse(bibtexText);
    expect(format).toBe('BibTeX');
    expect(records).toHaveLength(1);
  });

  it('detects BibTeX from .bib extension', () => {
    const { format } = detectAndParse(bibtexText, 'refs.bib');
    expect(format).toBe('BibTeX');
  });

  it('detects NBIB format from content (PMID- tag)', () => {
    const { records, format } = detectAndParse(nbibText);
    expect(format).toBe('PubMed nbib');
    expect(records).toHaveLength(1);
  });

  it('detects NBIB from .nbib extension', () => {
    const { format } = detectAndParse(nbibText, 'refs.nbib');
    expect(format).toBe('PubMed nbib');
  });

  it('returns empty records and "unknown" format for unrecognised text', () => {
    const { records, format } = detectAndParse('This is plain text with no citation markers.');
    expect(records).toHaveLength(0);
    expect(format).toBe('unknown');
  });
});

// ── dedupeRecords ─────────────────────────────────────────────────────────────
describe('dedupeRecords', () => {
  it('adds new (non-duplicate) records', () => {
    const existing = parseRIS(risText);
    const incoming = parseBibTeX(bibtexText);
    const { merged, added, dupCount } = dedupeRecords(existing, incoming);
    expect(added).toBe(1);
    expect(dupCount).toBe(0);
    expect(merged).toHaveLength(2);
  });

  it('detects duplicate by DOI', () => {
    const r1 = mkRecord({ title: 'Article A', doi: '10.1234/test', year: '2023' });
    const r2 = mkRecord({ title: 'Article A copy', doi: '10.1234/test', year: '2023' });
    const { dupCount } = dedupeRecords([r1], [r2]);
    expect(dupCount).toBe(1);
  });

  it('detects duplicate by PMID', () => {
    const r1 = mkRecord({ title: 'Article B', pmid: '99999', year: '2023' });
    const r2 = mkRecord({ title: 'Article B copy', pmid: '99999', year: '2023' });
    const { dupCount } = dedupeRecords([r1], [r2]);
    expect(dupCount).toBe(1);
  });

  it('detects duplicate by normalised title + year', () => {
    const r1 = mkRecord({ title: 'The Test Article', year: '2023' });
    const r2 = mkRecord({ title: 'The Test Article', year: '2023' });
    const { dupCount } = dedupeRecords([r1], [r2]);
    expect(dupCount).toBe(1);
  });

  it('marks duplicate record with dupOf pointing to original id', () => {
    const r1 = mkRecord({ title: 'Duplicate', doi: '10.1/dup', year: '2022' });
    const r2 = mkRecord({ title: 'Duplicate copy', doi: '10.1/dup', year: '2022' });
    const { merged } = dedupeRecords([r1], [r2]);
    const dup = merged.find(r => r.id === r2.id);
    expect(dup.dupOf).toBe(r1.id);
  });

  it('handles empty existing list', () => {
    const incoming = parseRIS(risText);
    const { merged, added, dupCount } = dedupeRecords([], incoming);
    expect(added).toBe(1);
    expect(dupCount).toBe(0);
    expect(merged).toHaveLength(1);
  });

  it('handles empty incoming list', () => {
    const existing = parseRIS(risText);
    const { merged, added, dupCount } = dedupeRecords(existing, []);
    expect(added).toBe(0);
    expect(dupCount).toBe(0);
    expect(merged).toHaveLength(1);
  });
});
