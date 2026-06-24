/**
 * csvInjection.test.js — CSV / spreadsheet formula-injection guard (prompt 53).
 * Pins the invariant that every exported CSV cell neutralizes formula leads and
 * RFC-4180-quotes special characters. Used by the screening + pecanSearch exports.
 */
import { describe, it, expect } from 'vitest';
import { csvField, csvRow } from '../../../server/utils/csv.js';

describe('csvField — formula-injection guard (CWE-1236)', () => {
  it('prefixes a quote to any cell that would be read as a formula', () => {
    expect(csvField('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvField('=1+1')).toBe(`'=1+1`);
    expect(csvField('+1')).toBe(`'+1`);
    expect(csvField('-1')).toBe(`'-1`);
    expect(csvField('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvField('\t=cmd')).toBe(`'\t=cmd`); // leading tab is a formula lead → guarded (tab needs no CSV quoting)
  });
  it('leaves ordinary text untouched (no formula lead, no special chars)', () => {
    expect(csvField('A randomized trial of metformin')).toBe('A randomized trial of metformin');
    expect(csvField('Smith J')).toBe('Smith J');
  });
  it('RFC-4180 quotes commas, quotes and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
  it('handles null/undefined/number', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(2024)).toBe('2024');
  });
  it('a hyphen-leading negative number is forced to text (acceptable safety tradeoff)', () => {
    // Documented: a leading '-' is a formula lead, so negative numbers are quoted
    // as text. Screening/search exports are textual, so this is the safe choice.
    expect(csvField('-5')).toBe(`'-5`);
  });
});

describe('csvRow', () => {
  it('joins encoded cells with commas', () => {
    expect(csvRow(['Title', '=evil', 'a,b'])).toBe(`Title,'=evil,"a,b"`);
  });
});
