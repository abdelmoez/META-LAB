/**
 * conflicts.js — META·SIFT Beta conflict detection logic.
 * Pure functions, no database.
 */

/**
 * detectConflict — given an array of reviewer decisions for one record,
 * returns whether a conflict exists and what the disagreement is.
 *
 * @param {Array<{reviewerId, decision}>} decisions
 * @returns {{ hasConflict: boolean, decisions: object, uniqueDecisions: string[] }}
 */
export function detectConflict(decisions) {
  const real = decisions.filter(d => d.decision && d.decision !== 'undecided');
  if (real.length < 2) return { hasConflict: false, decisions: {}, uniqueDecisions: [] };

  const map = {};
  real.forEach(d => { map[d.reviewerId] = d.decision; });
  const unique = [...new Set(real.map(d => d.decision))];

  return {
    hasConflict: unique.length > 1,
    decisions: map,
    uniqueDecisions: unique,
  };
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
