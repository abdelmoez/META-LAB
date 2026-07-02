/**
 * tableParse.test.js — delimited + HTML table parsing (P5).
 * Covers: delimiter autodetect, quoted fields with embedded commas/newlines,
 * HTML entities + caption, malformed HTML (no crash), and grid quality scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDelimited,
  detectDelimiter,
  parseHtmlTables,
  decodeEntities,
  gridQuality,
  looksNumeric,
} from '../../../src/research-engine/extraction/tableParse.js';

describe('parseDelimited — autodetect', () => {
  it('detects commas', () => {
    const { rows, delimiter } = parseDelimited('a,b,c\n1,2,3');
    expect(delimiter).toBe(',');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('detects tabs', () => {
    const { rows, delimiter } = parseDelimited('a\tb\tc\n1\t2\t3');
    expect(delimiter).toBe('\t');
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('detects semicolons', () => {
    const { delimiter } = parseDelimited('a;b;c\n1;2;3');
    expect(delimiter).toBe(';');
  });

  it('detects pipes', () => {
    const { delimiter } = parseDelimited('a|b|c\n1|2|3');
    expect(delimiter).toBe('|');
  });

  it('handles quoted fields containing the delimiter', () => {
    const { rows } = parseDelimited('name,note\n"Smith, J.","hello, world"\n"x","y"');
    expect(rows[1]).toEqual(['Smith, J.', 'hello, world']);
    expect(rows[2]).toEqual(['x', 'y']);
  });

  it('handles escaped quotes and embedded newlines inside quotes', () => {
    const { rows } = parseDelimited('a,b\n"line1\nline2","he said ""hi"""');
    expect(rows[1][0]).toBe('line1\nline2');
    expect(rows[1][1]).toBe('he said "hi"');
  });

  it('trims trailing empty row from a trailing newline', () => {
    const { rows } = parseDelimited('a,b\n1,2\n');
    expect(rows.length).toBe(2);
  });

  it('empty input yields empty rows and comma default', () => {
    const { rows, delimiter } = parseDelimited('');
    expect(rows).toEqual([]);
    expect(delimiter).toBe(',');
  });

  it('detectDelimiter prefers the more consistent delimiter', () => {
    // commas give a consistent 3-col grid; a stray semicolon should not win
    expect(detectDelimiter('a,b,c\nd,e,f\ng,h,i')).toBe(',');
  });
});

describe('parseHtmlTables', () => {
  it('extracts caption, headers, and rows', () => {
    const html = `
      <table>
        <caption>Table 1. Baseline</caption>
        <tr><th>Var</th><th>Value</th></tr>
        <tr><td>Age</td><td>55</td></tr>
      </table>`;
    const tables = parseHtmlTables(html);
    expect(tables.length).toBe(1);
    expect(tables[0].caption).toBe('Table 1. Baseline');
    expect(tables[0].rows[0]).toEqual(['Var', 'Value']);
    expect(tables[0].rows[1]).toEqual(['Age', '55']);
  });

  it('decodes HTML entities inside cells', () => {
    const html = '<table><tr><td>a &amp; b</td><td>&lt;5&gt;</td><td>x&nbsp;y</td><td>&#65;&#x42;</td></tr></table>';
    const [t] = parseHtmlTables(html);
    expect(t.rows[0]).toEqual(['a & b', '<5>', 'x y', 'AB']);
  });

  it('does not crash on malformed HTML (missing closing tags)', () => {
    const html = '<table><tr><td>1<td>2<tr><td>3<td>4';
    const [t] = parseHtmlTables(html);
    expect(t.rows.length).toBe(2);
    expect(t.rows[0]).toEqual(['1', '2']);
    expect(t.rows[1]).toEqual(['3', '4']);
  });

  it('handles multiple tables', () => {
    const html = '<table><tr><td>a</td></tr></table><table><caption>Two</caption><tr><td>b</td></tr></table>';
    const tables = parseHtmlTables(html);
    expect(tables.length).toBe(2);
    expect(tables[1].caption).toBe('Two');
  });

  it('returns [] for input with no tables', () => {
    expect(parseHtmlTables('<p>no tables here</p>')).toEqual([]);
  });

  it('strips inline tags and <br> inside cells', () => {
    const html = '<table><tr><td><b>Bold</b><br>Next</td></tr></table>';
    const [t] = parseHtmlTables(html);
    expect(t.rows[0][0]).toBe('Bold Next');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric refs; leaves unknown named refs intact', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
    expect(decodeEntities('&#8364;')).toBe('€');
    expect(decodeEntities('&unknownentity;')).toBe('&unknownentity;');
  });
});

describe('gridQuality', () => {
  it('scores a clean rectangular numeric table highly', () => {
    const rows = [
      ['Study', 'N', 'Mean', 'SD'],
      ['A', '30', '12.3', '4.5'],
      ['B', '28', '11.1', '3.9'],
      ['C', '35', '13.0', '5.1'],
    ];
    const q = gridQuality(rows);
    expect(q.score).toBeGreaterThan(0.5);
    expect(q.reasons.join()).toMatch(/rectangular/);
  });

  it('penalizes a ragged, non-numeric grid', () => {
    const rows = [['a'], ['b', 'c', 'd'], ['e', 'f']];
    const q = gridQuality(rows);
    expect(q.score).toBeLessThan(0.5);
  });

  it('empty grid → 0', () => {
    expect(gridQuality([]).score).toBe(0);
  });
});

describe('looksNumeric', () => {
  it('recognizes numbers with %, commas, and ± notation', () => {
    expect(looksNumeric('12.3')).toBe(true);
    expect(looksNumeric('45%')).toBe(true);
    expect(looksNumeric('1,234')).toBe(true);
    expect(looksNumeric('12.3 ± 4.5')).toBe(true);
    expect(looksNumeric('abc')).toBe(false);
    expect(looksNumeric('')).toBe(false);
  });
});
