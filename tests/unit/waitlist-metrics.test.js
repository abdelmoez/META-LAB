/**
 * waitlist-metrics.test.js — pure metric aggregation from real records
 * (prompt48 §7/§9: no fabricated numbers; empty → zeros). `now` is injected.
 */
import { describe, it, expect } from 'vitest';
import { computeWaitlistMetrics } from '../../server/waitlist/metrics.js';
import { WAITLIST_STATUSES } from '../../src/shared/betaWaitlist.js';

const NOW = Date.parse('2026-06-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('computeWaitlistMetrics — empty', () => {
  it('returns a well-formed all-zero result', () => {
    const m = computeWaitlistMetrics([], { now: NOW });
    expect(m.total).toBe(0);
    expect(m.today).toBe(0);
    expect(m.last7Days).toBe(0);
    expect(m.last30Days).toBe(0);
    expect(m.email).toEqual({ sent: 0, failed: 0, pending: 0 });
    expect(m.topRoles).toEqual([]);
    expect(m.topInstitutions).toEqual([]);
    expect(m.trend).toHaveLength(30);
    expect(m.trend.every((t) => t.count === 0)).toBe(true);
    for (const s of WAITLIST_STATUSES) expect(m.byStatus[s]).toBe(0);
  });
});

describe('computeWaitlistMetrics — real records', () => {
  const records = [
    { createdAt: new Date(NOW), status: 'WAITLISTED', confirmationEmailStatus: 'sent', role: 'Researcher', institutionName: 'Uni A', countryName: 'United States', areasOfInterest: ['Data extraction'] },
    { createdAt: new Date(NOW - 2 * DAY), status: 'INVITED', confirmationEmailStatus: 'failed', role: 'Researcher', institutionName: 'Uni A', countryName: 'Canada', areasOfInterest: ['Data extraction', 'Meta-analysis & forest plots'] },
    { createdAt: new Date(NOW - 20 * DAY), status: 'WAITLISTED', confirmationEmailStatus: 'pending', role: 'Student', institutionName: 'Uni B', countryName: 'United States', areasOfInterest: '["Search strategy building"]' },
  ];

  const m = computeWaitlistMetrics(records, { now: NOW });

  it('counts totals + time windows', () => {
    expect(m.total).toBe(3);
    expect(m.today).toBe(1);     // only the NOW record
    expect(m.last7Days).toBe(2); // NOW and NOW-2d
    expect(m.last30Days).toBe(3);
  });
  it('tallies status + email delivery', () => {
    expect(m.byStatus.WAITLISTED).toBe(2);
    expect(m.byStatus.INVITED).toBe(1);
    expect(m.email).toEqual({ sent: 1, failed: 1, pending: 1 });
  });
  it('ranks roles / institutions / countries', () => {
    expect(m.topRoles[0]).toEqual({ label: 'Researcher', count: 2 });
    expect(m.topInstitutions[0]).toEqual({ label: 'Uni A', count: 2 });
    expect(m.topCountries.find((c) => c.label === 'United States').count).toBe(2);
  });
  it('parses interests whether array or JSON string', () => {
    const labels = m.topInterests.map((i) => i.label);
    expect(labels).toContain('Data extraction');
    expect(labels).toContain('Search strategy building'); // came from a JSON string
  });
  it('builds a 30-day trend summing to the in-window total', () => {
    expect(m.trend).toHaveLength(30);
    expect(m.trend[29].date).toBe('2026-06-15');
    expect(m.trend.reduce((s, t) => s + t.count, 0)).toBe(3);
  });
});
