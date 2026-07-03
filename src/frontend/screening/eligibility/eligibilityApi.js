// eligibilityApi.js — client for the PecanRev Criteria Screener (P10) endpoints.
//
// Mirrors aiApi.js's fetch+credentials+error-mapping convention. Every endpoint
// 404s when the `eligibilityScreening` feature flag is off, so callers treat a
// 404 on GET .../eligibility as "feature unavailable" (handled in useEligibility,
// exactly like useScreeningAi's /ai/status 404 pattern).
//
// User-facing surfaces built on this NEVER say "AI": it is "Criteria Screener",
// "Eligibility", "Guided eligibility", "Suggested". Variable names may be technical.
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

const qs = (params = {}) => {
  const sp = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') sp.set(k, val);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export const eligibilityApi = {
  // Per-project — the 404 on this call is the feature-flag self-detect signal.
  get:            (pid)          => req('GET',  `/projects/${pid}/eligibility`),
  saveCriteria:   (pid, criteria) => req('PUT',  `/projects/${pid}/eligibility/criteria`, { criteria }),
  // scope: 'all' | 'undecided' | { recordIds:[...] }. Returns inline {assessments}
  // for a small scope, or {jobId} to poll via jobStatus.
  evaluate:       (pid, scope)   => req('POST', `/projects/${pid}/eligibility/evaluate`, { scope }),
  jobStatus:      (pid, jobId)   => req('GET',  `/projects/${pid}/eligibility/job-status${qs({ jobId })}`),
  assessments:    (pid, params)  => req('GET',  `/projects/${pid}/eligibility/assessments${qs(params)}`),
  validation:     (pid)          => req('GET',  `/projects/${pid}/eligibility/validation`),
  // Same route, ?format=csv streams a download — used as a plain <a href download>
  // so the browser sends the session cookie on the navigation.
  validationCsvUrl: (pid)        => `${BASE}/projects/${pid}/eligibility/validation?format=csv`,
  updateSettings: (pid, body)    => req('PUT',  `/projects/${pid}/eligibility/settings`, body),

  // Per-record (also under /api/screening).
  recordAssessment: (rid)        => req('GET',  `/records/${rid}/eligibility`),
  // Reviewer adjudication writes a real human ScreenDecision; the server guards an
  // existing human decision unless force:true is passed (never silently overwrites).
  adjudicate:     (rid, body)    => req('PUT',  `/records/${rid}/eligibility/adjudicate`, body),
  // Owner/leader — reverse a governed auto-apply.
  undo:           (rid)          => req('PUT',  `/records/${rid}/eligibility/undo`),
};
