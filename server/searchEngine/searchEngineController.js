/**
 * searchEngineController.js — HTTP layer for the separated Search Engine
 * (BACKEND_CONTRACT.md). Four capabilities:
 *   POST /api/search-builder/mesh    { term }  → mesh record | null   (NLM proxy)
 *   POST /api/search-builder/count   { query } → { count }            (NLM proxy)
 *   GET  /api/search-builder/:pid              → { concepts, overrides, ignored, revision, updatedAt } | null
 *   PUT  /api/search-builder/:pid    { concepts, overrides, ignored } → { ok:true, revision }
 *
 * On a successful PUT the controller emits a thin `search.updated` realtime poke to
 * the workspace's other online collaborators (SE1 Task 5 — live sync without refresh).
 *
 * Gated on the `searchEngine` feature flag (default OFF → 404). The NLM proxies
 * require only auth + flag (generic vocab lookups). The per-project load/save are
 * authorized by the SAME META·LAB project access as the project, and PERSIST via
 * the shared per-module workflow-state infra (moduleKey 'search') — so the search
 * builder is a first-class migrated workflow module while its engine stays its own
 * backend module.
 */
import { prisma } from '../db/client.js';
import { meshLookup, meshSuggest, pubmedCount } from './nlmClient.js';
import {
  resolveProjectAccess, getModuleState, patchModuleState, recordWorkflowAudit,
} from '../services/workflowState.js';
import { emitToMetaLabProject } from '../realtime/bus.js';

const SEARCH_MODULE = 'search';

/**
 * Normalize the persisted `ignored` list. Accepts the legacy string[] form OR the
 * richer object[] form {text, field, label}. Legacy strings become
 * {text, field:'', label:''}; objects keep their fields (coerced to strings).
 * Entries without usable text are dropped; the result is capped at 500.
 * Exported for unit tests.
 */
export function sanitizeIgnored(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (typeof e === 'string') {
      const text = e.trim();
      if (text) out.push({ text, field: '', label: '' });
    } else if (e && typeof e === 'object' && typeof e.text === 'string') {
      const text = e.text.trim();
      if (text) {
        out.push({
          text,
          field: typeof e.field === 'string' ? e.field : '',
          label: typeof e.label === 'string' ? e.label : '',
        });
      }
    }
    if (out.length >= 500) break;
  }
  return out;
}

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

export async function postMeshSuggest(req, res) {
  try {
    if (!(await searchEngineEnabled())) return res.status(404).json({ error: 'Not found' });
    const term = req.body && typeof req.body.term === 'string' ? req.body.term : '';
    if (!term.trim()) return res.json([]);
    return res.json(await meshSuggest(term)); // array of mesh records (possibly [])
  } catch (err) {
    console.error('[searchEngine] postMeshSuggest error:', err.message);
    return res.json([]); // degrade rather than 500 (frontend falls back to local seed)
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
    // `revision`/`updatedAt` ride alongside the saved state so the tab can tell a
    // genuinely-newer server document (from a collaborator) from its own last write
    // and reconcile on a realtime poke without clobbering in-progress edits.
    if (mod.revision <= 0) return res.json(null);
    // `updatedBy` lets the tab attribute a live update to the collaborator who made
    // it ("updated by …"); it is identity-only (id + name), no project content.
    return res.json({ ...mod.state, revision: mod.revision, updatedAt: mod.updatedAt, updatedBy: mod.updatedBy });
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
      // prompt40 Task 2/5 + prompt42 Task 2 — auto-suggestions the user deleted, so
      // a PICO re-sync never re-adds them. Accept BOTH the legacy string[] form and
      // the richer object[] form {text, field, label} (which preserves the PICO
      // field for granular per-field restore). Normalized + capped to keep the row
      // small; new fields are kept (not dropped).
      ignored: sanitizeIgnored(body.ignored),
      // SB3 Tab 3/5 — selected database ids ([] = use the catalogue defaults) and an
      // advisory "ready for Screening Import" marker. Additive + optional, validated
      // and capped so the row stays small; pre-SB3 searches simply omit them.
      databases: Array.isArray(body.databases)
        ? body.databases.filter((s) => typeof s === 'string').slice(0, 40)
        : [],
      readyForScreening: !!body.readyForScreening,
      // SB4 — dismissed Search-Quality/duplicate warning keys (validated + capped).
      dismissedWarnings: Array.isArray(body.dismissedWarnings)
        ? body.dismissedWarnings.filter((s) => typeof s === 'string').slice(0, 200)
        : [],
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
      // Live sync (SE1 Task 5): poke the workspace's other online collaborators so
      // their Search Builder refetches without a manual refresh. Thin "poke, don't
      // payload" event (no content); the editor is excluded (their UI already
      // reflects the change). Fire-and-forget — never fails or slows this request.
      emitToMetaLabProject(
        req.params.projectId, access.ownerId,
        { type: 'search.updated', revision: out.result.revision },
        { exclude: req.user.id },
      );
    }
    return res.json({ ok: true, revision: out.ok ? out.result.revision : undefined });
  } catch (err) {
    console.error('[searchEngine] putSearch error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
