/**
 * prismaConsumerParity119.test.js — 119.md §1, consumer convergence.
 *
 * 119.md: "The same authoritative PRISMA service must supply the live PRISMA page,
 * Manuscript Editor diagram, dashboard summaries, and exports."
 *
 * Four independent derivations of "duplicates removed" existed:
 *   1. loadPrismaFlow                      — GET /prisma, the manuscript, every export
 *   2. getMetaLabSummary                   — the dashboard + the legacy project.prisma stamp
 *   3. livingService digest                — the living-review snapshot
 *   4. publicSynthesisService.derivePrisma — the public synthesis page
 * On a real automated-search project they DISAGREED: (1) omitted every duplicate the
 * search engine removed before landing, while (2) folded them in; (3) and (4) omitted
 * both those AND every record-level duplicate.
 *
 * This test runs the REAL handler and the REAL loader over ONE dataset and asserts
 * they answer with the same numbers, on the fixtures where they used to differ.
 * Both now read server/screening/dedupCounts.js, so a future edit that re-forks the
 * arithmetic fails HERE rather than in a published figure.
 *
 * Hermetic: prisma + settings mocked; no DB, no HTTP.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../server/screening/settings.js', () => ({
  getMetaSiftSettings: vi.fn(async () => ({})),
  getEffectiveQuorum: vi.fn(async () => 2),
}));
vi.mock('../../../server/realtime/bus.js', () => ({
  emitToProjectMembers: vi.fn(), emitToMetaLabProject: vi.fn(),
}));

const db = {
  screenProject: [{ id: 'p1', ownerId: 'u1', title: 'T', linkedMetaLabProjectId: 'ml1', deletedAt: null, updatedAt: new Date(), requiredScreeningReviewers: 0 }],
  screenProjectMember: [],
  screenRecord: [],
  screenDecision: [],
  screenConflict: [],
  screenDuplicateGroup: [],
  screenRecordSource: [],
  screenImportBatch: [],
  pecanSearchSource: [],
  fullTextCandidate: [],
  fullTextRequest: [],
  screenPdfAttachment: [],
};

const prismaMock = {};
for (const model of Object.keys(db)) {
  prismaMock[model] = {
    findMany: vi.fn(async () => db[model]),
    findFirst: vi.fn(async () => null),
    count: vi.fn(async () => db[model].length),
  };
}
prismaMock.pecanSearchSource.findMany = vi.fn(async ({ where }) => {
  const want = where?.run?.screenProjectId?.in || [];
  return db.pecanSearchSource.filter((s) => want.includes(s.screenProjectId) && !s.rolledBackAt);
});
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { loadPrismaFlow } = await import('../../../server/screening/prismaFlowService.js');
const { getMetaLabSummary } = await import('../../../server/controllers/screeningController.js');

const rec = (over = {}) => ({
  id: over.id, projectId: 'p1', sourceDb: 'PubMed', isDuplicate: false, isPrimary: false,
  duplicateGroupId: null, currentStage: 'title_abstract', finalStatus: '', promotedAt: null,
  rejectedReason: '', handoffStudyId: '', importBatchId: null, identificationSource: null,
  sourceDetail: null, title: 'x', ...over,
});
const src = (id) => ({ screenRecordId: id, origin: 'search', runId: 'run1', batchId: '', outcome: 'new' });

/** Run the real handler and return its `prisma` block. */
async function summary() {
  let body = null;
  const res = { json: (v) => { body = v; return res; }, status: () => res };
  await getMetaLabSummary({ params: { mlpid: 'ml1' }, user: { id: 'u1', email: 'a@b.c' } }, res);
  expect(body && body.linked).toBe(true);
  return body.prisma;
}

beforeEach(() => {
  for (const k of Object.keys(db)) if (k !== 'screenProject') db[k] = [];
});

describe('119.md §1 — GET /prisma and the dashboard summary agree', () => {
  it('on an AUTOMATED SEARCH with engine-removed duplicates (the divergence case)', async () => {
    db.screenRecord = [rec({ id: 'r1' }), rec({ id: 'r2' }), rec({ id: 'r3' })];
    db.screenRecordSource = db.screenRecord.map((r) => src(r.id));
    db.screenImportBatch = [{ id: 'b1', duplicateCount: 0, preDedupCount: 3, sourceDatabase: '', contributesToReview: true, source: 'pecan-search', filename: '', format: '', createdAt: new Date(), supersedesBatchId: '' }];
    db.pecanSearchSource = [{ screenProjectId: 'p1', rolledBackAt: null, runId: 'run1', provider: 'pubmed', exactDupCount: 5, fuzzyDupCount: 2 }];

    const { flow } = await loadPrismaFlow('p1');
    const s = await summary();
    expect(flow.counts.identified).toBe(10);
    expect(flow.counts.duplicatesRemoved).toBe(7);
    expect(s.identified).toBe(flow.counts.identified);
    expect(s.duplicatesRemoved).toBe(flow.counts.duplicatesRemoved);
    expect(s.screened).toBe(flow.counts.screened);
  });

  it('on a FILE IMPORT with discarded copies AND a record-level duplicate group', async () => {
    db.screenRecord = [
      rec({ id: 'r1', sourceDb: '', importBatchId: 'b1', isPrimary: true, duplicateGroupId: 'g1' }),
      rec({ id: 'r2', sourceDb: '', importBatchId: 'b1', isDuplicate: true, duplicateGroupId: 'g1' }),
      rec({ id: 'r3', sourceDb: '', importBatchId: 'b1' }),
    ];
    db.screenImportBatch = [{ id: 'b1', duplicateCount: 4, preDedupCount: 7, sourceDatabase: 'pubmed', contributesToReview: true, source: 'file', filename: 'f.ris', format: 'RIS', createdAt: new Date(), supersedesBatchId: '' }];
    db.screenDuplicateGroup = [{ resolvedAt: new Date(), createdAt: new Date() }];

    const { flow } = await loadPrismaFlow('p1');
    const s = await summary();
    expect(s.identified).toBe(flow.counts.identified);         // 3 records + 4 phantom
    expect(s.duplicatesRemoved).toBe(flow.counts.duplicatesRemoved); // 1 record + 4 phantom
    expect(s.screened).toBe(flow.counts.screened);
  });

  it('on a FORCED RE-IMPORT — both stay stable instead of both inflating', async () => {
    db.screenRecord = [rec({ id: 'r1', sourceDb: '', importBatchId: 'b1' }), rec({ id: 'r2', sourceDb: '', importBatchId: 'b1' })];
    db.screenImportBatch = [
      { id: 'b1', duplicateCount: 2, preDedupCount: 4, sourceDatabase: 'pubmed', contributesToReview: true, source: 'file', filename: 'f.ris', format: 'RIS', createdAt: new Date(), supersedesBatchId: '' },
      { id: 'b2', duplicateCount: 4, preDedupCount: 4, sourceDatabase: 'pubmed', contributesToReview: true, source: 'file', filename: 'f.ris', format: 'RIS', createdAt: new Date(), supersedesBatchId: 'b1' },
    ];
    const { flow } = await loadPrismaFlow('p1');
    const s = await summary();
    expect([s.identified, s.duplicatesRemoved]).toEqual([4, 2]);
    expect([flow.counts.identified, flow.counts.duplicatesRemoved]).toEqual([4, 2]);
  });

  it('excludes a ROLLED-BACK run in both, so a reset lands on the same numbers', async () => {
    db.screenRecord = [rec({ id: 'r1' })];
    db.screenRecordSource = [src('r1')];
    db.pecanSearchSource = [
      { screenProjectId: 'p1', rolledBackAt: null, runId: 'run1', provider: 'pubmed', exactDupCount: 2, fuzzyDupCount: 0 },
      { screenProjectId: 'p1', rolledBackAt: new Date(), runId: 'run2', provider: 'embase', exactDupCount: 40, fuzzyDupCount: 9 },
    ];
    const { flow } = await loadPrismaFlow('p1');
    const s = await summary();
    expect(s.duplicatesRemoved).toBe(2);
    expect(s.duplicatesRemoved).toBe(flow.counts.duplicatesRemoved);
  });

  it('and on a project with no duplicates at all', async () => {
    db.screenRecord = [rec({ id: 'r1' }), rec({ id: 'r2' })];
    db.screenRecordSource = db.screenRecord.map((r) => src(r.id));
    const { flow } = await loadPrismaFlow('p1');
    const s = await summary();
    expect([s.identified, s.duplicatesRemoved]).toEqual([2, 0]);
    expect([flow.counts.identified, flow.counts.duplicatesRemoved]).toEqual([2, 0]);
  });
});
