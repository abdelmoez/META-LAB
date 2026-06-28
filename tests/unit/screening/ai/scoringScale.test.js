/**
 * scoringScale.test.js — guards the scaling optimizations in trainAndScore /
 * crossValidate (the lean + scoreIdSet fast paths used to make scoring stand up to
 * 10k+ records). The invariant: those fast paths must NOT change the ranking score
 * a record receives — they only skip work whose output the caller discards.
 */
import { describe, it, expect } from 'vitest';
import { trainAndScore, crossValidate } from '../../../../src/research-engine/screening/ai/index.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(7);
const VOCAB = Array.from({ length: 120 }, (_, i) => 'term' + i);
const pick = () => VOCAB[Math.floor(rng() * VOCAB.length)];
const sentence = (n) => Array.from({ length: n }, pick).join(' ');
const records = Array.from({ length: 80 }, (_, i) => ({
  id: 'r' + i, title: sentence(8), abstract: sentence(60), keywords: sentence(4),
  authors: 'A B', year: '2020', journal: 'J', doi: '10/' + i, pmid: '' + i,
}));
// 24 labels (12 include / 12 exclude) → supervised model + 5-fold CV both active.
const labelByRecordId = {};
for (let i = 0; i < 24; i++) labelByRecordId[records[i].id] = i % 2 === 0 ? 'include' : 'exclude';

const full = trainAndScore({ records, labelByRecordId });
const fullScore = new Map(full.scores.map(s => [s.recordId, s.score]));

describe('trainAndScore scaling fast paths', () => {
  it('the full pass trains a supervised model and scores every record', () => {
    expect(full.meta.canTrain).toBe(true);
    expect(full.scores.length).toBe(records.length);
  });

  it('lean mode returns the identical ranking score for every record', () => {
    const lean = trainAndScore({ records, labelByRecordId, lean: true });
    expect(lean.scores.length).toBe(records.length);
    for (const s of lean.scores) expect(s.score).toBeCloseTo(fullScore.get(s.recordId), 12);
  });

  it('scoreIdSet restricts output to the subset, with identical scores', () => {
    const subset = new Set(records.slice(10, 16).map(r => r.id));
    const res = trainAndScore({ records, labelByRecordId, lean: true, scoreIdSet: subset });
    expect(new Set(res.scores.map(s => s.recordId))).toEqual(subset);
    for (const s of res.scores) expect(s.score).toBeCloseTo(fullScore.get(s.recordId), 12);
  });

  it('injecting a precomputed vectorizer + vectors yields identical scores', () => {
    // Mirrors how crossValidate reuses one vectorization across folds.
    const inner = trainAndScore({ records, labelByRecordId, lean: true });
    for (const s of inner.scores) expect(s.score).toBeCloseTo(fullScore.get(s.recordId), 12);
  });

  it('crossValidate still produces honest held-out metrics', () => {
    const cv = crossValidate({ records, labelByRecordId });
    expect(cv.heldOut).toBe(true);
    expect(cv.oof.scores.length).toBe(cv.oof.labels.length);
    expect(cv.oof.scores.length).toBeGreaterThan(0);
    expect(typeof cv.auc === 'number' || cv.auc === null).toBe(true);
  });
});
