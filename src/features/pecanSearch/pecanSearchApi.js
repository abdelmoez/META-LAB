/**
 * pecanSearchApi.js — authenticated client for the Pecan Search Engine (P1)
 * backend (server/routes/pecanSearch.js, mounted at /api/pecan-search). Every
 * call uses the app's session cookie (credentials:'include'); HTTP/network
 * failures THROW so the workspace can surface an honest error/limited state.
 *
 * The canonical query is NOT a flat string — it is the structured concept model
 * the user built in the Search Builder ({ concepts, filters }). loadCanonicalQuery
 * reads it straight from the search-builder backend (GET /api/search-builder/:pid)
 * so Search & Discovery and the Search Builder share ONE source of truth.
 *
 * Secrets never cross this seam: the providers endpoint returns a key-free shape;
 * we never send or render an API key. Idempotency-Key guards run creation so a
 * double-click / retry never launches two runs.
 */
const BASE = '/api/pecan-search';
const SB_BASE = '/api/search-builder';

/** A short, dependency-free idempotency token (crypto.randomUUID when present). */
export function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  // RFC4122-ish v4 fallback for older/test environments.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Build a project-scoped URL with optional query params (skip/take). */
export function runsUrl(projectId, params) {
  const qs = params ? new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString() : '';
  return `${BASE}/projects/${encodeURIComponent(projectId)}/runs${qs ? `?${qs}` : ''}`;
}

/** The report export URL (download/open in a new tab). format: json|csv|html. */
export function reportExportUrl(projectId, runId, format = 'json') {
  const fmt = ['json', 'csv', 'html'].includes(format) ? format : 'json';
  return `${BASE}/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/report/export?format=${fmt}`;
}

async function http(url, { method = 'GET', body, headers } = {}) {
  const opts = { method, credentials: 'include', headers: { ...(headers || {}) } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    let payload = null;
    try { payload = await r.json(); } catch { /* non-JSON error body */ }
    const err = new Error((payload && (payload.error || payload.code)) || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = payload && payload.code;
    throw err;
  }
  // 204 / empty body → null
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

const pid = (projectId) => encodeURIComponent(projectId);
const rid = (runId) => encodeURIComponent(runId);

export const pecanSearchApi = {
  // ── Provider catalogue (flag + auth only; no project scope) ────────────────
  // → { providers:[{id,label,platform,available,requiresCredentials,configured,
  //      supportsCountPreview,maxResults,defaultCap,maxCap,implemented,selectable}],
  //     engine:{defaultResultCap,maxResultCap} }
  async getProviders() {
    return http(`${BASE}/providers`);
  },

  // ── Query helpers (project-scoped) ─────────────────────────────────────────
  // → { ok, errors:[], warnings:[] }
  async validate(projectId, canonicalQuery) {
    return http(`${BASE}/projects/${pid(projectId)}/validate`, { method: 'POST', body: { canonicalQuery } });
  },
  // → { translations: { [id]: {available,query,queryHash,warnings,supported,unsupported,assumptions,hasOverride} } }
  async translate(projectId, { canonicalQuery, sources, overrides } = {}) {
    return http(`${BASE}/projects/${pid(projectId)}/translate`, { method: 'POST', body: { canonicalQuery, sources, overrides } });
  },
  // → { counts: { [id]: {count,kind,at,cached?} } }  kind: estimated|exact|unsupported|unavailable
  async previewCount(projectId, { canonicalQuery, sources, overrides } = {}) {
    return http(`${BASE}/projects/${pid(projectId)}/preview-count`, { method: 'POST', body: { canonicalQuery, sources, overrides } });
  },

  // ── Runs ────────────────────────────────────────────────────────────────────
  // → 202 { run, created } (or 200 { run, created:false } on idempotent replay)
  async startRun(projectId, { name, canonicalQuery, sources, caps } = {}, idempotencyKey) {
    return http(runsUrl(projectId), {
      method: 'POST',
      body: { name, canonicalQuery, sources, caps },
      headers: { 'Idempotency-Key': idempotencyKey || newIdempotencyKey() },
    });
  },
  // → { runs, total, skip, take }
  async listRuns(projectId, { skip = 0, take = 20 } = {}) {
    return http(runsUrl(projectId, { skip, take }));
  },
  // → { run }
  async getRun(projectId, runId) {
    return http(`${BASE}/projects/${pid(projectId)}/runs/${rid(runId)}`);
  },
  // → { ok, state }
  async cancelRun(projectId, runId) {
    return http(`${BASE}/projects/${pid(projectId)}/runs/${rid(runId)}/cancel`, { method: 'POST', body: {} });
  },
  // → { run }
  async retryRun(projectId, runId) {
    return http(`${BASE}/projects/${pid(projectId)}/runs/${rid(runId)}/retry`, { method: 'POST', body: {} });
  },

  // ── Duplicate review ──────────────────────────────────────────────────────────
  // → { candidates:[{id,score,matchType,reasons,conflicts,components,ruleVersion,incoming,existing}], total, skip, take }
  async listDuplicates(projectId, runId, { skip = 0, take = 50 } = {}) {
    const qs = new URLSearchParams({ skip: String(skip), take: String(take) }).toString();
    return http(`${BASE}/projects/${pid(projectId)}/runs/${rid(runId)}/duplicates?${qs}`);
  },
  // action: 'merge' | 'keep_separate' | 'defer' → { ok, decision }
  async resolveDuplicate(projectId, runId, decisionId, action) {
    return http(`${BASE}/projects/${pid(projectId)}/runs/${rid(runId)}/duplicates/${encodeURIComponent(decisionId)}/resolve`, { method: 'POST', body: { action } });
  },

  // ── Report ──────────────────────────────────────────────────────────────────
  // → { report } (structured PRISMA-S report)
  async getReport(projectId, runId) {
    return http(`${BASE}/projects/${pid(projectId)}/runs/${rid(runId)}/report`);
  },
  reportExportUrl,
};

/**
 * loadCanonicalQuery(projectId) — read the saved search strategy concepts from the
 * Search Builder backend and shape them as a canonical query { concepts, filters }.
 * The search-builder state stores { concepts, overrides, ignored, ... } (or null
 * when nothing is saved). We pass concepts straight through (the backend AST
 * normalizer is defensive) and default filters to an empty block.
 *
 * Returns { concepts, filters, revision, updatedAt } or null on no-saved-strategy.
 * Network failure THROWS so the caller can distinguish "down" from "nothing saved".
 */
export async function loadCanonicalQuery(projectId) {
  const r = await fetch(`${SB_BASE}/${pid(projectId)}`, { credentials: 'include' });
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const text = await r.text();
  if (!text) return null;
  let d;
  try { d = JSON.parse(text); } catch { return null; }
  if (!d) return null; // genuine "no saved strategy"
  return {
    concepts: Array.isArray(d.concepts) ? d.concepts : [],
    filters: (d.filters && typeof d.filters === 'object') ? d.filters : { dateFrom: '', dateTo: '', languages: [], pubTypes: [] },
    overrides: d.overrides || {},
    // prompt60 seam fix #1/#2 — surface the persisted database selection + handoff
    // marker so the run step seeds its sources from what the user chose in the
    // builder (instead of always defaulting to every provider). `databases` are
    // Search-Builder catalogue ids; the run step intersects them with its provider ids.
    databases: Array.isArray(d.databases) ? d.databases.filter((s) => typeof s === 'string') : [],
    readyForScreening: !!d.readyForScreening,
    revision: d.revision,
    updatedAt: d.updatedAt,
  };
}

/**
 * selectSourceIds — prompt60 seam fix #1. Decide which run sources to pre-select from
 * what the user chose in the Search Builder. The builder's database catalogue ids only
 * PARTIALLY overlap Pecan's provider ids (e.g. the builder lists embase/cochrane, which
 * Pecan has no connector for), so we intersect with the providers that actually run.
 *
 * Precedence: explicit `initialSources` (the wizard's live selection) → the strategy's
 * saved `databases` → the catalogue `defaults`. Intersect with `selectableIds`; if
 * NOTHING runnable matched, fall back to all selectable so the run is never silently
 * empty. Pure + exported for unit tests.
 */
export function selectSourceIds({ initialSources, databases, defaults, selectableIds } = {}) {
  const sel = Array.isArray(selectableIds) ? selectableIds : [];
  const want = (Array.isArray(initialSources) && initialSources.length) ? initialSources
    : ((Array.isArray(databases) && databases.length) ? databases
      : (Array.isArray(defaults) ? defaults : []));
  const chosen = want.filter((id) => sel.includes(id));
  return chosen.length ? chosen : sel;
}

/**
 * Gate the Search & Discovery (run) capability client-side. Prompt 60 — the run
 * stage is INERT unless BOTH `pecanSearch` AND its dependency `searchEngine` are
 * ON (the engine runs the strategy built by the Search Builder). Mirrors the
 * server gate (runService.pecanSearchEnabled). Default OFF on any error so a
 * disabled flag never does work.
 */
export async function pecanSearchFlagEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    const f = (d && d.featureFlags) || {};
    return f.pecanSearch === true && f.searchEngine === true;
  } catch {
    return false;
  }
}
