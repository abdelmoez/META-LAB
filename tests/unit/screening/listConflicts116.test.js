/**
 * listConflicts116.test.js — 116.md §67 (§§67-70, D14). The widened Conflicts wire
 * contract, handler-level and hermetic (mock prisma + mock access; the
 * prismaInspectorApi116 / duplicateResolveEmit pattern).
 *
 * GET /projects/:pid/conflicts now carries everything the Conflict tab needs to be
 * a real reading surface:
 *   • record: id, title, authors, year, journal, doi, pmid, abstract, keywords,
 *     sourceDb, isDuplicate, currentStage, finalStatus  (§§67-68)
 *   • decisions[]: the title/abstract ScreenDecision rows behind the conflict —
 *     reviewerName, decision, exclusionReason, notes, rating, decidedAt,
 *     isMe/isEngine  (§70)
 *   • blindMode + isLeader, so the client mirrors the server's answer.
 *
 * BLINDING (the load-bearing pin): the 81.md LEADER-EXEMPT WIRE-LEVEL convention
 * from listRecords/listSecondReview. A blinded NON-LEADER resolver must receive no
 * colleague identity (no reviewerId, no real name) and no free-text decision detail
 * (reason/note/rating) — and no authors/journal — ON THE WIRE, not merely hidden in
 * the UI. The leader is exempt and sees everything.
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

const D = new Date('2026-02-01T00:00:00Z');

const RECORD = {
  id: 'rec-1',
  title: 'A randomized trial of drug-resistant epilepsy surgery',
  authors: 'Doe J, Roe R',
  year: '2021',
  journal: 'Journal of Trials',
  doi: '10.1000/xyz123',
  pmid: '12345678',
  abstract: 'BACKGROUND: Drug-resistant epilepsy is common. METHODS: A randomized controlled trial.',
  keywords: 'epilepsy; surgery',
  sourceDb: 'PubMed',
  isDuplicate: false,
  currentStage: 'title_abstract',
  finalStatus: '',
};

const db = {
  conflicts: [{
    id: 'cf-1', projectId: 'sp1', recordId: 'rec-1',
    reviewerDecisions: '{"u1":"include","u2":"exclude"}',
    finalDecision: '', resolvedBy: '', resolvedAt: null, notes: '',
    createdAt: D, updatedAt: D,
    record: { ...RECORD },
  }],
  decisions: [
    {
      id: 'd1', recordId: 'rec-1', reviewerId: 'u1', reviewerName: 'Dr Ada Byron',
      stage: 'title_abstract', decision: 'include', exclusionReason: '',
      notes: 'Population matches the PICO.', rating: 4, createdAt: D, updatedAt: D,
    },
    {
      id: 'd2', recordId: 'rec-1', reviewerId: 'u2', reviewerName: 'Dr Grace Hopper',
      stage: 'title_abstract', decision: 'exclude', exclusionReason: 'Wrong population',
      notes: 'Paediatric cohort.', rating: 2, createdAt: D, updatedAt: D,
    },
  ],
};

const prismaMock = {
  screenConflict: { findMany: vi.fn(async () => db.conflicts) },
  screenDecision: { findMany: vi.fn(async () => db.decisions) },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { listConflicts } = await import('../../../server/controllers/screeningController.js');
const { getProjectAccess } = await import('../../../server/screening/access.js');

const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mkReq = (userId = 'u1') => ({ params: { pid: 'sp1' }, query: {}, body: {}, user: { id: userId } });

const LEADER = {
  project: { id: 'sp1', blindMode: false },
  member: { role: 'leader', status: 'active' },
  isOwner: true, isLeader: true, active: true, canResolveConflicts: true,
};
const BLIND_LEADER = { ...LEADER, project: { id: 'sp1', blindMode: true } };
// A member who was granted canResolveConflicts WITHOUT being the leader: still blinded.
const BLIND_RESOLVER = {
  project: { id: 'sp1', blindMode: true },
  member: { role: 'reviewer', status: 'active' },
  isOwner: false, isLeader: false, active: true, canResolveConflicts: true,
};
const PLAIN_REVIEWER = { ...BLIND_RESOLVER, project: { id: 'sp1', blindMode: false }, canResolveConflicts: false };

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAccess.mockResolvedValue(LEADER);
  prismaMock.screenConflict.findMany.mockResolvedValue(db.conflicts);
  prismaMock.screenDecision.findMany.mockResolvedValue(db.decisions);
});

describe('listConflicts — access (unchanged)', () => {
  it('outsider gets the existence-hiding 404', async () => {
    getProjectAccess.mockResolvedValue(null);
    const res = mkRes();
    await listConflicts(mkReq(), res);
    expect(res.statusCode).toBe(404);
  });

  it('a member without canResolveConflicts gets a 403 and no data', async () => {
    getProjectAccess.mockResolvedValue(PLAIN_REVIEWER);
    const res = mkRes();
    await listConflicts(mkReq('u2'), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.conflicts).toBeUndefined();
    expect(prismaMock.screenConflict.findMany).not.toHaveBeenCalled();
  });
});

describe('listConflicts — the widened record payload (116.md §§67-68)', () => {
  it('selects the full article metadata the shared article card renders', async () => {
    const res = mkRes();
    await listConflicts(mkReq(), res);
    expect(res.statusCode).toBe(200);
    const select = prismaMock.screenConflict.findMany.mock.calls[0][0].include.record.select;
    for (const f of ['id', 'title', 'authors', 'year', 'journal', 'doi', 'pmid',
      'abstract', 'keywords', 'sourceDb', 'isDuplicate', 'currentStage']) {
      expect(select[f]).toBe(true);
    }
    const rec = res.body.conflicts[0].record;
    expect(rec.abstract).toContain('Drug-resistant epilepsy');
    expect(rec.journal).toBe('Journal of Trials');
    expect(rec.doi).toBe('10.1000/xyz123');
    expect(rec.pmid).toBe('12345678');
    expect(rec.keywords).toBe('epilepsy; surgery');
    expect(rec.sourceDb).toBe('PubMed');
    expect(rec.isDuplicate).toBe(false);
    // The client mirrors the server's blinding answer.
    expect(res.body.blindMode).toBe(false);
    expect(res.body.isLeader).toBe(true);
  });

  it('keeps the conflict row fields the resolve UX already used', async () => {
    const res = mkRes();
    await listConflicts(mkReq(), res);
    const c = res.body.conflicts[0];
    expect(c.id).toBe('cf-1');
    expect(c.reviewerDecisions).toBe('{"u1":"include","u2":"exclude"}');
    expect(c.resolvedAt).toBeNull();
    expect(c.finalDecision).toBe('');
  });
});

describe('listConflicts — per-reviewer decision context (116.md §70)', () => {
  it('joins the title/abstract decisions with names, reasons, notes and ratings', async () => {
    const res = mkRes();
    await listConflicts(mkReq('u1'), res);
    const decs = res.body.conflicts[0].decisions;
    expect(decs).toHaveLength(2);
    expect(decs[0]).toMatchObject({
      reviewerId: 'u1', reviewerName: 'Dr Ada Byron', decision: 'include',
      exclusionReason: '', notes: 'Population matches the PICO.', rating: 4,
      isMe: true, isEngine: false,
    });
    expect(decs[1]).toMatchObject({
      reviewerId: 'u2', reviewerName: 'Dr Grace Hopper', decision: 'exclude',
      exclusionReason: 'Wrong population', notes: 'Paediatric cohort.', rating: 2,
      isMe: false, isEngine: false,
    });
    expect(decs[0].decidedAt).toEqual(D);
  });

  it('queries only this project\'s conflicted records, at the conflict stage, excluding undecided', async () => {
    const res = mkRes();
    await listConflicts(mkReq(), res);
    expect(res.statusCode).toBe(200);
    const args = prismaMock.screenDecision.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      projectId: 'sp1',
      recordId: { in: ['rec-1'] },
      stage: 'title_abstract',
      decision: { not: 'undecided' },
    });
    // A stable order — the positional "Reviewer N" labels blind mode hands out must
    // mean the same reviewer on every request (100.md §§13/15).
    expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('does not query decisions at all when there are no conflicts', async () => {
    prismaMock.screenConflict.findMany.mockResolvedValue([]);
    const res = mkRes();
    await listConflicts(mkReq(), res);
    expect(res.body.conflicts).toEqual([]);
    expect(prismaMock.screenDecision.findMany).not.toHaveBeenCalled();
  });

  it('labels an eligibility-engine vote as automated instead of as a colleague', async () => {
    prismaMock.screenDecision.findMany.mockResolvedValue([
      db.decisions[0],
      {
        id: 'd3', recordId: 'rec-1', reviewerId: 'eligibility-engine', reviewerName: '',
        stage: 'title_abstract', decision: 'exclude', exclusionReason: 'Not an RCT',
        notes: '', rating: null, createdAt: D, updatedAt: D,
      },
    ]);
    const res = mkRes();
    await listConflicts(mkReq(), res);
    const engine = res.body.conflicts[0].decisions[1];
    expect(engine.isEngine).toBe(true);
    expect(engine.reviewerName).toBe('Eligibility screening (automated)');
  });
});

/* ════════ BLINDING — leader-exempt, enforced on the wire ════════ */

describe('listConflicts — blind mode (81.md convention, 116.md §70)', () => {
  it('a blinded NON-LEADER resolver receives no identity and no decision detail', async () => {
    getProjectAccess.mockResolvedValue(BLIND_RESOLVER);
    const res = mkRes();
    await listConflicts(mkReq('u2'), res);
    expect(res.statusCode).toBe(200);
    const c = res.body.conflicts[0];

    // Article: authors + journal blanked (81.md).
    expect(c.record.authors).toBe('');
    expect(c.record.journal).toBe('');
    // …but the science still arrives: title, abstract, identifiers.
    expect(c.record.title).toBe(RECORD.title);
    expect(c.record.abstract).toBe(RECORD.abstract);

    // Reviewers: positional labels only, no ids, no free text, no rating.
    expect(c.decisions.map(d => d.reviewerName)).toEqual(['Reviewer 1', 'Reviewer 2']);
    for (const d of c.decisions) {
      expect(d.reviewerId).toBeUndefined();
      expect(d.exclusionReason).toBe('');
      expect(d.notes).toBe('');
      expect(d.rating).toBeNull();
    }
    // The bare decisions DO ship — that a disagreement exists is the point of the tab.
    expect(c.decisions.map(d => d.decision)).toEqual(['include', 'exclude']);
    expect(res.body.blindMode).toBe(true);
    expect(res.body.isLeader).toBe(false);

    // Nothing identifying survives anywhere in the serialized response.
    const wire = JSON.stringify(res.body);
    for (const leak of ['Dr Ada Byron', 'Dr Grace Hopper', 'Doe J, Roe R',
      'Journal of Trials', 'Wrong population', 'Paediatric cohort.',
      'Population matches the PICO.']) {
      expect(wire).not.toContain(leak);
    }
    // …including through the LEGACY reviewerDecisions map, whose keys are user ids:
    // it is re-keyed to positional placeholders, decisions intact.
    expect(wire).not.toContain('u1');
    expect(wire).not.toContain('u2');
    expect(JSON.parse(c.reviewerDecisions)).toEqual({ 'reviewer-1': 'include', 'reviewer-2': 'exclude' });
  });

  it('a malformed legacy decision map degrades to an empty map under blind mode', async () => {
    getProjectAccess.mockResolvedValue(BLIND_RESOLVER);
    prismaMock.screenConflict.findMany.mockResolvedValue([
      { ...db.conflicts[0], reviewerDecisions: 'not json' },
    ]);
    const res = mkRes();
    await listConflicts(mkReq('u2'), res);
    expect(res.body.conflicts[0].reviewerDecisions).toBe('{}');
  });

  it('the LEADER is exempt on a blind project — everything is visible', async () => {
    getProjectAccess.mockResolvedValue(BLIND_LEADER);
    const res = mkRes();
    await listConflicts(mkReq(), res);
    const c = res.body.conflicts[0];
    expect(c.record.authors).toBe('Doe J, Roe R');
    expect(c.record.journal).toBe('Journal of Trials');
    expect(c.decisions[0].reviewerName).toBe('Dr Ada Byron');
    expect(c.decisions[1].exclusionReason).toBe('Wrong population');
    expect(c.decisions[1].rating).toBe(2);
    expect(res.body.blindMode).toBe(true);
    expect(res.body.isLeader).toBe(true);
  });

  it('an automated vote keeps its non-identifying label under blind mode', async () => {
    getProjectAccess.mockResolvedValue(BLIND_RESOLVER);
    prismaMock.screenDecision.findMany.mockResolvedValue([
      db.decisions[0],
      {
        id: 'd3', recordId: 'rec-1', reviewerId: 'eligibility-engine', reviewerName: 'Eligibility screening (automated)',
        stage: 'title_abstract', decision: 'exclude', exclusionReason: 'Not an RCT',
        notes: '', rating: null, createdAt: D, updatedAt: D,
      },
    ]);
    const res = mkRes();
    await listConflicts(mkReq('u2'), res);
    const decs = res.body.conflicts[0].decisions;
    expect(decs[0].reviewerName).toBe('Reviewer 1');
    expect(decs[1].reviewerName).toBe('Eligibility screening (automated)');
    expect(decs[1].reviewerId).toBeUndefined();
    expect(decs[1].exclusionReason).toBe(''); // still no free text
  });
});
