/**
 * 77.md §1 — per-source PRISMA split. classifySource buckets a record's sourceDb into
 * databases vs registers vs other; splitBySource counts them. Unknown/blank → 'other'
 * (never guessed).
 */
import { describe, it, expect } from 'vitest';
import { classifySource, splitBySource } from '../../../src/research-engine/screening/sourceClassify.js';

describe('classifySource', () => {
  it('recognises bibliographic databases', () => {
    for (const n of ['PubMed', 'MEDLINE', 'Embase', 'Scopus', 'Web of Science', 'Cochrane CENTRAL', 'CINAHL', 'PsycINFO', 'Europe PMC']) {
      expect(classifySource(n)).toBe('database');
    }
  });
  it('recognises trial/protocol registers', () => {
    for (const n of ['ClinicalTrials.gov', 'WHO ICTRP', 'ISRCTN', 'EU Clinical Trials Register', 'PROSPERO', 'ANZCTR']) {
      expect(classifySource(n)).toBe('register');
    }
  });
  it('falls back to other for blank or unknown sources (never guesses)', () => {
    expect(classifySource('')).toBe('other');
    expect(classifySource(null)).toBe('other');
    expect(classifySource('Hand search of reference lists')).toBe('other');
    expect(classifySource('Some Institutional Repository X')).toBe('other');
  });
});

describe('splitBySource', () => {
  it('counts records by bucket', () => {
    const recs = [
      { sourceDb: 'PubMed' }, { sourceDb: 'Embase' }, { sourceDb: 'ClinicalTrials.gov' },
      { sourceDb: '' }, { sourceDb: 'citation chasing' }, {},
    ];
    expect(splitBySource(recs)).toEqual({ databases: 2, registers: 1, other: 3 });
  });
  it('is empty-safe', () => {
    expect(splitBySource([])).toEqual({ databases: 0, registers: 0, other: 0 });
    expect(splitBySource()).toEqual({ databases: 0, registers: 0, other: 0 });
  });
});
