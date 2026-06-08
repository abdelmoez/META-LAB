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

  // Stats
  getStats: (pid) => req('GET', `/projects/${pid}/stats`),
};
