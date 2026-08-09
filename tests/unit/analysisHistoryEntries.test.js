/**
 * analysisHistoryEntries.test.js — 108.md §6/§14. The analysis-builder's four
 * undoable configuration writes, exercised through the pure read/apply/compare
 * helpers the `analysis.config` executor is built from.
 *
 * These are the executor's entire decision surface: what the current value IS
 * (`readAnalysisConfig`), whether it still matches what the entry expects
 * (`analysisConfigMatches` — the §14/§15 refusal), and what applying the op does
 * (`applyAnalysisConfig`). Testing them directly is what lets the SSR house style
 * cover an asynchronous, server-backed undo without a DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  ANALYSIS_CONFIG_TARGETS, readAnalysisConfig, applyAnalysisConfig,
  analysisConfigMatches, analysisConfigLabel, analysisConfigKey,
  writeProportionFilter, writeProportionOverride,
} from '../../src/frontend/workspace/tabs/analysisTabs.jsx';
import { buildProportionOverride } from '../../src/research-engine/statistics/proportionCompatibility.js';

const T = ANALYSIS_CONFIG_TARGETS;
const KEY = 'Diagnostic yield|||';
const blank = () => ({ id: 'p1', name: 'Review', studies: [] });

describe('tau2Method — the persisted estimator plus its local mirror', () => {
  const addr = { target: T.TAU2 };

  it('reads null when nothing is persisted', () => {
    expect(readAnalysisConfig(blank(), addr)).toBeNull();
    expect(readAnalysisConfig(null, addr)).toBeNull();
  });

  it('round-trips set → undo → redo', () => {
    const p0 = blank();
    const set = applyAnalysisConfig(p0, { ...addr, value: 'REML' });
    expect(readAnalysisConfig(set, addr)).toBe('REML');
    const undone = applyAnalysisConfig(set, { ...addr, value: null });
    expect(readAnalysisConfig(undone, addr)).toBeNull();
    const redone = applyAnalysisConfig(undone, { ...addr, value: 'REML' });
    expect(readAnalysisConfig(redone, addr)).toBe('REML');
  });

  it('restores ABSENCE as absence — an unused container is deleted, not emptied', () => {
    const set = applyAnalysisConfig(blank(), { ...addr, value: 'PM' });
    const undone = applyAnalysisConfig(set, { ...addr, value: null });
    expect('analysisSettings' in undone).toBe(false);
  });

  it('keeps a sibling analysisSettings key when the estimator is undone', () => {
    const withFilter = writeProportionFilter(blank(), KEY, 'denominatorPopulation', 'all_patients_tested');
    const set = applyAnalysisConfig(withFilter, { ...addr, value: 'REML' });
    const undone = applyAnalysisConfig(set, { ...addr, value: null });
    expect(undone.analysisSettings.proportionFilters[KEY].denominatorPopulation).toBe('all_patients_tested');
    expect(undone.analysisSettings.tau2Method).toBeUndefined();
  });

  it('carries the localTau2 mirror on the op so the select cannot desync', () => {
    // The control reads the persisted value and falls back to the local mirror, so
    // an undo that restores "absent" must restore the mirror too.
    const undoOp = { ...addr, value: null, localTau2: 'DL', expect: 'REML' };
    expect(undoOp.localTau2).toBe('DL');
    const set = applyAnalysisConfig(blank(), { ...addr, value: 'REML' });
    expect(analysisConfigMatches(set, undoOp)).toBe(true);
  });

  it('refuses when a collaborator already moved the estimator (§14)', () => {
    const moved = applyAnalysisConfig(blank(), { ...addr, value: 'PM' });
    expect(analysisConfigMatches(moved, { ...addr, value: null, expect: 'REML' })).toBe(false);
  });
});

describe('analysisPrecision — whole-object inverse', () => {
  const addr = { target: T.PRECISION };

  it('round-trips a decimals change and restores absence as absence', () => {
    const p0 = blank();
    expect(readAnalysisConfig(p0, addr)).toBeNull();
    const set = applyAnalysisConfig(p0, { ...addr, value: { decimals: 3, trailingZeros: true } });
    expect(set.analysisPrecision).toEqual({ decimals: 3, trailingZeros: true });
    const undone = applyAnalysisConfig(set, { ...addr, value: null });
    expect('analysisPrecision' in undone).toBe(false);
  });

  it('round-trips between two explicit settings', () => {
    const a = applyAnalysisConfig(blank(), { ...addr, value: { decimals: 2, trailingZeros: false } });
    const b = applyAnalysisConfig(a, { ...addr, value: { decimals: 4, trailingZeros: true } });
    expect(analysisConfigMatches(b, { ...addr, expect: { decimals: 4, trailingZeros: true } })).toBe(true);
    const back = applyAnalysisConfig(b, { ...addr, value: { decimals: 2, trailingZeros: false } });
    expect(back.analysisPrecision).toEqual({ decimals: 2, trailingZeros: false });
  });

  it('copies the value rather than aliasing the entry op', () => {
    const op = { ...addr, value: { decimals: 3, trailingZeros: false } };
    const set = applyAnalysisConfig(blank(), op);
    set.analysisPrecision.decimals = 9;
    expect(op.value.decimals).toBe(3);           // the entry must stay replayable
  });
});

describe('proportionFilters — set and clear (107.md §11)', () => {
  const addr = { target: T.PROP_FILTER, outcomeKey: KEY, field: 'denominatorPopulation' };

  it('round-trips set → undo → redo through the real pure writer', () => {
    const p0 = blank();
    expect(readAnalysisConfig(p0, addr)).toBeNull();
    const set = applyAnalysisConfig(p0, { ...addr, value: 'all_patients_tested' });
    expect(readAnalysisConfig(set, addr)).toBe('all_patients_tested');
    const undone = applyAnalysisConfig(set, { ...addr, value: null });
    expect(readAnalysisConfig(undone, addr)).toBeNull();
    // The 107 writer drops the `proportionFilters` map but leaves an EMPTY
    // `analysisSettings` behind — its pre-existing behaviour, identical to clearing
    // the filter by hand. The undo does not make that worse, and nothing reads it.
    expect(undone.analysisSettings).toEqual({});
    const redone = applyAnalysisConfig(undone, { ...addr, value: 'all_patients_tested' });
    expect(readAnalysisConfig(redone, addr)).toBe('all_patients_tested');
  });

  it('treats the empty string the writer deletes as "not set"', () => {
    const set = applyAnalysisConfig(blank(), { ...addr, value: 'p_lp_molecular' });
    const cleared = applyAnalysisConfig(set, { ...addr, value: '' });
    expect(readAnalysisConfig(cleared, addr)).toBeNull();
  });

  it('scopes to ONE (outcome, field) — a sibling filter survives the undo', () => {
    const other = { target: T.PROP_FILTER, outcomeKey: KEY, field: 'actionStatus' };
    let p = applyAnalysisConfig(blank(), { ...addr, value: 'all_patients_tested' });
    p = applyAnalysisConfig(p, { ...other, value: 'implemented' });
    const undone = applyAnalysisConfig(p, { ...addr, value: null });
    expect(readAnalysisConfig(undone, other)).toBe('implemented');
    expect(readAnalysisConfig(undone, addr)).toBeNull();
  });

  it('refuses when the filter no longer holds the expected value', () => {
    const p = applyAnalysisConfig(blank(), { ...addr, value: 'all_patients_tested' });
    expect(analysisConfigMatches(p, { ...addr, expect: 'all_patients_tested' })).toBe(true);
    expect(analysisConfigMatches(p, { ...addr, expect: 'p_lp_molecular' })).toBe(false);
    expect(analysisConfigMatches(blank(), { ...addr, expect: null })).toBe(true);
  });
});

describe('proportionOverrides — the documented consent record (107.md §12)', () => {
  const addr = { target: T.PROP_OVERRIDE, outcomeKey: KEY };
  const check = {
    compatible: false,
    categories: [{ id: 'denominatorPopulation', label: 'Denominator population', values: ['a', 'b'] }],
    signature: 'sig-1',
  };
  const record = () => buildProportionOverride(check, {
    at: '2026-03-03T00:00:00.000Z', by: 'Lee', note: 'clinically comparable',
  });

  it('round-trips record → undo → redo', () => {
    const rec = record();
    const set = applyAnalysisConfig(blank(), { ...addr, record: rec });
    expect(readAnalysisConfig(set, addr)).toEqual(rec);
    const undone = applyAnalysisConfig(set, { ...addr, record: null });
    expect(readAnalysisConfig(undone, addr)).toBeNull();
    expect(undone.analysisSettings).toEqual({});   // same 107-writer behaviour as above
    const redone = applyAnalysisConfig(undone, { ...addr, record: rec });
    expect(readAnalysisConfig(redone, addr)).toEqual(rec);
  });

  it('a REDO restores the ORIGINAL at/by rather than minting fresh consent', () => {
    // Deliberate (documented in applyAnalysisConfig): redo restores the state the
    // user just undid; it must not fabricate a new act of consent. The stale-
    // signature logic still decides whether the restored record is honoured.
    const rec = record();
    const set = applyAnalysisConfig(blank(), { ...addr, record: rec });
    const undone = applyAnalysisConfig(set, { ...addr, record: null });
    const redone = applyAnalysisConfig(undone, { ...addr, record: rec });
    expect(readAnalysisConfig(redone, addr).at).toBe('2026-03-03T00:00:00.000Z');
    expect(readAnalysisConfig(redone, addr).by).toBe('Lee');
    expect(readAnalysisConfig(redone, addr).signature).toBe(rec.signature);
  });

  it('matches on the whole record and refuses once it changed', () => {
    const rec = record();
    const set = applyAnalysisConfig(blank(), { ...addr, record: rec });
    expect(analysisConfigMatches(set, { ...addr, expect: rec })).toBe(true);
    const other = buildProportionOverride(check, { at: '2026-04-04T00:00:00.000Z', by: 'Kim', note: 'x' });
    expect(analysisConfigMatches(set, { ...addr, expect: other })).toBe(false);
    expect(analysisConfigMatches(set, { ...addr, expect: null })).toBe(false);
  });

  it('leaves an override on ANOTHER outcome alone', () => {
    const rec = record();
    let p = applyAnalysisConfig(blank(), { ...addr, record: rec });
    p = applyAnalysisConfig(p, { target: T.PROP_OVERRIDE, outcomeKey: 'Other|||', record: rec });
    const undone = applyAnalysisConfig(p, { ...addr, record: null });
    expect(readAnalysisConfig(undone, { target: T.PROP_OVERRIDE, outcomeKey: 'Other|||' })).toEqual(rec);
  });
});

describe('the pure writers stay the SAME ones the forward actions use', () => {
  it('applyAnalysisConfig(proportionFilter) === writeProportionFilter', () => {
    const a = applyAnalysisConfig(blank(), { target: T.PROP_FILTER, outcomeKey: KEY, field: 'actionStatus', value: 'planned' });
    const b = writeProportionFilter(blank(), KEY, 'actionStatus', 'planned');
    expect(a).toEqual(b);
  });

  it('applyAnalysisConfig(proportionOverride) === writeProportionOverride', () => {
    const rec = { at: 'x', by: null, note: '', signature: 's' };
    expect(applyAnalysisConfig(blank(), { target: T.PROP_OVERRIDE, outcomeKey: KEY, record: rec }))
      .toEqual(writeProportionOverride(blank(), KEY, rec));
  });
});

describe('entry metadata', () => {
  it('labels read as "<label> undone" in the §17 snackbar', () => {
    expect(analysisConfigLabel({ target: T.TAU2 })).toBe('τ² estimator change');
    expect(analysisConfigLabel({ target: T.PRECISION })).toBe('Decimal places change');
    expect(analysisConfigLabel({ target: T.PROP_FILTER })).toBe('Proportion filter change');
    expect(analysisConfigLabel({ target: T.PROP_OVERRIDE })).toBe('Compatibility override change');
    expect(analysisConfigLabel({})).toBe('Analysis setting change');
  });

  it('keys one logical setting per outcome/field', () => {
    expect(analysisConfigKey({ target: T.TAU2 })).toBe('tau2Method');
    expect(analysisConfigKey({ target: T.PROP_FILTER, outcomeKey: KEY, field: 'actionStatus' }))
      .toBe(`proportionFilter:${KEY}:actionStatus`);
    expect(analysisConfigKey({ target: T.PROP_OVERRIDE, outcomeKey: KEY })).toBe(`proportionOverride:${KEY}`);
    expect(analysisConfigKey(null)).toBe('');
  });

  it('an unknown target is inert rather than destructive', () => {
    const p = blank();
    expect(applyAnalysisConfig(p, { target: 'nope' })).toBe(p);
    expect(readAnalysisConfig(p, { target: 'nope' })).toBeNull();
    expect(analysisConfigMatches(p, null)).toBe(false);
  });
});
