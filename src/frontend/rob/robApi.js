/**
 * robApi.js — client for the /api/rob service (rob.md §2.3, §5).
 * Relative paths, credentials included (session cookie). Mirrors the app's
 * api-client req() convention. All endpoints 404 when the rob_engine_v2 flag is
 * off or when the caller does not own the project (existence hidden).
 */
async function req(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}
const json = body => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const BASE = '/api/rob';

export const robApi = {
  instrument:        ()                 => req(`${BASE}/instruments/rob2`),
  listAssessments:   (projectId)        => req(`${BASE}/projects/${projectId}/assessments`),
  createAssessment:  (body)             => req(`${BASE}/assessments`, { method: 'POST', ...json(body) }),
  getAssessment:     (id)               => req(`${BASE}/assessments/${id}`),
  saveAnswers:       (id, answers)      => req(`${BASE}/assessments/${id}/answers`, { method: 'PUT', ...json({ answers }) }),
  override:          (id, body)         => req(`${BASE}/assessments/${id}/override`, { method: 'POST', ...json(body) }),
  finalise:          (id)               => req(`${BASE}/assessments/${id}/finalise`, { method: 'POST' }),
  reopen:            (id)               => req(`${BASE}/assessments/${id}/reopen`, { method: 'POST' }),
  remove:            (id)               => req(`${BASE}/assessments/${id}`, { method: 'DELETE' }),
  exportUrl:         (id, format)       => `${BASE}/assessments/${id}/export?format=${encodeURIComponent(format)}`,
  exportAssessment:  (id, format)       => req(`${BASE}/assessments/${id}/export?format=${encodeURIComponent(format)}`),
};

/** Read the public feature-flag snapshot to gate the RoB UI client-side. */
export async function robFlagEnabled() {
  try {
    const res = await fetch('/api/settings/public', { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data && data.featureFlags && data.featureFlags.rob_engine_v2 === true);
  } catch {
    return false;
  }
}

// prompt32 — admin-tunable presentation defaults for the RoB study workspace
// (whether the PDF / Article-Info tabs are shown, which one opens first, etc.).
// The documented defaults are merged client-side so the workspace renders the
// intended layout even if the fetch fails or the server omits the block.
const ROB_SETTINGS_DEFAULTS = {
  showPdfPanel: true,
  showArticleInfoTab: true,
  defaultLeftTab: 'pdf',         // 'pdf' | 'article'
  compactAssessmentCards: false,
};

/** Read the public RoB presentation settings, merged over documented defaults. */
export async function getRobSettings() {
  try {
    const res = await fetch('/api/settings/public', { credentials: 'include' });
    if (!res.ok) return { ...ROB_SETTINGS_DEFAULTS };
    const data = await res.json();
    return { ...ROB_SETTINGS_DEFAULTS, ...(data && data.robSettings ? data.robSettings : {}) };
  } catch {
    return { ...ROB_SETTINGS_DEFAULTS };
  }
}
