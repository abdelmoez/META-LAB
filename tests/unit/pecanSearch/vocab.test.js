import { describe, it, expect } from 'vitest';
import {
  resolveLanguage, toIso6391, toIso6392b, toPubmedLanguage,
  toCrossrefType, toS2PublicationType, parseDateBound,
} from '../../../server/pecanSearch/query/vocab.js';

describe('query/vocab — provider vocabulary mapping', () => {
  it('resolves a language from name, 2-letter, or 3-letter input', () => {
    for (const v of ['English', 'english', 'en', 'EN', 'eng', 'ENG']) {
      expect(toIso6391(v)).toBe('en');
      expect(toIso6392b(v)).toBe('eng');
      expect(toPubmedLanguage(v)).toBe('English');
    }
  });

  it('maps the right per-provider code for each language', () => {
    // The exact split that caused 0-result sources before the fix.
    expect(toIso6391('English')).toBe('en');    // DOAJ + OpenAlex
    expect(toIso6392b('English')).toBe('eng');  // Europe PMC
    expect(toPubmedLanguage('English')).toBe('English'); // PubMed
    expect(toIso6392b('German')).toBe('ger');   // 639-2/B, not 639-2/T "deu"
    expect(toIso6392b('deu')).toBe('ger');       // accepts the 639-2/T alias
  });

  it('returns "" for an unmappable language (so callers drop + warn, never zero a source)', () => {
    expect(resolveLanguage('Klingon')).toBeNull();
    expect(toIso6391('Klingon')).toBe('');
    expect(toIso6392b('')).toBe('');
  });

  it('maps publication types to valid Crossref work-type ids, else "" ', () => {
    expect(toCrossrefType('journal article')).toBe('journal-article');
    expect(toCrossrefType('article')).toBe('journal-article');
    expect(toCrossrefType('book chapter')).toBe('book-chapter');
    expect(toCrossrefType('preprint')).toBe('posted-content');
    expect(toCrossrefType('posted-content')).toBe('posted-content'); // valid id passes through
    // These are study designs, NOT Crossref work types — must NOT be emitted (they error the whole query).
    expect(toCrossrefType('review')).toBe('');
    expect(toCrossrefType('randomized controlled trial')).toBe('');
  });

  it('maps publication types to the Semantic Scholar enum, else "" ', () => {
    expect(toS2PublicationType('review')).toBe('Review');
    expect(toS2PublicationType('randomized controlled trial')).toBe('ClinicalTrial');
    expect(toS2PublicationType('meta-analysis')).toBe('MetaAnalysis');
    expect(toS2PublicationType('journal article')).toBe('JournalArticle');
    expect(toS2PublicationType('Review')).toBe('Review'); // valid enum passes through
    expect(toS2PublicationType('nonsense')).toBe('');
  });

  it('parses valid date bounds and rejects junk', () => {
    expect(parseDateBound('2020')).toMatchObject({ year: '2020', ymd: '2020' });
    expect(parseDateBound('2020-05')).toMatchObject({ year: '2020', month: '05' });
    expect(parseDateBound('2020/05/01')).toMatchObject({ ymd: '2020-05-01' });
    expect(parseDateBound('soon')).toBeNull();
    expect(parseDateBound('')).toBeNull();
    expect(parseDateBound('not-a-date')).toBeNull();
  });
});
