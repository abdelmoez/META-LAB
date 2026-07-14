/**
 * searchVersionService.js — 69.md §7/§8. Named, restorable VERSIONS of a project's
 * Search-Builder strategy, plus the reproducibility helpers that sit on top of them.
 *
 * A "version" is an immutable snapshot of the live `search` workflow-module state
 * (the single strategy-per-project persisted by putSearch). Snapshots let a team
 * freeze a strategy for the manuscript, diff two strategies, and restore an earlier
 * one — the systematic-review reproducibility story ("who changed what, when; which
 * strategy was final").
 *
 * This module is the DB + business layer (no Express). The HTTP handlers live in
 * searchEngineController.js and reuse these functions; the pure diff/methods-text
 * helpers live under src/research-engine/searchBuilder/ and are imported here.
 *
 * strategyHash — how "does version X match the CURRENT strategy?" is decided. The
 * frontend's strategyHash (src/features/searchBuilder) hashes a *rendered PubMed
 * query string*, not the strategy object, so it is the WRONG identity for this
 * purpose (two shape-identical strategies could render differently, and it is a
 * .jsx export not cleanly importable server-side). We therefore hash a canonicalized
 * JSON projection of the persisted shape (concepts/databases/filters with volatile
 * render ids and UI-only keys stripped, keys sorted). Documented + unit-tested.
 */
import crypto from 'crypto';
import { getModuleState, patchModuleState } from '../services/workflowState.js';
import { renderPlain } from '../pecanSearch/query/ast.js';

const SEARCH_MODULE = 'search';

/* ── Canonical projection + hash (strategy identity) ──────────────────────────
   Only the parts of the saved state that define the SEARCH are included; UI-only
   keys (readyForScreening, dismissedWarnings, overrides) and volatile render ids
   are deliberately excluded so two logically-identical strategies hash equal. */

const str = (v) => String(v == null ? '' : v);
const norm = (v) => str(v).toLowerCase().replace(/\s+/g, ' ').trim();

/** Stable, key-sorted stringify (order-independent for objects, order-preserving
 *  for arrays — array order is meaningful for concepts/terms display). */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** The search-defining projection of a saved strategy (drops UI-only + volatile). */
export function canonicalStrategyProjection(strategy) {
  const st = strategy && typeof strategy === 'object' ? strategy : {};
  const concepts = (Array.isArray(st.concepts) ? st.concepts : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      label: norm(c.label),
      picoField: str(c.picoField).trim().toUpperCase(),
      op: c.op === 'OR' ? 'OR' : 'AND',
      terms: (Array.isArray(c.terms) ? c.terms : [])
        // 85.md A1 — a disabled term is not part of the executed search, so it is not
        // part of the strategy's IDENTITY either: disabled ≡ absent. This makes a
        // disable toggle correctly flip `currentMatch`, and keeps every OLD save
        // (no `disabled` key anywhere) hashing byte-identically. Mirrors the shared
        // liveness rule in src/research-engine/searchBuilder/termLiveness.js.
        .filter((t) => t && typeof t === 'object' && str(t.text).trim() && t.disabled !== true)
        .map((t) => ({
          text: norm(t.text),
          field: norm(t.field) || 'tiab',
          type: t.type === 'controlled' ? 'controlled' : 'freetext',
        })),
    }))
    .filter((c) => c.terms.length > 0);
  const databases = [...new Set((Array.isArray(st.databases) ? st.databases : [])
    .map((d) => str(d).trim()).filter(Boolean))].sort();
  const f = st.filters && typeof st.filters === 'object' ? st.filters : {};
  const filters = {
    dateFrom: str(f.dateFrom).trim(),
    dateTo: str(f.dateTo).trim(),
    languages: (Array.isArray(f.languages) ? f.languages : []).map((x) => str(x).trim()).filter(Boolean),
    pubTypes: (Array.isArray(f.pubTypes) ? f.pubTypes : []).map((x) => str(x).trim()).filter(Boolean),
  };
  return { concepts, databases, filters };
}

/** Content hash of a strategy's search-defining projection. */
export function strategyContentHash(strategy) {
  return crypto.createHash('sha1')
    .update(stableStringify(canonicalStrategyProjection(strategy)), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/** Best-effort human-readable rendering of a saved strategy for canonicalText.
 *  The saved concept/term shape maps 1:1 onto the pecan canonical AST, so we render
 *  via renderPlain; if the strategy has no usable concepts we return ''. */
export function renderStrategyText(strategy) {
  try {
    const st = strategy && typeof strategy === 'object' ? strategy : {};
    if (!Array.isArray(st.concepts) || !st.concepts.length) return '';
    return renderPlain({ concepts: st.concepts, filters: st.filters || {} });
  } catch {
    return '';
  }
}

/* ── Snapshot / list / get / restore / mark-final ─────────────────────────── */

/** Load the live saved strategy (the `search` module state), or null if never saved. */
export async function loadLiveStrategy(prisma, projectId) {
  const mod = await getModuleState(projectId, SEARCH_MODULE);
  if (!mod || mod.revision <= 0) return null;
  return mod.state || {};
}

/**
 * snapshotVersion — freeze the CURRENT saved strategy into a new SearchStrategyVersion.
 * version = max(existing)+1 per project (computed under a small retry to survive a
 * concurrent double-submit; the row has no (project,version) unique constraint so we
 * defend in code). Returns the created row (without the strategy blob echoed back).
 */
export async function snapshotVersion(prisma, { projectId, name, note, user }) {
  const strategy = await loadLiveStrategy(prisma, projectId);
  if (strategy == null) return { error: 'no_strategy' };

  const strategyJson = JSON.stringify(strategy);
  const canonicalText = renderStrategyText(strategy);
  const cleanName = str(name).slice(0, 200).trim();
  const cleanNote = note == null ? null : str(note).slice(0, 4000);

  // Compute next version number; retry once on a rare create race.
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const top = await prisma.searchStrategyVersion.findFirst({
      where: { metaLabProjectId: projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (top ? top.version : 0) + 1;
    try {
      const row = await prisma.searchStrategyVersion.create({
        data: {
          metaLabProjectId: projectId,
          version: nextVersion,
          name: cleanName,
          strategy: strategyJson,
          canonicalText,
          note: cleanNote,
          createdById: (user && user.id) || null,
          createdByName: (user && user.name) || '',
        },
      });
      return { row: toVersionMeta(row), version: nextVersion };
    } catch (e) {
      lastErr = e;
      // No unique key on (project,version), so a collision is not a P2002 — but if a
      // future migration adds one, retry with a recomputed number. Otherwise rethrow.
      if (!e || e.code !== 'P2002') throw e;
    }
  }
  throw lastErr || new Error('snapshotVersion failed');
}

/** Public metadata shape (never echoes the strategy blob). */
export function toVersionMeta(row) {
  return {
    id: row.id,
    version: row.version,
    name: row.name || '',
    isFinal: !!row.isFinal,
    note: row.note || '',
    createdByName: row.createdByName || '',
    createdAt: row.createdAt,
  };
}

/**
 * listVersions — all versions for a project (newest first) as metadata only, PLUS
 * `currentMatch`: the version id whose snapshot equals the live strategy (or null).
 */
export async function listVersions(prisma, projectId) {
  const rows = await prisma.searchStrategyVersion.findMany({
    where: { metaLabProjectId: projectId },
    orderBy: { version: 'desc' },
  });
  const versions = rows.map(toVersionMeta);

  const live = await loadLiveStrategy(prisma, projectId);
  let currentMatch = null;
  let currentHash = null;
  if (live != null) {
    currentHash = strategyContentHash(live);
    for (const r of rows) {
      let snap = {};
      try { snap = JSON.parse(r.strategy || '{}'); } catch { snap = {}; }
      if (strategyContentHash(snap) === currentHash) { currentMatch = r.id; break; }
    }
  }
  return { versions, currentMatch, currentHash };
}

/** Full snapshot (incl. the strategy blob) for one version, or null. */
export async function getVersion(prisma, projectId, versionId) {
  const row = await prisma.searchStrategyVersion.findUnique({ where: { id: versionId } });
  if (!row || row.metaLabProjectId !== projectId) return null;
  let strategy = {};
  try { strategy = JSON.parse(row.strategy || '{}'); } catch { strategy = {}; }
  return { ...toVersionMeta(row), strategy, canonicalText: row.canonicalText || '' };
}

/**
 * restoreVersion — overwrite the live `search` module state with a version's snapshot,
 * through the SAME write path putSearch uses (patchModuleState on moduleKey 'search',
 * baseRevision null = full overwrite). Returns { ok, revision } or { error }.
 * The controller emits the same 'search.updated' poke putSearch does.
 */
export async function restoreVersion(prisma, { projectId, versionId, user }) {
  const row = await prisma.searchStrategyVersion.findUnique({ where: { id: versionId } });
  if (!row || row.metaLabProjectId !== projectId) return { error: 'not_found' };
  let strategy = {};
  try { strategy = JSON.parse(row.strategy || '{}'); } catch { strategy = {}; }
  // 73.md recs round — the two-path search mode is a workspace preference, not part
  // of the strategy content (it is excluded from the version content hash for the
  // same reason). Restoring an old snapshot must never flip the user's current mode,
  // so strip it before writing; the shallow merge then leaves the live value intact.
  if (strategy && typeof strategy === 'object') delete strategy.searchMode;

  const out = await patchModuleState({
    projectId, moduleKey: SEARCH_MODULE, patch: strategy, baseRevision: null, user,
  });
  if (!out.ok) return { error: 'write_failed' };
  return { ok: true, revision: out.result.revision, version: row.version };
}

/**
 * setFinal — mark a version final (isFinal=true clears the flag on all others so at
 * most one version is final at a time; isFinal=false just clears this one). Returns
 * the updated metadata or { error:'not_found' }.
 */
export async function setFinal(prisma, { projectId, versionId, isFinal }) {
  const row = await prisma.searchStrategyVersion.findUnique({ where: { id: versionId } });
  if (!row || row.metaLabProjectId !== projectId) return { error: 'not_found' };

  if (isFinal) {
    // Clear the flag on every other version for this project, then set it on this one.
    await prisma.searchStrategyVersion.updateMany({
      where: { metaLabProjectId: projectId, isFinal: true, NOT: { id: versionId } },
      data: { isFinal: false },
    });
  }
  const updated = await prisma.searchStrategyVersion.update({
    where: { id: versionId },
    data: { isFinal: !!isFinal },
  });
  return { row: toVersionMeta(updated) };
}

/** Recent executed pecan search runs for the methods-text endpoint (best-effort). */
export async function recentRunCounts(prisma, projectId, { limit = 12 } = {}) {
  try {
    const runs = await prisma.pecanSearchRun.findMany({
      where: { metaLabProjectId: projectId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(1, Number(limit) || 12), 50),
      select: { id: true, name: true, state: true, counts: true, completedAt: true, createdAt: true },
    });
    return runs;
  } catch {
    return [];
  }
}
