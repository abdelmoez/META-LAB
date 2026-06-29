/**
 * screeningCounts.test.js — unit tests for the pure project-list count helpers
 * (63.md). No database: covers the active-member filter in the _count select,
 * the terminal-status constant, and the classifyDecided groupBy reducer.
 */
import { describe, it, expect } from 'vitest';
import {
  screeningCountSelect,
  DECIDED_FINAL_STATUSES,
  classifyDecided,
} from '../../server/utils/screeningCounts.js';

describe('screeningCountSelect', () => {
  it('counts records and ONLY active members (58.md canonical denominator)', () => {
    const sel = screeningCountSelect();
    expect(sel.records).toBe(true);
    // members must be the FILTERED form { where: { status: 'active' } },
    // never a bare `true` (which would count pending/inactive rows too).
    expect(sel.members).toEqual({ where: { status: 'active' } });
  });

  it('returns a fresh object each call (no shared mutable state)', () => {
    const a = screeningCountSelect();
    const b = screeningCountSelect();
    expect(a).not.toBe(b);
    expect(a.members).not.toBe(b.members);
    a.members.where.status = 'tampered';
    expect(screeningCountSelect().members.where.status).toBe('active');
  });
});

describe('DECIDED_FINAL_STATUSES', () => {
  it('is exactly the two terminal finalStatus values', () => {
    expect(DECIDED_FINAL_STATUSES).toEqual(['accepted', 'rejected']);
  });
});

describe('classifyDecided', () => {
  it('maps groupBy { projectId, _count: { _all } } rows to a count Map', () => {
    const rows = [
      { projectId: 'p1', _count: { _all: 3 } },
      { projectId: 'p2', _count: { _all: 7 } },
    ];
    const m = classifyDecided(rows);
    expect(m.get('p1')).toBe(3);
    expect(m.get('p2')).toBe(7);
    expect(m.size).toBe(2);
  });

  it('accepts a plain numeric _count shape too', () => {
    const m = classifyDecided([{ projectId: 'p1', _count: 5 }]);
    expect(m.get('p1')).toBe(5);
  });

  it('returns an empty Map for empty / non-array input', () => {
    expect(classifyDecided([]).size).toBe(0);
    expect(classifyDecided(null).size).toBe(0);
    expect(classifyDecided(undefined).size).toBe(0);
  });

  it('skips rows with no projectId and treats garbled counts as 0', () => {
    const m = classifyDecided([
      { projectId: null, _count: { _all: 9 } },
      { _count: { _all: 4 } },
      { projectId: 'p3', _count: {} },
      { projectId: 'p4' },
    ]);
    expect(m.has('p3')).toBe(true);
    expect(m.get('p3')).toBe(0);
    expect(m.get('p4')).toBe(0);
    expect(m.size).toBe(2); // only p3 + p4; the null/missing-projectId rows dropped
  });

  it('a project absent from the rows is simply not in the Map (caller defaults 0)', () => {
    const m = classifyDecided([{ projectId: 'p1', _count: { _all: 2 } }]);
    expect(m.has('pX')).toBe(false);
    expect(m.get('pX') || 0).toBe(0);
  });
});
