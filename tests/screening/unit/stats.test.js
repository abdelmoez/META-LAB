/**
 * stats.test.js
 * Unit tests for the META·SIFT Beta screening statistics module.
 * No server required — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { computeStats, computePrismaNumbers } from '../../../src/research-engine/screening/stats.js';

// ── computeStats ───────────────────────────────────────────────────────────────

describe('computeStats', () => {
  it('returns all zeros and 0% progress when total is 0', () => {
    const result = computeStats(0, []);
    expect(result.total).toBe(0);
    expect(result.screened).toBe(0);
    expect(result.progress).toBe(0);
  });

  it('returns 100% progress when all records are included', () => {
    const decisions = [
      { decision: 'include' },
      { decision: 'include' },
      { decision: 'include' },
    ];
    const result = computeStats(3, decisions);
    expect(result.progress).toBe(100);
    expect(result.undecided).toBe(0);
  });

  it('counts included, excluded, and maybe decisions correctly', () => {
    const decisions = [
      { decision: 'include' },
      { decision: 'include' },
      { decision: 'exclude' },
      { decision: 'maybe' },
    ];
    const result = computeStats(10, decisions);
    expect(result.included).toBe(2);
    expect(result.excluded).toBe(1);
    expect(result.maybe).toBe(1);
    expect(result.screened).toBe(4);
  });

  it('computes undecided as total minus screened', () => {
    const decisions = [
      { decision: 'include' },
      { decision: 'exclude' },
    ];
    const result = computeStats(10, decisions);
    expect(result.undecided).toBe(8);
  });

  it('undecided is never negative', () => {
    // More screened decisions than total (edge case)
    const decisions = Array(15).fill({ decision: 'include' });
    const result = computeStats(10, decisions);
    expect(result.undecided).toBeGreaterThanOrEqual(0);
  });

  it('ignores unknown decision values', () => {
    const decisions = [
      { decision: 'include' },
      { decision: 'pending' }, // not a valid decision key
      { decision: 'unknown' },
    ];
    const result = computeStats(5, decisions);
    // Only 'include' is valid — screened = 1
    expect(result.included).toBe(1);
    expect(result.screened).toBe(1);
  });

  it('returns correct progress percentage (rounded)', () => {
    const decisions = [{ decision: 'include' }, { decision: 'exclude' }];
    const result = computeStats(3, decisions);
    // 2/3 = 66.67% → rounds to 67
    expect(result.progress).toBe(67);
  });

  it('handles empty decisions array with non-zero total', () => {
    const result = computeStats(100, []);
    expect(result.screened).toBe(0);
    expect(result.undecided).toBe(100);
    expect(result.progress).toBe(0);
  });
});

// ── computePrismaNumbers ───────────────────────────────────────────────────────

describe('computePrismaNumbers', () => {
  it('returns all expected PRISMA keys', () => {
    const prisma = computePrismaNumbers({
      total: 500, included: 50, excluded: 300, maybe: 100, undecided: 50,
    });
    expect(prisma).toHaveProperty('identified');
    expect(prisma).toHaveProperty('deduplicated');
    expect(prisma).toHaveProperty('screened');
    expect(prisma).toHaveProperty('excluded_title');
    expect(prisma).toHaveProperty('full_text');
    expect(prisma).toHaveProperty('included_final');
  });

  it('identified equals total', () => {
    const prisma = computePrismaNumbers({
      total: 400, included: 40, excluded: 200, maybe: 80, undecided: 80,
    });
    expect(prisma.identified).toBe(400);
  });

  it('deduplicated equals total minus duplicates', () => {
    const prisma = computePrismaNumbers({
      total: 500, included: 50, excluded: 300, maybe: 100, undecided: 50, duplicates: 30,
    });
    expect(prisma.deduplicated).toBe(470);
  });

  it('deduplicated equals total when duplicates is 0 (default)', () => {
    const prisma = computePrismaNumbers({
      total: 200, included: 20, excluded: 100, maybe: 50, undecided: 30,
    });
    expect(prisma.deduplicated).toBe(200);
  });

  it('screened equals included + excluded + maybe', () => {
    const prisma = computePrismaNumbers({
      total: 500, included: 50, excluded: 300, maybe: 100, undecided: 50,
    });
    expect(prisma.screened).toBe(450);
  });

  it('excluded_title equals excluded count', () => {
    const prisma = computePrismaNumbers({
      total: 300, included: 30, excluded: 200, maybe: 20, undecided: 50,
    });
    expect(prisma.excluded_title).toBe(200);
  });

  it('full_text equals included + maybe', () => {
    const prisma = computePrismaNumbers({
      total: 300, included: 30, excluded: 200, maybe: 20, undecided: 50,
    });
    expect(prisma.full_text).toBe(50);
  });

  it('included_final equals included', () => {
    const prisma = computePrismaNumbers({
      total: 300, included: 30, excluded: 200, maybe: 20, undecided: 50,
    });
    expect(prisma.included_final).toBe(30);
  });
});
