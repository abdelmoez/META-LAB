/**
 * userGrowth.test.js — unit tests for the pure new-user-growth helpers
 * (prompt27). All deterministic: every helper takes an explicit `now`, so no
 * reliance on the wall clock. Covers time-window math, period-over-period
 * comparison, grouping by day/month/quarter/year, and empty-data handling.
 */
import { describe, it, expect } from 'vitest';
import {
  WINDOW_UNITS,
  startOfWindow,
  previousWindowRange,
  countInRange,
  filterInRange,
  pctChange,
  windowSummary,
  groupByYear,
  groupByMonth,
  groupByQuarter,
  groupByDay,
  groupByTrailingMonths,
  tally,
  topOf,
  localDayKey,
} from '../../server/utils/userGrowth.js';

// Reference "now": Tuesday 2026-06-16 14:30 local time.
const NOW = new Date(2026, 5, 16, 14, 30, 0);
const u = (y, mo, d, h = 12) => ({ createdAt: new Date(y, mo - 1, d, h) });

describe('startOfWindow', () => {
  it('today → local midnight', () => {
    expect(startOfWindow('today', NOW).getTime()).toBe(new Date(2026, 5, 16).getTime());
  });
  it('week → most recent Sunday (2026-06-14)', () => {
    expect(startOfWindow('week', NOW).getTime()).toBe(new Date(2026, 5, 14).getTime());
  });
  it('month → first of month', () => {
    expect(startOfWindow('month', NOW).getTime()).toBe(new Date(2026, 5, 1).getTime());
  });
  it('quarter → first day of Q2 (Apr 1)', () => {
    expect(startOfWindow('quarter', NOW).getTime()).toBe(new Date(2026, 3, 1).getTime());
  });
  it('year → Jan 1', () => {
    expect(startOfWindow('year', NOW).getTime()).toBe(new Date(2026, 0, 1).getTime());
  });
  it('all / unknown → null (no lower bound)', () => {
    expect(startOfWindow('all', NOW)).toBeNull();
    expect(startOfWindow('nope', NOW)).toBeNull();
  });
  it('exposes the canonical window unit list', () => {
    expect(WINDOW_UNITS).toEqual(['today', 'week', 'month', 'quarter', 'year', 'all']);
  });
});

describe('previousWindowRange', () => {
  it('today → all of yesterday', () => {
    const r = previousWindowRange('today', NOW);
    expect(r.start.getTime()).toBe(new Date(2026, 5, 15).getTime());
    expect(r.end.getTime()).toBe(new Date(2026, 5, 16).getTime());
  });
  it('month → all of the previous month', () => {
    const r = previousWindowRange('month', NOW);
    expect(r.start.getTime()).toBe(new Date(2026, 4, 1).getTime());
    expect(r.end.getTime()).toBe(new Date(2026, 5, 1).getTime());
  });
  it('quarter → previous quarter (Q1)', () => {
    const r = previousWindowRange('quarter', NOW);
    expect(r.start.getTime()).toBe(new Date(2026, 0, 1).getTime());
    expect(r.end.getTime()).toBe(new Date(2026, 3, 1).getTime());
  });
  it('year → previous year', () => {
    const r = previousWindowRange('year', NOW);
    expect(r.start.getTime()).toBe(new Date(2025, 0, 1).getTime());
    expect(r.end.getTime()).toBe(new Date(2026, 0, 1).getTime());
  });
  it('all → null (no previous period)', () => {
    expect(previousWindowRange('all', NOW)).toBeNull();
  });
});

describe('countInRange / filterInRange', () => {
  const items = [u(2026, 6, 16), u(2026, 6, 15), u(2026, 5, 20), u(2025, 6, 16)];
  it('counts within [start, end)', () => {
    const start = new Date(2026, 5, 1);
    expect(countInRange(items, start, null)).toBe(2); // the two June-2026 rows
  });
  it('end is exclusive', () => {
    const start = new Date(2026, 5, 15);
    const end = new Date(2026, 5, 16); // excludes the 16th
    expect(countInRange(items, start, end)).toBe(1);
  });
  it('null/null bounds count everything', () => {
    expect(countInRange(items, null, null)).toBe(4);
    expect(filterInRange(items, null, null)).toHaveLength(4);
  });
  it('ignores unparseable dates', () => {
    expect(countInRange([{ createdAt: 'not-a-date' }], null, null)).toBe(0);
  });
});

describe('pctChange', () => {
  it('computes signed percent with 1 dp', () => {
    expect(pctChange(12, 10)).toBe(20);
    expect(pctChange(8, 10)).toBe(-20);
    expect(pctChange(15, 12)).toBe(25);
  });
  it('null when the denominator is 0/absent', () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(5, null)).toBeNull();
  });
});

describe('windowSummary', () => {
  const items = [
    u(2026, 6, 16), u(2026, 6, 16), // today ×2
    u(2026, 6, 15),                  // this week (Sun=14), earlier today-week
    u(2026, 6, 2),                   // this month, not this week
    u(2026, 5, 10),                  // last month → previous-month bucket
    u(2026, 2, 1),                   // this year, prev quarter
    u(2025, 12, 31),                 // last year
  ];
  const s = windowSummary(items, NOW);

  it('today counts only today and compares to yesterday', () => {
    expect(s.today.count).toBe(2);      // the two June-16 rows
    expect(s.today.prev).toBe(1);       // the June-15 row falls into "yesterday"
    expect(s.today.deltaPct).toBe(100); // 2 vs 1
  });
  it('week counts Sun..now', () => {
    expect(s.week.count).toBe(3); // 16,16,15
  });
  it('month counts this month and compares to last month', () => {
    expect(s.month.count).toBe(4);  // 16,16,15,2
    expect(s.month.prev).toBe(1);   // May 10
    expect(s.month.deltaPct).toBe(pctChange(4, 1));
  });
  it('year counts all of 2026', () => {
    expect(s.year.count).toBe(6);   // 16,16,15,2 (June) + May 10 + Feb 1
    expect(s.year.prev).toBe(1);    // 2025-12-31
  });
  it('total is the full set', () => {
    expect(s.total.count).toBe(items.length);
  });
});

describe('groupByYear', () => {
  it('ascending, gap-filled, YoY growth', () => {
    const items = [u(2024, 1, 1), u(2024, 6, 1), u(2026, 3, 1)]; // 2025 has none
    const out = groupByYear(items);
    expect(out.map(r => r.year)).toEqual([2024, 2025, 2026]);
    expect(out.map(r => r.count)).toEqual([2, 0, 1]);
    expect(out[0].growthPct).toBeNull();     // first year
    expect(out[1].growthPct).toBe(-100);     // 2 → 0
    expect(out[2].growthPct).toBeNull();     // 0 → 1 (0 denominator)
  });
  it('empty input → []', () => {
    expect(groupByYear([])).toEqual([]);
  });
});

describe('groupByMonth', () => {
  it('12 zero-filled buckets for the selected year only', () => {
    const items = [u(2026, 1, 5), u(2026, 1, 20), u(2026, 6, 16), u(2025, 6, 1)];
    const out = groupByMonth(items, 2026);
    expect(out).toHaveLength(12);
    expect(out[0]).toEqual({ month: 1, label: 'Jan', count: 2 });
    expect(out[5]).toEqual({ month: 6, label: 'Jun', count: 1 });
    expect(out[11].count).toBe(0);
  });
  it('empty input → 12 zeroed buckets', () => {
    expect(groupByMonth([], 2026).every(b => b.count === 0)).toBe(true);
  });
});

describe('groupByQuarter', () => {
  it('4 buckets per requested year, zero-filled, ascending', () => {
    const items = [u(2026, 2, 1), u(2026, 5, 1), u(2026, 5, 9), u(2025, 11, 1)];
    const out = groupByQuarter(items, [2025, 2026]);
    expect(out).toHaveLength(8);
    expect(out[0]).toMatchObject({ year: 2025, quarter: 1, count: 0 });
    expect(out.find(q => q.year === 2025 && q.quarter === 4).count).toBe(1);
    expect(out.find(q => q.year === 2026 && q.quarter === 1).count).toBe(1);
    expect(out.find(q => q.year === 2026 && q.quarter === 2).count).toBe(2);
    expect(out.find(q => q.year === 2026 && q.quarter === 2).label).toBe('2026 Q2');
  });
});

describe('groupByDay', () => {
  it('zero-filled, ascending, last bucket = today', () => {
    const items = [u(2026, 6, 16), u(2026, 6, 16), u(2026, 6, 14)];
    const out = groupByDay(items, 7, NOW);
    expect(out).toHaveLength(7);
    expect(out[out.length - 1]).toEqual({ date: localDayKey(NOW), count: 2 });
    expect(out[out.length - 3]).toEqual({ date: '2026-06-14', count: 1 });
    expect(out[0].count).toBe(0);
  });
  it('rows outside the window are dropped', () => {
    const out = groupByDay([u(2026, 1, 1)], 7, NOW);
    expect(out.reduce((a, b) => a + b.count, 0)).toBe(0);
  });
});

describe('groupByTrailingMonths', () => {
  it('zero-filled, ascending, last bucket = current month, spans year boundary', () => {
    const items = [u(2026, 6, 16), u(2025, 7, 1), u(2025, 7, 9)];
    const out = groupByTrailingMonths(items, 12, NOW);
    expect(out).toHaveLength(12);
    expect(out[out.length - 1]).toMatchObject({ year: 2026, month: 6, count: 1 });
    expect(out[0]).toMatchObject({ year: 2025, month: 7, count: 2, label: 'Jul 25' });
  });
});

describe('tally / topOf', () => {
  it('counts non-empty trimmed strings, desc by count then label', () => {
    const out = tally(['A', 'a', ' B ', 'A', '', null, '   ']);
    // 'A' ×2 (case-sensitive — distinct from 'a'); 'a' ×1, 'B' ×1
    expect(out[0]).toEqual({ label: 'A', count: 2 });
    expect(out).toContainEqual({ label: 'B', count: 1 });
    expect(out).toContainEqual({ label: 'a', count: 1 });
    expect(out.find(r => r.label === '')).toBeUndefined();
  });
  it('topOf returns the leader or null', () => {
    expect(topOf(['x', 'x', 'y'])).toEqual({ label: 'x', count: 2 });
    expect(topOf([])).toBeNull();
    expect(topOf([null, '', '  '])).toBeNull();
  });
});
