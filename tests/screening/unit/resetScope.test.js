/**
 * resetScope.test.js — 96.md D11/D12: pure scope computation for the
 * "delete imported records" reset + legacy batch→run attribution, the
 * duplicate-group repair plan (H2) and the fail-closed job fence (L19).
 */
import { describe, it, expect } from 'vitest';
import {
  partitionResetScope, planDuplicateGroupRepair, activeJobsReason,
  FENCE_CHECK_FAILED_REASON, RESET_CHUNK,
} from '../../../server/controllers/screeningResetController.js';
import { batchSearchRunId } from '../../../server/controllers/screeningImportBatchController.js';

const batches = [
  { id: 'b-pecan-1', source: 'pecan-search', fileHash: 'pecan:run1:pubmed:1' },
  { id: 'b-pecan-2', source: 'pecan-search', fileHash: 'pecan:run1:pubmed:2' },
  { id: 'b-file', source: 'file', fileHash: 'sha256abc' },
  { id: 'b-api', source: 'api', fileHash: null },
  { id: 'b-legacy', source: undefined, fileHash: 'sha256def' }, // legacy rows default 'file'
];
const records = [
  { id: 'r1', importBatchId: 'b-pecan-1', handoffStudyId: '' },
  { id: 'r2', importBatchId: 'b-pecan-2', handoffStudyId: 'study9' },
  { id: 'r3', importBatchId: 'b-file', handoffStudyId: '' },
  { id: 'r4', importBatchId: 'b-api', handoffStudyId: '' },
  { id: 'r5', importBatchId: null, handoffStudyId: '' }, // manually created
];

describe("partitionResetScope — scope 'search'", () => {
  const out = partitionResetScope({ scope: 'search', records, batches });

  it('selects ONLY records from pecan-search batches', () => {
    expect(out.recordIds.sort()).toEqual(['r1', 'r2']);
    expect(out.batchIds.sort()).toEqual(['b-pecan-1', 'b-pecan-2']);
  });
  it('counts manually imported/created records as KEPT', () => {
    expect(out.manualRecordsKept).toBe(3); // r3 (file), r4 (api), r5 (manual)
  });
  it('counts handed-off records inside the scope', () => {
    expect(out.handedOff).toBe(1); // r2
  });
  it('collects the scoped batches’ fileHashes (for terminal import-job cleanup)', () => {
    expect(out.fileHashes.sort()).toEqual(['pecan:run1:pubmed:1', 'pecan:run1:pubmed:2']);
  });
  it('echoes the normalized scope', () => {
    expect(out.scope).toBe('search');
  });
});

describe("partitionResetScope — scope 'all'", () => {
  const out = partitionResetScope({ scope: 'all', records, batches });

  it('selects EVERY record incl. manual/file/api and null-batch records', () => {
    expect(out.recordIds.sort()).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(out.batchIds.length).toBe(5);
    expect(out.manualRecordsKept).toBe(0);
  });
  it('drops null fileHashes and dedupes the rest', () => {
    expect(out.fileHashes).not.toContain(null);
    expect(new Set(out.fileHashes).size).toBe(out.fileHashes.length);
  });
});

describe('partitionResetScope — hardening', () => {
  it('defaults an unknown scope to search (never over-deletes)', () => {
    const out = partitionResetScope({ scope: 'everything!!', records, batches });
    expect(out.scope).toBe('search');
    expect(out.recordIds.sort()).toEqual(['r1', 'r2']);
  });
  it('tolerates empty inputs', () => {
    const out = partitionResetScope({ scope: 'all' });
    expect(out.recordIds).toEqual([]);
    expect(out.batchIds).toEqual([]);
    expect(out.manualRecordsKept).toBe(0);
  });
  it('chunk size stays under the SQLite bind-variable ceiling', () => {
    expect(RESET_CHUNK).toBeLessThanOrEqual(400);
  });
});

describe("partitionResetScope — M16 run-attributed batches match the history grouping", () => {
  const batches16 = [
    { id: 'b-modern', source: 'pecan-search', fileHash: 'pecan:runA:pubmed:1' },
    // Pre-58.md legacy pecan batch: source defaulted 'file' but the synthetic
    // fileHash attributes it to a run — the history endpoint groups it under the
    // run, so the reset scope must include it too.
    { id: 'b-legacy-pecan', source: 'file', fileHash: 'pecan:runA:pubmed:2' },
    // First-class run attribution without the synthetic hash.
    { id: 'b-runid', source: 'file', fileHash: null, searchRunId: 'runA' },
    { id: 'b-true-file', source: 'file', fileHash: 'sha1abc' },
  ];
  const records16 = [
    { id: 'p1', importBatchId: 'b-modern', handoffStudyId: '' },
    { id: 'p2', importBatchId: 'b-legacy-pecan', handoffStudyId: '' },
    { id: 'p3', importBatchId: 'b-runid', handoffStudyId: '' },
    { id: 'f1', importBatchId: 'b-true-file', handoffStudyId: '' },
  ];

  it('treats legacy-pecan-hash and searchRunId batches as search-scoped', () => {
    const out = partitionResetScope({ scope: 'search', records: records16, batches: batches16 });
    expect(out.recordIds.sort()).toEqual(['p1', 'p2', 'p3']);
    expect(out.batchIds.sort()).toEqual(['b-legacy-pecan', 'b-modern', 'b-runid']);
    expect(out.manualRecordsKept).toBe(1); // only the true file batch survives
  });
});

describe("partitionResetScope — L22 shared provenance kept in scope 'search'", () => {
  it('excludes records that also have non-search provenance (kept + strippable)', () => {
    const out = partitionResetScope({ scope: 'search', records, batches, sharedRecordIds: ['r1'] });
    expect(out.recordIds).toEqual(['r2']); // r1 excluded despite its pecan batch
    expect(out.sharedKeptRecordIds).toEqual(['r1']); // caller strips its search rows
    expect(out.manualRecordsKept).toBe(4); // r1 now counted among the kept
  });

  it("scope 'all' ignores shared provenance (complete restart deletes everything)", () => {
    const out = partitionResetScope({ scope: 'all', records, batches, sharedRecordIds: ['r1'] });
    expect(out.recordIds.length).toBe(5);
    expect(out.sharedKeptRecordIds).toEqual([]);
  });

  it('accepts a Set as well as an array', () => {
    const out = partitionResetScope({ scope: 'search', records, batches, sharedRecordIds: new Set(['r2']) });
    expect(out.recordIds).toEqual(['r1']);
    expect(out.sharedKeptRecordIds).toEqual(['r2']);
  });

  it('collects duplicateGroupIds of scoped records for the in-tx group repair', () => {
    const recs = [
      { id: 'r1', importBatchId: 'b-pecan-1', handoffStudyId: '', duplicateGroupId: 'g1' },
      { id: 'r2', importBatchId: 'b-pecan-2', handoffStudyId: '', duplicateGroupId: null },
      { id: 'r3', importBatchId: 'b-file', handoffStudyId: '', duplicateGroupId: 'g2' }, // out of scope
    ];
    const out = partitionResetScope({ scope: 'search', records: recs, batches });
    expect(out.affectedGroupIds).toEqual(['g1']);
  });
});

describe('planDuplicateGroupRepair — H2 survivor un-flagging', () => {
  it('deletes a group with no survivors (no records to clear)', () => {
    const plan = planDuplicateGroupRepair({ groups: [{ id: 'g1', primaryId: 'dead', survivors: [] }] });
    expect(plan.deleteGroupIds).toEqual(['g1']);
    expect(plan.clearRecordIds).toEqual([]);
  });

  it('dissolves a group whose PRIMARY was deleted, clearing ALL survivors', () => {
    const plan = planDuplicateGroupRepair({
      groups: [{ id: 'g1', primaryId: 'deleted-primary', survivors: [{ id: 's1' }, { id: 's2' }] }],
    });
    expect(plan.deleteGroupIds).toEqual(['g1']);
    expect(plan.clearRecordIds.sort()).toEqual(['s1', 's2']);
  });

  it('dissolves a resolved group reduced to a single survivor (never suppressed alone)', () => {
    const plan = planDuplicateGroupRepair({
      groups: [{ id: 'g1', primaryId: 's1', survivors: [{ id: 's1' }] }],
    });
    expect(plan.deleteGroupIds).toEqual(['g1']);
    expect(plan.clearRecordIds).toEqual(['s1']);
  });

  it('keeps a resolved group whose primary survives with ≥2 members', () => {
    const plan = planDuplicateGroupRepair({
      groups: [{ id: 'g1', primaryId: 's1', survivors: [{ id: 's1' }, { id: 's2' }] }],
    });
    expect(plan.deleteGroupIds).toEqual([]);
    expect(plan.clearRecordIds).toEqual([]);
  });

  it('keeps an UNRESOLVED group (no primary yet) with ≥2 survivors — suggestion stays valid', () => {
    const plan = planDuplicateGroupRepair({
      groups: [{ id: 'g1', primaryId: '', survivors: [{ id: 's1' }, { id: 's2' }] }],
    });
    expect(plan.deleteGroupIds).toEqual([]);
    expect(plan.clearRecordIds).toEqual([]);
  });

  it('tolerates malformed input', () => {
    const plan = planDuplicateGroupRepair({ groups: [null, { id: '' }, { id: 'g2', survivors: [null] }] });
    expect(plan.deleteGroupIds).toEqual(['g2']); // null survivor filtered → empty group
    expect(plan.clearRecordIds).toEqual([]);
    expect(planDuplicateGroupRepair({})).toEqual({ deleteGroupIds: [], clearRecordIds: [] });
  });
});

describe('activeJobsReason — fail-closed job fence (L19)', () => {
  const okModel = { count: async () => 0 };
  const busyModel = { count: async () => 1 };
  const brokenModel = { count: async () => { throw new Error('db locked'); } };
  const baseDb = () => ({
    screenImportJob: okModel, screenDuplicateJob: okModel, screenAiJob: okModel,
    screenEligibilityJob: okModel, fullTextRetrievalJob: okModel,
    pecanSearchJob: okModel, pecanSearchRun: okModel,
  });

  it('returns null when every table reports zero active jobs', async () => {
    expect(await activeJobsReason('p', 'ml', baseDb())).toBeNull();
  });

  it('reports the blocking table when a job is active', async () => {
    const db = { ...baseDb(), screenImportJob: busyModel };
    expect(await activeJobsReason('p', 'ml', db)).toMatch(/reference import/i);
  });

  it('a MISSING model is skipped (stripped deployment tolerated)', async () => {
    const db = baseDb();
    delete db.screenEligibilityJob;
    expect(await activeJobsReason('p', 'ml', db)).toBeNull();
  });

  it('a QUERY ERROR on a present model BLOCKS the reset (fail closed)', async () => {
    const db = { ...baseDb(), screenAiJob: brokenModel };
    expect(await activeJobsReason('p', 'ml', db)).toBe(FENCE_CHECK_FAILED_REASON);
  });

  it('pecan run/job checks fail closed too (linked project set)', async () => {
    const db = { ...baseDb(), pecanSearchRun: brokenModel };
    expect(await activeJobsReason('p', 'ml', db)).toBe(FENCE_CHECK_FAILED_REASON);
    // …but with NO linked project the pecan checks are skipped entirely.
    expect(await activeJobsReason('p', '', db)).toBeNull();
  });

  it('an active pecan run blocks with the search-specific reason', async () => {
    const db = { ...baseDb(), pecanSearchRun: busyModel };
    expect(await activeJobsReason('p', 'ml', db)).toMatch(/automated search/i);
  });
});

describe('batchSearchRunId — legacy attribution (96.md D12)', () => {
  it('prefers the first-class searchRunId column', () => {
    expect(batchSearchRunId({ searchRunId: 'run-42', fileHash: 'pecan:other:x:1' })).toBe('run-42');
  });
  it('parses the legacy synthetic fileHash at read time', () => {
    expect(batchSearchRunId({ searchRunId: '', fileHash: 'pecan:run-7:pubmed:3' })).toBe('run-7');
  });
  it('returns "" for file/api batches and malformed hashes', () => {
    expect(batchSearchRunId({ searchRunId: '', fileHash: 'sha256abc' })).toBe('');
    expect(batchSearchRunId({ searchRunId: '', fileHash: 'pecan:' })).toBe('');
    expect(batchSearchRunId({ searchRunId: '', fileHash: null })).toBe('');
    expect(batchSearchRunId(null)).toBe('');
  });
});
