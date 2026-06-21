/**
 * engine.test.js — orchestrator (trainAndScore) + cold-start + validation +
 * ranking + embeddings integration & determinism.
 */
import { describe, it, expect } from 'vitest';
import { trainAndScore, summarizeLabels } from '../../../../src/research-engine/screening/ai/activeLearning.js';
import { coldStartScore, detectStudyDesign } from '../../../../src/research-engine/screening/ai/coldStart.js';
import { computeValidation, rocAuc, wssAtRecall, recallAtK, stageMetrics } from '../../../../src/research-engine/screening/ai/validation.js';
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
  it('computeValidation bundles metrics + small-sample warning', () => {
    const v = computeValidation(perfectScores, perfectLabels);
    expect(v.auc).toBeCloseTo(1, 6);
    expect(v.sensitivity).toBeCloseTo(1, 6);
    expect(v.specificity).toBeCloseTo(1, 6);
    expect(v.sampleWarning.warn).toBe(true); // only 6 decisions
    expect(v.stages.length).toBe(6);
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
  it('hashing provider embeds records', async () => {
    const p = createEmbeddingProvider({ embedding: 'hashing', hashingDims: 128 });
    const out = await p.embedRecords([{ title: 'heart failure' }, { title: 'cancer' }]);
    expect(out.length).toBe(2);
    expect(out[0].length).toBe(128);
  });
});
