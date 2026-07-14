/**
 * 86.md P1.1 — record exports must honour blind mode the same way the on-screen
 * list does: a non-leader on a blind project must not receive authors/journal.
 * buildExportRow is pure, so we can pin it directly.
 */
import { describe, it, expect } from 'vitest';
import { buildExportRow, renderRisBlock } from '../../../server/services/screeningExportService.js';

const REC = {
  id: 'r1', title: 'A trial', authors: 'Smith J; Doe A', year: '2020',
  journal: 'The Lancet', doi: '10.1/x', pmid: '123', abstract: 'abstract',
  decisions: [], isDuplicate: false, sourceDb: 'pubmed', isPrimary: true,
};
const CV = { byRecordId: new Map(), meta: null, generatedAt: null };
const ctx = (canSeeIdentity) => ({ canSeeIdentity, reviewers: [], requiredReviewers: 2 });

describe('screening export — blind mode (P1.1)', () => {
  it('blanks authors + journal for a non-leader on a blind project', () => {
    const row = buildExportRow(REC, 'user-x', CV, ctx(false));
    expect(row.authors).toBe('');
    expect(row.journal).toBe('');
    // Title/doi/pmid still flow (matches listRecords blind contract).
    expect(row.title).toBe('A trial');
    expect(row.doi).toBe('10.1/x');
  });

  it('keeps authors + journal for a leader (or non-blind project)', () => {
    const row = buildExportRow(REC, 'user-x', CV, ctx(true));
    expect(row.authors).toBe('Smith J; Doe A');
    expect(row.journal).toBe('The Lancet');
  });

  it('RIS render (built off the row) omits AU/JO when blinded', () => {
    const blindRow = buildExportRow(REC, 'user-x', CV, ctx(false));
    const ris = renderRisBlock(blindRow);
    expect(ris).not.toMatch(/AU {2}- /);
    expect(ris).not.toMatch(/JO {2}- /);
    expect(ris).toMatch(/TI {2}- A trial/);
  });

  it('RIS render keeps AU/JO for a leader', () => {
    const leaderRow = buildExportRow(REC, 'user-x', CV, ctx(true));
    const ris = renderRisBlock(leaderRow);
    expect(ris).toMatch(/AU {2}- Smith J/);
    expect(ris).toMatch(/JO {2}- The Lancet/);
  });
});
