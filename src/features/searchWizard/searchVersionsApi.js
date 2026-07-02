/**
 * searchVersionsApi.js — 69.md. Client for the search-strategy VERSION registry +
 * the reproducible "methods paragraph" text, served by the searchEngine backend
 * (the parallel 69.md server work) under /api/search-builder/:projectId.
 *
 * Contract (from the 69.md server task; follow the landed CODE if a detail differs):
 *   GET  /:projectId/versions            → { versions:[{id,version,name,isFinal,note,
 *                                            createdByName,createdAt}], currentMatchesVersion? }
 *   POST /:projectId/versions {name,note} → save a snapshot of the current draft
 *   GET  /:projectId/versions/:vid        → full snapshot { ...version, strategy:{concepts,...} }
 *   POST /:projectId/versions/:vid/restore → overwrite the current draft from a version
 *   POST /:projectId/versions/:vid/final   → mark a version final
 *   GET  /:projectId/versions/compare?a=&b= → { diff }
 *   GET  /:projectId/methods-text          → { text }
 *
 * Every call rides the session cookie (credentials:'include'). Because this whole
 * feature is `searchEngine`-flag-gated on the server (404/disabled when off), the
 * READ helpers here are SOFT: they return a quiet empty/unavailable shape rather than
 * throwing, so the wizard never breaks when the backend is off or not yet deployed.
 * WRITE helpers THROW so the UI can surface a real failure to the user.
 */
const BASE = '/api/search-builder';
const pid = (projectId) => encodeURIComponent(projectId);
const vid = (versionId) => encodeURIComponent(versionId);

/** Shared fetch that parses JSON and throws on a non-OK response (write path). */
async function jfetch(url, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const searchVersionsApi = {
  /**
   * List saved versions. SOFT: on any failure (flag off → 404, or network down) returns
   * a quiet, non-throwing shape so the panel can render a small "unavailable" note.
   * → { versions:[...], currentMatchesVersion?, available:boolean }
   */
  async list(projectId) {
    try {
      const d = await jfetch(`${BASE}/${pid(projectId)}/versions`);
      return {
        versions: Array.isArray(d && d.versions) ? d.versions : [],
        currentMatchesVersion: d && d.currentMatchesVersion != null ? d.currentMatchesVersion : null,
        available: true,
      };
    } catch (e) {
      return { versions: [], currentMatchesVersion: null, available: false, error: (e && e.message) || 'unavailable' };
    }
  },

  /** Save the current draft as a new named version. THROWS on failure (real user action). */
  async save(projectId, { name, note } = {}) {
    return jfetch(`${BASE}/${pid(projectId)}/versions`, { method: 'POST', body: { name, note } });
  },

  /** Fetch a full version snapshot (its strategy) by id. THROWS on failure. */
  async get(projectId, versionId) {
    return jfetch(`${BASE}/${pid(projectId)}/versions/${vid(versionId)}`);
  },

  /** Restore the current draft from a version (overwrites). THROWS on failure. */
  async restore(projectId, versionId) {
    return jfetch(`${BASE}/${pid(projectId)}/versions/${vid(versionId)}/restore`, { method: 'POST', body: {} });
  },

  /** Mark a version as the final search strategy. THROWS on failure. */
  async markFinal(projectId, versionId) {
    return jfetch(`${BASE}/${pid(projectId)}/versions/${vid(versionId)}/final`, { method: 'POST', body: {} });
  },

  /**
   * Compare two versions → { diff }. SOFT: returns { diff:null, available:false } on
   * failure so the compare view can show a quiet note instead of exploding.
   */
  async compare(projectId, a, b) {
    try {
      const qs = new URLSearchParams({ a: String(a), b: String(b) }).toString();
      const d = await jfetch(`${BASE}/${pid(projectId)}/versions/compare?${qs}`);
      return { diff: (d && d.diff) || null, available: true };
    } catch (e) {
      return { diff: null, available: false, error: (e && e.message) || 'unavailable' };
    }
  },

  /**
   * Fetch the reproducible methods paragraph. SOFT: returns { text:'', available:false }
   * on failure (a 404 means the searchEngine flag is off → the panel hints at Ops).
   * → { text, available:boolean, status? }
   */
  async methodsText(projectId) {
    try {
      const d = await jfetch(`${BASE}/${pid(projectId)}/methods-text`);
      return { text: (d && typeof d.text === 'string') ? d.text : '', available: true };
    } catch (e) {
      return { text: '', available: false, status: e && e.status, error: (e && e.message) || 'unavailable' };
    }
  },
};
