import { describe, it, expect } from 'vitest';
import { parseCell, snapToken } from '../../../src/research-engine/extraction/cellGrammar.js';

describe('cellGrammar.parseCell — discriminated ParsedCell (§13.1)', () => {
  it('INT: plain / thousands / unicode minus', () => {
    expect(parseCell('12')).toEqual({ kind: 'INT', value: 12, raw: '12' });
    expect(parseCell('1,024')).toEqual({ kind: 'INT', value: 1024, raw: '1,024' });
    expect(parseCell('−8')).toEqual({ kind: 'INT', value: -8, raw: '−8' });
  });

  it('FLOAT: decimals / leading-dot / negative / unicode minus / scientific', () => {
    expect(parseCell('2.24')).toEqual({ kind: 'FLOAT', value: 2.24, raw: '2.24' });
    expect(parseCell('.56')).toEqual({ kind: 'FLOAT', value: 0.56, raw: '.56' });
    expect(parseCell('−0.37')).toEqual({ kind: 'FLOAT', value: -0.37, raw: '−0.37' });
    expect(parseCell('1.2e3')).toEqual({ kind: 'FLOAT', value: 1200, raw: '1.2e3' });
  });

  it('PCT: compound keeps count AND percentage; bare keeps percentage', () => {
    expect(parseCell('12 (9.6%)')).toEqual({ kind: 'PCT', pct: 9.6, count: 12, raw: '12 (9.6%)' });
    expect(parseCell('12 [9.6%]')).toEqual({ kind: 'PCT', pct: 9.6, count: 12, raw: '12 [9.6%]' });
    expect(parseCell('9.6%')).toEqual({ kind: 'PCT', pct: 9.6, raw: '9.6%' });
  });

  it('N_OF_N: slash and word form', () => {
    expect(parseCell('64/125')).toEqual({ kind: 'N_OF_N', numerator: 64, denominator: 125, raw: '64/125' });
    expect(parseCell('64 of 125')).toEqual({ kind: 'N_OF_N', numerator: 64, denominator: 125, raw: '64 of 125' });
  });

  it('MEAN_SD: plus-minus and ASCII +/-', () => {
    expect(parseCell('15.7 ± 2.1')).toEqual({ kind: 'MEAN_SD', mean: 15.7, sd: 2.1, raw: '15.7 ± 2.1' });
    expect(parseCell('15.7 +/- 2.1')).toEqual({ kind: 'MEAN_SD', mean: 15.7, sd: 2.1, raw: '15.7 +/- 2.1' });
  });

  it('CI: dash / em-dash / to / bracketed / comma — bounds never reordered', () => {
    expect(parseCell('1.40-3.57')).toMatchObject({ kind: 'CI', low: 1.40, high: 3.57 });
    expect(parseCell('1.40—3.57')).toMatchObject({ kind: 'CI', low: 1.40, high: 3.57 });
    expect(parseCell('(1.40 to 3.57)')).toMatchObject({ kind: 'CI', low: 1.40, high: 3.57 });
    expect(parseCell('[1.40, 3.57]')).toMatchObject({ kind: 'CI', low: 1.40, high: 3.57 });
    // negative bounds
    expect(parseCell('-0.5 to 1.2')).toMatchObject({ kind: 'CI', low: -0.5, high: 1.2 });
  });

  it('CI: reversed bounds are PRESERVED with a warning, never silently swapped', () => {
    const c = parseCell('3.57-1.40');
    expect(c.kind).toBe('CI');
    expect(c.low).toBe(3.57);
    expect(c.high).toBe(1.40);
    expect(c.warning).toBeTruthy();
  });

  it('P: inequality preserved for every operator spelling', () => {
    expect(parseCell('<0.001')).toEqual({ kind: 'P', operator: '<', value: 0.001, raw: '<0.001' });
    expect(parseCell('p<0.001')).toMatchObject({ kind: 'P', operator: '<', value: 0.001 });
    expect(parseCell('P = 0.03')).toMatchObject({ kind: 'P', operator: '=', value: 0.03 });
    expect(parseCell('≤0.05')).toMatchObject({ kind: 'P', operator: '≤', value: 0.05 });
    expect(parseCell('>0.10')).toMatchObject({ kind: 'P', operator: '>', value: 0.10 });
  });

  it('MISSING: markers and lone dash (not a minus sign)', () => {
    expect(parseCell('NR')).toMatchObject({ kind: 'MISSING' });
    expect(parseCell('N/A')).toMatchObject({ kind: 'MISSING' });
    expect(parseCell('not reported')).toMatchObject({ kind: 'MISSING' });
    expect(parseCell('—')).toMatchObject({ kind: 'MISSING' });
    expect(parseCell('-')).toMatchObject({ kind: 'MISSING' });
    // a real negative number is NOT missing
    expect(parseCell('-3').kind).toBe('INT');
  });

  it('EFFECT_CI: an estimate with a parenthetical CI is one composite cell', () => {
    expect(parseCell('2.24 (1.40-3.57)')).toMatchObject({ kind: 'EFFECT_CI', est: 2.24, low: 1.40, high: 3.57 });
    expect(parseCell('1.05 (95% CI 0.89 to 1.24)')).toMatchObject({ kind: 'EFFECT_CI', est: 1.05, low: 0.89, high: 1.24 });
    // comma-separated bounds — the common journal form (Fable recs round)
    expect(parseCell('1.05 (0.89, 1.24)')).toMatchObject({ kind: 'EFFECT_CI', est: 1.05, low: 0.89, high: 1.24 });
  });

  it('EFFECT_CI never fabricates a CI from a thousands-grouped parenthetical count (Fable recs round)', () => {
    // "64 (1,240)" is a count-with-total cell — the comma has no space, so it must NOT
    // become est 64 with CI [1, 240].
    const c = parseCell('64 (1,240)');
    if (c) expect(c.kind).not.toBe('EFFECT_CI');
  });

  it('a bracketed thousands integer is NOT a CI (regression F21)', () => {
    // "(1,240)" must not read as {low:1, high:240}
    const c = parseCell('(1,240)');
    if (c) expect(c.kind).not.toBe('CI');
    // a genuine space-separated bracketed pair still parses as CI
    expect(parseCell('(1.40, 3.57)')).toMatchObject({ kind: 'CI', low: 1.40, high: 3.57 });
  });

  it('P false positives rejected (regression F22): "p2" and "=64" are not p-values', () => {
    expect(parseCell('p2')).not.toMatchObject({ kind: 'P' });
    const eq = parseCell('=64');
    if (eq) expect(eq.kind).not.toBe('P');
  });

  it('null / non-string / unparseable → null, never throws', () => {
    expect(parseCell(null)).toBeNull();
    expect(parseCell(undefined)).toBeNull();
    expect(parseCell('')).toBeNull();
    expect(parseCell('   ')).toBeNull();
    expect(parseCell('SIRS')).toBeNull();
    expect(parseCell('2.24 (extra words)')).toBeNull();
    expect(() => parseCell({})).not.toThrow();
    expect(() => parseCell([1, 2])).not.toThrow();
    expect(() => parseCell(NaN)).not.toThrow();
  });

  it('property: never throws and preserves raw across pathological inputs', () => {
    const inputs = ['', ' ', 'abc', '1..2', '((', '12/', '/12', '±', '%', '1e', 'p', '<', '1,2,3', '  5 '];
    for (const s of inputs) {
      expect(() => parseCell(s)).not.toThrow();
      const r = parseCell(s);
      if (r) expect(r.raw).toBe(s);
    }
  });

  it('NBSP inside numbers is tolerated', () => {
    expect(parseCell('1 024')).toBeNull(); // space-separated is ambiguous → not a number
    expect(parseCell(' 12 ')).toEqual({ kind: 'INT', value: 12, raw: ' 12 ' });
  });
});

describe('cellGrammar.snapToken — click-assign (§13.3)', () => {
  it('clicking a bare number returns that number', () => {
    const t = snapToken('2.24', 1);
    expect(t).toMatchObject({ kind: 'number', value: 2.24 });
  });

  it('selecting an effect + CI returns the composite', () => {
    const s = '2.24 (1.40-3.57)';
    const t = snapToken(s, 0, { start: 0, end: s.length });
    expect(t.kind).toBe('ratioCI');
    expect(t.est).toBe(2.24);
    expect(t.lo).toBe(1.40);
    expect(t.hi).toBe(3.57);
  });

  it('clicking inside "n=64" snaps to the NUMBER 64, not a p-value (regression F19)', () => {
    const t = snapToken('n=64', 3);
    expect(t).toMatchObject({ value: 64 });
    expect(t.kind).toBe('number'); // '=' after 'n' must NOT upgrade to a p-value
  });

  it('"OR=1.05" and "age > 65" keep their numeric kind, not p (regression F19)', () => {
    expect(snapToken('OR=1.05', 4).kind).toBe('number');
    expect(snapToken('age > 65', 7).kind).toBe('number');
  });

  it('thousands separators: 1,024 → 1024', () => {
    const t = snapToken('1,024', 2);
    expect(t.value).toBe(1024);
  });

  it('percentage semantics preserved', () => {
    const t = snapToken('12.5%', 2);
    expect(t.kind).toBe('percent');
    expect(t.value).toBe(12.5);
  });

  it('<0.001 retains the operator as a P token', () => {
    const t = snapToken('<0.001', 3);
    expect(t.kind).toBe('p');
    expect(t.pOperator).toBe('<');
    expect(t.value).toBe(0.001);
  });

  it('clicking just left of a token snaps to the nearest token', () => {
    const s = 'HR (2.24)';
    // click on the '(' at index 3
    const t = snapToken(s, 3);
    expect(t).toBeTruthy();
    expect(t.value).toBe(2.24);
  });

  it('empty / non-numeric returns null (no invented token)', () => {
    expect(snapToken('', 0)).toBeNull();
    expect(snapToken('mortality', 3)).toBeNull();
    expect(snapToken('2.24', -5)).toBeNull();
  });
});
