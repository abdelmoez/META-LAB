/**
 * strategyStudioController.js — HTTP layer for P11 (Guided Boolean search-strategy
 * Studio). Mounted under the Search Engine router (/api/search-builder) so it shares
 * requireAuth + the search-engine rate limiter at the mount.
 *
 * Every handler gates on (1) the `searchStrategyStudio` feature flag — which also
 * requires `searchEngine` + `pecanSearch` ON (studioEnabled), default OFF → 404
 * existence-hiding — and (2) the caller's META·LAB project access (resolveProjectAccess;
 * null/!canView → 404; mutations require canEdit → 403). When the pure engine has not
 * yet landed the service reports `engine_unavailable` → 503 STUDIO_ENGINE_UNAVAILABLE.
 */
import { resolveProjectAccess, recordWorkflowAudit } from '../services/workflowState.js';
import {
  studioEnabled, generate, optimize, listIterations,
  listSeeds, addSeeds, removeSeed, estimateRecallFor, prismaS,
} from '../searchEngine/strategyStudioService.js';
import { searchDocToCsv, searchDocToHtml } from '../pecanSearch/report.js';

const AUDIT_MODULE = 'searchStrategyStudio';

/** Flag + project-access gate. Returns access or null (after writing a response). */
async function gate(req, res, { mutate = false } = {}) {
  if (!(await studioEnabled(req.user))) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveProjectAccess(req.params.pid, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: 'Project not found' }); return null; }
  if (mutate && !access.canEdit) { res.status(403).json({ error: 'Read-only access' }); return null; }
  return access;
}

/** Map a service error string onto an HTTP response. Returns true if handled. */
function handleServiceError(res, out) {
  if (!out || !out.error) return false;
  switch (out.error) {
    case 'engine_unavailable':
      res.status(503).json({ error: 'The search-strategy engine is not available yet.', code: 'STUDIO_ENGINE_UNAVAILABLE' });
      return true;
    case 'no_concepts':
      res.status(400).json({ error: 'Build a search strategy (concepts) first.', code: 'NO_CONCEPTS' });
      return true;
    case 'no_seeds':
      res.status(400).json({ error: 'Add at least one seed study first.', code: 'NO_SEEDS' });
      return true;
    case 'no_strategy':
      res.status(400).json({ error: 'No PubMed strategy is available to probe.', code: 'NO_STRATEGY' });
      return true;
    case 'run_required':
      res.status(400).json({ error: 'A runId is required for run-based recall.', code: 'RUN_REQUIRED' });
      return true;
    case 'bad_source':
      res.status(400).json({ error: 'source must be "run" or "probe".', code: 'BAD_SOURCE' });
      return true;
    case 'run_not_found':
      res.status(404).json({ error: 'Run not found', code: 'RUN_NOT_FOUND' });
      return true;
    case 'not_found':
      res.status(404).json({ error: 'Not found' });
      return true;
    default:
      res.status(400).json({ error: 'Request failed', code: String(out.error).toUpperCase() });
      return true;
  }
}

// ── Strategy generate / optimize / iterations ─────────────────────────────────

export async function postGenerate(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const body = req.body || {};
    const out = await generate(req.params.pid, {
      databases: Array.isArray(body.databases) ? body.databases : undefined,
      options: body.options && typeof body.options === 'object' ? body.options : {},
    });
    if (handleServiceError(res, out)) return;
    return res.json(out); // { candidates:{strategies,notes}, databases }
  } catch (err) {
    console.error('[strategyStudio] postGenerate error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function postOptimize(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const out = await optimize(req.params.pid, {
      databases: Array.isArray(body.databases) ? body.databases : undefined,
      maxIterations: body.maxIterations,
      strategyVersionId: typeof body.strategyVersionId === 'string' ? body.strategyVersionId : null,
      options: body.options && typeof body.options === 'object' ? body.options : {},
      config: body.config && typeof body.config === 'object' ? body.config : {},
      seedRecall: body.seedRecall ?? null,
    }, { user: req.user });
    if (handleServiceError(res, out)) return;
    try {
      await recordWorkflowAudit({
        projectId: req.params.pid, moduleKey: AUDIT_MODULE, action: 'STRATEGY_OPTIMIZED', revision: 0, user: req.user,
        details: { iterations: (out.iterations || []).length, maxIterations: out.maxIterations },
      });
    } catch { /* audit best-effort */ }
    return res.json(out); // { iterations[], finalStrategy, maxIterations }
  } catch (err) {
    console.error('[strategyStudio] postOptimize error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getIterations(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const iterations = await listIterations(req.params.pid, { limit: req.query.limit });
    return res.json({ iterations });
  } catch (err) {
    console.error('[strategyStudio] getIterations error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Seed studies (known-included set) ─────────────────────────────────────────

export async function getSeedStudies(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const seeds = await listSeeds(req.params.pid);
    return res.json({ seeds });
  } catch (err) {
    console.error('[strategyStudio] getSeedStudies error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function postSeedStudies(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const input = Array.isArray(body.seeds) ? body.seeds : (Array.isArray(body) ? body : [body]);
    const created = await addSeeds(req.params.pid, input, req.user);
    try {
      await recordWorkflowAudit({ projectId: req.params.pid, moduleKey: AUDIT_MODULE, action: 'SEED_STUDIES_ADDED', revision: 0, user: req.user, details: { count: created.length } });
    } catch { /* best-effort */ }
    return res.status(201).json({ seeds: created });
  } catch (err) {
    console.error('[strategyStudio] postSeedStudies error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteSeedStudy(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const out = await removeSeed(req.params.pid, req.params.sid);
    if (handleServiceError(res, out)) return;
    try {
      await recordWorkflowAudit({ projectId: req.params.pid, moduleKey: AUDIT_MODULE, action: 'SEED_STUDY_REMOVED', revision: 0, user: req.user, details: { seedId: req.params.sid } });
    } catch { /* best-effort */ }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[strategyStudio] deleteSeedStudy error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Recall estimate ───────────────────────────────────────────────────────────

export async function postRecallEstimate(req, res) {
  try {
    const access = await gate(req, res, { mutate: true }); if (!access) return;
    const body = req.body || {};
    const out = await estimateRecallFor(req.params.pid, {
      source: body.source === 'probe' ? 'probe' : 'run',
      runId: typeof body.runId === 'string' ? body.runId : null,
      strategyVersionId: typeof body.strategyVersionId === 'string' ? body.strategyVersionId : null,
    });
    if (handleServiceError(res, out)) return;
    return res.json(out);
  } catch (err) {
    console.error('[strategyStudio] postRecallEstimate error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PRISMA-S search documentation ─────────────────────────────────────────────

export async function getPrismaS(req, res) {
  try {
    const access = await gate(req, res); if (!access) return;
    const runId = typeof req.query.runId === 'string' && req.query.runId ? req.query.runId : null;
    const doc = await prismaS(req.params.pid, runId);
    const format = String(req.query.format || 'json').toLowerCase();
    const base = `pecanrev-prisma-s-${String(req.params.pid).slice(0, 8)}`;
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
      return res.send(searchDocToCsv(doc));
    }
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="${base}.html"`);
      return res.send(searchDocToHtml(doc));
    }
    return res.json({ document: doc });
  } catch (err) {
    console.error('[strategyStudio] getPrismaS error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
