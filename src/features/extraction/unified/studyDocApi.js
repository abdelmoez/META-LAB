/**
 * studyDocApi.js — 77.md §5 follow-up. Thin client for the persistent, cross-engine
 * STUDY document store (a study's PDF for studies that aren't screening-linked). The
 * pointer (study.document) rides in the project blob; these endpoints move the bytes.
 */
const BASE = '/api';

async function req(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status, data });
  return data;
}

export const studyDocApi = {
  /** Authenticated inline-download URL for a study's persisted PDF. */
  downloadUrl: (pid, sid) => `${BASE}/projects/${pid}/studies/${sid}/document/download`,
  /** { document } metadata (document is null when none). */
  get: (pid, sid) => req('GET', `/projects/${pid}/studies/${sid}/document`),
  /** Upload/replace → { document }. */
  upload: async (pid, sid, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${BASE}/projects/${pid}/studies/${sid}/document`, { method: 'POST', credentials: 'include', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Upload failed (${r.status})`), { status: r.status, data });
    return data;
  },
  remove: (pid, sid) => req('DELETE', `/projects/${pid}/studies/${sid}/document`),
};

export default studyDocApi;
