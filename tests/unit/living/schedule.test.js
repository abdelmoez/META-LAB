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

// 75.md Phase 5 — weekly day-of-week + UTC hour selection. Anchor 2026-07-01 is a
// Wednesday (getUTCDay() === 3), so the "same weekday" case advances a full week.
describe('computeNextRunAt — weekly day-of-week selection (75.md)', () => {
  const wed = '2026-07-01T12:00:00.000Z'; // Wednesday

  it('null/absent dayOfWeek is byte-identical to legacy +7 days', () => {
    // Explicit null and undefined both fall back to the exact pre-feature output.
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: null }))
      .toBe(computeNextRunAt('weekly', wed));
    expect(computeNextRunAt('weekly', wed, {}))
      .toBe('2026-07-08T03:00:00.000Z');
  });

  it('picks the next occurrence of each weekday (1-7 days ahead) at the chosen hour', () => {
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 0, hourUtc: 9 })).toBe('2026-07-05T09:00:00.000Z'); // Sun
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 4, hourUtc: 9 })).toBe('2026-07-02T09:00:00.000Z'); // Thu (tomorrow)
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 6, hourUtc: 9 })).toBe('2026-07-04T09:00:00.000Z'); // Sat
  });

  it('advances a full week when the target weekday equals the anchor weekday (never 0 days)', () => {
    // Wednesday → Wednesday must be +7, so a run never re-fires the same day.
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 3, hourUtc: 9 })).toBe('2026-07-08T09:00:00.000Z');
  });

  it('defaults hour to 03:00 UTC when hourUtc is omitted', () => {
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 1 })).toBe('2026-07-06T03:00:00.000Z'); // Mon
  });

  it('an out-of-range / non-numeric dayOfWeek falls back to legacy +7 (never throws)', () => {
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 7 })).toBe('2026-07-08T03:00:00.000Z');
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: -1 })).toBe('2026-07-08T03:00:00.000Z');
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 'x' })).toBe('2026-07-08T03:00:00.000Z');
  });

  it('engine truncates a fractional weekday deterministically (2.5 → 2); strict rejection is a service concern', () => {
    // The pure engine mirrors normalizeHour: trunc-then-range-check, never throws.
    // parseScheduleDay in livingService rejects fractional user input with a 400.
    expect(computeNextRunAt('weekly', wed, { dayOfWeek: 2.5 })).toBe('2026-07-07T03:00:00.000Z');
  });

  it('dayOfWeek is ignored for daily and monthly cadences', () => {
    expect(computeNextRunAt('daily', wed, { dayOfWeek: 5 })).toBe('2026-07-02T03:00:00.000Z');
    expect(computeNextRunAt('monthly', wed, { dayOfWeek: 5 })).toBe('2026-08-01T03:00:00.000Z');
  });

  it('combines a custom weekday with a custom hour across a month boundary', () => {
    // From Thu 2026-07-30, next Monday at 06:00 UTC = 2026-08-03.
    expect(computeNextRunAt('weekly', '2026-07-30T23:00:00.000Z', { dayOfWeek: 1, hourUtc: 6 }))
      .toBe('2026-08-03T06:00:00.000Z');
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
  it('an explicit null hour defaults to 03:00 UTC (byte-identical to omitting it)', () => {
    // Regression: Number(null) === 0, so null must be caught before the numeric
    // path or a legacy null-hour search would shift from 03:00 to 00:00 UTC.
    expect(computeNextRunAt('daily', '2026-07-01T22:45:00.000Z', { hourUtc: null }))
      .toBe(computeNextRunAt('daily', '2026-07-01T22:45:00.000Z'));
    expect(computeNextRunAt('weekly', '2026-07-01T12:00:00.000Z', { dayOfWeek: null, hourUtc: null }))
      .toBe('2026-07-08T03:00:00.000Z');
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
