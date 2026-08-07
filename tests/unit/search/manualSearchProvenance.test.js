/**
 * 104.md Part 2 — manual searches as first-class search events (server side).
 *
 * Two facts a file cannot tell us — WHICH database this was and WHEN the search
 * was actually run — plus the decision of whether the search is part of the
 * review's final methodology at all.
 */
import { describe, it, expect } from 'vitest';
import { loadSearchProvenance } from '../../../server/searchEngine/searchProvenanceService.js';

const SPID = 'screen-1';

/** A stub Prisma with only the models the loader touches. */
function stubPrisma({ batches = [], records = [] }) {
  return {
    screenProject: { async findFirst() { return { id: SPID }; } },
    pecanSearchRun: { async findMany() { return []; } },
    screenImportBatch: {
      async findMany({ select }) {
        // The loader asks for the 104.md columns first and falls back when the
        // database has not been migrated. Simulate an un-migrated database by
        // throwing for the extended select when the caller asked us to.
        if (select && select.sourceDatabase && batches.some((b) => b.__legacy)) {
          throw new Error('Unknown column `sourceDatabase`');
        }
        return batches;
      },
    },
    screenRecord: {
      async groupBy({ where }) {
        const ids = (where && where.importBatchId && where.importBatchId.in) || [];
        const seen = new Map();
        for (const r of records) {
          if (!ids.includes(r.importBatchId)) continue;
          const k = `${r.importBatchId}$${r.sourceDb || ''}`;
          seen.set(k, (seen.get(k) || 0) + 1);
        }
        return Array.from(seen, ([k, n]) => {
          const [importBatchId, sourceDb] = k.split('$');
          return { importBatchId, sourceDb, _count: { _all: n } };
        });
      },
    },
  };
}

const batch = (o = {}) => ({
  id: o.id || 'b1',
  source: 'file',
  filename: o.filename || 'export.ris',
  createdAt: o.createdAt || '2026-08-11T00:00:00.000Z',
  recordCount: o.recordCount ?? 40,
  searchRunId: '',
  fileHash: 'hash-1',
  sourceDatabase: o.sourceDatabase ?? '',
  searchedAt: o.searchedAt ?? null,
  contributesToReview: o.contributesToReview ?? true,
  ...(o.__legacy ? { __legacy: true } : {}),
});

const load = (fixture) => loadSearchProvenance(stubPrisma(fixture), {
  metaLabProjectId: 'meta-1', screenProjectId: SPID,
});

describe('a manual search records when it was RUN, not when the file was uploaded', () => {
  it('uses searchedAt in preference to the upload timestamp', async () => {
    // Searched on the 3rd, uploaded on the 11th. Reporting the 11th would
    // overstate how current the review's evidence base is.
    const p = await load({
      batches: [batch({ searchedAt: '2026-08-03T00:00:00.000Z', sourceDatabase: 'Embase' })],
    });
    expect(p.latestValidSearchAt.slice(0, 10)).toBe('2026-08-03');
  });

  it('falls back to the upload date when no search date was recorded', async () => {
    const p = await load({ batches: [batch({ sourceDatabase: 'Embase' })] });
    expect(p.latestValidSearchAt.slice(0, 10)).toBe('2026-08-11');
  });
});

describe('an explicitly declared database beats parser guesswork', () => {
  it('attributes a file that carries no per-record source at all', async () => {
    // The commonest real case: a RIS export with no DB field. Before 104.md this
    // search was simply unattributable and vanished from the manuscript.
    const p = await load({
      batches: [batch({ sourceDatabase: 'Embase' })],
      records: [],
    });
    expect(p.reportable.map((d) => d.label)).toEqual(['Embase']);
    expect(p.reportable[0].recordCount).toBe(40);
  });

  it('overrides a per-record label the researcher has corrected', async () => {
    const p = await load({
      batches: [batch({ id: 'b1', sourceDatabase: 'Embase' })],
      records: [
        { importBatchId: 'b1', sourceDb: 'PubMed' },
        { importBatchId: 'b1', sourceDb: 'PubMed' },
      ],
    });
    expect(p.reportable.map((d) => d.label)).toEqual(['Embase']);
  });
});

describe('a search that is not part of the final methodology', () => {
  it('stops being reported once flagged', async () => {
    const p = await load({
      batches: [
        batch({ id: 'good', sourceDatabase: 'Embase', searchedAt: '2026-01-05T00:00:00.000Z' }),
        batch({ id: 'oops', sourceDatabase: 'Scopus', searchedAt: '2026-06-01T00:00:00.000Z', contributesToReview: false }),
      ],
    });
    expect(p.reportable.map((d) => d.label)).toEqual(['Embase']);
    // And — the reason this matters — the discarded test import must not still be
    // setting the review's "last searched" date.
    expect(p.latestValidSearchAt.slice(0, 10)).toBe('2026-01-05');
  });

  it('treats a batch with no flag at all as contributing', async () => {
    const p = await load({ batches: [{ ...batch({ sourceDatabase: 'Embase' }), contributesToReview: undefined }] });
    expect(p.reportable.map((d) => d.label)).toEqual(['Embase']);
  });
});

describe('an un-migrated database keeps working', () => {
  it('degrades to the legacy columns instead of failing', async () => {
    const p = await load({
      batches: [batch({ id: 'b1', __legacy: true })],
      records: [{ importBatchId: 'b1', sourceDb: 'Embase' }],
    });
    expect(p.reportable.map((d) => d.label)).toEqual(['Embase']);
    expect(p.latestValidSearchAt.slice(0, 10)).toBe('2026-08-11'); // createdAt
  });
});

describe('the search event history', () => {
  it('records each contributing search individually', async () => {
    const p = await load({
      batches: [
        batch({ id: 'b1', sourceDatabase: 'Embase', searchedAt: '2026-01-05T00:00:00.000Z' }),
        batch({ id: 'b2', sourceDatabase: 'Scopus', searchedAt: '2026-03-09T00:00:00.000Z' }),
      ],
    });
    expect(p.history.map((e) => [e.database, e.at.slice(0, 10), e.method])).toEqual([
      ['embase', '2026-01-05', 'manual'],
      ['scopus', '2026-03-09', 'manual'],
    ]);
  });
});
