/**
 * reviewerSignalsEngine.test.js — reviewer quality/note signals INSIDE the engine
 * (prompt49 item 1): they flow to the score + explanation, they NEVER change the
 * relevance score (eligibility ⟂ quality), they're suppressed under blind review,
 * and absence of notes/ratings is a no-op.
 */
import { describe, it, expect } from 'vitest';
import { trainAndScore } from '../../../../src/research-engine/screening/ai/activeLearning.js';

function makeRecords() {
  const inc = Array.from({ length: 8 }, (_, i) => ({
    id: `inc${i}`,
    title: `Randomized controlled trial of beta blockers ${i} in chronic heart failure`,
    abstract: 'A double-blind randomized placebo-controlled trial measuring mortality.',
    year: '2020', keywords: 'heart failure; randomized controlled trial',
  }));
  const exc = Array.from({ length: 12 }, (_, i) => ({
    id: `exc${i}`,
    title: `Narrative review ${i} of hospital administration policy`,
    abstract: 'An editorial commentary on staffing.',
    year: '2019', keywords: 'policy; administration',
  }));
  return [...inc, ...exc];
}
const PICO = { P: 'adults with chronic heart failure', I: 'beta blockers', O: 'mortality', incl: 'Randomized controlled trials', excl: 'Editorials and reviews' };
const labels = Object.fromEntries([...Array(8)].map((_, i) => [`inc${i}`, 'include']).concat([...Array(12)].map((_, i) => [`exc${i}`, 'exclude'])));

const base = { records: makeRecords(), labelByRecordId: labels, picoSnapshot: PICO };

describe('reviewer signals flow through trainAndScore', () => {
  it('attaches quality + note signals and explanation factors when revealed', () => {
    const decisionsByRecordId = {
      inc0: [
        { reviewerId: 'a', decision: 'include', rating: 5, notes: 'Eligible RCT, meets inclusion criteria' },
        { reviewerId: 'b', decision: 'include', rating: 4, notes: 'well-conducted, high quality' },
      ],
      exc0: [
        { reviewerId: 'a', decision: 'exclude', rating: 2, notes: 'Wrong population, small sample, high risk of bias' },
      ],
    };
    const { scores } = trainAndScore({ ...base, decisionsByRecordId, revealReviewerSignals: true });
    const inc0 = scores.find((s) => s.recordId === 'inc0');
    expect(inc0.signals.reviewer).toBeTruthy();
    expect(inc0.methodologicalQuality).toBeCloseTo(0.875); // mean(1.0, 0.75)
    expect(inc0.reviewerConfidence).toBe(1);
    expect(inc0.explanation.reviewer).toBeTruthy();
    expect(inc0.explanation.reviewer.factors.length).toBeGreaterThan(0);

    const exc0 = scores.find((s) => s.recordId === 'exc0');
    expect(exc0.signals.reviewer.noteFlags.wrongPopulation).toBe(1);
    expect(exc0.explanation.reasonsExclude.some((r) => r.kind === 'reviewer_note')).toBe(true);

    // Persisted/serialised signals must NEVER carry per-reviewer identity
    // (reviewerId/decision/rating) — only aggregated, identity-free fields — so
    // they can't expose individual reviewer decisions via signalsJson.
    expect(inc0.signals.reviewer.byReviewer).toBeUndefined();
    expect(inc0.explanation.reviewer.byReviewer).toBeUndefined();
  });

  it('NON-INTERFERENCE: the relevance score is identical with and without reviewer signals', () => {
    const withSignals = trainAndScore({
      ...base,
      decisionsByRecordId: { inc0: [{ reviewerId: 'a', decision: 'include', rating: 5, notes: 'high quality eligible' }] },
      revealReviewerSignals: true,
    });
    const without = trainAndScore({ ...base });
    const map = (res) => Object.fromEntries(res.scores.map((s) => [s.recordId, s.score]));
    expect(map(withSignals)).toEqual(map(without)); // eligibility unaffected by quality/notes
  });

  it('blind review suppresses reviewer signals (no leakage)', () => {
    const decisionsByRecordId = { inc0: [{ reviewerId: 'a', decision: 'include', rating: 5, notes: 'eligible' }] };
    const { scores } = trainAndScore({ ...base, decisionsByRecordId, revealReviewerSignals: false });
    const inc0 = scores.find((s) => s.recordId === 'inc0');
    expect(inc0.signals.reviewer).toBeNull();
    expect(inc0.methodologicalQuality).toBeNull();
    expect(inc0.explanation.reviewer).toBeNull();
  });

  it('works with no decisions map at all (prioritization == relevance)', () => {
    const { scores } = trainAndScore({ ...base });
    for (const s of scores) {
      expect(s.signals.reviewer).toBeNull();
      expect(s.prioritization).toBeCloseTo(s.score);
    }
  });
});
