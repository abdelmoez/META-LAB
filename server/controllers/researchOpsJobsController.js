/**
 * researchOpsJobsController.js — Ops Console › Research Governance: duplicate-job
 * telemetry + safe requeue, and the persisted client-error feed.
 *
 * 109.md §§8-10, 46-47. Mounted under the admin router (so requireAuth already ran)
 * behind the §39 capability seam: read endpoints take `view_research_diagnostics`
 * (admin + mod), write endpoints take `manage_research_jobs` (admin only). Frontend
 * hiding is never authorization (§56) — every route below is enforced server-side.
 *
 * Template: server/pecanSearch/adminController.js — status counts, stale-heartbeat
 * detection, a sanitized recent-failure list, and an audited requeue with a state
 * precondition. Two things are DELIBERATELY different here:
 *
 *   1. SANITIZATION. `publicDuplicateJob` (screeningController.js) strips cpuMs and
 *      heapUsedMb from member-facing responses as cross-tenant leakage. The Ops
 *      projection strips them too: 109's hard guardrail is that process-level
 *      resource telemetry is never echoed to a browser, admin or not. Raw
 *      `statsJson` is never returned verbatim — only an allow-listed subset.
 *   2. REQUEUE REUSES THE WORKER'S RECOVERY SEMANTICS. It does not invent a new
 *      job-mutation primitive: the retry-budget decision comes from the shared
 *      utils/jobRetry.js policy and the row patch is byte-identical to the one
 *      recoverStuckDuplicateJobs applies. The worker's save path is an idempotent
 *      reconciliation, so a requeued run can never erase resolved groups, screening
 *      decisions or record metadata (§9).
 */
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { writeAudit } from '../screening/access.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, hasExhaustedAttempts } from '../utils/jobRetry.js';
import { DUP_CFG, kickDuplicateWorker } from '../services/screeningDuplicateWorker.js';
import { getMetaSiftSettings } from '../screening/settings.js';

/* ─── shared paging ─────────────────────────────────────────────────────── */

/**
 * Ops list paging. Mirrors adminController.parsePage (page/limit/skip, limit capped
 * at 100) so every Ops table pages the same way — 109 §24 forbids loading whole
 * histories into the browser.
 */
export function parseJobPage(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

/** Parse an ISO-ish date filter; invalid input is ignored rather than 400-ing. */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

const DUP_JOB_STATUSES = Object.freeze(['queued', 'processing', 'completed', 'failed', 'cancelled']);

/* ─── sanitization ──────────────────────────────────────────────────────── */

/**
 * Allow-listed keys lifted out of ScreenDuplicateJob.statsJson.
 *
 * `cpuMs` and `heapUsedMb` are absent ON PURPOSE — see the file header. Anything
 * not on this list (including future engine fields) is dropped, so a worker change
 * can never silently start leaking a new value through Ops.
 */
const STATS_ALLOW = Object.freeze([
  'projectRecordCount', 'plans', 'healedGroups', 'truncated',
  'skippedResolvedMidRun', 'skippedOversizedGroups', 'skippedOversizedGroupMembers',
  'engine', 'engineVersion', 'reason',
]);

/** Total wall-clock ms for a finished job, or null when the worker did not record it. */
export function jobDurationMs(stats) {
  const total = stats && stats.durationsMs && stats.durationsMs.total;
  return Number.isFinite(total) ? total : null;
}

/**
 * Project a ScreenDuplicateJob row into the Ops shape. PURE + exported so the
 * leakage guarantee is unit-testable without a database: feed it a row carrying
 * cpuMs/heapUsedMb and assert they are gone.
 */
export function opsDuplicateJob(job, { projectTitle = null } = {}) {
  if (!job) return null;
  let stats = {};
  try { stats = JSON.parse(job.statsJson || '{}') || {}; } catch { stats = {}; }
  const safeStats = {};
  for (const k of STATS_ALLOW) if (stats[k] !== undefined) safeStats[k] = stats[k];
  const durationsMs = stats.durationsMs && typeof stats.durationsMs === 'object' ? stats.durationsMs : null;
  if (durationsMs) {
    // Per-stage wall-clock is useful and non-sensitive; cpu/heap are not exposed.
    safeStats.durationsMs = { ...durationsMs };
  }
  return {
    id: job.id,
    projectId: job.projectId,
    projectTitle,
    status: job.status,
    stage: job.stage,
    cancelRequested: !!job.cancelRequested,
    totalRecords: job.totalRecords,
    processedRecords: job.processedRecords,
    comparisonsTotal: job.comparisonsTotal,
    comparisonsDone: job.comparisonsDone,
    groupsFound: job.groupsFound,
    groupsCreated: job.groupsCreated,
    groupsUpdated: job.groupsUpdated,
    recordsFlagged: job.recordsFlagged,
    exactMatches: job.exactMatches,
    fuzzyMatches: job.fuzzyMatches,
    attempts: job.attempts,
    maxAttempts: DEFAULT_MAX_JOB_ATTEMPTS,
    retriesRemaining: Math.max(0, DEFAULT_MAX_JOB_ATTEMPTS - (Number(job.attempts) || 0)),
    error: job.error || '',
    createdById: job.createdById,
    createdByName: job.createdByName || '',
    heartbeatAt: job.heartbeatAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    durationMs: jobDurationMs(stats),
    stats: safeStats,
  };
}

/** Median of a numeric array (null when empty). Exported for the unit test. */
export function median(values) {
  const nums = (Array.isArray(values) ? values : []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

/** Is this `processing` row past the worker's stale-heartbeat cutoff? */
export function isStaleJob(job, now = Date.now(), stuckMs = DUP_CFG.STUCK_MS) {
  if (!job || job.status !== 'processing') return false;
  const last = job.heartbeatAt || job.startedAt;
  return !last || new Date(last).getTime() < now - stuckMs;
}

/** Look up titles for a set of project ids (empty map on failure). */
async function projectTitles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  try {
    const rows = await prisma.screenProject.findMany({ where: { id: { in: unique } }, select: { id: true, title: true } });
    return Object.fromEntries(rows.map((p) => [p.id, p.title]));
  } catch { return {}; }
}

/* ─── GET /api/admin/research/duplicate-jobs ────────────────────────────── */

/** Filterable, paginated duplicate-detection job list (109 §8). */
export async function listDuplicateJobs(req, res) {
  try {
    const { page, limit, skip } = parseJobPage(req.query);
    const where = {};
    const status = String(req.query.status || '').trim();
    if (status && DUP_JOB_STATUSES.includes(status)) where.status = status;
    if (req.query.projectId) where.projectId = String(req.query.projectId);
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [total, jobs] = await Promise.all([
      prisma.screenDuplicateJob.count({ where }),
      prisma.screenDuplicateJob.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    ]);
    const titles = await projectTitles(jobs.map((j) => j.projectId));
    const now = Date.now();
    const rows = jobs.map((j) => ({
      ...opsDuplicateJob(j, { projectTitle: titles[j.projectId] || null }),
      stale: isStaleJob(j, now),
    }));
    return res.json({ jobs: rows, total, page, limit, hasMore: skip + rows.length < total });
  } catch (err) {
    console.error('[research-ops] listDuplicateJobs:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── GET /api/admin/research/duplicate-jobs/health ─────────────────────── */

/**
 * Service health for the duplicate-detection worker (109 §8/§46). Every number here
 * is backed by a real column — nothing is modelled or estimated.
 */
export async function getDuplicateJobHealth(req, res) {
  try {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const [queued, processing, completed, failed, cancelled, failed24h] = await Promise.all(
      DUP_JOB_STATUSES.map((s) => prisma.screenDuplicateJob.count({ where: { status: s } }))
        .concat([prisma.screenDuplicateJob.count({ where: { status: 'failed', updatedAt: { gte: dayAgo } } })]),
    );

    const processingRows = await prisma.screenDuplicateJob.findMany({
      where: { status: 'processing' },
      select: { id: true, status: true, heartbeatAt: true, startedAt: true },
    });
    const stale = processingRows.filter((j) => isStaleJob(j, now)).length;

    // Durations come from completed runs only — a failed/cancelled run's partial
    // clock would bias the average into fiction.
    const recentCompleted = await prisma.screenDuplicateJob.findMany({
      where: { status: 'completed' }, orderBy: { completedAt: 'desc' }, take: 50,
      select: { statsJson: true },
    });
    const durations = recentCompleted.map((r) => {
      try { return jobDurationMs(JSON.parse(r.statsJson || '{}')); } catch { return null; }
    }).filter((n) => Number.isFinite(n));
    const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

    const failedRows = await prisma.screenDuplicateJob.findMany({
      where: { status: 'failed' }, orderBy: { updatedAt: 'desc' }, take: 10,
    });
    const titles = await projectTitles(failedRows.map((j) => j.projectId));
    const recentFailures = failedRows.map((j) => opsDuplicateJob(j, { projectTitle: titles[j.projectId] || null }));

    const settings = await getMetaSiftSettings().catch(() => ({}));
    const enabled = settings.allowDuplicateDetection !== false;

    return res.json({
      // Degraded when the kill switch is off, a worker slot is wedged, or a job
      // failed in the last day. "Healthy" is the absence of all three.
      health: !enabled ? 'disabled' : (stale > 0 || failed24h > 0 ? 'degraded' : 'healthy'),
      enabled,
      queue: { queued, processing, completed, failed, cancelled, stale },
      failures24h: failed24h,
      durations: { sampleSize: durations.length, averageMs: avgMs, medianMs: median(durations) },
      recentFailures,
      // 109 §45 — the nine worker knobs are frozen at module load from process.env.
      // Rendered read-only with a "Managed by environment" badge; NEVER a toggle
      // that silently does nothing. No secret is involved (all are integers).
      workerConfig: {
        source: 'environment',
        restartRequired: true,
        values: {
          stuckMs: DUP_CFG.STUCK_MS,
          readBatch: DUP_CFG.READ_BATCH,
          saveBatch: DUP_CFG.SAVE_BATCH,
          maxBlock: DUP_CFG.MAX_BLOCK,
          maxComparisons: DUP_CFG.MAX_COMPARISONS,
          yieldEvery: DUP_CFG.YIELD_EVERY,
          progressMs: DUP_CFG.PROGRESS_MS,
          maxActivePerUser: DUP_CFG.MAX_ACTIVE_PER_USER,
          maxGroupSize: DUP_CFG.MAX_GROUP_SIZE,
        },
        maxAttempts: DEFAULT_MAX_JOB_ATTEMPTS,
      },
    });
  } catch (err) {
    console.error('[research-ops] getDuplicateJobHealth:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── GET /api/admin/research/duplicate-jobs/:jobId ─────────────────────── */

/** Single-job detail — same sanitized projection as the list (109 §9 "inspect"). */
export async function getDuplicateJob(req, res) {
  try {
    const job = await prisma.screenDuplicateJob.findUnique({ where: { id: String(req.params.jobId) } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const titles = await projectTitles([job.projectId]);
    return res.json({
      job: { ...opsDuplicateJob(job, { projectTitle: titles[job.projectId] || null }), stale: isStaleJob(job) },
    });
  } catch (err) {
    console.error('[research-ops] getDuplicateJob:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── POST /api/admin/research/duplicate-jobs/:jobId/requeue ────────────── */

/**
 * Decide whether a job may be requeued. PURE + exported so every branch is unit
 * tested without a database.
 *
 * The preconditions, and why each exists:
 *   - `failed` → the pecanSearch precedent's primary case.
 *   - `processing` ONLY when stale → requeueing a live job would run two workers
 *     over one project. The staleness test is the worker's own (heartbeat older
 *     than DUP_CFG.STUCK_MS), so Ops and the recovery tick agree.
 *   - terminal `completed`/`cancelled` → refused. "Rerun deduplication" is a
 *     different, deliberate action (enqueue a NEW job) and is out of scope here;
 *     mutating a finished row would rewrite history.
 *   - retry budget spent → refused. The give-up decision belongs to the shared
 *     jobRetry policy; Ops must not hand a poison pill an unlimited budget.
 */
export function canRequeueDuplicateJob(job, { now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS, enabled = true } = {}) {
  if (!job) return { ok: false, status: 404, error: 'Job not found' };
  if (!enabled) {
    return { ok: false, status: 409, error: 'Duplicate detection is disabled in META·SIFT settings. Re-enable it before requeueing jobs.' };
  }
  if (job.status !== 'failed' && job.status !== 'processing') {
    return { ok: false, status: 400, error: 'Only failed or stuck jobs can be requeued' };
  }
  if (job.status === 'processing' && !isStaleJob(job, now)) {
    return { ok: false, status: 409, error: 'This job is still running (recent heartbeat). Cancel it first if it must be stopped.' };
  }
  if (hasExhaustedAttempts(job.attempts, maxAttempts)) {
    return { ok: false, status: 409, error: `This job has used all ${maxAttempts} retry attempts. Start a new duplicate-detection run instead.` };
  }
  return { ok: true };
}

/**
 * The exact row patch recoverStuckDuplicateJobs applies to a retryable stuck job.
 * Kept as one shared constant so Ops and the worker can never drift: `attempts` is
 * NOT reset (the budget must keep shrinking) and progress counters are left alone
 * because the worker's claim zeroes them.
 */
export const REQUEUE_PATCH = Object.freeze({ status: 'queued', stage: 'queued', startedAt: null, heartbeatAt: null });

/** POST — audited, precondition-guarded requeue (109 §9, §40, §56). */
export async function requeueDuplicateJob(req, res) {
  try {
    const jobId = String(req.params.jobId);
    const job = await prisma.screenDuplicateJob.findUnique({ where: { id: jobId } });
    const settings = await getMetaSiftSettings().catch(() => ({}));
    const verdict = canRequeueDuplicateJob(job, { enabled: settings.allowDuplicateDetection !== false });
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    // Conditional on the status we just read: if the worker claimed or finished the
    // job in between, updateMany matches nothing and we report the race instead of
    // clobbering a live run (same CAS discipline as keywordOps / mutateProjectBlob).
    const upd = await prisma.screenDuplicateJob.updateMany({
      where: { id: jobId, status: job.status },
      data: { ...REQUEUE_PATCH, cancelRequested: false },
    });
    if (upd.count === 0) return res.status(409).json({ error: 'The job changed state while you were requeueing it. Reload and try again.' });

    try { kickDuplicateWorker(); } catch { /* the boot drain / recovery tick picks it up */ }

    const details = { projectId: job.projectId, previousStatus: job.status, attempts: job.attempts };
    await logAdminAction(req, 'DUPLICATE_JOB_REQUEUE', 'ScreenDuplicateJob', jobId, details, reason ? { reason } : undefined);
    // 109 §23 — the project's own ledger also records it, so a leader reading the
    // project audit trail sees why detection re-ran. Best-effort; never throws.
    await writeAudit(job.projectId, req.user, 'DUPLICATE_JOB_REQUEUE', {
      entityType: 'duplicateJob', entityId: jobId, details: { ...details, byAdmin: true, reason },
    });

    return res.json({ ok: true, jobId, previousStatus: job.status });
  } catch (err) {
    console.error('[research-ops] requeueDuplicateJob:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── client-error capture (109 §6/§46/§47) ─────────────────────────────── */

export const CLIENT_ERROR_LIMITS = Object.freeze({ kind: 80, message: 500, context: 500 });

/**
 * Hard cap on DISTINCT rows. Repeats collapse onto one row for free, but a client
 * spraying unique messages (a template literal with a timestamp in it, say) would
 * otherwise grow the table without bound. Over the cap, new fingerprints are
 * dropped and existing ones keep counting — capture degrades, it never wedges.
 */
export const CLIENT_ERROR_MAX_ROWS = 5000;

const oneLine = (v, n) => (v == null ? '' : String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n));

/**
 * Normalize a beacon body into the stored row. PURE + exported: the bounds and the
 * "no stack ever" rule are unit-tested without a database.
 *
 * `context` packs the non-sensitive locators the beacon already sends (route,
 * engine, release, browser, correlation id). Stacks, payloads and query strings are
 * never read from the body — §47 says admins get enough context to debug, not a
 * copy of the user's data.
 */
export function sanitizeClientErrorReport(body) {
  const e = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const kind = oneLine(e.name || e.kind, CLIENT_ERROR_LIMITS.kind);
  const message = oneLine(e.message, CLIENT_ERROR_LIMITS.message);
  const parts = [];
  const push = (label, value, n) => { const v = oneLine(value, n); if (v) parts.push(`${label}=${v}`); };
  push('route', e.route, 200);
  push('engine', e.engine, 60);
  push('release', e.release, 60);
  push('browser', e.browser, 120);
  push('cid', e.correlationId, 64);
  const context = parts.join(' ').slice(0, CLIENT_ERROR_LIMITS.context);
  if (!kind && !message) return null; // nothing identifiable → not worth a row
  const fingerprint = crypto.createHash('sha1').update(`${kind}|${message}|${context}`).digest('hex');
  return { fingerprint, kind, message, context };
}

/**
 * Persist (or increment) one client-error report. Fire-and-forget from the beacon
 * route — it must never delay or fail the 204, and a DB outage must not turn a
 * client crash into a second error.
 */
export async function recordClientErrorReport(body, { userId = null } = {}) {
  const row = sanitizeClientErrorReport(body);
  if (!row) return null;
  try {
    const upd = await prisma.clientErrorReport.updateMany({
      where: { fingerprint: row.fingerprint },
      data: { count: { increment: 1 }, lastSeenAt: new Date() },
    });
    if (upd.count > 0) return 'incremented';
    const total = await prisma.clientErrorReport.count();
    if (total >= CLIENT_ERROR_MAX_ROWS) return 'capped';
    await prisma.clientErrorReport.create({ data: { ...row, userId: userId || null } });
    return 'created';
  } catch {
    return null; // telemetry is best-effort by construction
  }
}

/** GET /api/admin/research/client-errors — paginated, filterable feed. */
export async function listClientErrors(req, res) {
  try {
    const { page, limit, skip } = parseJobPage(req.query);
    const where = {};
    const kind = String(req.query.kind || '').trim();
    if (kind) where.kind = kind;
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    if (from || to) where.lastSeenAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [total, rows, distinct] = await Promise.all([
      prisma.clientErrorReport.count({ where }),
      prisma.clientErrorReport.findMany({ where, orderBy: { lastSeenAt: 'desc' }, skip, take: limit }),
      prisma.clientErrorReport.count(),
    ]);
    return res.json({
      errors: rows,
      total,
      page,
      limit,
      hasMore: skip + rows.length < total,
      // Honesty surface for the Ops card: this feed is CAPTURE of crash beacons,
      // not undo/redo or autosave telemetry. 109 §46 — do not invent metrics.
      capture: { distinctRows: distinct, maxRows: CLIENT_ERROR_MAX_ROWS, limits: CLIENT_ERROR_LIMITS },
    });
  } catch (err) {
    console.error('[research-ops] listClientErrors:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
