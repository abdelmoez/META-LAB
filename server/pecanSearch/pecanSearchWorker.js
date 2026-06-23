/**
 * pecanSearch/pecanSearchWorker.js — durable, in-process, DB-backed worker for
 * search runs. Modeled on screeningImportWorker.js (the proven single-process +
 * SQLite durable-job pattern): a job + its run live in the DB, so a search
 * survives the browser closing the tab AND a worker restart (startPecanSearchWorker
 * re-queues jobs left mid-flight at boot, then resumes from each source's cursor).
 *
 * Concurrency: one JOB is claimed at a time via an atomic status flip
 * (queued → processing); the run's per-source fan-out concurrency is handled
 * inside processRun. Heartbeats are written during paging so a genuinely stuck
 * job (crash) is distinguishable from a long-but-healthy one at boot.
 */
import { prisma } from '../db/client.js';
import { processRun } from './runService.js';

// A job 'processing' with no heartbeat within this window is treated as abandoned
// (crash) and re-queued at boot so the run resumes.
const STUCK_MS = 10 * 60 * 1000;

let draining = false;

async function patch(jobId, data) {
  try { await prisma.pecanSearchJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Atomically claim the oldest queued job (queued → processing), or null. */
async function claimNext() {
  const next = await prisma.pecanSearchJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!next) return null;
  const claim = await prisma.pecanSearchJob.updateMany({
    where: { id: next.id, status: 'queued' },
    data: { status: 'processing', stage: 'starting', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
  });
  if (claim.count !== 1) return claimNext(); // lost the race → try the next
  return prisma.pecanSearchJob.findUnique({ where: { id: next.id } });
}

async function processJob(job) {
  try {
    await processRun(job);
  } catch (e) {
    console.error('[pecan-search-worker] processJob:', e?.message);
    await patch(job.id, { status: 'failed', stage: 'failed', error: String(e?.message || 'Search failed').slice(0, 1000), finishedAt: new Date() });
    // Best-effort: reflect the failure on the run so the UI is honest.
    try { await prisma.pecanSearchRun.update({ where: { id: job.runId }, data: { state: 'failed', errorSummary: String(e?.message || 'Search failed').slice(0, 1000), completedAt: new Date() } }); } catch { /* ignore */ }
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = await claimNext();
      if (!job) break;
      await processJob(job);
    }
  } catch (e) {
    console.error('[pecan-search-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickPecanSearchWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/**
 * startPecanSearchWorker — boot hook. Re-queues any job left 'processing' by a
 * crash (no heartbeat within STUCK_MS) so the run resumes from each source's
 * persisted cursor, then drains. Idempotent.
 */
export async function startPecanSearchWorker() {
  try {
    const cutoff = new Date(Date.now() - STUCK_MS);
    const requeued = await prisma.pecanSearchJob.updateMany({
      where: { status: 'processing', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }] },
      data: { status: 'queued', stage: 'queued' },
    });
    if (requeued.count) console.log(`[pecan-search-worker] re-queued ${requeued.count} stuck search job(s)`);
  } catch (e) {
    console.error('[pecan-search-worker] startup requeue failed:', e?.message);
  }
  kickPecanSearchWorker();
}
