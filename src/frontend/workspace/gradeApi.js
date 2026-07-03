/**
 * gradeApi.js — P12 (frontend). Thin client for the per-outcome GRADE certainty +
 * Summary-of-Findings API (server routes/grade.js, mounted at /api/grade), plus a
 * small self-detect helper for the `gradeCertainty` feature flag.
 *
 * Contract (server/routes/grade.js + gradeController.js — follow the landed CODE if a
 * detail differs):
 *   GET  /projects/:pid/outcomes             → { outcomes:[…], count }
 *   GET  /projects/:pid/outcomes/:key        → { outcome }
 *   PUT  /projects/:pid/outcomes/:key { domains, notes?, startLevel? } → { outcome }
 *   POST /projects/:pid/outcomes/:key/lock   → { outcome }
 *   POST /projects/:pid/outcomes/:key/unlock → { outcome }
 *   GET  /projects/:pid/audit                → { entries:[…] }
 *   GET  /projects/:pid/sof?format=json|csv|html
 *        json → { table, gradeByOutcome:{[key]:certaintyString}, footnotes, outcomes }
 *        csv/html → raw downloadable content.
 *
 * Every call rides the session cookie (credentials:'include'). Because the whole
 * feature is `gradeCertainty`-flag-gated on the server (404 when OFF), the READ helpers
 * are SOFT — they return a quiet, non-throwing shape so a caller can render a calm
 * "unavailable" note. The WRITE helpers (save/lock/unlock) THROW so the UI can surface
 * a real failure, including the typed 409s (err.code === 'GRADE_LOCKED' | 'GRADE_NOT_SAVED').
 */
const BASE = '/api/grade';
const pid = (p) => encodeURIComponent(p);
const key = (k) => encodeURIComponent(k);

/**
 * gradeCertaintyEnabled — reads the public feature flags and returns true only when
 * `gradeCertainty` is ON. Mirrors manuscriptEditorFlagEnabled (eager, tiny). Used by
 * the GRADE tab to switch between the legacy body (flag OFF) and the new per-outcome
 * workspace (flag ON), and by the manuscript hook to decide whether to fetch the SoF.
 */
export async function gradeCertaintyEnabled() {
  try {
    const r = await fetch('/api/settings/public', { credentials: 'include' });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.featureFlags && d.featureFlags.gradeCertainty === true);
  } catch {
    return false;
  }
}

/** Shared fetch: parses JSON, throws a typed error (status + server `code`) on non-OK. */
async function jfetch(url, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const text = await r.text().catch(() => '');
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  if (!r.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${r.status}`);
    err.status = r.status;
    err.code = data && data.code;
    throw err;
  }
  return data;
}

const modelQs = (model) => (model === 'fixed' ? 'model=fixed' : '');

export const gradeApi = {
  /** List every outcome with meta summary, engine suggestions, and any stored assessment. SOFT. */
  async listOutcomes(projectId, { model } = {}) {
    try {
      const qs = modelQs(model);
      const d = await jfetch(`${BASE}/projects/${pid(projectId)}/outcomes${qs ? `?${qs}` : ''}`);
      return { outcomes: Array.isArray(d && d.outcomes) ? d.outcomes : [], available: true };
    } catch (e) {
      return { outcomes: [], available: false, status: e && e.status, error: (e && e.message) || 'unavailable' };
    }
  },

  /** One outcome by key (freshest single view). SOFT (returns { outcome:null } on failure). */
  async getOutcome(projectId, outcomeKey, { model } = {}) {
    try {
      const qs = modelQs(model);
      const d = await jfetch(`${BASE}/projects/${pid(projectId)}/outcomes/${key(outcomeKey)}${qs ? `?${qs}` : ''}`);
      return { outcome: (d && d.outcome) || null, available: true };
    } catch (e) {
      return { outcome: null, available: false, status: e && e.status, error: (e && e.message) || 'unavailable' };
    }
  },

  /**
   * Save a reviewer's confirmed domain ratings for one outcome. THROWS on failure —
   * a 409 GRADE_LOCKED surfaces as err.code so the UI can explain the lock.
   * @returns the recomputed outcome DTO.
   */
  async saveOutcome(projectId, outcomeKey, payload) {
    const d = await jfetch(`${BASE}/projects/${pid(projectId)}/outcomes/${key(outcomeKey)}`, { method: 'PUT', body: payload || {} });
    return (d && d.outcome) || null;
  },

  /** Lock an outcome (owner/leader). THROWS (409 GRADE_NOT_SAVED if never saved). → outcome DTO */
  async lock(projectId, outcomeKey) {
    const d = await jfetch(`${BASE}/projects/${pid(projectId)}/outcomes/${key(outcomeKey)}/lock`, { method: 'POST', body: {} });
    return (d && d.outcome) || null;
  },

  /** Unlock an outcome (owner/leader). THROWS. → outcome DTO */
  async unlock(projectId, outcomeKey) {
    const d = await jfetch(`${BASE}/projects/${pid(projectId)}/outcomes/${key(outcomeKey)}/unlock`, { method: 'POST', body: {} });
    return (d && d.outcome) || null;
  },

  /** Append-only audit history (newest first). SOFT. */
  async audit(projectId) {
    try {
      const d = await jfetch(`${BASE}/projects/${pid(projectId)}/audit`);
      return { entries: Array.isArray(d && d.entries) ? d.entries : [], available: true };
    } catch (e) {
      return { entries: [], available: false, error: (e && e.message) || 'unavailable' };
    }
  },

  /**
   * Summary-of-Findings as JSON. SOFT.
   * → { table, gradeByOutcome:{[key]:certaintyString}, footnotes, outcomes, available }
   */
  async sof(projectId, { model } = {}) {
    try {
      const qs = modelQs(model);
      const d = await jfetch(`${BASE}/projects/${pid(projectId)}/sof?format=json${qs ? `&${qs}` : ''}`);
      return { ...(d || {}), available: true };
    } catch (e) {
      return { table: null, gradeByOutcome: {}, footnotes: [], outcomes: [], available: false, status: e && e.status, error: (e && e.message) || 'unavailable' };
    }
  },

  /** Same-origin URL for a downloadable SoF (csv|html|json) — used in an <a href download>. */
  sofUrl(projectId, format = 'csv') {
    const f = ['csv', 'html', 'json'].includes(format) ? format : 'csv';
    return `${BASE}/projects/${pid(projectId)}/sof?format=${f}`;
  },
};

/**
 * certaintyOf — normalise one gradeByOutcome value to a plain certainty STRING. The SoF
 * endpoint already flattens gradeByOutcome to { [key]: 'Moderate' } strings, but the pure
 * engine's buildGradeByOutcome returns { [key]: { certainty, footnotes } } objects; accept
 * both so the caller always ends up with a string cell value.
 */
export function certaintyOf(v) {
  if (v && typeof v === 'object') return String(v.certainty || v.level || '');
  return String(v == null ? '' : v);
}

/**
 * sofCertaintyMap — fetch the SoF and flatten gradeByOutcome to a plain
 * { [pair.key]: certaintyString } map for the manuscript SoF table
 * (buildSummaryOfFindingsTable reads opts.gradeByOutcome[pair.key]). Empty when the
 * flag is off / no access (SOFT), which leaves the certainty column blank — exactly the
 * flag-OFF behaviour.
 * @returns { map, footnotes, available }
 */
export async function sofCertaintyMap(projectId, opts = {}) {
  const d = await gradeApi.sof(projectId, opts);
  const raw = (d && d.gradeByOutcome) || {};
  const map = {};
  for (const k of Object.keys(raw)) { const c = certaintyOf(raw[k]); if (c) map[k] = c; }
  return { map, footnotes: (d && d.footnotes) || [], available: !!(d && d.available) };
}

export default gradeApi;
