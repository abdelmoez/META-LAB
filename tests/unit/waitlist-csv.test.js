/**
 * waitlist-csv.test.js — CSV generation safety (prompt48): formula-injection
 * neutralisation + standard quoting. Pure.
 */
import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toCsv } from '../../server/waitlist/csv.js';

describe('escapeCsvCell — formula injection', () => {
  it('prefixes cells that begin with a formula trigger', () => {
    expect(escapeCsvCell('=1+1')).toBe("'=1+1");
    expect(escapeCsvCell('+1')).toBe("'+1");
    expect(escapeCsvCell('-1')).toBe("'-1");
    expect(escapeCsvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(escapeCsvCell('\tx')).toBe("'\tx");
  });
  it('leaves safe cells untouched', () => {
    expect(escapeCsvCell('Jane')).toBe('Jane');
    expect(escapeCsvCell('a1=b')).toBe('a1=b'); // '=' not leading
  });
  it('handles null/undefined as empty', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('escapeCsvCell — quoting', () => {
  it('quotes cells with comma / quote / newline', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });
  it('neutralises AND quotes a formula cell that also has a comma', () => {
    expect(escapeCsvCell('=a,b')).toBe('"\'=a,b"');
  });
});

describe('toCsv', () => {
  it('builds header + rows with CRLF', () => {
    const rows = [{ name: 'Jane', inst: 'Uni, X' }, { name: '=cmd', inst: 'Y' }];
    const cols = [{ header: 'Name', key: 'name' }, { header: 'Institution', key: 'inst' }];
    const csv = toCsv(rows, cols);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,Institution');
    expect(lines[1]).toBe('Jane,"Uni, X"');
    expect(lines[2]).toBe("'=cmd,Y");
  });
  it('supports value() accessors', () => {
    const csv = toCsv([{ a: 1, b: 2 }], [{ header: 'Sum', value: (r) => r.a + r.b }]);
    expect(csv).toBe('Sum\r\n3');
  });
  it('handles empty rows (header only)', () => {
    expect(toCsv([], [{ header: 'X', key: 'x' }])).toBe('X');
  });
});
