/**
 * 91.md — server access-response helper: capability enforcement throws structured
 * AccessError; sendAccessDenied/sendRestriction write the structured body + status.
 */
import { describe, it, expect } from 'vitest';
import {
  AccessError, requireProjectCapability, checkCapability, sendAccessDenied, sendRestriction, accessCtx,
} from '../../../server/services/accessResponse.js';

function mockRes() {
  return {
    _status: null, _json: null,
    status(s) { this._status = s; return this; },
    json(b) { this._json = b; return this; },
  };
}

const reviewer = { id: 'u1', role: 'user' };
const admin = { id: 'a1', role: 'admin' };
const reviewerAccess = { isOwner: false, isLeader: false, role: 'reviewer', perms: { canScreen: true, canRunAnalysis: false } };

describe('requireProjectCapability', () => {
  it('allows when the capability is granted', () => {
    const d = requireProjectCapability(reviewer, reviewerAccess, 'screen');
    expect(d.allowed).toBe(true);
  });
  it('throws a structured AccessError when denied', () => {
    let err;
    try { requireProjectCapability(reviewer, reviewerAccess, 'deleteProject'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AccessError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('ACCESS_RESTRICTED');
    expect(err.body.restrictionType).toBe('owner_only');
    expect(err.body.message).toContain('owner');
    expect(err.body.requiredPermission).toBe('deleteProject');
  });
  it('site admin bypasses admin_only capabilities', () => {
    expect(requireProjectCapability(admin, reviewerAccess, 'configureGuidedScreening').allowed).toBe(true);
    let err;
    try { requireProjectCapability(reviewer, reviewerAccess, 'configureGuidedScreening'); } catch (e) { err = e; }
    expect(err.body.restrictionType).toBe('admin_only');
  });
});

describe('sendAccessDenied / sendRestriction', () => {
  it('sendAccessDenied writes the AccessError body + 403', () => {
    const res = mockRes();
    let err;
    try { requireProjectCapability(reviewer, reviewerAccess, 'manageMembers'); } catch (e) { err = e; }
    expect(sendAccessDenied(res, err)).toBe(true);
    expect(res._status).toBe(403);
    expect(res._json.error).toBe('ACCESS_RESTRICTED');
    expect(res._json.restrictionType).toBe('leader_only');
  });
  it('sendAccessDenied returns false for a non-access error (caller rethrows)', () => {
    const res = mockRes();
    expect(sendAccessDenied(res, new Error('db down'))).toBe(false);
    expect(res._status).toBe(null);
  });
  it('sendRestriction emits an ad-hoc project-state denial', () => {
    const res = mockRes();
    sendRestriction(res, 'project_state', { capability: 'runAnalysis', message: 'Complete data extraction before running the meta-analysis.' });
    expect(res._status).toBe(403);
    expect(res._json.restrictionType).toBe('project_state');
    expect(res._json.message).toContain('extraction');
  });
  it('tier denial keeps the legacy TIER_LIMIT_EXCEEDED error code', () => {
    const res = mockRes();
    let err;
    try { requireProjectCapability(reviewer, reviewerAccess, 'wordExport', { hasEntitlement: () => false, tierId: 'free' }); } catch (e) { err = e; }
    expect(err.code).toBe('TIER_LIMIT_EXCEEDED');
    sendAccessDenied(res, err);
    expect(res._json.error).toBe('TIER_LIMIT_EXCEEDED');
  });
});

describe('checkCapability (non-throwing)', () => {
  it('returns a decision for branching', () => {
    const d = checkCapability(reviewer, reviewerAccess, 'runAnalysis');
    expect(d.allowed).toBe(false);
    expect(d.restrictionType).toBe('permission');
  });
  it('accessCtx maps admin role', () => {
    expect(accessCtx(admin, reviewerAccess).isAdmin).toBe(true);
  });
});
