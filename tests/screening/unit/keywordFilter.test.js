/**
 * keywordFilter.test.js
 * Unit tests for the META·SIFT keyword counting / filtering / highlighting
 * engine (prompt2 Task 8). Pure-function tests — no server, no network.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  recordContainsKeyword,
  countArticlesByKeyword,
  filterRecordsByKeywords,
  buildHighlightSegments,
  DEFAULT_INCLUDE_KEYWORDS,
  DEFAULT_EXCLUDE_KEYWORDS,
} from '../../../src/research-engine/screening/keywordFilter.js';

// Small record factory.
const rec = (id, title = '', abstract = '', keywords = '') => ({
  id,
  title,
  abstract,
  keywords,
});

// Reconstruct text from highlight segments.
const join = segs => segs.map(s => s.text).join('');

// ── normalizeText ────────────────────────────────────────────────────────────

describe('normalizeText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeText('  Hello   WORLD\t\nthere  ')).toBe('hello world there');
  });

  it('normalizes unicode dashes to ascii hyphen', () => {
    // en dash, em dash, non-breaking hyphen, minus sign
    expect(normalizeText('non–randomized')).toBe('non-randomized');
    expect(normalizeText('cross—sectional')).toBe('cross-sectional');
    expect(normalizeText('non‑randomized')).toBe('non-randomized');
  });

  it('normalizes unicode quotes to ascii', () => {
    expect(normalizeText('“quoted”')).toBe('"quoted"');
    expect(normalizeText('it’s')).toBe("it's");
  });

  it('returns "" for null/undefined/non-string', () => {
    expect(normalizeText(null)).toBe('');
    expect(normalizeText(undefined)).toBe('');
    expect(normalizeText(42)).toBe('42');
  });
});

// ── recordContainsKeyword: phrase vs token-boundary ──────────────────────────

describe('recordContainsKeyword — boundary & phrase semantics', () => {
  it('does NOT match a token inside a larger word ("rat" in "operate"/"iterate")', () => {
    const r = rec(1, 'We operate and iterate quickly', 'no animals here');
    expect(recordContainsKeyword(r, 'rat')).toBe(false);
  });

  it('matches a standalone token at a real boundary', () => {
    const r = rec(2, 'The rat was observed', '');
    expect(recordContainsKeyword(r, 'rat')).toBe(true);
  });

  it('matches a multi-word phrase only as a contiguous phrase', () => {
    const yes = rec(3, '', 'This is a controlled trial of metformin');
    const no = rec(4, '', 'controlled cohort; separate trial arm');
    expect(recordContainsKeyword(yes, 'controlled trial')).toBe(true);
    expect(recordContainsKeyword(no, 'controlled trial')).toBe(false);
  });

  it('matches hyphenated keywords like "non-randomized" and "cross-sectional"', () => {
    const r = rec(5, 'A non-randomized cross-sectional analysis', '');
    expect(recordContainsKeyword(r, 'non-randomized')).toBe(true);
    expect(recordContainsKeyword(r, 'cross-sectional')).toBe(true);
  });

  it('matches hyphenated keyword even when the source uses a unicode dash', () => {
    const r = rec(6, 'A non–randomized design', '');
    expect(recordContainsKeyword(r, 'non-randomized')).toBe(true);
  });

  it('is case-insensitive', () => {
    const r = rec(7, 'A RANDOMIZED Controlled TRIAL', '');
    expect(recordContainsKeyword(r, 'randomized controlled trial')).toBe(true);
    expect(recordContainsKeyword(r, 'Randomized')).toBe(true);
  });

  it('is robust to punctuation around the phrase', () => {
    const r = rec(8, '', 'Outcome: glycemic control, measured.');
    expect(recordContainsKeyword(r, 'glycemic control')).toBe(true);
  });

  it('searches across title + abstract + keywords', () => {
    expect(recordContainsKeyword(rec(9, 'placebo', '', ''), 'placebo')).toBe(true);
    expect(recordContainsKeyword(rec(10, '', 'placebo', ''), 'placebo')).toBe(true);
    expect(recordContainsKeyword(rec(11, '', '', 'placebo'), 'placebo')).toBe(true);
  });

  it('handles missing fields gracefully (treated as "")', () => {
    expect(recordContainsKeyword({ id: 1, title: 'cohort' }, 'cohort')).toBe(true);
    expect(recordContainsKeyword({ id: 2 }, 'cohort')).toBe(false);
    expect(recordContainsKeyword({ id: 3 }, '')).toBe(false);
  });

  it('supports an array-valued keywords field', () => {
    const r = { id: 1, title: '', abstract: '', keywords: ['placebo', 'double blind'] };
    expect(recordContainsKeyword(r, 'double blind')).toBe(true);
  });
});

// ── countArticlesByKeyword ───────────────────────────────────────────────────

describe('countArticlesByKeyword', () => {
  it('counts ARTICLES, not occurrences (repeats in one article count once)', () => {
    const records = [
      rec(1, 'cohort cohort cohort', 'cohort study cohort study'), // many occ, 1 article
      rec(2, 'a randomized trial', ''),
      rec(3, '', 'observational cohort'),
    ];
    const counts = countArticlesByKeyword(records, ['cohort']);
    expect(counts.cohort).toBe(2); // articles 1 and 3, NOT the 5 occurrences
  });

  it('returns a count per keyword keyed by the original keyword string', () => {
    const records = [
      rec(1, 'randomized controlled trial', ''),
      rec(2, 'animal model', ''),
      rec(3, 'randomized cohort', ''),
    ];
    const counts = countArticlesByKeyword(records, ['randomized', 'animal', 'placebo']);
    expect(counts).toEqual({ randomized: 2, animal: 1, placebo: 0 });
  });

  it('does not over-count via substrings (boundary aware)', () => {
    const records = [rec(1, 'we operate and iterate', '')];
    const counts = countArticlesByKeyword(records, ['rat']);
    expect(counts.rat).toBe(0);
  });

  it('returns {} for empty keyword list', () => {
    expect(countArticlesByKeyword([rec(1, 'x')], [])).toEqual({});
  });

  it('handles empty / non-array records', () => {
    expect(countArticlesByKeyword([], ['cohort'])).toEqual({ cohort: 0 });
    expect(countArticlesByKeyword(null, ['cohort'])).toEqual({ cohort: 0 });
  });
});

// ── filterRecordsByKeywords ──────────────────────────────────────────────────

describe('filterRecordsByKeywords', () => {
  const records = [
    rec(1, 'randomized controlled trial', 'double blind placebo'),
    rec(2, 'animal model study', 'rat cohort'),
    rec(3, 'randomized cohort', 'observational'),
    rec(4, 'systematic review', 'meta-analysis'),
  ];

  it('OR (default): keeps records matching ANY selected keyword', () => {
    const out = filterRecordsByKeywords(records, ['randomized', 'animal']);
    expect(out.map(r => r.id).sort()).toEqual([1, 2, 3]);
  });

  it('AND mode: keeps records matching ALL selected keywords', () => {
    const out = filterRecordsByKeywords(records, ['randomized', 'cohort'], { mode: 'AND' });
    expect(out.map(r => r.id)).toEqual([3]);
  });

  it('AND mode with no record matching all returns empty', () => {
    const out = filterRecordsByKeywords(records, ['randomized', 'animal'], { mode: 'AND' });
    expect(out).toEqual([]);
  });

  it('empty selection returns ALL records unchanged (same reference)', () => {
    expect(filterRecordsByKeywords(records, [])).toBe(records);
    expect(filterRecordsByKeywords(records, undefined)).toBe(records);
  });

  it('mode is case-insensitive ("and" === "AND")', () => {
    const out = filterRecordsByKeywords(records, ['randomized', 'cohort'], { mode: 'and' });
    expect(out.map(r => r.id)).toEqual([3]);
  });

  it('unknown mode falls back to OR', () => {
    const out = filterRecordsByKeywords(records, ['systematic review'], { mode: 'xyz' });
    expect(out.map(r => r.id)).toEqual([4]);
  });
});

// ── buildHighlightSegments ───────────────────────────────────────────────────

describe('buildHighlightSegments — reconstruction invariant', () => {
  it('joined segments exactly reconstruct the original text', () => {
    const text = 'A randomized controlled trial in an animal model (n=42).';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['randomized controlled trial'],
      excludeTerms: ['animal'],
    });
    expect(join(segs)).toBe(text);
  });

  it('reconstructs original text even with unicode dashes preserved', () => {
    const text = 'A non–randomized cross–sectional study';
    const segs = buildHighlightSegments(text, {
      excludeTerms: ['non-randomized', 'cross-sectional'],
    });
    // Original characters (including the unicode dashes) are preserved verbatim.
    expect(join(segs)).toBe(text);
  });

  it('returns a single plain segment when no terms supplied', () => {
    const text = 'plain text only';
    expect(buildHighlightSegments(text, {})).toEqual([{ text, type: 'plain' }]);
  });

  it('returns a single plain segment when terms match nothing', () => {
    const text = 'plain text only';
    const segs = buildHighlightSegments(text, { includeTerms: ['zebra'] });
    expect(segs).toEqual([{ text, type: 'plain' }]);
  });

  it('returns [] for empty/non-string text', () => {
    expect(buildHighlightSegments('', { includeTerms: ['x'] })).toEqual([]);
    expect(buildHighlightSegments(null, { includeTerms: ['x'] })).toEqual([]);
  });
});

describe('buildHighlightSegments — typing & colours', () => {
  it('marks include terms as type "include" (green) and exclude as "exclude" (red)', () => {
    const text = 'randomized animal';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['randomized'],
      excludeTerms: ['animal'],
    });
    const inc = segs.find(s => s.text === 'randomized');
    const exc = segs.find(s => s.text === 'animal');
    expect(inc.type).toBe('include');
    expect(exc.type).toBe('exclude');
  });

  it('preserves original casing in the highlighted segment text', () => {
    const text = 'A RANDOMIZED Trial';
    const segs = buildHighlightSegments(text, { includeTerms: ['randomized'] });
    expect(segs.find(s => s.type === 'include').text).toBe('RANDOMIZED');
  });

  it('only "plain" | "include" | "exclude" types are produced', () => {
    const text = 'randomized animal cohort plainword';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['randomized'],
      excludeTerms: ['animal'],
    });
    for (const s of segs) {
      expect(['plain', 'include', 'exclude']).toContain(s.type);
    }
  });

  it('is phrase- and boundary-aware ("rat" does not highlight inside "operate")', () => {
    const text = 'we operate the trial';
    const segs = buildHighlightSegments(text, { excludeTerms: ['rat'] });
    expect(segs).toEqual([{ text, type: 'plain' }]);
  });
});

describe('buildHighlightSegments — overlap resolution', () => {
  it('longer phrase wins over a shorter overlapping match', () => {
    const text = 'a randomized controlled trial here';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['randomized', 'randomized controlled trial'],
    });
    const highlighted = segs.filter(s => s.type !== 'plain');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toBe('randomized controlled trial');
    expect(join(segs)).toBe(text);
  });

  it('default priority "exclude": exclude wins an exact-length overlap (red)', () => {
    const text = 'pediatric population';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['pediatric'],
      excludeTerms: ['pediatric'],
    });
    const hit = segs.find(s => s.text === 'pediatric');
    expect(hit.type).toBe('exclude');
  });

  it('priority "include": include wins an exact-length overlap (green)', () => {
    const text = 'pediatric population';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['pediatric'],
      excludeTerms: ['pediatric'],
      priority: 'include',
    });
    const hit = segs.find(s => s.text === 'pediatric');
    expect(hit.type).toBe('include');
  });

  it('longer include still beats a shorter exclude even under exclude priority', () => {
    const text = 'the animal welfare guidelines';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['animal welfare'],
      excludeTerms: ['animal'],
    });
    const hit = segs.find(s => s.type !== 'plain');
    expect(hit.type).toBe('include');
    expect(hit.text).toBe('animal welfare');
    expect(join(segs)).toBe(text);
  });

  it('produces multiple highlighted segments interleaved with plain ones', () => {
    const text = 'randomized then animal then cohort';
    const segs = buildHighlightSegments(text, {
      includeTerms: ['randomized', 'cohort'],
      excludeTerms: ['animal'],
    });
    expect(join(segs)).toBe(text);
    const types = segs.map(s => s.type);
    expect(types).toContain('include');
    expect(types).toContain('exclude');
    expect(types).toContain('plain');
  });
});

// ── default keywords smoke test ──────────────────────────────────────────────

describe('default keyword re-exports', () => {
  it('re-exports DEFAULT_INCLUDE_KEYWORDS including "randomized"', () => {
    expect(Array.isArray(DEFAULT_INCLUDE_KEYWORDS)).toBe(true);
    expect(DEFAULT_INCLUDE_KEYWORDS).toContain('randomized');
  });

  it('re-exports DEFAULT_EXCLUDE_KEYWORDS including "animal"', () => {
    expect(Array.isArray(DEFAULT_EXCLUDE_KEYWORDS)).toBe(true);
    expect(DEFAULT_EXCLUDE_KEYWORDS).toContain('animal');
  });

  it('default keywords work end-to-end against a record', () => {
    const r = rec(1, 'A randomized controlled trial', 'no animal subjects involved');
    expect(recordContainsKeyword(r, 'randomized')).toBe(true);
    expect(recordContainsKeyword(r, 'animal')).toBe(true);
  });
});
