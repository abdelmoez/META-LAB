/**
 * meta-analysis.test.js
 * Unit tests for the core meta-analysis engine.
 */

import { describe, it, expect } from 'vitest';
import {
  runMeta,
  eggersTest,
  leaveOneOut,
  trimFill,
  influenceDiagnostics,
  subgroupAnalysis,
} from '../../src/research-engine/statistics/meta-analysis.js';

// ── Shared test fixtures ───────────────────────────────────────────────────────

// Four OR studies with known log-OR effect sizes and CIs
const studies = [
  { id: 's1', author: 'Smith', year: '2020', es: '0.693', lo: '0.182', hi: '1.204', esType: 'OR' },
  { id: 's2', author: 'Jones', year: '2021', es: '0.405', lo: '0.050', hi: '0.760', esType: 'OR' },
  { id: 's3', author: 'Brown', year: '2022', es: '1.099', lo: '0.600', hi: '1.598', esType: 'OR' },
  { id: 's4', author: 'Davis', year: '2023', es: '0.300', lo: '-0.100', hi: '0.700', esType: 'OR' },
];

// Studies with a distinct subgroup field
const studiesWithGroup = [
  { id: 'g1', author: 'Alpha', year: '2020', es: '0.5', lo: '0.1', hi: '0.9', esType: 'SMD', region: 'Asia' },
  { id: 'g2', author: 'Beta',  year: '2021', es: '0.6', lo: '0.2', hi: '1.0', esType: 'SMD', region: 'Asia' },
  { id: 'g3', author: 'Gamma', year: '2022', es: '0.2', lo: '-0.1', hi: '0.5', esType: 'SMD', region: 'Europe' },
  { id: 'g4', author: 'Delta', year: '2023', es: '0.3', lo: '0.0', hi: '0.6', esType: 'SMD', region: 'Europe' },
];

// Invalid / empty entries for edge-case tests
const emptyStudy = { id: 'empty', author: 'Empty', year: '2020', es: '', lo: '', hi: '' };
const invalidStudy = { id: 'bad', author: 'Bad',  year: '2020', es: 'NA', lo: '', hi: '' };

// ── runMeta ───────────────────────────────────────────────────────────────────
describe('runMeta', () => {
  it('returns null for fewer than 2 valid studies', () => {
    expect(runMeta([studies[0]])).toBeNull();
    expect(runMeta([])).toBeNull();
    expect(runMeta([emptyStudy, invalidStudy])).toBeNull();
  });

  it('returns null when all studies are invalid', () => {
    expect(runMeta([emptyStudy, { ...emptyStudy, id: 'e2' }])).toBeNull();
  });

  it('returns a result object for 2+ valid studies', () => {
    const res = runMeta(studies);
    expect(res).not.toBeNull();
  });

  it('result has correct k (study count)', () => {
    const res = runMeta(studies);
    expect(res.k).toBe(4);
  });

  it('pooled random ES is a finite number', () => {
    const res = runMeta(studies);
    expect(Number.isFinite(res.pES)).toBe(true);
  });

  it('lo95 < pES < hi95', () => {
    const res = runMeta(studies);
    expect(res.lo95).toBeLessThan(res.pES);
    expect(res.pES).toBeLessThan(res.hi95);
  });

  it('I2 is between 0 and 100', () => {
    const res = runMeta(studies);
    expect(res.I2).toBeGreaterThanOrEqual(0);
    expect(res.I2).toBeLessThanOrEqual(100);
  });

  it('Qpval is between 0 and 1', () => {
    const res = runMeta(studies);
    expect(res.Qpval).toBeGreaterThanOrEqual(0);
    expect(res.Qpval).toBeLessThanOrEqual(1);
  });

  it('pval (z-test) is between 0 and 1', () => {
    const res = runMeta(studies);
    expect(res.pval).toBeGreaterThanOrEqual(0);
    expect(res.pval).toBeLessThanOrEqual(1);
  });

  it('tau2 is non-negative', () => {
    const res = runMeta(studies);
    expect(res.tau2).toBeGreaterThanOrEqual(0);
  });

  it('method defaults to "random"', () => {
    const res = runMeta(studies);
    expect(res.method).toBe('random');
  });

  it('method "fixed" gives fixed-effects result', () => {
    const res = runMeta(studies, 'fixed');
    expect(res.method).toBe('fixed');
    // Fixed effect tau2 is 0
    expect(res.tau2).toBe(0);
  });

  it('fixed and random ES are both present in result', () => {
    const res = runMeta(studies);
    expect(res.fixed).toBeDefined();
    expect(res.fixed.es).toBeDefined();
    expect(res.random).toBeDefined();
    expect(res.random.es).toBeDefined();
  });

  it('fixed ES CI is narrower than random ES CI', () => {
    const res = runMeta(studies);
    const fixedWidth  = res.fixed.hi - res.fixed.lo;
    const randomWidth = res.random.hi - res.random.lo;
    // When heterogeneity exists, random CI should be >= fixed CI
    expect(randomWidth).toBeGreaterThanOrEqual(fixedWidth - 1e-6);
  });

  it('HKSJ result is present for k >= 2', () => {
    const res = runMeta(studies);
    expect(res.hksj).not.toBeNull();
    expect(res.hksj.es).toBeDefined();
    expect(res.hksj.pval).toBeDefined();
  });

  it('prediction interval is present for k >= 3', () => {
    const res = runMeta(studies);
    expect(res.predInt).not.toBeNull();
    expect(res.predInt.lo).toBeDefined();
    expect(res.predInt.hi).toBeDefined();
  });

  it('prediction interval is null for k == 2', () => {
    const res = runMeta(studies.slice(0, 2));
    expect(res.predInt).toBeNull();
  });

  it('each study has weight percentages summing to ~100', () => {
    const res = runMeta(studies);
    const fixedSum  = res.studies.reduce((a, s) => a + s._wFixedPct, 0);
    const randomSum = res.studies.reduce((a, s) => a + s._wRandomPct, 0);
    expect(fixedSum).toBeCloseTo(100, 3);
    expect(randomSum).toBeCloseTo(100, 3);
  });

  it('skips studies with empty or non-numeric es/lo/hi', () => {
    const mixed = [...studies, emptyStudy, invalidStudy];
    const res = runMeta(mixed);
    expect(res.k).toBe(4); // only the 4 valid studies
  });

  it('pooled fixed ES equals weighted mean of individual ES', () => {
    const res = runMeta(studies.slice(0, 2), 'fixed');
    // Manually compute: each w = 1/se^2; se = (hi-lo)/(2*Z975)
    // Just verify the direction/range
    const esValues = studies.slice(0, 2).map(s => +s.es);
    const minES = Math.min(...esValues);
    const maxES = Math.max(...esValues);
    expect(res.pES).toBeGreaterThanOrEqual(minES);
    expect(res.pES).toBeLessThanOrEqual(maxES);
  });
});

// ── eggersTest ────────────────────────────────────────────────────────────────
describe('eggersTest', () => {
  it('returns null for fewer than 3 valid studies', () => {
    expect(eggersTest([])).toBeNull();
    expect(eggersTest([studies[0]])).toBeNull();
    expect(eggersTest([studies[0], studies[1]])).toBeNull();
  });

  it('returns an object for 3+ valid studies', () => {
    const res = eggersTest(studies);
    expect(res).not.toBeNull();
  });

  it('result has intercept, seInt, t, pval, dof, k', () => {
    const res = eggersTest(studies);
    expect(res).toHaveProperty('intercept');
    expect(res).toHaveProperty('seInt');
    expect(res).toHaveProperty('t');
    expect(res).toHaveProperty('pval');
    expect(res).toHaveProperty('dof');
    expect(res).toHaveProperty('k');
  });

  it('k equals number of valid studies', () => {
    const res = eggersTest(studies);
    expect(res.k).toBe(4);
  });

  it('dof = k - 2', () => {
    const res = eggersTest(studies);
    expect(res.dof).toBe(res.k - 2);
  });

  it('pval is between 0 and 1', () => {
    const res = eggersTest(studies);
    expect(res.pval).toBeGreaterThanOrEqual(0);
    expect(res.pval).toBeLessThanOrEqual(1);
  });

  it('seInt is positive', () => {
    const res = eggersTest(studies);
    expect(res.seInt).toBeGreaterThan(0);
  });

  // Canonical Egger (1997) / metafor::regtest(model="lm") fixture.
  // 14 Cohen's d studies; SE round-trips because we rebuild the CI with the
  // same Z975 (1.959963984540054) the engine uses to recover SE from lo/hi.
  it('matches canonical UNWEIGHTED Egger on the 14-study fixture', () => {
    const Z = 1.959963984540054;
    const fx = [
      { es: 1.4623, se: 0.6017 }, { es: 1.3832, se: 0.5950 }, { es: 1.1427, se: 0.3946 },
      { es: -0.1032, se: 0.2377 }, { es: -0.3918, se: 0.2289 }, { es: 2.1994, se: 0.3028 },
      { es: 1.1561, se: 0.6237 }, { es: 0.0732, se: 0.5775 }, { es: 0.7774, se: 0.2968 },
      { es: 0.1620, se: 0.5008 }, { es: 0.1659, se: 0.5009 }, { es: 0.5937, se: 0.2867 },
      { es: 0.6990, se: 0.2540 }, { es: -0.3172, se: 0.3803 },
    ];
    const fixtureStudies = fx.map((s, i) => ({
      id: 'f' + i, es: String(s.es),
      lo: String(s.es - Z * s.se), hi: String(s.es + Z * s.se),
    }));
    const res = eggersTest(fixtureStudies);
    expect(res.k).toBe(14);
    expect(res.dof).toBe(12);
    expect(res.intercept).toBeCloseTo(1.86, 1);   // canonical ≈ 1.86 (was 3.94 when weighted)
    expect(res.t).toBeCloseTo(1.01, 1);            // ≈ 1.01 (was 1.42)
    expect(res.pval).toBeCloseTo(0.334, 2);        // ≈ 0.334 (was 0.181)
    // Guard against regression to the old weighted numbers:
    expect(res.intercept).toBeLessThan(2.5);
    expect(res.pval).toBeGreaterThan(0.28);
  });

  it('returns null when a study has a degenerate SE (hi <= lo)', () => {
    const bad = [
      { id: 'x', es: '0.5', lo: '0.9', hi: '0.1' }, // hi < lo → SE <= 0
      studies[0], studies[1], studies[2],
    ];
    expect(eggersTest(bad)).toBeNull();
  });
});

// ── leaveOneOut ───────────────────────────────────────────────────────────────
describe('leaveOneOut', () => {
  it('returns empty array for fewer than 3 valid studies', () => {
    expect(leaveOneOut([])).toEqual([]);
    expect(leaveOneOut([studies[0], studies[1]])).toEqual([]);
  });

  it('returns array of length k for k valid studies', () => {
    const res = leaveOneOut(studies);
    expect(res).toHaveLength(4);
  });

  it('each element has omitted, omittedId, pES, lo95, hi95, I2, pval', () => {
    const res = leaveOneOut(studies);
    res.forEach(r => {
      expect(r).toHaveProperty('omitted');
      expect(r).toHaveProperty('omittedId');
      expect(r).toHaveProperty('pES');
      expect(r).toHaveProperty('lo95');
      expect(r).toHaveProperty('hi95');
      expect(r).toHaveProperty('I2');
      expect(r).toHaveProperty('pval');
    });
  });

  it('omittedId corresponds to the removed study id', () => {
    const res = leaveOneOut(studies);
    const ids = res.map(r => r.omittedId);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids).toContain('s3');
    expect(ids).toContain('s4');
  });

  it('pES values are all finite numbers', () => {
    const res = leaveOneOut(studies);
    res.forEach(r => {
      expect(Number.isFinite(r.pES)).toBe(true);
    });
  });
});

// ── influenceDiagnostics ──────────────────────────────────────────────────────
describe('influenceDiagnostics', () => {
  it('returns empty array for fewer than 3 valid studies', () => {
    expect(influenceDiagnostics([])).toEqual([]);
    expect(influenceDiagnostics([studies[0], studies[1]])).toEqual([]);
  });

  it('returns array of length k for k valid studies', () => {
    const res = influenceDiagnostics(studies);
    expect(res).toHaveLength(4);
  });

  it('each element has id, label, pES, tau2, I2, dffit, tau2Drop, i2Drop, influential', () => {
    const res = influenceDiagnostics(studies);
    res.forEach(r => {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('label');
      expect(r).toHaveProperty('pES');
      expect(r).toHaveProperty('tau2');
      expect(r).toHaveProperty('I2');
      expect(r).toHaveProperty('dffit');
      expect(r).toHaveProperty('tau2Drop');
      expect(r).toHaveProperty('i2Drop');
      expect(r).toHaveProperty('influential');
    });
  });

  it('influential is a boolean', () => {
    const res = influenceDiagnostics(studies);
    res.forEach(r => {
      expect(typeof r.influential).toBe('boolean');
    });
  });
});

// ── trimFill ──────────────────────────────────────────────────────────────────
describe('trimFill', () => {
  it('returns null for fewer than 3 valid studies', () => {
    expect(trimFill([])).toBeNull();
    expect(trimFill([studies[0], studies[1]])).toBeNull();
  });

  it('returns an object for 3+ valid studies', () => {
    const res = trimFill(studies);
    expect(res).not.toBeNull();
  });

  it('result has k0, adjusted, imputed, side, base properties', () => {
    const res = trimFill(studies);
    expect(res).toHaveProperty('k0');
    expect(res).toHaveProperty('adjusted');
    expect(res).toHaveProperty('imputed');
    expect(res).toHaveProperty('side');
    expect(res).toHaveProperty('base');
  });

  it('k0 is a non-negative integer', () => {
    const res = trimFill(studies);
    expect(Number.isInteger(res.k0)).toBe(true);
    expect(res.k0).toBeGreaterThanOrEqual(0);
  });

  it('base is a valid runMeta result', () => {
    const res = trimFill(studies);
    expect(res.base).not.toBeNull();
    expect(res.base.k).toBe(4);
  });

  it('adjusted is a valid runMeta result or equals base when k0=0', () => {
    const res = trimFill(studies);
    if (res.k0 === 0) {
      expect(res.adjusted).toEqual(res.base);
    } else {
      expect(res.adjusted).not.toBeNull();
      expect(res.adjusted.k).toBeGreaterThanOrEqual(res.base.k);
    }
  });

  it('imputed is an array', () => {
    const res = trimFill(studies);
    expect(Array.isArray(res.imputed)).toBe(true);
  });

  it('number of imputed studies equals k0', () => {
    const res = trimFill(studies);
    expect(res.imputed).toHaveLength(res.k0);
  });
});

// ── subgroupAnalysis ──────────────────────────────────────────────────────────
describe('subgroupAnalysis', () => {
  it('returns groups array and Qbetween/pBetween', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    expect(res).toHaveProperty('groups');
    expect(res).toHaveProperty('Qbetween');
    expect(res).toHaveProperty('pBetween');
    expect(res).toHaveProperty('df');
  });

  it('groups studies by the groupKey', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    const groupNames = res.groups.map(g => g.group);
    expect(groupNames).toContain('Asia');
    expect(groupNames).toContain('Europe');
  });

  it('returns correct number of groups', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    expect(res.groups).toHaveLength(2);
  });

  it('Qbetween is non-negative', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    if (res.Qbetween !== null) {
      expect(res.Qbetween).toBeGreaterThanOrEqual(0);
    }
  });

  it('pBetween is between 0 and 1 when available', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    if (res.pBetween !== null) {
      expect(res.pBetween).toBeGreaterThanOrEqual(0);
      expect(res.pBetween).toBeLessThanOrEqual(1);
    }
  });

  it('each group result has group, n, and runMeta fields', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    res.groups.forEach(g => {
      expect(g).toHaveProperty('group');
      expect(g).toHaveProperty('n');
      expect(g).toHaveProperty('pES');
      expect(g).toHaveProperty('k');
    });
  });

  it('df = number of groups - 1', () => {
    const res = subgroupAnalysis(studiesWithGroup, 'region');
    expect(res.df).toBe(res.groups.length - 1);
  });

  it('returns Qbetween null when only one group has enough studies', () => {
    // Use studies all in same group — subgroup has only 1 group → null
    const singleGroup = studies.map(s => ({ ...s, region: 'All' }));
    const res = subgroupAnalysis(singleGroup, 'region');
    expect(res.Qbetween).toBeNull();
    expect(res.pBetween).toBeNull();
  });

  it('groups studies with missing groupKey as "Unspecified"', () => {
    const noGroup = [
      { id: 'x1', es: '0.5', lo: '0.1', hi: '0.9' },
      { id: 'x2', es: '0.6', lo: '0.2', hi: '1.0' },
    ];
    const res = subgroupAnalysis(noGroup, 'region');
    const names = res.groups.map(g => g.group);
    expect(names).toContain('Unspecified');
  });
});
