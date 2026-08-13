/**
 * prismaInspectorApi116.test.js — 116.md §9-§12 (D5). Handler-level tests for the
 * PRISMA inspector's two server surfaces:
 *
 *   GET  /projects/:pid/prisma/box/:boxId/records  (paginated per-box record list)
 *   PATCH /projects/:pid/records/:rid              (metadata-only record editing)
 *
 * Pins:
 *  1. Outsider → existence-hiding 404; unknown box → 404 (repo-wide convention).
 *  2. Blind mode: a non-leader NEVER receives authors/journal on the wire, and
 *     cannot edit those fields (403) — the listRecords 81.md convention.
 *  3. Pagination (cursor/limit), q search, facet filters; phantom import-time
 *     duplicates surface as `uninspectable`, never as fake rows.
 *  4. PATCH: permission bar = importRecords' (owner/leader or active non-viewer
 *     member with canImportRecords); validation (year/pmid/identificationSource);
 *     rejectedReason only on a rejected record and only for leader/resolver;
 *     audit row + thin realtime poke on success; idempotent no-op success.
 *
 * All dependencies mocked → hermetic (duplicateResolveEmit.test.js pattern).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../server/realtime/bus.js', () => ({
  emitToProjectMembers: vi.fn(),
  emitToMetaLabProject: vi.fn(),
}));
vi.mock('../../../server/screening/access.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getProjectAccess: vi.fn(),
  ensureLeaderMember: vi.fn(async () => {}),
  writeAudit: vi.fn(async () => {}),
}));

const D = new Date('2026-01-10T00:00:00Z');
const REC = (id, over = {}) => ({
  id, title: `Paper ${id}`, authors: `Author ${id}`, year: '2024', journal: `Journal ${id}`,
  doi: `10.1/${id}`, pmid: '', abstract: '', sourceDb: 'PubMed', importBatchId: null,
  isDuplicate: false, isPrimary: false, duplicateGroupId: null,
  currentStage: 'title_abstract', finalStatus: '', promotedAt: null,
  rejectedReason: '', handoffStudyId: '', identificationSource: null, sourceDetail: null,
  createdAt: D, updatedAt: D, ...over,
});

const db = {
  records: [
    REC('a1'),                                        // excluded at T/A (decision below)
    REC('a2', { title: 'A needle in the haystack' }), // awaiting screening
    REC('a4', {                                       // leader-rejected full text
      currentStage: 'full_text', promotedAt: D, finalStatus: 'rejected',
      rejectedReason: 'wrong population',
    }),
    REC('a5', {                                       // included report
      currentStage: 'full_text', promotedAt: D, finalStatus: 'accepted', handoffStudyId: 'S1',
    }),
    REC('a3', { sourceDb: '', importBatchId: 'b2' }), // file import, no attribution → other arm
  ],
  decisions: [
    { recordId: 'a1', stage: 'title_abstract', decision: 'exclude', exclusionReason: 'off topic' },
  ],
  conflicts: [],
  sources: [
    { screenRecordId: 'a1', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
    { screenRecordId: 'a2', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
    { screenRecordId: 'a4', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
    { screenRecordId: 'a5', origin: 'search', runId: 'run1', batchId: '', outcome: 'new' },
  ],
  batches: [
    { id: 'b1', duplicateCount: 2, sourceDatabase: '', filename: 'run.ris', format: 'RIS', createdAt: D },
    { id: 'b2', duplicateCount: 0, sourceDatabase: '', filename: 'upload.ris', format: 'RIS', createdAt: D },
  ],
};

const prismaMock = {
  screenRecord: {
    findMany: vi.fn(async () => db.records),
    findFirst: vi.fn(async ({ where }) => db.records.find((r) => r.id === where.id) || null),
    update: vi.fn(async ({ where, data }) => ({ ...db.records.find((r) => r.id === where.id), ...data })),
  },
  screenDecision: { findMany: vi.fn(async () => db.decisions) },
  screenConflict: { findMany: vi.fn(async () => db.conflicts) },
  screenRecordSource: { findMany: vi.fn(async () => db.sources) },
  fullTextCandidate: { findMany: vi.fn(async () => []) },
  fullTextRequest: { findMany: vi.fn(async () => []) },
  screenPdfAttachment: { findMany: vi.fn(async () => []) },
  screenImportBatch: { findMany: vi.fn(async () => db.batches) },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { getPrismaBoxRecords } = await import('../../../server/controllers/screeningOverviewController.js');
const { updateRecordMetadata } = await import('../../../server/controllers/screeningController.js');
const { getProjectAccess, writeAudit } = await import('../../../server/screening/access.js');
const { emitToProjectMembers } = await import('../../../server/realtime/bus.js');

const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mkReq = ({ boxId = 'identified_db', rid = 'a1', query = {}, body = {} } = {}) => ({
  params: { pid: 'sp1', boxId, rid },
  query,
  body,
  user: { id: 'u1' },
});

const LEADER = {
  project: { id: 'sp1', blindMode: false, linkedMetaLabProjectId: null },
  member: { role: 'leader', status: 'active' },
  isOwner: true, isLeader: true, active: true,
  canResolveConflicts: true,
  perms: { canImportRecords: true },
};
const BLIND_REVIEWER = {
  project: { id: 'sp1', blindMode: true, linkedMetaLabProjectId: null },
  member: { role: 'reviewer', status: 'active' },
  isOwner: false, isLeader: false, active: true,
  canResolveConflicts: false,
  perms: { canImportRecords: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAccess.mockResolvedValue(LEADER);
});

/* ════════ GET /prisma/box/:boxId/records ════════ */

describe('getPrismaBoxRecords — access + resource conventions', () => {
  it('outsider gets the existence-hiding 404', async () => {
    getProjectAccess.mockResolvedValue(null);
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({}), res);
    expect(res.statusCode).toBe(404);
  });

  it('an unknown box id is a 404, not a validation hint', async () => {
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({ boxId: 'not_a_box' }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('getPrismaBoxRecords — the record list (116.md §9/§11)', () => {
  it('lists the db-arm identified records with metadata, batch and status', async () => {
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({}), res);
    expect(res.statusCode).toBe(200);
    const ids = res.body.records.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['a1', 'a2', 'a4', 'a5']));
    expect(ids).not.toContain('a3'); // other arm — not in identified_db
    // §9 columns: title/authors/year/source/doi + import batch + screening status.
    const a4 = res.body.records.find((r) => r.id === 'a4');
    expect(a4.title).toBe('Paper a4');
    expect(a4.authors).toBe('Author a4');
    expect(a4.disposition).toBe('excluded_full_text');
    expect(a4.exclusionReason).toBe('Wrong population'); // §16 display formatting
    // Phantom import-time duplicates: counted, flagged, never fake rows.
    expect(res.body.total).toBe(res.body.records.length + 2);
    expect(res.body.uninspectable).toBe(2);
    expect(res.body.canEdit).toBe(true);
    expect(res.body.canFinalize).toBe(true);
    // Facets ship on the first page.
    expect(res.body.facets.source.length).toBeGreaterThan(0);
    expect(res.body.facets.status.some((f) => f.value === 'excluded_full_text')).toBe(true);
  });

  it('the other-methods identification box lists the unattributed file import', async () => {
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({ boxId: 'identified_other' }), res);
    expect(res.body.records.map((r) => r.id)).toEqual(['a3']);
    expect(res.body.records[0].importBatch.filename).toBe('upload.ris');
  });

  it('paginates with cursor/limit and repeats no rows', async () => {
    const first = mkRes();
    await getPrismaBoxRecords(mkReq({ query: { limit: '2' } }), first);
    expect(first.body.records).toHaveLength(2);
    expect(first.body.nextCursor).toBe('2');
    const second = mkRes();
    await getPrismaBoxRecords(mkReq({ query: { limit: '2', cursor: first.body.nextCursor } }), second);
    const firstIds = first.body.records.map((r) => r.id);
    for (const r of second.body.records) expect(firstIds).not.toContain(r.id);
    expect(second.body.facets).toBeUndefined(); // first page only
  });

  it('searches title/DOI/PMID (§12)', async () => {
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({ query: { q: 'needle' } }), res);
    expect(res.body.records.map((r) => r.id)).toEqual(['a2']);
    // total stays the box count; `listed` is the filtered count.
    expect(res.body.listed).toBe(1);
  });

  it('filters by screening-status facet', async () => {
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({ query: { status: 'excluded_full_text' } }), res);
    expect(res.body.records.map((r) => r.id)).toEqual(['a4']);
  });

  it('the studies box lists the included REPORTS (§9 studies + attached reports)', async () => {
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({ boxId: 'included_studies' }), res);
    expect(res.body.records.map((r) => r.id)).toEqual(['a5']);
    expect(res.body.records[0].studyId).toBe('S1');
    expect(res.body.unit).toBe('studies');
  });

  it('blind mode strips authors/journal at the wire for a non-leader (81.md convention)', async () => {
    getProjectAccess.mockResolvedValue(BLIND_REVIEWER);
    const res = mkRes();
    await getPrismaBoxRecords(mkReq({}), res);
    for (const r of res.body.records) {
      expect(r.authors).toBe('');
      expect(r.journal).toBe('');
    }
    expect(res.body.canEdit).toBe(false);     // viewer-grade perms
    expect(res.body.canFinalize).toBe(false);
  });
});

/* ════════ PATCH /records/:rid ════════ */

describe('updateRecordMetadata — permissions (116.md §10)', () => {
  it('outsider → 404; record in another project → 404', async () => {
    getProjectAccess.mockResolvedValue(null);
    const res = mkRes();
    await updateRecordMetadata(mkReq({ body: { title: 'X' } }), res);
    expect(res.statusCode).toBe(404);

    getProjectAccess.mockResolvedValue(LEADER);
    const res2 = mkRes();
    await updateRecordMetadata(mkReq({ rid: 'nope', body: { title: 'X' } }), res2);
    expect(res2.statusCode).toBe(404);
  });

  it('a member without the record-editing capability gets a 403', async () => {
    getProjectAccess.mockResolvedValue(BLIND_REVIEWER);
    const res = mkRes();
    await updateRecordMetadata(mkReq({ body: { title: 'X' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('blind mode refuses edits to the fields it hides', async () => {
    getProjectAccess.mockResolvedValue({
      ...BLIND_REVIEWER,
      perms: { canImportRecords: true }, // may edit — but not the hidden fields
    });
    const res = mkRes();
    await updateRecordMetadata(mkReq({ body: { authors: 'New A' } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/blind mode/i);
  });
});

describe('updateRecordMetadata — validation + persistence', () => {
  it('updates metadata, writes the audit row, emits a thin poke', async () => {
    const res = mkRes();
    await updateRecordMetadata(mkReq({
      body: { title: 'Corrected title', year: '2021', doi: 'https://doi.org/10.9/zz' },
    }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.record.title).toBe('Corrected title');
    expect(res.body.record.doi).toBe('10.9/zz'); // DOI URL prefix normalized
    expect(res.body.changed.title.to).toBe('Corrected title');
    expect(prismaMock.screenRecord.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a1' },
      data: expect.objectContaining({ title: 'Corrected title', year: '2021', doi: '10.9/zz' }),
    }));
    expect(writeAudit).toHaveBeenCalledWith('sp1', expect.anything(), 'RECORD_UPDATED', expect.objectContaining({
      entityType: 'record', entityId: 'a1',
    }));
    // Thin poke: type + ids, no content, initiator excluded.
    expect(emitToProjectMembers).toHaveBeenCalledWith('sp1',
      { type: 'record.updated', ids: ['a1'] }, { exclude: 'u1' });
  });

  it('rejects a malformed year and pmid', async () => {
    const badYear = mkRes();
    await updateRecordMetadata(mkReq({ body: { year: '20xx' } }), badYear);
    expect(badYear.statusCode).toBe(400);
    const badPmid = mkRes();
    await updateRecordMetadata(mkReq({ body: { pmid: 'PMID-1' } }), badPmid);
    expect(badPmid.statusCode).toBe(400);
  });

  it('accepts only known PRISMA buckets for identificationSource (§13)', async () => {
    const bad = mkRes();
    await updateRecordMetadata(mkReq({ body: { identificationSource: 'carrier_pigeon' } }), bad);
    expect(bad.statusCode).toBe(400);
    const good = mkRes();
    await updateRecordMetadata(mkReq({ body: { identificationSource: 'prior_review', sourceDetail: 'Smith 2019 review' } }), good);
    expect(good.statusCode).toBe(200);
    expect(good.body.record.identificationSource).toBe('prior_review');
  });

  it('rejectedReason: only on a rejected record, only for leader/resolver', async () => {
    // a1 is not rejected → 400 even for the leader.
    const notRejected = mkRes();
    await updateRecordMetadata(mkReq({ body: { rejectedReason: 'Wrong dose' } }), notRejected);
    expect(notRejected.statusCode).toBe(400);
    // a4 IS rejected → ok for the leader.
    const ok = mkRes();
    await updateRecordMetadata(mkReq({ rid: 'a4', body: { rejectedReason: 'Wrong dose' } }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.record.rejectedReason).toBe('Wrong dose');
    // A non-resolver with edit rights still may not touch it.
    getProjectAccess.mockResolvedValue({
      ...BLIND_REVIEWER,
      project: { ...BLIND_REVIEWER.project, blindMode: false },
      perms: { canImportRecords: true },
    });
    const forbidden = mkRes();
    await updateRecordMetadata(mkReq({ rid: 'a4', body: { rejectedReason: 'X' } }), forbidden);
    expect(forbidden.statusCode).toBe(403);
  });

  it('a body with no editable field is a 400; an unchanged body is an idempotent 200', async () => {
    const empty = mkRes();
    await updateRecordMetadata(mkReq({ body: { finalStatus: 'accepted' } }), empty);
    expect(empty.statusCode).toBe(400); // decision state is NOT editable here (§10)

    const same = mkRes();
    await updateRecordMetadata(mkReq({ body: { title: 'Paper a1' } }), same);
    expect(same.statusCode).toBe(200);
    expect(same.body.changed).toEqual({});
    expect(prismaMock.screenRecord.update).not.toHaveBeenCalled();
  });
});
