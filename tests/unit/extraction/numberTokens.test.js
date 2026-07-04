import { describe, it, expect } from 'vitest';
import {
  snapNumberToken,
  findNumberTokens,
  parseNumberList,
} from '../../../src/research-engine/extraction/numberTokens.js';

// Unicode separators referenced by name to keep the source ASCII-safe.
const EN = '–'; // –
const EM = '—'; // —
const MINUS = '−'; // −
const PM = '±'; // ±

/** Click every character index across [start,end) of `sub` inside `s` and assert
 *  the snap result is stable. Returns the (single) token for further assertions. */
function snapAcross(s, sub) {
  const start = s.indexOf(sub);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = start + sub.length;
  const tokens = [];
  for (let i = start; i < end; i++) tokens.push(snapNumberToken(s, i));
  for (const t of tokens) expect(t).toEqual(tokens[0]);
  return tokens[0];
}

describe('snapNumberToken — kind: number', () => {
  it('snaps a plain integer from any offset within it', () => {
    const s = 'total 42 events';
    const t = snapAcross(s, '42');
    expect(t).toMatchObject({ text: '42', kind: 'number', value: 42 });
    expect(s.slice(t.start, t.end)).toBe('42');
  });

  it('snaps a decimal, never a fragment', () => {
    const s = 'HR was 12.34 overall';
    const t = snapAcross(s, '12.34');
    expect(t).toMatchObject({ kind: 'number', value: 12.34, text: '12.34' });
  });

  it('keeps thousands commas in text but strips them in value', () => {
    const s = 'n = 1,234 patients';
    const t = snapAcross(s, '1,234');
    expect(t.text).toBe('1,234');
    expect(t.value).toBe(1234);
  });

  it('handles 1,234.56 as one token', () => {
    const t = snapAcross('x 1,234.56 y', '1,234.56');
    expect(t).toMatchObject({ kind: 'number', text: '1,234.56', value: 1234.56 });
  });

  it('captures a leading negative sign', () => {
    const t = snapAcross('delta -3.5 units', '-3.5');
    expect(t).toMatchObject({ kind: 'number', value: -3.5, text: '-3.5' });
    // clicking the sign character itself also returns the whole token
    const at = 'delta -3.5 units'.indexOf('-3.5');
    expect(snapNumberToken('delta -3.5 units', at)).toEqual(t);
  });

  it('captures a leading plus sign', () => {
    const t = snapAcross('change +1.5 mm', '+1.5');
    expect(t).toMatchObject({ kind: 'number', value: 1.5, text: '+1.5' });
  });

  it('reads a unicode-minus number', () => {
    const s = 'beta ' + MINUS + '0.42 se';
    const t = snapAcross(s, MINUS + '0.42');
    expect(t.kind).toBe('number');
    expect(t.value).toBe(-0.42);
  });
});

describe('snapNumberToken — kind: percent', () => {
  it('snaps a percent including the % sign', () => {
    const s = 'response 12.3% at week 4';
    const t = snapAcross(s, '12.3%');
    expect(t).toMatchObject({ kind: 'percent', value: 12.3, text: '12.3%' });
  });

  it('percent beats the bare number when clicking the digits', () => {
    const s = 'rate 45% total';
    const at = s.indexOf('45');
    const t = snapNumberToken(s, at);
    expect(t.kind).toBe('percent');
    expect(t.value).toBe(45);
  });

  it('clicking the % char returns the percent token', () => {
    const s = 'rate 45% total';
    const at = s.indexOf('%');
    expect(snapNumberToken(s, at)).toMatchObject({ kind: 'percent', value: 45 });
  });
});

describe('snapNumberToken — kind: range', () => {
  it('en-dash range', () => {
    const s = 'CI 1.05' + EN + '2.67 wide';
    const t = snapAcross(s, '1.05' + EN + '2.67');
    expect(t).toMatchObject({ kind: 'range', lo: 1.05, hi: 2.67 });
  });

  it('em-dash range', () => {
    const s = 'span 3' + EM + '9';
    const t = snapAcross(s, '3' + EM + '9');
    expect(t).toMatchObject({ kind: 'range', lo: 3, hi: 9 });
  });

  it('hyphen range', () => {
    const t = snapAcross('bounds 10-20 mm', '10-20');
    expect(t).toMatchObject({ kind: 'range', lo: 10, hi: 20 });
  });

  it('"to" range', () => {
    const s = 'from 0.95 to 1.08 overall';
    const t = snapAcross(s, '0.95 to 1.08');
    expect(t).toMatchObject({ kind: 'range', lo: 0.95, hi: 1.08 });
  });

  it('clicking the bare low bound inside a plain range returns the RANGE', () => {
    const s = 'from 0.95 to 1.08 overall';
    const at = s.indexOf('0.95');
    expect(snapNumberToken(s, at)).toMatchObject({ kind: 'range', lo: 0.95, hi: 1.08 });
  });

  it('unicode-minus negative range', () => {
    const s = 'diff ' + MINUS + '0.5' + EN + '1.2';
    const t = snapAcross(s, MINUS + '0.5' + EN + '1.2');
    expect(t).toMatchObject({ kind: 'range', lo: -0.5, hi: 1.2 });
  });

  it('does NOT read a decimal as a range', () => {
    const t = snapAcross('value 1.05 alone', '1.05');
    expect(t.kind).toBe('number');
    expect(t.value).toBe(1.05);
  });

  it('drops the ambiguous unspaced negative-hyphen range, falling back to numbers', () => {
    const s = 'x -0.5-1.2 y';
    const tokens = findNumberTokens(s);
    // no range token; the ambiguous form yields plain numbers instead
    expect(tokens.some((t) => t.kind === 'range')).toBe(false);
    const at = s.indexOf('-0.5');
    expect(snapNumberToken(s, at).kind).toBe('number');
  });
});

describe('snapNumberToken — kind: ratioCI', () => {
  it('full "1.05 (95% CI 0.89–1.24)" triplet from any interior offset', () => {
    const s = 'aHR 1.05 (95% CI 0.89' + EN + '1.24) p<.05';
    const t = snapAcross(s, '1.05 (95% CI 0.89' + EN + '1.24)');
    expect(t).toMatchObject({ kind: 'ratioCI', est: 1.05, lo: 0.89, hi: 1.24 });
  });

  it('parenthesised CI without a label: "1.05 (0.89-1.24)"', () => {
    const s = 'OR 1.05 (0.89-1.24) adj';
    const t = snapAcross(s, '1.05 (0.89-1.24)');
    expect(t).toMatchObject({ kind: 'ratioCI', est: 1.05, lo: 0.89, hi: 1.24 });
  });

  it('clicking the est, the "95", or a bound all return the ratioCI', () => {
    const s = '1.05 (95% CI 0.89' + EN + '1.24)';
    for (const sub of ['1.05', '95', '0.89', '1.24']) {
      const at = s.indexOf(sub);
      expect(snapNumberToken(s, at)).toMatchObject({ kind: 'ratioCI', est: 1.05, lo: 0.89, hi: 1.24 });
    }
  });
});

describe('snapNumberToken — kind: pair', () => {
  it('events/total "12/34"', () => {
    const s = 'events 12/34 in arm A';
    const t = snapAcross(s, '12/34');
    expect(t).toMatchObject({ kind: 'pair', a: 12, b: 34 });
  });

  it('rejects a date chain "05/12/2020"', () => {
    const s = 'on 05/12/2020 baseline';
    const tokens = findNumberTokens(s);
    expect(tokens.some((t) => t.kind === 'pair')).toBe(false);
  });

  it('rejects "12/45.6" (decimal continuation)', () => {
    const s = 'ratio 12/45.6 here';
    const tokens = findNumberTokens(s);
    expect(tokens.some((t) => t.kind === 'pair')).toBe(false);
  });
});

describe('snapNumberToken — kind: meanSd', () => {
  it('"5.2 ± 1.1" is meanSd, NOT a range', () => {
    const s = 'age 5.2 ' + PM + ' 1.1 years';
    const t = snapAcross(s, '5.2 ' + PM + ' 1.1');
    expect(t).toMatchObject({ kind: 'meanSd', a: 5.2, b: 1.1 });
    expect(t.kind).not.toBe('range');
  });

  it('ascii "12.3 +/- 4.5" form', () => {
    const s = 'value 12.3 +/- 4.5 sd';
    const t = snapAcross(s, '12.3 +/- 4.5');
    expect(t).toMatchObject({ kind: 'meanSd', a: 12.3, b: 4.5 });
  });

  it('negative mean "-0.5 ± 0.2"', () => {
    const s = 'z -0.5 ' + PM + ' 0.2';
    const t = snapAcross(s, '-0.5 ' + PM + ' 0.2');
    expect(t).toMatchObject({ kind: 'meanSd', a: -0.5, b: 0.2 });
  });
});

describe('snapNumberToken — offsets, whitespace, boundaries', () => {
  it('offset at the exact start, middle, and last char of a token agree', () => {
    const s = '  1.234  ';
    const start = s.indexOf('1.234');
    const last = start + '1.234'.length - 1;
    const mid = start + 2;
    const a = snapNumberToken(s, start);
    const b = snapNumberToken(s, mid);
    const c = snapNumberToken(s, last);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a).toMatchObject({ value: 1.234, start, end: start + 5 });
  });

  it('clicking whitespace returns null', () => {
    const s = 'ab 42 cd';
    const wsBefore = s.indexOf('42') - 1; // the space before
    const wsAfter = s.indexOf('42') + 2; // the space after
    expect(snapNumberToken(s, wsBefore)).toBeNull();
    expect(snapNumberToken(s, wsAfter)).toBeNull();
  });

  it('clicking a non-numeric letter returns null', () => {
    const s = 'abc 42';
    expect(snapNumberToken(s, 0)).toBeNull();
  });

  it('rejects out-of-range / non-integer / bad-type offsets', () => {
    const s = 'x 42';
    expect(snapNumberToken(s, -1)).toBeNull();
    expect(snapNumberToken(s, s.length)).toBeNull();
    expect(snapNumberToken(s, 999)).toBeNull();
    expect(snapNumberToken('', 0)).toBeNull();
    expect(snapNumberToken(null, 0)).toBeNull();
    expect(snapNumberToken(s, NaN)).toBeNull();
  });

  it('floors a fractional offset onto the containing character', () => {
    const s = 'v 3.14';
    const at = s.indexOf('3.14');
    expect(snapNumberToken(s, at + 0.7)).toMatchObject({ value: 3.14 });
  });
});

describe('findNumberTokens', () => {
  it('returns adjacent tokens left-to-right without overlap', () => {
    const s = 'a 12 and 34 then 56';
    const toks = findNumberTokens(s);
    expect(toks.map((t) => t.value)).toEqual([12, 34, 56]);
    // strictly increasing, non-overlapping spans
    for (let i = 1; i < toks.length; i++) {
      expect(toks[i].start).toBeGreaterThanOrEqual(toks[i - 1].end);
    }
  });

  it('a ratioCI suppresses the inner range, percent and numbers', () => {
    const s = 'HR 1.05 (95% CI 0.89' + EN + '1.24)';
    const toks = findNumberTokens(s);
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({ kind: 'ratioCI', est: 1.05, lo: 0.89, hi: 1.24 });
  });

  it('a plain range suppresses its two inner numbers', () => {
    const toks = findNumberTokens('span 3.0 to 9.0 units');
    const kinds = toks.map((t) => t.kind);
    expect(kinds).toContain('range');
    expect(kinds).not.toContain('number');
  });

  it('mixed kinds coexist when they do not overlap', () => {
    const s = 'n 12/34, mean 5.2 ' + PM + ' 1.1, rate 45%';
    const toks = findNumberTokens(s);
    const byKind = toks.map((t) => t.kind);
    expect(byKind).toContain('pair');
    expect(byKind).toContain('meanSd');
    expect(byKind).toContain('percent');
  });

  it('empty / bad input -> []', () => {
    expect(findNumberTokens('')).toEqual([]);
    expect(findNumberTokens(null)).toEqual([]);
    expect(findNumberTokens(undefined)).toEqual([]);
  });
});

describe('parseNumberList', () => {
  it('lists bare number values in order', () => {
    expect(parseNumberList('0.95 to 1.08')).toEqual([0.95, 1.08]);
  });

  it('strips thousands commas', () => {
    expect(parseNumberList('a 1,234 b 5,678')).toEqual([1234, 5678]);
  });

  it('splits a hyphen pair into two positive numbers (sign is a separator)', () => {
    expect(parseNumberList('10-20')).toEqual([10, 20]);
  });

  it('keeps a genuine leading negative', () => {
    expect(parseNumberList('-3 and -1')).toEqual([-3, -1]);
  });

  it('reads a unicode-minus value', () => {
    expect(parseNumberList('x ' + MINUS + '0.5 y')).toEqual([-0.5]);
  });

  it('bad input -> []', () => {
    expect(parseNumberList(null)).toEqual([]);
    expect(parseNumberList('')).toEqual([]);
  });
});

describe('determinism', () => {
  it('same input -> identical output across calls', () => {
    const s = 'HR 1.05 (95% CI 0.89' + EN + '1.24), n 12/34, 5.2 ' + PM + ' 1.1, 45%';
    const a = JSON.stringify(findNumberTokens(s));
    const b = JSON.stringify(findNumberTokens(s));
    expect(a).toBe(b);
    const at = s.indexOf('0.89');
    expect(snapNumberToken(s, at)).toEqual(snapNumberToken(s, at));
  });
});
