/**
 * legacyAdapter.js — bridge between the new META·LAB RoB engine (relational
 * RobAssessment tables) and the LEGACY per-study `rob` field that lives inside
 * Project.data.studies[].rob ("Risk-of-bias assessments keyed by domain ID").
 *
 * The legacy field is NOT modified by the new engine (rob.md §4). This adapter
 * only READS the legacy shape to surface a legacy view, and can render a new
 * assessment INTO the legacy shape for display/back-compat — it never writes the
 * Project.data blob. Pure + defensive (the legacy shape is loosely specified and
 * usually empty `{}`).
 */

const VALID = new Set(['low', 'some', 'high']);

/** Normalise any loosely-typed legacy judgement value to low|some|high|null. */
function normJudgment(v) {
  if (v == null) return null;
  const s = String(typeof v === 'object' ? (v.judgment ?? v.final ?? v.value ?? '') : v)
    .trim()
    .toLowerCase();
  if (VALID.has(s)) return s;
  // tolerate common legacy spellings
  if (s === 'low risk' || s === 'l') return 'low';
  if (s === 'some concerns' || s === 'some concern' || s === 'unclear' || s === 's') return 'some';
  if (s === 'high risk' || s === 'serious' || s === 'critical' || s === 'h') return 'high';
  return null;
}

/**
 * Read the legacy per-study `rob` object → a normalised per-domain view.
 * @param {object} study a mkStudy object (or { rob })
 * @returns {{ hasLegacy: boolean, domains: Record<string,'low'|'some'|'high'|null> }}
 */
export function legacyRobView(study) {
  const rob = (study && typeof study.rob === 'object' && study.rob) || {};
  const domains = {};
  let hasLegacy = false;
  for (const [domainId, raw] of Object.entries(rob)) {
    const j = normJudgment(raw);
    domains[domainId] = j;
    if (j) hasLegacy = true;
  }
  return { hasLegacy, domains };
}

/**
 * Render a new RobAssessment's resolved domain judgements INTO the legacy
 * `{ [domainId]: 'low'|'some'|'high' }` shape (for display / export parity). Does
 * NOT persist anything.
 * @param {Array<{domainId, finalJudgment?, proposedJudgment?}>} domainJudgments
 */
export function assessmentToLegacyRob(domainJudgments = []) {
  const out = {};
  for (const d of domainJudgments) {
    out[d.domainId] = normJudgment(d.finalJudgment ?? d.proposedJudgment);
  }
  return out;
}

export { normJudgment as _normJudgment };
