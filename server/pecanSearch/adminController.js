/**
 * pecanSearch/adminController.js — Ops Console "Search Providers" management.
 *
 * Admin-only (mounted under the admin router behind requireAdmin). Exposes:
 *   - provider configured/available state (NEVER the API key value),
 *   - the non-secret policy block (caps, concurrency, retries, timeouts, per-provider
 *     enable, institutional mode) stored in the `searchProviderSettings` SiteSetting,
 *   - queue + worker health (PecanSearchJob status counts, stale jobs, recent
 *     sanitized failures) and recent run/provider failures,
 *   - a safe requeue for a stuck/failed job.
 * All writes are validated server-side and audited.
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { buildEngine } from './runService.js';
import { publicProviderConfig, PROVIDER_IDS, ENGINE_DEFAULTS } from './config.js';

const SETTING_KEY = 'searchProviderSettings';
const STUCK_MS = 10 * 60 * 1000;

async function readSettings() {
  try { const row = await prisma.siteSetting.findUnique({ where: { key: SETTING_KEY } }); return row ? JSON.parse(row.value || '{}') : {}; }
  catch { return {}; }
}

/** GET /api/admin/search-providers — settings + provider state + queue/worker health. */
export async function getSearchProviders(req, res) {
  try {
    const engine = await buildEngine();
    const settings = await readSettings();
    const providers = publicProviderConfig(engine.config).map((p) => ({ ...p, implemented: engine.connectors[p.id] != null }));

    const [queued, processing, completed, failed, cancelled] = await Promise.all([
      prisma.pecanSearchJob.count({ where: { status: 'queued' } }),
      prisma.pecanSearchJob.count({ where: { status: 'processing' } }),
      prisma.pecanSearchJob.count({ where: { status: 'completed' } }),
      prisma.pecanSearchJob.count({ where: { status: 'failed' } }),
      prisma.pecanSearchJob.count({ where: { status: 'cancelled' } }),
    ]);
    const staleCutoff = new Date(Date.now() - STUCK_MS);
    const stale = await prisma.pecanSearchJob.count({ where: { status: 'processing', OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: staleCutoff } }] } });

    const recentFailedJobs = await prisma.pecanSearchJob.findMany({
      where: { status: 'failed' }, orderBy: { updatedAt: 'desc' }, take: 10,
      select: { id: true, runId: true, error: true, updatedAt: true, attempts: true },
    });
    const recentFailedSources = await prisma.pecanSearchSource.findMany({
      where: { state: 'failed' }, orderBy: { updatedAt: 'desc' }, take: 10,
      select: { provider: true, errorClass: true, errorDetail: true, updatedAt: true },
    });
    const [runsTotal, runsCompleted, runsPartial, runsFailed] = await Promise.all([
      prisma.pecanSearchRun.count(),
      prisma.pecanSearchRun.count({ where: { state: 'completed' } }),
      prisma.pecanSearchRun.count({ where: { state: 'partial' } }),
      prisma.pecanSearchRun.count({ where: { state: 'failed' } }),
    ]);

    return res.json({
      engine: engine.config.engine,
      defaults: ENGINE_DEFAULTS,
      settings, // the raw editable policy block (non-secret)
      providers,
      queue: { queued, processing, completed, failed, cancelled, stale },
      runs: { total: runsTotal, completed: runsCompleted, partial: runsPartial, failed: runsFailed },
      recentFailedJobs,
      recentFailedSources,
    });
  } catch (err) {
    console.error('[pecan-search-admin] getSearchProviders:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** PATCH /api/admin/search-providers — validate + persist the policy block. */
export async function updateSearchProviders(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const prev = await readSettings();
    const next = sanitizeSettings(body, prev);
    await prisma.siteSetting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: SETTING_KEY, value: JSON.stringify(next) },
    });
    await logAdminAction(req, 'PECAN_SEARCH_SETTINGS_UPDATED', 'setting', SETTING_KEY, { changed: Object.keys(body) });
    return res.json({ ok: true, settings: next });
  } catch (err) {
    console.error('[pecan-search-admin] updateSearchProviders:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /api/admin/search-providers/jobs/:jobId/requeue — safe requeue. */
export async function requeueJob(req, res) {
  try {
    const job = await prisma.pecanSearchJob.findUnique({ where: { id: req.params.jobId } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!['failed', 'processing'].includes(job.status)) return res.status(400).json({ error: 'Only failed or stuck jobs can be requeued' });
    await prisma.pecanSearchJob.update({ where: { id: job.id }, data: { status: 'queued', stage: 'queued', error: '' } });
    await prisma.pecanSearchRun.updateMany({ where: { id: job.runId }, data: { state: 'queued', cancelRequested: false } });
    try { const m = await import('./pecanSearchWorker.js'); m.kickPecanSearchWorker(); } catch { /* boot drains */ }
    await logAdminAction(req, 'PECAN_SEARCH_JOB_REQUEUED', 'job', job.id, { runId: job.runId });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[pecan-search-admin] requeueJob:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const clampNum = (v, dflt, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(n, max)) : dflt; };
const asBool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);

/** Validate + bound the admin-editable policy (no secrets ever accepted here). */
function sanitizeSettings(body, prev) {
  const out = {
    defaultResultCap: clampNum(body.defaultResultCap, prev.defaultResultCap ?? ENGINE_DEFAULTS.defaultResultCap, 1, 50000),
    maxResultCap: clampNum(body.maxResultCap, prev.maxResultCap ?? ENGINE_DEFAULTS.maxResultCap, 1, 50000),
    concurrency: clampNum(body.concurrency, prev.concurrency ?? ENGINE_DEFAULTS.concurrency, 1, 8),
    retryLimit: clampNum(body.retryLimit, prev.retryLimit ?? ENGINE_DEFAULTS.retryLimit, 0, 10),
    requestTimeoutMs: clampNum(body.requestTimeoutMs, prev.requestTimeoutMs ?? ENGINE_DEFAULTS.requestTimeoutMs, 1000, 120000),
    previewThrottleMs: clampNum(body.previewThrottleMs, prev.previewThrottleMs ?? ENGINE_DEFAULTS.previewThrottleMs, 0, 60000),
    pageDelayMs: clampNum(body.pageDelayMs, prev.pageDelayMs ?? ENGINE_DEFAULTS.pageDelayMs, 0, 10000),
    institutionalMode: asBool(body.institutionalMode, prev.institutionalMode ?? ENGINE_DEFAULTS.institutionalMode),
    providers: {},
  };
  const prevProviders = (prev.providers && typeof prev.providers === 'object') ? prev.providers : {};
  const inProviders = (body.providers && typeof body.providers === 'object') ? body.providers : {};
  for (const id of PROVIDER_IDS) {
    const pPrev = prevProviders[id] || {};
    const pIn = inProviders[id] || {};
    out.providers[id] = {
      enabled: asBool(pIn.enabled, pPrev.enabled ?? true),
      defaultCap: pIn.defaultCap != null || pPrev.defaultCap != null ? clampNum(pIn.defaultCap ?? pPrev.defaultCap, out.defaultResultCap, 1, out.maxResultCap) : undefined,
      maxCap: pIn.maxCap != null || pPrev.maxCap != null ? clampNum(pIn.maxCap ?? pPrev.maxCap, out.maxResultCap, 1, 50000) : undefined,
      timeoutMs: pIn.timeoutMs != null || pPrev.timeoutMs != null ? clampNum(pIn.timeoutMs ?? pPrev.timeoutMs, out.requestTimeoutMs, 1000, 120000) : undefined,
    };
    // Strip undefined keys to keep the row tidy.
    Object.keys(out.providers[id]).forEach((k) => out.providers[id][k] === undefined && delete out.providers[id][k]);
  }
  return out;
}
