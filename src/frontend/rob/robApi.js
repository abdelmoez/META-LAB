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

/**
 * Map a stored instrument id to its route slug.
 *
 * 115.md — the four pre-115 ids keep their hand-written slugs because those are
 * public URLs; every OTHER registered instrument derives its slug the same way the
 * server does (`'QUADAS-2'` → `quadas-2`, `'JBI-CaseSeries'` → `jbi-caseseries`),
 * so a newly registered tool needs no edit here. Falling back to `rob2` for an
 * unknown id — the old behaviour — would have silently served the wrong
 * instrument definition once there were thirteen of them.
 */
const LEGACY_SLUGS = { 'ROBINS-I': 'robins-i', NOS: 'nos', 'NOS-CC': 'nos-cc', RoB2: 'rob2' };
export function instrumentSlug(instrumentId) {
  const id = String(instrumentId || 'RoB2');
  if (LEGACY_SLUGS[id]) return LEGACY_SLUGS[id];
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'rob2';
}

/* ── Newcastle–Ottawa answers on the wire (101.md §21) ────────────────────────
 * RoB 2 / ROBINS-I answers are ONE code from a shared set (Y/PY/PN/N/NI/NA). A
 * NOS answer is one or more OPTION values from the item's own list — and the
 * additive Comparability item (select:'many') genuinely carries two, which is the
 * second star.
 *
 * The COLUMN encoding is owned by the server (robController's
 * encodeAnswerResponse / decodeAnswerResponse: a JSON array for select:'many', a
 * bare value otherwise). The client therefore sends the plain array of option
 * values and reads whatever shape it is handed back. These helpers are the only
 * place the UI crosses that boundary, so the widget, the pure scorer and the API
 * can never disagree about what an answer means. Pure — no network. */

/** The wire value for a NOS answer: a deduped array of option values. */
export function nosResponsePayload(values) {
  const list = Array.isArray(values) ? values : (values == null || values === '' ? [] : [values]);
  const out = [];
  for (const v of list) {
    const s = String(v).trim();
    if (s && s !== 'NA' && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Any stored/returned response → the engine's array shape. Deliberately tolerant,
 * because the same field arrives as an array (`answersByDomain` for a select:'many'
 * item), a bare value ('a'), a raw JSON column value ('["a","b"]'), or `{ response }` —
 * and a mis-parse would silently mis-score a study. ''/'NA' → [] (unanswered),
 * never a phantom selection.
 */
export function decodeNosResponse(raw) {
  const v = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw.response : raw;
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return nosResponsePayload(v);
  const s = String(v).trim();
  if (!s || s === 'NA') return [];
  if (s.length > 1 && s[0] === '[') {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return nosResponsePayload(parsed);
    } catch { /* a literal value that merely looks like JSON — keep it whole */ }
  }
  return [s];
}

/** Decode a whole { domainId: { qid: response } } blob into engine-shaped arrays. */
export function decodeNosAnswers(answersByDomain) {
  const out = {};
  for (const [domainId, qs] of Object.entries(answersByDomain || {})) {
    const d = {};
    for (const [qid, v] of Object.entries(qs || {})) d[qid] = decodeNosResponse(v);
    out[domainId] = d;
  }
  return out;
}

export const robApi = {
  instrument:        ()                 => req(`${BASE}/instruments/rob2`),
  // P14 — fetch a specific instrument definition by id (RoB2 | ROBINS-I). The
  // client normally uses the engine-barrel instrument objects directly, but this
  // stays available for a server-of-record fetch.
  instrumentDef:     (instrumentId)     => req(`${BASE}/instruments/${instrumentSlug(instrumentId)}`),
  // 115.md decision 3 — the SELECTABLE catalogue, derived from the registry. The
  // Assess selector is fed by this (and by the copy of it that rides along with
  // `listStudies`), so nothing in the UI hardcodes which instruments exist.
  listInstruments:   ()                 => req(`${BASE}/instruments`),
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

  // ── Newcastle–Ottawa (101.md §22) ─────────────────────────────────────────
  // The OPTIONAL interpretation threshold is a PROJECT decision, not study data —
  // the scale itself defines none — so it lives on the project. GET also returns
  // the modes, the attributed AHRQ standard and the conventional-bands notice, so
  // a configuration UI never has to hard-code (or misattribute) them.
  nosThresholds:     (projectId)        => req(`${BASE}/projects/${projectId}/nos-thresholds`),
  saveNosThresholds: (projectId, body)  => req(`${BASE}/projects/${projectId}/nos-thresholds`, { method: 'PUT', ...json(body) }),
};

/* ── NOS threshold config (101.md §22) ─────────────────────────────────────── */

/** The honest default: report the star profile, no verdict. */
export const NOS_THRESHOLD_DEFAULTS = Object.freeze({ mode: 'none', bands: [], label: '' });

/**
 * Read the project's NOS interpretation config. Never throws — a project that has
 * never configured one (or an unreachable endpoint) degrades to 'none', which is
 * the scientifically correct default rather than a convenient guess.
 *
 * An assessment view already carries `nosThresholds` + `interpretation`, so this
 * is for a CONFIGURATION surface (which also wants `modes`/`ahrq`/`notice`), not
 * for rendering a single assessment.
 */
export async function getNosThresholds(projectId) {
  if (!projectId) return { ...NOS_THRESHOLD_DEFAULTS, canEdit: false, available: false };
  try {
    const body = await robApi.nosThresholds(projectId);
    return {
      ...NOS_THRESHOLD_DEFAULTS,
      ...(body && body.thresholds ? body.thresholds : {}),
      modes: (body && body.modes) || ['none', 'ahrq', 'custom'],
      defaultMode: (body && body.defaultMode) || 'none',
      ahrq: (body && body.ahrq) || null,
      conventionalBands: (body && body.conventionalBands) || [],
      conventionalBandsNotice: (body && body.conventionalBandsNotice) || '',
      canEdit: !!(body && body.canEdit),
      available: true,
    };
  } catch {
    return { ...NOS_THRESHOLD_DEFAULTS, canEdit: false, available: false };
  }
}

/** Persist the project's NOS interpretation config. Throws so the caller can show why. */
export async function saveNosThresholds(projectId, body) {
  const res = await robApi.saveNosThresholds(projectId, body);
  return {
    ...NOS_THRESHOLD_DEFAULTS,
    ...((res && res.thresholds) || {}),
    changed: !!(res && res.changed),
    notice: (res && res.notice) || '',
  };
}

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
