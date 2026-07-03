/**
 * tierHistory.test.js — pure tier-history/analytics helpers (72.md).
 *
 * Targets the DB-free functions that the analytics + users-in-tier + CSV export
 * endpoints are built on, so they earn deterministic coverage without a server:
 *   - tierMoveDirection  (promotion / downgrade / lateral / initial by sortOrder)
 *   - daysInTier         (whole days since effectiveFrom, floored at 0)
 *   - pctOf              (one-decimal percentage, div-by-zero safe)
 *   - isExpiringSoon     (effectiveUntil within the window, not already past)
 *   - isValidChangeType / coerceChangeType (change-type vocabulary discipline)
 *   - csvEscape / usersInTierCsv (RFC-4180-ish CSV of the users-in-tier rows)
 */
import { describe, it, expect } from 'vitest';
import {
  tierMoveDirection, daysInTier, pctOf, isExpiringSoon,
  isValidChangeType, coerceChangeType, VALID_CHANGE_TYPES,
} from '../../server/services/entitlementService.js';
import { csvEscape, usersInTierCsv } from '../../server/controllers/tierAdminController.js';

const ORDER = new Map([['free', 0], ['plus', 1], ['pro', 2]]);
const DAY = 86400000;

describe('tierMoveDirection', () => {
  it('no previous tier is an initial assignment', () => {
    expect(tierMoveDirection(null, 'free', ORDER)).toBe('initial');
    expect(tierMoveDirection(undefined, 'pro', ORDER)).toBe('initial');
  });
  it('same tier is lateral', () => {
    expect(tierMoveDirection('plus', 'plus', ORDER)).toBe('lateral');
  });
  it('a higher sortOrder is a promotion, lower is a downgrade', () => {
    expect(tierMoveDirection('free', 'plus', ORDER)).toBe('promotion');
    expect(tierMoveDirection('plus', 'pro', ORDER)).toBe('promotion');
    expect(tierMoveDirection('pro', 'free', ORDER)).toBe('downgrade');
    expect(tierMoveDirection('pro', 'plus', ORDER)).toBe('downgrade');
  });
  it('unknown tiers (no sortOrder) fall back to lateral', () => {
    expect(tierMoveDirection('mystery', 'plus', ORDER)).toBe('lateral');
    expect(tierMoveDirection('free', 'mystery', ORDER)).toBe('lateral');
  });
});

describe('daysInTier', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  it('returns whole days since effectiveFrom', () => {
    expect(daysInTier(new Date(now.getTime() - 10 * DAY), now)).toBe(10);
    expect(daysInTier(new Date(now.getTime() - 1.9 * DAY), now)).toBe(1); // floored
  });
  it('is 0 for a null / future / invalid effectiveFrom', () => {
    expect(daysInTier(null, now)).toBe(0);
    expect(daysInTier(new Date(now.getTime() + 5 * DAY), now)).toBe(0);
    expect(daysInTier('not-a-date', now)).toBe(0);
  });
  it('accepts an ISO string for effectiveFrom', () => {
    expect(daysInTier('2026-06-21T00:00:00.000Z', now)).toBe(10);
  });
});

describe('pctOf', () => {
  it('computes a one-decimal percentage', () => {
    expect(pctOf(3, 10)).toBe(30);
    expect(pctOf(1, 3)).toBe(33.3);
    expect(pctOf(2, 3)).toBe(66.7);
  });
  it('is 0 when the total is 0 or negative (no NaN/Infinity)', () => {
    expect(pctOf(0, 0)).toBe(0);
    expect(pctOf(5, 0)).toBe(0);
    expect(pctOf(1, -4)).toBe(0);
  });
});

describe('isExpiringSoon', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  it('true when effectiveUntil is within the window and not past', () => {
    expect(isExpiringSoon(new Date(now.getTime() + 10 * DAY), now, 30)).toBe(true);
    expect(isExpiringSoon(new Date(now.getTime() + 30 * DAY), now, 30)).toBe(true); // boundary inclusive
  });
  it('false when null, already past, or beyond the window', () => {
    expect(isExpiringSoon(null, now, 30)).toBe(false);
    expect(isExpiringSoon(new Date(now.getTime() - DAY), now, 30)).toBe(false);
    expect(isExpiringSoon(new Date(now.getTime() + 40 * DAY), now, 30)).toBe(false);
  });
});

describe('change-type vocabulary', () => {
  it('accepts every declared change type', () => {
    for (const t of VALID_CHANGE_TYPES) expect(isValidChangeType(t)).toBe(true);
    expect(VALID_CHANGE_TYPES).toContain('promotion');
    expect(VALID_CHANGE_TYPES).toContain('trial_start');
    expect(VALID_CHANGE_TYPES).toContain('backfill');
  });
  it('rejects unknown types and coerces them to manual', () => {
    expect(isValidChangeType('nope')).toBe(false);
    expect(coerceChangeType('nope')).toBe('manual');
    expect(coerceChangeType(undefined)).toBe('manual');
    expect(coerceChangeType('downgrade')).toBe('downgrade');
  });
});

describe('csvEscape', () => {
  it('leaves plain values untouched', () => {
    expect(csvEscape('abc')).toBe('abc');
    expect(csvEscape(42)).toBe('42');
  });
  it('renders null/undefined as an empty field', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
  it('quotes and doubles quotes for values with comma/quote/newline', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
  it('serialises a Date as ISO', () => {
    expect(csvEscape(new Date('2026-07-01T00:00:00.000Z'))).toBe('2026-07-01T00:00:00.000Z');
  });
});

describe('usersInTierCsv', () => {
  it('emits a header row then one line per user, escaping tricky fields', () => {
    const csv = usersInTierCsv([
      {
        id: 'u1', email: 'a@x.com', name: 'Ann', role: 'user', tierId: 'plus',
        dateEntered: new Date('2026-06-01T00:00:00.000Z'), daysInTier: 30,
        previousTierId: 'free', changeType: 'promotion', assignedByName: 'Admin, Root',
        reason: 'upgraded, per request', effectiveUntil: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'), lastActive: null, status: 'active',
      },
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,email,name,role,tierId,dateEntered,daysInTier,previousTierId,changeType,assignedByName,reason,effectiveUntil,createdAt,lastActive,status');
    expect(lines).toHaveLength(2);
    // Comma-bearing fields are quoted.
    expect(lines[1]).toContain('"Admin, Root"');
    expect(lines[1]).toContain('"upgraded, per request"');
    expect(lines[1]).toContain('u1,a@x.com,Ann,user,plus');
  });
  it('a zero-row export is just the header', () => {
    expect(usersInTierCsv([])).toBe('id,email,name,role,tierId,dateEntered,daysInTier,previousTierId,changeType,assignedByName,reason,effectiveUntil,createdAt,lastActive,status');
  });
});
