/**
 * duplicateJobState.test.js — 107.md §1. `pickNewerJob` is the single arbiter for
 * every duplicate-detection job observation arriving from the network (reconnect
 * fetch, 1.5 s poll, 10 s idle poll, detect/cancel responses).
 *
 * The contract under test: the backend row is authoritative, a job may advance but
 * never regress, and an older API response can never move a finished job backward
 * (`completed → pending`).
 */
import { describe, it, expect } from 'vitest';
import { pickNewerJob } from '../../../src/research-engine/screening/duplicateJobState.js';

const job = (over = {}) => ({
  id: 'job-1',
  status: 'queued',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
  ...over,
});

describe('pickNewerJob — forward-only job state (107.md §1)', () => {
  it('adopts the first observation when nothing is held yet', () => {
    const next = job();
    expect(pickNewerJob(null, next)).toBe(next);
    expect(pickNewerJob(undefined, next)).toBe(next);
  });

  it('queued → processing advances', () => {
    const prev = job({ status: 'queued' });
    const next = job({ status: 'processing', updatedAt: '2026-02-01T10:00:05.000Z' });
    expect(pickNewerJob(prev, next)).toBe(next);
  });

  it('processing → completed advances', () => {
    const prev = job({ status: 'processing', updatedAt: '2026-02-01T10:00:05.000Z' });
    const next = job({ status: 'completed', updatedAt: '2026-02-01T10:00:30.000Z', completedAt: '2026-02-01T10:00:30.000Z' });
    expect(pickNewerJob(prev, next)).toBe(next);
  });

  it('processing → failed advances (failure is terminal, not a regression)', () => {
    const prev = job({ status: 'processing', updatedAt: '2026-02-01T10:00:05.000Z' });
    const next = job({ status: 'failed', error: 'boom', updatedAt: '2026-02-01T10:00:31.000Z' });
    expect(pickNewerJob(prev, next)).toBe(next);
  });

  it('REGRESSION GUARD: a stale queued/processing response for the SAME job never undoes completion', () => {
    const done = job({ status: 'completed', updatedAt: '2026-02-01T10:00:30.000Z', completedAt: '2026-02-01T10:00:30.000Z' });
    const stalePending = job({ status: 'queued', updatedAt: '2026-02-01T10:00:00.000Z' });
    const staleProcessing = job({ status: 'processing', updatedAt: '2026-02-01T10:00:05.000Z' });
    expect(pickNewerJob(done, stalePending)).toBe(done);
    expect(pickNewerJob(done, staleProcessing)).toBe(done);
    // …and the same for the other terminal states.
    expect(pickNewerJob(job({ status: 'failed' }), staleProcessing)).toHaveProperty('status', 'failed');
    expect(pickNewerJob(job({ status: 'cancelled' }), staleProcessing)).toHaveProperty('status', 'cancelled');
  });

  it('at equal rank the newer updatedAt wins and an older one is dropped', () => {
    const prev = job({ status: 'processing', updatedAt: '2026-02-01T10:00:10.000Z', processedRecords: 500 });
    const newer = job({ status: 'processing', updatedAt: '2026-02-01T10:00:12.000Z', processedRecords: 900 });
    const older = job({ status: 'processing', updatedAt: '2026-02-01T10:00:08.000Z', processedRecords: 100 });
    expect(pickNewerJob(prev, newer)).toBe(newer);
    expect(pickNewerJob(prev, older)).toBe(prev);
  });

  it('an identical observation returns the SAME object (no needless re-render)', () => {
    const prev = job({ status: 'completed', updatedAt: '2026-02-01T10:00:30.000Z' });
    const repeat = job({ status: 'completed', updatedAt: '2026-02-01T10:00:30.000Z' });
    expect(pickNewerJob(prev, repeat)).toBe(prev);
    expect(pickNewerJob(prev, prev)).toBe(prev);
  });

  it('a response describing an OLDER job never replaces a newer one', () => {
    const current = job({ id: 'job-2', status: 'queued', createdAt: '2026-02-01T12:00:00.000Z' });
    const previousRun = job({ id: 'job-1', status: 'completed', createdAt: '2026-02-01T10:00:00.000Z' });
    expect(pickNewerJob(current, previousRun)).toBe(current);
  });

  it('a NEWER queued retry job supersedes an old completed run', () => {
    const oldRun = job({ id: 'job-1', status: 'completed', createdAt: '2026-02-01T10:00:00.000Z', updatedAt: '2026-02-01T10:00:30.000Z' });
    const retry  = job({ id: 'job-2', status: 'queued',    createdAt: '2026-02-01T12:00:00.000Z', updatedAt: '2026-02-01T12:00:00.000Z' });
    expect(pickNewerJob(oldRun, retry)).toBe(retry);
  });

  it('different jobs created in the same tick resolve deterministically (id tiebreak)', () => {
    const a = job({ id: 'aaa', createdAt: '2026-02-01T10:00:00.000Z' });
    const b = job({ id: 'bbb', createdAt: '2026-02-01T10:00:00.000Z' });
    expect(pickNewerJob(a, b)).toBe(b);
    expect(pickNewerJob(b, a)).toBe(b);   // symmetric — the same winner either way
  });

  it('tolerates null, garbage and missing timestamps without throwing', () => {
    const good = job({ status: 'completed' });
    expect(pickNewerJob(null, null)).toBeNull();
    expect(pickNewerJob(good, null)).toBe(good);
    expect(pickNewerJob(good, undefined)).toBe(good);
    expect(pickNewerJob(good, {})).toBe(good);          // no id → not a job
    expect(pickNewerJob(good, { id: '' })).toBe(good);
    expect(pickNewerJob(good, 'nonsense')).toBe(good);
    expect(pickNewerJob(good, 42)).toBe(good);
    expect(pickNewerJob('nonsense', good)).toBe(good);
    // Unknown status is outranked by any known one for the same row.
    expect(pickNewerJob(good, job({ status: 'weird' }))).toBe(good);
    // Absent/garbage timestamps: the newest response simply wins for the same row.
    const noClockPrev = { id: 'job-1', status: 'processing' };
    const noClockNext = { id: 'job-1', status: 'processing', processedRecords: 7 };
    expect(pickNewerJob(noClockPrev, noClockNext)).toBe(noClockNext);
    expect(pickNewerJob({ id: 'a', status: 'queued', createdAt: 'not-a-date' }, job({ id: 'b' }))).toHaveProperty('id', 'b');
  });

  it('an untimestamped different row never displaces a timestamped one', () => {
    const timestamped = job({ id: 'job-2', createdAt: '2026-02-01T12:00:00.000Z' });
    const undated = { id: 'job-9', status: 'queued' };
    expect(pickNewerJob(timestamped, undated)).toBe(timestamped);
  });

  it('accepts Date instances as well as ISO strings', () => {
    const prev = { id: 'j', status: 'processing', updatedAt: new Date('2026-02-01T10:00:10.000Z') };
    const next = { id: 'j', status: 'processing', updatedAt: new Date('2026-02-01T10:00:20.000Z') };
    expect(pickNewerJob(prev, next)).toBe(next);
    expect(pickNewerJob(next, prev)).toBe(next);
  });
});
