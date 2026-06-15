/**
 * dashboardPrefs.test.js (prompt23 Task 2) — the project dashboard remembers each
 * user's sort/filter/view/show-archived choice across refresh & logout/login, keyed
 * per user, and re-validates stored values so stale/garbage data falls back safely.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readDashboardPrefs, writeDashboardPrefs } from '../../src/frontend/pages/projectLanding.helpers.js';

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  });
});

describe('dashboard preferences persistence', () => {
  it('round-trips a full valid pref set per user', () => {
    writeDashboardPrefs('user-1', { sort: 'title', filter: 'owned', view: 'table', showArchived: true });
    expect(readDashboardPrefs('user-1')).toEqual({ sort: 'title', filter: 'owned', view: 'table', showArchived: true });
  });

  it('keeps preferences separate per user', () => {
    writeDashboardPrefs('user-1', { sort: 'title' });
    writeDashboardPrefs('user-2', { sort: 'created' });
    expect(readDashboardPrefs('user-1').sort).toBe('title');
    expect(readDashboardPrefs('user-2').sort).toBe('created');
  });

  it('merges partial writes instead of replacing', () => {
    writeDashboardPrefs('u', { sort: 'title', view: 'table' });
    writeDashboardPrefs('u', { sort: 'status' });
    expect(readDashboardPrefs('u')).toEqual({ sort: 'status', view: 'table' });
  });

  it('drops invalid values on read (safe fallback)', () => {
    localStorage.setItem('metalab.dashboardPrefs.u', JSON.stringify({ sort: 'not-a-sort', filter: 'nope', view: 'grid', showArchived: 'yes' }));
    expect(readDashboardPrefs('u')).toEqual({});
  });

  it('returns {} for no saved prefs or corrupt JSON', () => {
    expect(readDashboardPrefs('nobody')).toEqual({});
    localStorage.setItem('metalab.dashboardPrefs.u', '{not json');
    expect(readDashboardPrefs('u')).toEqual({});
  });
});
