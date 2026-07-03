/**
 * searchRecallEstimate.test.js — P11 Task 3. Deterministic seed-recall estimation via
 * normalized-id set intersection with a title-similarity fallback, honest missing-seed
 * reasons, and concrete query-improvement suggestions from the missing titles.
 */
import { describe, it, expect } from 'vitest';
import {
  estimateRecall, suggestQueryImprovements, normDoi, normPmid, normOpenAlex, normTitle,
} from '../../src/research-engine/searchBuilder/recallEstimate.js';

describe('identifier normalization', () => {
  it('normalizes DOIs (strip prefixes, lowercase)', () => {
    expect(normDoi('https://doi.org/10.1000/AbC')).toBe('10.1000/abc');
    expect(normDoi('http://dx.doi.org/10.1/X')).toBe('10.1/x');
    expect(normDoi('doi: 10.2/Y')).toBe('10.2/y');
    expect(normDoi('')).toBe('');
  });
  it('normalizes PMIDs to digits', () => {
    expect(normPmid('PMID: 12345')).toBe('12345');
    expect(normPmid(987)).toBe('987');
    expect(normPmid('n/a')).toBe('');
  });
  it('normalizes OpenAlex work ids', () => {
    expect(normOpenAlex('https://openalex.org/W999')).toBe('W999');
    expect(normOpenAlex('w42')).toBe('W42');
    expect(normOpenAlex('')).toBe('');
  });
  it('normalizes titles', () => {
    expect(normTitle('The, Study: of X!')).toBe('the study of x');
  });
});

describe('estimateRecall — mixed id + title matching', () => {
  const seeds = [
    { doi: 'https://doi.org/10.1000/ABC', title: 'Alpha study' },
    { pmid: 'PMID: 12345', title: 'Beta trial' },
    { openAlexId: 'https://openalex.org/W999', title: 'Gamma cohort' },
    { title: 'Delta randomized controlled trial of vasopressin in sepsis' }, // title-only
    { title: 'Zeta unrelated topic about geology' }, // missing
  ];
  const retrieved = [
    { doi: '10.1000/abc' },
    { pmid: '12345' },
    { id: 'W999' },
    { title: 'Delta randomized controlled trial of vasopressin in sepsis' },
  ];
  const r = estimateRecall({ seeds, retrieved });
  it('finds 4 of 5 seeds with the right matchedBy', () => {
    expect(r.seedTotal).toBe(5);
    expect(r.found.length).toBe(4);
    expect(r.found.map((f) => f.matchedBy).sort()).toEqual(['doi', 'openAlexId', 'pmid', 'title']);
  });
  it('reports the one missing seed and the recall fraction', () => {
    expect(r.notFound.length).toBe(1);
    expect(r.notFound[0].title).toMatch(/Zeta/);
    expect(r.estimatedRecall).toBe(0.8);
  });
  it('gives an honest reason for the missing seed', () => {
    expect(r.missingAnalysis[0].likelyReason).toContain('not present in the retrieved set');
  });
});

describe('estimateRecall — missing-seed reasons (grounded in supplied data)', () => {
  it('attributes a miss to the date limit', () => {
    const r = estimateRecall({ seeds: [{ title: 'Old work', year: 1990 }], retrieved: [], filters: { dateFrom: '2000', dateTo: '', languages: [], pubTypes: [] } });
    expect(r.missingAnalysis[0].likelyReason).toContain('outside the search date limit');
  });
  it('attributes a miss to the language limit', () => {
    const r = estimateRecall({ seeds: [{ title: 'Une étude', language: 'fr' }], retrieved: [], filters: { dateFrom: '', dateTo: '', languages: ['en'], pubTypes: [] } });
    expect(r.missingAnalysis[0].likelyReason).toContain('language "fr" is excluded');
  });
  it('attributes a miss to no shared concept term', () => {
    const r = estimateRecall({ seeds: [{ title: 'A study of quantum widgets' }], retrieved: [], concepts: [{ label: 'Population', terms: [{ text: 'sepsis' }] }] });
    expect(r.missingAnalysis[0].likelyReason).toContain('shares no term with the Population concept');
  });
  it('flags a seed with no identifier or title', () => {
    const r = estimateRecall({ seeds: [{}], retrieved: [] });
    expect(r.missingAnalysis[0].likelyReason).toContain('no identifier or title');
  });
  it('flags a near-title match as a possible metadata mismatch', () => {
    const r = estimateRecall({
      // Jaccard ≈ 0.71: above the near-miss floor (0.5), below the same-paper cutoff (0.85)
      seeds: [{ title: 'vasopressin septic shock randomized controlled trial' }],
      retrieved: [{ title: 'vasopressin septic shock randomized controlled study' }],
    });
    expect(r.notFound.length).toBe(1); // below the same-paper threshold
    expect(r.missingAnalysis[0].likelyReason).toContain('metadata');
  });
});

describe('suggestQueryImprovements', () => {
  it('suggests frequent uncovered tokens from the missing titles', () => {
    const notFound = [
      { title: 'vasopressin sepsis mortality' },
      { title: 'vasopressin septic mortality' },
    ];
    const out = suggestQueryImprovements({ notFound, concepts: [{ terms: [{ text: 'vasopressin' }] }] });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].suggestion).toContain('mortality'); // most frequent uncovered token
    expect(out[0].rationale).toContain('2 of 2 missing seed titles');
    // a term already covered by a concept is never suggested
    expect(out.some((x) => x.suggestion.includes('vasopressin'))).toBe(false);
  });
  it('returns [] when nothing is missing', () => {
    expect(suggestQueryImprovements({ notFound: [], concepts: [] })).toEqual([]);
    expect(suggestQueryImprovements({})).toEqual([]);
  });
});

describe('degenerate inputs never throw', () => {
  it('handles empty / absent args', () => {
    expect(() => estimateRecall()).not.toThrow();
    const r = estimateRecall({});
    expect(r).toMatchObject({ seedTotal: 0, found: [], notFound: [], estimatedRecall: null, missingAnalysis: [] });
  });
  it('handles seeds with no retrieved records', () => {
    const r = estimateRecall({ seeds: [{ doi: '10.1/x' }], retrieved: [] });
    expect(r.estimatedRecall).toBe(0);
    expect(r.notFound.length).toBe(1);
  });
});
