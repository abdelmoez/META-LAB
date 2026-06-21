/**
 * embeddingText.test.js — se2.md §7 biomedical embedding text representation (pure).
 */
import { describe, it, expect } from 'vitest';
import {
  buildEmbeddingText, normalizeForEmbedding, embeddingTextHash, EMBEDDING_TEXT_DEFAULTS,
} from '../../../../src/research-engine/screening/ai/embeddingText.js';

describe('normalizeForEmbedding', () => {
  it('strips control + zero-width chars and collapses whitespace', () => {
    expect(normalizeForEmbedding('a​b\tc  d')).toBe('ab c d'); // ZWSP joins a+b; tab+gaps collapse
    expect(normalizeForEmbedding('xy')).toBe('x y');          // control char -> space
    expect(normalizeForEmbedding(null)).toBe('');
    expect(normalizeForEmbedding('  hi  ')).toBe('hi');
  });
});

describe('buildEmbeddingText', () => {
  it('puts title + abstract first, then capped metadata', () => {
    const { text, quality } = buildEmbeddingText({
      title: 'Metformin in T2DM', abstract: 'A randomised trial of metformin.'.padEnd(60, ' x'),
      keywords: 'diabetes; metformin', journal: 'Lancet', publicationType: 'RCT',
    });
    expect(text.startsWith('Title: Metformin in T2DM')).toBe(true);
    expect(text).toMatch(/Abstract: /);
    expect(text).toMatch(/Keywords: diabetes; metformin/);
    expect(text).toMatch(/Type: RCT/);
    expect(text).toMatch(/Journal: Lancet/);
    expect(quality.hasAbstract).toBe(true);
    expect(quality.titleOnly).toBe(false);
  });

  it('flags title-only records (no usable abstract)', () => {
    const { quality } = buildEmbeddingText({ title: 'A study of something important here' });
    expect(quality.titleOnly).toBe(true);
    expect(quality.hasAbstract).toBe(false);
  });

  it('flags empty records', () => {
    expect(buildEmbeddingText({}).quality.empty).toBe(true);
  });

  it('caps keyword/MeSH terms', () => {
    const kw = Array.from({ length: 30 }, (_, i) => `term${i}`).join('; ');
    const { text } = buildEmbeddingText({ title: 'x', keywords: kw }, { keywordMax: 5 });
    expect(text).toMatch(/term4/);
    expect(text).not.toMatch(/term5\b/);
  });

  it('truncates a very long abstract and flags truncated', () => {
    const big = 'word '.repeat(5000);
    const { text, quality } = buildEmbeddingText({ title: 'T', abstract: big }, { maxChars: 200 });
    expect(text.length).toBeLessThanOrEqual(200);
    expect(quality.truncated).toBe(true);
  });

  it('never exceeds maxChars even with a large metaShare override', () => {
    const kw = Array(80).fill('longkeyword').join(',');
    const { text } = buildEmbeddingText({ title: 'TTTT', abstract: 'AAAA', keywords: kw }, { maxChars: 20, metaShare: 1.0 });
    expect(text.length).toBeLessThanOrEqual(20);
  });

  it('keeps metadata a minority share of the budget', () => {
    const kw = Array.from({ length: 100 }, (_, i) => `kw${i}`).join('; ');
    const { text } = buildEmbeddingText({ title: 'T', abstract: 'A '.repeat(40), keywords: kw }, { maxChars: 200, keywordMax: 100 });
    const metaIdx = text.indexOf('Keywords:');
    const metaLen = metaIdx >= 0 ? text.length - metaIdx : 0;
    expect(metaLen).toBeLessThanOrEqual(Math.floor(200 * EMBEDDING_TEXT_DEFAULTS.metaShare) + 12);
  });
});

describe('embeddingTextHash', () => {
  it('is stable + distinct', () => {
    expect(embeddingTextHash('abc')).toBe(embeddingTextHash('abc'));
    expect(embeddingTextHash('abc')).not.toBe(embeddingTextHash('abd'));
    expect(embeddingTextHash('abc')).toMatch(/^[0-9a-f]{16}$/);
  });
});
