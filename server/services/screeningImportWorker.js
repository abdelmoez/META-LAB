/**
 * screeningImportWorker.js — prompt50 WS2.
 *
 * In-process, DB-backed worker that drains queued ScreenImportJob rows. This is
 * the "safest durable alternative that fits the architecture" (single Node
 * process + SQLite, no Redis/Bull): the job + its source content live in the DB,
 * so the browser need not keep the import dialog open, and a process restart
 * resumes any unfinished work (startImportWorker re-queues stuck jobs at boot).
 *
 * Concurrency: one job is claimed at a time via an atomic status flip
 * (queued → processing), so two overlapping drains can never double-process a
 * job. Progress is written back to the row (observable by polling
 * GET …/import/jobs/:id); a single import.completed poke nudges other sessions
 * to refresh once records land.
 */
import { prisma } from '../db/client.js';
import { getMetaSiftSettings } from '../screening/settings.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { touchProjectActivity } from '../store.js';
import {
  parseImportContent,
  dedupeAndInsertRecords,
  DEFAULT_MAX_RECORDS_PER_PROJECT,
} from './screeningImportService.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';

// A job claimed but not finished within this window (e.g. a crash mid-import) is
// considered abandoned and re-queued at boot so it can resume.
const STUCK_MS = 10 * 60 * 1000;

// Bound the claim-race retry so a pathological burst of contention can never
// recurse/loop unboundedly. Each iteration is a DB round-trip (never a CPU spin);
// this is a hard backstop, not the common path (one drain runs at a time).
const MAX_CLAIM_RACES = 1000;

let draining = false;

/** Patch a job row; never throws into the worker loop. */
async function patch(jobId, data) {
  try { await prisma.screenImportJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Mark a job failed with a user-facing message. */
async function fail(jobId, message) {
  await patch(jobId, {
    status: 'failed', stage: 'failed',
    error: String(message || 'Import failed').slice(0, 1000),
    content: '', completedAt: new Date(),
  });
}

/** Atomically claim the oldest queued job (queued → processing), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.screenImportJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    // attempts++ on every claim so the boot recovery can cap retries of a job
    // that crashes mid-import instead of re-queuing it forever (poison pill).
    const claim = await prisma.screenImportJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'processing', stage: 'parsing', startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.screenImportJob.findUnique({ where: { id: next.id } });
    // lost the race (another drain claimed it first) → try the next queued job
  }
  return null; // extreme contention; the next kick resumes draining
}

/** Process a single claimed job end-to-end. */
async function processJob(job) {
  try {
    // Detect + parse (BOM-tolerant; explicit format or auto-detect).
    const { records, detectedFormat } = parseImportContent(job.content, { format: job.format, filename: job.filename });
    await patch(job.id, { stage: 'deduplicating', detectedFormat, totalRecords: records.length });
    if (!records.length) { await fail(job.id, 'No records were found in the file. Check the format and try again.'); return; }

    const settings = await getMetaSiftSettings();
    const maxRecords = Number(settings.maxRecordsPerProject) > 0 ? Number(settings.maxRecordsPerProject) : DEFAULT_MAX_RECORDS_PER_PROJECT;

    await patch(job.id, { stage: 'saving' });
    const result = await dedupeAndInsertRecords(job.projectId, records, {
      format: detectedFormat, filename: job.filename,
      fileHash: job.fileHash, fileSize: job.fileSize,
      importedById: job.createdById, importedByName: job.createdByName, parser: detectedFormat,
      maxRecords,
      onProgress: async ({ imported }) => {
        await patch(job.id, { processedRecords: imported, importedRecords: imported });
      },
    });

    await patch(job.id, {
      stage: 'done',
      status: result.rejected > 0 ? 'completed_with_warnings' : 'completed',
      processedRecords: result.keptCount,
      importedRecords: result.imported,
      duplicateRecords: result.skippedDuplicates,
      rejectedRecords: result.rejected,
      warningCount: result.rejected,
      batchId: result.batchId,
      content: '',
      completedAt: new Date(),
    });

    // Cross-workstream activity + a single completion poke so other sessions refresh.
    const sp = await prisma.screenProject.findUnique({ where: { id: job.projectId }, select: { linkedMetaLabProjectId: true } });
    if (sp && result.imported > 0) await touchProjectActivity(sp.linkedMetaLabProjectId);
    emitToProjectMembers(job.projectId, { type: 'import.completed', jobId: job.id }, { exclude: job.createdById });
  } catch (e) {
    if (e && e.code === 'CAPACITY') { await fail(job.id, e.message); return; }
    console.error('[import-worker] processJob:', e?.message);
    await fail(job.id, e?.message || 'Import failed unexpectedly.');
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
    console.error('[import-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing a job). Idempotent / non-blocking. */
export function kickImportWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/**
 * Recover jobs left 'processing' by a crash. A job whose retry budget is spent
 * (attempts ≥ cap — a poison pill that keeps crashing) is permanently FAILED
 * instead of re-queued, so it can never loop across restarts; the rest are
 * re-queued to resume. Pure DB work — does NOT kick the drain, so it can be
 * tested in isolation. Returns a { requeued, failed } summary.
 */
export async function recoverStuckImportJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = new Date(now - STUCK_MS);
  const stuck = await prisma.screenImportJob.findMany({
    where: { status: 'processing', OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }] },
    select: { id: true, attempts: true },
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) {
    await fail(job.id, `Import stopped after ${maxAttempts} failed attempts — a record or the file repeatedly interrupted processing.`);
  }
  if (retry.length) {
    await prisma.screenImportJob.updateMany({
      where: { id: { in: retry.map((j) => j.id) } },
      data: { status: 'queued', stage: 'queued' },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

/**
 * startImportWorker — boot hook. Recovers any job left 'processing' by a crash
 * (re-queue under the retry cap, permanently fail over it), then drains the
 * queue. Idempotent.
 */
export async function startImportWorker() {
  try {
    const { requeued, failed } = await recoverStuckImportJobs();
    if (requeued) console.log(`[import-worker] re-queued ${requeued} stuck import job(s)`);
    if (failed) console.warn(`[import-worker] failed ${failed} import job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[import-worker] startup requeue failed:', e?.message);
  }
  kickImportWorker();
}
