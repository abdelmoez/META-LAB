/**
 * pdfSearch.test.js — prompt39 follow-up. The pure, abortable AppPdfViewer search
 * helpers (matching + the resilient page scan).
 */
import { describe, it, expect } from 'vitest';
import { pageTextFromContent, pageMatches, collectMatchingPages } from '../../src/frontend/components/pdfSearch.js';

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
