/**
 * 86.md P1.17 — studies a reviewer excluded ("exclude from analysis") or archived
 * must not take part in pooling. This pins the shared predicate that the Analysis
 * tab, GRADE, living-review and public synthesis all use.
 */
import { describe, it, expect } from 'vitest';
import { isExcludedFromAnalysis, analyzableStudies } from '../../../src/research-engine/statistics/studyFilter.js';

describe('studyFilter — isExcludedFromAnalysis', () => {
  it('includes studies with no extractionMeta (legacy / classic tab)', () => {
    expect(isExcludedFromAnalysis({ es: '0.5' })).toBe(false);
    expect(isExcludedFromAnalysis({ es: '0.5', extractionMeta: null })).toBe(false);
    expect(isExcludedFromAnalysis({ es: '0.5', extractionMeta: {} })).toBe(false);
  });

  it('includes studies explicitly marked includedInAnalysis:true', () => {
    expect(isExcludedFromAnalysis({ extractionMeta: { includedInAnalysis: true } })).toBe(false);
  });

  it('excludes studies flagged includedInAnalysis:false', () => {
    expect(isExcludedFromAnalysis({ extractionMeta: { includedInAnalysis: false } })).toBe(true);
  });

  it('excludes archived outcome rows', () => {
    expect(isExcludedFromAnalysis({ extractionMeta: { archived: true } })).toBe(true);
  });

  it('is null/garbage safe', () => {
    expect(isExcludedFromAnalysis(null)).toBe(false);
    expect(isExcludedFromAnalysis(undefined)).toBe(false);
    expect(isExcludedFromAnalysis({ extractionMeta: 'nope' })).toBe(false);
  });
});

describe('studyFilter — analyzableStudies', () => {
  it('drops excluded and archived rows, keeps the rest', () => {
    const studies = [
      { id: 'a', es: '0.1' },
      { id: 'b', es: '0.2', extractionMeta: { includedInAnalysis: false } },
      { id: 'c', es: '0.3', extractionMeta: { archived: true } },
      { id: 'd', es: '0.4', extractionMeta: { includedInAnalysis: true } },
    ];
    expect(analyzableStudies(studies).map((s) => s.id)).toEqual(['a', 'd']);
  });

  it('returns [] for non-arrays', () => {
    expect(analyzableStudies(null)).toEqual([]);
    expect(analyzableStudies(undefined)).toEqual([]);
  });
});
