/**
 * citationDedup.test.js — P15 Bibliomine. Proves the thin dedup helpers reuse the
 * shared screening deduplication engine: cross-seed exact/fuzzy dedupe within a
 * mined list, and classify-vs-existing against the project's records.
 */
import { describe, it, expect } from 'vitest';
import { dedupeReferences, classifyAgainstExisting } from '../../../src/research-engine/citationMining/citationDedup.js';
import { DUP_TYPES } from '../../../src/research-engine/screening/deduplication.js';

describe('dedupeReferences — within a mined list', () => {
  it('collapses an exact DOI duplicate across seeds', () => {
    const refs = [
      { id: 'a', title: 'Aspirin for primary prevention', doi: '10.1/aspirin', year: '2020', authors: 'Smith J' },
      { id: 'b', title: 'ASPIRIN FOR PRIMARY PREVENTION', doi: '10.1/aspirin', year: '2020', authors: 'Smith J' },
      { id: 'c', title: 'A different study entirely', doi: '10.1/other', year: '2018', authors: 'Doe A' },
    ];
    const { unique, duplicates } = dedupeReferences(refs);
    expect(unique.map((r) => r.id)).toEqual(['a', 'c']);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ a: 'a', b: 'b', type: DUP_TYPES.EXACT });
  });

  it('collapses a fuzzy (near-identical title, same authors/year, no DOI) duplicate', () => {
    const refs = [
      { id: '1', title: 'Aspirin for primary prevention of cardiovascular disease', authors: 'Smith J, Doe A', year: '2020' },
      { id: '2', title: 'Aspirin for primary prevention of cardiovascular diseases', authors: 'Smith J, Doe A', year: '2020' },
    ];
    const { unique, duplicates } = dedupeReferences(refs);
    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    // reuses the shared classifier → a mergeable fuzzy verdict, not exact
    expect([DUP_TYPES.PROBABLE, DUP_TYPES.POSSIBLE]).toContain(duplicates[0].type);
  });

  it('keeps two genuinely different references', () => {
    const refs = [
      { id: '1', title: 'Aspirin and heart disease', doi: '10.1/a', year: '2020' },
      { id: '2', title: 'Vitamin D and bone density', doi: '10.1/b', year: '2015' },
    ];
    const { unique, duplicates } = dedupeReferences(refs);
    expect(unique).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it('does NOT merge a related report (same study, conflicting DOI)', () => {
    const refs = [
      { id: 'pre', title: 'Statin trial results', authors: 'Lee K, Park S', year: '2021', doi: '10.1/preprint' },
      { id: 'jour', title: 'Statin trial results', authors: 'Lee K, Park S', year: '2021', doi: '10.1/journal' },
    ];
    const { unique, duplicates } = dedupeReferences(refs);
    expect(unique).toHaveLength(2); // related report is kept, not merged
    expect(duplicates).toHaveLength(0);
  });

  it('falls back to index when records have no id', () => {
    const refs = [
      { index: 10, title: 'Same title here', doi: '10.1/x', year: '2020' },
      { index: 11, title: 'Same title here', doi: '10.1/x', year: '2020' },
    ];
    const { duplicates } = dedupeReferences(refs);
    expect(duplicates[0]).toMatchObject({ a: 10, b: 11 });
  });

  it('handles empty / non-array input', () => {
    expect(dedupeReferences([])).toEqual({ unique: [], duplicates: [] });
    expect(dedupeReferences(null)).toEqual({ unique: [], duplicates: [] });
  });
});

describe('classifyAgainstExisting — mined ref vs project records', () => {
  const existing = [
    { id: 'e1', title: 'Aspirin for primary prevention', doi: '10.1/aspirin', pmid: '111', year: '2020', authors: 'Smith J' },
    { id: 'e2', title: 'Vitamin D and falls in the elderly', doi: '10.1/vitd', year: '2016', authors: 'Kim H' },
  ];

  it('returns exact_dup on a hard identifier match', () => {
    const res = classifyAgainstExisting({ title: 'Totally different wording', doi: '10.1/aspirin' }, existing);
    expect(res.status).toBe('exact_dup');
    expect(res.matchId).toBe('e1');
    expect(res.type).toBe(DUP_TYPES.EXACT);
  });

  it('returns fuzzy_dup on a near-identical title with agreeing metadata', () => {
    const res = classifyAgainstExisting(
      { title: 'Aspirin for primary preventions', authors: 'Smith J', year: '2020' },
      existing,
    );
    expect(res.status).toBe('fuzzy_dup');
    expect(res.matchId).toBe('e1');
  });

  it('returns new for a reference not in the project', () => {
    const res = classifyAgainstExisting({ title: 'A brand new topic on nutrition', doi: '10.1/new', year: '2023' }, existing);
    expect(res.status).toBe('new');
    expect(res.matchId).toBeUndefined();
  });

  it('flags a related report already present as existing_match (never a merge)', () => {
    const res = classifyAgainstExisting(
      { title: 'Aspirin for primary prevention', authors: 'Smith J', year: '2020', doi: '10.1/preprint' },
      existing,
    );
    expect(res.status).toBe('existing_match');
    expect(res.matchId).toBe('e1');
  });

  it('handles empty existing records', () => {
    expect(classifyAgainstExisting({ title: 'x', doi: '10.1/x' }, [])).toEqual({ status: 'new' });
    expect(classifyAgainstExisting({ title: 'x' }, null)).toEqual({ status: 'new' });
  });
});
