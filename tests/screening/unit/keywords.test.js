/**
 * keywords.test.js
 * Unit tests for the META·SIFT Beta keyword extraction module.
 * No server required — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { extractKeywords, STOPWORDS } from '../../../src/research-engine/screening/keywords.js';

// ── STOPWORDS ────────────────────────────────────────────────────────────────

describe('STOPWORDS', () => {
  it('is a Set containing common English stopwords', () => {
    expect(STOPWORDS).toBeInstanceOf(Set);
    expect(STOPWORDS.has('the')).toBe(true);
    expect(STOPWORDS.has('and')).toBe(true);
    expect(STOPWORDS.has('of')).toBe(true);
  });

  it('does not contain meaningful content words', () => {
    expect(STOPWORDS.has('diabetes')).toBe(false);
    expect(STOPWORDS.has('randomized')).toBe(false);
  });
});

// ── extractKeywords: empty / defensive input ─────────────────────────────────

describe('extractKeywords — empty input', () => {
  it('returns empty arrays for an empty object', () => {
    expect(extractKeywords({})).toEqual({ inclusion: [], exclusion: [] });
  });

  it('returns empty arrays for undefined (default param)', () => {
    expect(extractKeywords()).toEqual({ inclusion: [], exclusion: [] });
  });

  it('returns empty arrays when all fields are blank strings', () => {
    const result = extractKeywords({ P: '', I: '', incl: '   ', excl: '\n\n' });
    expect(result.inclusion).toEqual([]);
    expect(result.exclusion).toEqual([]);
  });
});

// ── extractKeywords: routing incl→inclusion, excl→exclusion ──────────────────

describe('extractKeywords — routing', () => {
  it('routes inclusion criteria into inclusion and exclusion criteria into exclusion', () => {
    const result = extractKeywords({
      incl: 'randomized controlled trial',
      excl: 'animal studies',
    });
    expect(result.inclusion).toContain('randomized controlled trial');
    expect(result.exclusion).toContain('animal studies');
    // Cross-contamination must not happen.
    expect(result.exclusion).not.toContain('randomized controlled trial');
    expect(result.inclusion).not.toContain('animal studies');
  });

  it('folds P/I/C/O/keywords/question into inclusion candidates', () => {
    const result = extractKeywords({
      P: 'adults with type 2 diabetes',
      I: 'metformin therapy',
      C: 'placebo control',
      O: 'glycemic control',
      keywords: 'insulin resistance',
      question: 'cardiovascular outcomes',
    });
    expect(result.inclusion).toContain('adults with type 2 diabetes');
    expect(result.inclusion).toContain('metformin therapy');
    expect(result.inclusion).toContain('placebo control');
    expect(result.inclusion).toContain('glycemic control');
    expect(result.inclusion).toContain('insulin resistance');
    expect(result.inclusion).toContain('cardiovascular outcomes');
    // None of these belong in exclusion.
    expect(result.exclusion).toEqual([]);
  });
});

// ── extractKeywords: phrase preference ───────────────────────────────────────

describe('extractKeywords — phrase preference', () => {
  it('keeps multi-word phrases intact rather than splitting into single words', () => {
    const result = extractKeywords({ keywords: 'randomized controlled trial' });
    expect(result.inclusion).toContain('randomized controlled trial');
    expect(result.inclusion).not.toContain('randomized');
    expect(result.inclusion).not.toContain('controlled');
    expect(result.inclusion).not.toContain('trial');
  });

  it('splits on bullets, line breaks, semicolons and commas into separate phrases', () => {
    const result = extractKeywords({
      incl: '- systematic review\n- meta analysis\nrandomized controlled trial; cohort study, case control',
    });
    expect(result.inclusion).toContain('systematic review');
    expect(result.inclusion).toContain('meta analysis');
    expect(result.inclusion).toContain('randomized controlled trial');
    expect(result.inclusion).toContain('cohort study');
    expect(result.inclusion).toContain('case control');
  });

  it('strips numbered-list enumerators like "1." and "2)"', () => {
    const result = extractKeywords({
      incl: '1. human participants\n2) english language',
    });
    expect(result.inclusion).toContain('human participants');
    expect(result.inclusion).toContain('english language');
    // Enumerator digits must not leak into the phrase.
    expect(result.inclusion.some(p => p.startsWith('1'))).toBe(false);
    expect(result.inclusion.some(p => p.startsWith('2'))).toBe(false);
  });

  it('orders multi-word phrases before single words (deterministic)', () => {
    const result = extractKeywords({ keywords: 'cancer; lung cancer screening' });
    const idxPhrase = result.inclusion.indexOf('lung cancer screening');
    const idxWord = result.inclusion.indexOf('cancer');
    expect(idxPhrase).toBeGreaterThanOrEqual(0);
    expect(idxWord).toBeGreaterThanOrEqual(0);
    expect(idxPhrase).toBeLessThan(idxWord);
  });
});

// ── extractKeywords: stopword & short-word removal ───────────────────────────

describe('extractKeywords — stopword removal', () => {
  it('drops single-word phrases that are pure stopwords', () => {
    const result = extractKeywords({ keywords: 'the; and; diabetes' });
    expect(result.inclusion).not.toContain('the');
    expect(result.inclusion).not.toContain('and');
    expect(result.inclusion).toContain('diabetes');
  });

  it('drops single words shorter than 3 characters', () => {
    const result = extractKeywords({ keywords: 'ai; ml; oncology' });
    expect(result.inclusion).not.toContain('ai');
    expect(result.inclusion).not.toContain('ml');
    expect(result.inclusion).toContain('oncology');
  });

  it('keeps multi-word phrases even when they contain stopwords', () => {
    const result = extractKeywords({ keywords: 'risk of bias assessment' });
    expect(result.inclusion).toContain('risk of bias assessment');
  });

  it('drops a phrase composed entirely of stopwords', () => {
    const result = extractKeywords({ keywords: 'of the and' });
    expect(result.inclusion).toEqual([]);
  });
});

// ── extractKeywords: dedupe & casing ─────────────────────────────────────────

describe('extractKeywords — dedupe and casing', () => {
  it('deduplicates case-insensitively', () => {
    const result = extractKeywords({
      P: 'Diabetes Mellitus',
      keywords: 'diabetes mellitus; DIABETES MELLITUS',
    });
    const count = result.inclusion.filter(p => p === 'diabetes mellitus').length;
    expect(count).toBe(1);
  });

  it('returns consistent lowercase casing', () => {
    const result = extractKeywords({ keywords: 'Randomized Controlled Trial' });
    expect(result.inclusion).toContain('randomized controlled trial');
  });

  it('caps each list at 40 items', () => {
    const many = Array.from({ length: 60 }, (_, i) => `phrase number ${i}`).join(';');
    const result = extractKeywords({ keywords: many, excl: many });
    expect(result.inclusion.length).toBeLessThanOrEqual(40);
    expect(result.exclusion.length).toBeLessThanOrEqual(40);
  });
});
