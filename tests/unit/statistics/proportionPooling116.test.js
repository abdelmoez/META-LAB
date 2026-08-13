/**
 * proportionPooling116.test.js — 116.md §41/§46/§123/§133 (proportion outcome
 * regression repair: derive-at-the-analysis-boundary).
 *
 * WHAT IS PINNED:
 *  1. `poolableStudyView` derives es/lo/hi for a PROP row with valid raw events/total
 *     and NO stored es — using EXACTLY the numbers the ✓ Complete backfill
 *     (deriveEffectSizeFromRaw → calcES('PROP') logit) produces, including the
 *     0/all-event continuity correction and the 6-dp rounding (§123 parity).
 *  2. A stored numeric es always wins; invalid/missing raw data derives nothing;
 *     non-PROP measures are untouched (D1 scope).
 *  3. The derived values are a COMPUTED VIEW — the stored row object is never mutated.
 *  4. runMeta / checkPoolability / eggersTest / leaveOneOut / trimFill /
 *     influenceDiagnostics all pool the same derived views (no surface drift), in
 *     BOTH validator copies (monolithStats + validation/study-validator, 107 inv 13.9).
 *  5. §133 regression: adding/editing denominatorPopulation/actionStatus on a row
 *     with valid events/total changes NEITHER analyzability NOR the pooled numbers.
 *  6. Byte-stability: withPoolableViews returns the SAME array when nothing derives.
 */
import { describe, it, expect } from 'vitest';
import {
  runMeta, checkPoolability, eggersTest, leaveOneOut, trimFill, influenceDiagnostics,
  poolableStudyView, withPoolableViews, hasUsableEffect, calcES,
} from '../../../src/research-engine/statistics/monolithStats.js';
import { checkPoolability as checkPoolabilityValidatorCopy } from '../../../src/research-engine/validation/study-validator.js';
import { runMeta as runMetaEngineCopy } from '../../../src/research-engine/statistics/meta-analysis.js';
import { deriveEffectSizeFromRaw } from '../../../src/research-engine/extraction/deriveEffectSize.js';
import { getOutcomePairs, filterStudiesForOutcome } from '../../../src/research-engine/import-export/journalSubmission.js';
import { buildPubForestSVG } from '../../../src/frontend/workspace/charts/svgBuilders.js';

/** A raw-data PROP row exactly as extraction leaves it: events/total, NO es/lo/hi. */
const raw = (over = {}) => ({
  id: 'r1', author: 'Smith', year: '2024', outcome: 'Diagnostic yield', timepoint: '',
  esType: 'PROP', events: '18', total: '100', es: '', lo: '', hi: '',
  denominatorPopulation: '', denominatorCustom: '', actionStatus: '', ...over,
});

describe('poolableStudyView — the §41 derivation', () => {
  it('derives es/lo/hi for a valid raw PROP row, marked as a view', () => {
    const v = poolableStudyView(raw());
    expect(v._derivedEs).toBe(true);
    expect(v.es).not.toBe('');
    expect(isNaN(+v.es) || isNaN(+v.lo) || isNaN(+v.hi)).toBe(false);
  });

  it('produces EXACTLY the ✓ Complete backfill numbers (deriveEffectSizeFromRaw parity, §123)', () => {
    for (const [events, total] of [['18', '100'], ['0', '59'], ['59', '59'], ['1', '2'], ['23', '59']]) {
      const row = raw({ events, total });
      const v = poolableStudyView(row);
      const d = deriveEffectSizeFromRaw(row);
      expect(d).not.toBeNull();
      expect([v.es, v.lo, v.hi]).toEqual([d.es, d.lo, d.hi]);
    }
  });

  it('reuses calcES("PROP") zero/all-event continuity handling (0.5 / +1 correction)', () => {
    const v = poolableStudyView(raw({ events: '0', total: '59' }));
    const r = calcES('PROP', { events: '0', total: '59' });
    expect(+v.es).toBeCloseTo(r.es, 6);
    expect(Number.isFinite(+v.es)).toBe(true);   // the correction keeps the logit finite
  });

  it('a stored numeric es always wins — the SAME object reference comes back', () => {
    const stored = raw({ es: '-0.43', lo: '-1.01', hi: '0.15' });
    expect(poolableStudyView(stored)).toBe(stored);
    // even a stored es with a blank CI is never shadowed by a raw derivation
    const esOnly = raw({ es: '-0.43' });
    expect(poolableStudyView(esOnly)).toBe(esOnly);
  });

  it('derives nothing for missing/invalid raw data or non-PROP measures', () => {
    expect(poolableStudyView(raw({ events: '' }))).toEqual(raw({ events: '' }));
    expect(poolableStudyView(raw({ total: '' }))).toEqual(raw({ total: '' }));
    expect(poolableStudyView(raw({ events: '120', total: '100' }))._derivedEs).toBeUndefined();
    expect(poolableStudyView(raw({ total: '0' }))._derivedEs).toBeUndefined();
    expect(poolableStudyView(raw({ events: '-1' }))._derivedEs).toBeUndefined();
    const or = raw({ esType: 'OR', a: '5', b: '5', c: '5', d: '5' });
    expect(poolableStudyView(or)).toBe(or);      // D1 scope: PROP only
  });

  it('never mutates the stored row (computed view, no write-back)', () => {
    const row = raw();
    const before = JSON.stringify(row);
    poolableStudyView(row);
    runMeta([row, raw({ id: 'r2', events: '25', total: '90' })], 'random');
    expect(JSON.stringify(row)).toBe(before);
  });

  it('withPoolableViews is byte-stable when nothing derives', () => {
    const rows = [raw({ es: '-0.4', lo: '-1', hi: '0.2' }), raw({ id: 'b', es: '0.1', lo: '-0.5', hi: '0.7' })];
    expect(withPoolableViews(rows)).toBe(rows);
    const mixed = rows.concat([raw({ id: 'c' })]);
    expect(withPoolableViews(mixed)).not.toBe(mixed);
    expect(withPoolableViews(mixed)[2]._derivedEs).toBe(true);
  });

  it('hasUsableEffect mirrors the enumerator predicate through the view', () => {
    expect(hasUsableEffect(raw())).toBe(true);
    expect(hasUsableEffect(raw({ events: '' }))).toBe(false);
    expect(hasUsableEffect(raw({ events: '120', total: '100' }))).toBe(false);
    expect(hasUsableEffect(raw({ es: '0.5' }))).toBe(true);
    expect(hasUsableEffect(null)).toBe(false);
  });
});

describe('every pooling surface derives at the boundary (§46 — no drift)', () => {
  const rows = [
    raw({ id: '1', events: '18', total: '100' }),
    raw({ id: '2', author: 'Jones', events: '25', total: '90' }),
    raw({ id: '3', author: 'Lee', events: '10', total: '80' }),
  ];

  it('runMeta pools raw-only PROP rows', () => {
    const r = runMeta(rows, 'random');
    expect(r).not.toBeNull();
    expect(r.k).toBe(3);
    // the pooled logit back-transforms to a plausible proportion (0 < p < 1)
    const p = Math.exp(r.pES) / (1 + Math.exp(r.pES));
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('pooled numbers are IDENTICAL to pooling the manually backfilled equivalents', () => {
    const backfilled = rows.map((s) => {
      const d = deriveEffectSizeFromRaw(s);
      return { ...s, es: d.es, lo: d.lo, hi: d.hi };
    });
    const a = runMeta(rows, 'random');
    const b = runMeta(backfilled, 'random');
    expect(a.pES).toBe(b.pES);
    expect(a.lo95).toBe(b.lo95);
    expect(a.hi95).toBe(b.hi95);
    expect(a.I2).toBe(b.I2);
  });

  it('checkPoolability (BOTH copies), Egger, leave-one-out, trim-and-fill, influence all see the pool', () => {
    expect(checkPoolability(rows).ok).toBe(true);
    expect(checkPoolability(rows).valid).toHaveLength(3);
    expect(checkPoolabilityValidatorCopy(rows).ok).toBe(true);
    expect(checkPoolabilityValidatorCopy(rows).valid).toHaveLength(3);
    expect(eggersTest(rows)).not.toBeNull();
    expect(leaveOneOut(rows, 'random')).toHaveLength(3);
    expect(trimFill(rows, 'random')).not.toBeNull();
    expect(influenceDiagnostics(rows, 'random')).toHaveLength(3);
  });

  it('journalSubmission enumerator/filter (summaryPool, journal ZIP) see the pair too', () => {
    const pairs = getOutcomePairs(rows);
    expect(pairs.map((p) => p.key)).toEqual(['Diagnostic yield|||']);
    const subset = filterStudiesForOutcome(rows, pairs[0]);
    expect(subset).toHaveLength(3);
    expect(subset.every((s) => s.es !== '' && !isNaN(+s.es))).toBe(true);
  });

  it('the SECOND engine copy (manuscript/server: statistics/meta-analysis.js) pools identically', () => {
    const a = runMeta(rows, 'random');
    const b = runMetaEngineCopy(rows, 'random');
    expect(b).not.toBeNull();
    expect(b.k).toBe(a.k);
    expect(b.pES).toBe(a.pES);
    expect(b.lo95).toBe(a.lo95);
    expect(b.hi95).toBe(a.hi95);
  });

  it('the publication forest-figure builder produces a figure from the raw-only pool (§46)', () => {
    const result = runMeta(rows, 'random');
    const built = buildPubForestSVG(result, { esType: 'PROP', esLabel: 'logit', nullLine: 0, showCounts: true, showWeights: true, title: 'Diagnostic yield' });
    expect(built).toBeTruthy();
    expect(built.svg).toContain('<svg');
  });
});

/* ══════════════ 116.md §133 — the explicit regression pack (engine level) ══════════════ */

describe('116.md §133 — metadata edits never change analyzability or pooled numbers', () => {
  const base = [
    raw({ id: '1', events: '18', total: '100' }),
    raw({ id: '2', author: 'Jones', events: '25', total: '90' }),
  ];
  const baseline = runMeta(base, 'random');

  const classifyOne = (rows, patch) => rows.map((s, i) => (i === 0 ? { ...s, ...patch } : s));

  it('adding a denominatorPopulation to one row keeps the pool (real + unclassified = warn tier)', () => {
    const edited = classifyOne(base, { denominatorPopulation: 'all_patients_tested' });
    const r = runMeta(edited, 'random');
    expect(r).not.toBeNull();
    expect(r.k).toBe(baseline.k);
    expect(r.pES).toBe(baseline.pES);
    expect(r.lo95).toBe(baseline.lo95);
  });

  it('adding an actionStatus to one row keeps the pool', () => {
    const edited = classifyOne(base, { actionStatus: 'implemented' });
    const r = runMeta(edited, 'random');
    expect(r).not.toBeNull();
    expect(r.pES).toBe(baseline.pES);
  });

  it('classifying EVERY row identically keeps the pool', () => {
    const edited = base.map((s) => ({ ...s, denominatorPopulation: 'all_patients_tested', actionStatus: 'implemented' }));
    const r = runMeta(edited, 'random');
    expect(r).not.toBeNull();
    expect(r.pES).toBe(baseline.pES);
    expect(r.hi95).toBe(baseline.hi95);
  });

  it('editing a classification back and forth is a no-op for the numbers', () => {
    const a = classifyOne(base, { denominatorPopulation: 'all_patients_tested' });
    const b = classifyOne(a, { denominatorPopulation: 'plp_molecular_diagnoses' });
    const c = classifyOne(b, { denominatorPopulation: '' });
    for (const rows of [a, b, c]) {
      const r = runMeta(rows, 'random');
      expect(r).not.toBeNull();
      expect(r.pES).toBe(baseline.pES);
    }
  });

  it('the Other/custom missing-description case no longer blocks anything (C3)', () => {
    const edited = classifyOne(base, { denominatorPopulation: 'other', denominatorCustom: '' });
    expect(runMeta(edited, 'random')).not.toBeNull();
    expect(checkPoolability(edited).ok).toBe(true);
  });
});
