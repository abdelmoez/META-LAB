/**
 * pdfMatching.test.js — PDF↔record matching engine (roadmap 1.4, pure).
 */
import { describe, it, expect } from 'vitest';
import {
  extractIdentifiersFromFilename, normalizeDoi, classifyMatch,
  matchPdfToRecords, bestPdfMatch,
  AUTO_ATTACH_THRESHOLD, REVIEW_THRESHOLD,
} from '../../../src/research-engine/screening/pdfMatching.js';

const records = [
  { id: 'r1', title: 'Machine learning for systematic reviews', doi: '10.1000/aaa', pmid: '111', year: '2021' },
  { id: 'r2', title: 'Deep learning in radiology practice', doi: '10.2000/bbb', pmid: '222', year: '2020' },
  { id: 'r3', title: 'A completely different cardiology trial', doi: '', pmid: '', year: '2019' },
];

describe('extractIdentifiersFromFilename', () => {
  it('extracts a DOI written directly in the filename', () => {
    expect(extractIdentifiersFromFilename('10.1000/aaa.pdf').doi).toBe('10.1000/aaa');
  });
  it('recovers a DOI where "/" was replaced by "_"', () => {
    expect(extractIdentifiersFromFilename('10.1000_aaa.pdf').doi).toBe('10.1000/aaa');
  });
  it('extracts a pmid hint and a year', () => {
    const h = extractIdentifiersFromFilename('pmid_222_smith_2020.pdf');
    expect(h.pmid).toBe('222');
    expect(h.year).toBe('2020');
  });
  it('builds a title hint from a descriptive filename', () => {
    expect(extractIdentifiersFromFilename('Smith-machine-learning-reviews.pdf').titleHint)
      .toBe('Smith machine learning reviews');
  });
});

describe('normalizeDoi', () => {
  it('strips URL prefix, lower-cases, trims trailing punctuation', () => {
    expect(normalizeDoi('https://doi.org/10.1000/AAA.')).toBe('10.1000/aaa');
  });
});

describe('classifyMatch', () => {
  it('bands confidence into auto / review / unmatched', () => {
    expect(classifyMatch(0.99)).toBe('auto');
    expect(classifyMatch(AUTO_ATTACH_THRESHOLD)).toBe('auto');
    expect(classifyMatch(0.80)).toBe('review');
    expect(classifyMatch(REVIEW_THRESHOLD)).toBe('review');
    expect(classifyMatch(0.5)).toBe('unmatched');
  });
});

describe('matchPdfToRecords', () => {
  it('exact DOI → 0.99 / matchedBy doi / auto', () => {
    const m = matchPdfToRecords({ doi: '10.1000/aaa' }, records)[0];
    expect(m.recordId).toBe('r1');
    expect(m.confidence).toBeCloseTo(0.99, 6);
    expect(m.matchedBy).toBe('doi');
    expect(m.disposition).toBe('auto');
  });

  it('normalises a URL/upper-case DOI before matching', () => {
    const m = matchPdfToRecords({ doi: 'https://doi.org/10.2000/BBB' }, records)[0];
    expect(m.recordId).toBe('r2');
  });

  it('exact PMID → 0.96 / matchedBy pmid / auto', () => {
    const m = matchPdfToRecords({ pmid: '222' }, records)[0];
    expect(m.recordId).toBe('r2');
    expect(m.matchedBy).toBe('pmid');
    expect(m.disposition).toBe('auto');
  });

  it('strong title (+year) → auto; matchedBy notes the year', () => {
    const m = matchPdfToRecords({ title: 'Machine learning for systematic reviews', year: '2021' }, records)[0];
    expect(m.recordId).toBe('r1');
    expect(m.matchedBy).toBe('title+year');
    expect(m.disposition).toBe('auto');
  });

  it('a near-exact title (no DOI/PMID) matches by title and auto-attaches', () => {
    const m = matchPdfToRecords({ title: 'Machine learning for systematic review' }, records)[0];
    expect(m.recordId).toBe('r1');
    expect(m.matchedBy).toBe('title');
    expect(m.disposition).toBe('auto');
  });

  it('derives the DOI from the filename when no metadata is given', () => {
    const m = matchPdfToRecords({ filename: '10.1000_aaa.pdf' }, records)[0];
    expect(m.recordId).toBe('r1');
    expect(m.matchedBy).toBe('doi');
  });

  it('returns [] when nothing matches', () => {
    expect(matchPdfToRecords({ doi: '10.9999/none' }, records)).toEqual([]);
    expect(matchPdfToRecords({ title: 'unrelated' }, [])).toEqual([]);
  });
});

describe('bestPdfMatch', () => {
  it('returns the top candidate for a confident match', () => {
    const b = bestPdfMatch({ doi: '10.1000/aaa' }, records);
    expect(b.recordId).toBe('r1');
    expect(b.disposition).toBe('auto');
    expect(b.candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null when nothing clears the review floor', () => {
    expect(bestPdfMatch({ title: 'xyz nothing alike' }, records)).toBeNull();
  });

  it('demotes an ambiguous title match (near-tie) to review', () => {
    const twins = [
      { id: 'a', title: 'Effects of aspirin on outcomes', year: '2020' },
      { id: 'b', title: 'Effects of aspirin on outcome', year: '2020' },
    ];
    const b = bestPdfMatch({ title: 'Effects of aspirin on outcomes' }, twins);
    expect(b.disposition).toBe('review'); // too close to call → human reviews
  });
});
