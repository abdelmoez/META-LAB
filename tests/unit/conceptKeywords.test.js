/**
 * conceptKeywords.test.js — prompt43 Area 1. Verifies the smarter screening
 * keyword extraction: criteria SENTENCES are digested into clinically meaningful
 * concepts + conservative synonyms, not copied verbatim.
 */
import { describe, it, expect } from 'vitest';
import {
  extractConcepts,
  extractConceptKeywords,
  expandSynonyms,
} from '../../src/research-engine/screening/conceptKeywords.js';

describe('extractConcepts', () => {
  it('the flagship example: digests a full sentence into concepts', () => {
    const concepts = extractConcepts('Include adult patients with type 2 diabetes undergoing bariatric surgery');
    // the whole sentence is NOT one keyword
    expect(concepts).not.toContain('include adult patients with type 2 diabetes undergoing bariatric surgery');
    expect(concepts).toContain('adult');                 // "adult patients" → "adult"
    expect(concepts).toContain('type 2 diabetes');       // split on "with"
    expect(concepts).toContain('bariatric surgery');     // split on "undergoing"
    // the directive "include" and population noun "patients" are gone
    expect(concepts).not.toContain('include');
    expect(concepts).not.toContain('patients');
  });

  it('strips leading directives but keeps a meaningful trailing "study"', () => {
    expect(extractConcepts('Studies of cohort study')).toEqual(['cohort study']);
    expect(extractConcepts('animal study')).toEqual(['animal study']);
    expect(extractConcepts('case report')).toEqual(['case report']);
  });

  it('protects "in vitro" / "in vivo" from the leading-stopword trim', () => {
    expect(extractConcepts('in vitro study')).toContain('in vitro study');
    expect(extractConcepts('in vivo models')).toContain('in vivo models');
  });

  it('splits on multiple connectors and trims population/filler edges', () => {
    const c = extractConcepts('adults with hypertension and chronic kidney disease');
    expect(c).toContain('adults');
    expect(c).toContain('hypertension');
    expect(c).toContain('chronic kidney disease');
  });

  it('splits disjunctions ("or") and other common joiners ("for")', () => {
    expect(extractConcepts('diabetes or hypertension')).toEqual(expect.arrayContaining(['diabetes', 'hypertension']));
    expect(extractConcepts('diabetes or hypertension')).not.toContain('diabetes or hypertension');
    const c = extractConcepts('statins for primary prevention of cardiovascular disease');
    expect(c).toContain('cardiovascular disease');
    expect(c).toContain('statins');
    expect(c).not.toContain('statins for primary prevention of cardiovascular disease');
  });

  it('keeps a named entity that contains a connector word intact (HFrEF)', () => {
    expect(extractConcepts('heart failure with reduced ejection fraction'))
      .toEqual(['heart failure with reduced ejection fraction']);
  });

  it('drops numeric / unit eligibility tails', () => {
    const c = extractConcepts('adults aged 18 years or older with chronic kidney disease');
    expect(c).toContain('adults');
    expect(c).toContain('chronic kidney disease');
    expect(c).not.toContain('18 years');
    expect(c).not.toContain('older');
    expect(extractConcepts('body mass index greater than 30 kg/m2')).toEqual(['body mass index']);
  });

  it('drops pure-symbol / pure-numeric fragments', () => {
    expect(extractConcepts('(((***[[[ \\ $1 ^^^ }}}')).toEqual([]);
    expect(extractConcepts('30 kg/m2')).toEqual([]);
  });

  it('drops empties / too-short / pure-filler fragments', () => {
    expect(extractConcepts('')).toEqual([]);
    expect(extractConcepts('the of and with')).toEqual([]);
    expect(extractConcepts('   ')).toEqual([]);
  });

  it('dedupes case/space-insensitively, preserving first display', () => {
    const c = extractConcepts('Diabetes; diabetes;  DIABETES');
    expect(c).toEqual(['diabetes']);
  });
});

describe('expandSynonyms', () => {
  it('expands type 2 diabetes with its abbreviation + spellings', () => {
    const syn = expandSynonyms('type 2 diabetes');
    expect(syn).toContain('T2DM');
    expect(syn).toContain('diabetes mellitus type 2');
    expect(syn).not.toContain('type 2 diabetes'); // never the concept itself
  });

  it('expands bariatric surgery with metabolic surgery + procedure names', () => {
    const syn = expandSynonyms('bariatric surgery');
    expect(syn).toContain('metabolic surgery');
    expect(syn).toContain('sleeve gastrectomy');
    expect(syn).toContain('gastric bypass');
  });

  it('expands HFrEF reachably through the whole-phrase extractor', () => {
    expect(extractConceptKeywords('heart failure with reduced ejection fraction')).toContain('HFrEF');
  });

  it('returns [] for an unknown concept, and never a 2-letter abbreviation', () => {
    expect(expandSynonyms('quokka husbandry')).toEqual([]);
    // "heart failure" has the abbreviation "HF" (2 chars) — it must be filtered out
    // to avoid highlighting spurious "hf" words, but "cardiac failure" is kept.
    const hf = expandSynonyms('heart failure');
    expect(hf).toContain('cardiac failure');
    expect(hf).not.toContain('HF');
  });

  it('is case/space-insensitive on the lookup', () => {
    expect(expandSynonyms('  Type 2  Diabetes ')).toContain('T2DM');
  });
});

describe('extractConceptKeywords', () => {
  it('produces concepts + synonyms for the flagship example', () => {
    const kw = extractConceptKeywords('Include adult patients with type 2 diabetes undergoing bariatric surgery');
    for (const t of ['adult', 'adults', 'type 2 diabetes', 'T2DM', 'bariatric surgery', 'metabolic surgery', 'sleeve gastrectomy', 'gastric bypass']) {
      expect(kw).toContain(t);
    }
  });

  it('caps the output and never over-generates', () => {
    const huge = Array.from({ length: 80 }, (_, i) => `syndrome alpha${i}`).join('\n');
    expect(extractConceptKeywords(huge).length).toBeLessThanOrEqual(40);
  });

  it('clusters each concept immediately before its synonyms', () => {
    const kw = extractConceptKeywords('type 2 diabetes');
    expect(kw[0]).toBe('type 2 diabetes');
    expect(kw.slice(1)).toContain('T2DM');
  });

  it('returns [] for empty / non-string input', () => {
    expect(extractConceptKeywords('')).toEqual([]);
    expect(extractConceptKeywords(null)).toEqual([]);
    expect(extractConceptKeywords(undefined)).toEqual([]);
  });
});
