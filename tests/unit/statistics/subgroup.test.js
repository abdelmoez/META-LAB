/**
 * subgroup.test.js — golden tests for subgroupAnalysis's Q-between decomposition.
 * Cross-checks Qbetween against an independent recomputation from the per-group
 * and overall Q values.
 */
import { describe, it, expect } from 'vitest';
import { runMeta, subgroupAnalysis } from '../../../src/research-engine/statistics/meta-analysis.js';
import { chiSquareCDF } from '../../../src/research-engine/statistics/math-helpers.js';
import { fromSE } from '../../fixtures/meta/canonical.js';

// Two clearly-separated subgroups (g='X' low, g='Y' high), equal SEs.
const studies = [
  { ...fromSE(0.1, 0.1, 'x1'), g: 'X' },
  { ...fromSE(0.3, 0.1, 'x2'), g: 'X' },
  { ...fromSE(0.7, 0.1, 'y1'), g: 'Y' },
  { ...fromSE(0.9, 0.1, 'y2'), g: 'Y' },
];

describe('subgroupAnalysis (golden)', () => {
  it('partitions into the two groups with df = nGroups − 1', () => {
    const res = subgroupAnalysis(studies, 'g', 'random');
    expect(res.groups.map(g => g.group).sort()).toEqual(['X', 'Y']);
    expect(res.df).toBe(1);
  });

  it('Qbetween = max(0, Qoverall − ΣQwithin) — independent recompute', () => {
    const res = subgroupAnalysis(studies, 'g', 'random');
    const overall = runMeta(studies, 'random');
    const Qw = res.groups.reduce((a, g) => a + g.Q, 0);
    const expected = Math.max(0, overall.Q - Qw);
    expect(res.Qbetween).toBeCloseTo(expected, 12);
    expect(res.Qbetween).toBeGreaterThanOrEqual(0);
  });

  it('pBetween = 1 − χ²CDF(Qbetween, df) and is significant for separated groups', () => {
    const res = subgroupAnalysis(studies, 'g', 'random');
    expect(res.pBetween).toBeCloseTo(1 - chiSquareCDF(res.Qbetween, res.df), 12);
    expect(res.pBetween).toBeLessThan(0.05); // X vs Y are well separated
  });

  it('returns Qbetween null when only one group qualifies', () => {
    const oneGroup = studies.map(s => ({ ...s, g: 'All' }));
    const res = subgroupAnalysis(oneGroup, 'g', 'random');
    expect(res.Qbetween).toBeNull();
  });
});
