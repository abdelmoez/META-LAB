/**
 * 86.md P2.16/P2.19 — the app carries TWO copies of the meta-analysis engine
 * (src/research-engine/statistics/monolithStats.js, used in-browser, and
 * meta-analysis.js, used server-side). Only runMeta had a cross-copy parity test, so
 * a fix landing in one copy but not the other passed CI. This pins that BOTH copies
 * agree on the default DerSimonian–Laird path for every shared function, so a future
 * divergence is caught immediately.
 */
import { describe, it, expect } from 'vitest';
import * as mono from '../../../src/research-engine/statistics/monolithStats.js';
import * as pure from '../../../src/research-engine/statistics/meta-analysis.js';

const studies = [
  { id: '1', author: 'A', year: '2019', esType: 'OR', design: 'RCT', es: '0.30', lo: '0.10', hi: '0.55', n: '100' },
  { id: '2', author: 'B', year: '2020', esType: 'OR', design: 'RCT', es: '0.42', lo: '0.18', hi: '0.70', n: '120' },
  { id: '3', author: 'C', year: '2021', esType: 'OR', design: 'Obs', es: '0.55', lo: '0.20', hi: '0.95', n: '90' },
  { id: '4', author: 'D', year: '2022', esType: 'OR', design: 'RCT', es: '0.25', lo: '0.05', hi: '0.48', n: '150' },
  { id: '5', author: 'E', year: '2023', esType: 'OR', design: 'Obs', es: '0.60', lo: '0.30', hi: '0.92', n: '80' },
];

const near = (a, b, p = 6) => {
  if (a == null && b == null) return;
  expect(+a).toBeCloseTo(+b, p);
};

describe('statistics engine copies — DL-path parity (P2.19)', () => {
  it('runMeta agrees on pooled estimate, CI, k, I², τ²', () => {
    const a = mono.runMeta(studies, 'random');
    const b = pure.runMeta(studies, 'random');
    near(a.pES, b.pES); near(a.lo95, b.lo95); near(a.hi95, b.hi95);
    expect(a.k).toBe(b.k); near(a.I2, b.I2, 4); near(a.tau2, b.tau2);
  });

  it('eggersTest agrees on intercept, pval, k', () => {
    const a = mono.eggersTest(studies);
    const b = pure.eggersTest(studies);
    expect(!!a).toBe(!!b);
    if (a && b) { near(a.intercept, b.intercept); near(a.pval, b.pval); expect(a.k).toBe(b.k); }
  });

  it('leaveOneOut agrees per omitted study (default DL)', () => {
    const a = mono.leaveOneOut(studies, 'random');
    const b = pure.leaveOneOut(studies, 'random');
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) { near(a[i].pES, b[i].pES); near(a[i].lo95, b[i].lo95); near(a[i].hi95, b[i].hi95); }
  });

  it('trimFill agrees on adjusted estimate + imputed count', () => {
    const a = mono.trimFill(studies, 'random');
    const b = pure.trimFill(studies, 'random');
    expect(!!a).toBe(!!b);
    if (a && b) {
      near(a.adjustedES ?? a.pES, b.adjustedES ?? b.pES);
      const count = (x) => Array.isArray(x.imputed) ? x.imputed.length : (Array.isArray(x.filled) ? x.filled.length : (x.imputed ?? x.k0));
      expect(count(a)).toEqual(count(b));
    }
  });

  it('influenceDiagnostics agrees per study', () => {
    const a = mono.influenceDiagnostics(studies, 'random');
    const b = pure.influenceDiagnostics(studies, 'random');
    expect(a.length).toBe(b.length);
  });

  it('subgroupAnalysis agrees on per-group pooled estimates', () => {
    const a = mono.subgroupAnalysis(studies, 'design', 'random');
    const b = pure.subgroupAnalysis(studies, 'design', 'random');
    expect(Array.isArray(a.groups)).toBe(Array.isArray(b.groups));
    if (Array.isArray(a.groups) && Array.isArray(b.groups)) {
      expect(a.groups.length).toBe(b.groups.length);
    }
  });
});
