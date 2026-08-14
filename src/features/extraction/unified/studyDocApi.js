/**
 * studyDocApi.js — 77.md §5 follow-up. Thin client for the persistent, cross-engine
 * STUDY document store (a study's PDF for studies that aren't screening-linked). The
 * pointer (study.document) rides in the project blob; these endpoints move the bytes.
 */
// 116.md §95 — a study-document URL is STABLE across a replace (unlike a screening
// attachment, whose id is reminted), so every byte-changing call here must drop the
// session byte cache for that URL. Without this the viewer could show the OLD file
// after a replace, which is exactly the §74 "coordinates from a different document"
// hazard the annotation subsystem must never hit.
import { invalidatePdfBytes } from '../../../frontend/components/pdfBytesCache.js';

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
    invalidatePdfBytes(studyDocApi.downloadUrl(pid, sid));   // 116.md §95
    return data;
  },
  remove: async (pid, sid) => {
    const data = await req('DELETE', `/projects/${pid}/studies/${sid}/document`);
    invalidatePdfBytes(studyDocApi.downloadUrl(pid, sid));   // 116.md §95
    return data;
  },

  /* 83.md-limitation fix — MULTIPLE publication files per study (documents[]). */
  /** Authenticated inline-download URL for one additional publication file. */
  extraDownloadUrl: (pid, sid, docId) => `${BASE}/projects/${pid}/studies/${sid}/documents/${encodeURIComponent(docId)}/download`,
  /** { primary, documents } for a study. */
  list: (pid, sid) => req('GET', `/projects/${pid}/studies/${sid}/documents`),
  /** Upload an additional file with a label → { document }. */
  uploadExtra: async (pid, sid, file, label = 'other') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', label);
    const r = await fetch(`${BASE}/projects/${pid}/studies/${sid}/documents`, { method: 'POST', credentials: 'include', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Upload failed (${r.status})`), { status: r.status, data });
    const id = data && data.document && data.document.id;
    if (id) invalidatePdfBytes(studyDocApi.extraDownloadUrl(pid, sid, id));   // 116.md §95
    return data;
  },
  removeExtra: async (pid, sid, docId) => {
    const data = await req('DELETE', `/projects/${pid}/studies/${sid}/documents/${encodeURIComponent(docId)}`);
    invalidatePdfBytes(studyDocApi.extraDownloadUrl(pid, sid, docId));        // 116.md §95
    return data;
  },
};

export default studyDocApi;
