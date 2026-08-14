/**
 * prismaFlowLoader116.test.js — 116.md §15. The loader-level regression pack the
 * PRISMA engine never had — which is exactly how the production bug shipped:
 * prismaFlowService selected a nonexistent ScreenDecision column (`reason`; the
 * real column is `exclusionReason`), Prisma threw on EVERY call, safe() swallowed
 * it, and decisions were silently [] in production — every exclusion count 0,
 * every reason "not recorded", reconciliation still green.
 *
 * Pins:
 *  1. SELECT SHAPE — every column the loader selects exists in the REAL
 *     schema.prisma, per model. The mock throws on an unknown select key exactly
 *     like PrismaClientValidationError, so a reintroduced bad column fails the
 *     downstream count assertions too.
 *  2. Decisions reach the flow (excluded_screening + reasons populated).
 *  3. finalStatus='rejected' → excluded_full_text with rejectedReason (§15).
 *  4. A resolved ScreenConflict settles a T/A split as a resolved decision.
 *  5. importBatchId is selected (legacy fallback → origin 'file', not 'manual')
 *     and batch.sourceDatabase threads into the record's effective attribution.
 *  6. Phantom import-time duplicates still ride in via batch.duplicateCount.
 *  7. slimPrismaFlow ships NO id arrays (116.md §11) while keeping every count.
 *
 * All dependencies mocked → hermetic, no DB / HTTP.
 */
import { vi, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/* ── the real schema's columns, parsed from schema.prisma itself ─────────── */
const SCHEMA = readFileSync(
  new URL('../../../server/prisma/schema.prisma', import.meta.url), 'utf8',
);
function columnsOf(model) {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`model ${model} not found in schema.prisma`);
  const cols = new Set();
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('@@')) continue;
    const f = t.match(/^([A-Za-z]\w*)\s+\S/);
    if (f) cols.add(f[1]);
  }
  return cols;
}
const MODEL_NAMES = {
  screenRecord: 'ScreenRecord',
  screenDecision: 'ScreenDecision',
  screenConflict: 'ScreenConflict',
  screenRecordSource: 'ScreenRecordSource',
  fullTextCandidate: 'FullTextCandidate',
  fullTextRequest: 'FullTextRequest',
  screenPdfAttachment: 'ScreenPdfAttachment',
  screenImportBatch: 'ScreenImportBatch',
};

/* ── fixture data (the mock's answer per model) ──────────────────────────── */
const DATA = {
  screenRecord: [
    // r1 — excluded at T/A by unanimous reviewer decisions.
    { id: 'r1', sourceDb: 'PubMed', isDuplicate: false, isPrimary: false, duplicateGroupId: null, currentStage: 'title_abstract', finalStatus: '', promotedAt: null, rejectedReason: '', handoffStudyId: '', importBatchId: null, identificationSource: null, sourceDetail: null },
    // r2 — leader finalize-reject: ONLY ScreenRecord fields, no full_text decision row.
    { id: 'r2', sourceDb: 'PubMed', isDuplicate: false, isPrimary: false, duplicateGroupId: null, currentStage: 'full_text', finalStatus: 'rejected', promotedAt: new Date('2026-01-02'), rejectedReason: 'wrong population', handoffStudyId: '', importBatchId: null, identificationSource: null, sourceDetail: null },
    // r3 — split T/A votes resolved 'exclude' through a ScreenConflict.
    { id: 'r3', sourceDb: 'PubMed', isDuplicate: false, isPrimary: false, duplicateGroupId: null, currentStage: 'title_abstract', finalStatus: '', promotedAt: null, rejectedReason: 'Duplicate publication', handoffStudyId: '', importBatchId: null, identificationSource: null, sourceDetail: null },
    // r4 — accepted (included) with a handoff study id.
    { id: 'r4', sourceDb: 'PubMed', isDuplicate: false, isPrimary: false, duplicateGroupId: null, currentStage: 'full_text', finalStatus: 'accepted', promotedAt: new Date('2026-01-02'), rejectedReason: '', handoffStudyId: 'S1', importBatchId: null, identificationSource: null, sourceDetail: null },
    // r5 — legacy file import: NO ScreenRecordSource row; importBatchId is the
    // only origin signal, and its batch declares the database.
    { id: 'r5', sourceDb: '', isDuplicate: false, isPrimary: false, duplicateGroupId: null, currentStage: 'title_abstract', finalStatus: '', promotedAt: null, rejectedReason: '', handoffStudyId: '', importBatchId: 'b2', identificationSource: null, sourceDetail: null },
  ],
  screenDecision: [
    { recordId: 'r1', stage: 'title_abstract', decision: 'exclude', exclusionReason: 'off topic' },
    { recordId: 'r1', stage: 'title_abstract', decision: 'exclude', exclusionReason: '' },
    { recordId: 'r3', stage: 'title_abstract', decision: 'include', exclusionReason: '' },
    { recordId: 'r3', stage: 'title_abstract', decision: 'exclude', exclusionReason: '' },
    { recordId: 'r4', stage: 'full_text', decision: 'include', exclusionReason: '' },
  ],
  screenConflict: [
    { recordId: 'r3', finalDecision: 'exclude', resolvedAt: new Date('2026-01-05'), notes: 'Duplicate publication' },
    // An unresolved conflict must contribute nothing.
    { recordId: 'r1', finalDecision: '', resolvedAt: null, notes: '' },
  ],
  screenRecordSource: [
    // r1-r4 entered through an automated search (db arm); r5 deliberately has NO
    // source row — its importBatchId is the only origin signal (legacy fallback).
    { screenRecordId: 'r1', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
    { screenRecordId: 'r2', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
    { screenRecordId: 'r3', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
    { screenRecordId: 'r4', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
  ],
  fullTextCandidate: [],
  fullTextRequest: [],
  screenPdfAttachment: [],
  screenImportBatch: [
    { id: 'b1', duplicateCount: 3, sourceDatabase: '', contributesToReview: true, source: 'file', filename: 'upload.ris', format: 'RIS', createdAt: new Date('2026-01-01') },
    { id: 'b2', duplicateCount: 0, sourceDatabase: 'embase', contributesToReview: true, source: 'file', filename: 'embase.ris', format: 'RIS', createdAt: new Date('2026-01-01') },
  ],
};

const calls = [];
const prismaMock = {};
for (const [client, model] of Object.entries(MODEL_NAMES)) {
  prismaMock[client] = {
    findMany: vi.fn(async (args) => {
      calls.push({ client, args });
      // Mimic PrismaClientValidationError for an unknown select column — the
      // exact failure mode that shipped the bug (and safe() then swallows).
      const cols = columnsOf(model);
      for (const key of Object.keys(args?.select || {})) {
        if (!cols.has(key)) {
          throw new Error(`Unknown field \`${key}\` for select statement on model \`${model}\``);
        }
      }
      return DATA[client] || [];
    }),
  };
}
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { loadPrismaFlow, slimPrismaFlow } = await import('../../../server/screening/prismaFlowService.js');

describe('loadPrismaFlow — select shape matches the real schema (116.md §15)', () => {
  it('selects only real columns on every model (and therefore loads real data)', async () => {
    calls.length = 0;
    const result = await loadPrismaFlow('p1');
    expect(result).toBeTruthy();
    // Every findMany the loader issued named only real schema columns —
    // asserted explicitly so a future bad column fails HERE with the model name,
    // not three assertions later.
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) {
      const cols = columnsOf(MODEL_NAMES[c.client]);
      for (const key of Object.keys(c.args?.select || {})) {
        expect(cols.has(key), `${c.client}.findMany selects nonexistent column "${key}"`).toBe(true);
      }
    }
    // The decision select must carry the REAL reason column.
    const dec = calls.find((c) => c.client === 'screenDecision');
    expect(Object.keys(dec.args.select)).toContain('exclusionReason');
    // …and the record select must carry the legacy-fallback batch link + the
    // per-record identification override columns.
    const rec = calls.find((c) => c.client === 'screenRecord');
    expect(Object.keys(rec.args.select)).toEqual(
      expect.arrayContaining(['importBatchId', 'identificationSource', 'sourceDetail', 'rejectedReason']),
    );
  });
});

describe('loadPrismaFlow — dispositions from decisions, final review and conflicts', () => {
  it('maps every fixture record to the box the domain says it belongs in', async () => {
    const { flow, reconciliation } = await loadPrismaFlow('p1');

    // r1 — unanimous T/A exclusion (was ALWAYS 0 in production before the fix).
    expect(flow.boxes.excluded_screening.ids).toContain('r1');
    // r3 — split votes + resolved conflict ⇒ excluded at T/A, not "awaiting".
    expect(flow.boxes.excluded_screening.ids).toContain('r3');
    // r2 — leader reject ⇒ excluded_full_text with the record-level reason.
    expect(flow.boxes.excluded_full_text_db.ids).toContain('r2');
    const reasons = Object.fromEntries(flow.exclusionReasons.map((r) => [r.label, r.n]));
    expect(reasons['Wrong population']).toBe(1); // §16 conservative sentence-case
    // r4 — accepted ⇒ included.
    expect(flow.boxes.included_reports.ids).toContain('r4');

    // r5 — batch-declared database: db arm, labelled Embase (record.sourceDb ||
    // batch.sourceDatabase), via the importBatchId legacy fallback.
    expect(flow.boxes.identified_db.ids).toContain('r5');
    expect(flow.sources.db.map((s) => s.label)).toContain('Embase');

    // Phantom import-time duplicates (batch.duplicateCount) still counted…
    expect(flow.counts.unrecordedDuplicates).toBe(3);
    // …but 116.md §13 (r2) RE-PINS WHERE. Batch b1 declares no database, has the
    // default `file` kind and left no surviving records, so its 3 discarded
    // duplicates are NOT a database search: crediting them to identified_db /
    // removed_before_screening (what this test used to assert) fabricated a
    // 3-record database column for a project that never searched one.
    expect(flow.counts.unrecordedDuplicatesDb).toBe(0);
    expect(flow.counts.unrecordedDuplicatesOther).toBe(3);
    expect(flow.boxes.removed_before_screening.n).toBe(0);
    expect(flow.boxes.identified_other.n).toBe(3);
    // The project-level duplicate total is unchanged — nothing was lost, only
    // re-attributed.
    expect(flow.counts.duplicatesRemoved).toBe(3);

    expect(reconciliation.ok).toBe(true);
  });
});

/* ════════ 116.md §13/§14 (r2) — the adversarial-review repairs ════════ */

describe('loadPrismaFlow — a retracted batch stops attributing its records (§14 r2)', () => {
  it('contributesToReview:false withdraws the declared database from PRISMA too', async () => {
    // 104.md: unticking "contributes to the review" means "Excluded from the
    // reported search methodology" — searchProvenanceService drops the batch, so the
    // Methods text stops naming Embase. PRISMA was the only consumer of
    // ScreenImportBatch.sourceDatabase that ignored the flag, so the DIAGRAM kept
    // drawing those records under "Embase": the exact §15 diagram-vs-manuscript
    // contradiction the record-derived engine exists to make impossible.
    const b2 = DATA.screenImportBatch.find((b) => b.id === 'b2');
    b2.contributesToReview = false;
    try {
      const { flow } = await loadPrismaFlow('p1');
      expect(flow.sources.db.map((s) => s.label)).not.toContain('Embase');
      // r5's only attribution was that declaration, so it falls to the D6(c)
      // other-methods path — which is what the Methods text now claims.
      expect(flow.boxes.identified_other.ids).toContain('r5');
      expect(flow.boxes.identified_db.ids).not.toContain('r5');
    } finally {
      b2.contributesToReview = true;
    }
  });

  it('an un-migrated client (no such column) still counts every batch', async () => {
    // The extended select must degrade to the legacy one rather than being swallowed
    // into [] — that would silently zero unrecordedDuplicates.
    const original = prismaMock.screenImportBatch.findMany;
    prismaMock.screenImportBatch.findMany = vi.fn(async (args) => {
      if (Object.prototype.hasOwnProperty.call(args?.select || {}, 'contributesToReview')) {
        throw new Error('Unknown field `contributesToReview` for select statement on model `ScreenImportBatch`');
      }
      return DATA.screenImportBatch.map(({ id, duplicateCount, sourceDatabase }) => ({ id, duplicateCount, sourceDatabase }));
    });
    try {
      const { flow } = await loadPrismaFlow('p1');
      expect(flow.counts.unrecordedDuplicates).toBe(3);
      expect(flow.sources.db.map((s) => s.label)).toContain('Embase');
    } finally {
      prismaMock.screenImportBatch.findMany = original;
    }
  });
});

describe('loadPrismaFlow — batch discards follow their batch\'s arm (§13 r2)', () => {
  it('a declared-database batch keeps its discards in the database column', async () => {
    const b1 = DATA.screenImportBatch.find((b) => b.id === 'b1');
    b1.sourceDatabase = 'scopus';
    try {
      const { flow } = await loadPrismaFlow('p1');
      expect(flow.counts.unrecordedDuplicatesDb).toBe(3);
      expect(flow.boxes.removed_before_screening.n).toBe(3);
    } finally {
      b1.sourceDatabase = '';
    }
  });

  it('a Pecan/API batch keeps its discards in the database column even undeclared', async () => {
    // An EXECUTED search really did query a database; only a bare file upload did not.
    const b1 = DATA.screenImportBatch.find((b) => b.id === 'b1');
    b1.source = 'pecan-search';
    try {
      const { flow } = await loadPrismaFlow('p1');
      expect(flow.counts.unrecordedDuplicatesDb).toBe(3);
    } finally {
      b1.source = 'file';
    }
  });

  it('the loader returns its scan so the inspector need not repeat it (§11 r2)', async () => {
    const result = await loadPrismaFlow('p1', {
      recordSelect: { title: true },
      recordOrderBy: [{ id: 'asc' }],
    });
    expect(result.records).toHaveLength(DATA.screenRecord.length);
    expect(result.batches).toHaveLength(DATA.screenImportBatch.length);
    const call = prismaMock.screenRecord.findMany.mock.calls.at(-1)[0];
    expect(call.select.title).toBe(true);
    expect(call.select.identificationSource).toBe(true); // base columns preserved
    expect(call.orderBy).toEqual([{ id: 'asc' }]);
  });
});

describe('slimPrismaFlow — the §11 wire shape', () => {
  it('strips every id array while keeping every count and label', async () => {
    const { flow } = await loadPrismaFlow('p1');
    const slim = slimPrismaFlow(flow);

    // No ids anywhere in the slim shape.
    const json = JSON.stringify(slim);
    expect(json).not.toContain('"ids"');
    // Counts and labels survive untouched.
    expect(slim.boxes.excluded_screening.n).toBe(flow.boxes.excluded_screening.n);
    expect(slim.boxes.identified_db.n).toBe(flow.boxes.identified_db.n);
    expect(slim.counts).toEqual(flow.counts);
    expect(slim.exclusionReasons.map((r) => [r.label, r.n]))
      .toEqual(flow.exclusionReasons.map((r) => [r.label, r.n]));
    expect(slim.sources.db.map((r) => r.label)).toEqual(flow.sources.db.map((r) => r.label));
    // The reconciliation report rides along for the client banner.
    expect(slim.reconciliation).toBeTruthy();
  });
});
