/**
 * import-error-report.test.js — 65.md SCR-3: per-row reject/invalid-decision
 * reasons collected by dedupeAndInsertRecords (persisted to ScreenImportJob.
 * errorReport by the worker). Direct service test against the real dev DB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../server/db/client.js';
import {
  dedupeAndInsertRecords, hasUsableIdentity, ERROR_REPORT_CAP,
} from '../../../server/services/screeningImportService.js';

const tag = `errrep65_${Date.now()}`;
let user, project;

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'Err65' } });
  project = await prisma.screenProject.create({ data: { ownerId: user.id, title: 'ErrReport 65' } });
});

afterAll(async () => {
  try {
    await prisma.screenDecision.deleteMany({ where: { projectId: project.id } });
    await prisma.screenRecord.deleteMany({ where: { projectId: project.id } });
    await prisma.screenImportBatch.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProject.deleteMany({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  } catch { /* best-effort */ }
});

describe('dedupeAndInsertRecords — errorReport (65.md SCR-3)', () => {
  it('reports rejected rows and invalid decision values with 1-based indices', async () => {
    const records = [
      { title: 'Good study', doi: '10.9/a', decision: 'include' },   // row 1 — fine
      { title: '', doi: '', pmid: '', decision: 'undecided' },       // row 2 — rejected (no identity)
      { title: 'Odd label study', doi: '10.9/b', decision: '' },     // row 3 — invalid decision (normalised '')
      { title: 'Good study', doi: '10.9/a', decision: '' },          // row 4 — duplicate of row 1 (invalid decision NOT reported)
    ];
    const result = await dedupeAndInsertRecords(project.id, records, {
      format: 'CSV', filename: 'err.csv', importedById: user.id, importedByName: 'Err65',
    });

    expect(result.imported).toBe(2);
    expect(result.rejected).toBe(1);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.invalidDecisions).toBe(1);

    expect(result.errorReport).toEqual([
      { index: 2, title: '', reason: 'No usable title, DOI, or PMID' },
      { index: 3, title: 'Odd label study', reason: 'Unrecognised screening decision value — record imported unscreened' },
    ]);
  });

  it('caps the report at ERROR_REPORT_CAP entries while counts stay exact', async () => {
    const many = Array.from({ length: ERROR_REPORT_CAP + 25 }, () => ({ title: '', doi: '', pmid: '' }));
    const result = await dedupeAndInsertRecords(project.id, many, { format: 'CSV', filename: 'allbad.csv' });
    expect(result.rejected).toBe(ERROR_REPORT_CAP + 25);
    expect(result.errorReport.length).toBe(ERROR_REPORT_CAP);
    expect(result.imported).toBe(0);
  });

  it('hasUsableIdentity mirrors the reject rule', () => {
    expect(hasUsableIdentity({ title: 'T' })).toBe(true);
    expect(hasUsableIdentity({ doi: '10.1/x' })).toBe(true);
    expect(hasUsableIdentity({ pmid: '123' })).toBe(true);
    expect(hasUsableIdentity({ title: '  ', doi: '', pmid: '' })).toBe(false);
    expect(hasUsableIdentity({})).toBe(false);
  });
});
