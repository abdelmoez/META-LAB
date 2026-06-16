/**
 * parsers-broader.test.js — CSV / TXT / CIW import parsers (roadmap 1.4).
 * Pure parsers; fixtures in tests/fixtures/import. Existing RIS/BibTeX/NBIB
 * detection must remain unchanged (guarded below).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseCSV, parseTXT, parseCIW, detectAndParse, parseRIS,
} from '../../src/research-engine/import-export/parsers.js';

const fx = name => readFileSync(
  fileURLToPath(new URL(`../fixtures/import/${name}`, import.meta.url)), 'utf8');

describe('parseCSV', () => {
  const recs = parseCSV(fx('sample.csv'));

  it('parses every data row into a canonical record', () => {
    expect(recs).toHaveLength(3);
    recs.forEach(r => { expect(r).toHaveProperty('id'); expect(r.source).toBe('CSV'); expect(r.dupOf).toBeNull(); });
  });

  it('maps headers case-insensitively to canonical fields', () => {
    const r = recs[0];
    expect(r.title).toBe('Effects of X on Y outcomes');
    expect(r.authors).toBe('Smith, J; Jones, A');
    expect(r.year).toBe('2020');
    expect(r.journal).toBe('Journal of Things');
    expect(r.doi).toBe('10.1000/abc123');
    expect(r.pmid).toBe('12345678');
    expect(r.url).toBe('https://example.org/a');
    expect(r.keywords).toBe('hypertension; cohort');
  });

  it('honours quoted commas inside fields', () => {
    expect(recs[1].title).toBe('A, B, and C: a comparative study');
    expect(recs[1].doi).toBe('10.1000/def456');
  });

  it('omits url/keywords keys when absent (no empty noise)', () => {
    expect(recs[1].pmid).toBe('');
    expect(recs[1]).not.toHaveProperty('url');
    expect(recs[1]).not.toHaveProperty('keywords');
  });

  it('handles a title-only row gracefully', () => {
    expect(recs[2].title).toBe('Minimal title only row');
    expect(recs[2].doi).toBe('');
  });

  it('returns [] when the header is not a reference table', () => {
    expect(parseCSV('foo,bar,baz\n1,2,3')).toEqual([]);
  });

  it('auto-detects a semicolon delimiter', () => {
    const r = parseCSV('Title;DOI;Year\nA paper;10.1/x;2020');
    expect(r).toHaveLength(1);
    expect(r[0].doi).toBe('10.1/x');
  });
});

describe('parseCIW (Web of Science tagged)', () => {
  const recs = parseCIW(fx('sample.ciw'));

  it('parses PT…ER blocks, ignoring the FN/VR/EF file header', () => {
    expect(recs).toHaveLength(2);
    expect(recs.every(r => r.source === 'CIW')).toBe(true);
  });

  it('prefers AF full names and joins continuation authors', () => {
    expect(recs[0].authors).toBe('Smith, John Q.; Jones, Alice B.');
  });

  it('joins multi-line title/abstract and collects keywords', () => {
    expect(recs[0].title).toBe('Machine learning for systematic reviews in clinical medicine');
    expect(recs[0].abstract).toBe('We present a method. It works well.');
    expect(recs[0].keywords).toBe('machine learning; screening; automation');
    expect(recs[0].journal).toBe('JOURNAL OF EVIDENCE SYNTHESIS');
    expect(recs[0].year).toBe('2021');
    expect(recs[0].doi).toBe('10.1234/jes.2021.001');
    expect(recs[0].pmid).toBe('99887766');
  });

  it('handles a record with only AU + no keywords', () => {
    expect(recs[1].authors).toBe('Brown, K');
    expect(recs[1]).not.toHaveProperty('keywords');
    expect(recs[1].doi).toBe('10.5555/medinf.2018.42');
  });
});

describe('parseTXT', () => {
  it('parses a tab-delimited table with a recognisable header', () => {
    const r = parseTXT('Title\tDOI\tYear\nFirst paper\t10.1/aaa\t2020\nSecond paper\t10.1/bbb\t2021');
    expect(r).toHaveLength(2);
    expect(r[0].title).toBe('First paper');
    expect(r[0].doi).toBe('10.1/aaa');
    expect(r[1].year).toBe('2021');
  });

  it('falls back to one title per line for unstructured text', () => {
    const r = parseTXT('A first study title\nA second study title\n');
    expect(r).toHaveLength(2);
    expect(r[0].title).toBe('A first study title');
    expect(r[0].source).toBe('TXT');
  });
});

describe('detectAndParse routing (new formats added, old preserved)', () => {
  it('routes .ciw and WoS content to parseCIW', () => {
    expect(detectAndParse(fx('sample.ciw'), 'wos.ciw').format).toBe('CIW (Web of Science)');
    expect(detectAndParse(fx('sample.ciw'), '').format).toBe('CIW (Web of Science)');
  });

  it('routes .csv and reference-table content to parseCSV', () => {
    expect(detectAndParse(fx('sample.csv'), 'refs.csv').format).toBe('CSV');
    expect(detectAndParse(fx('sample.csv'), '').format).toBe('CSV');
  });

  it('routes .txt to parseTXT', () => {
    expect(detectAndParse('Title\tDOI\nA\t10.1/x', 'data.txt').format).toBe('TXT');
  });

  it('still routes RIS content correctly (regression guard)', () => {
    const ris = 'TY  - JOUR\nTI  - A RIS paper\nAU  - Doe, J\nPY  - 2019\nDO  - 10.1/ris\nER  -';
    const res = detectAndParse(ris, 'refs.ris');
    expect(res.format).toBe('RIS');
    expect(res.records[0].title).toBe('A RIS paper');
    expect(parseRIS(ris)[0].doi).toBe('10.1/ris');
  });

  it('still routes BibTeX and NBIB content correctly (regression guard)', () => {
    expect(detectAndParse('@article{k,\n title={A bib paper},\n year={2020}\n}', 'r.bib').format).toBe('BibTeX');
    expect(detectAndParse('PMID- 123\nTI  - An nbib paper\n', 'r.nbib').format).toBe('PubMed nbib');
  });
});
