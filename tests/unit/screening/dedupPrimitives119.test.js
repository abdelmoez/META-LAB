/**
 * dedupPrimitives119.test.js — 119.md §1. The shared dedup primitives every PRISMA
 * consumer now delegates to (server/screening/dedupCounts.js) and the audit writer's
 * normalization (server/screening/dedupEvents.js).
 *
 * These are the rules that used to live, subtly differently, in four places.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../server/db/client.js', () => ({ prisma: {} }));

const {
  isSupersededImport, sumImportDuplicates, isRemovedDuplicateRecord,
  countRemovedDuplicateRecords, engineDuplicateTotals, engineDuplicatesByArm,
} = await import('../../../server/screening/dedupCounts.js');
const { normalizeDedupEvent, DEDUP_METHODS } = await import('../../../server/screening/dedupEvents.js');

describe('sumImportDuplicates — superseded re-imports contribute nothing', () => {
  it('sums ordinary batches', () => {
    expect(sumImportDuplicates([{ duplicateCount: 2 }, { duplicateCount: 5 }])).toBe(7);
  });
  it('skips a batch that repeats an earlier import of the same file', () => {
    expect(sumImportDuplicates([
      { duplicateCount: 2, supersedesBatchId: '' },
      { duplicateCount: 4, supersedesBatchId: 'b1' },
    ])).toBe(2);
  });
  it('MIGRATION: a legacy row with no lineage column still counts', () => {
    expect(isSupersededImport({ duplicateCount: 2 })).toBe(false);
    expect(sumImportDuplicates([{ duplicateCount: 2 }])).toBe(2);
  });
  it('never lets a negative or non-numeric count subtract', () => {
    expect(sumImportDuplicates([{ duplicateCount: -5 }, { duplicateCount: 'x' }, { duplicateCount: 3 }])).toBe(3);
    expect(sumImportDuplicates(null)).toBe(0);
  });
});

describe('isRemovedDuplicateRecord — the flow\'s own disposition rule, shared', () => {
  it('a removed duplicate is isDuplicate AND not the retained primary', () => {
    expect(isRemovedDuplicateRecord({ isDuplicate: true, isPrimary: false })).toBe(true);
  });
  it('the group\'s retained record is NOT a removal, even if flagged', () => {
    // getMetaLabSummary used to test isDuplicate alone; that agrees with the flow
    // only for as long as no writer ever flags a primary. Now it cannot drift.
    expect(isRemovedDuplicateRecord({ isDuplicate: true, isPrimary: true })).toBe(false);
  });
  it('counts instances, not groups', () => {
    expect(countRemovedDuplicateRecords([
      { isDuplicate: false, isPrimary: true },
      { isDuplicate: true, isPrimary: false },
      { isDuplicate: true, isPrimary: false },
    ])).toBe(2);
  });
});

describe('engine duplicates — exact AND fuzzy, per arm', () => {
  it('totals both, because both are auto-merged BEFORE landing', () => {
    // The suggestion path is 'ambiguous', which DOES land as records and is counted
    // record-by-record — deliberately absent here.
    expect(engineDuplicateTotals([
      { exactDupCount: 3, fuzzyDupCount: 1 },
      { exactDupCount: 2, fuzzyDupCount: 0 },
    ])).toEqual({ exact: 5, fuzzy: 1, total: 6 });
  });
  it('credits a database provider to the database arm', () => {
    expect(engineDuplicatesByArm([{ provider: 'pubmed', exactDupCount: 4 }])).toEqual({ db: 4, other: 0 });
  });
  it('credits a trial REGISTER to the database arm too (PRISMA: databases/registers)', () => {
    const out = engineDuplicatesByArm([{ provider: 'clinicaltrials', exactDupCount: 2 }]);
    expect(out.db + out.other).toBe(2);
    expect(out.db).toBe(2);
  });
  it('an executed search with no provider name stays in the database arm', () => {
    expect(engineDuplicatesByArm([{ provider: '', exactDupCount: 3 }])).toEqual({ db: 3, other: 0 });
  });
  it('ignores zero-duplicate sources entirely', () => {
    expect(engineDuplicatesByArm([{ provider: 'pubmed', exactDupCount: 0, fuzzyDupCount: 0 }])).toEqual({ db: 0, other: 0 });
  });
});

describe('normalizeDedupEvent — a closed vocabulary, never an invented category', () => {
  it('keeps the six 119.md methods', () => {
    expect(DEDUP_METHODS).toEqual([
      'import-exact', 'pecan-exact', 'pecan-fuzzy', 'worker-suggestion',
      'human-confirm', 'human-keepall',
    ]);
  });
  it('blanks an unknown method and basis rather than storing a guess', () => {
    const row = normalizeDedupEvent({ projectId: 'p1', method: 'telepathy', basis: 'vibes' });
    expect(row.method).toBe('');
    expect(row.basis).toBe('');
  });
  it('defaults classification to automatic and clamps confidence to 0-100', () => {
    expect(normalizeDedupEvent({ projectId: 'p1', method: 'pecan-fuzzy', confidence: 500 }).confidence).toBe(100);
    expect(normalizeDedupEvent({ projectId: 'p1', method: 'pecan-fuzzy', confidence: -7 }).confidence).toBe(0);
    expect(normalizeDedupEvent({ projectId: 'p1', method: 'pecan-fuzzy' }).classification).toBe('automatic');
    expect(normalizeDedupEvent({ projectId: 'p1', method: 'human-confirm', classification: 'manual' }).classification).toBe('manual');
  });
  it('serializes a detail object and caps it', () => {
    const row = normalizeDedupEvent({ projectId: 'p1', method: 'import-exact', detail: { a: 1 } });
    expect(row.detail).toBe('{"a":1}');
    expect(normalizeDedupEvent({ projectId: 'p1', method: 'import-exact', detail: 'x'.repeat(5000) }).detail).toHaveLength(1000);
  });
});
