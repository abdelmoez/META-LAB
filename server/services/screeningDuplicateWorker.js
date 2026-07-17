/**
 * screeningDuplicateWorker.js — durable, DB-backed duplicate-detection worker (92.md).
 *
 * The old POST /duplicates/detect ran the whole O(n²) Levenshtein sweep synchronously
 * inside the HTTP request: ~30s of frozen event loop at 500 records, ~8 minutes at
 * 2,000 (measured) — the entire platform became unresponsive for every user. It also
 * persisted groups with one findFirst+create+updateMany+update per group (N+1, no
 * transaction) and had no idempotency guard, so a double click raced two full sweeps.
 *
 * This worker mirrors screeningImportWorker/screeningExportWorker (the established
 * durable pattern here: single Node process + DB rows as the queue, no new infra):
 *   - the request only enqueues a ScreenDuplicateJob and returns 202 + the job;
 *   - ONE active (queued|processing) job per project (enqueue reuses it — button
 *     double-clicks and simultaneous starts by two members attach to the same job);
 *   - the drain claims jobs atomically (queued→processing + attempts++), processes
 *     them one at a time with cooperative yields (setImmediate) so the event loop
 *     stays free, and patches REAL progress counters the UI polls;
 *   - crash recovery: heartbeat-stale processing jobs are re-queued at boot under
 *     the shared retry cap (jobRetry.js poison-pill guard);
 *   - cancellation: `cancelRequested` is honoured at every progress beat and between
 *     save batches — every group already persisted is complete and valid.
 *
 * Matching itself lives in the PURE engine (research-engine/screening/
 * duplicateDetectionEngine.js): normalize-once, exact DOI/PMID union-find, blocked
 * fuzzy candidates, banded early-exit Levenshtein.
 *
 * Data-integrity rules (92.md):
 *   - members of RESOLVED groups are FROZEN — excluded from detection entirely, so a
 *     reviewer's merge/keep-all decision is never overwritten;
 *   - reviewer-labelled not_duplicate pairs are never linked directly again;
 *   - existing UNRESOLVED groups are pre-unioned, so re-detection EXTENDS them
 *     (never duplicates them) — reruns on unchanged data are exact no-ops;
 *   - nothing is ever deleted or auto-merged: detection only creates/extends
 *     suggestion groups and flags non-primary members, exactly like before.
 */
import { prisma } from '../db/client.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { touchProjectActivity } from '../store.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';
import { detectDuplicateGroups, pairKey } from '../../src/research-engine/screening/duplicateDetectionEngine.js';
import { planGroupWrites } from '../../src/research-engine/screening/duplicateGroupPlan.js';
import { pickBulkPrimary } from '../../src/research-engine/screening/deduplication.js';

// ── Configurable limits (env-tunable; sane defaults for a single-node deploy) ──
const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
export const DUP_CFG = Object.freeze({
  // A processing job whose last heartbeat is older than this is treated as crashed.
  STUCK_MS: num(process.env.SCREEN_DUP_STUCK_MS, 10 * 60 * 1000),
  // Chunk size for cursor-paginated record reads (bounded memory per query).
  READ_BATCH: num(process.env.SCREEN_DUP_READ_BATCH, 1000),
  // Duplicate groups persisted per transaction batch.
  SAVE_BATCH: num(process.env.SCREEN_DUP_SAVE_BATCH, 25),
  // Blocking-bucket size cap + global fuzzy comparison cap (engine safeguards).
  MAX_BLOCK: num(process.env.SCREEN_DUP_MAX_BLOCK, 400),
  MAX_COMPARISONS: num(process.env.SCREEN_DUP_MAX_COMPARISONS, 2_000_000),
  // Cooperative yield cadence inside the engine (candidate pairs per event-loop release).
  YIELD_EVERY: num(process.env.SCREEN_DUP_YIELD_EVERY, 2000),
  // Progress/heartbeat write throttle.
  PROGRESS_MS: num(process.env.SCREEN_DUP_PROGRESS_MS, 750),
});

const MAX_CLAIM_RACES = 1000;

let draining = false;

class JobCancelledError extends Error {
  constructor() { super('cancelled'); this.name = 'JobCancelledError'; }
}

const yieldLoop = () => new Promise((resolve) => setImmediate(resolve));

/** Patch a job row; never throws into the worker loop. */
async function patch(jobId, data) {
  try { await prisma.screenDuplicateJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Mark a job failed with a user-facing message (details stay in server logs). */
async function fail(jobId, message) {
  await patch(jobId, {
    status: 'failed', stage: 'failed',
    error: String(message || 'Duplicate detection failed').slice(0, 1000),
    completedAt: new Date(),
  });
}

/** Atomically claim the oldest queued job (queued → processing), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.screenDuplicateJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    const claim = await prisma.screenDuplicateJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'processing', stage: 'preparing', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.screenDuplicateJob.findUnique({ where: { id: next.id } });
    // lost the race (another drain claimed it, or it was cancelled) → next job
  }
  return null;
}

/**
 * makeBeat — throttled progress writer + cancellation check, shared by every stage.
 * Reads the job row at most once per PROGRESS_MS; throws JobCancelledError when a
 * cancel was requested (or the row vanished — project deleted mid-run).
 */
function makeBeat(jobId) {
  let last = 0;
  let pending = {};
  const beat = async (data = {}, { force = false } = {}) => {
    Object.assign(pending, data);
    const now = Date.now();
    if (!force && now - last < DUP_CFG.PROGRESS_MS) return;
    last = now;
    const row = await prisma.screenDuplicateJob.findUnique({
      where: { id: jobId }, select: { cancelRequested: true, status: true },
    }).catch(() => null);
    if (!row || row.cancelRequested || row.status === 'cancelled') throw new JobCancelledError();
    await patch(jobId, { ...pending, heartbeatAt: new Date() });
    pending = {};
  };
  return beat;
}

/** Load every record of the project in id-ordered chunks, skipping frozen ids. */
async function loadRecords(job, frozenIds, beat) {
  const records = [];
  let cursor = null;
  for (;;) {
    const page = await prisma.screenRecord.findMany({
      where: { projectId: job.projectId },
      select: { id: true, title: true, doi: true, pmid: true, year: true },
      orderBy: { id: 'asc' },
      take: DUP_CFG.READ_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const r of page) if (!frozenIds.has(r.id)) records.push(r);
    await beat({ processedRecords: records.length });
    await yieldLoop();
    if (page.length < DUP_CFG.READ_BATCH) break;
  }
  return records;
}

/** Persist one batch of plans inside a single transaction. Returns counters. */
async function applyPlanBatch(job, batch) {
  const counters = { groupsCreated: 0, groupsUpdated: 0, recordsFlagged: 0 };
  // Load full metadata for primary selection + previous-flag accounting, one query.
  const allIds = [...new Set(batch.flatMap((p) => p.members))];
  const rows = await prisma.screenRecord.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true, title: true, abstract: true, doi: true, pmid: true, authors: true,
      year: true, journal: true, createdAt: true, isPrimary: true, isDuplicate: true,
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  await prisma.$transaction(async (tx) => {
    for (const plan of batch) {
      const memberRecs = plan.members.map((id) => byId.get(id)).filter(Boolean);
      if (memberRecs.length < 2) continue; // records vanished mid-run — skip safely

      let groupId = plan.targetId;
      if (plan.kind === 'create') {
        const g = await tx.screenDuplicateGroup.create({ data: { projectId: job.projectId } });
        groupId = g.id;
        counters.groupsCreated += 1;
      } else {
        counters.groupsUpdated += 1;
      }

      // Membership: point every member at the group (absorbed groups' members repoint too).
      await tx.screenRecord.updateMany({
        where: { id: { in: plan.members } },
        data: { duplicateGroupId: groupId },
      });
      if (plan.kind === 'extend' && plan.absorbedGroupIds?.length) {
        // Anything still pointing at an absorbed group (defensive) follows, then the
        // emptied suggestion rows are removed.
        await tx.screenRecord.updateMany({
          where: { duplicateGroupId: { in: plan.absorbedGroupIds } },
          data: { duplicateGroupId: groupId },
        });
        await tx.screenDuplicateGroup.deleteMany({ where: { id: { in: plan.absorbedGroupIds }, projectId: job.projectId } });
      }

      // Exactly one tentative primary per group: keep the TARGET group's existing
      // primary (a reviewer may have radio-selected it) — never an absorbed group's —
      // otherwise the deterministic most-complete record (pickBulkPrimary).
      const existingPrimary = plan.kind === 'extend' && plan.targetPrimaryId
        ? memberRecs.find((r) => r.id === plan.targetPrimaryId)
        : null;
      const primary = existingPrimary || pickBulkPrimary(memberRecs) || memberRecs[0];
      const others = plan.members.filter((id) => id !== primary.id);
      await tx.screenRecord.updateMany({
        where: { id: { in: others } },
        data: { isDuplicate: true, isPrimary: false },
      });
      await tx.screenRecord.update({
        where: { id: primary.id },
        data: { isDuplicate: false, isPrimary: true },
      });
      counters.recordsFlagged += plan.members.reduce(
        (n, id) => n + (id !== primary.id && byId.get(id) && !byId.get(id).isDuplicate ? 1 : 0), 0,
      );
    }
  });
  return counters;
}

/** Process a single claimed job end-to-end. */
async function processJob(job) {
  const beat = makeBeat(job.id);
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  const durations = {};
  const mark = (stage, since) => { durations[stage] = Date.now() - since; return Date.now(); };
  let stageStart = t0;
  try {
    // ── preparing: totals + protections ──
    const totalAll = await prisma.screenRecord.count({ where: { projectId: job.projectId } });
    const existingGroups = await prisma.screenDuplicateGroup.findMany({
      where: { projectId: job.projectId },
      select: { id: true, resolvedAt: true, createdAt: true, records: { select: { id: true, isPrimary: true } } },
    });
    const frozenIds = new Set();
    const openGroups = [];
    for (const g of existingGroups) {
      if (g.resolvedAt) for (const r of g.records) frozenIds.add(r.id);
      else openGroups.push(g);
    }
    const notDup = await prisma.screenDuplicateLabel.findMany({
      where: { projectId: job.projectId, label: 'not_duplicate' },
      select: { recordIdA: true, recordIdB: true },
    });
    const excludedPairs = new Set(notDup.map((l) => pairKey(l.recordIdA, l.recordIdB)));
    await beat({ stage: 'preparing', totalRecords: Math.max(0, totalAll - frozenIds.size) }, { force: true });
    stageStart = mark('preparing', stageStart);

    // ── normalizing: chunked load (cursor-paginated, memory-bounded queries) ──
    await beat({ stage: 'normalizing' }, { force: true });
    const records = await loadRecords(job, frozenIds, beat);
    await beat({ totalRecords: records.length, processedRecords: records.length });
    stageStart = mark('load', stageStart);

    // ── engine: exact + blocked fuzzy matching, cooperatively yielding ──
    const result = await detectDuplicateGroups(records, {
      maxBlockSize: DUP_CFG.MAX_BLOCK,
      maxComparisons: DUP_CFG.MAX_COMPARISONS,
      yieldEvery: DUP_CFG.YIELD_EVERY,
      excludedPairs,
      preUnion: openGroups.map((g) => g.records.map((r) => r.id)),
      yieldFn: yieldLoop,
      onProgress: async (p) => {
        await beat({
          stage: p.stage,
          groupsFound: p.groupsFound || 0,
          ...(p.stage === 'fuzzy' ? { comparisonsDone: p.comparisonsDone || p.done || 0, comparisonsTotal: p.comparisonsTotal || p.total || 0 } : {}),
        });
      },
    });
    stageStart = mark('match', stageStart);

    // ── grouping: map the partition onto existing rows ──
    await beat({
      stage: 'grouping',
      groupsFound: result.groups.length,
      comparisonsDone: result.stats.comparisonsIterated,
      comparisonsTotal: result.stats.comparisonsPlanned,
      exactMatches: result.stats.exactPairsLinked,
      fuzzyMatches: result.stats.fuzzyPairsLinked,
    }, { force: true });
    const plans = planGroupWrites(result.groups, openGroups);
    stageStart = mark('grouping', stageStart);

    // ── saving: transactional batches; cancel-safe between batches ──
    await beat({ stage: 'saving' }, { force: true });
    let saved = 0;
    const totals = { groupsCreated: 0, groupsUpdated: 0, recordsFlagged: 0 };
    for (let i = 0; i < plans.length; i += DUP_CFG.SAVE_BATCH) {
      const batch = plans.slice(i, i + DUP_CFG.SAVE_BATCH);
      const c = await applyPlanBatch(job, batch);
      totals.groupsCreated += c.groupsCreated;
      totals.groupsUpdated += c.groupsUpdated;
      totals.recordsFlagged += c.recordsFlagged;
      saved += batch.length;
      await beat({ savedGroups: saved, ...totals });
      await yieldLoop();
    }
    stageStart = mark('save', stageStart);

    // ── finalizing ──
    await beat({ stage: 'finalizing', savedGroups: plans.length, ...totals }, { force: true });
    const cpu = process.cpuUsage(cpu0);
    const statsJson = JSON.stringify({
      ...result.stats,
      plans: plans.length,
      durationsMs: { ...durations, total: Date.now() - t0 },
      cpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
    });
    const sp = await prisma.screenProject.findUnique({
      where: { id: job.projectId }, select: { linkedMetaLabProjectId: true },
    }).catch(() => null);
    if (sp && (totals.groupsCreated || totals.groupsUpdated)) await touchProjectActivity(sp.linkedMetaLabProjectId);

    await patch(job.id, {
      status: 'completed', stage: 'done',
      groupsFound: result.groups.length,
      savedGroups: plans.length,
      groupsCreated: totals.groupsCreated,
      groupsUpdated: totals.groupsUpdated,
      recordsFlagged: totals.recordsFlagged,
      exactMatches: result.stats.exactPairsLinked,
      fuzzyMatches: result.stats.fuzzyPairsLinked,
      statsJson,
      completedAt: new Date(),
    });
    console.log(`[dup-worker] completed job=${job.id} project=${job.projectId} n=${records.length} groups=${result.groups.length} created=${totals.groupsCreated} updated=${totals.groupsUpdated} cmp=${result.stats.comparisonsEvaluated}/${result.stats.comparisonsPlanned} in ${Date.now() - t0}ms`);
    // One completion poke so other sessions refresh their duplicate lists; the
    // initiating client is polling the job row already.
    emitToProjectMembers(job.projectId, { type: 'duplicates.completed', jobId: job.id }, { exclude: job.createdById });
  } catch (e) {
    if (e instanceof JobCancelledError) {
      await patch(job.id, {
        status: 'cancelled', stage: 'cancelled', completedAt: new Date(),
        statsJson: JSON.stringify({ cancelled: true, durationsMs: { total: Date.now() - t0 } }),
      });
      console.log(`[dup-worker] cancelled job=${job.id} project=${job.projectId} after ${Date.now() - t0}ms`);
      return;
    }
    console.error(`[dup-worker] processJob job=${job.id} project=${job.projectId}:`, e?.stack || e?.message);
    await fail(job.id, 'Duplicate detection failed unexpectedly. You can safely retry; nothing was corrupted.');
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
    console.error('[dup-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickDuplicateWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/** Await a full drain — for tests that need deterministic completion. */
export async function drainDuplicateJobsForTest() { await drain(); }

/**
 * enqueueDuplicateJob — create (or attach to) the project's single active job.
 * Any queued/processing job for the project is REUSED, so double clicks and two
 * members starting simultaneously converge on one run. A narrow create race is
 * settled deterministically: the OLDEST active job wins, the loser is deleted.
 *
 * @returns {Promise<{ job: object, alreadyRunning: boolean }>}
 */
export async function enqueueDuplicateJob(projectId, { createdById, createdByName = '' } = {}) {
  const ACTIVE = { in: ['queued', 'processing'] };
  const existing = await prisma.screenDuplicateJob.findFirst({
    where: { projectId, status: ACTIVE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (existing) { kickDuplicateWorker(); return { job: existing, alreadyRunning: true }; }

  const job = await prisma.screenDuplicateJob.create({
    data: { projectId, createdById, createdByName, status: 'queued', stage: 'queued' },
  });
  // Settle a simultaneous-create race: both requests re-read and agree the oldest wins.
  const oldest = await prisma.screenDuplicateJob.findFirst({
    where: { projectId, status: ACTIVE },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (oldest && oldest.id !== job.id) {
    // Only delete our row if the worker has not already claimed it.
    await prisma.screenDuplicateJob.deleteMany({ where: { id: job.id, status: 'queued' } }).catch(() => {});
    kickDuplicateWorker();
    return { job: oldest, alreadyRunning: true };
  }
  kickDuplicateWorker();
  return { job, alreadyRunning: false };
}

/**
 * cancelDuplicateJob — request cancellation. A still-queued job is cancelled
 * immediately (atomic guard against a concurrent claim); a processing job gets
 * cancelRequested=true which the worker honours at the next progress beat.
 * Returns the fresh job row, or null when it does not belong to the project.
 */
export async function cancelDuplicateJob(projectId, jobId) {
  const job = await prisma.screenDuplicateJob.findFirst({ where: { id: jobId, projectId } });
  if (!job) return null;
  if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
  const direct = await prisma.screenDuplicateJob.updateMany({
    where: { id: jobId, status: 'queued' },
    data: { status: 'cancelled', stage: 'cancelled', cancelRequested: true, completedAt: new Date() },
  });
  if (direct.count === 0) {
    await prisma.screenDuplicateJob.update({ where: { id: jobId }, data: { cancelRequested: true } }).catch(() => {});
  }
  return prisma.screenDuplicateJob.findUnique({ where: { id: jobId } });
}

/**
 * recoverStuckDuplicateJobs — re-queue heartbeat-stale processing jobs (boot
 * recovery). Over the retry cap → permanently failed (poison-pill guard). Pure
 * DB work (does NOT kick the drain) so it is unit-testable in isolation.
 */
export async function recoverStuckDuplicateJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = now - DUP_CFG.STUCK_MS;
  const processing = await prisma.screenDuplicateJob.findMany({
    where: { status: 'processing' },
    select: { id: true, attempts: true, heartbeatAt: true, startedAt: true },
  });
  const stuck = processing.filter((j) => {
    const last = j.heartbeatAt || j.startedAt;
    return !last || new Date(last).getTime() < cutoff;
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) {
    await fail(job.id, `Duplicate detection stopped after ${maxAttempts} interrupted attempts. Contact an administrator if this keeps happening.`);
  }
  if (retry.length) {
    await prisma.screenDuplicateJob.updateMany({
      where: { id: { in: retry.map((j) => j.id) } },
      data: { status: 'queued', stage: 'queued', startedAt: null, heartbeatAt: null },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

/**
 * startDuplicateWorker — boot hook. Recovers crash-interrupted jobs (re-queue
 * under the retry cap, permanently fail over it), then drains. Idempotent.
 */
export async function startDuplicateWorker() {
  try {
    const { requeued, failed } = await recoverStuckDuplicateJobs();
    if (requeued) console.log(`[dup-worker] re-queued ${requeued} stuck duplicate-detection job(s)`);
    if (failed) console.warn(`[dup-worker] failed ${failed} duplicate-detection job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[dup-worker] startup recovery failed:', e?.message);
  }
  kickDuplicateWorker();
}
