/**
 * gradeSync.js — pure RoB → GRADE "Risk of Bias" sync logic (prompt34 Task 10).
 *
 * Completed RoB 2 assessments feed the GRADE "Risk of Bias" certainty domain as an
 * AUDITABLE SUGGESTION (never a silent forced downgrade). This module is pure (no
 * Prisma / Express / React / Date.now()) so it can run identically on the server
 * and in the monolith GRADE tab; it takes the list-API assessment shape
 * ({ id, status, overall }) and returns a serialisable summary + a suggested
 * GRADE rating + a stable SIGNATURE used to detect "RoB changed since GRADE was
 * last reviewed" (staleness).
 *
 * The mapping deliberately mirrors the legacy data-based GRADE suggestion
 * (gradeSuggestions in the monolith) so the auto-RoB suggestion is consistent with
 * what reviewers already expect:
 *   - mostly low risk (no high, no majority-some) → "not_serious"
 *   - some-concerns majority OR any high (minority) → "serious"
 *   - high risk in ≥ half the assessed results       → "very_serious"
 *   - no completed assessments                        → pending (no rating)
 * The actual downgrade decision stays a human judgement; this only SUGGESTS.
 */

// GRADE option values (must match GRADE_OPTIONS in the monolith GRADE tab).
export const GRADE_ROB_RATINGS = { NOT_SERIOUS: 'not_serious', SERIOUS: 'serious', VERY_SERIOUS: 'very_serious' };

// How grade.rob was last set — tracked for transparency + override protection.
export const ROB_GRADE_SOURCE = { AUTO: 'auto_rob', MANUAL: 'manual' };

const COMPLETED = new Set(['complete', 'consensus']);

// 86.md P1.12 — map EVERY instrument's overall judgement onto the 3-level GRADE
// concern scale. Previously only RoB 2's low/some/high were recognised, so a
// finalised ROBINS-I assessment of 'serious' or 'critical' counted as neither low
// nor high — it fell through and the domain reported "no assessments finalised",
// silently hiding serious/critical risk. This is instrument-agnostic (no need to
// thread instrumentId): RoB 2 = low/some/high; ROBINS-I / ROBINS-E =
// low/moderate/serious/critical/ni.
const OVERALL_TO_CONCERN = {
  low: 'low',
  some: 'some',
  moderate: 'some',
  ni: 'some', // "no information" → treated cautiously as some-concerns
  high: 'high',
  serious: 'high',
  critical: 'high',
};
function concernOf(overall) {
  return OVERALL_TO_CONCERN[String(overall == null ? '' : overall).trim().toLowerCase()] || null;
}

/**
 * Stable signature over ALL assessments (id:status:overall, sorted) so any change
 * — a new assessment, a re-finalised judgement, a reopen — flips the signature and
 * lets GRADE mark its RoB domain stale. Pure + order-independent.
 * @param {Array<{id:string,status:string,overall:?string}>} assessments
 * @returns {string}
 */
export function robGradeSignature(assessments = []) {
  const parts = (assessments || [])
    .map(a => `${a.id || ''}:${a.status || ''}:${a.overall || ''}`)
    .sort();
  return `v1|${parts.length}|${parts.join('|')}`;
}

/**
 * Summarise completed RoB assessments into the GRADE "Risk of Bias" input.
 * @param {Array<{id:string,status:string,overall:?string}>} assessments
 * @returns {{
 *   hasAny:boolean, total:number, completed:number, pending:number, assessed:number,
 *   counts:{low:number,some:number,high:number},
 *   concern:'none'|'serious'|'very_serious'|'pending',
 *   suggestedRating:('not_serious'|'serious'|'very_serious'|null),
 *   reason:string, signature:string
 * }}
 */
export function summariseRobForGrade(assessments = []) {
  const list = Array.isArray(assessments) ? assessments : [];
  const signature = robGradeSignature(list);
  const completedList = list.filter(a => COMPLETED.has(a.status));
  const counts = { low: 0, some: 0, high: 0 };
  for (const a of completedList) { const c = concernOf(a.overall); if (c) counts[c] += 1; }
  const assessed = counts.low + counts.some + counts.high;
  const pending = list.length - completedList.length;

  if (assessed === 0) {
    return {
      hasAny: list.length > 0,
      total: list.length,
      completed: completedList.length,
      pending,
      assessed: 0,
      counts,
      concern: 'pending',
      suggestedRating: null,
      reason: list.length === 0
        ? 'No risk-of-bias assessments yet. Finalise assessments in the Risk of Bias tab and GRADE will suggest this domain automatically.'
        : `${list.length} risk-of-bias assessment${list.length === 1 ? '' : 's'} started but none finalised yet — finalise them to derive this domain.`,
      signature,
    };
  }

  const highFrac = counts.high / assessed;
  const someFrac = counts.some / assessed;
  let suggestedRating = GRADE_ROB_RATINGS.NOT_SERIOUS;
  let concern = 'none';
  let reason = `Most assessed results are at low risk (${counts.low}/${assessed} low, ${counts.some} some-concerns, ${counts.high} high).`;
  if (highFrac >= 0.5) {
    suggestedRating = GRADE_ROB_RATINGS.VERY_SERIOUS;
    concern = 'very_serious';
    reason = `${counts.high}/${assessed} assessed results are at high risk of bias — a major limitation.`;
  } else if (counts.high > 0 || someFrac >= 0.5) {
    suggestedRating = GRADE_ROB_RATINGS.SERIOUS;
    concern = 'serious';
    reason = `${counts.high} high-risk and ${counts.some} some-concern of ${assessed} assessed results suggest serious limitations.`;
  }
  if (pending > 0) reason += ` (${pending} not yet finalised.)`;

  return {
    hasAny: true,
    total: list.length,
    completed: completedList.length,
    pending,
    assessed,
    counts,
    concern,
    suggestedRating,
    reason,
    signature,
  };
}

export const ROB_GRADE_SYNC_VERSION = 'v1';
