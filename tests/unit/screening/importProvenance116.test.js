/**
 * importProvenance116.test.js — 116.md §14 (D6). The import pipeline must never
 * invent source metadata, and must persist what the importer genuinely declared.
 *
 * Pins:
 *  1. A plain RIS import yields records with sourceDb '' — BLANK IS HONEST (the
 *     104.md invariant). The old `sourceDb: r.sourceDb || r.source || …` fallback
 *     re-poisoned sourceDb with the format token on every import because parsers
 *     always filled `source`; this is the regression test that was missing.
 *  2. journal never falls back to the format token either.
 *  3. A recognized RIS `DB` tag survives into sourceDb (real detection ≠ invention).
 *  4. An importer-declared sourceDatabase/searchedAt is persisted ON THE BATCH at
 *     import time and still feeds the per-record fallback.
 *  5. shapeBatch returns the four 104.md fields, so the Import History UI can
 *     round-trip a saved search record (the C3 defect).
 *
 * Hermetic: prisma mocked; the REAL parsers + dedupeAndInsertRecords run.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const store = { batchCreate: null, createManyRows: [], inserted: [] };

const prismaMock = {
  screenRecord: {
    findMany: vi.fn(async (args) => (args?.where?.importBatchId ? store.inserted : [])),
    createMany: vi.fn(async ({ data }) => {
      store.createManyRows.push(...data);
      store.inserted = data.map((r, i) => ({ id: `ins${i}`, doi: r.doi, pmid: r.pmid, title: r.title }));
      return { count: data.length };
    }),
    count: vi.fn(async () => 0),
  },
  screenImportBatch: {
    create: vi.fn(async ({ data }) => { store.batchCreate = data; return { id: 'batch1', ...data }; }),
    update: vi.fn(async () => ({})),
  },
  screenRecordSource: {
    findMany: vi.fn(async () => []),
    createMany: vi.fn(async ({ data }) => ({ count: data.length })),
  },
  screenDecision: { createMany: vi.fn(async ({ data }) => ({ count: data.length })) },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { parseImportContent, dedupeAndInsertRecords } =
  await import('../../../server/services/screeningImportService.js');
const { shapeBatch } = await import('../../../server/controllers/screeningImportBatchController.js');

const PLAIN_RIS = [
  'TY  - JOUR', 'TI  - First study of things', 'AU  - Smith, J', 'PY  - 2021',
  'DO  - 10.1/aaa', 'ER  -',
  'TY  - JOUR', 'TI  - Second study of stuff', 'AU  - Doe, A', 'PY  - 2022',
  'DO  - 10.1/bbb', 'ER  -', '',
].join('\n');

const EMBASE_RIS = [
  'TY  - JOUR', 'TI  - An Embase-tagged record', 'DB  - Embase', 'DO  - 10.1/ccc', 'ER  -', '',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  store.batchCreate = null;
  store.createManyRows = [];
  store.inserted = [];
});

describe('a plain RIS import — blank is honest (116.md §14)', () => {
  it('stores sourceDb "" and never the format token, in journal either', async () => {
    const { records, detectedFormat } = parseImportContent(PLAIN_RIS, { format: 'ris' });
    expect(detectedFormat).toBe('RIS');
    await dedupeAndInsertRecords('p1', records, { format: detectedFormat, filename: 'plain.ris' });
    expect(store.createManyRows).toHaveLength(2);
    for (const row of store.createManyRows) {
      expect(row.sourceDb).toBe('');
      expect(row.journal).toBe('');       // no JO/JF tag → blank, not "RIS"
      expect(row.sourceDb).not.toMatch(/ris/i);
    }
    // The batch keeps the format where it belongs: format/parser, not source data.
    expect(store.batchCreate.format).toBe('RIS');
    expect(store.batchCreate.sourceDatabase).toBe('');
    expect(store.batchCreate.searchedAt).toBe(null);
  });
});

describe('genuine detection and genuine declaration survive', () => {
  it('a recognized RIS DB tag becomes the record sourceDb', async () => {
    const { records } = parseImportContent(EMBASE_RIS, { format: 'ris' });
    await dedupeAndInsertRecords('p1', records, { format: 'RIS', filename: 'embase.ris' });
    expect(store.createManyRows[0].sourceDb).toBe('Embase');
  });

  it('an importer-declared database/date is persisted on the batch AND feeds the record fallback', async () => {
    const { records } = parseImportContent(PLAIN_RIS, { format: 'ris' });
    await dedupeAndInsertRecords('p1', records, {
      format: 'RIS', filename: 'embase-export.ris',
      sourceDatabase: 'embase', searchedAt: '2026-01-05T00:00:00Z',
    });
    expect(store.batchCreate.sourceDatabase).toBe('embase');
    expect(store.batchCreate.searchedAt).toEqual(new Date('2026-01-05T00:00:00Z'));
    for (const row of store.createManyRows) expect(row.sourceDb).toBe('embase');
  });
});

describe('shapeBatch — the Import History round-trip (C3)', () => {
  it('returns the four 104.md search-record fields', () => {
    const shaped = shapeBatch({
      id: 'b1', filename: 'f.ris', format: 'RIS', source: 'file',
      searchRunId: '', updatedCount: 0, recordCount: 5, preDedupCount: 6,
      duplicateCount: 1, rejectedCount: 0, importedByName: 'A', createdAt: new Date('2026-01-01'),
      sourceDatabase: 'embase', searchedAt: new Date('2026-01-05'),
      contributesToReview: false, exclusionNote: 'test import',
    }, {});
    expect(shaped.sourceDatabase).toBe('embase');
    expect(shaped.searchedAt).toEqual(new Date('2026-01-05'));
    expect(shaped.contributesToReview).toBe(false);
    expect(shaped.exclusionNote).toBe('test import');
    // Un-migrated/legacy rows keep counting (schema defaults).
    const legacy = shapeBatch({ id: 'b2', recordCount: 1 }, {});
    expect(legacy.sourceDatabase).toBe('');
    expect(legacy.contributesToReview).toBe(true);
    expect(legacy.exclusionNote).toBe('');
  });
});
