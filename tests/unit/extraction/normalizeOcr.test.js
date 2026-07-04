import { describe, it, expect } from 'vitest';
import { normalizeOcrWords, cacheKey, OCR_MODES } from '../../../src/research-engine/extraction/ocr/normalizeOcr.js';

const word = (text, x0, y0, x1, y1, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

describe('normalizeOcr — Tesseract words → pdf.js item contract (§24.4)', () => {
  it('flips y: a word near the image TOP maps to a LARGE user-space y', () => {
    const top = word('Top', 10, 5, 50, 20);
    const bottom = word('Bottom', 10, 780, 60, 795);
    const [t, b] = normalizeOcrWords([top, bottom], { page: 1, pageHeight: 800 });
    expect(t.y).toBe(780); // 800 − 20
    expect(b.y).toBe(5); // 800 − 795
    expect(t.y).toBeGreaterThan(b.y);
  });

  it('maps pixels → user space through the viewport scale', () => {
    // viewport.height = pageHeightUser × scale; scale 2 halves pixel coords.
    const [it2] = normalizeOcrWords([word('42', 100, 30, 140, 50)], {
      page: 3,
      viewport: { width: 1200, height: 1600, scale: 2 },
    });
    expect(it2.x).toBe(50); // 100 / 2
    expect(it2.y).toBe(775); // (1600 − 50) / 2
    expect(it2.w).toBe(20); // (140 − 100) / 2
    expect(it2.h).toBe(10); // (50 − 30) / 2
    expect(it2.page).toBe(3);
  });

  it('tags source:"ocr" and passes confidence through (clamped to [0,100])', () => {
    const out = normalizeOcrWords(
      [word('a', 0, 0, 5, 10, 87.5), word('b', 0, 20, 5, 30, 250), word('c', 0, 40, 5, 50, NaN)],
      { pageHeight: 100 },
    );
    expect(out.map((i) => i.source)).toEqual(['ocr', 'ocr', 'ocr']);
    expect(out[0].confidence).toBe(87.5);
    expect(out[1].confidence).toBe(100);
    expect(out[2].confidence).toBe(0);
  });

  it('rounds coordinates to 4 decimals for byte-identical determinism', () => {
    const [a] = normalizeOcrWords([word('x', 10, 0, 20, 30)], {
      viewport: { width: 100, height: 100, scale: 3 },
    });
    expect(a.x).toBe(3.3333);
    expect(a.w).toBe(3.3333);
    const again = normalizeOcrWords([word('x', 10, 0, 20, 30)], {
      viewport: { width: 100, height: 100, scale: 3 },
    });
    expect(again[0]).toEqual(a);
  });

  it('skips empty-text and non-finite-bbox words without throwing', () => {
    const out = normalizeOcrWords(
      [
        word('', 0, 0, 5, 10),
        word('   ', 0, 0, 5, 10),
        word('bad', NaN, 0, 5, 10),
        { text: 'no-bbox', confidence: 50 },
        null,
        7,
        word('ok', 0, 0, 5, 10),
      ],
      { pageHeight: 100 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].str).toBe('ok');
  });

  it('returns [] on non-array input and defaults page to 1', () => {
    expect(normalizeOcrWords(null)).toEqual([]);
    expect(normalizeOcrWords(undefined)).toEqual([]);
    expect(normalizeOcrWords('words')).toEqual([]);
    const [a] = normalizeOcrWords([word('p', 0, 0, 5, 10)], { pageHeight: 50 });
    expect(a.page).toBe(1);
  });

  it('never throws on malformed opts', () => {
    expect(() => normalizeOcrWords([word('x', 0, 0, 5, 10)], { viewport: 'nope', pageHeight: 'tall' })).not.toThrow();
    expect(() => normalizeOcrWords([word('x', 0, 0, 5, 10)], null)).not.toThrow();
  });
});

describe('normalizeOcr — cacheKey (§24.5) + OCR_MODES (§24.3)', () => {
  const parts = { pdfFingerprint: 'abc123', page: 2, mode: 'text', tessVersion: '5.0.4', scale: 1.5 };

  it('is deterministic: same parts → identical string', () => {
    expect(cacheKey(parts)).toBe(cacheKey({ ...parts }));
    expect(typeof cacheKey(parts)).toBe('string');
  });

  it('is sensitive to EVERY key part', () => {
    const base = cacheKey(parts);
    expect(cacheKey({ ...parts, pdfFingerprint: 'zzz' })).not.toBe(base);
    expect(cacheKey({ ...parts, page: 3 })).not.toBe(base);
    expect(cacheKey({ ...parts, mode: 'digits' })).not.toBe(base);
    expect(cacheKey({ ...parts, tessVersion: '5.0.5' })).not.toBe(base);
    expect(cacheKey({ ...parts, scale: 2 })).not.toBe(base);
  });

  it('never throws on missing/malformed parts', () => {
    expect(() => cacheKey(null)).not.toThrow();
    expect(() => cacheKey(undefined)).not.toThrow();
    expect(typeof cacheKey({})).toBe('string');
  });

  it('exposes exactly the two §24.3 modes', () => {
    expect(OCR_MODES).toEqual(['text', 'digits']);
  });
});
