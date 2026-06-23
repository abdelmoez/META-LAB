/**
 * pecanSearch/pecanSearchController.js — HTTP layer for the Pecan Search Engine.
 *
 * Every handler gates on (1) the `pecanSearch` feature flag (default OFF → 404)
 * and (2) the caller's META·LAB project access (resolveProjectAccess; null → 404
 * existence-hiding, mutations require canEdit → 403). Run-scoped handlers also
 * verify the run belongs to the path project (no cross-project enumeration).
 *
 * Secrets never appear in any response: provider config is the public (key-free)
 * shape; errors return only user-safe messages + codes.
 */
import { prisma } from '../db/client.js';
import { resolveProjectAccess, recordWorkflowAudit } from '../services/workflowState.js';
import { createTtlCache } from '../searchEngine/ttlCache.js';
import {
  pecanSearchEnabled, buildEngine, startRun, cancelRun, retryRun,
  getRunSummary, listRuns,
} from './runService.js';
import { listRunDuplicates, resolveRunDuplicate } from './duplicates.js';
import { buildReport, reportToCsv, reportToHtml } from './report.js';
import { publicProviderConfig } from './config.js';
import { normalizeCanonical, validateCanonical, QUERY_LIMITS } from './query/ast.js';
import { PecanError } from './errors.js';

const AUDIT_MODULE = 'pecanSearch';
// Cache identical count previews briefly so rapid typing never floods providers.
const previewCache = createTtlCache({ ttlMs: 5 * 60 * 1000, max: 4000 });
// Per-(user,provider) last preview-call timestamp — enforces previewThrottleMs so
// rapid DISTINCT queries (which the cache can't collapse) can't flood a provider.
const previewLastCall = new Map(); // `${userId}:${provider}` -> epoch ms

/** Clamp a per-source override to the canonical query length ceiling. */
const clampOverride = (v) => (typeof v === 'string' ? v.slice(0, QUERY_LIMITS.MAX_QUERY_LEN) : '');

/** Flag + project-access gate. Returns access or null (after writing a response). */
async function gate(req, res, { mutate = false } = {}) {
  if (!(await pecanSearchEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveProjectAccess(req.params.projectId, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (mutate && !access.canEdit) { res.status(403).json({ error: 'Read-only access' }); return null; }
  return access;
}

/** Load a run and verify it belongs to the path project (cross-project guard). */
async function loadOwnedRun(req, res) {
  const run = await prisma.pecanSearchRun.findUnique({ where: { id: req.params.runId }, select: { id: true, metaLabProjectId: true } });
  if (!run || run.metaLabProjectId !== req.params.projectId) { res.status(404).json({ error: 'Run not found' }); return null; }
  return run;
}

function handleError(res, err, where) {
  if (err instanceof PecanError) return res.status(err.httpStatus).json(err.toResponse());
  if (err && err.code === 'INVALID_QUERY') return res.status(400).json({ error: err.userMessage || 'Invalid query', code: 'INVALID_QUERY' });
  if (err && err.code === 'AUTHORIZATION_FAILED') return res.status(403).json({ error: err.userMessage || 'Forbidden', code: 'AUTHORIZATION_FAILED' });
  if (err && err.code === 'QUOTA_EXCEEDED') return res.status(429).json({ error: err.userMessage || 'Too many active searches', code: 'QUOTA_EXCEEDED' });
  console.error(`[pecan-search] ${where}:`, err?.message);
  return res.status(500).json({ error: 'Internal server error' });
}

// ── Providers (flag + auth only; no project scope) ────────────────────────────

export async function getProviders(req, res) {
  try {
    if (!(await pecanSearchEnabled())) return res.status(404).json({ error: 'Not found' });
    const engine = await buildEngine();
    const providers = publicProviderConfig(engine.config).map((p) => ({
      ...p, implemented: engine.connectors[p.id] != null,
      selectable: engine.connectors[p.id] != null && p.available,
    }));
    return res.json({ providers, engine: { defaultResultCap: engine.config.engine.defaultResultCap, maxResultCap: engine.config.engine.maxResultCap } });
  } catch (err) { return handleError(res, err, 'getProviders'); }
}

// ── Query validation + translation ────────────────────────────────────────────

export async function postValidate(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const v = validateCanonical(req.body && req.body.canonicalQuery);
    return res.json({ ok: v.ok, errors: v.errors, warnings: v.warnings });
  } catch (err) { return handleError(res, err, 'postValidate'); }
}

export async function postTranslate(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const engine = await buildEngine();
    const canonical = normalizeCanonical(req.body && req.body.canonicalQuery);
    const overrides = (req.body && req.body.overrides) || {};
    const ids = selectedIds(req.body, engine);
    const out = {};
    for (const id of ids) {
      const connector = engine.connectors[id];
      if (!connector) { out[id] = { available: false }; continue; }
      try {
        const tr = connector.translateQuery(canonical, { override: clampOverride(overrides[id]) });
        out[id] = { available: engine.config.providers[id].available, query: tr.query, queryHash: tr.queryHash, warnings: tr.warnings, supported: tr.supported, unsupported: tr.unsupported, assumptions: tr.assumptions, hasOverride: tr.hasOverride };
      } catch (e) { out[id] = { available: false, error: 'Translation failed' }; }
    }
    return res.json({ translations: out });
  } catch (err) { return handleError(res, err, 'postTranslate'); }
}

export async function postPreviewCount(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const engine = await buildEngine();
    const canonical = normalizeCanonical(req.body && req.body.canonicalQuery);
    const overrides = (req.body && req.body.overrides) || {};
    const ids = selectedIds(req.body, engine);
    const out = {};
    await Promise.all(ids.map(async (id) => {
      const connector = engine.connectors[id];
      const p = engine.config.providers[id];
      if (!connector || !p || !p.available || !p.supportsCountPreview) { out[id] = { count: null, kind: 'unsupported' }; return; }
      try {
        const tr = connector.translateQuery(canonical, { override: clampOverride(overrides[id]) });
        const cacheKey = `${id}:${tr.queryHash}`;
        const cached = previewCache.get(cacheKey);
        if (cached !== undefined) { out[id] = { ...cached, cached: true }; return; }
        // Per-(user,provider) throttle: a DISTINCT query the cache can't collapse
        // still cannot hit a provider more often than previewThrottleMs.
        const throttleKey = `${req.user.id}:${id}`;
        const throttleMs = engine.config.engine.previewThrottleMs;
        const last = previewLastCall.get(throttleKey) || 0;
        if (throttleMs > 0 && Date.now() - last < throttleMs) { out[id] = { count: null, kind: 'throttled' }; return; }
        previewLastCall.set(throttleKey, Date.now());
        const pc = await connector.previewCount(tr, {});
        const val = { count: pc.count, kind: pc.kind, at: pc.at };
        previewCache.set(cacheKey, val);
        out[id] = val;
      } catch (e) {
        out[id] = { count: null, kind: 'unavailable' };
      }
    }));
    return res.json({ counts: out });
  } catch (err) { return handleError(res, err, 'postPreviewCount'); }
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export async function postStartRun(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const idempotencyKey = String(req.get('Idempotency-Key') || body.idempotencyKey || '').slice(0, 200);
    const { run, created } = await startRun({
      metaLabProjectId: req.params.projectId,
      user: req.user,
      name: body.name,
      canonicalQuery: body.canonicalQuery,
      sources: body.sources,
      caps: body.caps || {},
      idempotencyKey,
    });
    if (created) {
      try {
        await recordWorkflowAudit({ projectId: req.params.projectId, moduleKey: AUDIT_MODULE, action: 'PECAN_SEARCH_STARTED', revision: 0, user: req.user, details: { runId: run.id, sources: safeLen(run) } });
      } catch { /* audit must never block */ }
    }
    const summary = await getRunSummary(run.id);
    return res.status(created ? 202 : 200).json({ run: summary, created });
  } catch (err) { return handleError(res, err, 'postStartRun'); }
}

export async function getRuns(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const skip = clampInt(req.query.skip, 0, 0, 100000);
    const take = clampInt(req.query.take, 20, 1, 100);
    const out = await listRuns(req.params.projectId, { skip, take });
    return res.json(out);
  } catch (err) { return handleError(res, err, 'getRuns'); }
}

export async function getRun(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const summary = await getRunSummary(owned.id);
    return res.json({ run: summary });
  } catch (err) { return handleError(res, err, 'getRun'); }
}

export async function postCancelRun(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const run = await cancelRun(owned.id);
    try { await recordWorkflowAudit({ projectId: req.params.projectId, moduleKey: AUDIT_MODULE, action: 'PECAN_SEARCH_CANCELLED', revision: 0, user: req.user, details: { runId: owned.id } }); } catch { /* ignore */ }
    return res.json({ ok: true, state: run ? run.state : 'cancelled' });
  } catch (err) { return handleError(res, err, 'postCancelRun'); }
}

export async function postRetryRun(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const run = await retryRun(owned.id);
    try { await recordWorkflowAudit({ projectId: req.params.projectId, moduleKey: AUDIT_MODULE, action: 'PECAN_SEARCH_RETRIED', revision: 0, user: req.user, details: { runId: owned.id } }); } catch { /* ignore */ }
    const summary = await getRunSummary(owned.id);
    return res.json({ run: summary });
  } catch (err) { return handleError(res, err, 'postRetryRun'); }
}

// ── Duplicate review ────────────────────────────────────────────────────────────

export async function getRunDuplicates(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const skip = clampInt(req.query.skip, 0, 0, 100000);
    const take = clampInt(req.query.take, 50, 1, 200);
    const out = await listRunDuplicates(owned.id, { skip, take });
    return res.json(out);
  } catch (err) { return handleError(res, err, 'getRunDuplicates'); }
}

export async function postResolveDuplicate(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const decision = await prisma.pecanDedupDecision.findUnique({ where: { id: req.params.decisionId }, select: { runId: true } });
    if (!decision || decision.runId !== owned.id) return res.status(404).json({ error: 'Duplicate not found' });
    const action = String((req.body && req.body.action) || '').trim();
    if (!['merge', 'keep_separate', 'defer'].includes(action)) return res.status(400).json({ error: 'Invalid action', code: 'BAD_ACTION' });
    const out = await resolveRunDuplicate(req.params.decisionId, action, req.user);
    if (!out.ok) return res.status(out.code === 'ALREADY_RESOLVED' ? 409 : 400).json({ error: out.code });
    return res.json(out);
  } catch (err) { return handleError(res, err, 'postResolveDuplicate'); }
}

// ── Report + export ────────────────────────────────────────────────────────────

export async function getReport(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const report = await buildReport(owned.id);
    if (!report) return res.status(404).json({ error: 'Run not found' });
    return res.json({ report });
  } catch (err) { return handleError(res, err, 'getReport'); }
}

export async function getReportExport(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const owned = await loadOwnedRun(req, res); if (!owned) return;
    const report = await buildReport(owned.id);
    if (!report) return res.status(404).json({ error: 'Run not found' });
    const format = String(req.query.format || 'json').toLowerCase();
    const base = `pecanrev-search-${owned.id.slice(0, 8)}`;
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      return res.send(reportToCsv(report));
    }
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${base}.html"`);
      return res.send(reportToHtml(report));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  } catch (err) { return handleError(res, err, 'getReportExport'); }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function selectedIds(body, engine) {
  const want = Array.isArray(body && body.sources) ? body.sources.map((s) => (typeof s === 'string' ? s : s && s.provider)).filter(Boolean) : null;
  const all = Object.keys(engine.config.providers);
  if (!want || !want.length) return all.filter((id) => engine.connectors[id]); // default: all implemented
  return want.filter((id) => all.includes(id));
}

function clampInt(v, dflt, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(n, max));
}

function safeLen(run) {
  try { return JSON.parse(run.config || '{}').sources?.length || 0; } catch { return 0; }
}
