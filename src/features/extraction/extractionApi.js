/**
 * features/extraction/extractionApi.js — 66.md (P5). Thin, authenticated fetch
 * wrappers over the structured-extraction backend (server/routes/extraction.js,
 * mounted at /api/extraction). Every call sends credentials, speaks JSON, and
 * throws an Error carrying the server's { error } message (plus a `.payload` with
 * the full body and a `.status`) so the UI can special-case contracts such as the
 * 409 HAS_EFFECT_SIZE send-to-MA guard.
 *
 * This module does NOT re-implement any extraction logic — it only drives the
 * contract API. Response shapes are exactly what extractionController.js returns.
 */

const BASE = '/api/extraction';

/** Perform a JSON request; throw on !ok with the server's message + full payload. */
async function req(path, { method = 'GET', body, signal } = {}) {
  const opts = {
    method,
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  let payload = null;
  try { payload = await res.json(); } catch { /* empty/non-JSON body */ }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

const enc = encodeURIComponent;

export const extractionApi = {
  // ── Form / templates ───────────────────────────────────────────────────────
  /** GET active form + template catalogue + element-type vocab + AI settings. */
  getForm: (mlpid) => req(`/${enc(mlpid)}/form`),
  /** PUT { name?, elements?, templateKey? } — create/update the active form (422 → problems). */
  putForm: (mlpid, body) => req(`/${enc(mlpid)}/form`, { method: 'PUT', body }),

  // ── Overview ───────────────────────────────────────────────────────────────
  /** GET per-study extraction status list for the workspace. */
  getOverview: (mlpid) => req(`/${enc(mlpid)}/overview`),

  // ── Per-study values (blinded per extractor) ───────────────────────────────
  /** GET my own values + consensus + latest suggestion for one study. */
  getStudyValues: (mlpid, studyId) => req(`/${enc(mlpid)}/studies/${enc(studyId)}/values`),
  /** PUT { values:[{elementId,armKey,value,provenance,origin,suggestionId}] }. */
  putStudyValues: (mlpid, studyId, values) =>
    req(`/${enc(mlpid)}/studies/${enc(studyId)}/values`, { method: 'PUT', body: { values } }),

  // ── Assignment / adjudication ──────────────────────────────────────────────
  /** POST { extractor1Id?, extractor2Id?, adjudicatorId? }. */
  assign: (mlpid, studyId, body) =>
    req(`/${enc(mlpid)}/studies/${enc(studyId)}/assign`, { method: 'POST', body }),
  /** GET both extractors + conflict summary (adjudicator only). */
  getCompare: (mlpid, studyId) => req(`/${enc(mlpid)}/studies/${enc(studyId)}/compare`),
  /** POST { resolutions:[{elementId,armKey,choice,value?,provenance?,note?}] }. */
  adjudicate: (mlpid, studyId, resolutions) =>
    req(`/${enc(mlpid)}/studies/${enc(studyId)}/adjudicate`, { method: 'POST', body: { resolutions } }),

  // ── AI assist (suggestions only — human review mandatory) ──────────────────
  /** POST { text? } — generate suggestions for review; never auto-commits. */
  aiSuggest: (mlpid, studyId, text) =>
    req(`/${enc(mlpid)}/studies/${enc(studyId)}/ai-suggest`, { method: 'POST', body: text ? { text } : {} }),
  /** POST — mark a suggestion set reviewed. */
  reviewSuggestion: (mlpid, sid) =>
    req(`/${enc(mlpid)}/suggestions/${enc(sid)}/review`, { method: 'POST', body: {} }),

  // ── Tables ─────────────────────────────────────────────────────────────────
  /** GET parsed tables (optionally scoped to a study). */
  getTables: (mlpid, studyId) =>
    req(`/${enc(mlpid)}/tables${studyId ? `?studyId=${enc(studyId)}` : ''}`),
  /** POST { content, format?, name?, studyId?, page? } — parse + store a table. */
  parseTable: (mlpid, body) => req(`/${enc(mlpid)}/tables`, { method: 'POST', body }),
  /** DELETE a parsed table. */
  deleteTable: (mlpid, tid) => req(`/${enc(mlpid)}/tables/${enc(tid)}`, { method: 'DELETE' }),

  // ── Meta-analysis handoff + validation report ──────────────────────────────
  /**
   * POST { esType, outcome?, timepoint?, overwrite? } — consensus → study blob.
   * On 409 the thrown error carries err.payload.code === 'HAS_EFFECT_SIZE' with
   * { current, proposed, warnings } so the caller can confirm before overwrite.
   */
  sendToMa: (mlpid, studyId, body) =>
    req(`/${enc(mlpid)}/studies/${enc(studyId)}/send-to-ma`, { method: 'POST', body }),
  /** GET AI-suggestions-vs-human-consensus accuracy report. */
  getValidationReport: (mlpid) => req(`/${enc(mlpid)}/validation-report`),
};

export default extractionApi;
