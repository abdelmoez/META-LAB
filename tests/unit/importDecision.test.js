/**
 * importDecision.test.js — 59.md Change 1: importing a `decision` column.
 * Pure parser-layer tests (normalisation + CSV round-trip). The application of the
 * decisions as ScreenDecision rows is covered by the screening import-service tests.
 */
import { describe, it, expect } from 'vitest';
import { normalizeImportedDecision, parseCSV } from '../../src/research-engine/import-export/parsers.js';

describe('59.md Change 1 — normalizeImportedDecision', () => {
  it('passes the four canonical states', () => {
    for (const d of ['include', 'exclude', 'maybe', 'undecided']) expect(normalizeImportedDecision(d)).toBe(d);
  });
  it('is case-insensitive and whitespace-tolerant', () => {
    expect(normalizeImportedDecision('  INCLUDE ')).toBe('include');
    expect(normalizeImportedDecision('Exclude')).toBe('exclude');
    expect(normalizeImportedDecision('MayBe')).toBe('maybe');
  });
  it('maps common synonyms', () => {
    expect(normalizeImportedDecision('yes')).toBe('include');
    expect(normalizeImportedDecision('accepted')).toBe('include');
    expect(normalizeImportedDecision('no')).toBe('exclude');
    expect(normalizeImportedDecision('rejected')).toBe('exclude');
    expect(normalizeImportedDecision('unsure')).toBe('maybe');
  });
  it('empty / missing → undecided (neutral, never invalid)', () => {
    expect(normalizeImportedDecision('')).toBe('undecided');
    expect(normalizeImportedDecision('   ')).toBe('undecided');
    expect(normalizeImportedDecision(null)).toBe('undecided');
    expect(normalizeImportedDecision(undefined)).toBe('undecided');
  });
  it('an unrecognised value returns "" so the caller can warn (no silent corruption)', () => {
    expect(normalizeImportedDecision('banana')).toBe('');
    expect(normalizeImportedDecision('include-ish')).toBe('');
  });
});

describe('59.md Change 1 — parseCSV reads the decision column', () => {
  const csv = [
    'title,doi,decision',
    'Study A,10.1/a,include',
    'Study B,10.1/b,Exclude',
    'Study C,10.1/c,', // empty → undecided
    'Study D,10.1/d,maybe',
  ].join('\n');

  it('maps the decision header onto the normalised record decision', () => {
    const recs = parseCSV(csv);
    expect(recs.map((r) => r.decision)).toEqual(['include', 'exclude', 'undecided', 'maybe']);
  });
  it('is backwards compatible: no decision column → all undecided', () => {
    const recs = parseCSV('title,doi\nStudy A,10.1/a\nStudy B,10.1/b');
    expect(recs.every((r) => r.decision === 'undecided')).toBe(true);
  });
});
