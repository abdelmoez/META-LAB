/**
 * userTimeline.test.js — 95.md Phase 5/13 — pure timeline merge (hermetic).
 */
import { describe, it, expect } from 'vitest';
import { buildUserTimeline } from '../../server/services/userTimeline.js';

const D = (s) => new Date(s);
const baseUser = {
  createdAt: D('2026-01-10T10:00:00Z'), emailVerifiedAt: D('2026-01-11T10:00:00Z'),
  suspended: false, suspendedAt: null, passwordChangedAt: null, registrationMethod: 'email',
};

describe('buildUserTimeline', () => {
  it('pre-event-era users still get a history from column timestamps', () => {
    const ev = buildUserTimeline({ user: baseUser });
    expect(ev.map((e) => e.kind)).toEqual(['email_verified', 'registered']); // newest first
    expect(ev[1].label).toBe('Registered with email');
  });
  it('merges sources newest-first, attributes admins, dedupes same-minute duplicates', () => {
    const ev = buildUserTimeline({
      user: baseUser,
      auditRows: [
        { action: 'UPDATE_USER_TIER', details: JSON.stringify({ to: 'pro' }), createdAt: D('2026-02-01T09:00:10Z'), adminId: 'a1' },
        { action: 'SUSPEND_USER', details: JSON.stringify({ suspended: true }), createdAt: D('2026-02-02T09:00:00Z'), adminId: 'a1' },
        { action: 'SUSPEND_USER', details: JSON.stringify({ suspended: false }), createdAt: D('2026-02-03T09:00:00Z'), adminId: 'a1' },
      ],
      // Same minute as the audit tier change — must collapse to ONE tier_changed.
      tierAssignments: [{ tierId: 'pro', changeType: 'manual', assignedByName: 'Ops Admin', createdAt: D('2026-02-01T09:00:40Z') }],
      securityEvents: [{ type: 'GOOGLE_ACCOUNT_LINKED', createdAt: D('2026-02-04T12:00:00Z') }],
      loginEvents: [{ createdAt: D('2026-02-05T08:00:00Z') }],
      adminNames: new Map([['a1', 'Ops Admin']]),
    });
    const kinds = ev.map((e) => e.kind);
    expect(kinds).toEqual(['login', 'google_linked', 'restored', 'suspended', 'tier_changed', 'email_verified', 'registered']);
    expect(ev.find((e) => e.kind === 'suspended').actor).toBe('Ops Admin');
    expect(kinds.filter((k) => k === 'tier_changed')).toHaveLength(1);
  });
  it('caps at 50 events and never throws on malformed details JSON', () => {
    const audits = Array.from({ length: 80 }, (_, i) => ({
      action: 'USER_UPDATED_BY_ADMIN', details: '{broken', adminId: 'a1',
      createdAt: D(`2026-03-01T00:00:00Z`).getTime() + i * 120000,
    })).map((a) => ({ ...a, createdAt: new Date(a.createdAt) }));
    const ev = buildUserTimeline({ user: baseUser, auditRows: audits });
    expect(ev.length).toBe(50);
    expect(ev[0].kind).toBe('admin_edit');
  });
});
