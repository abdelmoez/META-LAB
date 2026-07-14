/**
 * searchTermLiveness.test.js — 85.md A1. THE single term-liveness rule
 * (non-blank text AND not disabled) and its adoption in EVERY strategy consumer.
 * One test per consumer proves a disabled term is excluded there, so the manual
 * preview, the automated run, the version hash, the Methods text and the quality
 * checks can never diverge on what "live" means.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isLiveTerm, liveTermsOf, stripDisabledTerms,
} from '../../src/research-engine/searchBuilder/termLiveness.js';
import { normalizeStrategy } from '../../src/research-engine/searchBuilder/compilers/normalize.js';
import { compileStrategy } from '../../src/research-engine/searchBuilder/compilers/index.js';
import {
  searchQualityCheck, detectCrossConceptDuplicates,
} from '../../src/research-engine/searchBuilder/crossConcept.js';
import { conceptStatus } from '../../src/research-engine/searchBuilder/searchState.js';
import { buildSearchMethodsText } from '../../src/research-engine/searchBuilder/methodsText.js';
import { normalizeCanonical, renderPlain } from '../../server/pecanSearch/query/ast.js';
import {
  canonicalStrategyProjection, strategyContentHash, renderStrategyText,
} from '../../server/searchEngine/searchVersionService.js';
import { loadCanonicalQuery } from '../../src/features/pecanSearch/pecanSearchApi.js';

const term = (text, extra = {}) => ({ id: `t-${text}`, text, type: 'freetext', field: 'tiab', ...extra });
const concept = (id, label, terms, extra = {}) => ({ id, label, op: 'AND', source: 'user_added', terms, ...extra });

describe('isLiveTerm / liveTermsOf (the single rule)', () => {
  it('live = non-blank text AND not disabled', () => {
    expect(isLiveTerm(term('stroke'))).toBe(true);
    expect(isLiveTerm(term('stroke', { disabled: true }))).toBe(false);
    expect(isLiveTerm(term(''))).toBe(false);
    expect(isLiveTerm(term('   '))).toBe(false);
    expect(isLiveTerm(null)).toBe(false);
    expect(isLiveTerm(undefined)).toBe(false);
  });
  it('only disabled === true disables (the hygiene contract never writes anything else)', () => {
    expect(isLiveTerm(term('stroke', { disabled: false }))).toBe(true);
    expect(isLiveTerm(term('stroke', { disabled: undefined }))).toBe(true);
  });
  it('liveTermsOf filters a concept safely', () => {
    const c = concept('c1', 'C', [term('a'), term('b', { disabled: true }), term(''), term('d')]);
    expect(liveTermsOf(c).map((t) => t.text)).toEqual(['a', 'd']);
    expect(liveTermsOf(null)).toEqual([]);
    expect(liveTermsOf({})).toEqual([]);
  });
});

describe('stripDisabledTerms', () => {
  it('removes disabled terms but KEEPS the emptied concept (op chaining)', () => {
    const cs = [
      concept('c1', 'A', [term('x', { disabled: true })], { op: 'OR' }),
      concept('c2', 'B', [term('y')]),
    ];
    const out = stripDisabledTerms(cs);
    expect(out).toHaveLength(2); // emptied concept kept — its op joins to the next
    expect(out[0].terms).toEqual([]);
    expect(out[0].op).toBe('OR');
    expect(out[1].terms.map((t) => t.text)).toEqual(['y']);
  });
  it('does NOT touch blank-text terms (downstream liveness handles those)', () => {
    const cs = [concept('c1', 'A', [term(''), term('y')])];
    expect(stripDisabledTerms(cs)[0].terms).toHaveLength(2);
  });
  it('returns the SAME array when nothing is disabled (referential no-op)', () => {
    const cs = [concept('c1', 'A', [term('x')])];
    expect(stripDisabledTerms(cs)).toBe(cs);
    expect(stripDisabledTerms([])).toEqual([]);
    expect(stripDisabledTerms(null)).toEqual([]);
  });
});

/* ── Adoption (a): compilers/normalize.js → all 16 DB compilers + count + previews ── */
describe('adoption: compilers (normalizeStrategy / compileStrategy)', () => {
  const strategy = {
    concepts: [
      concept('c1', 'Condition', [term('heart failure'), term('cardiac failure', { disabled: true })]),
      concept('c2', 'Drug', [term('sglt2', { disabled: true })]),
    ],
    filters: {}, overrides: {},
  };
  it('normalizeStrategy drops disabled terms and marks the all-disabled concept empty', () => {
    const ir = normalizeStrategy(strategy);
    expect(ir.concepts[0].terms.map((t) => t.text)).toEqual(['heart failure']);
    expect(ir.concepts[1].terms).toEqual([]);
    expect(ir.emptyConcepts).toContain('Drug');
  });
  it('a compiled query never contains a disabled term', () => {
    const r = compileStrategy(strategy, 'pubmed');
    expect(r.query).toContain('heart failure');
    expect(r.query).not.toContain('cardiac failure');
    expect(r.query).not.toContain('sglt2');
  });
});

/* ── Adoption (b): crossConcept.js quality checks + duplicate detection ── */
describe('adoption: crossConcept (quality checks + dup detection)', () => {
  it('a disabled copy does not count as a cross-concept duplicate', () => {
    const cs = [
      concept('c1', 'Population', [term('endoscopic ultrasound', { disabled: true })], { picoField: 'P' }),
      concept('c2', 'Intervention / Exposure', [term('EUS')], { picoField: 'I' }),
    ];
    expect(detectCrossConceptDuplicates(cs)).toEqual([]);
    expect(searchQualityCheck(cs).map((w) => w.id)).not.toContain('multi:fam:eus');
  });
  it('a concept whose only terms are disabled counts as EMPTY for the P/I check', () => {
    const cs = [concept('p', 'Population', [term('adults', { disabled: true })], { picoField: 'P' })];
    expect(searchQualityCheck(cs).map((w) => w.id)).toContain('empty:P');
  });
});

/* ── Adoption (c): searchState.conceptStatus ── */
describe('adoption: conceptStatus', () => {
  it('a concept whose every term is disabled reads "empty" (that is what compiles)', () => {
    expect(conceptStatus(concept('c', 'C', [term('x', { disabled: true })]))).toBe('empty');
  });
  it('a disabled controlled term does not make a concept "ready"', () => {
    const c = concept('c', 'C', [
      { id: 't1', text: 'Obesity', type: 'controlled', disabled: true },
      term('obese'), term('overweight'),
    ]);
    expect(conceptStatus(c)).toBe('ready'); // ready via 2 live freetext terms, NOT via the disabled heading
    const single = concept('c', 'C', [
      { id: 't1', text: 'Obesity', type: 'controlled', disabled: true },
      term('obese'),
    ]);
    expect(conceptStatus(single)).toBe('needs-review'); // one live term
  });
});

/* ── Adoption (d): methodsText.js ── */
describe('adoption: buildSearchMethodsText', () => {
  it('documents only enabled terms (a fully-disabled concept is not counted)', () => {
    const strategy = {
      concepts: [
        concept('c1', 'Condition', [term('heart failure')]),
        concept('c2', 'Ghost', [term('sglt2', { disabled: true })]),
        concept('c3', 'Comparator', [term('placebo')]),
      ],
      databases: ['pubmed'], filters: {},
    };
    const text = buildSearchMethodsText({ strategy });
    expect(text).toContain('combined 2 concepts (Condition and Comparator)');
    expect(text).not.toContain('Ghost');
  });
});

/* ── Adoption (e): server/pecanSearch/query/ast.js (automated runs / previews) ── */
describe('adoption: pecan canonical AST (server)', () => {
  it('normalizeCanonical skips disabled terms (inline mirror of isLiveTerm)', () => {
    const c = normalizeCanonical({
      concepts: [{ id: 'a', label: 'A', terms: [{ text: 'stroke' }, { text: 'TIA', disabled: true }] }],
    });
    expect(c.concepts[0].terms.map((t) => t.text)).toEqual(['stroke']);
  });
  it('a concept with only disabled terms is dropped, and renderPlain never shows one', () => {
    const c = normalizeCanonical({
      concepts: [
        { id: 'a', label: 'A', terms: [{ text: 'stroke' }] },
        { id: 'b', label: 'B', terms: [{ text: 'TIA', disabled: true }] },
      ],
    });
    expect(c.concepts).toHaveLength(1);
    expect(renderPlain(c)).toBe('stroke');
  });
});

/* ── Adoption (f): version identity (canonicalStrategyProjection / contentHash) ── */
describe('adoption: version projection + strategyContentHash (server)', () => {
  const base = {
    concepts: [concept('c1', 'Condition', [term('heart failure'), term('cardiac failure')])],
    databases: ['pubmed'], filters: {},
  };
  const withDisabled = {
    ...base,
    concepts: [concept('c1', 'Condition', [term('heart failure'), term('cardiac failure', { disabled: true })])],
  };
  const withoutTerm = {
    ...base,
    concepts: [concept('c1', 'Condition', [term('heart failure')])],
  };

  it('disabled ≡ absent: disabling a term hashes like removing it, and differs from enabled', () => {
    expect(strategyContentHash(withDisabled)).toBe(strategyContentHash(withoutTerm));
    expect(strategyContentHash(withDisabled)).not.toBe(strategyContentHash(base));
  });
  it('old saves (no disabled key anywhere) hash byte-identically — disabled:false is not written and would not change the hash', () => {
    const withFalse = {
      ...base,
      concepts: [concept('c1', 'Condition', [term('heart failure'), term('cardiac failure', { disabled: false })])],
    };
    expect(strategyContentHash(withFalse)).toBe(strategyContentHash(base));
    const p = canonicalStrategyProjection(base);
    expect(p.concepts[0].terms.map((t) => t.text)).toEqual(['heart failure', 'cardiac failure']);
  });
  it('renderStrategyText (version canonicalText) excludes disabled terms', () => {
    expect(renderStrategyText(withDisabled)).not.toMatch(/cardiac failure/);
    expect(renderStrategyText(withDisabled)).toMatch(/heart failure/);
  });
});

/* ── Adoption (g): pecanSearchApi.loadCanonicalQuery (client belt-and-braces) ── */
describe('adoption: loadCanonicalQuery filters disabled terms client-side', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('strips disabled terms from the concepts it returns', async () => {
    const saved = {
      concepts: [
        concept('c1', 'A', [term('stroke'), term('TIA', { disabled: true })]),
        concept('c2', 'B', [term('aspirin', { disabled: true })]),
      ],
      overrides: {}, revision: 3, updatedAt: 'now',
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => JSON.stringify(saved) })));
    const q = await loadCanonicalQuery('p1');
    expect(q.concepts[0].terms.map((t) => t.text)).toEqual(['stroke']);
    expect(q.concepts).toHaveLength(2); // emptied concept kept for op chaining
    expect(q.concepts[1].terms).toEqual([]);
    expect(q.revision).toBe(3);
  });
});
