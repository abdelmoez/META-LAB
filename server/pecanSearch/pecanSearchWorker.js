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
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';

// A job 'processing' with no heartbeat within this window is treated as abandoned
// (crash) and re-queued at boot so the run resumes.
const STUCK_MS = 10 * 60 * 1000;

// Hard backstop on claim-race retries — never recurse/loop unboundedly even under
// pathological contention. Each iteration is a DB round-trip, never a CPU spin.
const MAX_CLAIM_RACES = 1000;

let draining = false;

async function patch(jobId, data) {
  try { await prisma.pecanSearchJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Atomically claim the oldest queued job (queued → processing), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.pecanSearchJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!next) return null;
    const claim = await prisma.pecanSearchJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'processing', stage: 'starting', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.pecanSearchJob.findUnique({ where: { id: next.id } });
    // lost the race (another drain claimed it first) → try the next queued job
  }
  return null; // extreme contention; the next kick resumes draining
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
 * Recover jobs left 'processing' by a crash (no heartbeat within STUCK_MS). A job
 * whose retry budget is spent (attempts ≥ cap — a poison pill that keeps crashing
 * the worker) is permanently FAILED (job + its run) instead of re-queued, so it
 * can never loop across restarts; the rest are re-queued to resume from each
 * source's persisted cursor. Pure DB work — does NOT kick the drain, so it can be
 * tested in isolation. Returns a { requeued, failed } summary.
 */
export async function recoverStuckPecanSearchJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = new Date(now - STUCK_MS);
  const stuck = await prisma.pecanSearchJob.findMany({
    where: { status: 'processing', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }] },
    select: { id: true, runId: true, attempts: true },
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) {
    const msg = `Search stopped after ${maxAttempts} failed attempts — it repeatedly interrupted the worker.`;
    await patch(job.id, { status: 'failed', stage: 'failed', error: msg, finishedAt: new Date() });
    // Reflect the failure on the run so the UI is honest (best-effort).
    try {
      if (job.runId) await prisma.pecanSearchRun.update({ where: { id: job.runId }, data: { state: 'failed', errorSummary: msg, completedAt: new Date() } });
    } catch { /* run gone / already terminal — ignore */ }
  }
  if (retry.length) {
    await prisma.pecanSearchJob.updateMany({
      where: { id: { in: retry.map((j) => j.id) } },
      data: { status: 'queued', stage: 'queued' },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

/**
 * startPecanSearchWorker — boot hook. Recovers any job left 'processing' by a
 * crash (re-queue under the retry cap so the run resumes from each source's
 * persisted cursor; permanently fail over it), then drains. Idempotent.
 */
export async function startPecanSearchWorker() {
  try {
    const { requeued, failed } = await recoverStuckPecanSearchJobs();
    if (requeued) console.log(`[pecan-search-worker] re-queued ${requeued} stuck search job(s)`);
    if (failed) console.warn(`[pecan-search-worker] failed ${failed} search job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[pecan-search-worker] startup requeue failed:', e?.message);
  }
  kickPecanSearchWorker();
}
