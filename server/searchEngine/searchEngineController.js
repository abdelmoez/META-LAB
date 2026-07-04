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
import {
  snapshotVersion, listVersions, getVersion, restoreVersion, setFinal,
  loadLiveStrategy, recentRunCounts,
} from './searchVersionService.js';
import { diffStrategies } from '../../src/research-engine/searchBuilder/versionDiff.js';
import { buildSearchMethodsText } from '../../src/research-engine/searchBuilder/methodsText.js';

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

/**
 * Normalize the persisted `filters` block (prompt 60 — seam fix #3). The Pecan
 * Search AST already reads/applies a { dateFrom, dateTo, languages[], pubTypes[] }
 * filters block (server/pecanSearch/query/ast.js), but the Search Builder never
 * persisted it. Mirror the AST's defensive clamps here so the saved shape is
 * exactly what the engine consumes. Always returns the full shape (empty fields
 * when absent). Exported for unit tests.
 */
export function sanitizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n).trim();
  const arr = (v, n, cap) => (Array.isArray(v)
    ? v.map((x) => str(x, n)).filter(Boolean).slice(0, cap)
    : []);
  return {
    dateFrom: str(f.dateFrom, 10),
    dateTo: str(f.dateTo, 10),
    languages: arr(f.languages, 20, 20),
    pubTypes: arr(f.pubTypes, 60, 40),
  };
}

/**
 * 73.md P5 — the two-path search mode marker. Strictly 'manual' | 'automated';
 * anything else (junk, legacy shapes) collapses to null (= not chosen yet).
 * Exported for unit tests.
 */
export function sanitizeSearchMode(raw) {
  return raw === 'manual' || raw === 'automated' ? raw : null;
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
    // 73.md P5 — always surface a valid `searchMode` ('manual'|'automated'|null) so
    // clients never have to re-validate; older saves simply read as null.
    return res.json({
      ...mod.state,
      searchMode: sanitizeSearchMode(mod.state && mod.state.searchMode),
      revision: mod.revision, updatedAt: mod.updatedAt, updatedBy: mod.updatedBy,
    });
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
    // 73.md recs round — EVERY key is written only when the client names it.
    // patchModuleState's mergePatch is a shallow top-level merge, so a partial body
    // (e.g. the workspace persisting only { searchMode }) can never reset the keys
    // it omits to their defaults — previously a mode/ready toggle that failed to
    // read the saved state back would replay `concepts: []` and wipe the strategy.
    // Full-shape callers (the Search Builder autosave, version restore) still
    // overwrite every key exactly as before.
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const value = {};
    if (has('concepts')) value.concepts = Array.isArray(body.concepts) ? body.concepts : [];
    if (has('overrides')) value.overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
    // prompt40 Task 2/5 + prompt42 Task 2 — auto-suggestions the user deleted, so
    // a PICO re-sync never re-adds them. Accept BOTH the legacy string[] form and
    // the richer object[] form {text, field, label} (which preserves the PICO
    // field for granular per-field restore). Normalized + capped to keep the row
    // small; new fields are kept (not dropped).
    if (has('ignored')) value.ignored = sanitizeIgnored(body.ignored);
    // SB3 Tab 3/5 — selected database ids ([] = use the catalogue defaults) and an
    // advisory "ready for Screening Import" marker. Additive + optional, validated
    // and capped so the row stays small; pre-SB3 searches simply omit them.
    if (has('databases')) {
      value.databases = Array.isArray(body.databases)
        ? body.databases.filter((s) => typeof s === 'string').slice(0, 40)
        : [];
    }
    if (has('readyForScreening')) value.readyForScreening = !!body.readyForScreening;
    // SB4 — dismissed Search-Quality/duplicate warning keys (validated + capped).
    if (has('dismissedWarnings')) {
      value.dismissedWarnings = Array.isArray(body.dismissedWarnings)
        ? body.dismissedWarnings.filter((s) => typeof s === 'string').slice(0, 200)
        : [];
    }
    // prompt60 — search scope limits (date range / languages / publication types).
    // The Pecan Search AST already reads this block but it was never persisted; the
    // Search Wizard's Limits panel writes it here. JSON in WorkflowModuleState → no
    // migration. Defensive clamp via sanitizeFilters.
    if (has('filters')) value.filters = sanitizeFilters(body.filters);
    // 73.md P5 — additive two-path marker ('manual' | 'automated' | null).
    if (has('searchMode')) value.searchMode = sanitizeSearchMode(body.searchMode);
    // baseRevision null = overwrite (the contract's PUT is a full upsert; the
    // search builder is single-strategy-per-project so last-write-wins is fine).
    const out = await patchModuleState({
      projectId: req.params.projectId, moduleKey: SEARCH_MODULE, patch: value, baseRevision: null, user: req.user,
    });
    if (out.ok) {
      await recordWorkflowAudit({
        projectId: req.params.projectId, moduleKey: SEARCH_MODULE, action: 'SEARCH_UPDATED',
        revision: out.result.revision, user: req.user,
        details: { concepts: Array.isArray(value.concepts) ? value.concepts.length : undefined },
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

// ── Search-strategy VERSIONS (69.md §7 — reproducible, restorable snapshots) ───
// All version endpoints share getSearch/putSearch's access + flag gate. WRITES
// (snapshot / restore / mark-final) require canEdit — the same right putSearch needs.

export async function postSearchVersion(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    if (!access.canEdit) return res.status(403).json({ error: 'Read-only access' });

    const body = req.body || {};
    const out = await snapshotVersion(prisma, {
      projectId: req.params.projectId, name: body.name, note: body.note, user: req.user,
    });
    if (out.error === 'no_strategy') {
      return res.status(400).json({ error: 'No saved search strategy to snapshot yet.' });
    }
    await recordWorkflowAudit({
      projectId: req.params.projectId, moduleKey: SEARCH_MODULE, action: 'SEARCH_VERSION_SAVED',
      revision: out.row.version, user: req.user,
      details: { versionId: out.row.id, version: out.row.version, name: out.row.name },
    });
    return res.status(201).json(out.row);
  } catch (err) {
    console.error('[searchEngine] postSearchVersion error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSearchVersions(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const out = await listVersions(prisma, req.params.projectId);
    return res.json(out); // { versions[], currentMatch, currentHash }
  } catch (err) {
    console.error('[searchEngine] getSearchVersions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSearchVersion(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const out = await getVersion(prisma, req.params.projectId, req.params.vid);
    if (!out) return res.status(404).json({ error: 'Version not found' });
    return res.json(out);
  } catch (err) {
    console.error('[searchEngine] getSearchVersion error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function postSearchVersionRestore(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    if (!access.canEdit) return res.status(403).json({ error: 'Read-only access' });

    const out = await restoreVersion(prisma, {
      projectId: req.params.projectId, versionId: req.params.vid, user: req.user,
    });
    if (out.error === 'not_found') return res.status(404).json({ error: 'Version not found' });
    if (out.error) return res.status(500).json({ error: 'Restore failed' });

    await recordWorkflowAudit({
      projectId: req.params.projectId, moduleKey: SEARCH_MODULE, action: 'SEARCH_VERSION_RESTORED',
      revision: out.revision, user: req.user,
      details: { versionId: req.params.vid, version: out.version },
    });
    // Same live-sync poke putSearch emits, so collaborators' Search Builders refetch.
    emitToMetaLabProject(
      req.params.projectId, access.ownerId,
      { type: 'search.updated', revision: out.revision },
      { exclude: req.user.id },
    );
    return res.json({ ok: true, revision: out.revision });
  } catch (err) {
    console.error('[searchEngine] postSearchVersionRestore error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function postSearchVersionFinal(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    if (!access.canEdit) return res.status(403).json({ error: 'Read-only access' });

    const isFinal = req.body ? req.body.isFinal !== false : true; // default true
    const out = await setFinal(prisma, {
      projectId: req.params.projectId, versionId: req.params.vid, isFinal,
    });
    if (out.error === 'not_found') return res.status(404).json({ error: 'Version not found' });

    await recordWorkflowAudit({
      projectId: req.params.projectId, moduleKey: SEARCH_MODULE, action: 'SEARCH_VERSION_FINAL_SET',
      revision: out.row.version, user: req.user,
      details: { versionId: req.params.vid, version: out.row.version, isFinal: !!isFinal },
    });
    return res.json(out.row);
  } catch (err) {
    console.error('[searchEngine] postSearchVersionFinal error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getSearchVersionsCompare(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const aId = req.query && typeof req.query.a === 'string' ? req.query.a : '';
    const bId = req.query && typeof req.query.b === 'string' ? req.query.b : '';
    if (!aId || !bId) return res.status(400).json({ error: 'Both a and b version ids are required.' });

    const [a, b] = await Promise.all([
      getVersion(prisma, req.params.projectId, aId),
      getVersion(prisma, req.params.projectId, bId),
    ]);
    if (!a || !b) return res.status(404).json({ error: 'Version not found' });

    const diff = diffStrategies(a.strategy, b.strategy);
    return res.json({
      a: { id: a.id, version: a.version, name: a.name },
      b: { id: b.id, version: b.version, name: b.name },
      diff,
    });
  } catch (err) {
    console.error('[searchEngine] getSearchVersionsCompare error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Methods-paragraph export (69.md §8 — manuscript-ready, never fabricated) ────

export async function getSearchMethodsText(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;

    const [strategy, { versions }, runs] = await Promise.all([
      loadLiveStrategy(prisma, req.params.projectId),
      listVersions(prisma, req.params.projectId),
      recentRunCounts(prisma, req.params.projectId),
    ]);

    // Shape recent runs into the { provider, date, count } the pure fn consumes. A
    // pecan run aggregates per-source counts in `counts` (JSON); we surface the raw
    // retrieved total per run keyed by the run name (a run spans multiple providers,
    // so "provider" here is the run label — honest, not fabricated).
    const runInputs = (runs || [])
      .filter((r) => r.state === 'completed' || r.state === 'partial')
      .map((r) => {
        let count = null;
        try {
          const c = JSON.parse(r.counts || '{}');
          if (Number.isFinite(Number(c.rawRetrieved))) count = Number(c.rawRetrieved);
          else if (Number.isFinite(Number(c.imported))) count = Number(c.imported);
        } catch { count = null; }
        return { provider: r.name || 'search run', date: r.completedAt || r.createdAt, count };
      })
      .slice(0, 8);

    const text = buildSearchMethodsText({ strategy, versions, runs: runInputs });
    return res.json({ text });
  } catch (err) {
    console.error('[searchEngine] getSearchMethodsText error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
