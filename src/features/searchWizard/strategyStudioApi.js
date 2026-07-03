/**
 * strategyStudioApi.js — P11. Thin client for the guided Boolean strategy generator↔critic
 * loop ("Strategy Studio") + seed-study recall tooling, served by the search-builder
 * backend under /api/search-builder/projects/:projectId. Mirrors the fetch style of
 * searchVersionsApi / pecanSearchApi (session cookie via credentials:'include').
 *
 * The whole feature is gated server-side on the flag trio
 * (searchStrategyStudio && searchEngine && pecanSearch) — a 404 means the gate is off.
 * READ helpers that a returning user hits on mount (iterations, seed list) are SOFT:
 * they return a quiet empty shape rather than throwing, so a disabled/undeployed backend
 * never breaks the wizard. The user-initiated ACTIONS (generate, optimize, add/remove
 * seeds, recall estimate) THROW so the panel can surface an honest error line.
 */
const BASE = '/api/search-builder';
const pid = (projectId) => encodeURIComponent(projectId);
const sid = (seedId) => encodeURIComponent(seedId);

/** Shared fetch: parses JSON, throws with status on a non-OK response (action path). */
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
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const strategyStudioApi = {
  /**
   * Generate candidate strategies for each database. ACTION → THROWS on failure.
   * → { strategies:[{ database, profile, searchString, blocks:[...], filters, warnings }], notes:[] }
   */
  async generate(projectId, { databases, options } = {}) {
    const d = await http(`${BASE}/projects/${pid(projectId)}/strategy/generate`, { method: 'POST', body: { databases, options } });
    return {
      strategies: Array.isArray(d && d.strategies) ? d.strategies : [],
      notes: Array.isArray(d && d.notes) ? d.notes : [],
    };
  },

  /**
   * Run the guided generator↔critic optimization loop (synchronous, ~4 iterations,
   * ~25s). ACTION → THROWS on failure.
   * → { iterations:[{ iteration, database, searchString, hitCount, hitKind, critic, changes }], finalStrategy }
   */
  async optimize(projectId, { databases, options } = {}) {
    const d = await http(`${BASE}/projects/${pid(projectId)}/strategy/optimize`, { method: 'POST', body: { databases, options } });
    return {
      iterations: Array.isArray(d && d.iterations) ? d.iterations : [],
      finalStrategy: (d && d.finalStrategy) || null,
    };
  },

  /**
   * Stored iteration history. SOFT: quiet empty/unavailable shape on any failure so a
   * returning user's panel renders without throwing.
   * → { iterations:[...], available:boolean }
   */
  async iterations(projectId) {
    try {
      const d = await http(`${BASE}/projects/${pid(projectId)}/strategy/iterations`);
      const list = Array.isArray(d) ? d : (Array.isArray(d && d.iterations) ? d.iterations : []);
      return { iterations: list, available: true };
    } catch (e) {
      return { iterations: [], available: false, error: (e && e.message) || 'unavailable' };
    }
  },

  /** Download URL for the PRISMA-S search documentation (json|csv|html). Opened by the UI. */
  prismaSUrl(projectId, format = 'json') {
    const fmt = ['json', 'csv', 'html'].includes(format) ? format : 'json';
    return `${BASE}/projects/${pid(projectId)}/strategy/prisma-s?format=${fmt}`;
  },

  /** Fetch the PRISMA-S documentation as a JSON object. SOFT → { doc:null, available:false } on failure. */
  async prismaS(projectId) {
    try {
      const d = await http(`${BASE}/projects/${pid(projectId)}/strategy/prisma-s?format=json`);
      return { doc: d || null, available: true };
    } catch (e) {
      return { doc: null, available: false, status: e && e.status, error: (e && e.message) || 'unavailable' };
    }
  },

  /**
   * List seed studies. SOFT: quiet empty/unavailable shape on any failure.
   * → { seeds:[{id,title,doi,pmid,openAlexId,source}], available:boolean }
   */
  async listSeeds(projectId) {
    try {
      const d = await http(`${BASE}/projects/${pid(projectId)}/seed-studies`);
      const list = Array.isArray(d) ? d : (Array.isArray(d && d.seeds) ? d.seeds : []);
      return { seeds: list, available: true };
    } catch (e) {
      return { seeds: [], available: false, error: (e && e.message) || 'unavailable' };
    }
  },

  /** Add one or more seed studies. ACTION → THROWS on failure. Accepts an array of {title,doi?,pmid?}. */
  async addSeeds(projectId, seeds) {
    const arr = Array.isArray(seeds) ? seeds : [seeds];
    return http(`${BASE}/projects/${pid(projectId)}/seed-studies`, { method: 'POST', body: { seeds: arr } });
  },

  /** Remove a seed study by id. ACTION → THROWS on failure. */
  async removeSeed(projectId, seedId) {
    return http(`${BASE}/projects/${pid(projectId)}/seed-studies/${sid(seedId)}`, { method: 'DELETE' });
  },

  /**
   * Estimate recall of the current search against the seed studies. ACTION → THROWS.
   * source:'probe' checks the live strategy (no run needed); source:'run' checks a
   * completed run (runId) or a saved strategy version (strategyVersionId).
   * → { seedTotal, foundCount, found, notFound, estimatedRecall, missingAnalysis, suggestions }
   */
  async recallEstimate(projectId, { source = 'probe', runId, strategyVersionId } = {}) {
    return http(`${BASE}/projects/${pid(projectId)}/recall-estimate`, { method: 'POST', body: { source, runId, strategyVersionId } });
  },
};

export default strategyStudioApi;
