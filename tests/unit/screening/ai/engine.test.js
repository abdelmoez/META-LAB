/**
 * engine.test.js — orchestrator (trainAndScore) + cold-start + validation +
 * ranking + embeddings integration & determinism.
 */
import { describe, it, expect } from 'vitest';
import { trainAndScore, crossValidate, summarizeLabels } from '../../../../src/research-engine/screening/ai/activeLearning.js';
import { coldStartScore, detectStudyDesign } from '../../../../src/research-engine/screening/ai/coldStart.js';
import { computeValidation, rocAuc, wssAtRecall, recallAtK, stageMetrics, bootstrapCI } from '../../../../src/research-engine/screening/ai/validation.js';
import { rankItems, uncertainty, predictionLabel } from '../../../../src/research-engine/screening/ai/ranking.js';
import { hashingEmbed, cosineDense, createEmbeddingProvider } from '../../../../src/research-engine/screening/ai/embeddings.js';
import { resolveConfig } from '../../../../src/research-engine/screening/ai/config.js';

// ── Synthetic project: heart-failure RCTs (include) vs unrelated (exclude) ──
function makeRecords() {
  const inc = Array.from({ length: 8 }, (_, i) => ({
    id: `inc${i}`,
    title: `Randomized controlled trial of therapy ${i} in chronic heart failure`,
    abstract: 'A double-blind randomized placebo-controlled trial assessing mortality in patients with reduced ejection fraction heart failure.',
    year: '2020', keywords: 'heart failure; randomized controlled trial', authors: 'Smith J; Doe A',
  }));
  const exc = Array.from({ length: 12 }, (_, i) => ({
    id: `exc${i}`,
    title: `Narrative review ${i} of hospital administration and billing policy`,
    abstract: 'An editorial commentary discussing healthcare funding, administration, and journal formatting guidelines unrelated to clinical outcomes.',
    year: '2019', keywords: 'policy; administration', authors: 'Brown K',
  }));
  return [...inc, ...exc];
}

const picoSnapshot = {
  P: 'adults with chronic heart failure',
  I: 'beta blockers',
  O: 'mortality',
  incl: 'Randomized controlled trials in heart failure patients',
  excl: 'Editorials, reviews, and policy commentary',
};

describe('coldStart', () => {
  it('detects study design', () => {
    expect(detectStudyDesign({ title: 'A randomized controlled trial' })).toBe('rct');
    expect(detectStudyDesign({ abstract: 'systematic review and meta-analysis' })).toBe('systematic_review');
  });
  it('scores an on-criteria RCT above an off-criteria editorial', () => {
    const recs = makeRecords();
    const good = coldStartScore(recs[0], { picoSnapshot });
    const bad = coldStartScore(recs[10], { picoSnapshot });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.signals.inclusion.matched.length).toBeGreaterThan(0);
  });
  it('flags low confidence when nothing is configured', () => {
    const cs = coldStartScore({ title: 'x ray imaging' }, {});
    expect(cs.lowConfidence).toBe(true);
    expect(cs.score).toBeCloseTo(0.5, 1);
  });
});

describe('trainAndScore orchestration', () => {
  const records = makeRecords();
  const labels = {};
  // Label half of each class to drive supervised training.
  records.slice(0, 4).forEach(r => { labels[r.id] = 'include'; });
  records.slice(8, 14).forEach(r => { labels[r.id] = 'exclude'; });

  it('trains a supervised model when enough labels exist and separates classes', () => {
    const res = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    expect(res.meta.canTrain).toBe(true);
    expect(res.meta.mode).toBe('supervised');
    const byId = Object.fromEntries(res.scores.map(s => [s.recordId, s]));
    // A held-out include should outscore a held-out exclude.
    expect(byId['inc7'].score).toBeGreaterThan(byId['exc11'].score);
    expect(byId['inc7'].explanation.reasonsInclude.length).toBeGreaterThan(0);
  });

  it('falls back to cold-start when labels are too few', () => {
    const res = trainAndScore({ records, labelByRecordId: { inc0: 'include' }, picoSnapshot });
    expect(res.meta.canTrain).toBe(false);
    expect(res.meta.mode).toBe('cold_start');
    expect(res.scores.every(s => s.proba === null)).toBe(true);
  });

  it('is fully deterministic', () => {
    const a = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    const b = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    expect(a.scores.map(s => s.score)).toEqual(b.scores.map(s => s.score));
  });

  it('produces similar-included neighbours and honest uncertainty notes', () => {
    const res = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    const inc = res.scores.find(s => s.recordId === 'inc7');
    expect(inc.similar.length).toBeGreaterThan(0);
    expect(inc.similar[0].recordId.startsWith('inc')).toBe(true);
  });

  // 65.md SCR-6 — symmetric excluded-side neighbours + score provenance.
  it('produces similar-EXCLUDED neighbours symmetric to the included side', () => {
    const res = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    const exc = res.scores.find(s => s.recordId === 'exc11'); // held-out exclude-like record
    expect(exc.similarExcluded.length).toBeGreaterThan(0);
    expect(exc.similarExcluded[0].recordId.startsWith('exc')).toBe(true);
    // The explanation carries both lists + the provenance marker for the UI.
    expect(exc.explanation.similarExcluded.length).toBeGreaterThan(0);
    expect(exc.explanation.scoreProvenance).toBe('live_in_sample');
    const inc = res.scores.find(s => s.recordId === 'inc7');
    expect(Array.isArray(inc.explanation.similar)).toBe(true);
    expect(Array.isArray(inc.explanation.similarExcluded)).toBe(true);
  });

  it('neighbour lists never include the record itself', () => {
    const res = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    for (const s of res.scores) {
      expect(s.similar.every(n => n.recordId !== s.recordId)).toBe(true);
      expect(s.similarExcluded.every(n => n.recordId !== s.recordId)).toBe(true);
    }
  });

  it('flags missing-abstract records as low confidence', () => {
    const recs = [...records, { id: 'noabs', title: 'HF', abstract: '' }];
    const res = trainAndScore({ records: recs, labelByRecordId: labels, picoSnapshot });
    const noabs = res.scores.find(s => s.recordId === 'noabs');
    expect(noabs.missingAbstract).toBe(true);
  });

  it('summarizeLabels counts classes + balance', () => {
    const s = summarizeLabels(labels, resolveConfig());
    expect(s.positives).toBe(4);
    expect(s.negatives).toBe(6);
    expect(s.classBalance).toBeCloseTo(4 / 10, 6);
  });
});

describe('validation metrics', () => {
  // Perfect ranking: all positives score above all negatives.
  const perfectScores = [0.9, 0.85, 0.8, 0.2, 0.15, 0.1];
  const perfectLabels = [1, 1, 1, 0, 0, 0];

  it('AUC = 1 for a perfect ranking, 0.5 for random-ish', () => {
    expect(rocAuc(perfectScores, perfectLabels)).toBeCloseTo(1, 6);
    expect(rocAuc([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBeCloseTo(0.5, 6);
  });
  it('AUC handles tied scores via average ranks', () => {
    expect(rocAuc([0.6, 0.6, 0.4, 0.4], [1, 0, 1, 0])).toBeCloseTo(0.5, 6);
  });
  it('recall@k', () => {
    expect(recallAtK(perfectScores, perfectLabels, 3)).toBeCloseTo(1, 6);
    expect(recallAtK(perfectScores, perfectLabels, 1)).toBeCloseTo(1 / 3, 6);
  });
  it('WSS@95 is high for a perfect ranking, ~0 for random order', () => {
    const good = wssAtRecall(perfectScores, perfectLabels, 0.95);
    expect(good.wss).toBeGreaterThan(0.3);
    // Reverse ranking (worst case) → negative work saved.
    const bad = wssAtRecall([0.1, 0.15, 0.2, 0.8, 0.85, 0.9], perfectLabels, 0.95);
    expect(bad.wss).toBeLessThan(good.wss);
  });
  it('bootstrapCI brackets the point estimate, deterministically', () => {
    const s = [0.95, 0.9, 0.85, 0.8, 0.3, 0.25, 0.2, 0.15];
    const l = [1, 1, 1, 1, 0, 0, 0, 0];
    const a = bootstrapCI(s, l, (ss, ll) => rocAuc(ss, ll), { iters: 200 });
    const b = bootstrapCI(s, l, (ss, ll) => rocAuc(ss, ll), { iters: 200 });
    expect(a.point).toBeCloseTo(1, 6);
    expect(a.lo).toBeLessThanOrEqual(a.point);
    expect(a.hi).toBeGreaterThanOrEqual(a.point - 1e-9);
    expect(a.lo).toBe(b.lo);            // deterministic
    expect(a.hi).toBe(b.hi);
  });

  it('computeValidation attaches 95% bootstrap CIs', () => {
    const v = computeValidation([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]);
    expect(v.ci).toBeTruthy();
    expect(v.ci.auc.point).toBeCloseTo(1, 6);
    expect(v.ci.auc.lo).toBeLessThanOrEqual(v.ci.auc.hi);
    // opt-out path
    expect(computeValidation([0.9, 0.1], [1, 0], { ci: false }).ci).toBeNull();
  });

  it('computeValidation bundles metrics + small-sample warning', () => {
    const v = computeValidation(perfectScores, perfectLabels);
    expect(v.auc).toBeCloseTo(1, 6);
    expect(v.sensitivity).toBeCloseTo(1, 6);
    expect(v.specificity).toBeCloseTo(1, 6);
    expect(v.sampleWarning.warn).toBe(true); // only 6 decisions
    expect(v.stages.length).toBe(6);
  });
  it('breaks score ties pessimistically (order-independent, conservative)', () => {
    // All scores tied → result must NOT depend on input order, and must take the
    // worst case within the tie (excludes ranked ahead of includes).
    expect(recallAtK([0.5, 0.5, 0.5, 0.5], [1, 1, 0, 0], 1)).toBeCloseTo(0, 6);
    expect(recallAtK([0.5, 0.5, 0.5, 0.5], [0, 0, 1, 1], 1)).toBeCloseTo(0, 6);
    const tied = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const a = wssAtRecall(tied, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0], 0.95);
    const b = wssAtRecall(tied, [0, 0, 0, 0, 0, 0, 0, 0, 1, 1], 0.95);
    expect(a.wss).toBeCloseTo(b.wss, 6);   // no optimistic inflation from input order
  });

  it('stageMetrics recall is monotonic non-decreasing', () => {
    const stages = stageMetrics(perfectScores, perfectLabels);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].recall).toBeGreaterThanOrEqual(stages[i - 1].recall);
    }
  });
});

describe('ranking + uncertainty', () => {
  it('uncertainty peaks at 0.5', () => {
    expect(uncertainty(0.5)).toBeCloseTo(1, 6);
    expect(uncertainty(1)).toBeCloseTo(0, 6);
    expect(uncertainty(0)).toBeCloseTo(0, 6);
  });
  it('predictionLabel is conservative in the middle band', () => {
    expect(predictionLabel(0.9)).toBe('include');
    expect(predictionLabel(0.1)).toBe('exclude');
    expect(predictionLabel(0.5)).toBe('uncertain');
  });
  it('rankItems orders by mode', () => {
    const items = [
      { recordId: 'a', score: 0.2, uncertainty: 0.4, order: 0 },
      { recordId: 'b', score: 0.9, uncertainty: 0.2, order: 1 },
      { recordId: 'c', score: 0.5, uncertainty: 1.0, order: 2 },
    ];
    expect(rankItems(items, 'ai_relevance').map(i => i.recordId)).toEqual(['b', 'c', 'a']);
    expect(rankItems(items, 'ai_uncertain').map(i => i.recordId)).toEqual(['c', 'a', 'b']);
    expect(rankItems(items, 'exclusion_triage').map(i => i.recordId)).toEqual(['a', 'c', 'b']);
    expect(rankItems(items, 'default').map(i => i.recordId)).toEqual(['a', 'b', 'c']);
  });
});

describe('dense embedding semantic path', () => {
  const records = makeRecords();
  // Few labels → cold-start mode, so the SEMANTIC signal (not the classifier) drives
  // the difference. Dense vectors cleanly separate includes [1,0] from excludes [0,1].
  const labels = {};
  records.filter(r => r.title.includes('Randomized')).slice(0, 2).forEach(r => { labels[r.id] = 'include'; });
  records.filter(r => r.title.includes('Narrative')).slice(0, 2).forEach(r => { labels[r.id] = 'exclude'; });
  const denseEmbeddings = {};
  records.forEach(r => { denseEmbeddings[r.id] = r.title.includes('Randomized') ? [1, 0] : [0, 1]; });

  it('uses injected dense vectors and is deterministic', () => {
    const a = trainAndScore({ records, labelByRecordId: labels, denseEmbeddings, picoSnapshot });
    const b = trainAndScore({ records, labelByRecordId: labels, denseEmbeddings, picoSnapshot });
    expect(a.scores.map(s => s.score)).toEqual(b.scores.map(s => s.score));
    // A held-out include-like record's semantic subscore exceeds an exclude-like one's.
    const byId = Object.fromEntries(a.scores.map(s => [s.recordId, s]));
    const incHeld = a.scores.find(s => s.recordId.startsWith('inc') && !(s.recordId in labels));
    const excHeld = a.scores.find(s => s.recordId.startsWith('exc') && !(s.recordId in labels));
    expect(incHeld.subScores.semantic).toBeGreaterThan(excHeld.subScores.semantic);
  });

  it('falls back cleanly when no dense vectors are given', () => {
    const res = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    expect(res.scores.length).toBe(records.length);
  });

  it('ragged or partial dense coverage → all-or-nothing lexical fallback, never NaN', () => {
    // (a) one wrong-dimension vector → not uniform → dense disabled
    const ragged = { ...denseEmbeddings, [records[0].id]: [1] };
    const r1 = trainAndScore({ records, labelByRecordId: labels, denseEmbeddings: ragged, picoSnapshot });
    expect(r1.scores.every(s => Number.isFinite(s.score))).toBe(true);
    // (b) partial coverage (some records missing a vector) → dense disabled
    const partial = {}; records.slice(0, 3).forEach(r => { partial[r.id] = [1, 0]; });
    const r2 = trainAndScore({ records, labelByRecordId: labels, denseEmbeddings: partial, picoSnapshot });
    // Both equal the pure-lexical result (dense path never engaged on non-uniform coverage).
    const lexical = trainAndScore({ records, labelByRecordId: labels, picoSnapshot });
    expect(r1.scores.map(s => s.score)).toEqual(lexical.scores.map(s => s.score));
    expect(r2.scores.map(s => s.score)).toEqual(lexical.scores.map(s => s.score));
  });
});

describe('crossValidate (held-out k-fold)', () => {
  const records = makeRecords();
  const labels = {};
  records.forEach(r => { labels[r.id] = r.title.includes('Randomized') ? 'include' : 'exclude'; });

  it('returns out-of-sample metrics when enough labels exist', () => {
    const cv = crossValidate({ records, labelByRecordId: labels, picoSnapshot, k: 5 });
    expect(cv.heldOut).toBe(true);
    expect(cv.k).toBe(5);
    expect(cv.auc).toBeGreaterThan(0.7);          // separable synthetic classes
    expect(cv.n).toBe(20);                         // every labeled record held out exactly once
  });

  it('is deterministic', () => {
    const a = crossValidate({ records, labelByRecordId: labels, picoSnapshot, k: 5 });
    const b = crossValidate({ records, labelByRecordId: labels, picoSnapshot, k: 5 });
    expect(a.auc).toBe(b.auc);
    expect(a.wss95).toBe(b.wss95);
  });

  it('reports insufficient when labels are too few', () => {
    const few = { inc0: 'include', exc0: 'exclude' };
    const cv = crossValidate({ records, labelByRecordId: few, picoSnapshot, k: 5 });
    expect(cv.insufficient).toBe(true);
  });
});

describe('embeddings provider', () => {
  it('hashing embed is deterministic + unit-norm + semantically sensible', () => {
    const a = hashingEmbed('heart failure trial', 256);
    const a2 = hashingEmbed('heart failure trial', 256);
    expect(a).toEqual(a2);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    const b = hashingEmbed('heart failure study', 256);
    const c = hashingEmbed('quantum chromodynamics lattice', 256);
    expect(cosineDense(a, b)).toBeGreaterThan(cosineDense(a, c));
  });
  it('lexical provider is unavailable and returns null vectors (graceful fallback)', async () => {
    const p = createEmbeddingProvider({ embedding: 'lexical' });
    expect(p.available).toBe(false);
    expect(await p.embedRecords([{ title: 'x' }])).toBeNull();
  });
  it('hosted provider falls back to lexical when no embed fn injected', async () => {
    const p = createEmbeddingProvider({ embedding: 'hosted' }, {});
    expect(p.available).toBe(false);
  });
  it('cosineDense skips non-finite components and never returns NaN', () => {
    expect(cosineDense([1, 0, NaN], [1, 0, 0])).toBeCloseTo(1, 6); // NaN dim skipped
    expect(cosineDense([NaN, NaN], [1, 1])).toBe(0);               // all non-finite → 0
    expect(Number.isFinite(cosineDense([1, 2], [3, 4]))).toBe(true);
  });

  it('hashing provider embeds records', async () => {
    const p = createEmbeddingProvider({ embedding: 'hashing', hashingDims: 128 });
    const out = await p.embedRecords([{ title: 'heart failure' }, { title: 'cancer' }]);
    expect(out.length).toBe(2);
    expect(out[0].length).toBe(128);
  });
});
