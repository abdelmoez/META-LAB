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

/**
 * 101.md §26 — is this value a Newcastle–Ottawa STAR COUNT rather than a risk
 * judgement? NOS domains persist their score as a numeral ("3") in the same String
 * column judgement instruments use, so the adapter has to be able to tell them
 * apart. Accepts the numeral, a bare number, or a domain result carrying `stars`.
 */
export function isStarScoreValue(v) {
  if (v == null) return false;
  if (typeof v === 'object') {
    if (Number.isFinite(Number(v.stars))) return true;
    return isStarScoreValue(v.judgment ?? v.final ?? v.value);
  }
  const s = String(v).trim();
  return s !== '' && Number.isFinite(Number(s));
}

/** Normalise any loosely-typed legacy judgement value to low|some|high|null. */
function normJudgment(v) {
  if (v == null) return null;
  // A star count has NO low/some/high equivalent. The NOS is not a traffic-light
  // instrument and mapping "3 stars" onto "some concerns" would invent a judgement
  // the reviewer never made (101.md §17/§26), so it resolves to null — "no legacy
  // representation" — rather than to a plausible-looking colour.
  if (isStarScoreValue(v)) return null;
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
 *
 * 101.md §26 — a STAR-scored assessment (Newcastle–Ottawa) is OMITTED entirely
 * rather than rendered as a row of nulls: an absent legacy entry says "this study
 * has no traffic-light judgement", whereas `{ selection: null }` would read as an
 * unassessed traffic-light domain. Callers that want the stars should read
 * RobDomainJudgment.finalStars/proposedStars, which is what those columns are for.
 * @param {Array<{domainId, finalJudgment?, proposedJudgment?, finalStars?, proposedStars?}>} domainJudgments
 */
export function assessmentToLegacyRob(domainJudgments = []) {
  const out = {};
  for (const d of domainJudgments) {
    const raw = d.finalJudgment ?? d.proposedJudgment;
    if (d.finalStars != null || d.proposedStars != null || isStarScoreValue(raw)) continue;
    out[d.domainId] = normJudgment(raw);
  }
  return out;
}

export { normJudgment as _normJudgment };
