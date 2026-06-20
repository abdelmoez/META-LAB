/**
 * pdfSearch.test.js — prompt39 follow-up. The pure, abortable AppPdfViewer search
 * helpers (matching + the resilient page scan).
 */
import { describe, it, expect } from 'vitest';
import { pageTextFromContent, pageMatches, collectMatchingPages, findMatchesInText, escapeRegExp, countMatchesInItems } from '../../src/frontend/components/pdfSearch.js';

describe('pageTextFromContent', () => {
  it('flattens pdf.js text items into one lowercased string', () => {
    expect(pageTextFromContent({ items: [{ str: 'Hello' }, { str: 'WORLD' }] })).toBe('hello world');
  });
  it('tolerates missing / malformed content', () => {
    expect(pageTextFromContent(null)).toBe('');
    expect(pageTextFromContent({})).toBe('');
    expect(pageTextFromContent({ items: [{}, { str: 'A' }, null] })).toBe(' a ');
  });
});

describe('pageMatches', () => {
  it('is case-insensitive substring match', () => {
    expect(pageMatches('the quick brown fox', 'QUICK')).toBe(true);
    expect(pageMatches('Diabetes Mellitus', 'mellitus')).toBe(true);
    expect(pageMatches('nothing here', 'absent')).toBe(false);
  });
  it('empty term never matches', () => {
    expect(pageMatches('anything', '')).toBe(false);
    expect(pageMatches('anything', null)).toBe(false);
  });
});

describe('collectMatchingPages', () => {
  const pages = { 1: 'intro methods', 2: 'results diabetes', 3: 'discussion diabetes mellitus', 4: 'references' };
  const getPageText = async (i) => pages[i];

  it('returns 1-based page numbers containing the term', async () => {
    const hits = await collectMatchingPages({ numPages: 4, getPageText, term: 'diabetes' });
    expect(hits).toEqual([2, 3]);
  });
  it('reports progress for every page and matches case-insensitively', async () => {
    const seen = [];
    const hits = await collectMatchingPages({ numPages: 4, getPageText, term: 'METHODS', onProgress: (d, t) => seen.push(`${d}/${t}`) });
    expect(hits).toEqual([1]);
    expect(seen).toEqual(['1/4', '2/4', '3/4', '4/4']);
  });
  it('aborts early and returns null when isAborted() flips', async () => {
    let scanned = 0;
    const hits = await collectMatchingPages({
      numPages: 4,
      getPageText: async (i) => { scanned = i; return pages[i]; },
      term: 'diabetes',
      isAborted: () => scanned >= 2, // abort once we have scanned to page 2
    });
    expect(hits).toBeNull();
    expect(scanned).toBeLessThanOrEqual(2);
  });
  it('is resilient: a page whose text throws is treated as empty, scan continues', async () => {
    const flaky = async (i) => { if (i === 2) throw new Error('boom'); return pages[i]; };
    const hits = await collectMatchingPages({ numPages: 4, getPageText: flaky, term: 'diabetes' });
    expect(hits).toEqual([3]); // page 2 (which also had the term) failed → skipped, scan continued
  });
  it('empty term yields no matches', async () => {
    expect(await collectMatchingPages({ numPages: 4, getPageText, term: '' })).toEqual([]);
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so the term matches literally', () => {
    expect(escapeRegExp('a.b*c?')).toBe('a\\.b\\*c\\?');
    expect(escapeRegExp('(x)[y]{z}')).toBe('\\(x\\)\\[y\\]\\{z\\}');
  });
});

describe('findMatchesInText (prompt42 Task 6)', () => {
  it('finds every occurrence with index + length (case-insensitive by default)', () => {
    const r = findMatchesInText('Diabetes and diabetes and DIABETES', 'diabetes');
    expect(r).toEqual([{ index: 0, length: 8 }, { index: 13, length: 8 }, { index: 26, length: 8 }]);
  });
  it('match-case only matches exact case', () => {
    const r = findMatchesInText('Diabetes diabetes', 'diabetes', { matchCase: true });
    expect(r).toEqual([{ index: 9, length: 8 }]);
  });
  it('whole-word does not match inside a larger word', () => {
    expect(findMatchesInText('diabetess diabetes-x', 'diabetes', { wholeWord: true }))
      .toEqual([{ index: 10, length: 8 }]); // "diabetess" is rejected; the hyphen is a boundary
    expect(findMatchesInText('the diabetes test', 'diabetes', { wholeWord: true }))
      .toEqual([{ index: 4, length: 8 }]);
  });
  it('treats the term literally (regex metachars do not run)', () => {
    expect(findMatchesInText('a.b a.b axb', 'a.b')).toEqual([{ index: 0, length: 3 }, { index: 4, length: 3 }]);
  });
  it('empty term / text → []', () => {
    expect(findMatchesInText('anything', '')).toEqual([]);
    expect(findMatchesInText('', 'x')).toEqual([]);
    expect(findMatchesInText(null, null)).toEqual([]);
  });
});

describe('countMatchesInItems', () => {
  it('sums matches across pdf.js text items', () => {
    const items = [{ str: 'heart failure' }, { str: 'HEART rate' }, {}, { str: 'no match' }];
    expect(countMatchesInItems(items, 'heart')).toBe(2);
    expect(countMatchesInItems(items, 'heart', { matchCase: true })).toBe(1);
    expect(countMatchesInItems(null, 'x')).toBe(0);
  });
});
