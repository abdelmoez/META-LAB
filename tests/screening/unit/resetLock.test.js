/**
 * resetLock.test.js — 96.md Phase 6F: the per-project reset mutex, the landing
 * serialization queue (M23), the landing-side reset fence (M14/M24), and the
 * ScreenRecordSource identity keys (M12/L12). All hermetic — no DB queries run
 * (the fence throws BEFORE any Prisma call).
 */
import { describe, it, expect } from 'vitest';
import { acquireResetLock, releaseResetLock, isResetLocked } from '../../../server/screening/resetLock.js';
import {
  dedupeAndInsertRecords, withProjectLandingLock, whenLandingIdle,
  sourceKeyOf, runScopedSourceKeyOf,
} from '../../../server/services/screeningImportService.js';

describe('resetLock — per-project mutex', () => {
  it('acquire → isLocked → release lifecycle; a second acquire fails while held', () => {
    expect(isResetLocked('proj-1')).toBe(false);
    expect(acquireResetLock('proj-1')).toBe(true);
    expect(isResetLocked('proj-1')).toBe(true);
    expect(acquireResetLock('proj-1')).toBe(false); // double-submit → caller 409s
    releaseResetLock('proj-1');
    expect(isResetLocked('proj-1')).toBe(false);
    expect(acquireResetLock('proj-1')).toBe(true); // re-acquirable after release
    releaseResetLock('proj-1');
  });

  it('locks are per-project (one project resetting never blocks another)', () => {
    expect(acquireResetLock('proj-a')).toBe(true);
    expect(isResetLocked('proj-b')).toBe(false);
    expect(acquireResetLock('proj-b')).toBe(true);
    releaseResetLock('proj-a');
    releaseResetLock('proj-b');
  });

  it('a blank project id never locks and releasing an unheld lock is a no-op', () => {
    expect(acquireResetLock('')).toBe(false);
    expect(isResetLocked('')).toBe(false);
    releaseResetLock('never-held'); // must not throw
  });
});

describe('dedupeAndInsertRecords — landing-side reset fence (M14/M24)', () => {
  it('fails fast with code RESET_IN_PROGRESS while the reset lock is held', async () => {
    acquireResetLock('locked-project');
    try {
      await expect(dedupeAndInsertRecords('locked-project', [])).rejects.toMatchObject({
        code: 'RESET_IN_PROGRESS',
      });
    } finally {
      releaseResetLock('locked-project');
    }
  });
});

describe('withProjectLandingLock — per-project landing serialization (M23)', () => {
  it('two concurrent landings on ONE project run strictly sequentially', async () => {
    const events = [];
    const p1 = withProjectLandingLock('serial-1', async () => {
      events.push('a-start');
      await new Promise((r) => setTimeout(r, 25));
      events.push('a-end');
      return 'a';
    });
    const p2 = withProjectLandingLock('serial-1', async () => {
      events.push('b-start');
      events.push('b-end');
      return 'b';
    });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
    // No interleaving: b starts only after a fully finished.
    expect(events).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('landings on DIFFERENT projects are not serialized against each other', async () => {
    let fastDone = false;
    const slow = withProjectLandingLock('serial-slow', () => new Promise((r) => setTimeout(r, 40)));
    const fast = withProjectLandingLock('serial-fast', async () => { fastDone = true; });
    await fast;
    expect(fastDone).toBe(true); // did not wait behind the other project's landing
    await slow;
  });

  it('a failed landing does not poison the chain; the queue drains leak-free', async () => {
    await expect(
      withProjectLandingLock('serial-fail', () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    // The next landing on the same project still runs (chain not poisoned).
    const ok = await withProjectLandingLock('serial-fail', async () => 42);
    expect(ok).toBe(42);
    // After the chain drains, whenLandingIdle resolves immediately (map entry
    // deleted — no leak). A hang here would time the test out.
    await whenLandingIdle('serial-fail');
  });

  it('whenLandingIdle resolves only after every queued landing finished', async () => {
    const done = [];
    withProjectLandingLock('serial-idle', async () => {
      await new Promise((r) => setTimeout(r, 15));
      done.push('first');
    });
    withProjectLandingLock('serial-idle', async () => { done.push('second'); });
    await whenLandingIdle('serial-idle');
    expect(done).toEqual(['first', 'second']);
  });
});

describe('ScreenRecordSource identity keys (M12/L12)', () => {
  it('the separator prevents field-boundary ambiguity across key parts', () => {
    const a = sourceKeyOf({ screenRecordId: 'r', runId: 'x', batchId: '', provider: '', providerRecordId: '' });
    const b = sourceKeyOf({ screenRecordId: 'r', runId: '', batchId: 'x', provider: '', providerRecordId: '' });
    expect(a).not.toBe(b);
  });

  it('run-scoped identity ignores batchId for pecan rows (page retry lands in a new batch)', () => {
    const attempt1 = runScopedSourceKeyOf({ screenRecordId: 'r', runId: 'run-1', batchId: 'batch-1', provider: 'pubmed', providerRecordId: '9' });
    const attempt2 = runScopedSourceKeyOf({ screenRecordId: 'r', runId: 'run-1', batchId: 'batch-2', provider: 'pubmed', providerRecordId: '9' });
    expect(attempt1).toBe(attempt2); // same logical row despite the new batch
    // Different provider/record → different identity.
    const other = runScopedSourceKeyOf({ screenRecordId: 'r', runId: 'run-1', batchId: 'batch-2', provider: 'europepmc', providerRecordId: '9' });
    expect(other).not.toBe(attempt1);
  });

  it('file/api rows (no runId) have NO run-scoped identity — batch-scoped by design', () => {
    expect(runScopedSourceKeyOf({ screenRecordId: 'r', runId: '', batchId: 'b1', provider: '', providerRecordId: '' })).toBe('');
    expect(runScopedSourceKeyOf(null)).toBe('');
  });
});
