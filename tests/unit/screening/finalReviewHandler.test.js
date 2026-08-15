/**
 * finalReviewHandler.test.js — 117.md §52-§56. The finalize / revert HANDLERS, not
 * just the pure builders underneath them.
 *
 * What this pins:
 *  1. §52 — an EXCLUDED record can be reverted. Before this the endpoint answered 400
 *     for anything except 'accepted', so "user excludes an article → Ctrl+Z" had no
 *     inverse anywhere in the system.
 *  2. §52 — reverting clears `finalStatus` AND `rejectedReason`, and ACCEPTING clears a
 *     stale `rejectedReason`. Both columns are read by the PRISMA projection, the
 *     export and the inspector, so leaving either behind is a lie about the record.
 *  3. §54 — the optional `{ expect: { finalStatus } }` compare-and-set answers 409
 *     rather than clobbering a collaborator's verdict, and a request WITHOUT it
 *     behaves exactly as it did before.
 *  4. §56 — an undo/redo replay appends FINAL_REVIEW_UNDO / FINAL_REVIEW_REDO. The
 *     original row is never rewritten.
 *  5. §53 — the reversion is derivation-driven: the write changes the flow-relevant
 *     record columns and the surfaces that DERIVE the flow are poked to refetch.
 *
 * All dependencies are mocked → hermetic, no DB / HTTP / realtime.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../server/realtime/bus.js', () => ({
  emitToProjectMembers: vi.fn(),
  emitToMetaLabProject: vi.fn(),
}));
vi.mock('../../../server/screening/access.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getProjectAccess: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock('../../../server/screening/settings.js', () => ({
  getMetaSiftSettings: vi.fn(async () => ({ allowSecondReview: true })),
  getEffectiveQuorum: vi.fn(async () => 2),
}));
vi.mock('../../../server/store.js', () => ({
  mutateProjectBlob: vi.fn(async () => null),
  touchProjectActivity: vi.fn(async () => {}),
}));

// One ScreenRecord row + the updates applied to it.
const db = { record: null, updates: [] };
const prismaMock = {
  screenRecord: {
    findFirst: vi.fn(async ({ where }) => (
      db.record && db.record.id === where.id && db.record.projectId === where.projectId
        ? { ...db.record } : null
    )),
    update: vi.fn(async ({ where, data }) => {
      db.updates.push(data);
      if (db.record && db.record.id === where.id) db.record = { ...db.record, ...data };
      return { ...db.record };
    }),
  },
  project: { findFirst: vi.fn(async () => null) },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { finalizeRecord, revertFinalReview, FINAL_REVIEW_CONFLICT_MESSAGE, finalStatusMismatch } =
  await import('../../../server/controllers/screeningReviewController.js');
const { getProjectAccess, writeAudit } = await import('../../../server/screening/access.js');
const { emitToProjectMembers } = await import('../../../server/realtime/bus.js');

const PID = 'sp1';
const RID = 'rec1';

const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const seed = (over = {}) => {
  db.record = {
    id: RID, projectId: PID, currentStage: 'full_text',
    finalStatus: '', rejectedReason: '', acceptedAt: null,
    handoffStatus: '', handoffStudyId: '', handoffError: '',
    revertedExtractionSnapshot: null,
    ...over,
  };
  db.updates = [];
};

const callFinalize = async (body) => {
  const res = mkRes();
  await finalizeRecord({ params: { pid: PID, rid: RID }, user: { id: 'u1', name: 'Leader' }, body }, res);
  return res;
};
const callRevert = async (body) => {
  const res = mkRes();
  await revertFinalReview({ params: { pid: PID, rid: RID }, user: { id: 'u1', name: 'Leader' }, body }, res);
  return res;
};
const lastUpdate = () => db.updates[db.updates.length - 1];
const auditCalls = () => writeAudit.mock.calls.map(([, , action, opts]) => ({ action, ...opts }));

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAccess.mockResolvedValue({
    project: { id: PID, ownerId: 'u1', linkedMetaLabProjectId: null },
    isLeader: true, canResolveConflicts: true,
  });
  seed();
});

describe('§52 — an EXCLUDED record is reversible', () => {
  it('reverts a rejected record: finalStatus "" and the reason cleared', async () => {
    seed({ finalStatus: 'rejected', rejectedReason: 'wrong population' });
    const res = await callRevert({});
    expect(res.statusCode).toBe(200);
    expect(lastUpdate().finalStatus).toBe('');
    expect(lastUpdate().rejectedReason).toBe('');
    expect(res.body.reverted.from).toBe('rejected');
    // No extraction entry ever existed for a rejected record.
    expect(res.body.reverted.removedFromExtraction).toBe(false);
  });

  it('still reverts an accepted record, and still keeps the extraction snapshot', async () => {
    seed({ finalStatus: 'accepted', acceptedAt: new Date(), revertedExtractionSnapshot: '{"id":"s1"}' });
    const res = await callRevert({});
    expect(res.statusCode).toBe(200);
    expect(res.body.reverted.from).toBe('accepted');
    expect(lastUpdate().revertedExtractionSnapshot).toBe('{"id":"s1"}');
    expect(lastUpdate().handoffStatus).toBe('');
    expect(lastUpdate().acceptedAt).toBeNull();
  });

  it('refuses a record that has no final decision to revert', async () => {
    seed({ finalStatus: '' });
    const res = await callRevert({});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Only a finalized record/);
  });
});

describe('§52 — accepting clears a stale exclusion reason', () => {
  it('drops rejectedReason on the accept branch', async () => {
    // The exact state a redo produces: excluded, reopened, accepted.
    seed({ finalStatus: 'rejected', rejectedReason: 'no full text' });
    const res = await callFinalize({ decision: 'accept' });
    expect(res.statusCode).toBe(200);
    expect(lastUpdate().finalStatus).toBe('accepted');
    expect(lastUpdate().rejectedReason).toBe('');
  });

  it('writes the reason on the reject branch, capped', async () => {
    const res = await callFinalize({ decision: 'reject', reason: 'x'.repeat(900) });
    expect(res.statusCode).toBe(200);
    expect(lastUpdate().finalStatus).toBe('rejected');
    expect(lastUpdate().rejectedReason.length).toBe(500);
  });
});

describe('§54 — the optional compare-and-set', () => {
  it('409s when the stored status is not the one the caller expected', async () => {
    seed({ finalStatus: 'accepted' });
    const res = await callRevert({ expect: { finalStatus: 'rejected' } });
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe(FINAL_REVIEW_CONFLICT_MESSAGE);
    expect(res.body.conflict).toBe(true);
    // …and the current state travels back so the client can reconcile.
    expect(res.body.record.finalStatus).toBe('accepted');
    expect(db.updates).toHaveLength(0);
  });

  it('409s a finalize whose expectation is stale, writing nothing', async () => {
    seed({ finalStatus: 'accepted' });
    const res = await callFinalize({ decision: 'reject', reason: 'r', expect: { finalStatus: '' } });
    expect(res.statusCode).toBe(409);
    expect(db.updates).toHaveLength(0);
  });

  it('proceeds when the expectation matches', async () => {
    seed({ finalStatus: 'rejected', rejectedReason: 'r' });
    const res = await callRevert({ expect: { finalStatus: 'rejected' } });
    expect(res.statusCode).toBe(200);
  });

  it('is OPTIONAL — a body without `expect` behaves exactly as before', async () => {
    seed({ finalStatus: 'accepted' });
    expect((await callRevert({})).statusCode).toBe(200);
    expect(finalStatusMismatch({ finalStatus: 'accepted' }, {})).toBe(false);
    expect(finalStatusMismatch({ finalStatus: 'accepted' }, undefined)).toBe(false);
    expect(finalStatusMismatch({ finalStatus: 'accepted' }, { expect: {} })).toBe(false);
    // '' is a real expectation, not an absent one.
    expect(finalStatusMismatch({ finalStatus: 'accepted' }, { expect: { finalStatus: '' } })).toBe(true);
    expect(finalStatusMismatch({ finalStatus: null }, { expect: { finalStatus: '' } })).toBe(false);
  });
});

describe('§56 — undo/redo append their own rows, they never rewrite one', () => {
  it('audits an undone exclusion as FINAL_REVIEW_UNDO', async () => {
    seed({ finalStatus: 'rejected', rejectedReason: 'wrong population' });
    await callRevert({ via: 'undo' });
    const rows = auditCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('FINAL_REVIEW_UNDO');
    expect(rows[0].entityType).toBe('record');
    expect(rows[0].entityId).toBe(RID);
    expect(rows[0].details.op).toBe('RECORD_REVERTED');
    expect(rows[0].details.from).toBe('rejected');
    // The reason that was cleared is preserved IN the row — the trail can still say
    // what the record looked like before the undo.
    expect(rows[0].details.clearedReason).toBe('wrong population');
  });

  it('audits a redone exclusion as FINAL_REVIEW_REDO', async () => {
    await callFinalize({ decision: 'reject', reason: 'wrong population', via: 'redo' });
    const rows = auditCalls();
    expect(rows[0].action).toBe('FINAL_REVIEW_REDO');
    expect(rows[0].details.op).toBe('RECORD_REJECTED');
    expect(rows[0].details.via).toBe('redo');
  });

  it('keeps a human decision on its own action class', async () => {
    await callFinalize({ decision: 'reject', reason: 'r' });
    expect(auditCalls()[0].action).toBe('RECORD_REJECTED');
    vi.clearAllMocks();
    seed({ finalStatus: 'accepted' });
    await callRevert({});
    expect(auditCalls()[0].action).toBe('RECORD_REVERTED');
  });

  it('ignores a forged marker rather than minting a class for it', async () => {
    seed({ finalStatus: 'rejected', rejectedReason: 'r' });
    await callRevert({ via: 'automation' });
    expect(auditCalls()[0].action).toBe('RECORD_REVERTED');
    expect(auditCalls()[0].details.claimedVia).toBe('user');
  });
});

describe('§53 — the reversion is derivation-driven, and the surfaces are told', () => {
  it('a revert changes the record columns the PRISMA projection reads', async () => {
    seed({ finalStatus: 'rejected', rejectedReason: 'wrong population' });
    const before = { finalStatus: db.record.finalStatus, rejectedReason: db.record.rejectedReason };
    await callRevert({});
    // `finalStatus` + `rejectedReason` are both in prismaFlowService's
    // BASE_RECORD_SELECT: the flow, the counts and the exclusion-reason breakdown are
    // DERIVED from them at read, so changing them here IS the reversion. Nothing
    // stores a second copy of the diagram to keep in sync.
    expect(before.finalStatus).toBe('rejected');
    expect(db.record.finalStatus).toBe('');
    expect(db.record.rejectedReason).toBe('');
  });

  it('pokes both the screening shells and the PRISMA surfaces on revert', async () => {
    seed({ finalStatus: 'accepted' });
    await callRevert({});
    const types = emitToProjectMembers.mock.calls.map(([, ev]) => ev.type);
    expect(types).toContain('handoff.updated');
    // PrismaFlowDiagram / PrismaInspector subscribe to `record.updated` (116.md §10);
    // without it an open diagram kept pre-revert numbers indefinitely.
    expect(types).toContain('record.updated');
    const poke = emitToProjectMembers.mock.calls.find(([, ev]) => ev.type === 'record.updated');
    expect(poke[1].ids).toEqual([RID]);          // ids only — no record content on the wire
    expect(poke[2]).toEqual({ exclude: 'u1' });  // the actor does not poke themselves
  });

  it('pokes the same pair on both finalize branches', async () => {
    await callFinalize({ decision: 'reject', reason: 'r' });
    let types = emitToProjectMembers.mock.calls.map(([, ev]) => ev.type);
    expect(types).toEqual(expect.arrayContaining(['handoff.updated', 'record.updated']));
    vi.clearAllMocks();
    seed();
    await callFinalize({ decision: 'accept' });
    types = emitToProjectMembers.mock.calls.map(([, ev]) => ev.type);
    expect(types).toEqual(expect.arrayContaining(['handoff.updated', 'record.updated']));
  });
});

describe('guards that must survive the widening', () => {
  it('still refuses a non-leader', async () => {
    getProjectAccess.mockResolvedValue({
      project: { id: PID, ownerId: 'u9', linkedMetaLabProjectId: null },
      isLeader: false, canResolveConflicts: false,
    });
    seed({ finalStatus: 'rejected' });
    const res = await callRevert({});
    expect(res.statusCode).toBe(403);
    expect(db.updates).toHaveLength(0);
  });

  it('still 404s an unknown project and an unknown record', async () => {
    getProjectAccess.mockResolvedValue(null);
    expect((await callRevert({})).statusCode).toBe(404);
    getProjectAccess.mockResolvedValue({
      project: { id: PID, ownerId: 'u1', linkedMetaLabProjectId: null },
      isLeader: true, canResolveConflicts: true,
    });
    db.record = null;
    expect((await callRevert({})).statusCode).toBe(404);
  });

  it('still refuses a finalize before the record reached full text', async () => {
    seed({ currentStage: 'title_abstract' });
    const res = await callFinalize({ decision: 'accept' });
    expect(res.statusCode).toBe(400);
  });
});
