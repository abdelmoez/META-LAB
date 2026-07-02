/**
 * schedule.test.js — cadence arithmetic for living reviews.
 * Deterministic: every case pins "now" explicitly. Covers month-end clamping,
 * leap years, daily/weekly boundaries, hour pinning, and isDue edges.
 */
import { describe, it, expect } from 'vitest';
import {
  CADENCES,
  computeNextRunAt,
  nextRunAfterSuccess,
  isDue,
  describeCadence,
} from '../../../src/research-engine/living/schedule.js';

describe('CADENCES', () => {
  it('is the expected fixed set', () => {
    expect(CADENCES).toEqual(['manual', 'daily', 'weekly', 'monthly']);
  });
});

describe('describeCadence', () => {
  it('labels each known cadence', () => {
    expect(describeCadence('manual')).toMatch(/manual/i);
    expect(describeCadence('daily')).toBe('Daily');
    expect(describeCadence('weekly')).toBe('Weekly');
    expect(describeCadence('monthly')).toBe('Monthly');
  });
  it('falls back for unknowns', () => {
    expect(describeCadence('hourly')).toMatch(/unknown/i);
  });
});

describe('computeNextRunAt — manual & invalid', () => {
  it('manual → null', () => {
    expect(computeNextRunAt('manual', '2026-07-01T10:00:00.000Z')).toBeNull();
  });
  it('unknown cadence → null', () => {
    expect(computeNextRunAt('hourly', '2026-07-01T10:00:00.000Z')).toBeNull();
  });
  it('invalid fromIso → null', () => {
    expect(computeNextRunAt('daily', 'not-a-date')).toBeNull();
  });
});

describe('computeNextRunAt — daily', () => {
  it('next day at default hour 03:00 UTC, ignoring source time-of-day', () => {
    expect(computeNextRunAt('daily', '2026-07-01T22:45:12.000Z'))
      .toBe('2026-07-02T03:00:00.000Z');
  });
  it('crosses month boundary', () => {
    expect(computeNextRunAt('daily', '2026-07-31T05:00:00.000Z'))
      .toBe('2026-08-01T03:00:00.000Z');
  });
  it('crosses year boundary', () => {
    expect(computeNextRunAt('daily', '2026-12-31T01:00:00.000Z'))
      .toBe('2027-01-01T03:00:00.000Z');
  });
  it('honours a custom hourUtc', () => {
    expect(computeNextRunAt('daily', '2026-07-01T22:45:00.000Z', { hourUtc: 9 }))
      .toBe('2026-07-02T09:00:00.000Z');
  });
});

describe('computeNextRunAt — weekly', () => {
  it('exactly +7 calendar days at hour', () => {
    expect(computeNextRunAt('weekly', '2026-07-01T12:00:00.000Z'))
      .toBe('2026-07-08T03:00:00.000Z');
  });
  it('+7 across a month end', () => {
    expect(computeNextRunAt('weekly', '2026-07-28T12:00:00.000Z'))
      .toBe('2026-08-04T03:00:00.000Z');
  });
});

describe('computeNextRunAt — monthly (month-end clamping)', () => {
  it('Jan 31 → Feb 28 in a non-leap year (2026)', () => {
    expect(computeNextRunAt('monthly', '2026-01-31T12:00:00.000Z'))
      .toBe('2026-02-28T03:00:00.000Z');
  });
  it('Jan 31 → Feb 29 in a leap year (2028)', () => {
    expect(computeNextRunAt('monthly', '2028-01-31T12:00:00.000Z'))
      .toBe('2028-02-29T03:00:00.000Z');
  });
  it('Jan 30 → Feb 28 (clamps down)', () => {
    expect(computeNextRunAt('monthly', '2026-01-30T12:00:00.000Z'))
      .toBe('2026-02-28T03:00:00.000Z');
  });
  it('mid-month stays same day-of-month', () => {
    expect(computeNextRunAt('monthly', '2026-07-15T12:00:00.000Z'))
      .toBe('2026-08-15T03:00:00.000Z');
  });
  it('Dec → Jan next year', () => {
    expect(computeNextRunAt('monthly', '2026-12-15T12:00:00.000Z'))
      .toBe('2027-01-15T03:00:00.000Z');
  });
  it('Mar 31 → Apr 30 (30-day month)', () => {
    expect(computeNextRunAt('monthly', '2026-03-31T12:00:00.000Z'))
      .toBe('2026-04-30T03:00:00.000Z');
  });
});

describe('computeNextRunAt — hour clamping', () => {
  it('out-of-range hour falls back to default 3', () => {
    expect(computeNextRunAt('daily', '2026-07-01T00:00:00.000Z', { hourUtc: 99 }))
      .toBe('2026-07-02T03:00:00.000Z');
  });
  it('hour 0 is honoured (midnight UTC)', () => {
    expect(computeNextRunAt('daily', '2026-07-01T05:00:00.000Z', { hourUtc: 0 }))
      .toBe('2026-07-02T00:00:00.000Z');
  });
});

describe('nextRunAfterSuccess', () => {
  it('matches computeNextRunAt exactly', () => {
    const from = '2026-07-01T18:00:00.000Z';
    expect(nextRunAfterSuccess('weekly', from)).toBe(computeNextRunAt('weekly', from));
    expect(nextRunAfterSuccess('manual', from)).toBeNull();
  });
  it('reschedules monthly from a completion time with clamping', () => {
    expect(nextRunAfterSuccess('monthly', '2026-01-31T03:05:00.000Z'))
      .toBe('2026-02-28T03:00:00.000Z');
  });
});

describe('isDue', () => {
  const now = '2026-07-01T03:00:00.000Z';

  it('due when nextRunAt is in the past', () => {
    expect(isDue({ enabled: true, cadence: 'daily', nextRunAt: '2026-06-30T03:00:00.000Z' }, now))
      .toBe(true);
  });
  it('due when nextRunAt is exactly now (equal → due)', () => {
    expect(isDue({ enabled: true, cadence: 'daily', nextRunAt: now }, now)).toBe(true);
  });
  it('not due when nextRunAt is in the future', () => {
    expect(isDue({ enabled: true, cadence: 'daily', nextRunAt: '2026-07-02T03:00:00.000Z' }, now))
      .toBe(false);
  });
  it('not due when disabled, even if past', () => {
    expect(isDue({ enabled: false, cadence: 'daily', nextRunAt: '2026-06-30T03:00:00.000Z' }, now))
      .toBe(false);
  });
  it('not due for manual cadence', () => {
    expect(isDue({ enabled: true, cadence: 'manual', nextRunAt: '2026-06-30T03:00:00.000Z' }, now))
      .toBe(false);
  });
  it('not due when nextRunAt is null/missing', () => {
    expect(isDue({ enabled: true, cadence: 'daily', nextRunAt: null }, now)).toBe(false);
    expect(isDue({ enabled: true, cadence: 'daily' }, now)).toBe(false);
  });
  it('not due for unknown cadence', () => {
    expect(isDue({ enabled: true, cadence: 'hourly', nextRunAt: '2026-06-30T03:00:00.000Z' }, now))
      .toBe(false);
  });
  it('handles missing/invalid search or dates gracefully', () => {
    expect(isDue(null, now)).toBe(false);
    expect(isDue({ enabled: true, cadence: 'daily', nextRunAt: 'bad' }, now)).toBe(false);
    expect(isDue({ enabled: true, cadence: 'daily', nextRunAt: now }, 'bad')).toBe(false);
  });
});
