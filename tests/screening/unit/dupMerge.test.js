/**
 * dupMerge.test.js — 65.md SCR-4: pure duplicate-group resolution helpers —
 * fill-blank metadata merge, deterministic bulk-primary choice, and the strict
 * "every pair exact" bulk-safety gate.
 */
import { describe, it, expect } from 'vitest';
import {
  mergeFillBlanks, pickBulkPrimary, isExactDuplicateGroup, MERGE_FILL_FIELDS,
} from '../../../src/research-engine/screening/deduplication.js';

describe('mergeFillBlanks — fill-blank-only, never overwrite', () => {
  const primary = { id: 'a', title: 'Study A', abstract: '', doi: '', pmid: '111', authors: 'Smith J', year: '', journal: '' };
  const donor1 = { id: 'b', title: 'Study A', abstract: 'Full abstract text', doi: '10.1/x', pmid: '999', authors: 'Different', year: '2020', journal: 'JAMA' };
  const donor2 = { id: 'c', title: 'Study A', abstract: 'Other abstract', doi: '10.1/y', pmid: '', authors: '', year: '2021', journal: '' };

  it('fills only the primary\'s EMPTY fields', () => {
    const { patch } = mergeFillBlanks(primary, [donor1, donor2]);
    expect(patch).toEqual({ abstract: 'Full abstract text', doi: '10.1/x', year: '2020', journal: 'JAMA' });
  });

  it('never overwrites a non-empty field (pmid/authors stay untouched)', () => {
    const { patch } = mergeFillBlanks(primary, [donor1, donor2]);
    expect(patch.pmid).toBeUndefined();
    expect(patch.authors).toBeUndefined();
  });

  it('the first donor holding a value wins (deterministic given order)', () => {
    const { patch, filledFrom } = mergeFillBlanks(primary, [donor2, donor1]);
    expect(patch.abstract).toBe('Other abstract');
    expect(filledFrom.abstract).toBe('c');
    expect(patch.journal).toBe('JAMA'); // donor2 has none → falls through to donor1
    expect(filledFrom.journal).toBe('b');
  });

  it('whitespace-only counts as blank on both sides', () => {
    const { patch } = mergeFillBlanks({ id: 'a', abstract: '   ' }, [{ id: 'b', abstract: 'Real' }], ['abstract']);
    expect(patch.abstract).toBe('Real');
    const { patch: p2 } = mergeFillBlanks({ id: 'a', abstract: 'Kept' }, [{ id: 'b', abstract: '   ' }], ['abstract']);
    expect(p2).toEqual({});
  });

  it('empty inputs → empty patch', () => {
    expect(mergeFillBlanks({ id: 'a' }, []).patch).toEqual({});
    expect(mergeFillBlanks({ id: 'a', doi: '10.1/z' }, [{ id: 'b', doi: '10.1/q' }]).patch).toEqual({});
  });

  it('only touches the declared merge fields', () => {
    const { patch } = mergeFillBlanks({ id: 'a' }, [{ id: 'b', title: 'X', rawData: '{"x":1}', notes: 'n' }]);
    for (const k of Object.keys(patch)) expect(MERGE_FILL_FIELDS).toContain(k);
    expect(patch.title).toBeUndefined(); // title is identity, not a fill field
  });
});

describe('pickBulkPrimary — deterministic canonical-record choice', () => {
  it('prefers the most metadata-complete record', () => {
    const sparse = { id: 'a', title: 'T', createdAt: '2026-01-01T00:00:00Z' };
    const rich = { id: 'b', title: 'T', abstract: 'A', doi: '10.1/x', pmid: '1', authors: 'S', year: '2020', journal: 'J', createdAt: '2026-02-01T00:00:00Z' };
    expect(pickBulkPrimary([sparse, rich]).id).toBe('b');
    expect(pickBulkPrimary([rich, sparse]).id).toBe('b'); // order-independent
  });

  it('breaks completeness ties by earliest createdAt', () => {
    const older = { id: 'z', title: 'T', doi: '10.1/x', createdAt: '2026-01-01T00:00:00Z' };
    const newer = { id: 'a', title: 'T', doi: '10.1/x', createdAt: '2026-03-01T00:00:00Z' };
    expect(pickBulkPrimary([newer, older]).id).toBe('z');
  });

  it('breaks full ties by smallest id (total order)', () => {
    const t = '2026-01-01T00:00:00Z';
    const a = { id: 'aaa', title: 'T', createdAt: t };
    const b = { id: 'bbb', title: 'T', createdAt: t };
    expect(pickBulkPrimary([b, a]).id).toBe('aaa');
    expect(pickBulkPrimary([a, b]).id).toBe('aaa');
  });

  it('handles empty/degenerate input', () => {
    expect(pickBulkPrimary([])).toBeNull();
    expect(pickBulkPrimary(null)).toBeNull();
  });
});

describe('isExactDuplicateGroup — strict all-pairs exact gate', () => {
  const doiA = (id, extra = {}) => ({ id, title: `Record ${id}`, doi: '10.1/same', ...extra });

  it('true when every pair shares a hard identifier (same DOI)', () => {
    expect(isExactDuplicateGroup([doiA('a'), doiA('b'), doiA('c')])).toBe(true);
  });

  it('true for an exact PMID pair', () => {
    expect(isExactDuplicateGroup([
      { id: 'a', title: 'X', pmid: '12345' },
      { id: 'b', title: 'X (reprint)', pmid: '12345' },
    ])).toBe(true);
  });

  it('false when ANY member joins only by fuzzy title (conservative: human review)', () => {
    const fuzzy = { id: 'c', title: 'Record a', doi: '' }; // similar title, no identifier
    expect(isExactDuplicateGroup([doiA('a'), doiA('b'), fuzzy])).toBe(false);
  });

  it('false for a title-similar pair with DIFFERENT DOIs (distinct records)', () => {
    expect(isExactDuplicateGroup([
      { id: 'a', title: 'Aspirin in heart failure', doi: '10.1/x' },
      { id: 'b', title: 'Aspirin in heart failure', doi: '10.1/y' },
    ])).toBe(false);
  });

  it('false for singletons and empty groups', () => {
    expect(isExactDuplicateGroup([doiA('a')])).toBe(false);
    expect(isExactDuplicateGroup([])).toBe(false);
  });
});
