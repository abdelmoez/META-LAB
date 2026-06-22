/**
 * importParsers.test.js — WS2 (prompt 50): modular parser registry + content
 * detection + .txt handling + encoding (BOM). Pure, server-free unit tests.
 */
import { describe, it, expect } from 'vitest';
import {
  detectAndParse, detectFormat, parseByFormat, stripBom,
  parseCSV, parseTXT, PARSER_REGISTRY, SUPPORTED_IMPORT_FORMATS,
} from '../../src/research-engine/import-export/parsers.js';

const RIS = `TY  - JOUR
TI  - Artificial intelligence in clinical care
AU  - Smith, John
PY  - 2023
DO  - 10.1000/abc
AB  - Background: a study about AI.
ER  - `;

const PUBMED = `PMID- 12345678
TI  - Machine learning for sepsis prediction
FAU - Doe, Jane
DP  - 2021
AB  - We trained a model.
`;

const WOS = `FN Clarivate Analytics Web of Science
VR 1.0
PT J
AU Roe, R
TI Network meta-analysis methods
SO Journal of Trials
PY 2020
DI 10.5555/xyz
ER

EF`;

describe('stripBom — encoding safety', () => {
  it('removes a leading UTF-8 BOM so the first tag is recognised', () => {
    const withBom = '﻿' + RIS;
    expect(stripBom(withBom).startsWith('TY')).toBe(true);
    // and detection still works through the BOM
    const { records, format } = detectAndParse(withBom, 'refs.ris');
    expect(format).toBe('RIS');
    expect(records.length).toBe(1);
  });
  it('is a no-op for clean text + tolerates null', () => {
    expect(stripBom(RIS)).toBe(RIS);
    expect(stripBom(null)).toBe('');
  });
});

describe('detectAndParse — content-based format detection', () => {
  it('detects RIS from content', () => {
    expect(detectFormat(RIS)).toBe('RIS');
    expect(detectAndParse(RIS).records[0].title).toMatch(/Artificial intelligence/);
  });
  it('detects PubMed/MEDLINE from content', () => {
    const f = detectFormat(PUBMED);
    expect(['PubMed nbib', 'MEDLINE']).toContain(f);
    expect(detectAndParse(PUBMED).records[0].pmid).toBe('12345678');
  });
  it('detects Web of Science (FN/VR header) from content', () => {
    expect(detectFormat(WOS)).toMatch(/Web of Science/);
    expect(detectAndParse(WOS).records[0].doi).toBe('10.5555/xyz');
  });
});

describe('.txt files are inspected by content, not treated as one generic format', () => {
  it('a .txt with RIS markers parses as RIS', () => {
    const { format, records } = detectAndParse(RIS, 'export.txt');
    expect(format).toBe('RIS');
    expect(records.length).toBe(1);
  });
  it('a .txt with PubMed markers parses as PubMed', () => {
    const { format, records } = detectAndParse(PUBMED, 'pubmed_result.txt');
    expect(['PubMed nbib', 'MEDLINE']).toContain(format);
    expect(records[0].title).toMatch(/sepsis/);
  });
  it('a .txt with Web of Science markers parses as WoS', () => {
    const { format } = detectAndParse(WOS, 'savedrecs.txt');
    expect(format).toMatch(/Web of Science/);
  });
  it('a plain .txt with no markers falls back to one title per line', () => {
    const txt = 'First study title\nSecond study title\n\nThird study title';
    const recs = parseTXT(txt);
    expect(recs.map(r => r.title)).toEqual(['First study title', 'Second study title', 'Third study title']);
  });
});

describe('CSV / TSV tables', () => {
  it('parses a CSV with a title/doi header', () => {
    const csv = 'title,author,year,doi\n"AI in care",Smith,2023,10.1/a\n"ML model",Doe,2021,10.2/b';
    const recs = parseCSV(csv);
    expect(recs.length).toBe(2);
    expect(recs[0].title).toBe('AI in care');
    expect(recs[1].doi).toBe('10.2/b');
  });
  it('parses a TSV via the registry (explicit tsv)', () => {
    const tsv = 'title\tyear\tdoi\nNetwork study\t2020\t10.9/z';
    const { records, format } = parseByFormat(tsv, 'tsv', 'data.tsv');
    expect(format).toBe('TSV');
    expect(records[0].title).toBe('Network study');
  });
});

describe('parseByFormat — explicit format with safe fallback', () => {
  it('honours an explicit, matching format key', () => {
    const { format, records } = parseByFormat(RIS, 'ris');
    expect(format).toBe('RIS');
    expect(records.length).toBe(1);
  });
  it('falls back to auto-detect when an explicit format yields nothing', () => {
    // ask for bibtex but give RIS → should not silently import zero records
    const { records, format } = parseByFormat(RIS, 'bibtex');
    expect(records.length).toBe(1);
    expect(format).toBe('RIS');
  });
  it("'auto' content-detects", () => {
    expect(parseByFormat(PUBMED, 'auto').records[0].pmid).toBe('12345678');
  });
});

describe('registry shape', () => {
  it('exposes a parse() for every supported format key', () => {
    for (const opt of SUPPORTED_IMPORT_FORMATS) {
      if (opt.key === 'auto') continue;
      expect(typeof PARSER_REGISTRY[opt.key]?.parse).toBe('function');
    }
  });
});

describe('scale — a large RIS file parses without error', () => {
  it('parses 5,000 records', () => {
    const one = (i) => `TY  - JOUR\nTI  - Study number ${i}\nAU  - Author ${i}\nPY  - 20${(i % 20).toString().padStart(2, '0')}\nDO  - 10.1000/x${i}\nER  - `;
    const big = Array.from({ length: 5000 }, (_, i) => one(i)).join('\n');
    const { records, format } = detectAndParse(big, 'big.ris');
    expect(format).toBe('RIS');
    expect(records.length).toBe(5000);
    expect(records[4999].title).toBe('Study number 4999');
  });
});
