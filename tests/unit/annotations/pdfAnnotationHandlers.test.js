/**
 * pdfAnnotationHandlers.test.js — 116.md §85, §87-§91, §101-§103 (Part VII).
 *
 * Handler-level and hermetic (mock prisma + mock access + mock bus — the
 * listConflicts116 / prismaInspectorApi116 pattern). These pin the behaviours that
 * only exist once the pure model is wired to I/O:
 *
 *   • §101 authorisation — a non-member gets 404 (existence hidden) on EVERY route;
 *     a hash that names no PDF in the caller's project gets 404 too, so the API can
 *     never reach a document outside the caller's projects;
 *   • §84 — a site admin who is not a member is just an outsider;
 *   • §89/§91 — clientId idempotency: a retried POST returns the SAME row, never a
 *     second highlight;
 *   • §90 — the revision compare-and-set, and "a delete beats a concurrent edit";
 *   • §103 — DELETE is a soft tombstone, and restore brings the same row id back;
 *   • §85 — clear-mine vs clear-all, and neither ever touches the PDF file;
 *   • §87/§88 — every mutation emits exactly ONE poke carrying ids only (no text, no
 *     colour, no author), which is also what keeps blind mode safe;
 *   • blind mode — a blinded non-leader receives colleagues' highlights WITHOUT their
 *     identity, ON THE WIRE (the 81.md leader-exempt convention).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../server/realtime/bus.js', () => ({
  emitToProjectMembers: vi.fn(),
  emitToMetaLabProject: vi.fn(),
}));
vi.mock('../../../server/screening/access.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getProjectAccess: vi.fn(),
  writeAudit: vi.fn(async () => {}),
}));
vi.mock('../../../server/extraction/access.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveExtractionAccess: vi.fn(),
}));
// The lazy fileHash backfill reads from disk; never in a unit test.
vi.mock('../../../server/screening/pdfStorage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  hashStoredPdf: vi.fn(() => null),
}));

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);
const NOW = new Date('2026-08-13T12:00:00.000Z');

/* ── An in-memory PdfAnnotation table with just enough Prisma surface ──────── */
let rows = [];
let seq = 0;

const matches = (row, where) => Object.entries(where || {}).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('gt' in v) return row[k] != null && new Date(row[k]) > new Date(v.gt);
    return true;
  }
  return row[k] === v;
});

const prismaMock = {
  pdfAnnotation: {
    findMany: vi.fn(async ({ where }) => rows.filter((r) => matches(r, where))),
    findFirst: vi.fn(async ({ where }) => rows.find((r) => matches(r, where)) || null),
    findUnique: vi.fn(async ({ where }) => rows.find((r) => (
      where.id ? r.id === where.id : r.clientId === where.clientId
    )) || null),
    create: vi.fn(async ({ data }) => {
      if (rows.some((r) => r.clientId === data.clientId)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      seq += 1;
      const row = {
        id: `ann-${seq}`, revision: 1, deletedAt: null, deletedById: null,
        recordId: null, studyId: null, selectedText: '', color: 'yellow', comment: '',
        authorName: '', createdAt: NOW, updatedAt: NOW, ...data,
      };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in v) r[k] += v.increment;
          else r[k] = v;
        }
        r.updatedAt = new Date(Date.now() + 1);
      }
      return { count: hit.length };
    }),
  },
  screenPdfAttachment: {
    findFirst: vi.fn(async ({ where }) => (
      (where.projectId === 'sp1' && where.fileHash === HASH) ? { id: 'att-1' } : null
    )),
    findMany: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
  },
  screenProject: { findFirst: vi.fn(async () => null) },
  project: { findFirst: vi.fn(async () => null) },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const AN = await import('../../../server/controllers/pdfAnnotationController.js');
const { getProjectAccess } = await import('../../../server/screening/access.js');
const { resolveExtractionAccess } = await import('../../../server/extraction/access.js');
const { emitToProjectMembers, emitToMetaLabProject } = await import('../../../server/realtime/bus.js');

const mkRes = () => {
  const res = { statusCode: 200, body: undefined, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mkReq = (over = {}) => ({
  params: { pid: 'sp1', ...(over.params || {}) },
  query: over.query || {},
  body: over.body || {},
  user: over.user || { id: 'u1', name: 'Dr Ada Byron' },
});

const ACCESS = {
  owner: { project: { id: 'sp1', blindMode: false }, isOwner: true, isLeader: true, role: 'owner', canScreen: true },
  leader: { project: { id: 'sp1', blindMode: false }, isOwner: false, isLeader: true, role: 'leader', canScreen: true },
  reviewer: { project: { id: 'sp1', blindMode: false }, isOwner: false, isLeader: false, role: 'reviewer', canScreen: true },
  viewer: { project: { id: 'sp1', blindMode: false }, isOwner: false, isLeader: false, role: 'viewer', canScreen: false },
  blindReviewer: { project: { id: 'sp1', blindMode: true }, isOwner: false, isLeader: false, role: 'reviewer', canScreen: true },
  blindLeader: { project: { id: 'sp1', blindMode: true }, isOwner: false, isLeader: true, role: 'leader', canScreen: true },
};

const seedRow = (over = {}) => {
  seq += 1;
  const row = {
    id: `ann-${seq}`, clientId: `an-seed${seq}0000`, docHash: HASH,
    screenProjectId: 'sp1', metaLabProjectId: null, recordId: 'rec-1', studyId: null,
    page: 1, rects: '[{"x0":1,"y0":2,"x1":3,"y1":4}]', selectedText: 'excerpt',
    color: 'yellow', comment: '', authorId: 'u1', authorName: 'Dr Ada Byron',
    revision: 1, deletedAt: null, deletedById: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  };
  rows.push(row);
  return row;
};

const goodCreate = (over = {}) => ({
  docHash: HASH, clientId: 'an-client-0001', page: 2,
  rects: [{ x0: 10, y0: 700, x1: 200, y1: 712 }],
  selectedText: 'the primary outcome', color: 'green', recordId: 'rec-1', ...over,
});

beforeEach(() => {
  rows = []; seq = 0;
  vi.clearAllMocks();
  getProjectAccess.mockResolvedValue(ACCESS.reviewer);
  resolveExtractionAccess.mockResolvedValue(null);
  prismaMock.screenPdfAttachment.findFirst.mockImplementation(async ({ where }) => (
    (where.projectId === 'sp1' && where.fileHash === HASH) ? { id: 'att-1' } : null
  ));
  prismaMock.screenPdfAttachment.findMany.mockResolvedValue([]);
});

/* ── §101 / §84 authorisation ─────────────────────────────────────────────── */

describe('116.md §101/§84 — authorisation hides existence', () => {
  it('a NON-MEMBER gets 404 on every route — never a 403 that confirms the project', async () => {
    getProjectAccess.mockResolvedValue(null);
    for (const [fn, req] of [
      [AN.listScreeningAnnotations, mkReq({ query: { docHash: HASH } })],
      [AN.createScreeningAnnotation, mkReq({ body: goodCreate() })],
      [AN.updateScreeningAnnotation, mkReq({ params: { aid: 'ann-1' }, body: { color: 'blue' } })],
      [AN.deleteScreeningAnnotation, mkReq({ params: { aid: 'ann-1' } })],
      [AN.clearScreeningAnnotations, mkReq({ body: { docHash: HASH, mode: 'mine' } })],
    ]) {
      const res = mkRes();
      await fn(req, res);
      expect(res.statusCode).toBe(404);
      expect(res.body.error).toBe('Project not found');
    }
  });

  it('§84 — a site ADMIN who is not a member is exactly an outsider', async () => {
    getProjectAccess.mockResolvedValue(null);   // the resolver has no admin bypass
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ user: { id: 'admin-1', isAdmin: true, role: 'admin' }, query: { docHash: HASH } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('a hash that names no PDF in THIS project is 404 (§101 "do not trust client ids")', async () => {
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: OTHER_HASH } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('Document not found');
  });

  it('a malformed hash is a 400 with a code, before any database work', async () => {
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: 'nope' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('BAD_DOC_HASH');
    expect(prismaMock.pdfAnnotation.findMany).not.toHaveBeenCalled();
  });

  it('a VIEWER may read but is refused create with a structured 403 (§83)', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.viewer);
    const list = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), list);
    expect(list.statusCode).toBe(200);
    expect(list.body.capabilities).toEqual({ canCreate: false, canModerate: false });

    const res = mkRes();
    await AN.createScreeningAnnotation(mkReq({ body: goodCreate() }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ANNOTATION_CREATE_DENIED');
  });

  it('an annotation belonging to ANOTHER project is invisible even by id', async () => {
    seedRow({ id: 'ann-foreign', screenProjectId: 'sp-other' });
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: 'ann-foreign' }, body: { color: 'blue' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('ANNOTATION_NOT_FOUND');
  });
});

/* ── §89/§91 idempotency ──────────────────────────────────────────────────── */

describe('116.md §89/§91 — clientId idempotency', () => {
  it('creates once and returns 201 with the canonical row', async () => {
    const res = mkRes();
    await AN.createScreeningAnnotation(mkReq({ body: goodCreate() }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.annotation).toMatchObject({
      clientId: 'an-client-0001', page: 2, color: 'green', authorId: 'u1', revision: 1, deleted: false,
    });
    expect(res.body.annotation.rects).toEqual([{ x0: 10, y0: 700, x1: 200, y1: 712 }]);
    expect(rows).toHaveLength(1);
  });

  it('a RETRIED post with the same clientId returns the SAME row, never a duplicate', async () => {
    const first = mkRes();
    await AN.createScreeningAnnotation(mkReq({ body: goodCreate() }), first);
    const second = mkRes();
    await AN.createScreeningAnnotation(mkReq({ body: goodCreate({ color: 'pink' }) }), second);
    expect(second.statusCode).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.annotation.id).toBe(first.body.annotation.id);
    expect(second.body.annotation.color).toBe('green');   // the first write stands
    expect(rows).toHaveLength(1);
  });

  it('survives the RACE — a P2002 from a concurrent twin still answers with that row', async () => {
    const existing = seedRow({ clientId: 'an-client-0001', authorId: 'u1' });
    prismaMock.pdfAnnotation.findUnique.mockImplementationOnce(async () => null);   // lost the read race
    const res = mkRes();
    await AN.createScreeningAnnotation(mkReq({ body: goodCreate() }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(res.body.annotation.id).toBe(existing.id);
  });

  it('another user cannot HIJACK someone else\'s clientId', async () => {
    seedRow({ clientId: 'an-client-0001', authorId: 'u1' });
    const res = mkRes();
    await AN.createScreeningAnnotation(mkReq({ user: { id: 'u2' }, body: goodCreate() }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('CLIENT_ID_TAKEN');
  });

  it('rejects a highlight with no geometry, a bad page or no clientId — never stores it', async () => {
    for (const [body, code] of [
      [goodCreate({ rects: [] }), 'BAD_RECTS'],
      [goodCreate({ rects: [{ x0: 1, y0: 1, x1: 1, y1: 5 }] }), 'BAD_RECTS'],
      [goodCreate({ page: 0 }), 'BAD_PAGE'],
      [goodCreate({ clientId: 'no' }), 'BAD_CLIENT_ID'],
      [goodCreate({ docHash: 'zzz' }), 'BAD_DOC_HASH'],
    ]) {
      const res = mkRes();
      await AN.createScreeningAnnotation(mkReq({ body }), res);
      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe(code);
    }
    expect(rows).toHaveLength(0);
  });

  it('bounds and clamps what it does store (colour, excerpt, comment)', async () => {
    const res = mkRes();
    await AN.createScreeningAnnotation(mkReq({
      body: goodCreate({ color: '#ff0000', selectedText: 'x'.repeat(5000), comment: 'y'.repeat(9000) }),
    }), res);
    expect(res.statusCode).toBe(201);
    expect(rows[0].color).toBe('yellow');
    expect(rows[0].selectedText).toHaveLength(2000);
    expect(rows[0].comment).toHaveLength(4000);
  });
});

/* ── §90 concurrency ──────────────────────────────────────────────────────── */

describe('116.md §90 — concurrent editing', () => {
  it('a stale baseRevision is a 409 carrying the CURRENT row to reconcile from', async () => {
    const row = seedRow({ revision: 3, color: 'blue' });
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { color: 'pink', baseRevision: 2 } }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ANNOTATION_CONFLICT');
    expect(res.body.annotation.color).toBe('blue');
    expect(rows[0].color).toBe('blue');            // nothing was clobbered
  });

  it('a matching baseRevision applies and BUMPS the revision', async () => {
    const row = seedRow({ revision: 3 });
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { color: 'pink', baseRevision: 3 } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.annotation.color).toBe('pink');
    expect(res.body.annotation.revision).toBe(4);
  });

  it('"the leader deleted it while the author was editing the comment" ⇒ ANNOTATION_GONE', async () => {
    const row = seedRow({ revision: 2, deletedAt: NOW, deletedById: 'leader-1' });
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { comment: 'late note', baseRevision: 2 } }), res);
    // A tombstone is 404-invisible for a plain edit — the row is simply gone.
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('ANNOTATION_NOT_FOUND');
  });

  it('an author-less caller cannot recolour someone else\'s highlight', async () => {
    const row = seedRow({ authorId: 'someone-else' });
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { color: 'pink' } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ANNOTATION_NOT_YOURS');
  });

  it('a LEADER may moderate someone else\'s highlight (§83)', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.leader);
    const row = seedRow({ authorId: 'someone-else' });
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ user: { id: 'the-leader' }, params: { pid: 'sp1', aid: row.id }, body: { color: 'pink' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.annotation.color).toBe('pink');
  });
});

/* ── §103 soft delete + restore (the undo round-trip) ─────────────────────── */

describe('116.md §103/§86 — soft delete, tombstones and restore', () => {
  it('DELETE tombstones the row — it is never physically removed', async () => {
    const row = seedRow();
    const res = mkRes();
    await AN.deleteScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.annotation.deleted).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeTruthy();
    expect(rows[0].deletedById).toBe('u1');
  });

  it('a tombstone disappears from the live list but APPEARS in a ?since delta (§91)', async () => {
    const row = seedRow();
    await AN.deleteScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id } }), mkRes());

    const live = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), live);
    expect(live.body.annotations).toEqual([]);

    const delta = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH, since: NOW.toISOString() } }), delta);
    expect(delta.body.annotations).toHaveLength(1);
    expect(delta.body.annotations[0].deleted).toBe(true);
  });

  it('restore brings back the SAME row id, so undo/redo round-trips identity (§86)', async () => {
    const row = seedRow();
    await AN.deleteScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id } }), mkRes());
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { restore: true } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.annotation.id).toBe(row.id);
    expect(res.body.annotation.deleted).toBe(false);
    expect(rows).toHaveLength(1);

    const live = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), live);
    expect(live.body.annotations.map((a) => a.id)).toEqual([row.id]);
  });

  it('delete → restore → delete → restore never duplicates or orphans a row', async () => {
    const row = seedRow();
    for (let i = 0; i < 2; i++) {
      await AN.deleteScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id } }), mkRes());
      await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { restore: true } }), mkRes());
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBe(null);
    const live = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), live);
    expect(live.body.annotations).toHaveLength(1);
  });

  it('a restore by someone who is neither author nor leader is refused', async () => {
    const row = seedRow({ authorId: 'someone-else' });
    await AN.deleteScreeningAnnotation(mkReq({ user: { id: 'someone-else' }, params: { pid: 'sp1', aid: row.id } }), mkRes());
    const res = mkRes();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { restore: true } }), res);
    expect(res.statusCode).toBe(403);
    expect(rows[0].deletedAt).toBeTruthy();
  });
});

/* ── §85 clear ────────────────────────────────────────────────────────────── */

describe('116.md §85 — Clear my annotations vs Clear all', () => {
  const seedTwoAuthors = () => {
    seedRow({ authorId: 'u1' });
    seedRow({ authorId: 'u1' });
    seedRow({ authorId: 'u2' });
  };

  it('mode "mine" clears ONLY the caller\'s rows', async () => {
    seedTwoAuthors();
    const res = mkRes();
    await AN.clearScreeningAnnotations(mkReq({ body: { docHash: HASH, mode: 'mine' } }), res);
    expect(res.body).toEqual({ cleared: 2, mode: 'mine' });
    expect(rows.filter((r) => r.deletedAt).map((r) => r.authorId)).toEqual(['u1', 'u1']);
    expect(rows.find((r) => r.authorId === 'u2').deletedAt).toBe(null);
  });

  it('mode "all" is refused for an ordinary member with a structured 403', async () => {
    seedTwoAuthors();
    const res = mkRes();
    await AN.clearScreeningAnnotations(mkReq({ body: { docHash: HASH, mode: 'all' } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ANNOTATION_MODERATE_DENIED');
    expect(rows.every((r) => !r.deletedAt)).toBe(true);
  });

  it('mode "all" clears every member\'s rows for a LEADER', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.leader);
    seedTwoAuthors();
    const res = mkRes();
    await AN.clearScreeningAnnotations(mkReq({ user: { id: 'the-leader' }, body: { docHash: HASH, mode: 'all' } }), res);
    expect(res.body).toEqual({ cleared: 3, mode: 'all' });
    expect(rows.every((r) => !!r.deletedAt)).toBe(true);
  });

  it('an unknown mode falls back to "mine" — a clear can never widen by accident', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.leader);
    seedTwoAuthors();
    const res = mkRes();
    await AN.clearScreeningAnnotations(mkReq({ user: { id: 'u1' }, body: { docHash: HASH, mode: 'EVERYTHING' } }), res);
    expect(res.body.mode).toBe('mine');
    expect(res.body.cleared).toBe(2);
  });

  it('clearing NEVER touches the PDF itself — no attachment write of any kind', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.owner);
    seedTwoAuthors();
    await AN.clearScreeningAnnotations(mkReq({ body: { docHash: HASH, mode: 'all' } }), mkRes());
    expect(prismaMock.screenPdfAttachment.update).not.toHaveBeenCalled();
    // (and the only attachment call at all is the read-only existence probe)
    expect(prismaMock.screenPdfAttachment.findFirst).toHaveBeenCalled();
  });

  it('clearing rows on ANOTHER document leaves this one alone', async () => {
    seedRow({ authorId: 'u1', docHash: HASH });
    seedRow({ authorId: 'u1', docHash: OTHER_HASH });
    const res = mkRes();
    await AN.clearScreeningAnnotations(mkReq({ body: { docHash: HASH, mode: 'mine' } }), res);
    expect(res.body.cleared).toBe(1);
    expect(rows.find((r) => r.docHash === OTHER_HASH).deletedAt).toBe(null);
  });
});

/* ── §87/§88 realtime ─────────────────────────────────────────────────────── */

describe('116.md §87/§88 — the poke carries ids only', () => {
  it('every mutation emits exactly one poke of { type, docHash } and nothing else', async () => {
    await AN.createScreeningAnnotation(mkReq({ body: goodCreate() }), mkRes());
    expect(emitToProjectMembers).toHaveBeenCalledTimes(1);
    const [pid, ev] = emitToProjectMembers.mock.calls[0];
    expect(pid).toBe('sp1');
    expect(Object.keys(ev).sort()).toEqual(['docHash', 'type']);
    expect(ev.type).toBe('annotation.changed');
    expect(ev.docHash).toBe(HASH);

    const serialized = JSON.stringify(ev);
    for (const secret of ['the primary outcome', 'green', 'Dr Ada Byron', 'u1', 'rec-1']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('update, delete and clear each poke once too', async () => {
    const row = seedRow();
    vi.clearAllMocks();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { color: 'blue' } }), mkRes());
    await AN.deleteScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id } }), mkRes());
    expect(emitToProjectMembers).toHaveBeenCalledTimes(2);
    for (const [, ev] of emitToProjectMembers.mock.calls) {
      expect(Object.keys(ev).sort()).toEqual(['docHash', 'type']);
    }
  });

  it('a REFUSED mutation pokes nobody', async () => {
    const row = seedRow({ authorId: 'someone-else' });
    vi.clearAllMocks();
    await AN.updateScreeningAnnotation(mkReq({ params: { pid: 'sp1', aid: row.id }, body: { color: 'blue' } }), mkRes());
    expect(emitToProjectMembers).not.toHaveBeenCalled();
  });

  it('a clear that removed nothing does not poke', async () => {
    const res = mkRes();
    await AN.clearScreeningAnnotations(mkReq({ body: { docHash: HASH, mode: 'mine' } }), res);
    expect(res.body.cleared).toBe(0);
    expect(emitToProjectMembers).not.toHaveBeenCalled();
  });

  it('the META·LAB scope pokes through the META·LAB channel instead', async () => {
    getProjectAccess.mockResolvedValue(null);
    resolveExtractionAccess.mockResolvedValue({
      project: { id: 'ml1', data: JSON.stringify({ studies: [{ id: 's1', document: { fileHash: HASH, storedName: 'x.pdf' } }] }) },
      ownerId: 'owner-1', isOwner: true, role: 'owner', canView: true, canEdit: true,
    });
    const res = mkRes();
    await AN.createMetaLabAnnotation(mkReq({ params: { mlpid: 'ml1' }, body: goodCreate({ studyId: 's1' }) }), res);
    expect(res.statusCode).toBe(201);
    expect(emitToMetaLabProject).toHaveBeenCalledTimes(1);
    const [mlpid, ownerId, ev] = emitToMetaLabProject.mock.calls[0];
    expect(mlpid).toBe('ml1');
    expect(ownerId).toBe('owner-1');
    expect(Object.keys(ev).sort()).toEqual(['docHash', 'type']);
    expect(rows[0].metaLabProjectId).toBe('ml1');
    expect(rows[0].screenProjectId).toBe(null);
  });

  it('a META·LAB hash that is in no study document 404s', async () => {
    getProjectAccess.mockResolvedValue(null);
    resolveExtractionAccess.mockResolvedValue({
      project: { id: 'ml1', data: JSON.stringify({ studies: [{ id: 's1', document: { fileHash: OTHER_HASH } }] }) },
      ownerId: 'owner-1', isOwner: true, role: 'owner', canView: true, canEdit: true,
    });
    const res = mkRes();
    await AN.listMetaLabAnnotations(mkReq({ params: { mlpid: 'ml1' }, query: { docHash: HASH } }), res);
    expect(res.statusCode).toBe(404);
  });
});

/* ── Blind mode ───────────────────────────────────────────────────────────── */

describe('116.md §80/§82 vs 81.md blind mode', () => {
  beforeEach(() => {
    seedRow({ authorId: 'u1', authorName: 'Dr Ada Byron', comment: 'mine' });
    seedRow({ authorId: 'u2', authorName: 'Dr Grace Hopper', comment: 'theirs' });
  });

  it('a blinded NON-LEADER gets the highlights but NOT the colleague\'s identity', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.blindReviewer);
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.annotations).toHaveLength(2);
    const mine = res.body.annotations.find((a) => a.comment === 'mine');
    const theirs = res.body.annotations.find((a) => a.comment === 'theirs');
    // Own row keeps its identity so own-vs-others and the edit gate still work.
    expect(mine.authorId).toBe('u1');
    expect(mine.authorName).toBe('Dr Ada Byron');
    // The colleague's identity is gone ON THE WIRE, but the annotation itself is shared.
    expect(theirs.authorId).toBe('');
    expect(theirs.authorName).toBe('');
    expect(theirs.comment).toBe('theirs');
    expect(JSON.stringify(res.body)).not.toContain('Grace Hopper');
  });

  it('the LEADER is exempt and sees every name (the 81.md convention)', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.blindLeader);
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ user: { id: 'the-leader' }, query: { docHash: HASH } }), res);
    expect(res.body.annotations.map((a) => a.authorName).sort()).toEqual(['Dr Ada Byron', 'Dr Grace Hopper']);
  });

  it('blinding does NOT apply when the project is not in blind mode', async () => {
    getProjectAccess.mockResolvedValue(ACCESS.reviewer);
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), res);
    expect(res.body.annotations.map((a) => a.authorName).sort()).toEqual(['Dr Ada Byron', 'Dr Grace Hopper']);
  });
});

/* ── List shape ───────────────────────────────────────────────────────────── */

describe('116.md §91 — the list contract', () => {
  it('returns the viewer id, the capabilities and a watermark for the next delta', async () => {
    seedRow();
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), res);
    expect(res.body.docHash).toBe(HASH);
    expect(res.body.viewerId).toBe('u1');
    expect(res.body.capabilities).toEqual({ canCreate: true, canModerate: false });
    expect(typeof res.body.serverTime).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.serverTime))).toBe(false);
  });

  /**
   * 116.md §91 (r3) — the watermark must be stamped BEHIND the read, not at it.
   *
   * `PdfAnnotation.updatedAt` is Prisma's `@updatedAt`: the query engine produces the
   * value when the statement is BUILT, strictly before it commits (the migration
   * declares the column with no database default). So a row can carry a timestamp
   * that predates a reader's watermark and still become visible only after that
   * reader's query returned — it is then in NO response (uncommitted at read time)
   * and in NO later delta (`updatedAt` <= the watermark, and the filter is `gt`).
   * The highlight never reaches that reader until a full refresh, while its author
   * sees it saved and shared.
   */
  it('a write that was in flight while the watermark was stamped still arrives in the next delta', async () => {
    const t1 = Date.now();
    const first = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), first);
    expect(first.body.annotations).toEqual([]);

    // Reviewer B's INSERT was built 100 ms before A stamped its watermark, and only
    // commits now (it was queued behind an unrelated write).
    seedRow({ clientId: 'an-late00001', createdAt: new Date(t1 - 100), updatedAt: new Date(t1 - 100) });

    const delta = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH, since: first.body.serverTime } }), delta);
    expect(delta.body.annotations.map((a) => a.clientId)).toEqual(['an-late00001']);
  });

  it('the watermark is deliberately behind the wall clock, and re-reading it is idempotent', async () => {
    const before = Date.now();
    seedRow({ updatedAt: new Date() });   // a row touched just now
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), res);
    expect(Date.parse(res.body.serverTime)).toBeLessThan(before);
    // The overlap it buys costs a repeat of a just-touched row, which merges to the
    // same list — §91's idempotency is what makes the lag safe.
    const again = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH, since: res.body.serverTime } }), again);
    expect(again.body.annotations).toHaveLength(1);
  });

  it('an unparseable ?since is ignored rather than returning nothing', async () => {
    seedRow();
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH, since: 'not-a-date' } }), res);
    expect(res.body.annotations).toHaveLength(1);
  });

  it('scopes strictly to (project, docHash) — never another project\'s rows', async () => {
    seedRow({ screenProjectId: 'sp1', docHash: HASH });
    seedRow({ screenProjectId: 'sp-other', docHash: HASH });
    seedRow({ screenProjectId: 'sp1', docHash: OTHER_HASH });
    const res = mkRes();
    await AN.listScreeningAnnotations(mkReq({ query: { docHash: HASH } }), res);
    expect(res.body.annotations).toHaveLength(1);
  });
});
