/**
 * duplicateWorkerRecovery.test.js — 107.md §1 (rec round). `recoverStuckDuplicateJobs`
 * is the boot/tick recovery pass: a heartbeat-stale processing job is re-queued while
 * it still has retry budget, and permanently FAILED once the budget is spent.
 *
 * That give-up is the one terminal transition no client can observe on its own — the
 * job never reaches the worker loop again, so nothing else will ever announce it.
 * Without a `emitDuplicateJobTerminal` poke the workflow stepper keeps rendering the
 * last-fetched `processing` state forever even though the row says `failed` and
 * carries a user-facing error (useScreeningSummary has no polling loop).
 *
 * Prisma and the realtime bus are mocked → hermetic, no DB, no sockets.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const emitToProjectMembers = vi.fn();
vi.mock('../../../server/realtime/bus.js', () => ({ emitToProjectMembers }));
vi.mock('../../../server/store.js', async (importOriginal) => ({
  ...(await importOriginal()),
  touchProjectActivity: vi.fn(async () => true),
}));

const db = { jobs: [], patches: [], requeued: [] };
const prismaMock = {
  screenDuplicateJob: {
    findMany: vi.fn(async ({ select }) => db.jobs.map((j) => {
      const row = {};
      for (const k of Object.keys(select || {})) row[k] = j[k];
      return row;
    })),
    update: vi.fn(async ({ where, data }) => { db.patches.push({ id: where.id, ...data }); return {}; }),
    updateMany: vi.fn(async ({ where }) => {
      db.requeued.push(...(where.id?.in || []));
      return { count: (where.id?.in || []).length };
    }),
  },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { recoverStuckDuplicateJobs, DUP_CFG } = await import('../../../server/services/screeningDuplicateWorker.js');

const NOW = Date.parse('2026-08-09T12:00:00.000Z');
const STALE = new Date(NOW - DUP_CFG.STUCK_MS - 60_000).toISOString();
const FRESH = new Date(NOW - 1_000).toISOString();
const job = (over = {}) => ({
  id: 'job-1', projectId: 'sp-1', attempts: 1, heartbeatAt: STALE, startedAt: STALE, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.jobs = []; db.patches = []; db.requeued = [];
});

describe('recoverStuckDuplicateJobs — poison-pill give-up announces itself', () => {
  it('fails the job AND emits both terminal events to every member of ITS project', async () => {
    db.jobs = [job({ id: 'poison', projectId: 'sp-poison', attempts: 5 })];
    const out = await recoverStuckDuplicateJobs(NOW, 5);

    expect(out).toEqual({ requeued: 0, failed: 1 });
    expect(db.patches).toHaveLength(1);
    expect(db.patches[0]).toMatchObject({ id: 'poison', status: 'failed', stage: 'failed' });
    expect(db.patches[0].error).toMatch(/stopped after 5 interrupted attempts/);

    // Both events, both for the failing job's OWN project, and nobody excluded —
    // including the user who started the run (their stepper is the stale one).
    expect(emitToProjectMembers.mock.calls).toEqual([
      ['sp-poison', { type: 'duplicates.completed', jobId: 'poison' }],
      ['sp-poison', { type: 'project.updated' }],
    ]);
  });

  it('selects projectId — the emit cannot fire with an undefined project', async () => {
    db.jobs = [job({ attempts: 9 })];
    await recoverStuckDuplicateJobs(NOW, 5);
    expect(prismaMock.screenDuplicateJob.findMany.mock.calls[0][0].select.projectId).toBe(true);
    for (const [projectId] of emitToProjectMembers.mock.calls) expect(projectId).toBe('sp-1');
  });

  it('emits once per failed job, each to its own project', async () => {
    db.jobs = [
      job({ id: 'a', projectId: 'sp-a', attempts: 5 }),
      job({ id: 'b', projectId: 'sp-b', attempts: 6 }),
    ];
    const out = await recoverStuckDuplicateJobs(NOW, 5);
    expect(out.failed).toBe(2);
    expect(emitToProjectMembers.mock.calls.map(([pid, ev]) => `${pid}:${ev.type}`)).toEqual([
      'sp-a:duplicates.completed', 'sp-a:project.updated',
      'sp-b:duplicates.completed', 'sp-b:project.updated',
    ]);
  });
});

describe('recoverStuckDuplicateJobs — the non-terminal paths stay silent', () => {
  it('a re-queued job is NOT terminal, so nothing is emitted', async () => {
    db.jobs = [job({ id: 'retryable', attempts: 2 })];
    const out = await recoverStuckDuplicateJobs(NOW, 5);
    expect(out).toEqual({ requeued: 1, failed: 0 });
    expect(db.requeued).toEqual(['retryable']);
    expect(emitToProjectMembers).not.toHaveBeenCalled();
  });

  it('a healthy (fresh heartbeat) job is left completely alone', async () => {
    db.jobs = [job({ heartbeatAt: FRESH, attempts: 9 })];
    const out = await recoverStuckDuplicateJobs(NOW, 5);
    expect(out).toEqual({ requeued: 0, failed: 0 });
    expect(db.patches).toEqual([]);
    expect(emitToProjectMembers).not.toHaveBeenCalled();
  });

  it('mixes give-up and retry in one pass', async () => {
    db.jobs = [
      job({ id: 'give-up', projectId: 'sp-x', attempts: 5 }),
      job({ id: 'retry', projectId: 'sp-y', attempts: 1 }),
      job({ id: 'healthy', projectId: 'sp-z', attempts: 5, heartbeatAt: FRESH }),
    ];
    const out = await recoverStuckDuplicateJobs(NOW, 5);
    expect(out).toEqual({ requeued: 1, failed: 1 });
    expect(db.requeued).toEqual(['retry']);
    expect(new Set(emitToProjectMembers.mock.calls.map(([pid]) => pid))).toEqual(new Set(['sp-x']));
  });
});
