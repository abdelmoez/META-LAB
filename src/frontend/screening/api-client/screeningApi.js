// screeningApi.js — API client for META·SIFT Beta
const BASE = '/api/screening';

async function req(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + path, opts);
  if (r.status === 204) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      r.status === 401 ? 'You must be signed in to use META·SIFT.' :
      r.status === 403 ? 'Access denied.' :
      r.status === 404 ? (data.error || 'Not found.') :
      r.status === 503 ? (data.error || 'META·SIFT is currently unavailable.') :
      (data.error || `Server error (${r.status})`);
    throw Object.assign(new Error(msg), { status: r.status, data });
  }
  return data;
}

export const screeningApi = {
  // Health
  health: () => req('GET', '/health'),

  // Projects
  listProjects:  ()                       => req('GET',    '/projects'),
  createProject: (body)                   => req('POST',   '/projects', body),
  getProject:    (pid)                    => req('GET',    `/projects/${pid}`),
  updateProject: (pid, body)              => req('PUT',    `/projects/${pid}`, body),
  deleteProject: (pid)                    => req('DELETE', `/projects/${pid}`),

  // Records
  listRecords: (pid, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req('GET', `/projects/${pid}/records${qs ? '?' + qs : ''}`);
  },
  getKeywordStats: (pid) => req('GET', `/projects/${pid}/keyword-stats`),
  deleteRecord: (pid, rid) => req('DELETE', `/projects/${pid}/records/${rid}`),

  // Import / Export
  importRecords: (pid, body) => req('POST', `/projects/${pid}/import`, body),
  exportUrl: (pid, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return `${BASE}/projects/${pid}/export${qs ? '?' + qs : ''}`;
  },

  // Decisions
  saveDecision:  (pid, rid, body) => req('POST', `/projects/${pid}/records/${rid}/decision`, body),
  listDecisions: (pid)            => req('GET',  `/projects/${pid}/decisions`),

  // Conflicts
  listConflicts:   (pid)          => req('GET',  `/projects/${pid}/conflicts`),
  resolveConflict: (pid, cid, body) => req('POST', `/projects/${pid}/conflicts/${cid}/resolve`, body),

  // Duplicates
  listDuplicates:        (pid)            => req('GET',  `/projects/${pid}/duplicates`),
  detectDuplicates:      (pid)            => req('POST', `/projects/${pid}/duplicates/detect`, {}),
  resolveDuplicateGroup: (pid, gid, body) => req('POST', `/projects/${pid}/duplicates/${gid}/resolve`, body),

  // Labels
  listLabels:  (pid)       => req('GET',    `/projects/${pid}/labels`),
  createLabel: (pid, body) => req('POST',   `/projects/${pid}/labels`, body),
  deleteLabel: (pid, lid)  => req('DELETE', `/projects/${pid}/labels/${lid}`),

  // Reasons
  listReasons:  (pid)        => req('GET',    `/projects/${pid}/reasons`),
  createReason: (pid, body)  => req('POST',   `/projects/${pid}/reasons`, body),
  deleteReason: (pid, rid2)  => req('DELETE', `/projects/${pid}/reasons/${rid2}`),

  // Stats + Overview
  getStats:    (pid) => req('GET', `/projects/${pid}/stats`),
  getOverview: (pid) => req('GET', `/projects/${pid}/overview`),
  getAudit:    (pid) => req('GET', `/projects/${pid}/audit`),

  // Members (Part 4)
  listMembers:  (pid)            => req('GET',    `/projects/${pid}/members`),
  addMember:    (pid, body)      => req('POST',   `/projects/${pid}/members`, body),
  updateMember: (pid, mid, body) => req('PATCH',  `/projects/${pid}/members/${mid}`, body),
  removeMember: (pid, mid)       => req('DELETE', `/projects/${pid}/members/${mid}`),

  // Per-member open-state (Part 11)
  markOpened: (pid, rid) => req('POST', `/projects/${pid}/records/${rid}/open`),

  // META·LAB association (Task 4)
  getLinkable:  (pid)                  => req('GET',  `/projects/${pid}/linkable`),
  linkMetaLab:  (pid, metaLabProjectId) => req('POST', `/projects/${pid}/link`, { metaLabProjectId }),

  // Second Review (Part 3)
  listSecondReview: (pid)            => req('GET',  `/projects/${pid}/second-review`),
  finalizeRecord:   (pid, rid, body) => req('POST', `/projects/${pid}/records/${rid}/finalize`, body),
  retryHandoff:     (pid, rid)       => req('POST', `/projects/${pid}/records/${rid}/handoff/retry`),

  // Chat (Part 6) — polling via ?since
  listChat: (pid, since) => req('GET', `/projects/${pid}/chat${since ? '?since=' + encodeURIComponent(since) : ''}`),
  postChat: (pid, body)  => req('POST', `/projects/${pid}/chat`, body),
  deleteChat: (pid, cmid) => req('DELETE', `/projects/${pid}/chat/${cmid}`),
  chatUnreadCount: (pid) => req('GET',  `/projects/${pid}/chat/unread-count`),
  markChatRead:    (pid) => req('POST', `/projects/${pid}/chat/mark-read`),

  // PDF attachments (Part 7)
  listPdf:        (pid, rid) => req('GET', `/projects/${pid}/records/${rid}/pdf`),
  pdfDownloadUrl: (pid, rid, aid) => `${BASE}/projects/${pid}/records/${rid}/pdf/${aid}/download`,
  deletePdf:      (pid, rid, aid) => req('DELETE', `/projects/${pid}/records/${rid}/pdf/${aid}`),
  uploadPdf: async (pid, rid, file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${BASE}/projects/${pid}/records/${rid}/pdf`, { method: 'POST', credentials: 'include', body: fd });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || `Upload failed (${r.status})`), { status: r.status, data });
    return data;
  },
};
