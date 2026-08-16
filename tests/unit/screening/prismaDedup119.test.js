/**
 * prismaDedup119.test.js — 119.md §1. The regression pack for PRISMA's automatic
 * deduplication accounting, implementing §1's required fixture list against the
 * REAL loader (server/screening/prismaFlowService.js) and the REAL engine
 * (src/research-engine/prisma).
 *
 * ── THE DEFECT THIS PACK EXISTS FOR ─────────────────────────────────────────
 * The Pecan search engine classifies cross-source duplicates BEFORE landing
 * (pipeline.js lands only 'new' and 'ambiguous'), so those retrievals never become
 * ScreenRecords and never touch a batch's duplicateCount. loadPrismaFlow read only
 * records + batches, so for EVERY automated search GET /prisma — and therefore the
 * manuscript diagram and the DOCX export — under-reported both "records identified"
 * and "duplicate records removed" by exactDup+fuzzyDup, while getMetaLabSummary
 * (the dashboard) folded them in and showed different numbers on the same project.
 *
 * Fixtures (119.md §1, verbatim): no duplicates · one duplicate pair · a three-record
 * group · multiple groups · duplicates across different databases · repeated
 * appearances within one database · DOI match with formatting differences · PMID
 * match · automatic and manual deduplication together · restoration of a removed
 * record · re-running the same automated search · updating a living review · deleting
 * or reverting an import batch · multiple reports belonging to one study · refresh and
 * cross-browser consistency · existing-project migration and backfill.
 * (The DOI-formatting and PMID-match fixtures are landing-level behaviour and are
 * pinned in importDedup119.test.js; here they are pinned as flow ARITHMETIC — an
 * instance removed on any basis moves identified and removed together.)
 *
 * Every fixture also asserts the structural reconciliation stays green, because the
 * original loss was INVISIBLE to reconciliation: the identities are derived from the
 * same records, so a duplicate the loader never learned about balanced perfectly.
 *
 * Hermetic: prisma mocked; no DB, no HTTP.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

/* ── a configurable in-memory database ───────────────────────────────────── */
const db = {
  screenRecord: [], screenDecision: [], screenConflict: [], screenRecordSource: [],
  fullTextCandidate: [], fullTextRequest: [], screenPdfAttachment: [],
  screenImportBatch: [], pecanSearchSource: [],
};

const prismaMock = {};
for (const model of Object.keys(db)) {
  prismaMock[model] = { findMany: vi.fn(async () => db[model]) };
}
// PecanSearchSource is queried through its RUN, and the rolled-back filter is the
// contract that keeps a screening reset from over-reporting forever (96.md D11) —
// so the mock HONOURS the where clause instead of returning everything.
prismaMock.pecanSearchSource.findMany = vi.fn(async ({ where }) => {
  const want = where?.run?.screenProjectId?.in || [];
  return db.pecanSearchSource.filter(
    (s) => want.includes(s.screenProjectId) && !s.rolledBackAt,
  );
});
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { loadPrismaFlow } = await import('../../../server/screening/prismaFlowService.js');
const { derivePrismaFlow } = await import('../../../src/research-engine/prisma/index.js');

/* ── fixture builders ────────────────────────────────────────────────────── */
let seq = 0;
const rec = (over = {}) => ({
  id: over.id || `r${++seq}`,
  sourceDb: 'PubMed', isDuplicate: false, isPrimary: false, duplicateGroupId: null,
  currentStage: 'title_abstract', finalStatus: '', promotedAt: null, rejectedReason: '',
  handoffStudyId: '', importBatchId: null, identificationSource: null, sourceDetail: null,
  ...over,
});
/** A record that entered through an automated search (database arm). */
const searched = (id, over = {}) => rec({ id, ...over });
const src = (id, over = {}) => ({
  screenRecordId: id, origin: 'search', runId: 'run1', batchId: '', outcome: 'new', ...over,
});
const batch = (over = {}) => ({
  id: 'b1', duplicateCount: 0, sourceDatabase: '', contributesToReview: true, source: 'file',
  filename: 'f.ris', format: 'RIS', createdAt: new Date('2026-01-01'), supersedesBatchId: '',
  ...over,
});
const engineSource = (over = {}) => ({
  screenProjectId: 'p1', rolledBackAt: null, runId: 'run1', provider: 'pubmed',
  exactDupCount: 0, fuzzyDupCount: 0, ...over,
});

/** Load and assert the structural identities all balance. */
async function load() {
  const out = await loadPrismaFlow('p1');
  expect(out).toBeTruthy();
  const failures = (out.reconciliation.checks || []).filter((c) => !c.ok);
  expect(failures.map((f) => f.id)).toEqual([]);
  return out.flow;
}

beforeEach(() => {
  seq = 0;
  for (const k of Object.keys(db)) db[k] = [];
});

/* ════════════════ the record-level fixtures ════════════════ */

describe('119.md §1 — record-level duplicate fixtures', () => {
  it('no duplicates: nothing is removed', async () => {
    db.screenRecord = [searched('r1'), searched('r2')];
    db.screenRecordSource = [src('r1'), src('r2')];
    const flow = await load();
    expect(flow.counts.identified).toBe(2);
    expect(flow.counts.duplicatesRemoved).toBe(0);
    expect(flow.counts.screened).toBe(2);
  });

  it('one duplicate pair: one retained, ONE removed', async () => {
    db.screenRecord = [
      searched('r1', { isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { isDuplicate: true, duplicateGroupId: 'g1' }),
    ];
    db.screenRecordSource = [src('r1'), src('r2')];
    const flow = await load();
    expect(flow.counts.identified).toBe(2);
    expect(flow.counts.duplicatesRemoved).toBe(1);
    expect(flow.counts.screened).toBe(1);
  });

  it('a three-record group: one retained, TWO removed (instances, not groups)', async () => {
    db.screenRecord = [
      searched('r1', { isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { isDuplicate: true, duplicateGroupId: 'g1' }),
      searched('r3', { isDuplicate: true, duplicateGroupId: 'g1' }),
    ];
    db.screenRecordSource = [src('r1'), src('r2'), src('r3')];
    const flow = await load();
    expect(flow.counts.duplicatesRemoved).toBe(2);   // ← 119.md's worked example
    expect(flow.counts.screened).toBe(1);
    expect(flow.dispositions.removed_duplicate.ids.sort()).toEqual(['r2', 'r3']);
  });

  it('multiple duplicate groups sum their instances', async () => {
    db.screenRecord = [
      searched('r1', { isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { isDuplicate: true, duplicateGroupId: 'g1' }),
      searched('r3', { isPrimary: true, duplicateGroupId: 'g2' }),
      searched('r4', { isDuplicate: true, duplicateGroupId: 'g2' }),
      searched('r5', { isDuplicate: true, duplicateGroupId: 'g2' }),
      searched('r6'),
    ];
    db.screenRecordSource = db.screenRecord.map((r) => src(r.id));
    const flow = await load();
    expect(flow.counts.duplicatesRemoved).toBe(3);
    expect(flow.counts.screened).toBe(3);
  });

  it('duplicates ACROSS different databases stay one removal each', async () => {
    db.screenRecord = [
      searched('r1', { sourceDb: 'PubMed', isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { sourceDb: 'Embase', isDuplicate: true, duplicateGroupId: 'g1' }),
      searched('r3', { sourceDb: 'Scopus', isDuplicate: true, duplicateGroupId: 'g1' }),
    ];
    db.screenRecordSource = db.screenRecord.map((r) => src(r.id));
    const flow = await load();
    expect(flow.counts.identified).toBe(3);
    expect(flow.counts.duplicatesRemoved).toBe(2);
    // Identification still names all three databases — a record is identified where
    // it was found, even when it was later removed as a duplicate.
    expect(flow.sources.db.map((s) => s.label).sort()).toEqual(['Embase', 'PubMed', 'Scopus']);
  });

  it('automatic and manual deduplication together are counted ONCE each', async () => {
    // g1 was auto-flagged by the worker and never reviewed; g2 was confirmed by a
    // human. Both are the same terminal state, so neither is counted twice — the
    // disposition is single-valued by construction (prisma/model.js).
    db.screenRecord = [
      searched('r1', { isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { isDuplicate: true, duplicateGroupId: 'g1' }),
      searched('r3', { isPrimary: true, duplicateGroupId: 'g2' }),
      searched('r4', { isDuplicate: true, duplicateGroupId: 'g2' }),
    ];
    db.screenRecordSource = db.screenRecord.map((r) => src(r.id));
    // …and an import-time discard on top: phantom + record-level are disjoint sets.
    db.screenImportBatch = [batch({ id: 'b1', duplicateCount: 1, sourceDatabase: 'pubmed' })];
    const flow = await load();
    expect(flow.counts.duplicatesRemoved).toBe(3);   // 2 record-level + 1 phantom
    expect(flow.counts.identified).toBe(5);          // 4 records + 1 phantom
    expect(flow.counts.screened).toBe(2);
  });

  it('restoring a removed record moves identified and removed back together', async () => {
    db.screenRecord = [
      searched('r1', { isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { isDuplicate: true, duplicateGroupId: 'g1' }),
    ];
    db.screenRecordSource = [src('r1'), src('r2')];
    expect((await load()).counts.duplicatesRemoved).toBe(1);

    // "Not duplicates — keep all" clears the flags on the live records; the count is
    // DERIVED, so it falls without any event being un-written.
    db.screenRecord = [searched('r1'), searched('r2')];
    const after = await load();
    expect(after.counts.duplicatesRemoved).toBe(0);
    expect(after.counts.screened).toBe(2);
  });

  it('multiple reports of one study: reports and studies differ, duplicates do not', async () => {
    db.screenRecord = [
      searched('r1', { currentStage: 'full_text', finalStatus: 'accepted', handoffStudyId: 'S1' }),
      searched('r2', { currentStage: 'full_text', finalStatus: 'accepted', handoffStudyId: 'S1' }),
      searched('r3', { currentStage: 'full_text', finalStatus: 'accepted', handoffStudyId: 'S2' }),
    ];
    db.screenRecordSource = db.screenRecord.map((r) => src(r.id));
    const flow = await load();
    expect(flow.counts.includedReports).toBe(3);
    expect(flow.counts.included).toBe(2);
    expect(flow.studies.multiReport).toBe(true);
    // A second report of one study is NOT a duplicate record.
    expect(flow.counts.duplicatesRemoved).toBe(0);
  });
});

/* ════════════════ the automated-search gap (the headline defect) ════════════════ */

describe('119.md §1 — the Pecan engine\'s pre-landing duplicates reach the flow', () => {
  beforeEach(() => {
    db.screenRecord = [searched('r1'), searched('r2')];
    db.screenRecordSource = [src('r1'), src('r2')];
    // A pecan landing batch: engine dups never reach it, so it carries 0.
    db.screenImportBatch = [batch({ id: 'b1', source: 'pecan-search', duplicateCount: 0 })];
  });

  it('exact AND fuzzy engine duplicates raise identified and duplicatesRemoved', async () => {
    db.pecanSearchSource = [engineSource({ exactDupCount: 5, fuzzyDupCount: 2 })];
    const flow = await load();
    // Before the repair: identified 2, duplicatesRemoved 0 — the engine's 7 removals
    // existed only on PecanSearchSource and the figure silently omitted them.
    expect(flow.counts.identified).toBe(9);
    expect(flow.counts.duplicatesRemoved).toBe(7);
    expect(flow.counts.screened).toBe(2);
  });

  it('credits them to the DATABASE arm, where a provider search belongs', async () => {
    db.pecanSearchSource = [engineSource({ provider: 'pubmed', exactDupCount: 3 })];
    const flow = await load();
    expect(flow.counts.identifiedDb).toBe(5);
    expect(flow.counts.identifiedOther).toBe(0);
    expect(flow.boxes.removed_before_screening.n).toBe(3);
    expect(flow.counts.unrecordedDuplicatesDb).toBe(3);
  });

  it('labels them "Removed during automated search", never "Discarded at import"', async () => {
    db.pecanSearchSource = [engineSource({ exactDupCount: 4 })];
    const flow = await load();
    const rows = Object.fromEntries(flow.removedBreakdown.byStage.map((r) => [r.key, r]));
    expect(rows.search_discarded.n).toBe(4);
    expect(rows.search_discarded.label).toBe('Removed during automated search (not stored as records)');
    expect(rows.import_discarded).toBeUndefined();
    // ids stay empty — the copy was never stored, so it can never be inspected.
    expect(rows.search_discarded.ids).toEqual([]);
  });

  it('keeps the import and search stage lines SEPARATE when both exist', async () => {
    db.screenImportBatch = [batch({ id: 'b1', duplicateCount: 6, sourceDatabase: 'embase' })];
    db.pecanSearchSource = [engineSource({ exactDupCount: 4 })];
    const flow = await load();
    const rows = Object.fromEntries(flow.removedBreakdown.byStage.map((r) => [r.key, r.n]));
    expect(rows.search_discarded).toBe(4);
    expect(rows.import_discarded).toBe(6);
    expect(flow.counts.duplicatesRemoved).toBe(10);
  });

  it('several sources across several runs all contribute', async () => {
    db.pecanSearchSource = [
      engineSource({ runId: 'run1', provider: 'pubmed', exactDupCount: 2 }),
      engineSource({ runId: 'run1', provider: 'embase', exactDupCount: 3, fuzzyDupCount: 1 }),
      engineSource({ runId: 'run2', provider: 'scopus', exactDupCount: 4 }),
    ];
    const flow = await load();
    expect(flow.counts.duplicatesRemoved).toBe(10);
  });

  it('re-running the same automated search does NOT inflate the counts', async () => {
    // A re-run re-finds every record as existing_match, which is counted NOWHERE
    // (prismaDerive.js rerun safety). exact/fuzzy are duplicates of records NEW to
    // the project, so the second run's own source row adds only what it truly removed.
    db.pecanSearchSource = [engineSource({ runId: 'run1', exactDupCount: 3 })];
    const first = await load();
    db.pecanSearchSource = [
      engineSource({ runId: 'run1', exactDupCount: 3 }),
      // the re-run: everything was an existing match, nothing new was removed
      engineSource({ runId: 'run2', exactDupCount: 0, fuzzyDupCount: 0 }),
    ];
    const second = await load();
    expect(second.counts.identified).toBe(first.counts.identified);
    expect(second.counts.duplicatesRemoved).toBe(first.counts.duplicatesRemoved);
  });

  it('a living-review update behaves the same way (it runs the same pipeline)', async () => {
    db.pecanSearchSource = [engineSource({ runId: 'run1', exactDupCount: 3 })];
    const before = await load();
    // The living update finds one genuinely new record and removes one new duplicate.
    db.screenRecord = [...db.screenRecord, searched('r3')];
    db.screenRecordSource = [...db.screenRecordSource, src('r3', { runId: 'living1' })];
    db.pecanSearchSource = [
      engineSource({ runId: 'run1', exactDupCount: 3 }),
      engineSource({ runId: 'living1', exactDupCount: 1 }),
    ];
    const after = await load();
    expect(after.counts.identified).toBe(before.counts.identified + 2);
    expect(after.counts.duplicatesRemoved).toBe(before.counts.duplicatesRemoved + 1);
  });

  it('a ROLLED-BACK run contributes nothing (a reset must not over-report forever)', async () => {
    db.pecanSearchSource = [
      engineSource({ runId: 'run1', exactDupCount: 3 }),
      engineSource({ runId: 'run2', exactDupCount: 99, rolledBackAt: new Date('2026-02-01') }),
    ];
    const flow = await load();
    expect(flow.counts.duplicatesRemoved).toBe(3);
  });

  it('another project\'s runs never leak in', async () => {
    db.pecanSearchSource = [
      engineSource({ screenProjectId: 'p1', exactDupCount: 2 }),
      engineSource({ screenProjectId: 'p2', exactDupCount: 50 }),
    ];
    expect((await load()).counts.duplicatesRemoved).toBe(2);
  });
});

/* ════════════════ batch lifecycle ════════════════ */

describe('119.md §1 — import batch lifecycle', () => {
  beforeEach(() => {
    db.screenRecord = [rec({ id: 'r1', sourceDb: '', importBatchId: 'b1' }), rec({ id: 'r2', sourceDb: '', importBatchId: 'b1' })];
  });

  it('repeated appearances within ONE database file are counted per instance', async () => {
    db.screenImportBatch = [batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed' })];
    const flow = await load();
    expect(flow.counts.identified).toBe(4);        // 2 kept + 2 discarded copies
    expect(flow.counts.duplicatesRemoved).toBe(2);
    expect(flow.counts.screened).toBe(2);
  });

  it('a FORCED re-import of the same file leaves every count unchanged', async () => {
    db.screenImportBatch = [batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed' })];
    const before = await load();
    expect([before.counts.identified, before.counts.duplicatesRemoved]).toEqual([4, 2]);

    // The live repro: the force re-upload lands nothing and records duplicateCount 4.
    // Before the repair this took identified 4 → 8 and duplicatesRemoved 2 → 6.
    db.screenImportBatch = [
      batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed', supersededById: 'b2' }),
      batch({ id: 'b2', duplicateCount: 4, sourceDatabase: 'pubmed', supersedesBatchId: 'b1' }),
    ];
    const after = await load();
    expect([after.counts.identified, after.counts.duplicatesRemoved]).toEqual([4, 2]);
  });

  it('deleting an import batch removes its phantom accounting', async () => {
    db.screenImportBatch = [
      batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed' }),
      batch({ id: 'b2', duplicateCount: 5, sourceDatabase: 'embase' }),
    ];
    expect((await load()).counts.duplicatesRemoved).toBe(7);
    db.screenImportBatch = [batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed' })];
    expect((await load()).counts.duplicatesRemoved).toBe(2);
  });

  it('MIGRATION: a legacy batch row with no lineage column still counts', async () => {
    // Existing projects were written before `supersedesBatchId` existed. `undefined`
    // must read as "not a repeat" so no historical count changes on deploy.
    const legacy = batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed' });
    delete legacy.supersedesBatchId;
    db.screenImportBatch = [legacy];
    const flow = await load();
    expect(flow.counts.duplicatesRemoved).toBe(2);
    expect(flow.counts.identified).toBe(4);
  });

  it('citation-mining discards are attributed to the OTHER-METHODS arm by declaration', async () => {
    db.screenRecord = [];
    db.screenImportBatch = [batch({ id: 'b1', source: 'citation-mining', duplicateCount: 3 })];
    // One record so the flow is non-empty, entering through citation mining.
    db.screenRecord = [rec({ id: 'r1', sourceDb: '', importBatchId: 'b9' })];
    db.screenRecordSource = [src('r1', { origin: 'mining', runId: '', batchId: 'b9' })];
    const flow = await load();
    expect(flow.counts.unrecordedDuplicatesOther).toBe(3);
    expect(flow.counts.unrecordedDuplicatesDb).toBe(0);
  });
});

/* ════════════════ determinism + the engine's own contract ════════════════ */

describe('119.md §1 — derivation is stateless (refresh / cross-browser consistency)', () => {
  it('two consecutive loads of identical data return identical counts', async () => {
    db.screenRecord = [
      searched('r1', { isPrimary: true, duplicateGroupId: 'g1' }),
      searched('r2', { isDuplicate: true, duplicateGroupId: 'g1' }),
    ];
    db.screenRecordSource = [src('r1'), src('r2')];
    db.screenImportBatch = [batch({ id: 'b1', duplicateCount: 2, sourceDatabase: 'pubmed' })];
    db.pecanSearchSource = [engineSource({ exactDupCount: 3, fuzzyDupCount: 1 })];
    const a = await load();
    const b = await load();
    expect(b.counts).toEqual(a.counts);
    // Nothing is cached client-side: every number above came from the live tables.
    expect(a.counts.duplicatesRemoved).toBe(7);   // 1 record + 2 import + 4 engine
  });
});

describe('119.md §1 — derivePrismaFlow phantom stage input (back-compatible)', () => {
  const one = [{ id: 'x1', origin: 'search', sourceDb: 'PubMed' }];

  it('a bare number still means the database arm, labelled as an import discard', () => {
    const flow = derivePrismaFlow(one, { unrecordedDuplicates: 4 });
    expect(flow.counts.duplicatesRemovedDb).toBe(4);
    expect(flow.removedBreakdown.byStage[0].key).toBe('import_discarded');
  });

  it('{db,other} without a search share keeps the exact previous labelling', () => {
    const flow = derivePrismaFlow(one, { unrecordedDuplicates: { db: 2, other: 3 } });
    expect(flow.removedBreakdown.byStage[0].key).toBe('import_discarded');
    expect(flow.removedBreakdown.otherArm.byStage[0].key).toBe('import_discarded');
  });

  it('a search share larger than the arm total is clamped, never negative', () => {
    const flow = derivePrismaFlow(one, { unrecordedDuplicates: { db: 2, dbSearch: 99 } });
    const rows = flow.removedBreakdown.byStage;
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('search_discarded');
    expect(rows[0].n).toBe(2);
    // The stage rows still partition the duplicates exactly.
    expect(rows.reduce((a, r) => a + r.n, 0)).toBe(flow.removedBreakdown.duplicate.n);
  });
});
