/**
 * engine.test.js — orchestration, geometry, inconsistency, contribution, provenance.
 * Uses GENERIC contrast-level studies (te, seTE) so direct/indirect effects can be
 * controlled exactly, plus binary arm-level data for geometry/validation.
 */
import { describe, it, expect } from 'vitest';
import { deriveNetwork } from '../../../src/research-engine/statistics/nma/contrasts.js';
import { networkGeometry, connectedComponents } from '../../../src/research-engine/statistics/nma/geometry.js';
import { directVsIndirect, globalInconsistency } from '../../../src/research-engine/statistics/nma/inconsistency.js';
import { contributionMatrix } from '../../../src/research-engine/statistics/nma/contribution.js';
import { validateNetwork, runNetworkMetaAnalysis } from '../../../src/research-engine/statistics/nma/index.js';

const gen = (id, t1, t2, te, seTE = 0.1) => ({ id, contrasts: [{ t1, t2, te, seTE }] });
// Consistent triangle: B−A=0.4, C−B=0.4, C−A=0.8 (=0.4+0.4).
const CONSISTENT = [
  gen('ab1', 'A', 'B', 0.4), gen('ab2', 'A', 'B', 0.4),
  gen('bc1', 'B', 'C', 0.4), gen('bc2', 'B', 'C', 0.4),
  gen('ac1', 'A', 'C', 0.8), gen('ac2', 'A', 'C', 0.8),
];
// Inconsistent: same loop but the direct A−C says 0.0 while indirect says 0.8.
const INCONSISTENT = [
  gen('ab1', 'A', 'B', 0.4), gen('ab2', 'A', 'B', 0.4),
  gen('bc1', 'B', 'C', 0.4), gen('bc2', 'B', 'C', 0.4),
  gen('ac1', 'A', 'C', 0.0), gen('ac2', 'A', 'C', 0.0),
];

describe('NMA geometry', () => {
  it('detects connected components', () => {
    const net = deriveNetwork([
      gen('1', 'A', 'B', 0.4), gen('2', 'C', 'D', 0.4),
    ], 'GENERIC');
    const geom = networkGeometry(net);
    expect(geom.connected).toBe(false);
    expect(geom.nComponents).toBe(2);
    const comps = connectedComponents(['A', 'B', 'C', 'D'], geom.edges);
    expect(comps.length).toBe(2);
  });

  it('counts edges and studies for a triangle', () => {
    const geom = networkGeometry(deriveNetwork(CONSISTENT, 'GENERIC'));
    expect(geom.connected).toBe(true);
    expect(geom.edges.length).toBe(3); // AB, BC, AC
    expect(geom.nodes.length).toBe(3);
  });
});

describe('NMA node-splitting (direct vs indirect)', () => {
  it('a CONSISTENT loop shows direct ≈ indirect for A–C', () => {
    const net = deriveNetwork(CONSISTENT, 'GENERIC');
    const splits = directVsIndirect(net, { model: 'common' });
    const ac = splits.find((s) => s.t1 === 'A' && s.t2 === 'C');
    expect(ac.estimable).toBe(true);
    expect(Math.abs(ac.direct.est - 0.8)).toBeLessThan(1e-9);
    expect(Math.abs(ac.indirect.est - 0.8)).toBeLessThan(1e-6);
    expect(Math.abs(ac.diff.est)).toBeLessThan(0.05);
  });

  it('an INCONSISTENT loop flags a significant A–C split', () => {
    const net = deriveNetwork(INCONSISTENT, 'GENERIC');
    const splits = directVsIndirect(net, { model: 'common' });
    const ac = splits.find((s) => s.t1 === 'A' && s.t2 === 'C');
    expect(ac.estimable).toBe(true);
    expect(Math.abs(ac.direct.est - 0.0)).toBeLessThan(1e-9);
    expect(Math.abs(ac.indirect.est - 0.8)).toBeLessThan(1e-6);
    expect(ac.pval).toBeLessThan(0.05); // ~0.8 / sqrt(2·(0.1/√2)²)
  });
});

describe('NMA global inconsistency (design Q decomposition)', () => {
  it('consistent loop: small Q_inc; inconsistent loop: large Q_inc', () => {
    const gc = globalInconsistency(deriveNetwork(CONSISTENT, 'GENERIC'));
    const gi = globalInconsistency(deriveNetwork(INCONSISTENT, 'GENERIC'));
    expect(gc.ok).toBe(true);
    expect(gc.dfInc).toBe(1); // one independent loop
    expect(gc.Qinc).toBeLessThan(1e-6);
    expect(gi.Qinc).toBeGreaterThan(gc.Qinc + 5);
    expect(gi.pInc).toBeLessThan(0.05);
  });
});

describe('NMA contribution matrix', () => {
  it('rows sum to 1 and direct-only edges have a high direct proportion', () => {
    const net = deriveNetwork(CONSISTENT, 'GENERIC');
    const cm = contributionMatrix(net);
    expect(cm.ok).toBe(true);
    cm.matrix.forEach((row) => {
      const s = row.reduce((a, b) => a + b, 0);
      expect(Math.abs(s - 1)).toBeLessThan(1e-9);
    });
    cm.edges.forEach((e) => { expect(e.directProportion).toBeGreaterThan(0); expect(e.directProportion).toBeLessThanOrEqual(1); });
  });
});

describe('NMA orchestrator', () => {
  it('validateNetwork warns on 2 treatments and blocks <2', () => {
    const two = validateNetwork({ sm: 'GENERIC', studies: [gen('1', 'A', 'B', 0.4)] });
    expect(two.ok).toBe(true);
    expect(two.warnings.some((w) => /two treatments/i.test(w.msg))).toBe(true);
    const one = validateNetwork({ sm: 'GENERIC', studies: [] });
    expect(one.ok).toBe(false);
  });

  it('runs a full analysis with league, ranking, geometry, provenance', () => {
    const res = runNetworkMetaAnalysis({ sm: 'GENERIC', smallerBetter: false, studies: CONSISTENT }, { model: 'random' });
    expect(res.ok).toBe(true);
    expect(res.treatments).toEqual(['A', 'B', 'C']);
    expect(res.league.cells.A.C.est).toBeCloseTo(0.8, 6);
    expect(res.ranking.length).toBe(3);
    expect(res.forest.length).toBe(2); // B,C vs reference A
    expect(res.geometry.connected).toBe(true);
    expect(res.provenance.dataHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic — same input yields the same fingerprint and estimates', () => {
    const a = runNetworkMetaAnalysis({ sm: 'GENERIC', studies: CONSISTENT });
    const b = runNetworkMetaAnalysis({ sm: 'GENERIC', studies: CONSISTENT.slice().reverse() });
    expect(a.provenance.dataHash).toBe(b.provenance.dataHash); // order-independent hash
    expect(a.league.cells.A.C.est).toBeCloseTo(b.league.cells.A.C.est, 12);
  });

  it('handles a disconnected network by analysing the largest component', () => {
    const res = runNetworkMetaAnalysis({ sm: 'GENERIC', studies: [...CONSISTENT, gen('x', 'X', 'Y', 0.5)] });
    expect(res.ok).toBe(true);
    expect(res.excludedTreatments.sort()).toEqual(['X', 'Y']);
    expect(res.treatments).toEqual(['A', 'B', 'C']);
  });
});
