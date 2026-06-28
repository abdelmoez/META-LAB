/**
 * worker-retry-cap.test.js — durable-worker boot recovery against the real (dev
 * SQLite) DB. Proves the retry cap: a job left 'processing' by a crash is
 * re-queued only while it has retry budget; once attempts ≥ cap (a poison pill
 * that keeps crashing the worker) it is permanently FAILED instead of re-queued,
 * so it can never loop across restarts and peg the CPU.
 *
 * Calls recoverStuck*() DIRECTLY (not startWorker) so no drain / network runs.
 * Creates + cleans up its own rows. Run via `npm run test:integration`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { recoverStuckImportJobs } from '../../server/services/screeningImportWorker.js';
import { recoverStuckPecanSearchJobs } from '../../server/pecanSearch/pecanSearchWorker.js';

const tag = `retrycap_${Date.now()}`;
const STALE = new Date(Date.now() - 20 * 60 * 1000); // older than STUCK_MS (10 min)
const FRESH = new Date(); // within the heartbeat window → not stuck
const CAP = 3; // explicit small cap for the boundary (cap-1 retries, cap fails)

let user, screenProject;

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'RetryCap' } });
  screenProject = await prisma.screenProject.create({ data: { ownerId: user.id, title: 'Retry Cap' } });
});

afterAll(async () => {
  try {
    await prisma.screenImportJob.deleteMany({ where: { projectId: screenProject.id } });
    await prisma.screenProject.deleteMany({ where: { id: screenProject.id } });
    await prisma.pecanSearchJob.deleteMany({ where: { metaLabProjectId: tag } });
    await prisma.pecanSearchRun.deleteMany({ where: { metaLabProjectId: tag } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  } catch { /* best-effort cleanup */ }
});

describe('screeningImportWorker — recoverStuckImportJobs retry cap', () => {
  it('fails over-cap jobs, re-queues under-cap jobs, leaves fresh jobs alone', async () => {
    const mk = (attempts, startedAt) => prisma.screenImportJob.create({
      data: { projectId: screenProject.id, createdById: user.id, status: 'processing', stage: 'saving', attempts, startedAt },
    });
    const overCap = await mk(CAP, STALE); // attempts === cap → permanently fail
    const underCap = await mk(CAP - 1, STALE); // budget remaining → re-queue
    const fresh = await mk(CAP, FRESH); // recently heartbeated → not stuck → untouched

    const summary = await recoverStuckImportJobs(Date.now(), CAP);
    expect(summary).toEqual({ requeued: 1, failed: 1 });

    const [a, b, c] = await Promise.all([
      prisma.screenImportJob.findUnique({ where: { id: overCap.id } }),
      prisma.screenImportJob.findUnique({ where: { id: underCap.id } }),
      prisma.screenImportJob.findUnique({ where: { id: fresh.id } }),
    ]);
    expect(a.status).toBe('failed');
    expect(a.stage).toBe('failed');
    expect(a.error).toMatch(/repeatedly/i);
    expect(b.status).toBe('queued'); // resumes
    expect(b.stage).toBe('queued');
    expect(c.status).toBe('processing'); // not stuck → left alone
  });

  it('is a no-op when there are no stuck jobs', async () => {
    // Only the fresh 'processing' job from the prior test remains; nothing stale.
    const summary = await recoverStuckImportJobs(Date.now(), CAP);
    expect(summary).toEqual({ requeued: 0, failed: 0 });
  });
});

describe('pecanSearchWorker — recoverStuckPecanSearchJobs retry cap', () => {
  it('fails over-cap jobs (and their run), re-queues under-cap, leaves fresh alone', async () => {
    const run = await prisma.pecanSearchRun.create({ data: { metaLabProjectId: tag, state: 'running' } });
    const mk = (attempts, heartbeatAt, runId = '') => prisma.pecanSearchJob.create({
      data: { metaLabProjectId: tag, runId, status: 'processing', stage: 'paging', attempts, heartbeatAt },
    });
    const overCap = await mk(CAP, STALE, run.id);
    const underCap = await mk(CAP - 1, STALE);
    const fresh = await mk(CAP, FRESH);

    const summary = await recoverStuckPecanSearchJobs(Date.now(), CAP);
    expect(summary).toEqual({ requeued: 1, failed: 1 });

    const [a, b, c, r] = await Promise.all([
      prisma.pecanSearchJob.findUnique({ where: { id: overCap.id } }),
      prisma.pecanSearchJob.findUnique({ where: { id: underCap.id } }),
      prisma.pecanSearchJob.findUnique({ where: { id: fresh.id } }),
      prisma.pecanSearchRun.findUnique({ where: { id: run.id } }),
    ]);
    expect(a.status).toBe('failed');
    expect(a.stage).toBe('failed');
    expect(b.status).toBe('queued'); // resumes from cursor
    expect(c.status).toBe('processing'); // not stuck
    expect(r.state).toBe('failed'); // run reflects the give-up honestly
    expect(r.errorSummary).toMatch(/attempts/i);
  });
});
