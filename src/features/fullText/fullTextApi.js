/**
 * fullTextApi.js — authenticated client for the automated OA full-text retrieval
 * backend (server/routes/fullText.js, mounted at /api/full-text). Every call uses
 * the app's session cookie (credentials:'include'); HTTP/network failures THROW so
 * the panel can surface an honest error/limited state. :pid is the ScreenProject id.
 *
 * The bulk-upload endpoint is multipart (FormData with a 'files' array) — the JSON
 * `http` helper is bypassed there so the browser sets its own multipart boundary.
 */
const BASE = '/api/full-text';

const pid = (id) => encodeURIComponent(id);
const rid = (id) => encodeURIComponent(id);

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
    throw err;
  }
  const text = await r.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const fullTextApi = {
  // → { coverage, settings, canTrigger, lastJob }
  async getStatus(projectId) {
    return http(`${BASE}/${pid(projectId)}/status`);
  },
  // scope: 'included' | 'missing' | 'selected' → 202 { job }
  async retrieve(projectId, scope, recordIds) {
    const body = { scope };
    if (Array.isArray(recordIds) && recordIds.length) body.recordIds = recordIds;
    return http(`${BASE}/${pid(projectId)}/retrieve`, { method: 'POST', body });
  },
  // → { job }
  async getJob(projectId, jobId) {
    return http(`${BASE}/${pid(projectId)}/jobs/${rid(jobId)}`);
  },
  // filter: 'missing' | 'linkout' | 'all' → { records, total, capped }
  async getRecords(projectId, filter = 'all') {
    const qs = new URLSearchParams({ filter }).toString();
    return http(`${BASE}/${pid(projectId)}/records?${qs}`);
  },
  // → { candidates }
  async getCandidates(projectId, recordId) {
    return http(`${BASE}/${pid(projectId)}/records/${rid(recordId)}/candidates`);
  },
  // status: 'requested' | 'received' | 'none' → { request }
  async upsertRequest(projectId, recordId, { status, note } = {}) {
    return http(`${BASE}/${pid(projectId)}/records/${rid(recordId)}/request`, {
      method: 'POST', body: { status, note: note || '' },
    });
  },
  // files: File[] (multipart 'files') → { matched, total, results, note }
  async bulkUpload(projectId, files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    const r = await fetch(`${BASE}/${pid(projectId)}/bulk-upload`, {
      method: 'POST', credentials: 'include', body: fd,
    });
    if (!r.ok) {
      let payload = null;
      try { payload = await r.json(); } catch { /* non-JSON */ }
      const err = new Error((payload && (payload.error || payload.code)) || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    const text = await r.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  },
};

export default fullTextApi;
