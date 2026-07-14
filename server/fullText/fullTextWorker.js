/**
 * server/fullText/fullTextWorker.js — durable, DB-backed OA full-text retrieval
 * worker (68.md P9). Mirrors the screeningExportWorker 4-part pattern:
 *   claimNext (atomic queued→running) · drain · kickFullTextWorker · recoverStuck.
 *
 * For each record in the job's scope that has NO existing PDF attachment, it runs
 * the configured provider chain in order until one returns status 'found' WITH a
 * pdfUrl, then downloads + attaches it (bounded, hash/URL-deduped) via the shared
 * ScreenPdfAttachment store. EVERY provider outcome is persisted as a
 * FullTextCandidate row (the retrieval audit trail). Counts are honest:
 *   fetched     — a PDF was downloaded + attached this run
 *   alreadyHad  — the record already had a PDF (skipped without a network call)
 *   noOa        — the chain found no OA copy at all
 *   linkOut     — a landing/registry page was found but no downloadable PDF
 *   failed      — a provider errored for every attempt (or the download failed)
 *
 * Crash-safe: a job left `running` past the heartbeat lease is re-queued at boot
 * under the shared retry cap (poison-pill guard, server/utils/jobRetry.js).
 * Politeness: 300ms between records; progress/heartbeat writes throttled to 750ms.
 */
import { prisma } from '../db/client.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';
import { getFullTextSettings, downloadAndAttach } from './fullTextService.js';
import { resolveProviderChain } from './providers.js';

// A running job whose last heartbeat is older than this is treated as crashed.
const STUCK_MS = 15 * 60 * 1000;
const MAX_CLAIM_RACES = 1000;
const RECORD_DELAY_MS = Number(process.env.FULLTEXT_RECORD_DELAY_MS) || 300;
const HEARTBEAT_THROTTLE_MS = 750;

let draining = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Patch a job row; never throws into the worker loop. */
async function patch(jobId, data) {
  try { await prisma.fullTextRetrievalJob.update({ where: { id: jobId }, data }); } catch { /* best-effort */ }
}

/** Mark a job failed with a user-facing message. */
async function fail(jobId, message) {
  await patch(jobId, {
    status: 'failed', stage: 'failed',
    error: String(message || 'Full-text retrieval failed').slice(0, 1000),
    completedAt: new Date(),
  });
}

/**
 * Resolve the record ids in a job's scope.
 *   included → finalStatus === 'accepted'
 *   selected → the explicit recordIds JSON (intersected with the project)
 *   missing  → every record with no ScreenPdfAttachment
 */
async function resolveScopeRecordIds(job) {
  const projectId = job.projectId;
  if (job.scope === 'selected') {
    let ids = [];
    try { const parsed = JSON.parse(job.recordIds || '[]'); if (Array.isArray(parsed)) ids = parsed.map(String); }
    catch { ids = []; }
    if (!ids.length) return [];
    const rows = await prisma.screenRecord.findMany({
      where: { projectId, id: { in: ids } }, select: { id: true },
    });
    return rows.map(r => r.id);
  }
  if (job.scope === 'included') {
    const rows = await prisma.screenRecord.findMany({
      where: { projectId, finalStatus: 'accepted' }, select: { id: true },
    });
    return rows.map(r => r.id);
  }
  // missing: all records with no attachment yet
  const [rows, atts] = await Promise.all([
    prisma.screenRecord.findMany({ where: { projectId }, select: { id: true } }),
    prisma.screenPdfAttachment.findMany({ where: { projectId }, select: { recordId: true } }),
  ]);
  const has = new Set(atts.map(a => a.recordId));
  return rows.filter(r => !has.has(r.id)).map(r => r.id);
}

/** Persist one provider outcome as a FullTextCandidate row (audit trail). */
async function recordCandidate(projectId, recordId, outcome) {
  try {
    await prisma.fullTextCandidate.create({
      data: {
        projectId,
        recordId,
        provider: outcome.provider,
        status: outcome.status,
        oaStatus: outcome.oaStatus || null,
        license: outcome.license || null,
        pdfUrl: outcome.pdfUrl || null,
        landingUrl: outcome.landingUrl || null,
        version: outcome.version || null,
        payload: JSON.stringify(outcome.payload || {}).slice(0, 4000),
        error: outcome.reason ? String(outcome.reason).slice(0, 500) : null,
      },
    });
  } catch { /* candidate log is best-effort */ }
}

/** Process one claimed retrieval job end-to-end. Never throws into the drain loop. */
async function processJob(job) {
  const projectId = job.projectId;
  try {
    const settings = await getFullTextSettings();
    const chain = resolveProviderChain(settings.providerOrder);
    const fetchFn = globalThis.fetch;

    const scopeIds = await resolveScopeRecordIds(job);
    // Records that already have a PDF are counted as alreadyHad and skipped without
    // any network call (never re-fetch what a human already attached).
    const atts = await prisma.screenPdfAttachment.findMany({
      where: { projectId, recordId: { in: scopeIds.length ? scopeIds : ['__none__'] } },
      select: { recordId: true },
    });
    const hasPdf = new Set(atts.map(a => a.recordId));

    const counts = { found: 0, fetched: 0, alreadyHad: 0, noOa: 0, linkOut: 0, failed: 0 };
    const total = scopeIds.length;
    await patch(job.id, { total, processed: 0, counts: JSON.stringify(counts), heartbeatAt: new Date(), stage: 'retrieving' });

    let processed = 0;
    let lastPatch = 0;

    for (const recordId of scopeIds) {
      processed++;
      // Cooperative cancel: if the job was cancelled mid-run, stop cleanly.
      if (processed % 20 === 0) {
        const fresh = await prisma.fullTextRetrievalJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (fresh && fresh.status === 'cancelled') return;
      }

      if (hasPdf.has(recordId)) {
        counts.alreadyHad++;
      } else {
        const record = await prisma.screenRecord.findUnique({
          where: { id: recordId },
          select: { id: true, projectId: true, doi: true, pmid: true, title: true, year: true, sourceDb: true, rawData: true },
        });
        if (!record) { counts.failed++; }
        else {
          let attached = false, sawFound = false, sawLanding = false, allFailed = true;
          for (const { lookup } of chain) {
            // No explicit email here → each provider resolves the polite-pool
            // email from the env chain (UNPAYWALL_EMAIL / PECAN_SEARCH_CONTACT_EMAIL
            // / NCBI_EMAIL) via resolveEmail().
            const outcome = await lookup(record, { fetchFn });
            await recordCandidate(projectId, recordId, outcome);
            if (outcome.status !== 'failed') allFailed = false;
            if (outcome.status === 'found') {
              sawFound = true;
              if (outcome.pdfUrl) {
                const dl = await downloadAndAttach(record, outcome, { fetchFn, settings, userId: job.createdById || 'system' });
                if (dl.ok && !dl.alreadyHad) { counts.fetched++; attached = true; break; }
                if (dl.ok && dl.alreadyHad) { counts.alreadyHad++; attached = true; break; }
                // download failed → keep trying the next provider
              } else if (outcome.landingUrl) {
                sawLanding = true;
              }
            }
          }
          // `found` = a provider returned an OA hit (PDF or landing) for this
          // record — a superset of `fetched` (PDF downloaded) + `linkOut` (only a
          // landing/registry page). The mutually-exclusive per-record buckets are
          // fetched / linkOut / noOa / failed; found is the coverage overlay.
          if (sawFound) counts.found++;
          if (!attached) {
            if (sawFound || sawLanding) counts.linkOut++;   // found a source but no usable PDF
            else if (allFailed) counts.failed++;            // every provider errored
            else counts.noOa++;                             // no OA copy anywhere
          }
        }
        await sleep(RECORD_DELAY_MS); // politeness between records that hit the network
      }

      const now = Date.now();
      if (now - lastPatch >= HEARTBEAT_THROTTLE_MS || processed === total) {
        lastPatch = now;
        await patch(job.id, { processed, counts: JSON.stringify(counts), heartbeatAt: new Date() });
      }
    }

    await patch(job.id, {
      status: 'completed', stage: 'done',
      processed, total, counts: JSON.stringify(counts), completedAt: new Date(),
    });
  } catch (e) {
    console.error('[fulltext-worker] processJob:', e?.message);
    await fail(job.id, e?.message || 'Full-text retrieval failed unexpectedly.');
  }
}

/** Atomically claim the oldest queued job (queued → running), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.fullTextRetrievalJob.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    const claim = await prisma.fullTextRetrievalJob.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', stage: 'starting', startedAt: new Date(), heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.fullTextRetrievalJob.findUnique({ where: { id: next.id } });
  }
  return null;
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
    console.error('[fulltext-worker] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickFullTextWorker() {
  setImmediate(() => { drain().catch(() => {}); });
}

/**
 * enqueueFullTextJob — create (or reuse) a queued retrieval job. A queued/running
 * job with the same (project, scope) is REUSED so a double-click never spawns two
 * retrieval runs. Returns the job row immediately.
 */
export async function enqueueFullTextJob(projectId, { scope = 'included', recordIds = [], createdById = null, createdByName = '' } = {}) {
  const existing = await prisma.fullTextRetrievalJob.findFirst({
    where: { projectId, status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) { kickFullTextWorker(); return existing; }
  const job = await prisma.fullTextRetrievalJob.create({
    data: {
      projectId,
      scope: ['included', 'selected', 'missing'].includes(scope) ? scope : 'included',
      recordIds: JSON.stringify(Array.isArray(recordIds) ? recordIds.slice(0, 2000) : []),
      status: 'queued', stage: 'queued',
      createdById, createdByName,
    },
  });
  kickFullTextWorker();
  return job;
}

/**
 * recoverStuckFullTextJobs — re-queue jobs left `running` by a crash (boot
 * recovery). A job whose retry budget is spent (poison pill) is permanently
 * FAILED. Pure DB work (does NOT kick the drain) so it is unit-testable.
 */
export async function recoverStuckFullTextJobs(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = now - STUCK_MS;
  const running = await prisma.fullTextRetrievalJob.findMany({
    where: { status: 'running' },
    select: { id: true, attempts: true, heartbeatAt: true, startedAt: true },
  });
  const stuck = running.filter(j => {
    const last = j.heartbeatAt || j.startedAt;
    return !last || new Date(last).getTime() < cutoff;
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const job of giveUp) await fail(job.id, `Retrieval stopped after ${maxAttempts} interrupted attempts.`);
  if (retry.length) {
    await prisma.fullTextRetrievalJob.updateMany({
      where: { id: { in: retry.map(j => j.id) } },
      data: { status: 'queued', stage: 'queued', startedAt: null, heartbeatAt: null },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

/**
 * startFullTextWorker — boot hook. Recovers crash-interrupted jobs (re-queue under
 * the retry cap), then drains. Idempotent.
 */
let sweepTimer = null;
export async function startFullTextWorker() {
  try {
    const { requeued, failed } = await recoverStuckFullTextJobs();
    if (requeued) console.log(`[fulltext-worker] re-queued ${requeued} stuck retrieval job(s)`);
    if (failed) console.warn(`[fulltext-worker] failed ${failed} retrieval job(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[fulltext-worker] startup failed:', e?.message);
  }
  // 86.md P1.19 — periodic stuck-job sweep (was boot-only). A job whose worker
  // wedged mid-run (now bounded by the download timeout, but belt-and-suspenders)
  // self-heals within STUCK_MS without a process restart. Heartbeat-staleness based,
  // so it never disturbs an actively-draining job. unref'd → never holds the process.
  if (!sweepTimer) {
    sweepTimer = setInterval(async () => {
      try {
        const { requeued } = await recoverStuckFullTextJobs();
        if (requeued) { console.log(`[fulltext-worker] periodic sweep re-queued ${requeued} stuck job(s)`); kickFullTextWorker(); }
      } catch (e) { console.error('[fulltext-worker] periodic sweep failed:', e?.message); }
    }, STUCK_MS);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }
  kickFullTextWorker();
}
