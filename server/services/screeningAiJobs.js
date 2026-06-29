/**
 * screeningAiJobs.js — durable, DB-backed background scoring worker (se2.md §6/§12 +
 * 62.md performance rework).
 *
 * WHY (62.md): manual "Run AI scoring" used to `await runScoring()` INSIDE the HTTP
 * handler, and the decision-triggered rescorer ran the same blocking call from an
 * in-memory `setTimeout`. Either way the scoring CPU ran on the single Node event loop,
 * freezing the whole server for the length of a run. Now BOTH paths enqueue a durable
 * `ScreenAiJob` row and return immediately; this in-process worker claims jobs off the
 * event loop and runs the actual compute in a worker_thread (see aiCompute.js). The
 * request thread never blocks, progress is written to the job row for the UI to poll,
 * and a crash mid-run is recovered at boot (re-queue under a retry cap, fail a poison
 * pill) instead of leaving a row stuck in `running` forever.
 *
 * Concurrency model (single-node): one job drains at a time (FIFO by createdAt); the
 * compute worker_thread serialises CPU so a large project cannot oversubscribe the box.
 * Per-(project,stage) ordering is additionally guaranteed by `withRunLock` in the
 * service. A multi-node setup would swap claimNext's status-flip for a shared queue —
 * the durable rows already make that migration clean.
 */
import { prisma } from '../db/client.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { aiFlagEnabled, getGlobalAiSettings, getProjectAiSettings, runScoring } from './screeningAiService.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';

const debounceTimers = new Map(); // key → Timeout (rescore debounce; in-memory optimisation only)

const keyOf = (projectId, stage) => `${projectId}::${stage}`;

// A running job whose last heartbeat is older than this is treated as abandoned (crash)
// and re-queued at boot. Scoring writes a heartbeat on every progress tick.
const STUCK_MS = 15 * 60 * 1000;
// Bound the claim-race retry so a pathological burst of contention can never loop
// unboundedly (each iteration is a DB round-trip, never a CPU spin).
const MAX_CLAIM_RACES = 1000;

let draining = false;

/** Whether live, decision-triggered rescoring is permitted for a project. */
export async function liveUpdateAllowed(projectId) {
  try {
    if (!(await aiFlagEnabled())) return false;
    const g = await getGlobalAiSettings();
    if (!g.enabled || g.liveUpdateEnabled === false) return false; // enabled already respects killSwitch
    const project = await prisma.screenProject.findUnique({ where: { id: projectId } });
    if (!project) return false;
    return !!getProjectAiSettings(project, g).enabled;
  } catch { return false; }
}

/** Atomically claim the oldest queued job (queued → running), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.screenAiJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    // attempts++ on every claim so boot recovery can cap retries of a job that crashes
    // mid-run (poison pill) instead of re-queuing it forever.
    const claim = await prisma.screenAiJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.screenAiJob.findUnique({ where: { id: next.id } });
    // lost the race → try the next queued job
  }
  return null;
}

/** Process one claimed job end-to-end. Never throws into the drain loop. */
async function processJob(job) {
  const startMs = (job.startedAt ? new Date(job.startedAt) : new Date()).getTime();
  try {
    // Rescore jobs honour the live-update governance gate at run time (it may have been
    // disabled between enqueue and claim); manual runs proceed if AI is enabled at all.
    if (job.kind === 'rescore' && !(await liveUpdateAllowed(job.projectId))) {
      await prisma.screenAiJob.update({
        where: { id: job.id },
        data: { status: 'superseded', reason: 'live update disabled', completedAt: new Date() },
      }).catch(() => {});
      return;
    }
    const actor = job.createdById
      ? { id: job.createdById, name: job.createdByName || '' }
      : { id: 'system', name: 'auto-rescore' };

    let lastPatch = 0;
    const out = await runScoring({
      projectId: job.projectId,
      stage: job.stage,
      actor,
      trigger: job.trigger === 'manual' ? 'manual' : 'auto',
      onProgress: ({ processed = 0, total = 0 } = {}) => {
        const now = Date.now();
        if (now - lastPatch < 750) return; // throttle progress writes
        lastPatch = now;
        prisma.screenAiJob.update({
          where: { id: job.id },
          data: { processed: processed | 0, total: total | 0, heartbeatAt: new Date() },
        }).catch(() => {});
      },
    });

    await prisma.screenAiJob.update({
      where: { id: job.id },
      data: {
        status: 'completed', runId: out.run.id, nScored: out.scoredCount,
        processed: out.scoredCount, total: out.scoredCount,
        completedAt: new Date(), durationMs: Date.now() - startMs,
      },
    });
    emitToProjectMembers(job.projectId, { type: 'ai.updated' });
  } catch (e) {
    await prisma.screenAiJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        reason: String(e && e.message ? e.message : e).slice(0, 300),
        completedAt: new Date(), durationMs: Date.now() - startMs,
      },
    }).catch(() => {});
  }
}

/** Drain the queue: claim + process jobs one at a time until empty. */
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
    console.error('[ai-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickAiWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/**
 * enqueueManualRun — durable replacement for the old synchronous `await runScoring` in
 * the HTTP handler. Returns the queued (or already-active) ScreenAiJob immediately. If a
 * job is already queued/running for this (project,stage) it is REUSED (no duplicate heavy
 * job), which also prevents an impatient double-click from starting two runs.
 */
export async function enqueueManualRun(projectId, { stage = 'title_abstract', actor } = {}) {
  const existing = await prisma.screenAiJob.findFirst({
    where: { projectId, stage, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) { kickAiWorker(); return existing; }
  const job = await prisma.screenAiJob.create({
    data: {
      projectId, stage, kind: 'train', status: 'queued', trigger: 'manual',
      createdById: actor?.id || null, createdByName: actor?.name || actor?.email || '',
    },
  });
  kickAiWorker();
  return job;
}

/** Coalesce: reuse an existing queued rescore for this key, else create one. */
async function ensureRescoreJob(projectId, stage, actor) {
  const existing = await prisma.screenAiJob.findFirst({
    where: { projectId, stage, kind: 'rescore', status: 'queued' },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    await prisma.screenAiJob.update({ where: { id: existing.id }, data: { coalesced: { increment: 1 } } }).catch(() => {});
    return existing;
  }
  return prisma.screenAiJob.create({
    data: {
      projectId, stage, kind: 'rescore', status: 'queued', trigger: 'decision',
      createdById: actor?.id || null, createdByName: actor?.name || '',
    },
  });
}

/**
 * scheduleRescore — debounce + enqueue a durable rescore for a project/stage. Fire-and-
 * forget; safe to call on every decision. The debounce window coalesces bursts into a
 * single queued job. Crash-safe: the queued row survives a restart and is drained at boot.
 */
export function scheduleRescore(projectId, { stage = 'title_abstract', actor, debounceMs } = {}) {
  if (!projectId) return;
  const key = keyOf(projectId, stage);
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);
  const fire = () => {
    debounceTimers.delete(key);
    liveUpdateAllowed(projectId)
      .then(ok => {
        if (ok) return ensureRescoreJob(projectId, stage, actor).then(() => kickAiWorker());
        // Observable why a queued rescore silently stopped (flag off / project gone) — 62.md rec round.
        console.debug?.('[ai-worker] rescore skipped for project %s (AI disabled or project removed)', projectId);
      })
      .catch(e => console.debug?.('[ai-worker] liveUpdateAllowed check failed:', e?.message));
  };
  const wait = Number.isFinite(debounceMs) ? debounceMs : null;
  if (wait != null) {
    const t = setTimeout(fire, wait); if (t.unref) t.unref(); debounceTimers.set(key, t);
    return;
  }
  getGlobalAiSettings()
    .then(g => { const ms = Number.isFinite(g.retrainDebounceMs) ? g.retrainDebounceMs : 4000; const t = setTimeout(fire, ms); if (t.unref) t.unref(); debounceTimers.set(key, t); })
    .catch(() => { const t = setTimeout(fire, 4000); if (t.unref) t.unref(); debounceTimers.set(key, t); });
}

/**
 * getJobStatus — live state for the screening UI: whether a run is running or queued, its
 * progress, and how many include/exclude decisions have landed since the last completed
 * run (the "unprocessed decisions" count). DB-backed (crash-correct).
 */
export async function getJobStatus(projectId, stage = 'title_abstract') {
  const key = keyOf(projectId, stage);
  const [latest, lastCompleted] = await Promise.all([
    prisma.screenAiJob.findFirst({ where: { projectId, stage }, orderBy: { createdAt: 'desc' } }),
    prisma.screenAiJob.findFirst({ where: { projectId, stage, status: 'completed' }, orderBy: { completedAt: 'desc' } }),
  ]);
  const queuedRow = await prisma.screenAiJob.findFirst({ where: { projectId, stage, status: 'queued' }, orderBy: { createdAt: 'asc' } });
  const running = latest?.status === 'running';
  const queued = !!queuedRow || debounceTimers.has(key);
  let pending = 0;
  if (lastCompleted?.completedAt) {
    pending = await prisma.screenDecision.count({
      where: { projectId, stage, decision: { in: ['include', 'exclude'] }, updatedAt: { gt: lastCompleted.completedAt } },
    });
  }
  const progress = running && latest?.total > 0
    ? Math.min(100, Math.round((latest.processed / latest.total) * 100))
    : 0;
  return {
    state: running ? 'updating' : (queued || pending > 0 ? 'queued' : 'idle'),
    running: !!running,
    queued: !!queued,
    pending,
    jobId: (running ? latest?.id : queuedRow?.id) || null,
    kind: running ? latest?.kind : (queuedRow?.kind || null),
    processed: running ? (latest?.processed || 0) : 0,
    total: running ? (latest?.total || 0) : 0,
    progress,
    lastCompletedAt: lastCompleted?.completedAt || null,
    lastStatus: latest?.status || null,
    lastReason: latest?.status === 'failed' ? latest.reason : '',
  };
}

/**
 * recoverStuckAiJobs — re-queue jobs left `running` by a crash (boot recovery). A job
 * whose retry budget is spent (attempts ≥ cap — a poison pill) is permanently FAILED
 * instead of re-queued so it can never loop across restarts. Pure DB work (does NOT kick
 * the drain), so it is unit-testable in isolation. Returns { requeued, failed }.
 */
export async function recoverStuckAiJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = now - STUCK_MS;
  const running = await prisma.screenAiJob.findMany({
    where: { status: 'running' },
    select: { id: true, attempts: true, heartbeatAt: true, startedAt: true },
  });
  const stuck = running.filter(j => {
    const last = j.heartbeatAt || j.startedAt;
    return !last || new Date(last).getTime() < cutoff;
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) {
    await prisma.screenAiJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        reason: `Scoring stopped after ${maxAttempts} interrupted attempts.`,
        completedAt: new Date(),
      },
    }).catch(() => {});
  }
  if (retry.length) {
    await prisma.screenAiJob.updateMany({
      where: { id: { in: retry.map(j => j.id) } },
      data: { status: 'queued', startedAt: null, heartbeatAt: null },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

// Terminal AI-job rows older than this are pruned at boot. The decision-triggered
// rescorer appends a row per coalesced burst, so without pruning the table grows
// unbounded over a project's life (62.md rec round). 30-day default keeps recent history
// for observability; tunable via env.
const JOB_RETENTION_MS = (Number(process.env.AI_JOB_RETENTION_HOURS) || 720) * 60 * 60 * 1000;

/**
 * cleanupOldAiJobs — prune terminal (completed/failed/superseded/cancelled) job rows older
 * than the retention window. Never touches queued/running rows. Pure DB; returns the count.
 */
export async function cleanupOldAiJobs(now = Date.now()) {
  const cutoff = new Date(now - JOB_RETENTION_MS);
  const res = await prisma.screenAiJob.deleteMany({
    where: { status: { in: ['completed', 'failed', 'superseded', 'cancelled'] }, createdAt: { lt: cutoff } },
  });
  return res.count;
}

/**
 * startAiJobsWorker — boot hook. Recovers any job left `running` by a crash (re-queue
 * under the retry cap, permanently fail over it), prunes old terminal rows, then drains.
 * Idempotent.
 */
export async function startAiJobsWorker() {
  try {
    const { requeued, failed } = await recoverStuckAiJobs();
    if (requeued) console.log(`[ai-worker] re-queued ${requeued} stuck AI job(s)`);
    if (failed) console.warn(`[ai-worker] failed ${failed} AI job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
    const pruned = await cleanupOldAiJobs();
    if (pruned) console.log(`[ai-worker] pruned ${pruned} old AI job row(s)`);
  } catch (e) {
    console.error('[ai-worker] startup requeue failed:', e?.message);
  }
  kickAiWorker();
}

/** Test-only: clear in-memory debounce state. */
export function _resetJobs() { for (const t of debounceTimers.values()) clearTimeout(t); debounceTimers.clear(); }
