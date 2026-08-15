/**
 * finalReviewAudit.test.js — 117.md §56/§88. The pure ledger-row builder for Final
 * Review.
 *
 * §56 is the requirement this exists for: "Undo must not falsify history. The audit
 * trail should be able to show (1) Article excluded by User A, (2) Decision undone by
 * User A, rather than pretending the original action never occurred." That is a
 * property of the ACTION STRING, so it is decided here — the controller only appends
 * whatever row this returns.
 *
 * §88 is the counterweight: "do not turn ordinary … into excessive audit noise". The
 * reviewer-decision filter therefore lives here too, so the rule is testable without a
 * database and cannot drift between call sites.
 */
import { describe, it, expect } from 'vitest';
import {
  FINAL_REVIEW_VIA, FINAL_REVIEW_ACTIONS, VIA_ACTION,
  normalizeFinalReviewVia, isSettledDecision,
  finalReviewAuditRow, fullTextDecisionAuditRow,
} from '../../../server/screening/finalReviewAudit.js';

describe('normalizeFinalReviewVia — a client-claimed marker, defaulted safely', () => {
  it('accepts exactly the three markers', () => {
    expect(FINAL_REVIEW_VIA).toEqual(['user', 'undo', 'redo']);
    for (const v of FINAL_REVIEW_VIA) expect(normalizeFinalReviewVia(v)).toBe(v);
  });

  it('degrades anything else to "user" — a forged marker cannot invent a class', () => {
    expect(normalizeFinalReviewVia('automation')).toBe('user');
    expect(normalizeFinalReviewVia(undefined)).toBe('user');
    expect(normalizeFinalReviewVia({ toString: () => 'undo' })).toBe('user');
  });
});

describe('finalReviewAuditRow — the leader verdict (§56)', () => {
  it('records a human exclude as RECORD_REJECTED', () => {
    const row = finalReviewAuditRow('reject', { recordId: 'r1', details: { reason: 'wrong population' } });
    expect(row.action).toBe('RECORD_REJECTED');
    expect(row.entityType).toBe('record');
    expect(row.entityId).toBe('r1');
    expect(row.details).toMatchObject({
      reason: 'wrong population', op: 'RECORD_REJECTED', via: 'user', claimedVia: 'user',
    });
  });

  it('records the UNDO of that exclude as its own row, not as a rewrite', () => {
    const row = finalReviewAuditRow('revert', { via: 'undo', recordId: 'r1', details: { from: 'rejected' } });
    expect(row.action).toBe('FINAL_REVIEW_UNDO');
    // The physical operation is still on the record — the trail says WHAT happened
    // and WHY it happened, and the original RECORD_REJECTED row is untouched.
    expect(row.details.op).toBe('RECORD_REVERTED');
    expect(row.details.from).toBe('rejected');
    expect(row.details.via).toBe('undo');
  });

  it('records a REDO distinctly from an undo and from a fresh decision', () => {
    expect(finalReviewAuditRow('reject', { via: 'redo' }).action).toBe('FINAL_REVIEW_REDO');
    expect(finalReviewAuditRow('accept', { via: 'redo' }).action).toBe('FINAL_REVIEW_REDO');
    expect(finalReviewAuditRow('accept', { via: 'user' }).action).toBe('RECORD_ACCEPTED');
    expect(VIA_ACTION).toEqual({ undo: 'FINAL_REVIEW_UNDO', redo: 'FINAL_REVIEW_REDO' });
  });

  it('labels the marker as CLAIMED — the server cannot prove an undo replayed', () => {
    const row = finalReviewAuditRow('revert', { via: 'undo' });
    expect(row.details.via).toBe('undo');
    expect(row.details.claimedVia).toBe('undo');
  });

  it('refuses to invent a row for an unknown operation', () => {
    expect(finalReviewAuditRow('delete')).toBeNull();
    expect(finalReviewAuditRow('decide')).toBeNull();   // reviewer decisions use the other builder
    expect(finalReviewAuditRow(undefined)).toBeNull();
  });

  it('keeps the physical action strings the existing ledger already uses', () => {
    expect(FINAL_REVIEW_ACTIONS.accept).toBe('RECORD_ACCEPTED');
    expect(FINAL_REVIEW_ACTIONS.reject).toBe('RECORD_REJECTED');
    expect(FINAL_REVIEW_ACTIONS.revert).toBe('RECORD_REVERTED');
  });
});

describe('fullTextDecisionAuditRow — §88 "final review include/exclude", without the noise', () => {
  const base = { stage: 'full_text', recordId: 'r1', reviewerName: 'Dr A' };

  it('audits a settled include/exclude at full text', () => {
    const row = fullTextDecisionAuditRow({ ...base, decision: 'exclude', previous: '', exclusionReason: 'no full text' });
    expect(row.action).toBe('FINAL_REVIEW_DECISION');
    expect(row.entityId).toBe('r1');
    expect(row.details).toMatchObject({
      stage: 'full_text', decision: 'exclude', previous: 'undecided',
      reviewerName: 'Dr A', exclusionReason: 'no full text', via: 'user',
    });
    expect(fullTextDecisionAuditRow({ ...base, decision: 'include', previous: 'maybe' }).action)
      .toBe('FINAL_REVIEW_DECISION');
  });

  it('audits the WITHDRAWAL of a settled decision — that is what an undo writes', () => {
    const row = fullTextDecisionAuditRow({ ...base, decision: 'undecided', previous: 'include', via: 'undo' });
    // §56 again: the undo of a final-review vote must be visible, not silent.
    expect(row.action).toBe('FINAL_REVIEW_UNDO');
    expect(row.details.op).toBe('FINAL_REVIEW_DECISION_CLEARED');
    expect(row.details.previous).toBe('include');
    expect(row.details.decision).toBe('undecided');
  });

  it('skips a no-op repeat (autosave / a double click)', () => {
    expect(fullTextDecisionAuditRow({ ...base, decision: 'include', previous: 'include' })).toBeNull();
    expect(fullTextDecisionAuditRow({ ...base, decision: 'undecided', previous: '' })).toBeNull();
  });

  it('skips maybe/undecided churn — neither state disposes of the report', () => {
    expect(fullTextDecisionAuditRow({ ...base, decision: 'maybe', previous: 'undecided' })).toBeNull();
    expect(fullTextDecisionAuditRow({ ...base, decision: 'undecided', previous: 'maybe' })).toBeNull();
    expect(fullTextDecisionAuditRow({ ...base, decision: 'maybe', previous: '' })).toBeNull();
    // …but withdrawing a settled decision INTO 'maybe' is a real change of disposition.
    expect(fullTextDecisionAuditRow({ ...base, decision: 'maybe', previous: 'exclude' }).action)
      .toBe('FINAL_REVIEW_DECISION_CLEARED');
  });

  it('never audits title/abstract screening — that volume is not what §88 asks for', () => {
    expect(fullTextDecisionAuditRow({ ...base, stage: 'title_abstract', decision: 'include', previous: '' })).toBeNull();
    expect(fullTextDecisionAuditRow({ ...base, stage: undefined, decision: 'include' })).toBeNull();
  });

  it('carries an exclusion reason only where it belongs', () => {
    const inc = fullTextDecisionAuditRow({ ...base, decision: 'include', previous: '', exclusionReason: 'leftover' });
    expect(inc.details).not.toHaveProperty('exclusionReason');
    const cleared = fullTextDecisionAuditRow({ ...base, decision: 'undecided', previous: 'exclude', exclusionReason: 'x' });
    expect(cleared.details).not.toHaveProperty('exclusionReason');
  });

  it('bounds the free text it copies into details (writeAudit caps at 4000)', () => {
    const row = fullTextDecisionAuditRow({
      ...base, decision: 'exclude', previous: '', exclusionReason: 'x'.repeat(5000),
    });
    expect(row.details.exclusionReason.length).toBe(500);
  });

  it('isSettledDecision names only the two disposing verdicts', () => {
    expect(isSettledDecision('include')).toBe(true);
    expect(isSettledDecision('exclude')).toBe(true);
    expect(isSettledDecision('maybe')).toBe(false);
    expect(isSettledDecision('undecided')).toBe(false);
    expect(isSettledDecision('')).toBe(false);
  });
});
