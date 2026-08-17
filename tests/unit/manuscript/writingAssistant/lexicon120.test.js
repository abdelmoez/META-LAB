/**
 * 120.md §6 — the terminology STRATEGY, not just the term list.
 *
 * §6 is explicit that its own examples "are not an adequate dictionary by themselves.
 * Build a scalable terminology strategy." The three layers are tested here:
 *   1. the curated versioned lexicon covers §6's representative terms;
 *   2. suffix MORPHOLOGY carries the long tail (`-inib`, `-mab`, `-itis`) so a drug
 *      approved after this release still passes;
 *   3. the PROJECT lexicon learns from trusted metadata under confidence rules, and
 *      refuses to learn a one-off free-text typo.
 */
import { describe, it, expect } from 'vitest';
import {
  LEXICON_VERSION, MEDICAL_TERMS, isMedicalTerm, acceptsMorphology, nearestTerms,
  canonicalCase, personalDictionaryWords, editDistanceAtMost,
} from '../../../../src/features/manuscript/writingAssistant/engine/medicalLexicon.js';
import {
  buildProjectLexicon, deriveProjectShape, EMPTY_PROJECT_LEXICON,
} from '../../../../src/features/manuscript/writingAssistant/engine/projectLexicon.js';
import { usChecker } from './waFixture.js';

describe('120.md §6 — curated medical lexicon', () => {
  it('is versioned', () => {
    expect(LEXICON_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    expect(MEDICAL_TERMS.length).toBeGreaterThan(500);
  });

  /** Every representative term 120.md §6 lists by name. */
  const REPRESENTATIVE = [
    'PubMed', 'MEDLINE', 'Embase', 'Scopus', 'CENTRAL', 'Cochrane', 'PRISMA',
    'PROSPERO', 'RoB', 'ROBINS-I', 'Newcastle-Ottawa', 'GRADE', 'MeSH',
    'heterogeneity', 'meta-regression', 'upadacitinib', 'calprotectin',
    'hepatocellular', 'ileocolonic',
  ];
  for (const term of REPRESENTATIVE) {
    it(`recognizes ${term}`, () => { expect(isMedicalTerm(term)).toBe(true); });
  }

  it('recognizes multi-word §6 terms through their parts', () => {
    for (const phrase of ['odds ratio', 'hazard ratio', 'confidence interval', 'fecal calprotectin', 'Web of Science']) {
      for (const word of phrase.split(' ')) {
        expect(isMedicalTerm(word), `${word} of "${phrase}"`).toBe(true);
      }
    }
  });

  it('accepts inflections, possessives and hyphenated compounds of known stems', () => {
    expect(isMedicalTerm('cytokines')).toBe(true);
    expect(isMedicalTerm('comorbidities')).toBe(true);
    expect(isMedicalTerm('Newcastle-Ottawa')).toBe(true);
    expect(isMedicalTerm('PRISMA-ScR')).toBe(true);
  });
});

describe('120.md §6 — suffix morphology carries the long tail', () => {
  const ACCEPTED = [
    'upadacitinib', 'tofacitinib', 'baricitinib', 'zanubrutinib', 'fictionalitinib',
    'infliximab', 'vedolizumab', 'zorblimab',
    'appendicitis', 'sacroiliitis', 'pancolitis',
    'hemicolectomy', 'pancreatectomy', 'gastroscopy', 'splenomegaly',
    'atorvastatin', 'candesartan', 'esomeprazole', 'levofloxacin', 'dalteparin',
  ];
  for (const word of ACCEPTED) {
    it(`accepts ${word} without a lexicon release`, () => {
      expect(acceptsMorphology(word)).toBe(true);
    });
  }

  const REJECTED = [
    // 120.md §6's own validation case: this misspelling MUST survive to the report.
    'hepatocelular',
    // A prefix acceptor would have let all of these through — there is none.
    'hepatocelluar', 'ileocolnic', 'randomiz', 'teh', 'recieve', 'seperate',
    // Too short a stem, or plain English.
    'nib', 'mab', 'itis', 'analysis',
  ];
  for (const word of REJECTED) {
    it(`does NOT accept ${word}`, () => { expect(acceptsMorphology(word)).toBe(false); });
  }
});

describe('120.md §6 — domain-aware suggestions', () => {
  it('offers hepatocellular for hepatocelular', () => {
    expect(nearestTerms('hepatocelular')).toContain('hepatocellular');
  });

  it('offers heterogeneity for heterogenity', () => {
    expect(nearestTerms('heterogenity')).toContain('heterogeneity');
  });

  it('bounds the edit distance it will claim', () => {
    expect(editDistanceAtMost('hepatocelular', 'hepatocellular', 1)).toBe(true);
    expect(editDistanceAtMost('cat', 'elephant', 2)).toBe(false);
  });

  it('feeds the checker so nspell can reach a medical term', () => {
    // Without personalDictionaryWords() nspell has never heard of the word and
    // cannot suggest it — this is the mechanism behind the §6 validation case.
    expect(personalDictionaryWords()).toContain('hepatocellular');
    expect(usChecker().suggest('hepatocelular')).toContain('hepatocellular');
  });

  it('knows the canonical casing of database and instrument names', () => {
    expect(canonicalCase('pubmed')).toBe('PubMed');
    expect(canonicalCase('EMBASE')).toBe('Embase');
    expect(canonicalCase('mesh')).toBe('MeSH');
    expect(canonicalCase('notaterm')).toBeNull();
  });
});

describe('120.md §6 — project-aware dictionary confidence rules', () => {
  const TRUSTED_SHAPE = {
    studyTitles: ['Efficacy of zorblimab in Crohn disease: the ZORBTRIAL randomized trial'],
    studyAuthors: ['Vandenbroucke JP', 'Nurmohamed MT'],
    studyJournals: ['Gastroenterologia Clinica'],
  };

  it('accepts a term from ONE trusted structured field', () => {
    const lexicon = buildProjectLexicon(TRUSTED_SHAPE);
    expect(lexicon.has('zorblimab')).toBe(true);
    expect(lexicon.has('Vandenbroucke')).toBe(true);
    expect(lexicon.describe('zorblimab').trusted).toBe(true);
  });

  it('refuses a term that appears once in free text only', () => {
    const lexicon = buildProjectLexicon({ question: 'Does teh drug reduce flares?' });
    expect(lexicon.has('teh')).toBe(false);
  });

  it('accepts a term corroborated by two independent free-text fields', () => {
    const lexicon = buildProjectLexicon({
      question: 'Does flurbizumab reduce flares?',
      keywords: 'flurbizumab, flare',
    });
    expect(lexicon.has('flurbizumab')).toBe(true);
    expect(lexicon.describe('flurbizumab').trusted).toBe(false);
    expect(lexicon.describe('flurbizumab').confidence).toBeLessThan(0.9);
  });

  it('preserves case for trial acronyms and gene-shaped terms', () => {
    const lexicon = buildProjectLexicon(TRUSTED_SHAPE);
    expect(lexicon.has('ZORBTRIAL')).toBe(true);
    expect(lexicon.has('zorbtrial')).toBe(false);
    // An ordinary lower-case term is matched case-insensitively.
    expect(lexicon.has('Zorblimab')).toBe(true);
  });

  it('ignores stopwords and research boilerplate', () => {
    const lexicon = buildProjectLexicon({
      studyTitles: ['A randomized controlled trial of the systematic review process'],
    });
    for (const noise of ['randomized', 'controlled', 'trial', 'systematic', 'review', 'the']) {
      expect(lexicon.has(noise), noise).toBe(false);
    }
  });

  it('changes its signature when the accepted terms change', () => {
    const a = buildProjectLexicon(TRUSTED_SHAPE);
    const b = buildProjectLexicon({ ...TRUSTED_SHAPE, studyTitles: ['Efficacy of quixadrol'] });
    expect(a.signature).not.toBe(b.signature);
  });

  it('derives a shape from a PecanRev project without throwing on partial data', () => {
    const shape = deriveProjectShape({
      name: 'Statins for primary prevention',
      pico: { question: 'Do statins reduce events?', I: 'atorvastatin', prosperoId: 'CRD42024000001' },
      studies: [{ title: 'ZORBTRIAL', authors: 'Smith J', journal: 'Lancet' }],
    }, { searchConcepts: [{ label: 'statins', terms: [{ text: 'hydroxymethylglutaryl' }] }] });
    expect(shape.studyTitles).toEqual(['ZORBTRIAL']);
    expect(shape.controlledVocabulary).toEqual(['hydroxymethylglutaryl']);
    expect(() => deriveProjectShape({})).not.toThrow();
    expect(() => deriveProjectShape()).not.toThrow();
  });

  it('provides an inert empty lexicon so callers never null-check', () => {
    expect(EMPTY_PROJECT_LEXICON.has('anything')).toBe(false);
    expect(EMPTY_PROJECT_LEXICON.terms()).toEqual([]);
  });
});
