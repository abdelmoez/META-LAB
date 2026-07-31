/**
 * mergePolicy.test.js — 96.md D10: the SAFE metadata-merge policy (pure parts).
 *
 * The DB-coupled writer (applyMetadataMerge) is exercised by the integration
 * suites (screening-reset.test.js + pecanSearch.integration.test.js); here we pin
 * the pure invariants the policy is built on:
 *  - fill-blank only (never overwrite a non-empty field),
 *  - the mergeable field set is BIBLIOGRAPHIC only (reviewer work untouchable),
 *  - donorShape never leaks a provider id into `journal` and applies insert caps.
 */
import { describe, it, expect } from 'vitest';
import { mergeFillBlanks, MERGE_FILL_FIELDS } from '../../../src/research-engine/screening/deduplication.js';
import { donorShape } from '../../../server/services/screeningImportService.js';

describe('96.md merge policy — field whitelist', () => {
  it('MERGE_FILL_FIELDS is bibliographic only (no decision/workflow fields)', () => {
    expect([...MERGE_FILL_FIELDS].sort()).toEqual(
      ['abstract', 'authors', 'doi', 'journal', 'keywords', 'pmid', 'year'].sort(),
    );
    for (const forbidden of ['decision', 'notes', 'currentStage', 'finalStatus', 'isDuplicate', 'handoffStudyId', 'title']) {
      expect(MERGE_FILL_FIELDS).not.toContain(forbidden);
    }
  });

  it('fills ONLY blank fields — never overwrites user/existing data', () => {
    const primary = { id: 'a', doi: '10.1/x', pmid: '', abstract: '', authors: 'Smith J', year: '2020', journal: 'Lancet', keywords: '' };
    const donor = { id: 'd', doi: '10.9/OTHER', pmid: '123', abstract: 'New abstract', authors: 'Donor D', year: '1999', journal: 'BMJ', keywords: 'k1; k2' };
    const { patch } = mergeFillBlanks(primary, [donor]);
    expect(patch).toEqual({ pmid: '123', abstract: 'New abstract', keywords: 'k1; k2' });
    // Non-blank fields (doi/authors/year/journal) must never appear in the patch.
    expect(patch.doi).toBeUndefined();
    expect(patch.authors).toBeUndefined();
    expect(patch.year).toBeUndefined();
    expect(patch.journal).toBeUndefined();
  });

  it('is idempotent: a second pass with the same donor fills nothing', () => {
    const primary = { id: 'a', doi: '', pmid: '', abstract: '', authors: '', year: '', journal: '', keywords: '' };
    const donor = { id: 'd', doi: '10.1/x', pmid: '7', abstract: 'A', authors: 'X', year: '2021', journal: 'J', keywords: 'k' };
    const first = mergeFillBlanks(primary, [donor]);
    const merged = { ...primary, ...first.patch };
    const second = mergeFillBlanks(merged, [donor]);
    expect(Object.keys(second.patch)).toEqual([]);
  });

  it('whitespace-only values count as blank and are fillable', () => {
    const { patch } = mergeFillBlanks({ id: 'a', abstract: '   ' }, [{ id: 'd', abstract: 'Real' }], ['abstract']);
    expect(patch.abstract).toBe('Real');
  });
});

describe('96.md merge policy — donorShape', () => {
  it('never falls back journal → source/provider (the insert-path quirk is NOT inherited)', () => {
    const d = donorShape({ journal: '', source: 'pubmed', sourceDb: 'pubmed' });
    expect(d.journal).toBe('');
  });

  it('joins author arrays and applies the insert column caps', () => {
    const d = donorShape({ authors: ['Smith J', 'Roe R'], abstract: 'x'.repeat(9000), doi: 'd'.repeat(300) });
    expect(d.authors).toBe('Smith J; Roe R');
    expect(d.abstract.length).toBe(5000);
    expect(d.doi.length).toBe(200);
  });

  it('joins keyword arrays like the insert mapping does', () => {
    expect(donorShape({ keywords: ['a', 'b'] }).keywords).toBe('a; b');
    expect(donorShape({ keywords: 'a; b' }).keywords).toBe('a; b');
  });

  it('carries the providerRecordId as the donor id (filledFrom provenance)', () => {
    expect(donorShape({ providerRecordId: 'PMID:1' }).id).toBe('PMID:1');
    expect(donorShape({}).id).toBe('');
  });
});
