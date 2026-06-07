/**
 * META·LAB — REST API client
 *
 * All methods return the parsed JSON body.
 * On non-2xx responses the function throws an Error whose `message` is the
 * server's { "error": "..." } string (or the raw status text as a fallback).
 *
 * The backend runs on port 3001; Vite proxies /api → http://localhost:3001/api.
 */

const BASE = "/api";

/* ─── Internal helpers ──────────────────────────────────────────────── */

/**
 * Wraps fetch, parses JSON, and throws a meaningful error on non-ok status.
 * @param {string} url
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function req(url, opts = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  let body;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body (shouldn't happen with the current server, but be safe)
    body = null;
  }

  if (!res.ok) {
    const message =
      (body && body.error) ||
      `HTTP ${res.status} ${res.statusText}`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    throw err;
  }

  return body;
}

const json = (body) => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/* ─── Public API object ─────────────────────────────────────────────── */

export const api = {

  /* ── Health ──────────────────────────────────────────────────────── */

  /**
   * GET /api/health
   * @returns {{ status: string, timestamp: string, version: string }}
   */
  health: () => req(`${BASE}/health`),

  /* ── Projects ────────────────────────────────────────────────────── */

  projects: {
    /**
     * GET /api/projects — lightweight list (no studies/records arrays).
     * @returns {Promise<Array<{ id, name, createdAt, updatedAt }>>}
     */
    list: () => req(`${BASE}/projects`),

    /**
     * GET /api/projects/:id — full project including studies and records.
     * @param {string} id
     */
    get: (id) => req(`${BASE}/projects/${id}`),

    /**
     * POST /api/projects — create a new project.
     * @param {string} name
     * @returns {Promise<{ id, name, createdAt, updatedAt, studies, records }>}
     */
    create: (name) =>
      req(`${BASE}/projects`, { method: "POST", ...json({ name }) }),

    /**
     * PUT /api/projects/:id — partial update of top-level fields.
     * @param {string} id
     * @param {object} patch  e.g. { name, description }
     */
    update: (id, patch) =>
      req(`${BASE}/projects/${id}`, { method: "PUT", ...json(patch) }),

    /**
     * DELETE /api/projects/:id
     * @param {string} id
     * @returns {Promise<{ deleted: true }>}
     */
    delete: (id) =>
      req(`${BASE}/projects/${id}`, { method: "DELETE" }),
  },

  /* ── Studies ─────────────────────────────────────────────────────── */

  studies: {
    /**
     * GET /api/projects/:id/studies
     * @param {string} projectId
     */
    list: (projectId) => req(`${BASE}/projects/${projectId}/studies`),

    /**
     * POST /api/projects/:id/studies
     * @param {string} projectId
     * @param {object} study  Any subset of study fields (id is auto-generated).
     */
    create: (projectId, study) =>
      req(`${BASE}/projects/${projectId}/studies`, {
        method: "POST",
        ...json(study),
      }),

    /**
     * PUT /api/projects/:id/studies/:studyId
     * @param {string} projectId
     * @param {string} studyId
     * @param {object} patch
     */
    update: (projectId, studyId, patch) =>
      req(`${BASE}/projects/${projectId}/studies/${studyId}`, {
        method: "PUT",
        ...json(patch),
      }),

    /**
     * DELETE /api/projects/:id/studies/:studyId
     * @param {string} projectId
     * @param {string} studyId
     * @returns {Promise<{ deleted: true }>}
     */
    delete: (projectId, studyId) =>
      req(`${BASE}/projects/${projectId}/studies/${studyId}`, {
        method: "DELETE",
      }),
  },

  /* ── Records (citation screening) ───────────────────────────────── */

  records: {
    /**
     * GET /api/projects/:id/records
     * @param {string} projectId
     */
    list: (projectId) => req(`${BASE}/projects/${projectId}/records`),

    /**
     * POST /api/projects/:id/records
     * @param {string} projectId
     * @param {object} record
     */
    create: (projectId, record) =>
      req(`${BASE}/projects/${projectId}/records`, {
        method: "POST",
        ...json(record),
      }),

    /**
     * PUT /api/projects/:id/records/:recordId
     * @param {string} projectId
     * @param {string} recordId
     * @param {object} patch  e.g. { decision, notes }
     */
    update: (projectId, recordId, patch) =>
      req(`${BASE}/projects/${projectId}/records/${recordId}`, {
        method: "PUT",
        ...json(patch),
      }),

    /**
     * DELETE /api/projects/:id/records/:recordId
     * @param {string} projectId
     * @param {string} recordId
     * @returns {Promise<{ deleted: true }>}
     */
    delete: (projectId, recordId) =>
      req(`${BASE}/projects/${projectId}/records/${recordId}`, {
        method: "DELETE",
      }),
  },

  /* ── Meta-analysis ───────────────────────────────────────────────── */

  meta: {
    /**
     * POST /api/meta/run — pooled meta-analysis.
     * @param {object[]} studies
     * @param {'fixed'|'random'} [method='random']
     * @returns {Promise<MetaResult>}
     */
    run: (studies, method = "random") =>
      req(`${BASE}/meta/run`, { method: "POST", ...json({ studies, method }) }),

    /**
     * POST /api/meta/sensitivity — leave-one-out + influence diagnostics.
     * @param {object[]} studies
     * @param {'fixed'|'random'} [method='random']
     */
    sensitivity: (studies, method = "random") =>
      req(`${BASE}/meta/sensitivity`, {
        method: "POST",
        ...json({ studies, method }),
      }),

    /**
     * POST /api/meta/subgroup
     * @param {object[]} studies
     * @param {string}   groupKey  Study field to group by (e.g. "design")
     * @param {'fixed'|'random'} [method='random']
     */
    subgroup: (studies, groupKey, method = "random") =>
      req(`${BASE}/meta/subgroup`, {
        method: "POST",
        ...json({ studies, groupKey, method }),
      }),

    /**
     * POST /api/meta/egger — Egger's test for publication bias.
     * @param {object[]} studies
     */
    egger: (studies) =>
      req(`${BASE}/meta/egger`, {
        method: "POST",
        ...json({ studies }),
      }),

    /**
     * POST /api/meta/trimfill — trim-and-fill bias adjustment.
     * @param {object[]} studies
     * @param {'fixed'|'random'} [method='random']
     */
    trimFill: (studies, method = "random") =>
      req(`${BASE}/meta/trimfill`, {
        method: "POST",
        ...json({ studies, method }),
      }),
  },

  /* ── Validation ──────────────────────────────────────────────────── */

  validation: {
    /**
     * POST /api/validation/check
     * @param {object[]} studies
     */
    check: (studies) =>
      req(`${BASE}/validation/check`, {
        method: "POST",
        ...json({ studies }),
      }),
  },

  /* ── Import / Export ─────────────────────────────────────────────── */

  /**
   * POST /api/import/references — parse citation text and import into a project.
   * Auto-detects format (RIS, BibTeX, PubMed NBIB, etc.).
   * @param {string} text       Raw citation file contents
   * @param {string} projectId  Target project ID
   * @returns {Promise<{ imported, duplicates, total, format, records }>}
   */
  importRefs: (text, projectId) =>
    req(`${BASE}/import/references`, {
      method: "POST",
      ...json({ text, projectId }),
    }),

  /**
   * GET /api/export/project/:id — download full project as JSON.
   * The response body is the full project object.
   * @param {string} id
   */
  exportProject: (id) => req(`${BASE}/export/project/${id}`),

  /* ── Auth ────────────────────────────────────────────────────────── */

  auth: {
    /**
     * POST /api/auth/register
     * @param {string} email
     * @param {string} password
     * @param {string} [name]
     * @returns {Promise<{ user: object }>}
     */
    register: (email, password, name) =>
      req(`${BASE}/auth/register`, {
        method: "POST",
        ...json({ email, password, name }),
      }),

    /**
     * POST /api/auth/login
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{ user: object }>}
     */
    login: (email, password) =>
      req(`${BASE}/auth/login`, {
        method: "POST",
        ...json({ email, password }),
      }),

    /**
     * POST /api/auth/logout
     * @returns {Promise<any>}
     */
    logout: () => req(`${BASE}/auth/logout`, { method: "POST" }),

    /**
     * GET /api/auth/me — returns the current user or throws.
     * @returns {Promise<{ user: object }>}
     */
    me: () => req(`${BASE}/auth/me`),
  },
};

export default api;
