/**
 * conflicts.js — META·SIFT Beta conflict detection logic.
 * Pure functions, no database.
 */

/**
 * detectConflict — given an array of reviewer decisions for one record,
 * returns whether a conflict exists and what the disagreement is.
 *
 * A conflict requires TWO OR MORE DISTINCT reviewers whose ACTIVE (non-undecided)
 * decisions disagree. Decisions are collapsed to one ACTIVE decision per reviewer
 * (the latest wins) BEFORE counting distinct values, so a single reviewer with
 * more than one row — e.g. a title/abstract include AND a later full-text exclude
 * for the same record — can never look like a disagreement with themselves
 * (prompt50 WS3: "a study included by both reviewers wrongly appears in
 * Conflicts"). Callers should additionally scope `decisions` to ONE screening
 * stage; conflicts are a title/abstract concept.
 *
 * @param {Array<{reviewerId, decision}>} decisions
 * @returns {{ hasConflict: boolean, decisions: object, uniqueDecisions: string[], reviewerCount: number }}
 */
export function detectConflict(decisions) {
  const map = {};
  for (const d of (decisions || [])) {
    if (d && d.decision && d.decision !== 'undecided') map[d.reviewerId] = d.decision;
  }
  const reviewerCount = Object.keys(map).length;
  const unique = [...new Set(Object.values(map))];

  return {
    // ≥2 DISTINCT reviewers AND their active decisions are not unanimous.
    hasConflict: reviewerCount >= 2 && unique.length > 1,
    decisions: map,
    uniqueDecisions: unique,
    reviewerCount,
  };
}

// ── Authoritative consensus-state matrix (prompt50 WS3 §3.1) ─────────────────
// The single, documented mapping from a record's per-reviewer ACTIVE decisions
// (at ONE stage) to its workflow location. Every surface that needs to know
// "where does this record belong?" should agree with this function.
export const CONSENSUS = {
  AWAITING: 'awaiting_screening',          // no reviewer has decided
  AWAITING_SECOND: 'awaiting_second_reviewer', // some, but fewer than required, have decided
  AGREEMENT_INCLUDED: 'agreement_included',
  AGREEMENT_EXCLUDED: 'agreement_excluded',
  AGREEMENT_OTHER: 'agreement_other',      // unanimous on a non-include/exclude label (e.g. maybe)
  CONFLICT: 'conflict',                    // ≥2 reviewers, active decisions disagree
};

/**
 * consensusState — resolve a record's consensus state from reviewer decisions.
 *
 * | Reviewer A  | Reviewer B  | state                      |
 * | ----------- | ----------- | -------------------------- |
 * | No decision | No decision | awaiting_screening         |
 * | Include     | No decision | awaiting_second_reviewer   |
 * | Exclude     | No decision | awaiting_second_reviewer   |
 * | Include     | Include     | agreement_included         |
 * | Exclude     | Exclude     | agreement_excluded         |
 * | Include     | Exclude     | conflict                   |
 * | Exclude     | Include     | conflict                   |
 *
 * `maybe` is a real decision: include+maybe / exclude+maybe → conflict;
 * maybe+maybe → agreement_other (unanimous, but not a terminal include/exclude).
 *
 * @param {Array<{reviewerId, decision}>} decisions
 * @param {number} requiredReviewers  distinct reviewers needed for agreement (default 2)
 */
export function consensusState(decisions, requiredReviewers = 2) {
  const { uniqueDecisions, reviewerCount } = detectConflict(decisions);
  const required = Math.max(2, requiredReviewers || 2);
  if (reviewerCount === 0) return CONSENSUS.AWAITING;
  if (uniqueDecisions.length > 1) return CONSENSUS.CONFLICT;
  if (reviewerCount < required) return CONSENSUS.AWAITING_SECOND;
  // Unanimous among ≥ required distinct reviewers.
  if (uniqueDecisions[0] === 'include') return CONSENSUS.AGREEMENT_INCLUDED;
  if (uniqueDecisions[0] === 'exclude') return CONSENSUS.AGREEMENT_EXCLUDED;
  return CONSENSUS.AGREEMENT_OTHER;
}

/**
 * findAllConflicts — given a map of recordId → decisions array,
 * returns all records that have conflicts.
 */
export function findAllConflicts(recordDecisions) {
  const conflicts = [];
  for (const [recordId, decisions] of Object.entries(recordDecisions)) {
    const result = detectConflict(decisions);
    if (result.hasConflict) conflicts.push({ recordId, ...result });
  }
  return conflicts;
}
