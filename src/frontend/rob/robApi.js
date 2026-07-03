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

/** Map a stored instrument id ('RoB2' | 'ROBINS-I') to its route slug. */
export function instrumentSlug(instrumentId) {
  return String(instrumentId || 'RoB2') === 'ROBINS-I' ? 'robins-i' : 'rob2';
}

export const robApi = {
  instrument:        ()                 => req(`${BASE}/instruments/rob2`),
  // P14 — fetch a specific instrument definition by id (RoB2 | ROBINS-I). The
  // client normally uses the engine-barrel instrument objects directly, but this
  // stays available for a server-of-record fetch.
  instrumentDef:     (instrumentId)     => req(`${BASE}/instruments/${instrumentSlug(instrumentId)}`),
  listAssessments:   (projectId)        => req(`${BASE}/projects/${projectId}/assessments`),
  // prompt46 #4 — merged study universe (screening-derived + manual) + manual-study CRUD.
  listStudies:       (projectId)        => req(`${BASE}/projects/${projectId}/studies`),
  createManualStudy: (projectId, body)  => req(`${BASE}/projects/${projectId}/manual-studies`, { method: 'POST', ...json(body) }),
  removeManualStudy: (projectId, studyId, { force = false } = {}) => req(`${BASE}/projects/${projectId}/manual-studies/${studyId}${force ? '?force=true' : ''}`, { method: 'DELETE' }),
  createAssessment:  (body)             => req(`${BASE}/assessments`, { method: 'POST', ...json(body) }),
  getAssessment:     (id)               => req(`${BASE}/assessments/${id}`),
  saveAnswers:       (id, answers)      => req(`${BASE}/assessments/${id}/answers`, { method: 'PUT', ...json({ answers }) }),
  // P14 — guided appraisal: POST the study's full text (best-effort, client-
  // extracted). The server appraises title + abstract itself and saves the
  // suggestions as PROPOSED answers only (never final). 404 when the
  // guidedRobAppraisal flag is OFF.
  appraise:          (id, body)         => req(`${BASE}/assessments/${id}/appraise`, { method: 'POST', ...json(body || {}) }),
  override:          (id, body)         => req(`${BASE}/assessments/${id}/override`, { method: 'POST', ...json(body) }),
  finalise:          (id)               => req(`${BASE}/assessments/${id}/finalise`, { method: 'POST' }),
  reopen:            (id)               => req(`${BASE}/assessments/${id}/reopen`, { method: 'POST' }),
  remove:            (id)               => req(`${BASE}/assessments/${id}`, { method: 'DELETE' }),
  exportUrl:         (id, format)       => `${BASE}/assessments/${id}/export?format=${encodeURIComponent(format)}`,
  exportAssessment:  (id, format)       => req(`${BASE}/assessments/${id}/export?format=${encodeURIComponent(format)}`),
  // P14 — guided-vs-reviewer agreement (weighted κ + per-domain + disagreements).
  // 404 when the guidedRobAppraisal flag is OFF.
  robValidation:       (projectId)      => req(`${BASE}/projects/${projectId}/rob-validation`),
  robValidationCsvUrl: (projectId)      => `${BASE}/projects/${projectId}/rob-validation?format=csv`,
};

// Shared, briefly-cached public feature-flag snapshot. `robFlagEnabled` and
// `guidedRobAppraisalEnabled` both need `/api/settings/public`; deduping them into
// ONE in-flight/short-lived fetch means the guided-flag check adds NO extra network
// call beyond the settings read the RoB UI already performed pre-P14.
let _flagCache = null;
let _flagCacheAt = 0;
function publicFeatureFlags() {
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  if (_flagCache && (now - _flagCacheAt) < 5000) return _flagCache;
  _flagCacheAt = now;
  _flagCache = fetch('/api/settings/public', { credentials: 'include' })
    .then(res => (res.ok ? res.json() : null))
    .then(data => (data && data.featureFlags) || {})
    .catch(() => { _flagCache = null; return {}; });
  return _flagCache;
}

/** Read the public feature-flag snapshot to gate the RoB UI client-side. */
export async function robFlagEnabled() {
  return (await publicFeatureFlags()).rob_engine_v2 === true;
}

/**
 * P14 — is the GUIDED RoB appraisal layer enabled? Separate flag from
 * `rob_engine_v2`: when OFF the RoB workspace behaves EXACTLY as today (RoB 2
 * only, no instrument selector, no appraisal / validation). When ON, ROBINS-I +
 * the guided-appraisal + agreement features become available. Shares the same
 * cached settings fetch as `robFlagEnabled` (no extra network round-trip).
 */
export async function guidedRobAppraisalEnabled() {
  return (await publicFeatureFlags()).guidedRobAppraisal === true;
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
