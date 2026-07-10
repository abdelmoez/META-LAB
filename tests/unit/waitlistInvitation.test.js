/**
 * waitlistInvitation.test.js — unit tests for the pure invitation domain module
 * (80.md). No server, no DB — every function here is dependency-free.
 */
import { describe, it, expect } from 'vitest';
import {
  INVITATION_STATUSES,
  INVITE_STATES,
  INVITE_STATE_LABELS,
  INVITE_PASSWORD_MIN,
  validateInvitePassword,
  deriveInviteState,
  inviteEligibility,
  isBulkInvitable,
  maskInviteEmail,
} from '../../src/shared/waitlistInvitation.js';

const NOW = 1_700_000_000_000;
const future = () => new Date(NOW + 86400000);
const past = () => new Date(NOW - 86400000);

describe('validateInvitePassword', () => {
  it('rejects passwords shorter than the minimum', () => {
    const r = validateInvitePassword('short');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(new RegExp(`${INVITE_PASSWORD_MIN}`));
  });
  it('rejects mismatched confirmation', () => {
    const r = validateInvitePassword('longenough1', 'longenough2');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/match/i);
  });
  it('accepts a valid password with matching confirm', () => {
    expect(validateInvitePassword('longenough1', 'longenough1')).toEqual({ ok: true });
  });
  it('accepts a valid password with no confirm argument', () => {
    expect(validateInvitePassword('longenough1').ok).toBe(true);
  });
  it('rejects absurdly long passwords (DoS guard)', () => {
    expect(validateInvitePassword('a'.repeat(500)).ok).toBe(false);
  });
});

describe('deriveInviteState', () => {
  it('is waiting with no invitation', () => {
    expect(deriveInviteState({ status: 'WAITLISTED' }, null, NOW)).toBe('waiting');
  });
  it('is invited for a live pending invitation whose email sent', () => {
    expect(deriveInviteState({ status: 'INVITED' }, { status: 'pending', expiresAt: future(), emailStatus: 'sent' }, NOW)).toBe('invited');
  });
  it('is expired for a pending invitation past its expiry (derived, not stored)', () => {
    expect(deriveInviteState({ status: 'INVITED' }, { status: 'pending', expiresAt: past(), emailStatus: 'sent' }, NOW)).toBe('expired');
  });
  it('is failed for a live pending invitation whose email failed', () => {
    expect(deriveInviteState({ status: 'INVITED' }, { status: 'pending', expiresAt: future(), emailStatus: 'failed' }, NOW)).toBe('failed');
  });
  it('expiry takes precedence over a failed email', () => {
    expect(deriveInviteState({ status: 'INVITED' }, { status: 'pending', expiresAt: past(), emailStatus: 'failed' }, NOW)).toBe('expired');
  });
  it('is revoked for a revoked invitation', () => {
    expect(deriveInviteState({ status: 'INVITED' }, { status: 'revoked', expiresAt: future() }, NOW)).toBe('revoked');
  });
  it('is accepted when the invitation is accepted', () => {
    expect(deriveInviteState({ status: 'INVITED' }, { status: 'accepted' }, NOW)).toBe('accepted');
  });
  it('is accepted when the applicant is ACCEPTED even without an invitation', () => {
    expect(deriveInviteState({ status: 'ACCEPTED' }, null, NOW)).toBe('accepted');
  });
  it('treats a superseded latest row as freshly invitable (waiting)', () => {
    expect(deriveInviteState({ status: 'WAITLISTED' }, { status: 'superseded', expiresAt: future() }, NOW)).toBe('waiting');
  });
  it('only returns valid INVITE_STATES', () => {
    const s = deriveInviteState({ status: 'INVITED' }, { status: 'pending', expiresAt: future(), emailStatus: 'sent' }, NOW);
    expect(INVITE_STATES).toContain(s);
  });
});

describe('inviteEligibility', () => {
  it('waiting → can invite only', () => {
    expect(inviteEligibility('waiting')).toMatchObject({ canInvite: true, canResend: false, canRevoke: false });
  });
  it('expired/failed → can (re)invite', () => {
    expect(inviteEligibility('expired').canInvite).toBe(true);
    expect(inviteEligibility('failed').canInvite).toBe(true);
  });
  it('invited → resend + revoke, not a fresh invite', () => {
    expect(inviteEligibility('invited')).toMatchObject({ canInvite: false, canResend: true, canRevoke: true });
  });
  it('revoked → can reinvite (intentional), not resend', () => {
    expect(inviteEligibility('revoked')).toMatchObject({ canInvite: true, canResend: false });
  });
  it('accepted → nothing', () => {
    expect(inviteEligibility('accepted')).toMatchObject({ canInvite: false, canResend: false, canRevoke: false });
  });
});

describe('isBulkInvitable', () => {
  it('includes waiting/expired/failed/revoked/invited', () => {
    for (const s of ['waiting', 'expired', 'failed', 'revoked', 'invited']) expect(isBulkInvitable(s)).toBe(true);
  });
  it('excludes accepted', () => {
    expect(isBulkInvitable('accepted')).toBe(false);
  });
});

describe('maskInviteEmail', () => {
  it('masks local + domain but keeps the tld', () => {
    expect(maskInviteEmail('jane@example.com')).toBe('j***@e***.com');
  });
  it('returns empty for a non-email', () => {
    expect(maskInviteEmail('not-an-email')).toBe('');
    expect(maskInviteEmail('')).toBe('');
  });
});

describe('constants', () => {
  it('exposes the four stored statuses and six lifecycle states', () => {
    expect(INVITATION_STATUSES).toEqual(['pending', 'accepted', 'revoked', 'superseded']);
    expect(INVITE_STATES).toEqual(['waiting', 'invited', 'accepted', 'expired', 'revoked', 'failed']);
    for (const s of INVITE_STATES) expect(INVITE_STATE_LABELS[s]).toBeTruthy();
  });
});
