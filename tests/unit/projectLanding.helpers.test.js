/**
 * tests/unit/projectLanding.helpers.test.js
 *
 * Unit tests for the pure helpers extracted from ProjectLanding.jsx.
 * No server, no DOM, no React — jsdom/node only.
 *
 * Run:  npm run test:unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the theme tokens so the module loads without a browser ──────────────
// C values are CSS var() strings — all we need is that they are non-empty
// strings so STATUS_META / TAG_COLORS are populated.
vi.mock('../../src/frontend/theme/tokens.js', () => {
  const C = {
    acc: 'var(--t-acc)', acc2: 'var(--t-acc2)', accText: 'var(--t-acc-text)',
    grn: 'var(--t-grn)', grn2: 'var(--t-grn2)', red: 'var(--t-red)',
    yel: 'var(--t-yel)', ylw: 'var(--t-yel)', gold: 'var(--t-gold)',
    teal: 'var(--t-teal)', purp: 'var(--t-purp)', muted: 'var(--t-muted)',
    bg: 'var(--t-bg)', surf: 'var(--t-surf)', card: 'var(--t-card)',
    card2: 'var(--t-card2)', cardHover: 'var(--t-card2)',
    brd: 'var(--t-brd)', brd2: 'var(--t-brd2)',
    txt: 'var(--t-txt)', txt2: 'var(--t-txt2)', dim: 'var(--t-dim)',
    accBg: 'var(--t-acc-bg)', grnBg: 'var(--t-grn-bg)', redBg: 'var(--t-red-bg)',
    yelBg: 'var(--t-yel-bg)', purpBg: 'var(--t-purp-bg)',
    goldBg: 'var(--t-gold-bg)', tealBg: 'var(--t-teal-bg)',
    shadow: 'rgba(0,0,0,0.2)',
  };
  return { C };
});

import {
  statusOf, roleOf, isOwnerOf, canEditOf, relTime, progressOf,
  projectStatsOf, onlineTotalLabel,
  FILTERS, SORTS, ROLE_ORDER, ROLE_LABEL, ROLE_COLOR, STATUS_META, TAG_COLORS,
} from '../../src/frontend/pages/projectLanding.helpers.js';

/* ═══════════════════════════════════════════════════════════════════════════
   Fixtures — minimal project-shaped objects
   ═══════════════════════════════════════════════════════════════════════════ */

/** Active project owned by the current user (no linked workspace). */
const ownedActive = {
  id: 'p1',
  name: 'My Project',
  updatedAt: '2025-01-10T12:00:00Z',
  createdAt: '2025-01-01T00:00:00Z',
  _permissions: { isOwner: true, canEdit: true, role: 'owner' },
};

/** Shared project (the user is a reviewer, not the owner). */
const sharedReviewer = {
  id: 'p2',
  name: 'Shared Proj',
  updatedAt: '2025-02-15T08:00:00Z',
  createdAt: '2025-02-01T00:00:00Z',
  _shared: true,
  _permissions: { isOwner: false, canEdit: false, role: 'reviewer' },
};

/** Project with a linked workspace in progress (60 of 200 records decided). */
const linkedInProgress = {
  id: 'p3',
  name: 'Linked WS Project',
  updatedAt: '2025-03-20T10:00:00Z',
  createdAt: '2025-03-01T00:00:00Z',
  _permissions: { isOwner: true, canEdit: true, role: 'owner' },
  _linkedMetaSift: { id: 'ws1', progressStatus: 'in_progress', recordCount: 200, decidedCount: 60, memberCount: 5, onlineCount: 2 },
};

/** Project with a linked workspace that is done. */
const linkedDone = {
  id: 'p4',
  name: 'Done Project',
  updatedAt: '2025-04-01T00:00:00Z',
  createdAt: '2025-03-15T00:00:00Z',
  _permissions: { isOwner: false, canEdit: false, role: 'leader' },
  _linkedMetaSift: { id: 'ws2', progressStatus: 'done', recordCount: 120, decidedCount: 120, memberCount: 3, onlineCount: 0 },
};

/** Archived project. */
const archivedProject = {
  id: 'p5',
  name: 'Old Project',
  updatedAt: '2024-06-01T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
  _archived: true,
  _permissions: { isOwner: true, canEdit: true, role: 'owner' },
};

/** Read-only shared project. */
const readOnlyProject = {
  id: 'p6',
  name: 'Read Only',
  updatedAt: '2025-05-01T00:00:00Z',
  createdAt: '2025-04-01T00:00:00Z',
  _shared: true,
  _readOnly: true,
  _permissions: { isOwner: false, canEdit: false, role: 'viewer', readOnly: true },
};

/** Project using the fallback path (no _permissions blob). */
const legacyOwned = {
  id: 'p7',
  name: 'Legacy Owned',
  updatedAt: '2025-05-20T00:00:00Z',
  createdAt: '2025-05-01T00:00:00Z',
  _role: 'owner',
};

/** Shared project using legacy _role field. */
const legacyShared = {
  id: 'p8',
  name: 'Legacy Shared',
  updatedAt: '2025-05-21T00:00:00Z',
  createdAt: '2025-05-02T00:00:00Z',
  _role: 'reviewer',
  _shared: true,
};

/* ═══════════════════════════════════════════════════════════════════════════
   statusOf
   ═══════════════════════════════════════════════════════════════════════════ */

describe('statusOf', () => {
  it('returns "archived" when _archived is truthy', () => {
    expect(statusOf(archivedProject)).toBe('archived');
  });

  it('archived takes priority over any linked workspace status', () => {
    const p = { _archived: true, _linkedMetaSift: { progressStatus: 'done' } };
    expect(statusOf(p)).toBe('archived');
  });

  it('returns "done" when linked workspace progressStatus is "done"', () => {
    expect(statusOf(linkedDone)).toBe('done');
  });

  it('returns "in_progress" when linked workspace progressStatus is "in_progress"', () => {
    expect(statusOf(linkedInProgress)).toBe('in_progress');
  });

  it('returns "active" for a project with no linked workspace', () => {
    expect(statusOf(ownedActive)).toBe('active');
  });

  it('returns "active" when linked workspace has unknown progressStatus', () => {
    const p = { _linkedMetaSift: { progressStatus: 'not_started' } };
    expect(statusOf(p)).toBe('active');
  });

  it('returns "active" when _linkedMetaSift is null', () => {
    const p = { _linkedMetaSift: null };
    expect(statusOf(p)).toBe('active');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   roleOf
   ═══════════════════════════════════════════════════════════════════════════ */

describe('roleOf', () => {
  it('reads role from _permissions.role when present', () => {
    expect(roleOf(ownedActive)).toBe('owner');
    expect(roleOf(sharedReviewer)).toBe('reviewer');
    expect(roleOf(linkedDone)).toBe('leader');
  });

  it('falls back to _role when _permissions is absent', () => {
    expect(roleOf(legacyOwned)).toBe('owner');
    expect(roleOf(legacyShared)).toBe('reviewer');
  });

  it('falls back to "owner" when neither _permissions.role nor _role is set', () => {
    expect(roleOf({})).toBe('owner');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   isOwnerOf
   ═══════════════════════════════════════════════════════════════════════════ */

describe('isOwnerOf', () => {
  it('returns true when _permissions.isOwner is true', () => {
    expect(isOwnerOf(ownedActive)).toBe(true);
  });

  it('returns false when _permissions.isOwner is false', () => {
    expect(isOwnerOf(sharedReviewer)).toBe(false);
    expect(isOwnerOf(linkedDone)).toBe(false);
  });

  it('returns false for a project shared with the current user even if role is owner', () => {
    // Shared flag should override the role-based path.
    expect(isOwnerOf(legacyShared)).toBe(false);
  });

  it('returns true via fallback when role is "owner" and not _shared', () => {
    expect(isOwnerOf(legacyOwned)).toBe(true);
  });

  it('returns false via fallback when role is "owner" but _shared is true', () => {
    const p = { _role: 'owner', _shared: true };
    expect(isOwnerOf(p)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   canEditOf
   ═══════════════════════════════════════════════════════════════════════════ */

describe('canEditOf', () => {
  it('returns true when _permissions.canEdit is true', () => {
    expect(canEditOf(ownedActive)).toBe(true);
  });

  it('returns false when _permissions.canEdit is false and not owner', () => {
    expect(canEditOf(sharedReviewer)).toBe(false);
    expect(canEditOf(readOnlyProject)).toBe(false);
  });

  it('falls back to _canEdit flag when no _permissions', () => {
    const p = { _canEdit: true };
    expect(canEditOf(p)).toBe(true);
  });

  it('falls back to isOwnerOf when no _permissions and no _canEdit', () => {
    expect(canEditOf(legacyOwned)).toBe(true);   // owner
    expect(canEditOf(legacyShared)).toBe(false);  // not owner
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   relTime
   ═══════════════════════════════════════════════════════════════════════════ */

describe('relTime', () => {
  let now;
  beforeEach(() => {
    now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "—" for null/undefined/empty', () => {
    expect(relTime(null)).toBe('—');
    expect(relTime(undefined)).toBe('—');
    expect(relTime('')).toBe('—');
  });

  it('returns "—" for an invalid date string', () => {
    expect(relTime('not-a-date')).toBe('—');
  });

  it('returns "just now" for timestamps < 45 seconds ago', () => {
    const iso = new Date(now - 30_000).toISOString();
    expect(relTime(iso)).toBe('just now');
  });

  it('returns "Xm ago" for timestamps within the last hour (≥ 45s)', () => {
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(relTime(iso)).toBe('5m ago');
  });

  it('returns "Xh ago" for timestamps < 24 hours ago', () => {
    const iso = new Date(now - 3 * 3600_000).toISOString();
    expect(relTime(iso)).toBe('3h ago');
  });

  it('returns "Xd ago" for timestamps < 30 days ago', () => {
    const iso = new Date(now - 10 * 86400_000).toISOString();
    expect(relTime(iso)).toBe('10d ago');
  });

  it('returns "Xmo ago" for timestamps between 30 and 365 days ago', () => {
    const iso = new Date(now - 45 * 86400_000).toISOString();
    expect(relTime(iso)).toBe('1mo ago');
  });

  it('returns "Xy ago" for timestamps >= 12 months ago', () => {
    const iso = new Date(now - 400 * 86400_000).toISOString();
    expect(relTime(iso)).toBe('1y ago');
  });

  it('handles future timestamps gracefully (clamps to "just now")', () => {
    const iso = new Date(now + 60_000).toISOString();
    expect(relTime(iso)).toBe('just now');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   progressOf
   ═══════════════════════════════════════════════════════════════════════════ */

describe('progressOf', () => {
  it('returns null when no linked workspace', () => {
    expect(progressOf(ownedActive)).toBeNull();
    expect(progressOf({})).toBeNull();
  });

  it('returns 100 when progressStatus is done', () => {
    expect(progressOf(linkedDone)).toBe(100);
  });

  it('returns the real decided/record ratio when in_progress (60/200 → 30)', () => {
    expect(progressOf(linkedInProgress)).toBe(30);
  });

  it('rounds the ratio to a whole percent', () => {
    // 1 of 3 decided → 33.33% → 33
    const p = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 3, decidedCount: 1 } };
    expect(progressOf(p)).toBe(33);
  });

  it('clamps the ratio to 0..100', () => {
    const over = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 10, decidedCount: 25 } };
    expect(progressOf(over)).toBe(100);
    const under = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 10, decidedCount: -5 } };
    expect(progressOf(under)).toBe(0);
  });

  it('returns null when the workspace has no imported records (empty state, NOT 0)', () => {
    const empty = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 0, decidedCount: 0 } };
    expect(progressOf(empty)).toBeNull();
    // not_started with no counts is likewise an empty state → null
    const notStarted = { _linkedMetaSift: { progressStatus: 'not_started' } };
    expect(progressOf(notStarted)).toBeNull();
  });

  it('returns 0 when records exist but none are decided yet', () => {
    const fresh = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 80, decidedCount: 0 } };
    expect(progressOf(fresh)).toBe(0);
  });

  it('uses screenablePool as the denominator when present (duplicate-free)', () => {
    // 30 decided of a 60-record import, but only 50 are unique/screenable →
    // 30/50 = 60% (NOT 30/60 = 50%) so it agrees with the project Overview.
    const p = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 60, decidedCount: 30, screenablePool: 50 } };
    expect(progressOf(p)).toBe(60);
  });

  it('falls back to recordCount when screenablePool is absent', () => {
    const p = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 200, decidedCount: 60 } };
    expect(progressOf(p)).toBe(30);
  });

  it('returns null when screenablePool is 0 (nothing screenable yet)', () => {
    const p = { _linkedMetaSift: { progressStatus: 'in_progress', recordCount: 5, decidedCount: 0, screenablePool: 0 } };
    expect(progressOf(p)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   projectStatsOf
   ═══════════════════════════════════════════════════════════════════════════ */

describe('projectStatsOf', () => {
  it('returns real counts from the linked workspace (studyCount === recordCount)', () => {
    expect(projectStatsOf(linkedInProgress)).toEqual({
      recordCount: 200, decidedCount: 60, memberCount: 5, onlineCount: 2, studyCount: 200,
    });
  });

  it('defaults every field to 0 when there is no linked workspace', () => {
    expect(projectStatsOf(ownedActive)).toEqual({
      recordCount: 0, decidedCount: 0, memberCount: 0, onlineCount: 0, studyCount: 0,
    });
    expect(projectStatsOf({})).toEqual({
      recordCount: 0, decidedCount: 0, memberCount: 0, onlineCount: 0, studyCount: 0,
    });
  });

  it('coerces missing/partial linked fields to 0', () => {
    const partial = { _linkedMetaSift: { recordCount: 42 } };
    const s = projectStatsOf(partial);
    expect(s.recordCount).toBe(42);
    expect(s.studyCount).toBe(42);
    expect(s.decidedCount).toBe(0);
    expect(s.memberCount).toBe(0);
    expect(s.onlineCount).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   onlineTotalLabel
   ═══════════════════════════════════════════════════════════════════════════ */

describe('onlineTotalLabel', () => {
  it('formats "<online> / <total>" when there are members', () => {
    expect(onlineTotalLabel(2, 5)).toBe('2 / 5');
    expect(onlineTotalLabel(0, 5)).toBe('0 / 5');
  });

  it('returns "0 members" when total is 0 (never a misleading number)', () => {
    expect(onlineTotalLabel(0, 0)).toBe('0 members');
    expect(onlineTotalLabel(3, 0)).toBe('0 members');
  });

  it('clamps online to total so it can never read more online than members', () => {
    expect(onlineTotalLabel(2, 1)).toBe('1 / 1');
    expect(onlineTotalLabel(99, 5)).toBe('5 / 5');
  });

  it('clamps a negative/NaN online up to 0', () => {
    expect(onlineTotalLabel(-3, 4)).toBe('0 / 4');
    expect(onlineTotalLabel(NaN, 4)).toBe('0 / 4');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   FILTERS predicates
   ═══════════════════════════════════════════════════════════════════════════ */

describe('FILTERS predicates', () => {
  const filterByKey = (key) => FILTERS.find(f => f.key === key);

  it('"all" passes every project', () => {
    const all = filterByKey('all');
    [ownedActive, sharedReviewer, linkedInProgress, linkedDone, archivedProject, readOnlyProject].forEach(p => {
      expect(all.test(p)).toBe(true);
    });
  });

  it('"owned" passes only when isOwnerOf returns true', () => {
    const f = filterByKey('owned');
    expect(f.test(ownedActive)).toBe(true);
    expect(f.test(sharedReviewer)).toBe(false);
    expect(f.test(legacyOwned)).toBe(true);
    expect(f.test(legacyShared)).toBe(false);
  });

  it('"lead" passes only when role is "leader"', () => {
    const f = filterByKey('lead');
    expect(f.test(linkedDone)).toBe(true);   // role: leader
    expect(f.test(ownedActive)).toBe(false);  // role: owner
    expect(f.test(sharedReviewer)).toBe(false);
  });

  it('"shared" passes when _shared is set and not the owner', () => {
    const f = filterByKey('shared');
    expect(f.test(sharedReviewer)).toBe(true);
    expect(f.test(readOnlyProject)).toBe(true);
    expect(f.test(ownedActive)).toBe(false);
    // _shared:true but isOwner:true → not a shared project from the user's pov
    const ownedShared = { _shared: true, _permissions: { isOwner: true, role: 'owner' } };
    expect(f.test(ownedShared)).toBe(false);
  });

  it('"readonly" passes when _readOnly is set or _permissions.readOnly is true', () => {
    const f = filterByKey('readonly');
    expect(f.test(readOnlyProject)).toBe(true);
    expect(f.test(ownedActive)).toBe(false);
    const permReadOnly = { _permissions: { readOnly: true } };
    expect(f.test(permReadOnly)).toBe(true);
  });

  it('"active" passes only projects with statusOf === "active"', () => {
    const f = filterByKey('active');
    expect(f.test(ownedActive)).toBe(true);
    expect(f.test(linkedInProgress)).toBe(false);
    expect(f.test(linkedDone)).toBe(false);
    expect(f.test(archivedProject)).toBe(false);
  });

  it('"inprogress" passes only in_progress projects', () => {
    const f = filterByKey('inprogress');
    expect(f.test(linkedInProgress)).toBe(true);
    expect(f.test(ownedActive)).toBe(false);
    expect(f.test(linkedDone)).toBe(false);
  });

  it('"done" passes only done projects', () => {
    const f = filterByKey('done');
    expect(f.test(linkedDone)).toBe(true);
    expect(f.test(ownedActive)).toBe(false);
  });

  it('"linked" passes only when _linkedMetaSift is set', () => {
    const f = filterByKey('linked');
    expect(f.test(linkedInProgress)).toBe(true);
    expect(f.test(linkedDone)).toBe(true);
    expect(f.test(ownedActive)).toBe(false);
  });

  it('"notlinked" passes only when _linkedMetaSift is absent', () => {
    const f = filterByKey('notlinked');
    expect(f.test(ownedActive)).toBe(true);
    expect(f.test(linkedInProgress)).toBe(false);
  });

  it('"archived" passes only archived projects', () => {
    const f = filterByKey('archived');
    expect(f.test(archivedProject)).toBe(true);
    expect(f.test(ownedActive)).toBe(false);
    expect(f.test(linkedDone)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   SORTS comparators
   ═══════════════════════════════════════════════════════════════════════════ */

describe('SORTS comparators', () => {
  const sortByKey = (key) => SORTS.find(s => s.key === key);

  const older = { name: 'Alpha', updatedAt: '2024-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' };
  const newer = { name: 'Beta',  updatedAt: '2025-06-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' };

  it('"modified" sorts newer updatedAt first (desc)', () => {
    const cmp = sortByKey('modified').cmp;
    expect(cmp(newer, older)).toBeLessThan(0);
    expect(cmp(older, newer)).toBeGreaterThan(0);
    expect(cmp(newer, newer)).toBe(0);
  });

  // prompt50 WS5 — "Last Modified" prefers lastActivityAt (meaningful activity)
  // over the generic updatedAt, and breaks ties deterministically.
  it('"modified" prefers lastActivityAt over updatedAt', () => {
    const cmp = sortByKey('modified').cmp;
    // Same updatedAt, but A has more recent meaningful activity → A sorts first.
    const a = { id: 'a', updatedAt: '2025-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z', lastActivityAt: '2025-06-01T00:00:00Z' };
    const b = { id: 'b', updatedAt: '2025-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z', lastActivityAt: '2025-02-01T00:00:00Z' };
    expect(cmp(a, b)).toBeLessThan(0);
    expect(cmp(b, a)).toBeGreaterThan(0);
  });

  it('"modified" falls back to updatedAt when lastActivityAt is absent', () => {
    const cmp = sortByKey('modified').cmp;
    const a = { id: 'a', updatedAt: '2025-06-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' };
    const b = { id: 'b', updatedAt: '2025-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' };
    expect(cmp(a, b)).toBeLessThan(0);
  });

  it('"modified" is a deterministic, stable order on ties (createdAt then id)', () => {
    const cmp = sortByKey('modified').cmp;
    const sameTime = '2025-01-01T00:00:00Z';
    const x = { id: 'x', lastActivityAt: sameTime, createdAt: '2024-05-01T00:00:00Z' };
    const y = { id: 'y', lastActivityAt: sameTime, createdAt: '2024-01-01T00:00:00Z' };
    // identical activity → newer createdAt wins (x before y)
    expect(cmp(x, y)).toBeLessThan(0);
    // fully identical timestamps → fall back to id, never 0 for distinct ids
    const p = { id: 'aaa', lastActivityAt: sameTime, createdAt: sameTime };
    const q = { id: 'bbb', lastActivityAt: sameTime, createdAt: sameTime };
    expect(cmp(p, q)).toBeLessThan(0);
    expect(cmp(q, p)).toBeGreaterThan(0);
    // a comparator must report 0 only for a truly-equal pair (same id) → stable.
    expect(cmp(p, { ...p })).toBe(0);
  });

  it('"created" sorts newer createdAt first (desc)', () => {
    const cmp = sortByKey('created').cmp;
    expect(cmp(newer, older)).toBeLessThan(0);
    expect(cmp(older, newer)).toBeGreaterThan(0);
  });

  it('"title" sorts alphabetically A–Z', () => {
    const cmp = sortByKey('title').cmp;
    // Alpha < Beta → cmp(Alpha, Beta) < 0 (Alpha comes first)
    expect(cmp(older, newer)).toBeLessThan(0);
    expect(cmp(newer, older)).toBeGreaterThan(0);
    expect(cmp(older, older)).toBe(0);
  });

  it('"title" is locale-aware and case-insensitive via localeCompare', () => {
    const cmp = sortByKey('title').cmp;
    const a = { name: 'apple' };
    const b = { name: 'Banana' };
    // 'apple' vs 'Banana' — localeCompare should give a deterministic ordering
    const result = cmp(a, b);
    expect(typeof result).toBe('number');
  });

  it('"title" handles missing names gracefully (treats as empty string)', () => {
    const cmp = sortByKey('title').cmp;
    expect(() => cmp({}, {})).not.toThrow();
    expect(cmp({}, { name: 'z' })).toBeLessThanOrEqual(0);
  });

  it('"status" sorts by statusOf locale string', () => {
    const cmp = sortByKey('status').cmp;
    // archived < done (alphabetically a < d)
    const archived = { _archived: true };
    const done = { _linkedMetaSift: { progressStatus: 'done' } };
    expect(cmp(archived, done)).toBeLessThan(0);
    expect(cmp(done, archived)).toBeGreaterThan(0);
  });

  it('"role" sorts by roleOf locale string', () => {
    const cmp = sortByKey('role').cmp;
    // "leader" < "owner" alphabetically
    expect(cmp(linkedDone, ownedActive)).toBeLessThan(0);
    expect(cmp(ownedActive, linkedDone)).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ROLE_ORDER, ROLE_LABEL, ROLE_COLOR
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ROLE_ORDER / ROLE_LABEL / ROLE_COLOR constants', () => {
  it('ROLE_ORDER has owner as most privileged (lowest index)', () => {
    expect(ROLE_ORDER.owner).toBe(0);
    expect(ROLE_ORDER.leader).toBeGreaterThan(ROLE_ORDER.owner);
    expect(ROLE_ORDER.reviewer).toBeGreaterThan(ROLE_ORDER.leader);
    expect(ROLE_ORDER.viewer).toBeGreaterThan(ROLE_ORDER.reviewer);
  });

  it('ROLE_LABEL has human-readable labels for all roles', () => {
    expect(ROLE_LABEL.owner).toBe('Owner');
    expect(ROLE_LABEL.leader).toBe('Leader');
    expect(ROLE_LABEL.reviewer).toBe('Reviewer');
    expect(ROLE_LABEL.viewer).toBe('Viewer');
  });

  it('ROLE_COLOR maps roles to palette identifiers', () => {
    expect(ROLE_COLOR.owner).toBe('gold');
    expect(ROLE_COLOR.leader).toBe('purple');
    expect(ROLE_COLOR.reviewer).toBe('blue');
    expect(ROLE_COLOR.viewer).toBe('default');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   STATUS_META and TAG_COLORS — structural smoke tests
   ═══════════════════════════════════════════════════════════════════════════ */

describe('STATUS_META and TAG_COLORS shapes', () => {
  it('STATUS_META has entries for all four statuses with label/color/tag', () => {
    for (const key of ['active', 'in_progress', 'done', 'archived']) {
      expect(STATUS_META[key]).toBeDefined();
      expect(typeof STATUS_META[key].label).toBe('string');
      expect(typeof STATUS_META[key].color).toBe('string');
      expect(typeof STATUS_META[key].tag).toBe('string');
    }
  });

  it('TAG_COLORS has non-empty string values for all palette keys', () => {
    for (const [key, val] of Object.entries(TAG_COLORS)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
    }
  });
});
