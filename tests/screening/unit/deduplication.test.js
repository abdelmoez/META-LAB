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
  scorePair,
  findDuplicateGroupsScored,
  parseSurnames,
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

// ── parseSurnames ────────────────────────────────────────────────────────────

describe('parseSurnames', () => {
  it('returns an empty set for empty / non-string input', () => {
    expect(parseSurnames('').size).toBe(0);
    expect(parseSurnames(undefined).size).toBe(0);
    expect(parseSurnames(null).size).toBe(0);
  });

  it('extracts surnames from a "Smith J; Doe A" style string', () => {
    const s = parseSurnames('Smith J; Doe A; Wong K');
    expect(s.has('smith')).toBe(true);
    expect(s.has('doe')).toBe(true);
    expect(s.has('wong')).toBe(true);
  });

  it('handles "Surname, Given" comma form', () => {
    const s = parseSurnames('Anderson, John; Brown, Mary');
    expect(s.has('anderson')).toBe(true);
    expect(s.has('brown')).toBe(true);
  });

  it('is case-insensitive', () => {
    const s = parseSurnames('SMITH J');
    expect(s.has('smith')).toBe(true);
  });
});

// ── scorePair ────────────────────────────────────────────────────────────────

describe('scorePair', () => {
  it('returns 100 with DOI reason when DOIs match (case/space-insensitive)', () => {
    const a = { title: 'Whatever A', doi: ' 10.1000/Test ', year: '2020' };
    const b = { title: 'Totally different', doi: '10.1000/test', year: '2021' };
    const res = scorePair(a, b);
    expect(res.score).toBe(100);
    expect(res.reason).toBe('Exact DOI match');
    expect(res.signals.doiMatch).toBe(true);
  });

  it('returns 100 with PMID reason when PMIDs match and no DOI', () => {
    const a = { title: 'Some title', pmid: '12345678', year: '2019' };
    const b = { title: 'Another title', pmid: '12345678', year: '2019' };
    const res = scorePair(a, b);
    expect(res.score).toBe(100);
    expect(res.reason).toBe('Exact PMID match');
    expect(res.signals.pmidMatch).toBe(true);
  });

  it('prefers DOI over PMID when both match', () => {
    const a = { title: 'x', doi: '10.1/a', pmid: '999' };
    const b = { title: 'y', doi: '10.1/a', pmid: '999' };
    expect(scorePair(a, b).reason).toBe('Exact DOI match');
  });

  it('produces a high (but < 100) score for near-identical titles, same year & authors', () => {
    const a = {
      title: 'Efficacy of metformin in type 2 diabetes a systematic review',
      authors: 'Smith J; Doe A',
      year: '2023',
    };
    const b = {
      title: 'Efficacy of metformin in type 2 diabetes a systematic review',
      authors: 'Smith J; Doe A',
      year: '2023',
    };
    const res = scorePair(a, b);
    expect(res.score).toBeGreaterThanOrEqual(95);
    expect(res.score).toBeLessThanOrEqual(100);
    expect(res.signals.titleSim).toBeCloseTo(1, 5);
    expect(res.signals.yearMatch).toBe(true);
    expect(res.signals.authorJaccard).toBeGreaterThan(0);
    expect(res.reason).toContain('title similarity');
  });

  it('returns a score in the 0–100 integer range driven by title similarity', () => {
    const a = { title: 'aspirin cardiovascular outcomes randomized trial' };
    const b = { title: 'zebra migration patterns in southern africa' };
    const res = scorePair(a, b);
    expect(Number.isInteger(res.score)).toBe(true);
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.score).toBeLessThan(50); // dissimilar titles → low score
  });

  it('author overlap raises the score relative to no overlap', () => {
    const title = 'Effect of exercise on blood pressure in adults a review';
    const noAuthors = scorePair({ title }, { title });
    const withAuthors = scorePair(
      { title, authors: 'Smith J; Doe A' },
      { title, authors: 'Smith J; Doe A' },
    );
    expect(withAuthors.score).toBeGreaterThan(noAuthors.score);
  });

  it('a differing year lowers the score versus a matching year', () => {
    const title = 'Effect of exercise on blood pressure in adults a review';
    const authors = 'Smith J; Doe A';
    const sameYear = scorePair(
      { title, authors, year: '2020' },
      { title, authors, year: '2020' },
    );
    const diffYear = scorePair(
      { title, authors, year: '2020' },
      { title, authors, year: '2015' },
    );
    expect(diffYear.score).toBeLessThan(sameYear.score);
    expect(diffYear.signals.yearMatch).toBe(false);
    expect(diffYear.reason).toContain('different year');
  });

  it('always returns the expected signals object shape', () => {
    const res = scorePair({ title: 'a b c d e f' }, { title: 'a b c d e g' });
    expect(res.signals).toHaveProperty('titleSim');
    expect(res.signals).toHaveProperty('authorJaccard');
    expect(res.signals).toHaveProperty('yearMatch');
    expect(res.signals).toHaveProperty('doiMatch');
    expect(res.signals).toHaveProperty('pmidMatch');
  });
});

// ── findDuplicateGroupsScored ────────────────────────────────────────────────

describe('findDuplicateGroupsScored', () => {
  it('returns an empty array for empty input', () => {
    expect(findDuplicateGroupsScored([])).toEqual([]);
  });

  it('returns a scored group (score + reason + pairs) for a DOI duplicate', () => {
    const records = [
      { id: 'd1', title: 'Article One', doi: '10.1000/dup', year: '2023' },
      { id: 'd2', title: 'Article One Variant', doi: '10.1000/dup', year: '2023' },
    ];
    const groups = findDuplicateGroupsScored(records);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.ids).toEqual(expect.arrayContaining(['d1', 'd2']));
    expect(g.score).toBe(100);
    expect(g.reason).toBe('Exact DOI match');
    expect(Array.isArray(g.pairs)).toBe(true);
    expect(g.pairs[0]).toHaveProperty('a');
    expect(g.pairs[0]).toHaveProperty('b');
    expect(g.pairs[0]).toHaveProperty('score');
    expect(g.pairs[0]).toHaveProperty('reason');
  });

  it('group score is the max pair score within the group', () => {
    const records = [
      {
        id: 'g1',
        title: 'Efficacy of metformin in type 2 diabetes a systematic review',
        authors: 'Smith J; Doe A',
        year: '2023',
      },
      {
        id: 'g2',
        title: 'Efficacy of metformin in type 2 diabetes a systematic review',
        authors: 'Smith J; Doe A',
        year: '2023',
      },
    ];
    const groups = findDuplicateGroupsScored(records);
    expect(groups).toHaveLength(1);
    const maxPair = Math.max(...groups[0].pairs.map(p => p.score));
    expect(groups[0].score).toBe(maxPair);
    expect(groups[0].reason).toContain('title similarity');
  });

  it('uses default threshold of 0.85 (looser than findDuplicateGroups)', () => {
    // Two titles differing by a few characters — similarity ~0.88.
    const records = [
      { id: 't1', title: 'The effect of sleep deprivation on cognitive performance', year: '2023' },
      { id: 't2', title: 'The effects of sleep deprivation on cognitive performances', year: '2023' },
    ];
    const groups = findDuplicateGroupsScored(records);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].score).toBeGreaterThan(0);
  });

  it('returns no groups when records do not overlap', () => {
    const records = [
      { id: 'n1', title: 'Alpha study on inflammation markers in sepsis', year: '2020' },
      { id: 'n2', title: 'Beta analysis of zinc supplementation outcomes', year: '2021' },
    ];
    expect(findDuplicateGroupsScored(records)).toEqual([]);
  });
});
