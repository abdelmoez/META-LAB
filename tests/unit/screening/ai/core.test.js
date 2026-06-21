/**
 * core.test.js — TF-IDF vectorizer + logistic-regression sanity & determinism.
 */
import { describe, it, expect } from 'vitest';
import { tokenize, ngrams, recordFeatures } from '../../../../src/research-engine/screening/ai/text.js';
import { buildVectorizer, transform, cosine, dot } from '../../../../src/research-engine/screening/ai/vectorizer.js';
import { trainLogReg, predictProba, sigmoid, topWeightedFeatures } from '../../../../src/research-engine/screening/ai/logreg.js';

describe('text.tokenize / ngrams', () => {
  it('drops stopwords + short tokens, keeps numbers', () => {
    expect(tokenize('The type 2 diabetes of a patient')).toEqual(['type', 'diabetes', 'patient']);
  });
  it('builds unigrams + bigrams joined by _', () => {
    expect(ngrams(['heart', 'failure'], [1, 2])).toEqual(['heart', 'failure', 'heart_failure']);
  });
  it('weights title tokens more than abstract via repetition', () => {
    const feats = recordFeatures({ title: 'cancer', abstract: 'cancer' }, { ngramRange: [1, 1], fieldWeights: { title: 3, abstract: 1 } });
    expect(feats.filter(f => f === 'cancer').length).toBe(4); // 3 (title) + 1 (abstract)
  });
});

describe('vectorizer', () => {
  const corpus = [
    recordFeatures({ title: 'heart failure trial', abstract: 'randomized controlled' }, {}),
    recordFeatures({ title: 'heart failure cohort', abstract: 'observational study' }, {}),
    recordFeatures({ title: 'cancer screening', abstract: 'tumor markers' }, {}),
  ];
  it('builds a deterministic vocabulary (alphabetical indices)', () => {
    const a = buildVectorizer(corpus, { minDf: 1 });
    const b = buildVectorizer(corpus, { minDf: 1 });
    expect(a.vocab).toEqual(b.vocab);
    // terms array is sorted ascending
    const sorted = [...a.terms].sort();
    expect(a.terms).toEqual(sorted);
  });
  it('respects minDf', () => {
    const v = buildVectorizer(corpus, { minDf: 2 });
    // "heart" appears in 2 docs → kept; "cancer" in 1 → dropped
    expect(v.vocab['heart']).toBeDefined();
    expect(v.vocab['cancer']).toBeUndefined();
  });
  it('transform yields an L2-normalized sparse vector', () => {
    const v = buildVectorizer(corpus, { minDf: 1 });
    const x = transform(recordFeatures({ title: 'heart failure trial' }, {}), v);
    expect(dot(x, x)).toBeCloseTo(1, 6);
  });
  it('cosine: same record == 1, unrelated < related', () => {
    const v = buildVectorizer(corpus, { minDf: 1 });
    const hf = transform(recordFeatures({ title: 'heart failure trial' }, {}), v);
    const hf2 = transform(recordFeatures({ title: 'heart failure cohort' }, {}), v);
    const cancer = transform(recordFeatures({ title: 'cancer screening' }, {}), v);
    expect(cosine(hf, hf)).toBeCloseTo(1, 6);
    expect(cosine(hf, hf2)).toBeGreaterThan(cosine(hf, cancer));
  });
});

describe('logreg sigmoid', () => {
  it('is stable for large magnitudes', () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 9);
    expect(sigmoid(1000)).toBeCloseTo(1, 9);
    expect(sigmoid(-1000)).toBeCloseTo(0, 9);
    expect(Number.isFinite(sigmoid(1000))).toBe(true);
  });
});

describe('logreg learning + determinism', () => {
  // Two clearly separable classes.
  const pos = [
    { title: 'randomized controlled trial of statins in heart failure' },
    { title: 'double blind randomized trial heart failure mortality' },
    { title: 'randomized trial of beta blockers heart failure outcomes' },
  ];
  const neg = [
    { title: 'editorial commentary on hospital funding policy' },
    { title: 'narrative review of medical education curriculum' },
    { title: 'letter to the editor about journal formatting' },
  ];
  const corpus = [...pos, ...neg].map(r => recordFeatures(r, {}));
  const vec = buildVectorizer(corpus, { minDf: 1 });
  const samples = [
    ...pos.map(r => ({ x: transform(recordFeatures(r, {}), vec), y: 1 })),
    ...neg.map(r => ({ x: transform(recordFeatures(r, {}), vec), y: 0 })),
  ];

  it('separates the two classes', () => {
    const model = trainLogReg(samples, vec.terms.length, { epochs: 300 });
    const pTrial = predictProba(model, transform(recordFeatures({ title: 'randomized controlled trial heart failure' }, {}), vec));
    const pEditorial = predictProba(model, transform(recordFeatures({ title: 'editorial commentary policy' }, {}), vec));
    expect(pTrial).toBeGreaterThan(0.5);
    expect(pEditorial).toBeLessThan(0.5);
    expect(pTrial).toBeGreaterThan(pEditorial);
  });

  it('is deterministic (identical models across runs)', () => {
    const m1 = trainLogReg(samples, vec.terms.length, { epochs: 100 });
    const m2 = trainLogReg(samples, vec.terms.length, { epochs: 100 });
    expect(Array.from(m1.weights)).toEqual(Array.from(m2.weights));
    expect(m1.bias).toBe(m2.bias);
  });

  it('class weighting is balanced under imbalance', () => {
    const imbalanced = [samples[0], ...neg.map(r => ({ x: transform(recordFeatures(r, {}), vec), y: 0 }))];
    const model = trainLogReg(imbalanced, vec.terms.length, { classWeight: 'balanced', epochs: 200 });
    expect(model.classWeights.pos).toBeGreaterThan(model.classWeights.neg);
  });

  it('surfaces interpretable top features', () => {
    const model = trainLogReg(samples, vec.terms.length, { epochs: 300 });
    const { positive } = topWeightedFeatures(model, vec.terms, 10);
    const terms = positive.map(p => p.term);
    expect(terms.some(t => t.includes('randomized') || t.includes('trial') || t.includes('heart'))).toBe(true);
  });
});
