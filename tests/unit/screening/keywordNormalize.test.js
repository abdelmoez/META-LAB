/**
 * keywordNormalize.test.js — 107.md §§2-3. The single canonical keyword key and the
 * selected-phrase normalizer. Pure functions; no DOM, no React.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeKeywordKey, normalizeSelectedPhrase,
} from '../../../src/research-engine/screening/keywordNormalize.js';

describe('normalizeKeywordKey', () => {
  it('lowercases, collapses whitespace (incl. line breaks) and trims', () => {
    expect(normalizeKeywordKey('  Randomized   Controlled\n Trial ')).toBe('randomized controlled trial');
    expect(normalizeKeywordKey('Drug Resistant Epilepsy')).toBe('drug resistant epilepsy');
  });

  it('treats case variants of the same phrase as ONE key (107.md §3 duplicate detection)', () => {
    expect(normalizeKeywordKey('Drug Resistant Epilepsy'))
      .toBe(normalizeKeywordKey('drug resistant epilepsy'));
  });

  it('folds unicode dashes and quotes so a curly variant is not a second keyword', () => {
    expect(normalizeKeywordKey('drug‑resistant')).toBe('drug-resistant');   // non-breaking hyphen
    expect(normalizeKeywordKey('non–randomized')).toBe('non-randomized');   // en dash
    expect(normalizeKeywordKey('non—randomized')).toBe('non-randomized');   // em dash
    expect(normalizeKeywordKey('Parkinson’s disease')).toBe("parkinson's disease");
    expect(normalizeKeywordKey('“blinded”')).toBe('"blinded"');
  });

  it('keeps meaningful internal punctuation distinct', () => {
    expect(normalizeKeywordKey('drug-resistant epilepsy')).not.toBe(normalizeKeywordKey('drug resistant epilepsy'));
  });

  it('tolerates non-string input', () => {
    expect(normalizeKeywordKey(null)).toBe('');
    expect(normalizeKeywordKey(undefined)).toBe('');
    expect(normalizeKeywordKey(42)).toBe('42');
  });
});

describe('normalizeSelectedPhrase', () => {
  it('handles the 107.md §3 example verbatim', () => {
    expect(normalizeSelectedPhrase('  drug-resistant\n epilepsy,  ')).toBe('drug-resistant epilepsy');
  });

  it('collapses line breaks and repeated whitespace', () => {
    expect(normalizeSelectedPhrase('type 2\n\n   diabetes')).toBe('type 2 diabetes');
    expect(normalizeSelectedPhrase('\t randomized \t controlled \t trial \n')).toBe('randomized controlled trial');
  });

  it('strips accidental leading/trailing punctuation', () => {
    expect(normalizeSelectedPhrase('epilepsy.')).toBe('epilepsy');
    expect(normalizeSelectedPhrase('(epilepsy)')).toBe('epilepsy');
    expect(normalizeSelectedPhrase('“epilepsy”')).toBe('epilepsy');
    expect(normalizeSelectedPhrase('; epilepsy :')).toBe('epilepsy');
    expect(normalizeSelectedPhrase('...epilepsy!?')).toBe('epilepsy');
  });

  it('PRESERVES medically meaningful internal punctuation', () => {
    expect(normalizeSelectedPhrase(' drug-resistant epilepsy ')).toBe('drug-resistant epilepsy');
    expect(normalizeSelectedPhrase('BMI 30 kg/m2,')).toBe('BMI 30 kg/m2');
    expect(normalizeSelectedPhrase('type 2 diabetes (T2DM)')).toBe('type 2 diabetes (T2DM)');
    expect(normalizeSelectedPhrase("Parkinson's disease.")).toBe("Parkinson's disease");
    expect(normalizeSelectedPhrase('1.5 T MRI')).toBe('1.5 T MRI');
  });

  it('preserves the display casing (only the KEY is lowercased)', () => {
    expect(normalizeSelectedPhrase('Drug-Resistant Epilepsy,')).toBe('Drug-Resistant Epilepsy');
  });

  it('returns "" for an empty or punctuation-only selection', () => {
    expect(normalizeSelectedPhrase('')).toBe('');
    expect(normalizeSelectedPhrase('   \n  ')).toBe('');
    expect(normalizeSelectedPhrase('.,;:')).toBe('');
    expect(normalizeSelectedPhrase(null)).toBe('');
  });
});
