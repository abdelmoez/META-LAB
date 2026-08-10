/**
 * screeningProgress.test.js — 110.md §1.
 *
 * The whole-project screening progress model. The defect this pins: with one
 * reviewer through the entire library and a 2-reviewer requirement, completion
 * must read ~50%, never 100% — and it must never read 100% while a conflict is
 * still open.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  computeScreeningProgress, formatSummaryParts, honestPct, ordinal, STAGE_KIND,
} from '../../src/research-engine/screening/screeningProgress.js';

const stageByKey = (m, key) => m.stages.find(s => s.key === key);

describe('ordinal', () => {
  it('formats reviewer pass ordinals', () => {
    expect(['x', ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(21), ordinal(112)])
      .toEqual(['x', '1st', '2nd', '3rd', '4th', '11th', '21st', '112th']);
  });
});

describe('honestPct', () => {
  it('never rounds up to 100 before the work is finished', () => {
    expect(honestPct(1999, 2000)).toBe(99);
    expect(honestPct(2000, 2000)).toBe(100);
  });
  it('never rounds down to 0 once something is done', () => {
    expect(honestPct(1, 100000)).toBe(1);
    expect(honestPct(0, 100)).toBe(0);
  });
  it('treats an empty denominator as 0, not NaN', () => {
    expect(honestPct(0, 0)).toBe(0);
    expect(honestPct(5, 0)).toBe(0);
  });
  it('honours an explicit complete override', () => {
    expect(honestPct(3, 10, { complete: true })).toBe(100);
    expect(honestPct(10, 10, { complete: false })).toBe(99);
  });
});

describe('computeScreeningProgress — the 110.md §1 headline defect', () => {
  it('one reviewer through 1000 records with 2 required reads 50%, not 100%', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 1000,
      reviewerHistogram: { 1: 1000 },
    });
    expect(m.completion).toBe(50);
    expect(m.decisionCompletion).toBe(50);
    expect(m.requiredDecisions).toBe(2000);
    expect(m.completedDecisions).toBe(1000);
    expect(m.decisionsRemaining).toBe(1000);
    expect(m.recordsAwaitingReviewer).toBe(1000);
    expect(m.recordsFullyReviewed).toBe(0);
    expect(m.complete).toBe(false);
  });

  it('both reviewers finished with no conflicts reads 100% and complete', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 1000,
      reviewerHistogram: { 2: 1000 },
    });
    expect(m.completion).toBe(100);
    expect(m.complete).toBe(true);
    expect(m.recordsFullyReviewed).toBe(1000);
    expect(m.recordsAwaitingReviewer).toBe(0);
    expect(m.recordsNotStarted).toBe(0);
    expect(m.currentStageLabel).toBe('Screening complete');
  });

  it('all decisions in but a conflict open is never 100%', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 100,
      reviewerHistogram: { 2: 100 },
      unresolvedConflicts: 1,
    });
    expect(m.complete).toBe(false);
    expect(m.completion).toBe(99);
    expect(m.decisionCompletion).toBe(100);
    expect(m.currentStageLabel).toBe('Conflict resolution');
    expect(m.summary).toBe('1 conflict to resolve.');
  });

  it('resolving the last conflict flips it to 100% complete', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 100,
      reviewerHistogram: { 2: 100 },
      unresolvedConflicts: 0, resolvedConflicts: 12,
    });
    expect(m.complete).toBe(true);
    expect(m.completion).toBe(100);
    // Auto-resolved history must NOT inflate the headline: only OPEN conflicts
    // ever entered the denominator.
    expect(m.totalUnits).toBe(200);
  });
});

describe('computeScreeningProgress — reviewer-count configurations', () => {
  it('a 1-reviewer project completes on a single pass', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 1, poolSize: 50, reviewerHistogram: { 1: 50 },
    });
    expect(m.completion).toBe(100);
    expect(m.complete).toBe(true);
    expect(m.stages.filter(s => s.kind === STAGE_KIND.REVIEWER_PASS)).toHaveLength(1);
    expect(m.summary).toBe('Every record has been screened and no conflicts remain.');
  });

  it('respects N > 2 (never hard-codes 2)', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 4, poolSize: 10,
      reviewerHistogram: { 2: 10 },
    });
    expect(m.requiredDecisions).toBe(40);
    expect(m.completedDecisions).toBe(20);
    expect(m.completion).toBe(50);
    const passes = m.stages.filter(s => s.kind === STAGE_KIND.REVIEWER_PASS);
    expect(passes.map(s => s.label)).toEqual(['Pass 1', 'Pass 2', 'Pass 3', 'Pass 4']);
    expect(passes.map(s => s.fullLabel)).toEqual([
      '1st reviewer pass', '2nd reviewer pass', '3rd reviewer pass', '4th reviewer pass',
    ]);
    expect(passes.map(s => s.done)).toEqual([10, 10, 0, 0]);
    expect(passes.map(s => s.status)).toEqual(['complete', 'complete', 'active', 'pending']);
  });

  it('a missing/zero reviewer requirement floors at 1 rather than dividing by zero', () => {
    const m = computeScreeningProgress({ poolSize: 5, reviewerHistogram: { 1: 5 } });
    expect(m.requiredReviewers).toBe(1);
    expect(m.completion).toBe(100);
  });
});

describe('computeScreeningProgress — partial passes', () => {
  it('mixes not-started, partial and complete records', () => {
    // 100 records: 40 untouched, 35 with one reviewer, 25 with both.
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 100,
      reviewerHistogram: { 1: 35, 2: 25 },
    });
    expect(m.recordsNotStarted).toBe(40);
    expect(m.recordsAwaitingReviewer).toBe(35);
    expect(m.recordsFullyReviewed).toBe(25);
    expect(m.completedDecisions).toBe(35 + 50);
    expect(m.requiredDecisions).toBe(200);
    expect(m.completion).toBe(43); // 85/200 = 42.5 → 43
    expect(m.summary).toBe('40 not screened yet · 35 awaiting another reviewer.');
    const p1 = stageByKey(m, 'pass-1');
    const p2 = stageByKey(m, 'pass-2');
    expect([p1.done, p1.total, p1.status]).toEqual([60, 100, 'active']);
    expect([p2.done, p2.total, p2.status]).toEqual([25, 100, 'pending']);
  });

  it('surplus reviewers count as surplus, never as progress beyond 100%', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 10,
      reviewerHistogram: { 5: 10 },
    });
    expect(m.completedDecisions).toBe(20);
    expect(m.surplusDecisions).toBe(30);
    expect(m.completion).toBe(100);
    expect(m.complete).toBe(true);
  });

  it('clamps a histogram that over-reports records against the pool', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 5,
      reviewerHistogram: { 1: 50 },
    });
    expect(m.recordsNotStarted).toBe(0);
    expect(m.recordsAwaitingReviewer).toBe(5);
    expect(m.recordsFullyReviewed).toBe(0);
    expect(m.completion).toBeLessThanOrEqual(100);
  });
});

describe('computeScreeningProgress — conflicts stage', () => {
  it('reports resolved / total on the conflict stage', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 20,
      reviewerHistogram: { 2: 20 },
      unresolvedConflicts: 2, resolvedConflicts: 3,
    });
    const c = stageByKey(m, 'conflicts');
    expect([c.done, c.total, c.pct, c.status]).toEqual([3, 5, 60, 'active']);
    expect(m.summary).toBe('2 conflicts to resolve.');
  });

  it('shows an untouched conflict stage as satisfied-but-pending while passes run', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 20,
      reviewerHistogram: { 1: 20 },
    });
    const c = stageByKey(m, 'conflicts');
    expect(c.satisfied).toBe(true);
    // Left-to-right pipeline: a later satisfied stage is not painted "complete"
    // while an earlier stage is still running.
    expect(c.status).toBe('pending');
    expect(stageByKey(m, 'complete').status).toBe('pending');
  });
});

describe('computeScreeningProgress — degenerate inputs', () => {
  it('zero records is 0%, not complete, and says so', () => {
    const m = computeScreeningProgress({ requiredReviewers: 2, poolSize: 0 });
    expect(m.completion).toBe(0);
    expect(m.complete).toBe(false);
    expect(m.requiredDecisions).toBe(0);
    expect(m.summary).toBe('No records to screen yet.');
    expect(m.stages.every(s => s.status !== 'complete')).toBe(true);
    expect(m.currentStageIndex).toBe(0);
  });

  it('no input at all returns a safe zero model', () => {
    const m = computeScreeningProgress();
    expect(m.poolSize).toBe(0);
    expect(m.requiredReviewers).toBe(1);
    expect(m.complete).toBe(false);
    expect(m.stages).toHaveLength(3); // 1 pass + conflicts + complete
  });

  it('accepts a Map or an array histogram identically to a plain object', () => {
    const base = { requiredReviewers: 2, poolSize: 10 };
    const fromObject = computeScreeningProgress({ ...base, reviewerHistogram: { 1: 4, 2: 6 } });
    const fromMap = computeScreeningProgress({ ...base, reviewerHistogram: new Map([[1, 4], [2, 6]]) });
    const fromArray = computeScreeningProgress({ ...base, reviewerHistogram: [0, 4, 6] });
    expect(fromMap.completion).toBe(fromObject.completion);
    expect(fromArray.completion).toBe(fromObject.completion);
    expect(fromArray.completedDecisions).toBe(16);
  });

  it('ignores garbage keys/values instead of producing NaN', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 10,
      reviewerHistogram: { 0: 5, '-1': 3, foo: 9, 2: '4' },
      unresolvedConflicts: 'x', resolvedConflicts: null,
    });
    expect(m.completedDecisions).toBe(8);
    expect(m.recordsFullyReviewed).toBe(4);
    expect(m.unresolvedConflicts).toBe(0);
    expect(Number.isFinite(m.completion)).toBe(true);
  });
});

describe('computeScreeningProgress — engine-reviewer exclusion contract', () => {
  // The engine writes real ScreenDecision rows under a non-human reviewerId. The
  // caller excludes it from the histogram; this pins the CONSEQUENCE: a record
  // carrying one human + one engine decision counts as ONE pass, so the project
  // cannot reach 100% on machine decisions.
  it('one human + one engine decision is still only one reviewer pass', () => {
    const withEngineExcluded = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 100, reviewerHistogram: { 1: 100 },
    });
    const ifEngineHadCounted = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 100, reviewerHistogram: { 2: 100 },
    });
    expect(withEngineExcluded.completion).toBe(50);
    expect(withEngineExcluded.complete).toBe(false);
    expect(ifEngineHadCounted.complete).toBe(true);
  });
});

describe('summary parts (110 review F4)', () => {
  // The module is imported by the Express controller as well as the UI, so it must
  // NOT bake a locale into the payload — it emits {count, text} and the strip runs
  // every count through the same formatter as the rest of the card.
  it('emits structured counts alongside the flat, locale-independent sentence', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 4000, reviewerHistogram: { 1: 1500 }, unresolvedConflicts: 7,
    });
    expect(m.summaryParts).toEqual([
      { count: 2500, text: 'not screened yet' },
      { count: 1500, text: 'awaiting another reviewer' },
      { count: 7, text: 'conflicts to resolve' },
    ]);
    expect(m.summary).toBe('2500 not screened yet · 1500 awaiting another reviewer · 7 conflicts to resolve.');
    expect(formatSummaryParts(m.summaryParts, v => v.toLocaleString('en-US')))
      .toBe('2,500 not screened yet · 1,500 awaiting another reviewer · 7 conflicts to resolve.');
  });

  it('sentence-only states carry their own punctuation and no count', () => {
    for (const input of [
      { requiredReviewers: 2, poolSize: 0 },
      { requiredReviewers: 2, poolSize: 10, reviewerHistogram: { 2: 10 } },
      { requiredReviewers: 1, poolSize: 10, reviewerHistogram: { 1: 10 } },
    ]) {
      const m = computeScreeningProgress(input);
      expect(m.summaryParts).toHaveLength(1);
      expect(m.summaryParts[0].count).toBe(null);
      // One join for both renderings — the two can never drift apart.
      expect(formatSummaryParts(m.summaryParts, v => v.toLocaleString('en-US'))).toBe(m.summary);
      expect(m.summary.endsWith('.')).toBe(true);
    }
  });

  it('a single counted clause still gets the terminal full stop', () => {
    const m = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 20, reviewerHistogram: { 2: 20 }, unresolvedConflicts: 1,
    });
    expect(m.summaryParts).toEqual([{ count: 1, text: 'conflict to resolve' }]);
    expect(m.summary).toBe('1 conflict to resolve.');
  });

  it('degrades to an empty string on a malformed parts array', () => {
    expect(formatSummaryParts(null)).toBe('');
    expect(formatSummaryParts([])).toBe('');
  });
});

describe('conflict counts obey the screening-pool convention (110 review F6)', () => {
  const controllerSrc = readFileSync(
    new URL('../../server/controllers/screeningOverviewController.js', import.meta.url), 'utf8');

  // CONSEQUENCE pin: `poolSize` excludes duplicate-flagged records, so a conflict on
  // one of them is a work unit that can never be paired with a decision — it pinned
  // the strip below 100% forever.
  it('an out-of-pool conflict would deadlock the model, so the caller must not pass one', () => {
    const scoped = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 40, reviewerHistogram: { 2: 40 },
    });
    const leaked = computeScreeningProgress({
      requiredReviewers: 2, poolSize: 40, reviewerHistogram: { 2: 40 }, unresolvedConflicts: 1,
    });
    expect(scoped.complete).toBe(true);
    expect(scoped.completion).toBe(100);
    expect(leaked.complete).toBe(false);
    expect(leaked.completion).toBe(99);
    expect(leaked.totalUnits).toBe(81); // the inflated denominator
  });

  it('the overview controller filters conflicts to the non-duplicate records it already loaded', () => {
    expect(controllerSrc).toContain('const poolRecordIds = new Set(records.filter(r => !r.isDuplicate).map(r => r.id));');
    expect(controllerSrc).toContain('const poolConflicts = conflicts.filter(c => poolRecordIds.has(c.recordId));');
    expect(controllerSrc).toContain('unresolvedConflicts: poolConflicts.filter(c => !c.resolvedAt).length,');
    expect(controllerSrc).toContain('resolvedConflicts: poolConflicts.filter(c => c.resolvedAt).length,');
    // …while the Conflicts TAB badge stays project-wide, matching `listConflicts`.
    expect(controllerSrc).toContain('disputedDecisions, unresolvedConflicts,');
  });
});
