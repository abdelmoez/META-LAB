/**
 * citationMining/citationChaseWorker.js — durable, in-process, DB-backed worker
 * for citation-chase jobs (P15). A direct clone of pecanSearchWorker.js (the proven
 * single-process durable-job pattern): a job lives in the DB, so a chase survives
 * the browser closing the tab AND a worker restart. startCitationChaseWorker
 * re-queues jobs left mid-flight at boot (under a retry cap so a poison pill can
 * never crash-loop across restarts), then drains.
 *
 * ALL business logic lives in citationMiningService.processChase; this file only
 * claims a job atomically, invokes it, and handles crash recovery — mirroring the
 * runService/worker split so the bounded BFS is unit-testable without the worker.
 */
import { prisma } from '../db/client.js';
import { processChase } from './citationMiningService.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';

// A job 'processing' with no heartbeat within this window is treated as abandoned
// (crash) and re-queued at boot so the chase resumes.
const STUCK_MS = 10 * 60 * 1000;
const MAX_CLAIM_RACES = 1000;

let draining = false;

async function patch(jobId, data) {
  try { await prisma.citationChaseJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Atomically claim the oldest queued job (queued → processing), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.citationChaseJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!next) return null;
    const claim = await prisma.citationChaseJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'processing', heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.citationChaseJob.findUnique({ where: { id: next.id } });
    // lost the race (another drain claimed it) → try the next queued job
  }
  return null;
}

async function processJob(job) {
  try {
    await processChase(job);
  } catch (e) {
    console.error('[citation-chase-worker] processJob:', e?.message);
    await patch(job.id, { status: 'failed', errorText: String(e?.message || 'Citation chase failed').slice(0, 500) });
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
    console.error('[citation-chase-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickCitationChaseWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/**
 * Recover jobs left 'processing' by a crash (no heartbeat within STUCK_MS). A job
 * whose retry budget is spent (attempts ≥ cap) is permanently FAILED instead of
 * re-queued, so it can never loop across restarts; the rest are re-queued. Pure DB
 * work — does NOT kick the drain, so it can be tested in isolation.
 */
export async function recoverStuckCitationChaseJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = new Date(now - STUCK_MS);
  const stuck = await prisma.citationChaseJob.findMany({
    where: { status: 'processing', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }] },
    select: { id: true, attempts: true },
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) {
    await patch(job.id, { status: 'failed', errorText: `Citation chase stopped after ${maxAttempts} failed attempts.` });
  }
  if (retry.length) {
    await prisma.citationChaseJob.updateMany({ where: { id: { in: retry.map((j) => j.id) } }, data: { status: 'queued' } });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

/**
 * startCitationChaseWorker — boot hook. Recovers any job left 'processing' by a
 * crash (re-queue under the retry cap; permanently fail over it), then drains.
 * Idempotent.
 */
export async function startCitationChaseWorker() {
  try {
    const { requeued, failed } = await recoverStuckCitationChaseJobs();
    if (requeued) console.log(`[citation-chase-worker] re-queued ${requeued} stuck chase job(s)`);
    if (failed) console.warn(`[citation-chase-worker] failed ${failed} chase job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[citation-chase-worker] startup requeue failed:', e?.message);
  }
  kickCitationChaseWorker();
}
