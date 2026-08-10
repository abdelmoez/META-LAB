/**
 * screening/keywordAudit.js — PURE audit-row builder for keyword-list mutations.
 *
 * 109.md §22/§23 — keyword mutations were the one project-mutation class with ZERO
 * audit coverage: `keywordOps` (server/controllers/screeningController.js) wrote no
 * ScreenAuditLog row and emitted no ProjectEvent, so "who deleted this keyword?" was
 * unanswerable. This module turns an applied keyword batch into the rows the
 * controller appends to the project ledger.
 *
 * Kept pure (no prisma, no express) so the row SHAPE is unit-testable without a
 * database — the house style for audit/coercion logic (researchOpsAdminController's
 * exported coercers, screeningAiAdminController's diff helper).
 *
 * 109.md §50 — undo/redo and audit are SEPARATE systems. An undo never rewrites or
 * deletes the original row; it appends a new one. The physical operation that ran is
 * always recorded, and `via` says whether a human gesture, an undo or a redo caused
 * it — so "keyword deletion undone" (§23) is a new immutable record, not a mutation
 * of the deletion record.
 */

/** Physical keyword operation → project-ledger action string. */
export const KEYWORD_AUDIT_ACTIONS = Object.freeze({
  'add': 'KEYWORD_ADDED',
  'remove': 'KEYWORD_REMOVED',
  'move': 'KEYWORD_MOVED',
  'accept': 'KEYWORD_SUGGESTION_ACCEPTED',
  'reject': 'KEYWORD_SUGGESTION_REJECTED',
  'clear-decision': 'KEYWORD_DECISION_CLEARED',
});

/**
 * Accepted values of the optional top-level `via` hint on a keywordOps request.
 * 'user' is the default and the only value a pre-109 client sends (by omission).
 */
export const KEYWORD_AUDIT_VIA = Object.freeze(['user', 'undo', 'redo']);

/** Audit action used when the batch was replayed by the 108 history system. */
const VIA_ACTION = Object.freeze({ undo: 'KEYWORD_UNDO', redo: 'KEYWORD_REDO' });

/** ScreenAuditLog.details is capped at 4000 chars by writeAudit; keep terms short. */
const MAX_TERM = 200;

const trim = (v) => (typeof v === 'string' ? v.slice(0, MAX_TERM) : '');

/** Normalize the request-level `via` hint. Anything unrecognised degrades to 'user'. */
export function normalizeKeywordVia(value) {
  return KEYWORD_AUDIT_VIA.includes(value) ? value : 'user';
}

/**
 * Build the ledger rows for one applied keyword batch.
 *
 * Only ops that ACTUALLY changed state are audited: `applyKeywordOps` returns a
 * per-op `{changed, reason}` aligned with the input array, and a no-op (re-adding a
 * term that is already present) is not an event. Auditing no-ops would make the
 * trail noisy and would let a client inflate the ledger for free.
 *
 * @param {Array<object>} ops     - the picked ops, in request order
 * @param {Array<{changed:boolean, reason?:string}>} results - applyKeywordOps results
 * @param {{via?:string}} [opts]
 * @returns {Array<{action:string, entityType:string, entityId:string, details:object}>}
 */
export function keywordAuditRows(ops, results, { via = 'user' } = {}) {
  if (!Array.isArray(ops)) return [];
  const list = Array.isArray(results) ? results : [];
  const source = normalizeKeywordVia(via);
  const rows = [];
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];
    if (!op || typeof op !== 'object') continue;
    const outcome = list[i];
    // A batch with no per-op results (single-op legacy shape) is audited when the
    // caller passes a one-element results array; anything else is skipped rather
    // than guessed at.
    if (!outcome || outcome.changed !== true) continue;
    const opAction = KEYWORD_AUDIT_ACTIONS[op.type];
    if (!opAction) continue;

    const term = trim(op.term);
    // 109 r2 review fix — `via` is CLIENT-CLAIMED and recorded as such. It arrives on
    // the request body and there is no server-side proof that an undo really replayed
    // history, so the ledger labels it honestly instead of implying provenance it
    // cannot verify. `via` is kept alongside it so existing readers (and the §23
    // audit filter) are unchanged; both always carry the same value.
    const details = { op: opAction, term, list: op.list, via: source, claimedVia: source };
    if (op.type === 'move') details.toList = op.toList || (op.list === 'include' ? 'exclude' : 'include');
    if (op.origin !== undefined) details.origin = op.origin;
    if (op.reject !== undefined) details.reject = op.reject;
    if (op.removeTerm !== undefined) details.removeTerm = op.removeTerm;
    if (outcome.reason) details.reason = outcome.reason;

    rows.push({
      // 109.md §23 — an undo/redo replay is its own action class so the audit
      // filter can separate "a leader deleted this" from "a leader undid that".
      action: source === 'user' ? opAction : VIA_ACTION[source],
      entityType: 'keyword',
      entityId: `${op.list}:${term}`.slice(0, 220),
      details,
    });
  }
  return rows;
}
