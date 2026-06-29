/**
 * screeningExportWorker.js — durable, DB-backed async EXPORT worker (62.md).
 *
 * The old GET /export ran k-fold cross-validation AND buffered the whole CSV in memory
 * inside the HTTP request, freezing the single Node event loop and 504-ing on large
 * projects. This worker mirrors screeningImportWorker: a request only enqueues a
 * ScreenExportJob (queued) + returns a jobId; this in-process drain claims the job off
 * the event loop, computes capped CV in a worker_thread, STREAMS rows to a file (bounded
 * memory), and the client polls status then downloads the finished file. Crash-safe: a
 * job left `processing` by a crash is re-queued at boot under a retry cap (poison-pill
 * guard via server/utils/jobRetry.js); finished files older than the TTL are reaped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../db/client.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';
import {
  computeExportCvScores, streamExportToSink, exportContentType,
} from './screeningExportService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same convention as screeningPdfController: server/storage/<subdir>.
export const EXPORT_DIR = path.join(__dirname, '..', 'storage', 'exports');

// A processing job whose last heartbeat is older than this is treated as abandoned (crash).
const STUCK_MS = 15 * 60 * 1000;
// Finished export files older than this are deleted (the row stays for history; resultPath
// is blanked so download cleanly 404s). Tunable via env.
const RESULT_TTL_MS = (Number(process.env.EXPORT_RESULT_TTL_HOURS) || 24) * 60 * 60 * 1000;
const MAX_CLAIM_RACES = 1000;

let draining = false;

function ensureDir() { try { fs.mkdirSync(EXPORT_DIR, { recursive: true }); } catch { /* best-effort */ } }

/** Patch a job row; never throws into the worker loop. */
async function patch(jobId, data) {
  try { await prisma.screenExportJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Mark a job failed with a user-facing message. */
async function fail(jobId, message) {
  await patch(jobId, {
    status: 'failed', stage: 'failed',
    error: String(message || 'Export failed').slice(0, 1000),
    completedAt: new Date(),
  });
}

/** A file sink with awaited, backpressure-aware writes. */
function makeFileSink(filePath) {
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  const write = (chunk) => new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()));
  });
  const close = () => new Promise((resolve, reject) => {
    stream.end((err) => (err ? reject(err) : resolve()));
  });
  return { write, close };
}

/** Atomically claim the oldest queued export job (queued → processing), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.screenExportJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    const claim = await prisma.screenExportJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'processing', stage: 'loading', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.screenExportJob.findUnique({ where: { id: next.id } });
  }
  return null;
}

/** Process one claimed export job end-to-end. Never throws into the drain loop. */
async function processJob(job) {
  ensureDir();
  const { ext } = exportContentType(job.format);
  const filePath = path.join(EXPORT_DIR, `${job.id}.${ext}`);
  const filename = `sift-export-${String(job.projectId).slice(0, 8)}-${String(job.id).slice(0, 8)}.${ext}`;
  try {
    const total = await prisma.screenRecord.count({ where: { projectId: job.projectId } });
    await patch(job.id, { totalRecords: total, heartbeatAt: new Date() });

    // Capped CV, OFF the event loop (worker_thread). Above the cap it returns blank with a
    // status so the export stays fast and the CSV schema is unchanged (62.md RC-1).
    await patch(job.id, { stage: 'cvscoring', heartbeatAt: new Date() });
    const cv = job.includeAiCv
      ? await computeExportCvScores(job.projectId)
      : { meta: { scoreType: '', status: 'disabled', reason: 'AI columns not requested' }, byRecordId: new Map(), generatedAt: new Date().toISOString() };

    await patch(job.id, { stage: 'rendering', cvStatus: cv.meta?.status || '', heartbeatAt: new Date() });
    const sink = makeFileSink(filePath);
    let lastPatch = 0;
    const result = await streamExportToSink({
      projectId: job.projectId, userId: job.createdById,
      format: job.format, filter: job.filter, cv,
      write: sink.write,
      onProgress: async ({ processed }) => {
        const now = Date.now();
        if (now - lastPatch < 750) return; // throttle progress writes
        lastPatch = now;
        await patch(job.id, { processedRecords: processed, heartbeatAt: new Date() });
      },
    });
    await sink.close();

    let bytes = 0;
    try { bytes = fs.statSync(filePath).size; } catch { /* leave 0 */ }
    await patch(job.id, {
      status: 'completed', stage: 'done',
      processedRecords: result.processed, totalRecords: result.total,
      resultPath: filePath, resultBytes: bytes, filename,
      cvStatus: result.cvStatus, completedAt: new Date(),
    });
    emitToProjectMembers(job.projectId, { type: 'export.completed', jobId: job.id }, { exclude: job.createdById });
  } catch (e) {
    try { fs.unlinkSync(filePath); } catch { /* may not exist */ }
    console.error('[export-worker] processJob:', e?.message);
    await fail(job.id, e?.message || 'Export failed unexpectedly.');
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
    console.error('[export-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickExportWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/**
 * enqueueExportJob — create (or reuse) a queued export job. A queued/processing job with
 * the same (project, user, format, filter) is REUSED so a double-click can't spawn two
 * heavy exports. Returns the job row immediately.
 */
export async function enqueueExportJob(projectId, { createdById, createdByName = '', format = 'csv', filter = 'all', includeAiCv = true } = {}) {
  const existing = await prisma.screenExportJob.findFirst({
    where: { projectId, createdById, format, filter, status: { in: ['queued', 'processing'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) { kickExportWorker(); return existing; }
  const job = await prisma.screenExportJob.create({
    data: { projectId, createdById, createdByName, format, filter, includeAiCv, status: 'queued', stage: 'queued' },
  });
  kickExportWorker();
  return job;
}

/**
 * recoverStuckExportJobs — re-queue jobs left `processing` by a crash (boot recovery).
 * A job whose retry budget is spent (poison pill) is permanently FAILED. Pure DB work
 * (does NOT kick the drain) so it is unit-testable in isolation.
 */
export async function recoverStuckExportJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = now - STUCK_MS;
  const processing = await prisma.screenExportJob.findMany({
    where: { status: 'processing' },
    select: { id: true, attempts: true, heartbeatAt: true, startedAt: true },
  });
  const stuck = processing.filter(j => {
    const last = j.heartbeatAt || j.startedAt;
    return !last || new Date(last).getTime() < cutoff;
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) await fail(job.id, `Export stopped after ${maxAttempts} interrupted attempts.`);
  if (retry.length) {
    await prisma.screenExportJob.updateMany({
      where: { id: { in: retry.map(j => j.id) } },
      data: { status: 'queued', stage: 'queued', startedAt: null, heartbeatAt: null },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

/**
 * cleanupOldExports — delete finished export FILES older than the TTL and blank their
 * resultPath (the row stays for history; download then cleanly 404s). Pure DB+fs work.
 */
export async function cleanupOldExports(now = Date.now()) {
  const cutoff = new Date(now - RESULT_TTL_MS);
  const old = await prisma.screenExportJob.findMany({
    where: { status: { in: ['completed', 'failed', 'cancelled'] }, completedAt: { lt: cutoff }, NOT: { resultPath: '' } },
    select: { id: true, resultPath: true },
  });
  if (!old.length) return 0;
  for (const j of old) { if (j.resultPath) { try { fs.unlinkSync(j.resultPath); } catch { /* gone */ } } }
  await prisma.screenExportJob.updateMany({ where: { id: { in: old.map(j => j.id) } }, data: { resultPath: '' } });
  return old.length;
}

/**
 * startExportWorker — boot hook. Recovers crash-interrupted jobs (re-queue under the
 * retry cap), reaps expired files, then drains. Idempotent.
 */
export async function startExportWorker() {
  try {
    const { requeued, failed } = await recoverStuckExportJobs();
    if (requeued) console.log(`[export-worker] re-queued ${requeued} stuck export job(s)`);
    if (failed) console.warn(`[export-worker] failed ${failed} export job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
    const cleaned = await cleanupOldExports();
    if (cleaned) console.log(`[export-worker] reaped ${cleaned} expired export file(s)`);
  } catch (e) {
    console.error('[export-worker] startup failed:', e?.message);
  }
  kickExportWorker();
}
