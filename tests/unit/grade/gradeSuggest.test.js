import { describe, it, expect } from 'vitest';
import {
  suggestRob,
  suggestInconsistency,
  suggestIndirectness,
  suggestImprecision,
  suggestPublicationBias,
  suggestDomains,
} from '../../../src/research-engine/grade/gradeSuggest.js';
import { summariseRobForGrade } from '../../../src/research-engine/rob/gradeSync.js';
import { runMeta, eggersTest } from '../../../src/research-engine/statistics/meta-analysis.js';

// Minimal synthetic meta objects — threshold precision without depending on the
// pooling arithmetic (real-engine integration is covered at the end).
const meta = (o) => ({ k: 5, I2: 10, I2desc: 'low', Qpval: 0.5, lo95: 0.3, hi95: 0.7, ...o });

describe('gradeSuggest — risk of bias (delegates to summariseRobForGrade)', () => {
  it('passes a serious suggestion straight through', () => {
    const s = suggestRob({ suggestedRating: 'serious', reason: 'x', signature: 'sig' });
    expect(s.suggest).toBe('serious');
    expect(s.source).toBe('auto');
    expect(s.domain).toBe('rob');
    expect(s.signature).toBe('sig');
  });

  it('null suggestion when nothing finalised', () => {
    const s = suggestRob({ suggestedRating: null, reason: 'none yet' });
    expect(s.suggest).toBe(null);
    expect(s.reason).toMatch(/none yet/);
  });

  it('handles a missing summary gracefully', () => {
    const s = suggestRob(undefined);
    expect(s.suggest).toBe(null);
    expect(s.reason).toMatch(/Risk of Bias/i);
  });
});

describe('gradeSuggest — inconsistency (I² bands)', () => {
  it('null when there is no meta result', () => {
    expect(suggestInconsistency(null).suggest).toBe(null);
  });
  it('I² < 50 → not serious', () => {
    expect(suggestInconsistency(meta({ I2: 30 })).suggest).toBe('not_serious');
    expect(suggestInconsistency(meta({ I2: 49.9 })).suggest).toBe('not_serious');
  });
  it('50 ≤ I² < 75 → serious', () => {
    expect(suggestInconsistency(meta({ I2: 50 })).suggest).toBe('serious');
    expect(suggestInconsistency(meta({ I2: 60, Qpval: 0.02 })).suggest).toBe('serious');
    expect(suggestInconsistency(meta({ I2: 74.9 })).suggest).toBe('serious');
  });
  it('I² ≥ 75 → very serious', () => {
    expect(suggestInconsistency(meta({ I2: 75 })).suggest).toBe('very_serious');
    expect(suggestInconsistency(meta({ I2: 92 })).suggest).toBe('very_serious');
  });
});

describe('gradeSuggest — indirectness (reviewer-only, always null)', () => {
  it('never suggests a rating, and anchors on PICO when present', () => {
    const s = suggestIndirectness({ P: 'adults with sepsis', I: 'drug', C: 'placebo', O: 'mortality' });
    expect(s.suggest).toBe(null);
    expect(s.domain).toBe('indirectness');
    expect(s.reason).toMatch(/adults with sepsis/);
  });
  it('still returns null with an empty PICO', () => {
    const s = suggestIndirectness({});
    expect(s.suggest).toBe(null);
    expect(s.reason).toMatch(/population, intervention, comparator and outcome/);
  });
  it('does not throw on undefined PICO', () => {
    expect(() => suggestIndirectness(undefined)).not.toThrow();
    expect(suggestIndirectness(undefined).suggest).toBe(null);
  });
});

describe('gradeSuggest — imprecision (CI crosses null + OIS proxy)', () => {
  it('null when there is no meta result', () => {
    expect(suggestImprecision(null).suggest).toBe(null);
  });
  it('CI excludes null and k ≥ 5 → not serious', () => {
    const s = suggestImprecision(meta({ k: 8, lo95: 0.3, hi95: 0.7 }), 'SMD');
    expect(s.suggest).toBe('not_serious');
    expect(s.reason).toMatch(/Optimal Information Size/);
  });
  it('CI crosses null (k ≥ 5) → serious', () => {
    expect(suggestImprecision(meta({ k: 8, lo95: -0.2, hi95: 0.3 }), 'SMD').suggest).toBe('serious');
  });
  it('few studies but CI excludes null → serious (OIS proxy)', () => {
    expect(suggestImprecision(meta({ k: 3, lo95: 0.3, hi95: 0.7 }), 'MD').suggest).toBe('serious');
  });
  it('CI crosses null AND few studies → very serious', () => {
    expect(suggestImprecision(meta({ k: 3, lo95: -0.2, hi95: 0.4 }), 'OR').suggest).toBe('very_serious');
  });
  it('log-scale null is 0 on the analysis scale (OR crossing detected)', () => {
    // lo95=-0.1, hi95=0.2 on ln scale ⇒ OR CI 0.90–1.22 straddles 1
    expect(suggestImprecision(meta({ k: 8, lo95: -0.1, hi95: 0.2 }), 'OR').suggest).toBe('serious');
  });
  it('PROP (logit, no null) is not treated as crossing', () => {
    // lo95<0<hi95 on the logit scale is NOT a null-crossing for a single-arm proportion
    const s = suggestImprecision(meta({ k: 8, lo95: -0.2, hi95: 0.3 }), 'PROP');
    expect(s.suggest).toBe('not_serious');
  });
});

describe('gradeSuggest — publication bias (Egger + study count)', () => {
  it('null when there is no meta result', () => {
    expect(suggestPublicationBias(null).suggest).toBe(null);
  });
  it('significant Egger → serious', () => {
    const s = suggestPublicationBias(meta({ k: 12 }), { pval: 0.01 });
    expect(s.suggest).toBe('serious');
    expect(s.reason).toMatch(/Egger/);
  });
  it('fewer than 10 studies is NOT auto-downgraded (GRADE-correct)', () => {
    const s = suggestPublicationBias(meta({ k: 6 }), null);
    expect(s.suggest).toBe('not_serious');
    expect(s.reason).toMatch(/cannot be formally assessed|judge qualitatively/i);
  });
  it('≥ 10 studies with non-significant Egger → not serious', () => {
    const s = suggestPublicationBias(meta({ k: 14 }), { pval: 0.4 });
    expect(s.suggest).toBe('not_serious');
    expect(s.reason).toMatch(/No strong signal/);
  });
  it('non-significant Egger with few studies → not serious', () => {
    expect(suggestPublicationBias(meta({ k: 5 }), { pval: 0.6 }).suggest).toBe('not_serious');
  });
});

describe('gradeSuggest — suggestDomains (all five domains)', () => {
  it('returns all five domains; indirectness is always null-suggest', () => {
    const out = suggestDomains({
      robSummary: { suggestedRating: 'serious', reason: 'r' },
      meta: meta({ I2: 80, k: 3, lo95: -0.1, hi95: 0.3 }),
      pico: { P: 'x', I: 'y', C: 'z', O: 'w' },
    });
    expect(Object.keys(out).sort()).toEqual(['imprecision', 'inconsistency', 'indirectness', 'publicationBias', 'rob']);
    expect(out.indirectness.suggest).toBe(null);
    expect(out.rob.suggest).toBe('serious');
    expect(out.inconsistency.suggest).toBe('very_serious');
    expect(out.imprecision.suggest).toBe('very_serious'); // crosses + k<5
  });

  it('reads egger + esType from the meta object', () => {
    const out = suggestDomains({ meta: meta({ k: 12, egger: { pval: 0.001 }, esType: 'OR', lo95: -0.1, hi95: 0.2 }) });
    expect(out.publicationBias.suggest).toBe('serious');
    expect(out.imprecision.suggest).toBe('serious'); // OR CI straddles 1
  });

  it('degenerate: everything empty does not throw', () => {
    expect(() => suggestDomains({})).not.toThrow();
    const out = suggestDomains({});
    expect(out.rob.suggest).toBe(null);
    expect(out.inconsistency.suggest).toBe(null);
    expect(out.imprecision.suggest).toBe(null);
    expect(out.publicationBias.suggest).toBe(null);
    expect(out.indirectness.suggest).toBe(null);
  });
});

describe('gradeSuggest — no-drift integration with the real engines', () => {
  it('consumes summariseRobForGrade output unchanged', () => {
    const rob = summariseRobForGrade([
      { id: '1', status: 'complete', overall: 'high' },
      { id: '2', status: 'complete', overall: 'high' },
      { id: '3', status: 'complete', overall: 'low' },
    ]);
    const s = suggestRob(rob);
    expect(s.suggest).toBe('very_serious'); // high in ≥ half
    expect(s.reason).toBe(rob.reason);
  });

  it('consumes a real runMeta result (high heterogeneity → very serious)', () => {
    const studies = [
      { es: '0.10', lo: '0.05', hi: '0.15' },
      { es: '1.00', lo: '0.95', hi: '1.05' },
    ];
    const m = runMeta(studies, 'random');
    expect(m).not.toBe(null);
    expect(m.I2).toBeGreaterThanOrEqual(75);
    expect(suggestInconsistency(m).suggest).toBe('very_serious');
  });

  it('consumes a real runMeta result (consistent, precise → not serious both domains)', () => {
    const studies = [
      { es: '0.50', lo: '0.30', hi: '0.70' },
      { es: '0.52', lo: '0.32', hi: '0.72' },
      { es: '0.48', lo: '0.28', hi: '0.68' },
      { es: '0.51', lo: '0.31', hi: '0.71' },
      { es: '0.49', lo: '0.29', hi: '0.69' },
    ];
    const m = runMeta(studies, 'random');
    expect(suggestInconsistency(m).suggest).toBe('not_serious');
    expect(suggestImprecision(m, 'SMD').suggest).toBe('not_serious'); // CI excludes 0, k≥5
  });

  it('eggersTest returns null for k < 3 (publication bias stays not-serious)', () => {
    const eg = eggersTest([{ es: '0.5', lo: '0.3', hi: '0.7' }, { es: '0.6', lo: '0.4', hi: '0.8' }]);
    expect(eg).toBe(null);
    expect(suggestPublicationBias({ k: 2 }, eg).suggest).toBe('not_serious');
  });
});
