/**
 * finalDecisionAudit.test.js — 117.md §88 (+ §56). The saveDecision HANDLER's new
 * final-review audit, wired end to end.
 *
 * §88 asks for "final review include/exclude, undo, redo" to be traceable. Reviewer
 * full-text decisions were the gap: the most consequential vote in the workflow wrote
 * a ScreenDecision row and nothing else, so "who excluded this at full text, and did
 * anyone undo it?" was unanswerable from the project ledger.
 *
 * The FILTER is the other half of §88 ("do not turn ordinary … into excessive audit
 * noise") and is tested exhaustively in finalReviewAudit.test.js. What this file pins
 * is the WIRING the pure builder cannot see: that the handler reads the PRE-IMAGE
 * decision (the transition is what decides whether a row is written at all), that it
 * threads the request's `via` marker through, and that title/abstract screening is
 * still completely untouched.
 *
 * All dependencies are mocked → hermetic, no DB / HTTP / realtime / AI.
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
vi.mock('../../../server/store.js', async (importOriginal) => ({
  ...(await importOriginal()),
  touchProjectActivity: vi.fn(async () => {}),
}));
vi.mock('../../../server/services/screeningConflictService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  syncConflicts: vi.fn(async () => {}),
}));
vi.mock('../../../server/services/analytics.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordEvent: vi.fn(),
  recordFirstEvent: vi.fn(),
}));
vi.mock('../../../server/services/screeningAiJobs.js', async (importOriginal) => ({
  ...(await importOriginal()),
  scheduleRescore: vi.fn(),
}));

const db = { record: null, decision: null };
const prismaMock = {
  screenRecord: {
    findFirst: vi.fn(async ({ where }) => (
      db.record && db.record.id === where.id ? { ...db.record } : null
    )),
    update: vi.fn(async ({ data }) => { db.record = { ...db.record, ...data }; return { ...db.record }; }),
  },
  screenDecision: {
    findUnique: vi.fn(async () => (db.decision ? { ...db.decision } : null)),
    findMany: vi.fn(async () => []),
    upsert: vi.fn(async ({ create, update }) => {
      db.decision = db.decision ? { ...db.decision, ...update } : { ...create };
      return { ...db.decision };
    }),
  },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { saveDecision } = await import('../../../server/controllers/screeningController.js');
const { getProjectAccess, writeAudit } = await import('../../../server/screening/access.js');

const PID = 'sp1';
const RID = 'rec1';

const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

const seed = ({ priorDecision = null, currentStage = 'full_text' } = {}) => {
  db.record = { id: RID, projectId: PID, currentStage };
  db.decision = priorDecision === null ? null : { decision: priorDecision, rating: null, notes: '' };
};

const call = async (body) => {
  const res = mkRes();
  await saveDecision({ params: { pid: PID, rid: RID }, user: { id: 'u1', email: 'a@b.c' }, body }, res);
  return res;
};
const auditCalls = () => writeAudit.mock.calls.map(([, , action, opts]) => ({ action, ...opts }));

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAccess.mockResolvedValue({
    project: { id: PID, linkedMetaLabProjectId: null, requiredScreeningReviewers: 2 },
    canScreen: true,
    member: { name: 'Dr A' },
  });
  seed();
});

describe('§88 — settled full-text decisions reach the ledger', () => {
  it('audits a first exclude, naming the reviewer and the reason', async () => {
    const res = await call({ decision: 'exclude', exclusionReason: 'wrong population', stage: 'full_text' });
    expect(res.statusCode).toBe(200);
    const rows = auditCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('FINAL_REVIEW_DECISION');
    expect(rows[0].entityId).toBe(RID);
    expect(rows[0].details).toMatchObject({
      stage: 'full_text', decision: 'exclude', previous: 'undecided',
      reviewerName: 'Dr A', exclusionReason: 'wrong population', via: 'user',
    });
  });

  it('reads the PRE-IMAGE decision, so a repeat writes no row', async () => {
    seed({ priorDecision: 'include' });
    await call({ decision: 'include', stage: 'full_text' });
    expect(auditCalls()).toHaveLength(0);
    // The decision itself is still saved — only the LEDGER stays quiet.
    expect(prismaMock.screenDecision.upsert).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for maybe/undecided churn', async () => {
    seed({ priorDecision: 'maybe' });
    await call({ decision: 'undecided', stage: 'full_text' });
    expect(auditCalls()).toHaveLength(0);
  });

  it('never audits title/abstract screening', async () => {
    seed({ currentStage: 'title_abstract' });
    await call({ decision: 'include', stage: 'title_abstract' });
    expect(auditCalls().filter(r => String(r.action).startsWith('FINAL_REVIEW'))).toHaveLength(0);
  });
});

describe('§56 — an undone full-text vote is its own ledger row', () => {
  it('audits the undo of an include as FINAL_REVIEW_UNDO', async () => {
    seed({ priorDecision: 'include' });
    const res = await call({ decision: 'undecided', stage: 'full_text', via: 'undo' });
    expect(res.statusCode).toBe(200);
    const rows = auditCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('FINAL_REVIEW_UNDO');
    expect(rows[0].details.op).toBe('FINAL_REVIEW_DECISION_CLEARED');
    expect(rows[0].details.previous).toBe('include');
    expect(rows[0].details.decision).toBe('undecided');
  });

  it('audits the redo as FINAL_REVIEW_REDO, distinct from a fresh vote', async () => {
    seed({ priorDecision: 'undecided' });
    await call({ decision: 'include', stage: 'full_text', via: 'redo' });
    expect(auditCalls()[0].action).toBe('FINAL_REVIEW_REDO');
    vi.clearAllMocks();
    seed({ priorDecision: 'undecided' });
    await call({ decision: 'include', stage: 'full_text' });
    expect(auditCalls()[0].action).toBe('FINAL_REVIEW_DECISION');
  });

  it('degrades a forged marker instead of minting a class for it', async () => {
    await call({ decision: 'exclude', stage: 'full_text', via: 'robot' });
    expect(auditCalls()[0].action).toBe('FINAL_REVIEW_DECISION');
    expect(auditCalls()[0].details.claimedVia).toBe('user');
  });
});

describe('the decision write itself is unchanged', () => {
  it('still writes at the EXPLICIT stage the caller asked for (the stage trap)', async () => {
    seed({ currentStage: 'full_text' });
    await call({ decision: 'include', stage: 'full_text' });
    const args = prismaMock.screenDecision.upsert.mock.calls[0][0];
    expect(args.where.recordId_reviewerId_stage.stage).toBe('full_text');
    expect(args.create.stage).toBe('full_text');
  });

  it('still rejects an invalid decision value before touching anything', async () => {
    const res = await call({ decision: 'perhaps', stage: 'full_text' });
    expect(res.statusCode).toBe(400);
    expect(prismaMock.screenDecision.upsert).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(0);
  });
});
