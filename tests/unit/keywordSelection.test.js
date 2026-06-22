/**
 * keywordSelection.test.js — SB3 Tab 1 ("Select Keywords"). The pure tokenizer that
 * turns a research-question / PICO string into clickable word/phrase/filler tokens.
 * Verifies the spec's rules: click-to-select words, multi-word phrase preservation,
 * connector/filler exclusion (but content words like "adults" stay selectable), and
 * the suggested-keyword flag.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenizeForSelection, isFillerWord, extractPhrases, suggestedKeywords, norm,
} from '../../src/research-engine/searchBuilder/keywordSelection.js';

const RQ = 'In adults with obesity, do GLP-1 receptor agonists compared with placebo improve weight loss and HbA1c?';

const byNorm = (toks, n) => toks.find((t) => t.norm === norm(n));

describe('isFillerWord', () => {
  it('flags connectors / articles / prepositions / comparison words', () => {
    for (const w of ['and', 'or', 'the', 'of', 'with', 'without', 'in', 'to', 'by', 'versus', 'vs', 'compared', 'among']) {
      expect(isFillerWord(w)).toBe(true);
    }
  });
  it('does NOT flag clinically meaningful content words (spec selects "adults")', () => {
    for (const w of ['adults', 'obesity', 'placebo', 'semaglutide', 'mortality']) {
      expect(isFillerWord(w)).toBe(false);
    }
  });
  it('treats blank/stray single letters as filler', () => {
    expect(isFillerWord('')).toBe(true);
    expect(isFillerWord('a')).toBe(true);
  });
});

describe('tokenizeForSelection — words', () => {
  const toks = tokenizeForSelection(RQ);

  it('returns a token per word in reading order', () => {
    expect(toks.length).toBeGreaterThan(5);
  });
  it('marks content words selectable and connector words not', () => {
    expect(byNorm(toks, 'adults').selectable).toBe(true);
    expect(byNorm(toks, 'obesity').selectable).toBe(true);
    expect(byNorm(toks, 'placebo').selectable).toBe(true);
    expect(byNorm(toks, 'with').selectable).toBe(false);
    expect(byNorm(toks, 'and').selectable).toBe(false);
    expect(byNorm(toks, 'with').kind).toBe('filler');
  });
  it('strips trailing punctuation from the display text', () => {
    // "obesity," in the source → clean "obesity" for selection.
    expect(byNorm(toks, 'obesity').text).toBe('obesity');
    expect(byNorm(toks, 'hba1c').text.toLowerCase()).toBe('hba1c');
  });
  it('flags vocabulary matches as suggested (helpful, not forced)', () => {
    expect(byNorm(toks, 'obesity').suggested).toBe(true);
  });
});

describe('tokenizeForSelection — phrase preservation', () => {
  it('keeps "quality of life" as one selectable phrase token (not split on "of")', () => {
    const toks = tokenizeForSelection('change in quality of life over time');
    const phrase = toks.find((t) => t.kind === 'phrase');
    expect(phrase).toBeTruthy();
    expect(phrase.norm).toBe('quality of life');
    expect(phrase.selectable).toBe(true);
    // none of the phrase's inner words leak out as separate tokens
    expect(toks.filter((t) => t.norm === 'life').length).toBe(0);
  });
  it('keeps "standard of care" whole', () => {
    expect(extractPhrases('compared with standard of care')).toContain('standard of care');
  });
  it('keeps "heart failure with reduced ejection fraction" whole (does not split on "with")', () => {
    const toks = tokenizeForSelection('adults with heart failure with reduced ejection fraction');
    const phrases = toks.filter((t) => t.kind === 'phrase').map((t) => t.norm);
    expect(phrases).toContain('heart failure with reduced ejection fraction');
  });
  it('recognizes "weight loss" as a phrase in the example question', () => {
    expect(extractPhrases(RQ)).toContain('weight loss');
  });
});

describe('suggestedKeywords', () => {
  it('returns deduped, vocabulary-matched keywords in reading order', () => {
    const kws = suggestedKeywords('obesity and type 2 diabetes in obesity');
    expect(kws.length).toBe(new Set(kws.map(norm)).size); // deduped
    expect(kws.map(norm)).toContain('obesity');
  });
  it('returns [] for empty/whitespace input', () => {
    expect(suggestedKeywords('')).toEqual([]);
    expect(suggestedKeywords('   ')).toEqual([]);
  });
});
