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

// A job claimed but not finished within this window (e.g. a crash mid-import) is
// considered abandoned and re-queued at boot so it can resume.
const STUCK_MS = 10 * 60 * 1000;

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
  const next = await prisma.screenImportJob.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return null;
  const claim = await prisma.screenImportJob.updateMany({
    where: { id: next.id, status: 'queued' },
    data: { status: 'processing', stage: 'parsing', startedAt: new Date() },
  });
  if (claim.count !== 1) return claimNext(); // lost the race → try the next one
  return prisma.screenImportJob.findUnique({ where: { id: next.id } });
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
 * startImportWorker — boot hook. Re-queues any job left 'processing' by a crash
 * (older than STUCK_MS) so it resumes, then drains the queue. Idempotent.
 */
export async function startImportWorker() {
  try {
    const cutoff = new Date(Date.now() - STUCK_MS);
    const requeued = await prisma.screenImportJob.updateMany({
      where: { status: 'processing', OR: [{ startedAt: null }, { startedAt: { lt: cutoff } }] },
      data: { status: 'queued', stage: 'queued' },
    });
    if (requeued.count) console.log(`[import-worker] re-queued ${requeued.count} stuck import job(s)`);
  } catch (e) {
    console.error('[import-worker] startup requeue failed:', e?.message);
  }
  kickImportWorker();
}
