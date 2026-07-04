/**
 * runMetaTau2.test.js — RoadMap/2.md. The τ² estimator threads through runMeta
 * WITHOUT changing the DerSimonian–Laird default (byte-for-byte), and HKSJ + the
 * prediction interval keep working under any estimator. Tested on BOTH runMeta
 * copies (the UI monolith copy and the server/engine copy) to prove parity.
 */
import { describe, it, expect } from 'vitest';
import { runMeta as runMetaUI } from '../../../src/research-engine/statistics/monolithStats.js';
import { runMeta as runMetaEngine } from '../../../src/research-engine/statistics/meta-analysis.js';
import { estimateTau2 } from '../../../src/research-engine/statistics/tau2.js';

const studies = [
  { id: 's1', es: '0.30', lo: '0.10', hi: '0.50', esType: 'SMD' },
  { id: 's2', es: '0.55', lo: '0.05', hi: '1.05', esType: 'SMD' },
  { id: 's3', es: '-0.10', lo: '-0.45', hi: '0.25', esType: 'SMD' },
  { id: 's4', es: '0.80', lo: '0.20', hi: '1.40', esType: 'SMD' },
  { id: 's5', es: '0.20', lo: '-0.05', hi: '0.45', esType: 'SMD' },
  { id: 's6', es: '0.65', lo: '0.10', hi: '1.20', esType: 'SMD' },
];

for (const [name, runMeta] of [['UI/monolithStats', runMetaUI], ['engine/meta-analysis', runMetaEngine]]) {
  describe(`runMeta τ² wiring — ${name}`, () => {
    it('is byte-for-byte identical for 2-arg, {} and {tau2Method:"DL"} calls', () => {
      const a = runMeta(studies, 'random');
      const b = runMeta(studies, 'random', {});
      const c = runMeta(studies, 'random', { tau2Method: 'DL' });
      expect(b.random.tau2).toBe(a.random.tau2);
      expect(c.random.tau2).toBe(a.random.tau2);
      expect(b.pES).toBe(a.pES);
      expect(c.pES).toBe(a.pES);
      expect(a.tau2Method).toBe('DL');
    });

    it('applies a non-DL estimator to the random-effects τ² and reports it', () => {
      const dl = runMeta(studies, 'random');
      const reml = runMeta(studies, 'random', { tau2Method: 'REML' });
      expect(reml.tau2Method).toBe('REML');
      expect(reml.tau2Fallback).toBe(null);
      // REML τ² matches the standalone estimator on the same y/v.
      const y = dl.studies.map((s) => s._es);
      const v = dl.studies.map((s) => s._se * s._se);
      expect(reml.random.tau2).toBeCloseTo(estimateTau2(y, v, { method: 'REML' }).tau2, 10);
      // The pooled estimate shifts when τ² changes (unless τ² happened to match).
      expect(reml.random.tau2).not.toBe(dl.random.tau2);
    });

    it('fixed-effect results ignore the estimator entirely', () => {
      const a = runMeta(studies, 'fixed');
      const b = runMeta(studies, 'fixed', { tau2Method: 'PM' });
      expect(b.fixed.es).toBe(a.fixed.es);
      expect(b.pES).toBe(a.pES);
    });

    it('HKSJ and the prediction interval are present under a non-DL estimator', () => {
      const r = runMeta(studies, 'random', { tau2Method: 'PM' });
      expect(r.hksj).toBeTruthy();
      expect(r.predInt).toBeTruthy();
      // PI half-width uses the chosen τ² (sePred = sqrt(τ² + SE²)).
      expect(r.predInt.sePred).toBeGreaterThan(0);
    });

    it('falls back to DL for k < 3 and flags it', () => {
      const two = studies.slice(0, 2);
      const r = runMeta(two, 'random', { tau2Method: 'REML' });
      expect(r.tau2Fallback).toBe('DL');
      expect(r.random.tau2).toBeCloseTo(runMeta(two, 'random').random.tau2, 12);
    });
  });
}
