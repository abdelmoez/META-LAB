/**
 * duplicateJobProgress.test.js — 92.md honest job-progress derivation.
 * The percent must come ONLY from persisted job state, stay monotonic through the
 * stage sequence, and never reach 100 until the job is terminally completed.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDuplicateJobProgress,
  formatDurationMs,
  DUP_JOB_STAGE_SPANS,
} from '../../../src/research-engine/screening/duplicateJobProgress.js';

const T0 = Date.parse('2026-07-16T10:00:00Z');
const mk = (over = {}) => ({
  status: 'processing', stage: 'preparing', cancelRequested: false,
  totalRecords: 1000, processedRecords: 0,
  comparisonsTotal: 0, comparisonsDone: 0,
  groupsFound: 0, savedGroups: 0, attempts: 1,
  createdAt: new Date(T0 - 2000).toISOString(),
  startedAt: new Date(T0).toISOString(),
  completedAt: null,
  ...over,
});

describe('computeDuplicateJobProgress', () => {
  it('is monotonic across the real stage sequence and never hits 100 mid-run', () => {
    const seq = [
      mk({ status: 'queued', stage: 'queued', startedAt: null, attempts: 0 }),
      mk({ stage: 'preparing' }),
      mk({ stage: 'normalizing', processedRecords: 200 }),
      mk({ stage: 'normalizing', processedRecords: 1000 }),
      mk({ stage: 'exact' }),
      mk({ stage: 'fuzzy', comparisonsTotal: 5000, comparisonsDone: 100 }),
      mk({ stage: 'fuzzy', comparisonsTotal: 5000, comparisonsDone: 4999 }),
      mk({ stage: 'grouping', comparisonsTotal: 5000, comparisonsDone: 5000, groupsFound: 12 }),
      mk({ stage: 'saving', groupsFound: 12, savedGroups: 6 }),
      mk({ stage: 'saving', groupsFound: 12, savedGroups: 12 }),
      mk({ stage: 'finalizing' }),
    ];
    let last = -1;
    for (const job of seq) {
      const p = computeDuplicateJobProgress(job, T0 + 10_000);
      expect(p.percent).toBeGreaterThanOrEqual(last);
      expect(p.percent).toBeLessThan(100);
      expect(p.terminal).toBe(false);
      last = p.percent;
    }
  });

  it('reports 100 only when completed; freezes percent for failed/cancelled', () => {
    const done = computeDuplicateJobProgress(mk({
      status: 'completed', stage: 'done', completedAt: new Date(T0 + 60_000).toISOString(),
    }), T0 + 120_000);
    expect(done.percent).toBe(100);
    expect(done.state).toBe('completed');
    expect(done.terminal).toBe(true);
    expect(done.elapsedMs).toBe(60_000); // frozen at completedAt, not "now"

    const failed = computeDuplicateJobProgress(mk({
      status: 'failed', stage: 'failed', completedAt: new Date(T0 + 5000).toISOString(),
    }), T0 + 99_000);
    expect(failed.state).toBe('failed');
    expect(failed.percent).toBeLessThan(100);

    const cancelled = computeDuplicateJobProgress(mk({
      status: 'cancelled', stage: 'cancelled', completedAt: new Date(T0 + 5000).toISOString(),
    }), T0 + 99_000);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.terminal).toBe(true);
  });

  it('distinguishes queued, retrying, and cancelling states', () => {
    expect(computeDuplicateJobProgress(mk({ status: 'queued', stage: 'queued', attempts: 0 }), T0).state).toBe('queued');
    expect(computeDuplicateJobProgress(mk({ status: 'queued', stage: 'queued', attempts: 2 }), T0).state).toBe('retrying');
    expect(computeDuplicateJobProgress(mk({ cancelRequested: true }), T0).state).toBe('cancelling');
    expect(computeDuplicateJobProgress(mk({}), T0).state).toBe('running');
  });

  it('emits an ETA only once there is real signal, never while queued/terminal', () => {
    const early = computeDuplicateJobProgress(mk({ stage: 'preparing' }), T0 + 1000);
    expect(early.etaMs).toBeNull();
    const mid = computeDuplicateJobProgress(
      mk({ stage: 'fuzzy', comparisonsTotal: 100, comparisonsDone: 50 }), T0 + 30_000,
    );
    expect(mid.etaMs).toBeGreaterThan(0);
    const doneJob = computeDuplicateJobProgress(mk({ status: 'completed', stage: 'done' }), T0 + 30_000);
    expect(doneJob.etaMs).toBeNull();
  });

  it('a fuzzy stage with zero planned comparisons counts as complete, not stuck at 0', () => {
    const p = computeDuplicateJobProgress(mk({ stage: 'fuzzy', comparisonsTotal: 0, comparisonsDone: 0 }), T0 + 5000);
    const span = DUP_JOB_STAGE_SPANS.find((s) => s.stage === 'fuzzy');
    expect(p.percent).toBe(span.to);
  });

  it('handles a null job defensively', () => {
    const p = computeDuplicateJobProgress(null, T0);
    expect(p.percent).toBe(0);
    expect(p.terminal).toBe(false);
  });
});

describe('formatDurationMs', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatDurationMs(0)).toBe('0:00');
    expect(formatDurationMs(65_000)).toBe('1:05');
    expect(formatDurationMs(3_725_000)).toBe('1:02:05');
    expect(formatDurationMs(null)).toBe('—');
  });
});
