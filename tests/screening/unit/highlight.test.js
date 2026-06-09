/**
 * highlight.test.js
 * Unit tests for the META·SIFT Beta highlight module.
 * No server required — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import {
  computeHighlightRanges,
  escapeRegExp,
} from '../../../src/research-engine/screening/highlight.js';

// Helper: extract the substrings a range set points at.
const slice = (text, ranges) => ranges.map(r => text.slice(r.start, r.end));

// ── escapeRegExp ─────────────────────────────────────────────────────────────

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c+')).toBe('a\\.b\\*c\\+');
    expect(escapeRegExp('(group)')).toBe('\\(group\\)');
    expect(escapeRegExp('a|b')).toBe('a\\|b');
  });

  it('leaves plain strings untouched', () => {
    expect(escapeRegExp('hello world')).toBe('hello world');
  });
});

// ── computeHighlightRanges: empty inputs ─────────────────────────────────────

describe('computeHighlightRanges — empty inputs', () => {
  it('returns [] for empty text', () => {
    expect(computeHighlightRanges('', { inclusion: ['x'] })).toEqual([]);
  });

  it('returns [] for null/undefined text', () => {
    expect(computeHighlightRanges(undefined, { inclusion: ['x'] })).toEqual([]);
    expect(computeHighlightRanges(null, { inclusion: ['x'] })).toEqual([]);
  });

  it('returns [] when both term lists are empty', () => {
    expect(computeHighlightRanges('some text', { inclusion: [], exclusion: [] })).toEqual([]);
  });

  it('returns [] when terms object is omitted entirely', () => {
    expect(computeHighlightRanges('some text')).toEqual([]);
  });

  it('returns [] when no term matches', () => {
    expect(computeHighlightRanges('hello world', { inclusion: ['zebra'] })).toEqual([]);
  });
});

// ── computeHighlightRanges: basic matching ───────────────────────────────────

describe('computeHighlightRanges — basic matching', () => {
  it('finds a single inclusion match with correct offsets', () => {
    const text = 'a randomized trial';
    const ranges = computeHighlightRanges(text, { inclusion: ['randomized'] });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].type).toBe('inclusion');
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('randomized');
  });

  it('matches case-insensitively', () => {
    const text = 'A RANDOMIZED Controlled Trial';
    const ranges = computeHighlightRanges(text, { inclusion: ['randomized controlled trial'] });
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('RANDOMIZED Controlled Trial');
  });

  it('marks exclusion matches with type "exclusion"', () => {
    const ranges = computeHighlightRanges('animal model used', { exclusion: ['animal'] });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].type).toBe('exclusion');
  });

  it('finds multiple non-overlapping matches and returns them sorted by position', () => {
    const text = 'cohort study and cohort design';
    const ranges = computeHighlightRanges(text, { inclusion: ['cohort'] });
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBeLessThan(ranges[1].start);
    expect(slice(text, ranges)).toEqual(['cohort', 'cohort']);
  });
});

// ── computeHighlightRanges: word boundaries ──────────────────────────────────

describe('computeHighlightRanges — word boundaries', () => {
  it('does not match inside a larger word', () => {
    // "art" must NOT match inside "start"
    const ranges = computeHighlightRanges('the start of art', { inclusion: ['art'] });
    // Only the standalone "art" at the end should match.
    expect(ranges).toHaveLength(1);
    const text = 'the start of art';
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('art');
    // And the matched "art" is the last token, not the one inside "start".
    expect(ranges[0].start).toBe(text.lastIndexOf('art'));
  });

  it('does not match a prefix inside a longer word', () => {
    const ranges = computeHighlightRanges('international study', { inclusion: ['nation'] });
    expect(ranges).toEqual([]);
  });

  it('matches phrases delimited by spaces and punctuation', () => {
    const text = 'Outcome: glycemic control, measured.';
    const ranges = computeHighlightRanges(text, { inclusion: ['glycemic control'] });
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('glycemic control');
  });
});

// ── computeHighlightRanges: overlap resolution ───────────────────────────────

describe('computeHighlightRanges — overlap resolution', () => {
  it('longer match wins over a shorter overlapping match', () => {
    const text = 'a randomized controlled trial here';
    const ranges = computeHighlightRanges(text, {
      inclusion: ['randomized', 'randomized controlled trial'],
    });
    // The single span should be the longer phrase, not two overlapping spans.
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('randomized controlled trial');
  });

  it('exclusion wins over inclusion on an exact-length tie/overlap', () => {
    // Same word appears as both an inclusion and exclusion term — equal length.
    const text = 'pediatric population studied';
    const ranges = computeHighlightRanges(text, {
      inclusion: ['pediatric'],
      exclusion: ['pediatric'],
    });
    expect(ranges).toHaveLength(1);
    expect(ranges[0].type).toBe('exclusion');
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('pediatric');
  });

  it('longer inclusion beats shorter exclusion when they overlap', () => {
    const text = 'the animal welfare guidelines';
    const ranges = computeHighlightRanges(text, {
      inclusion: ['animal welfare'],
      exclusion: ['animal'],
    });
    // Longer term (inclusion) wins the overlapping span.
    expect(ranges).toHaveLength(1);
    expect(ranges[0].type).toBe('inclusion');
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('animal welfare');
  });

  it('produces a clean non-overlapping set (no overlaps, sorted)', () => {
    const text = 'randomized controlled trial in an animal model';
    const ranges = computeHighlightRanges(text, {
      inclusion: ['randomized controlled trial', 'trial'],
      exclusion: ['animal model', 'model'],
    });
    // Verify sorted and non-overlapping.
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end);
    }
  });
});

// ── computeHighlightRanges: invariants ───────────────────────────────────────

describe('computeHighlightRanges — invariants', () => {
  it('never produces out-of-bounds ranges', () => {
    const text = 'cohort study cohort study cohort study';
    const ranges = computeHighlightRanges(text, { inclusion: ['cohort study'] });
    for (const r of ranges) {
      expect(r.start).toBeGreaterThanOrEqual(0);
      expect(r.end).toBeLessThanOrEqual(text.length);
      expect(r.start).toBeLessThan(r.end);
    }
  });

  it('never splits a word — matched text equals the term', () => {
    const text = 'Meta-analysis and meta analysis';
    const ranges = computeHighlightRanges(text, { inclusion: ['meta analysis'] });
    for (const r of ranges) {
      expect(text.slice(r.start, r.end).toLowerCase()).toBe('meta analysis');
    }
  });

  it('every range has start, end and a valid type', () => {
    const text = 'systematic review and animal study';
    const ranges = computeHighlightRanges(text, {
      inclusion: ['systematic review'],
      exclusion: ['animal study'],
    });
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) {
      expect(typeof r.start).toBe('number');
      expect(typeof r.end).toBe('number');
      expect(['inclusion', 'exclusion']).toContain(r.type);
    }
  });
});
