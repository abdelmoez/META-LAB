/**
 * job-retry.test.js — the pure retry-budget policy shared by the durable workers
 * (screeningImportWorker, pecanSearchWorker). Guards the boundary that converts a
 * crash → restart → re-queue loop into a bounded one: at the cap a poison-pill job
 * is permanently failed instead of re-queued. Hermetic (no DB).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAX_JOB_ATTEMPTS,
  hasExhaustedAttempts,
  partitionStuckJobs,
} from '../../server/utils/jobRetry.js';

describe('jobRetry — hasExhaustedAttempts', () => {
  it('the default cap is a small, sane number', () => {
    expect(DEFAULT_MAX_JOB_ATTEMPTS).toBe(5);
  });

  it('is exclusive below the cap and inclusive at/above it (4 vs 5 boundary)', () => {
    expect(hasExhaustedAttempts(4, 5)).toBe(false); // budget remaining → retry
    expect(hasExhaustedAttempts(5, 5)).toBe(true); // budget spent → give up
    expect(hasExhaustedAttempts(6, 5)).toBe(true);
    expect(hasExhaustedAttempts(0, 5)).toBe(false);
  });

  it('uses DEFAULT_MAX_JOB_ATTEMPTS when no cap is passed', () => {
    expect(hasExhaustedAttempts(DEFAULT_MAX_JOB_ATTEMPTS - 1)).toBe(false);
    expect(hasExhaustedAttempts(DEFAULT_MAX_JOB_ATTEMPTS)).toBe(true);
  });

  it('treats missing / non-numeric attempts as NOT exhausted (legacy rows still retry)', () => {
    expect(hasExhaustedAttempts(undefined, 5)).toBe(false);
    expect(hasExhaustedAttempts(null, 5)).toBe(false);
    expect(hasExhaustedAttempts('not-a-number', 5)).toBe(false);
    expect(hasExhaustedAttempts(NaN, 5)).toBe(false);
  });

  it('coerces numeric strings (DB drivers can surface ints as strings)', () => {
    expect(hasExhaustedAttempts('5', 5)).toBe(true);
    expect(hasExhaustedAttempts('4', 5)).toBe(false);
  });
});

describe('jobRetry — partitionStuckJobs', () => {
  it('splits jobs by spent vs remaining budget, preserving order', () => {
    const jobs = [
      { id: 'a', attempts: 5 },
      { id: 'b', attempts: 2 },
      { id: 'c', attempts: 7 },
      { id: 'd', attempts: 0 },
      { id: 'e', attempts: 4 },
    ];
    const { giveUp, retry } = partitionStuckJobs(jobs, 5);
    expect(giveUp.map((j) => j.id)).toEqual(['a', 'c']);
    expect(retry.map((j) => j.id)).toEqual(['b', 'd', 'e']);
  });

  it('a job exactly at the cap is failed, one below is retried', () => {
    const { giveUp, retry } = partitionStuckJobs([{ id: 'at', attempts: 5 }, { id: 'below', attempts: 4 }], 5);
    expect(giveUp.map((j) => j.id)).toEqual(['at']);
    expect(retry.map((j) => j.id)).toEqual(['below']);
  });

  it('legacy rows with no attempts field are retried, never failed', () => {
    const { giveUp, retry } = partitionStuckJobs([{ id: 'legacy' }], 5);
    expect(giveUp).toHaveLength(0);
    expect(retry.map((j) => j.id)).toEqual(['legacy']);
  });

  it('is safe on empty / non-array input', () => {
    expect(partitionStuckJobs([])).toEqual({ giveUp: [], retry: [] });
    expect(partitionStuckJobs(null)).toEqual({ giveUp: [], retry: [] });
    expect(partitionStuckJobs(undefined)).toEqual({ giveUp: [], retry: [] });
  });
});
