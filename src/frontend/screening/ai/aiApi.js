// aiApi.js — client for the PecanRev Screening Intelligence Engine endpoints.
// Mirrors screeningApi.js's fetch+credentials+error-mapping convention. Every
// endpoint 404s when the `aiScreening` feature flag is off, so callers treat a
// 404 on /ai/status as "feature unavailable" (handled in useScreeningAi).
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
      r.status === 401 ? 'You must be signed in.' :
      r.status === 403 ? (data.error || 'Access denied.') :
      r.status === 404 ? (data.error || 'Not found.') :
      (data.error || `Server error (${r.status})`);
    throw Object.assign(new Error(msg), { status: r.status, data });
  }
  return data;
}

const qs = (stage) => (stage ? `?stage=${encodeURIComponent(stage)}` : '');

export const aiApi = {
  status:      (pid, stage)        => req('GET',  `/projects/${pid}/ai/status${qs(stage)}`),
  jobStatus:   (pid, stage)        => req('GET',  `/projects/${pid}/ai/job-status${qs(stage)}`),
  run:         (pid, stage)        => req('POST', `/projects/${pid}/ai/run`, { stage }),
  scores:      (pid, stage)        => req('GET',  `/projects/${pid}/ai/scores${qs(stage)}`),
  validation:  (pid, stage)        => req('GET',  `/projects/${pid}/ai/validation${qs(stage)}`),
  versions:    (pid, stage)        => req('GET',  `/projects/${pid}/ai/versions${qs(stage)}`),
  rollback:    (pid, runId, stage) => req('POST', `/projects/${pid}/ai/rollback`, { runId, stage }),
  updateSettings: (pid, body)      => req('PUT',  `/projects/${pid}/ai/settings`, body),
  explanation: (pid, rid, stage)   => req('GET',  `/projects/${pid}/records/${rid}/ai/explanation${qs(stage)}`),
  feedback:    (pid, rid, body)    => req('POST', `/projects/${pid}/records/${rid}/ai/feedback`, body),
};
