/**
 * deduplication.test.js
 * Unit tests for the META·SIFT Beta deduplication module.
 * No server required — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTitle,
  titleSimilarity,
  levenshtein,
  findDuplicateGroups,
} from '../../../src/research-engine/screening/deduplication.js';

// ── normalizeTitle ─────────────────────────────────────────────────────────────

describe('normalizeTitle', () => {
  it('lowercases the string', () => {
    expect(normalizeTitle('HELLO WORLD')).toBe('hello world');
  });

  it('removes punctuation characters', () => {
    expect(normalizeTitle('Title: A Study!')).toBe('title a study');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizeTitle('a   b   c')).toBe('a b c');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTitle('  padded  ')).toBe('padded');
  });

  it('handles empty string', () => {
    expect(normalizeTitle('')).toBe('');
  });

  it('handles undefined (default param)', () => {
    expect(normalizeTitle()).toBe('');
  });

  it('removes hyphens and parentheses', () => {
    const result = normalizeTitle('Effect of X (2023) — a meta-analysis');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
    expect(result).not.toContain('-');
    expect(result).not.toContain('—');
  });
});

// ── levenshtein ────────────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of b when a is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('returns length of a when b is empty', () => {
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshtein('cat', 'bat')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('returns correct distance for known pair (kitten/sitting = 3)', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshtein('abc', 'xyz')).toBe(levenshtein('xyz', 'abc'));
  });
});

// ── titleSimilarity ────────────────────────────────────────────────────────────

describe('titleSimilarity', () => {
  it('returns 1.0 for identical titles', () => {
    const t = 'Effect of aspirin on cardiovascular outcomes';
    expect(titleSimilarity(t, t)).toBe(1);
  });

  it('returns 1.0 for titles that are identical after normalization', () => {
    expect(titleSimilarity('Hello, World!', 'hello world')).toBe(1);
  });

  it('returns < 0.5 for completely different titles', () => {
    const a = 'aspirin cardiovascular outcomes randomized trial';
    const b = 'zebra migration patterns in southern africa';
    expect(titleSimilarity(a, b)).toBeLessThan(0.5);
  });

  it('returns > 0.9 for nearly identical titles (one character difference)', () => {
    const a = 'Effect of aspirin on cardiovascular outcomes a systematic review';
    const b = 'Effect of aspirin on cardiovascular outcomes a systematic reviews';
    expect(titleSimilarity(a, b)).toBeGreaterThan(0.9);
  });

  it('returns 0 when first title is empty', () => {
    expect(titleSimilarity('', 'some title here')).toBe(0);
  });

  it('returns 0 when second title is empty', () => {
    expect(titleSimilarity('some title here', '')).toBe(0);
  });
});

// ── findDuplicateGroups ────────────────────────────────────────────────────────

describe('findDuplicateGroups', () => {
  it('returns empty array for empty input', () => {
    expect(findDuplicateGroups([])).toEqual([]);
  });

  it('returns empty array for single record', () => {
    const records = [{ id: 'r1', title: 'Some Title', doi: '10.1/x', year: '2023' }];
    expect(findDuplicateGroups(records)).toEqual([]);
  });

  it('groups two records with the same DOI', () => {
    const records = [
      { id: 'r1', title: 'Article One', doi: '10.1000/test.001', year: '2023' },
      { id: 'r2', title: 'Article One Variant', doi: '10.1000/test.001', year: '2023' },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain('r1');
    expect(groups[0]).toContain('r2');
  });

  it('groups two records with same DOI regardless of case', () => {
    const records = [
      { id: 'a1', title: 'T1', doi: '10.1000/TEST', year: '2020' },
      { id: 'a2', title: 'T2', doi: '10.1000/test', year: '2020' },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
  });

  it('groups two records with the same PMID', () => {
    const records = [
      { id: 'p1', title: 'PMID Article A', pmid: '12345678', year: '2022' },
      { id: 'p2', title: 'PMID Article B', pmid: '12345678', year: '2022' },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain('p1');
    expect(groups[0]).toContain('p2');
  });

  it('groups three records with the same DOI into one group', () => {
    const records = [
      { id: 'x1', title: 'T1', doi: '10.9999/dup', year: '2021' },
      { id: 'x2', title: 'T2', doi: '10.9999/dup', year: '2021' },
      { id: 'x3', title: 'T3', doi: '10.9999/dup', year: '2021' },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('groups two records with very similar titles and the same year', () => {
    const records = [
      {
        id: 'ts1',
        title: 'Efficacy of metformin in type 2 diabetes mellitus a systematic review',
        year: '2023',
      },
      {
        id: 'ts2',
        title: 'Efficacy of metformin in type 2 diabetes mellitus a systematic review',
        year: '2023',
      },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain('ts1');
    expect(groups[0]).toContain('ts2');
  });

  it('does NOT group records with similar titles but different years', () => {
    const records = [
      {
        id: 'dy1',
        title: 'Statin therapy for cardiovascular disease prevention a meta analysis',
        year: '2018',
      },
      {
        id: 'dy2',
        title: 'Statin therapy for cardiovascular disease prevention a meta analysis',
        year: '2022',
      },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(0);
  });

  it('returns no groups for records with no overlap', () => {
    const records = [
      { id: 'u1', title: 'Alpha study on inflammation markers in sepsis', year: '2020' },
      { id: 'u2', title: 'Beta analysis of zinc supplementation outcomes', year: '2021' },
      { id: 'u3', title: 'Gamma review of surgical site infections', year: '2019' },
    ];
    expect(findDuplicateGroups(records)).toHaveLength(0);
  });

  it('records without DOI or PMID only match by title', () => {
    const records = [
      { id: 'n1', title: 'The effect of sleep deprivation on cognitive performance', year: '2023' },
      { id: 'n2', title: 'The effect of sleep deprivation on cognitive performance', year: '2023' },
    ];
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(1);
  });

  it('short titles (< 10 chars) are not matched by title similarity', () => {
    const records = [
      { id: 'sh1', title: 'HIV', year: '2020' },
      { id: 'sh2', title: 'HIV', year: '2020' },
    ];
    // Short titles skip the title-similarity pass; no DOI/PMID — no group
    const groups = findDuplicateGroups(records);
    expect(groups).toHaveLength(0);
  });

  it('custom threshold of 1.0 only matches exact normalized titles', () => {
    const records = [
      { id: 'ct1', title: 'Treatment of hypertension in elderly patients', year: '2022' },
      { id: 'ct2', title: 'Treatment of hypertension in elderly patients!', year: '2022' },
    ];
    // After normalization these are identical — should still match at 1.0
    const groups = findDuplicateGroups(records, 1.0);
    expect(groups).toHaveLength(1);
  });
});
