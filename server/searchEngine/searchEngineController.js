/**
 * searchEngineController.js — HTTP layer for the separated Search Engine
 * (BACKEND_CONTRACT.md). Four capabilities:
 *   POST /api/search-builder/mesh    { term }  → mesh record | null   (NLM proxy)
 *   POST /api/search-builder/count   { query } → { count }            (NLM proxy)
 *   GET  /api/search-builder/:pid              → { concepts, overrides } | null
 *   PUT  /api/search-builder/:pid    { concepts, overrides } → { ok:true }
 *
 * Gated on the `searchEngine` feature flag (default OFF → 404). The NLM proxies
 * require only auth + flag (generic vocab lookups). The per-project load/save are
 * authorized by the SAME META·LAB project access as the project, and PERSIST via
 * the shared per-module workflow-state infra (moduleKey 'search') — so the search
 * builder is a first-class migrated workflow module while its engine stays its own
 * backend module.
 */
import { prisma } from '../db/client.js';
import { meshLookup, pubmedCount } from './nlmClient.js';
import {
  resolveProjectAccess, getModuleState, patchModuleState, recordWorkflowAudit,
} from '../services/workflowState.js';

const SEARCH_MODULE = 'search';

async function searchEngineEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    if (!row) return false;
    return JSON.parse(row.value || '{}').searchEngine === true;
  } catch {
    return false;
  }
}

// ── NLM proxies (auth + flag only) ────────────────────────────────────────────

export async function postMesh(req, res) {
  try {
    if (!(await searchEngineEnabled())) return res.status(404).json({ error: 'Not found' });
    const term = req.body && typeof req.body.term === 'string' ? req.body.term : '';
    if (!term.trim()) return res.json(null);
    return res.json(await meshLookup(term)); // record | null
  } catch (err) {
    console.error('[searchEngine] postMesh error:', err.message);
    return res.json(null); // degrade rather than 500 (frontend handles null)
  }
}

export async function postCount(req, res) {
  try {
    if (!(await searchEngineEnabled())) return res.status(404).json({ error: 'Not found' });
    const query = req.body && typeof req.body.query === 'string' ? req.body.query : '';
    if (!query.trim()) return res.json({ count: null });
    return res.json({ count: await pubmedCount(query) });
  } catch (err) {
    console.error('[searchEngine] postCount error:', err.message);
    return res.json({ count: null });
  }
}

// ── Per-project persistence (project access; reuses WorkflowModuleState) ───────

async function gate(req, res) {
  if (!(await searchEngineEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveProjectAccess(req.params.projectId, req.user.id);
  if (!access || !access.canView) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}

export async function getSearch(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const mod = await getModuleState(req.params.projectId, SEARCH_MODULE);
    // revision 0 = never saved → null so the tab seeds fresh from the project's PICO.
    return res.json(mod.revision > 0 ? mod.state : null);
  } catch (err) {
    console.error('[searchEngine] getSearch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function putSearch(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    if (!access.canEdit) return res.status(403).json({ error: 'Read-only access' });

    const body = req.body || {};
    const value = {
      concepts: Array.isArray(body.concepts) ? body.concepts : [],
      overrides: body.overrides && typeof body.overrides === 'object' ? body.overrides : {},
    };
    // baseRevision null = overwrite (the contract's PUT is a full upsert; the
    // search builder is single-strategy-per-project so last-write-wins is fine).
    const out = await patchModuleState({
      projectId: req.params.projectId, moduleKey: SEARCH_MODULE, patch: value, baseRevision: null, user: req.user,
    });
    if (out.ok) {
      await recordWorkflowAudit({
        projectId: req.params.projectId, moduleKey: SEARCH_MODULE, action: 'SEARCH_UPDATED',
        revision: out.result.revision, user: req.user,
        details: { concepts: value.concepts.length },
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[searchEngine] putSearch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
