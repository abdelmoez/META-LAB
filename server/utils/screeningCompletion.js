/**
 * screeningCompletion.js — pure rule for "is the Screening stage complete?"
 * (prompt29 Part 9). Extracted so it is unit-testable and so the META·LAB
 * workflow stepper and the screening summary agree on one definition.
 *
 * Screening is complete only when EVERY substep is finished:
 *   - records were imported (started),
 *   - duplicates resolved,
 *   - every record title/abstract-screened to quorum,
 *   - reviewer conflicts resolved,
 *   - full-text / final review decided,
 *   - at least one included study finalised (handed off to Data Extraction).
 *
 * This deliberately mirrors src/frontend/screening/ui/screeningSteps.js. The old
 * rule ("any included study → done") flipped Screening green too early.
 */

/**
 * @param {object} c counts from the linked screening workspace
 * @param {number} c.total                      total records imported
 * @param {number} c.unresolvedDuplicateGroups  duplicate groups still unresolved
 * @param {number} c.titleAbstractPending       non-dup records below the reviewer quorum
 * @param {number} c.unresolvedConflicts        reviewer conflicts not yet resolved
 * @param {number} c.secondReviewPending        full-text records without a final decision
 * @param {number} c.includedFinal              records accepted/handed off
 * @returns {boolean}
 */
export function isScreeningComplete(c = {}) {
  const n = k => (Number.isFinite(c[k]) ? c[k] : 0);
  return n('total') > 0
    && n('unresolvedDuplicateGroups') === 0
    && n('titleAbstractPending') === 0
    && n('unresolvedConflicts') === 0
    && n('secondReviewPending') === 0
    && n('includedFinal') > 0;
}

/**
 * isScreeningWorkComplete — the workflow-PROGRESS completeness predicate
 * (98.md §14 Defect 2b). Same substep conjunction as isScreeningComplete with ONE
 * deliberate divergence: `includedFinal > 0` is NOT required. A screen where every
 * record is terminally decided and every record was rejected (zero included
 * studies) IS finished screening work — the review may be an honest empty review.
 * isScreeningComplete keeps its includedFinal>0 clause because it also gates the
 * "ready for Data Extraction" hand-off framing; the progress step must not.
 *
 * @param {object} c same counts shape as isScreeningComplete (includedFinal ignored)
 * @returns {boolean}
 */
export function isScreeningWorkComplete(c = {}) {
  const n = k => (Number.isFinite(c[k]) ? c[k] : 0);
  return n('total') > 0
    && n('unresolvedDuplicateGroups') === 0
    && n('titleAbstractPending') === 0
    && n('unresolvedConflicts') === 0
    && n('secondReviewPending') === 0;
}
