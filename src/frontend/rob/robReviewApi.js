/**
 * robReviewApi.js — the client for the RoB endpoints that had NO frontend until
 * 115.md W2-B: the dual-reviewer view, consensus creation, and the project-wide
 * tool-sectioned CSV export (dossier §6 "No frontend for any of this", §9).
 *
 * A SEPARATE module from robApi.js on purpose: robApi.js is being reworked by the
 * selector/renderer wave in parallel, and these three calls are additive. It
 * mirrors robApi's conventions exactly — relative paths, `credentials: 'include'`,
 * and an Error carrying `.status` + `.body` so callers can distinguish a 403 tier
 * gate from a 409 precondition without parsing prose.
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

export const robReviewApi = {
  /**
   * The dual-reviewer view for ONE study: each independent reviewer's assessment,
   * the per-question disagreements, the consensus row if one exists, and the
   * agreement summary. Strictly read-only server-side (it can never overwrite a
   * reviewer's judgement).
   *
   * `instrumentId` scopes the comparison: a RoB 2 row and a NOS row answer
   * different questions entirely, so pooling them would be meaningless. ALWAYS
   * pass it when the caller knows which tool it is comparing.
   *
   * BLINDING: this endpoint does NOT filter in-progress drafts (verified against
   * robController.getStudyReviewers, 2026-08-11). Callers must consult
   * robConsensusModel.reviewerBlindState() and NOT CALL THIS until it unlocks —
   * that keeps the other reviewer's answers out of the browser entirely, rather
   * than fetching them and hiding them in the DOM.
   */
  studyReviewers: (projectId, studyId, { instrumentId } = {}) => req(
    `${BASE}/projects/${encodeURIComponent(projectId)}/studies/${encodeURIComponent(studyId)}/reviewers`
    + (instrumentId ? `?instrumentId=${encodeURIComponent(instrumentId)}` : ''),
  ),

  /**
   * Create the THIRD, reconciled assessment row (status 'consensus'). Both
   * reviewer rows are left untouched; `seedFromAssessmentId` COPIES one
   * reviewer's answers into the new row so reconciliation starts from a real
   * assessment rather than a blank form.
   *
   * Server preconditions (mirrored in robConsensusModel.consensusEligibility):
   * 403 read-only · 400 unknown/unsupported instrument · 409 consensus exists ·
   * 409 fewer than two distinct reviewers.
   */
  createConsensus: (projectId, studyId, body) => req(
    `${BASE}/projects/${encodeURIComponent(projectId)}/studies/${encodeURIComponent(studyId)}/consensus`,
    { method: 'POST', ...json(body || {}) },
  ),

  /**
   * The project-wide RoB export: ONE CSV with one SECTION per instrument
   * (115.md decision 7 — never a cross-tool aggregate). Returns
   * `{ format, filename, mime, content, summary }`; the client performs the
   * download, exactly like the per-assessment export.
   *
   * Tier-gated (`EXPORT_TYPES.ROB_ASSESSMENT`): Free is blocked with a 403 whose
   * body is `{ error: 'TIER_LIMIT_EXCEEDED', message, requiredTier }`.
   */
  exportProject: (projectId, format = 'csv') => req(
    `${BASE}/projects/${encodeURIComponent(projectId)}/assessments/export?format=${encodeURIComponent(format)}`,
  ),

  exportProjectUrl: (projectId, format = 'csv') => `${BASE}/projects/${encodeURIComponent(projectId)}/assessments/export?format=${encodeURIComponent(format)}`,
};

export default robReviewApi;
