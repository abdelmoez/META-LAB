/**
 * auditFormat.test.js — human-readable audit/security descriptions + severity
 * (prompt49 item 10). Pure, shared by the Ops console UI and the server filter.
 */
import { describe, it, expect } from 'vitest';
import {
  describeAuditEvent, describeSecurityEvent, parseDetails, extractChanges,
  auditActionWhereForSeverity, securityTypeWhereForSeverity, humanizeAction,
  SEVERITY_ORDER,
} from '../../src/shared/auditFormat.js';

describe('parseDetails', () => {
  it('handles objects, JSON strings, and garbage', () => {
    expect(parseDetails({ a: 1 })).toEqual({ a: 1 });
    expect(parseDetails('{"a":1}')).toEqual({ a: 1 });
    expect(parseDetails('not json')).toEqual({ _raw: 'not json' });
    expect(parseDetails(null)).toEqual({});
  });
});

describe('describeAuditEvent', () => {
  const admin = { email: 'ops@pecanrev.com', name: 'Ops' };
  it('renders a sentence + severity for a suspension', () => {
    const r = describeAuditEvent({ action: 'SUSPEND_USER', admin, entityId: 'u1', details: { email: 'bad@x.com' } });
    expect(r.severity).toBe('high');
    expect(r.description).toMatch(/Ops/);
    expect(r.description).toMatch(/suspended/i);
    expect(r.description).toMatch(/bad@x\.com/);
  });

  it('shows before→after for a role change', () => {
    const r = describeAuditEvent({ action: 'ASSIGN_ROLE', admin, details: { email: 'u@x.com', before: 'user', after: 'admin' } });
    expect(r.severity).toBe('high');
    expect(r.description).toMatch(/user → admin/);
  });

  it('lists changed fields for a user update and exposes structured changes', () => {
    const r = describeAuditEvent({ action: 'USER_UPDATED_BY_ADMIN', admin, details: { email: 'u@x.com', changed: ['name', 'country'], before: { name: 'A' }, after: { name: 'B' } } });
    expect(r.severity).toBe('medium');
    expect(r.description).toMatch(/name, country/);
    expect(r.changes).toEqual([{ field: 'name', before: 'A', after: 'B' }]);
  });

  it('falls back to a humanised label at INFO for unknown actions', () => {
    const r = describeAuditEvent({ action: 'SOME_NEW_THING', admin, details: {} });
    expect(r.severity).toBe('info');
    expect(r.label).toBe('Some New Thing');
    expect(r.description).toMatch(/Some New Thing/);
  });
});

describe('describeSecurityEvent', () => {
  it('describes a failed login with email + IP', () => {
    const r = describeSecurityEvent({ type: 'FAILED_LOGIN', email: 'a@b.com', ip: '1.2.3.4' });
    expect(r.severity).toBe('medium');
    expect(r.description).toMatch(/failed login/i);
    expect(r.description).toMatch(/a@b\.com/);
    expect(r.description).toMatch(/1\.2\.3\.4/);
  });
  it('rates admin-access-denied as high', () => {
    expect(describeSecurityEvent({ type: 'ADMIN_ACCESS_DENIED' }).severity).toBe('high');
  });
});

describe('severity → WHERE translation', () => {
  it('maps a specific severity to an IN list of actions', () => {
    const w = auditActionWhereForSeverity('high');
    expect(w.in).toContain('SUSPEND_USER');
    expect(w.in).toContain('ASSIGN_ROLE');
    expect(w.in).not.toContain('UPDATE_SETTING');
  });
  it('maps INFO to a NOT-IN list so unknown actions fall into the info bucket', () => {
    const w = auditActionWhereForSeverity('info');
    expect(w.notIn).toContain('SUSPEND_USER');   // a high action is excluded
    expect(w.notIn).not.toContain('SOME_UNKNOWN'); // unknown actions are NOT excluded → counted as info
  });
  it('security: high includes ADMIN_ACCESS_DENIED', () => {
    expect(securityTypeWhereForSeverity('high').in).toContain('ADMIN_ACCESS_DENIED');
  });
  it('returns null for an unknown severity (no filter)', () => {
    expect(auditActionWhereForSeverity('nonsense')).toBeNull();
  });
});

describe('helpers', () => {
  it('humanizeAction title-cases snake case', () => {
    expect(humanizeAction('UPDATE_SETTING')).toBe('Update Setting');
  });
  it('extractChanges returns [] with no before/after', () => {
    expect(extractChanges({ foo: 1 })).toEqual([]);
  });
  it('SEVERITY_ORDER is critical→info', () => {
    expect(SEVERITY_ORDER[0]).toBe('critical');
    expect(SEVERITY_ORDER.at(-1)).toBe('info');
  });
});
