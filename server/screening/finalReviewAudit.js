/**
 * screening/finalReviewAudit.js — PURE audit-row builder for FINAL REVIEW decisions.
 *
 * 117.md §56/§88 — "Undo must not falsify history. The audit trail should be able to
 * show (1) Article excluded by User A, (2) Decision undone by User A, rather than
 * pretending the original action never occurred."
 *
 * Two gaps this closes:
 *  - a leader's finalize/revert wrote ONE action string with no notion of who caused
 *    it, so an undo looked exactly like a fresh human decision;
 *  - a REVIEWER's full-text include/exclude was never audited at all, so the most
 *    consequential vote in the workflow left no trace (§88 "final review
 *    include/exclude").
 *
 * Modelled on keywordAudit.js — the same `via` marker, the same "an undo APPENDS a
 * new immutable row, it never rewrites one" rule (109.md §50), and the same purity
 * (no prisma, no express) so the row SHAPE is unit-testable without a database.
 *
 * §88 also warns against audit noise. Reviewer decisions are therefore filtered here,
 * not at the call site: only the transitions that ESTABLISH or WITHDRAW a settled
 * (include/exclude) full-text decision are events. A repeat of the same decision, and
 * 'maybe'/'undecided' churn between two unsettled values, are not.
 */

/** Accepted values of the optional `via` hint on a final-review request body. */
export const FINAL_REVIEW_VIA = Object.freeze(['user', 'undo', 'redo']);

/** Physical final-review operation → project-ledger action string. */
export const FINAL_REVIEW_ACTIONS = Object.freeze({
  accept: 'RECORD_ACCEPTED',
  reject: 'RECORD_REJECTED',
  revert: 'RECORD_REVERTED',
  decide: 'FINAL_REVIEW_DECISION',
  undecide: 'FINAL_REVIEW_DECISION_CLEARED',
});

/**
 * The action an undo/redo replay wears. 117.md §56: the physical operation is still
 * recorded (in `details.op`), but the ledger's own action class says a REPLAY caused
 * it — so "excluded by User A" and "decision undone by User A" are two distinct,
 * both-visible rows rather than one rewritten one.
 */
export const VIA_ACTION = Object.freeze({ undo: 'FINAL_REVIEW_UNDO', redo: 'FINAL_REVIEW_REDO' });

/** ScreenAuditLog.details is capped at 4000 chars by writeAudit; keep free text short. */
const MAX_REASON = 500;

const trim = (v) => (typeof v === 'string' ? v.slice(0, MAX_REASON) : '');

/** Normalize the request-level `via` hint. Anything unrecognised degrades to 'user'. */
export function normalizeFinalReviewVia(value) {
  return FINAL_REVIEW_VIA.includes(value) ? value : 'user';
}

/** Settled = a decision that actually disposes of the report (§88). */
export function isSettledDecision(decision) {
  return decision === 'include' || decision === 'exclude';
}

/**
 * finalReviewAuditRow — the ledger row for ONE leader finalize/revert.
 *
 * @param {'accept'|'reject'|'revert'} op
 * @param {{via?:string, recordId?:string, details?:object}} [opts]
 * @returns {{action:string, entityType:string, entityId:string, details:object}|null}
 */
export function finalReviewAuditRow(op, { via = 'user', recordId = '', details = {} } = {}) {
  const opAction = FINAL_REVIEW_ACTIONS[op];
  if (!opAction || op === 'decide' || op === 'undecide') return null;
  const source = normalizeFinalReviewVia(via);
  return {
    // 117.md §56 — an undo is its own action class so the trail can show both the
    // original decision and the fact that it was undone.
    action: source === 'user' ? opAction : VIA_ACTION[source],
    entityType: 'record',
    entityId: String(recordId || '').slice(0, 220),
    details: {
      ...(details && typeof details === 'object' ? details : {}),
      op: opAction,
      // 109 r2 review precedent — `via` is CLIENT-CLAIMED. There is no server-side
      // proof that an undo really replayed history, so the ledger labels it honestly
      // (`claimedVia`) instead of implying provenance it cannot verify.
      via: source,
      claimedVia: source,
    },
  };
}

/**
 * fullTextDecisionAuditRow — the ledger row for ONE reviewer full-text decision, or
 * null when the write is not worth a row (§88 "do not turn ordinary … into excessive
 * audit noise").
 *
 * Audited:  undecided/maybe → include|exclude   (a settled decision was made)
 *           include|exclude → anything else     (a settled decision was withdrawn,
 *                                                which is what an undo does)
 * Skipped:  the same decision written again (autosave / double click),
 *           undecided ↔ maybe churn (neither state disposes of the report),
 *           every title/abstract write (that stage has its own volume and is not
 *           what §88 asks for).
 *
 * @param {{stage:string, decision:string, previous?:string, via?:string,
 *          recordId?:string, reviewerName?:string, exclusionReason?:string}} input
 */
export function fullTextDecisionAuditRow({
  stage, decision, previous = '', via = 'user',
  recordId = '', reviewerName = '', exclusionReason = '',
} = {}) {
  if (stage !== 'full_text') return null;
  const next = typeof decision === 'string' ? decision : '';
  const prev = typeof previous === 'string' ? previous : '';
  if (next === prev) return null;                                  // no-op repeat
  const settledNow = isSettledDecision(next);
  const settledBefore = isSettledDecision(prev);
  if (!settledNow && !settledBefore) return null;                  // maybe/undecided churn
  const source = normalizeFinalReviewVia(via);
  const opAction = settledNow ? FINAL_REVIEW_ACTIONS.decide : FINAL_REVIEW_ACTIONS.undecide;
  const details = {
    op: opAction,
    stage: 'full_text',
    decision: next || 'undecided',
    previous: prev || 'undecided',
    via: source,
    claimedVia: source,
  };
  if (reviewerName) details.reviewerName = trim(reviewerName);
  if (settledNow && next === 'exclude' && exclusionReason) details.exclusionReason = trim(exclusionReason);
  return {
    action: source === 'user' ? opAction : VIA_ACTION[source],
    entityType: 'record',
    entityId: String(recordId || '').slice(0, 220),
    details,
  };
}

export default {
  FINAL_REVIEW_VIA, FINAL_REVIEW_ACTIONS, VIA_ACTION,
  normalizeFinalReviewVia, isSettledDecision, finalReviewAuditRow, fullTextDecisionAuditRow,
};
