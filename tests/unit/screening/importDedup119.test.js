/**
 * importDedup119.test.js — 119.md §1, the IMPORT LANDING half of the deduplication
 * repair. Companion to prismaDedup119.test.js (the flow/consumer half).
 *
 * What this pins:
 *  1. Per-INSTANCE accounting, not per-group: three copies of one article leave one
 *     retained record and TWO duplicates removed (119.md's worked example).
 *  2. FORCE RE-IMPORT IDEMPOTENCY. A forced re-upload of a file whose sha256 already
 *     landed is stamped `supersedesBatchId`, which is what removes it from PRISMA's
 *     phantom accounting. Live repro before the fix: identified 4 → 8 and
 *     duplicatesRemoved 2 → 6 on one re-upload, permanently.
 *  3. A genuinely DIFFERENT file (an overlapping export from a second database) is
 *     NOT superseded — it still adds instances, as PRISMA requires.
 *  4. The dedup AUDIT trail: one ScreenDedupEvent per removed instance, carrying the
 *     match basis (DOI / PMID / title) — the thing the count alone could never say.
 *     DOI matching survives formatting differences (case, whitespace, doi.org
 *     prefix); PMID matching is exact.
 *  5. AUDIT ONLY — the batch's duplicateCount (what PRISMA reads) is identical
 *     whether or not the event table exists.
 *
 * Hermetic: prisma mocked; the REAL parsers + dedupeAndInsertRecords run.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const store = {
  batches: [],          // every ScreenImportBatch.create payload, with its id
  batchUpdates: [],
  records: [],          // "already in the project" — seeds the landing's dedupe sets
  createManyRows: [],
  insertedForBatch: [],
  dedupEvents: [],
};

let batchSeq = 0;
const prismaMock = {
  screenRecord: {
    findMany: vi.fn(async (args) => {
      // The landing reads the project's existing identity columns first, then reads
      // back the rows it just inserted (filtered by importBatchId).
      if (args?.where?.importBatchId) return store.insertedForBatch;
      return store.records.map((r) => ({ id: r.id, doi: r.doi, pmid: r.pmid, title: r.title }));
    }),
    createMany: vi.fn(async ({ data }) => {
      store.createManyRows.push(...data);
      store.insertedForBatch = data.map((r, i) => ({
        id: `ins${store.records.length + i}`, doi: r.doi, pmid: r.pmid, title: r.title,
      }));
      // The inserted rows become part of "the project" for any later import.
      store.records.push(...store.insertedForBatch);
      return { count: data.length };
    }),
    count: vi.fn(async () => store.records.length),
  },
  screenImportBatch: {
    create: vi.fn(async ({ data }) => {
      const row = { id: `batch${++batchSeq}`, createdAt: new Date(2026, 0, batchSeq), ...data };
      store.batches.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }) => {
      store.batchUpdates.push({ where, data });
      const b = store.batches.find((x) => x.id === where.id);
      if (b) Object.assign(b, data);
      return b || {};
    }),
    findFirst: vi.fn(async ({ where, orderBy }) => {
      const hits = store.batches
        .filter((b) => b.projectId === where.projectId && b.fileHash === where.fileHash)
        .sort((a, b) => a.createdAt - b.createdAt);
      return (orderBy && orderBy.createdAt === 'desc' ? hits[hits.length - 1] : hits[0]) || null;
    }),
  },
  screenRecordSource: {
    findMany: vi.fn(async () => []),
    createMany: vi.fn(async ({ data }) => ({ count: data.length })),
  },
  screenDecision: { createMany: vi.fn(async ({ data }) => ({ count: data.length })) },
  screenDedupEvent: {
    createMany: vi.fn(async ({ data }) => { store.dedupEvents.push(...data); return { count: data.length }; }),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { parseImportContent, dedupeAndInsertRecords } =
  await import('../../../server/services/screeningImportService.js');

/** A RIS file: 3 identical copies of one article + 1 unique — the live repro. */
const THREE_COPIES_PLUS_ONE = [
  'TY  - JOUR', 'TI  - Aspirin for headache', 'PY  - 2021', 'DO  - 10.1/aaa', 'ER  -',
  'TY  - JOUR', 'TI  - Aspirin for headache', 'PY  - 2021', 'DO  - 10.1/aaa', 'ER  -',
  'TY  - JOUR', 'TI  - Aspirin for headache', 'PY  - 2021', 'DO  - 10.1/aaa', 'ER  -',
  'TY  - JOUR', 'TI  - Ibuprofen for fever', 'PY  - 2022', 'DO  - 10.1/bbb', 'ER  -', '',
].join('\n');

const land = async (content, opts) => {
  const { records, detectedFormat } = parseImportContent(content, { format: 'ris' });
  return dedupeAndInsertRecords('p1', records, { format: detectedFormat, filename: 'f.ris', ...opts });
};

beforeEach(() => {
  vi.clearAllMocks();
  batchSeq = 0;
  store.batches = []; store.batchUpdates = []; store.records = [];
  store.createManyRows = []; store.insertedForBatch = []; store.dedupEvents = [];
});

describe('119.md §1 — instances, not groups', () => {
  it('three copies of one article leave one record and TWO duplicates removed', async () => {
    const res = await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
    expect(res.imported).toBe(2);            // one Aspirin + one Ibuprofen
    expect(res.skippedDuplicates).toBe(2);   // the 2nd and 3rd copies, individually
    const batch = store.batches[0];
    expect(batch.preDedupCount).toBe(4);
    expect(batch.duplicateCount).toBe(2);    // ← what PRISMA counts
  });

  it('two matching records leave one retained and ONE duplicate removed', async () => {
    const pair = [
      'TY  - JOUR', 'TI  - Only study', 'DO  - 10.1/ccc', 'ER  -',
      'TY  - JOUR', 'TI  - Only study', 'DO  - 10.1/ccc', 'ER  -', '',
    ].join('\n');
    const res = await land(pair, { fileHash: 'hash-pair' });
    expect(res.imported).toBe(1);
    expect(res.skippedDuplicates).toBe(1);
  });

  it('a file with no duplicates removes nothing', async () => {
    const clean = [
      'TY  - JOUR', 'TI  - Study one', 'DO  - 10.1/d1', 'ER  -',
      'TY  - JOUR', 'TI  - Study two', 'DO  - 10.1/d2', 'ER  -', '',
    ].join('\n');
    const res = await land(clean, { fileHash: 'hash-clean' });
    expect(res.imported).toBe(2);
    expect(res.skippedDuplicates).toBe(0);
    expect(store.batches[0].duplicateCount).toBe(0);
    expect(store.dedupEvents).toHaveLength(0);
  });
});

describe('119.md §1 — force re-import must be idempotent', () => {
  it('stamps the re-import with the batch it repeats, and back-links the original', async () => {
    await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
    const again = await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });

    // Nothing new landed: every row matched a record that is already in the project.
    expect(again.imported).toBe(0);
    expect(again.skippedDuplicates).toBe(4);

    const [first, second] = store.batches;
    // The ORIGINAL keeps its accounting — its records are the ones in the project.
    expect(first.supersedesBatchId).toBe('');
    expect(first.duplicateCount).toBe(2);
    // The RE-IMPORT names the batch it repeats. dedupCounts.isSupersededImport reads
    // exactly this field, so its (honest, still-stored) duplicateCount of 4 never
    // reaches a PRISMA figure — the 4 → 8 / 2 → 6 inflation is closed at the source.
    expect(second.supersedesBatchId).toBe('batch1');
    expect(second.duplicateCount).toBe(4);
    // …and the original records the re-import, for Import History.
    expect(store.batchUpdates.some((u) => u.where.id === 'batch1' && u.data.supersededById === 'batch2')).toBe(true);
  });

  it('a THIRD force still points at the lineage root, so repeats never accumulate', async () => {
    await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
    await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
    await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
    expect(store.batches.map((b) => b.supersedesBatchId)).toEqual(['', 'batch1', 'batch1']);
  });

  it('a DIFFERENT file overlapping the first is NOT superseded (PRISMA wants the instances)', async () => {
    await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
    const embaseExport = [
      'TY  - JOUR', 'TI  - Aspirin for headache', 'DO  - 10.1/aaa', 'ER  -',
      'TY  - JOUR', 'TI  - Naproxen trial', 'DO  - 10.1/zzz', 'ER  -', '',
    ].join('\n');
    const res = await land(embaseExport, { fileHash: 'hash-B', sourceDatabase: 'embase' });
    expect(store.batches[1].supersedesBatchId).toBe('');
    expect(res.skippedDuplicates).toBe(1);   // the overlapping Aspirin record
    expect(store.batches[1].duplicateCount).toBe(1);
  });

  it('an import with NO fileHash (legacy / pecan page) is never treated as a repeat', async () => {
    await land(THREE_COPIES_PLUS_ONE, {});
    await land(THREE_COPIES_PLUS_ONE, {});
    expect(store.batches.map((b) => b.supersedesBatchId)).toEqual(['', '']);
  });
});

describe('119.md §1 — the dedup audit trail (AUDIT ONLY)', () => {
  it('writes one event per removed INSTANCE, naming the retained record', async () => {
    await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A', importedById: 'u1', importedByName: 'Ada' });
    expect(store.dedupEvents).toHaveLength(2);
    for (const e of store.dedupEvents) {
      expect(e.method).toBe('import-exact');
      expect(e.classification).toBe('automatic');
      expect(e.recordId).toBe('');           // discarded before insertion — nothing to point at
      expect(e.canonicalRecordId).toBeTruthy();
      expect(e.batchId).toBe('batch1');
      expect(e.actor).toBe('u1');
    }
  });

  it('records DOI as the basis even when the two DOIs are formatted differently', async () => {
    const formatted = [
      'TY  - JOUR', 'TI  - Study alpha', 'DO  - 10.1/AAA', 'ER  -',
      'TY  - JOUR', 'TI  - A completely different title', 'DO  - https://doi.org/10.1/aaa ', 'ER  -', '',
    ].join('\n');
    const res = await land(formatted, { fileHash: 'hash-doi' });
    // Different titles — only the normalized DOI can have matched them.
    expect(res.skippedDuplicates).toBe(1);
    expect(store.dedupEvents.map((e) => e.basis)).toEqual(['doi']);
  });

  it('records PMID as the basis for a PMID-only match', async () => {
    const pmids = [
      'TY  - JOUR', 'TI  - Study beta', 'AN  - 12345678', 'ER  -',
      'TY  - JOUR', 'TI  - Another title entirely', 'AN  - 12345678', 'ER  -', '',
    ].join('\n');
    const res = await land(pmids, { fileHash: 'hash-pmid' });
    expect(res.skippedDuplicates).toBe(1);
    expect(store.dedupEvents.map((e) => e.basis)).toEqual(['pmid']);
  });

  it('records title as the basis when neither identifier is present', async () => {
    const titles = [
      'TY  - JOUR', 'TI  - Same title no identifiers', 'ER  -',
      'TY  - JOUR', 'TI  - Same Title  No Identifiers', 'ER  -', '',
    ].join('\n');
    const res = await land(titles, { fileHash: 'hash-title' });
    expect(res.skippedDuplicates).toBe(1);
    expect(store.dedupEvents.map((e) => e.basis)).toEqual(['title']);
  });

  it('is AUDIT ONLY — the count PRISMA reads is identical when the table is missing', async () => {
    const saved = prismaMock.screenDedupEvent;
    delete prismaMock.screenDedupEvent;                       // an un-migrated client
    try {
      const res = await land(THREE_COPIES_PLUS_ONE, { fileHash: 'hash-A' });
      expect(res.skippedDuplicates).toBe(2);
      expect(store.batches[0].duplicateCount).toBe(2);        // unchanged
      expect(store.dedupEvents).toHaveLength(0);
    } finally {
      prismaMock.screenDedupEvent = saved;
    }
  });
});
