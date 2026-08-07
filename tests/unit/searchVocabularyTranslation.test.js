/**
 * searchVocabularyTranslation.test.js — 100.md §§3-4/20.
 *
 * The cross-database vocabulary translation layer: the canonical concept model, the
 * mapping registry (including extensibility), and the end-to-end behaviour every
 * database adapter inherits from it.
 *
 * The core contract under test is 100.md §3: a database-native subject heading is
 * emitted ONLY where there is a real basis for it; everywhere else the concept is
 * searched as properly-formatted free text and NEVER as an invented heading.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  toCanonicalConcept, naturalOrderLabel, freeTextFormsFor,
  translateConcept, planControlledTerm,
  registerVocabularyMapping, lookupVocabularyMapping, listVocabularyMappings,
  CONFIDENCE, FALLBACK_REASON,
} from '../../src/research-engine/searchBuilder/vocabulary/index.js';
import { resetVocabularyMappings } from '../../src/research-engine/searchBuilder/vocabulary/mappings.js';
import { compileStrategy, capabilitiesFor } from '../../src/research-engine/searchBuilder/compilers/index.js';

const controlled = (text, vocab, extra = {}) => ({ text, type: 'controlled', field: 'tiab', vocab, ...extra });
const strat = (terms) => ({ concepts: [{ id: 'c1', label: 'C', op: 'AND', terms }], filters: {} });

/* ── 1. Canonical concept ─────────────────────────────────────────────────── */

describe('naturalOrderLabel — de-inverting catalogue headings (100.md §3)', () => {
  it.each([
    ['Diabetes Mellitus, Type 2', 'Type 2 Diabetes Mellitus'],
    ['Heart Failure, Systolic', 'Systolic Heart Failure'],
    ['Arthritis, Rheumatoid', 'Rheumatoid Arthritis'],
    ['Kidney Failure, Chronic', 'Chronic Kidney Failure'],
    ['Anti-Inflammatory Agents, Non-Steroidal', 'Non-Steroidal Anti-Inflammatory Agents'],
    ['Receptors, Estrogen', 'Estrogen Receptors'],
    ['Breast Neoplasms', 'Breast Neoplasms'],
    ['Myocardial Infarction', 'Myocardial Infarction'],
    ['Hypertension', 'Hypertension'],
    ['Aspirin', 'Aspirin'],
  ])('%s → %s', (input, expected) => {
    expect(naturalOrderLabel(input)).toBe(expected);
  });

  it.each([
    // A comma is not always an inversion. Reversing an ENUMERATION or a MEDLINE
    // check-tag produces a phrase that exists in no paper and returns zero everywhere.
    ['Health Knowledge, Attitudes, Practice'],
    ['Infant, Newborn, Diseases'],
    ['Neoplasms, Glandular and Epithelial, Malignant'],
    ['Aged, 80 and over'],
  ])('leaves %s alone rather than inventing a nonsense phrase', (input) => {
    expect(naturalOrderLabel(input)).toBe(input);
  });

  it('still de-inverts a genuine two-segment modifier', () => {
    expect(naturalOrderLabel('Adolescent, Hospitalized')).toBe('Hospitalized Adolescent');
  });

  it('a heading it declined to de-invert is searched by its LEAD segment, never verbatim', () => {
    const c = toCanonicalConcept(controlled('kap', { mesh: 'Health Knowledge, Attitudes, Practice' }));
    expect(c.naturalLabel).toBe('Health Knowledge, Attitudes, Practice');
    expect(c.freeTextForms).toEqual(['Health Knowledge']);
    expect(compileStrategy(strat([controlled('kap', { mesh: 'Health Knowledge, Attitudes, Practice' })]), 'scopus').query)
      .toBe('TITLE-ABS-KEY("Health Knowledge")');
    expect(compileStrategy(strat([controlled('aged', { mesh: 'Aged, 80 and over' })]), 'embase').query)
      .toBe('Aged:ti,ab');
  });

  it('leaves parenthetical qualifiers alone and survives junk', () => {
    expect(naturalOrderLabel('Cranial Nerves (Anatomy)')).toBe('Cranial Nerves (Anatomy)');
    expect(naturalOrderLabel('')).toBe('');
    expect(naturalOrderLabel(null)).toBe('');
  });
});

describe('toCanonicalConcept', () => {
  it('extracts the concept a MeSH selection stands for', () => {
    const c = toCanonicalConcept(controlled('type 2 diabetes', {
      mesh: 'Diabetes Mellitus, Type 2', meshUI: 'D003924',
      synonyms: ['NIDDM', 'T2DM'], children: ['Prediabetic State'],
    }));
    expect(c.sourceSystem).toBe('mesh');
    expect(c.sourceId).toBe('D003924');
    expect(c.preferredLabel).toBe('Diabetes Mellitus, Type 2');
    expect(c.naturalLabel).toBe('Type 2 Diabetes Mellitus');
    expect(c.entryTerms).toEqual(['NIDDM', 'T2DM']);
    expect(c.narrower).toEqual(['Prediabetic State']);
    expect(c.explode).toBe(true);
    expect(c.freeTextForms).toEqual(['Type 2 Diabetes Mellitus']);
  });

  it('honours noExplode and a hand-typed heading with no vocab record', () => {
    expect(toCanonicalConcept(controlled('X', { mesh: 'X' }, { noExplode: true })).explode).toBe(false);
    const bare = toCanonicalConcept({ text: 'Widget Disease', type: 'controlled' });
    expect(bare.preferredLabel).toBe('Widget Disease');
    expect(bare.freeTextForms).toEqual(['Widget Disease']);
  });

  it('is not coupled to MeSH — a term can declare another source vocabulary', () => {
    const c = toCanonicalConcept(controlled('x', { system: 'emtree', heading: 'heart failure' }));
    expect(c.sourceSystem).toBe('emtree');
    expect(c.preferredLabel).toBe('heart failure');
  });

  it('never expands entry terms into the fallback (query-size + user-intent guard)', () => {
    const forms = freeTextFormsFor({
      preferredLabel: 'Diabetes Mellitus, Type 2',
      naturalLabel: 'Type 2 Diabetes Mellitus',
      rawText: 'type 2 diabetes',
    });
    expect(forms).toEqual(['Type 2 Diabetes Mellitus']);
  });
});

/* ── 2. The mapping registry ──────────────────────────────────────────────── */

describe('vocabulary mapping registry (100.md §4)', () => {
  it('ships NO cross-vocabulary crosswalk — 100.md §20, do not invent mappings', () => {
    expect(listVocabularyMappings()).toEqual([]);
    expect(lookupVocabularyMapping('mesh', 'emtree')).toBeNull();
    expect(lookupVocabularyMapping('mesh', 'cinahl')).toBeNull();
    expect(lookupVocabularyMapping('mesh', 'apa')).toBeNull();
  });

  it('resolves a concept natively when the database indexes its OWN vocabulary', () => {
    const c = toCanonicalConcept(controlled('x', { mesh: 'Heart Failure', meshUI: 'D006333' }));
    const d = translateConcept(c, 'mesh');
    expect(d).toMatchObject({ status: 'native', system: 'mesh', heading: 'Heart Failure', confidence: CONFIDENCE.EXACT, explode: true });
    // The identity rule is not MeSH-specific — an Emtree-sourced term resolves natively
    // against an Emtree-indexed database with no registration at all (100.md §4).
    const em = toCanonicalConcept(controlled('hf', { system: 'emtree', heading: 'heart failure' }));
    expect(translateConcept(em, 'emtree')).toMatchObject({ status: 'native', heading: 'heart failure', confidence: CONFIDENCE.EXACT });
    expect(compileStrategy(strat([controlled('hf', { system: 'emtree', heading: 'heart failure' })]), 'embase').query)
      .toBe("'heart failure'/exp");
  });

  it('falls back to free text with a REASON, never a guessed heading', () => {
    const c = toCanonicalConcept(controlled('x', { mesh: 'Heart Failure' }));
    expect(translateConcept(c, 'emtree')).toMatchObject({
      status: 'freetext', reason: FALLBACK_REASON.NO_EQUIVALENT, confidence: CONFIDENCE.NONE,
    });
    expect(translateConcept(c, 'none')).toMatchObject({ status: 'freetext', reason: FALLBACK_REASON.NO_VOCABULARY });
    expect(translateConcept(toCanonicalConcept({ type: 'controlled' }), 'mesh'))
      .toMatchObject({ status: 'freetext', reason: FALLBACK_REASON.NO_SOURCE_HEADING });
  });
});

/* ── 3. Extensibility — the whole point of the registry ───────────────────── */

describe('extensibility: a new vocabulary is ONE registration, zero renderer edits', () => {
  // The registry is module-global; restore the SHIPPED state (no crosswalks) after each
  // case so these tests cannot leak into the assertions above, whatever the run order.
  afterEach(() => resetVocabularyMappings());

  it('a registered crosswalk changes the COMPILED Embase query with no renderer edit', () => {
    registerVocabularyMapping({
      from: 'mesh', to: 'emtree', confidence: CONFIDENCE.VERIFIED,
      authority: 'fixture crosswalk',
      translate: (c) => (c.sourceId === 'D006333' ? { heading: 'heart failure' } : null),
    });
    const c = toCanonicalConcept(controlled('x', { mesh: 'Heart Failure', meshUI: 'D006333' }));
    expect(translateConcept(c, 'emtree')).toMatchObject({
      status: 'native', heading: 'heart failure', confidence: CONFIDENCE.VERIFIED,
    });
    // …and end to end, which is the property the docs actually promise.
    const s = strat([controlled('x', { mesh: 'Heart Failure', meshUI: 'D006333' })]);
    const r = compileStrategy(s, 'embase');
    expect(r.query).toBe("'heart failure'/exp");
    expect(r.vocab).toMatchObject({ system: 'emtree', mapped: 1, fallback: 0 });
    expect(r.warnings.map((w) => w.code)).not.toContain('VOCAB_NO_EQUIVALENT');
    // A database the crosswalk does not cover is untouched.
    expect(compileStrategy(s, 'cinahl').query).toBe('(TI "Heart Failure" OR AB "Heart Failure")');
  });

  it('a crosswalk that does not cover a concept degrades per-concept, not wholesale', () => {
    registerVocabularyMapping({
      from: 'mesh', to: 'emtree', confidence: CONFIDENCE.VERIFIED, authority: 'fixture crosswalk',
      translate: (c) => (c.sourceId === 'D006333' ? { heading: 'heart failure' } : null),
    });
    const other = toCanonicalConcept(controlled('x', { mesh: 'Widget Disease', meshUI: 'D999999' }));
    expect(translateConcept(other, 'emtree')).toMatchObject({
      status: 'freetext', reason: FALLBACK_REASON.NOT_IN_CROSSWALK,
    });
  });

  it('a throwing crosswalk degrades to free text instead of breaking the compile', () => {
    registerVocabularyMapping({
      from: 'mesh', to: 'emtree', confidence: CONFIDENCE.VERIFIED, authority: 'broken',
      translate: () => { throw new Error('boom'); },
    });
    const c = toCanonicalConcept(controlled('x', { mesh: 'Heart Failure' }));
    expect(translateConcept(c, 'emtree').status).toBe('freetext');
  });
});

/* ── 4. planControlledTerm — the adapter-facing decision ──────────────────── */

describe('planControlledTerm (capability-aware)', () => {
  const term = controlled('type 2 diabetes', { mesh: 'Diabetes Mellitus, Type 2', meshUI: 'D003924' });

  it('reaches a native heading only where the database indexes the vocabulary', () => {
    expect(planControlledTerm(term, capabilitiesFor('pubmed'))).toMatchObject({ status: 'native', heading: 'Diabetes Mellitus, Type 2', explode: true });
    expect(planControlledTerm(term, capabilitiesFor('cochrane')).status).toBe('native');
    for (const db of ['embase', 'cinahl', 'psycinfo', 'scopus', 'wos', 'ieee', 'acm', 'proquest', 'gscholar', 'opengrey', 'ictrp', 'clinicaltrials']) {
      expect(planControlledTerm(term, capabilitiesFor(db)).status).toBe('freetext');
    }
  });

  it('separates "no thesaurus" from "thesaurus we cannot reach"', () => {
    expect(planControlledTerm(term, capabilitiesFor('embase')).reason).toBe(FALLBACK_REASON.NO_EQUIVALENT);
    expect(planControlledTerm(term, capabilitiesFor('cinahl')).reason).toBe(FALLBACK_REASON.NO_EQUIVALENT);
    expect(planControlledTerm(term, capabilitiesFor('scopus')).reason).toBe(FALLBACK_REASON.NO_VOCABULARY);
    expect(planControlledTerm(term, capabilitiesFor('wos')).reason).toBe(FALLBACK_REASON.NO_VOCABULARY);
  });

  it('reports an explosion mismatch in the direction the database actually behaves', () => {
    // Europe PMC matches the heading exactly; PMC always explodes.
    expect(planControlledTerm(term, capabilitiesFor('europepmc'))).toMatchObject({ explosionMismatch: 'lost', explode: false });
    expect(planControlledTerm(term, capabilitiesFor('pmc'))).toMatchObject({ explosionMismatch: null, explode: true });
    const noExp = { ...term, noExplode: true };
    expect(planControlledTerm(noExp, capabilitiesFor('pmc'))).toMatchObject({ explosionMismatch: 'forced', explode: true });
    expect(planControlledTerm(noExp, capabilitiesFor('europepmc'))).toMatchObject({ explosionMismatch: null, explode: false });
  });
});

/* ── 5. End-to-end across real concepts (100.md §20) ──────────────────────── */

describe('real concepts compile to legitimate syntax in every database (100.md §20)', () => {
  const CONCEPTS = [
    { text: 'type 2 diabetes', mesh: 'Diabetes Mellitus, Type 2', ui: 'D003924', natural: 'Type 2 Diabetes Mellitus' },
    { text: 'heart attack', mesh: 'Myocardial Infarction', ui: 'D009203', natural: 'Myocardial Infarction' },
    { text: 'high blood pressure', mesh: 'Hypertension', ui: 'D006973', natural: 'Hypertension' },
    { text: 'heart failure', mesh: 'Heart Failure', ui: 'D006333', natural: 'Heart Failure' },
    { text: 'ckd', mesh: 'Renal Insufficiency, Chronic', ui: 'D051436', natural: 'Chronic Renal Insufficiency' },
    { text: 'breast cancer', mesh: 'Breast Neoplasms', ui: 'D001943', natural: 'Breast Neoplasms' },
    { text: 'aspirin', mesh: 'Aspirin', ui: 'D001241', natural: 'Aspirin' },
  ];
  const MESH_DBS = ['pubmed', 'pmc', 'cochrane', 'europepmc'];
  const OTHER_DBS = ['embase', 'cinahl', 'psycinfo', 'scopus', 'wos', 'proquest', 'ieee', 'acm', 'gscholar', 'opengrey', 'ictrp', 'clinicaltrials'];

  it.each(CONCEPTS)('$mesh — MeSH databases get the real descriptor', (c) => {
    for (const db of MESH_DBS) {
      const r = compileStrategy(strat([controlled(c.text, { mesh: c.mesh, meshUI: c.ui })]), db);
      expect(r.query).toContain(c.mesh);
      expect(r.vocab.mapped).toBe(1);
      expect(r.vocab.fallback).toBe(0);
    }
  });

  it.each(CONCEPTS)('$mesh — every other database gets natural-language free text, no fake heading', (c) => {
    for (const db of OTHER_DBS) {
      const r = compileStrategy(strat([controlled(c.text, { mesh: c.mesh, meshUI: c.ui })]), db);
      expect(r.query).toContain(c.natural);
      expect(r.vocab.fallback).toBe(1);
      expect(r.vocab.mapped).toBe(0);
      // Nothing that looks like a fabricated subject-heading clause survives.
      expect(r.query).not.toMatch(/\/exp|\/de\b|\(MH |DE "|INDEXTERMS\(|MAINSUBJECT/);
      // Balanced parentheses — the string must be runnable, not just plausible.
      const opens = (r.query.match(/\(/g) || []).length;
      const closes = (r.query.match(/\)/g) || []).length;
      expect(opens).toBe(closes);
    }
  });

  it('free text and controlled vocabulary COMPLEMENT each other (100.md §5)', () => {
    const s = strat([
      controlled('type 2 diabetes', { mesh: 'Diabetes Mellitus, Type 2', meshUI: 'D003924' }),
      { text: 'type 2 diabetes', type: 'freetext', field: 'tiab' },
      { text: 'T2DM', type: 'freetext', field: 'tiab' },
    ]);
    const pubmed = compileStrategy(s, 'pubmed');
    // Selecting a subject heading never removes the user's own free-text synonyms.
    expect(pubmed.query).toBe('("Diabetes Mellitus, Type 2"[Mesh] OR "type 2 diabetes"[tiab] OR T2DM[tiab])');
    const embase = compileStrategy(s, 'embase');
    expect(embase.query).toContain("'Type 2 Diabetes Mellitus':ti,ab");
    expect(embase.query).toContain("'type 2 diabetes':ti,ab");
    expect(embase.query).toContain('T2DM:ti,ab');
  });

  it('explains that a free-text fallback cannot explode, using REAL narrower data', () => {
    const r = compileStrategy(strat([controlled('t2d', {
      mesh: 'Diabetes Mellitus, Type 2', meshUI: 'D003924', children: ['Prediabetic State', 'Diabetes Mellitus, Lipoatrophic'],
    })]), 'cinahl');
    expect(r.notes.some((n) => /narrower topics/.test(n) && /Prediabetic State/.test(n))).toBe(true);
  });
});
