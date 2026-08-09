/**
 * duplicateResolveEmit.test.js — 107.md §1 (rec round). The three duplicate-group
 * resolution paths must poke EVERY project member, the resolving user INCLUDED.
 *
 * Why the initiator matters: in the Stitch theme the workflow stepper's
 * "N unresolved" count comes from `useScreeningSummary` in StitchProjectWorkspace,
 * a different owner from the embedded SiftProject that DuplicatesTab refreshes after
 * a resolve — and it has no polling loop. An emit carrying `{ exclude: req.user.id }`
 * is dropped for the acting user by bus.js, so the person who just resolved the last
 * group kept seeing the stale count until a full page reload. The extra refetch is
 * idempotent; this is the same argument `emitDuplicateJobTerminal` already applies.
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
  writeAudit: vi.fn(async () => {}),
}));
vi.mock('../../../server/services/screeningDuplicateService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  recordDuplicateLabels: vi.fn(async () => {}),
}));

const REC = (id, over = {}) => ({
  id, title: `Paper ${id}`, authors: 'A', year: 2024, journal: 'J',
  doi: `10.1/${id}`, pmid: '', abstract: 'x', keywords: '', createdAt: new Date(), ...over,
});

const db = { records: [REC('r1'), REC('r2', { doi: '10.1/r1' })] };
const prismaMock = {
  screenDuplicateJob: { findFirst: vi.fn(async () => null) },
  screenDuplicateGroup: {
    findFirst: vi.fn(async () => ({ id: 'g1', projectId: 'sp1', resolvedAt: null })),
    findMany: vi.fn(async () => [{ id: 'g1', records: db.records }]),
    update: vi.fn(async () => ({})),
  },
  screenRecord: {
    findMany: vi.fn(async () => db.records),
    updateMany: vi.fn(async () => ({ count: 2 })),
    update: vi.fn(async () => ({})),
  },
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { resolveDuplicateGroup, resolveAllExactDuplicates } =
  await import('../../../server/controllers/screeningController.js');
const { getProjectAccess } = await import('../../../server/screening/access.js');
const { emitToProjectMembers } = await import('../../../server/realtime/bus.js');

const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const mkReq = (body = {}) => ({ params: { pid: 'sp1', gid: 'g1' }, user: { id: 'resolver-1' }, body });

/** Every project.updated emitted on this path, with its options argument. */
const projectUpdatedCalls = () => emitToProjectMembers.mock.calls
  .filter(([, ev]) => ev?.type === 'project.updated');

beforeEach(() => {
  vi.clearAllMocks();
  getProjectAccess.mockResolvedValue({
    project: { id: 'sp1', linkedMetaLabProjectId: null },
    isOwner: true, active: true, isLeader: true, perms: { canManageDuplicates: true },
  });
});

describe('duplicate-group resolution emits reach the initiator (107.md §1)', () => {
  it('"Not duplicates — keep all" pokes every member, nobody excluded', async () => {
    const res = mkRes();
    await resolveDuplicateGroup(mkReq({ keepAll: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ resolved: true, keepAll: true });
    expect(projectUpdatedCalls()).toEqual([['sp1', { type: 'project.updated' }]]);
  });

  it('resolving a group with a primary pokes every member, nobody excluded', async () => {
    const res = mkRes();
    await resolveDuplicateGroup(mkReq({ primaryId: 'r1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolved).toBe(true);
    expect(projectUpdatedCalls()).toEqual([['sp1', { type: 'project.updated' }]]);
  });

  it('the bulk exact resolve pokes every member, nobody excluded', async () => {
    const res = mkRes();
    await resolveAllExactDuplicates(mkReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.resolvedGroups).toBe(1);
    expect(projectUpdatedCalls()).toEqual([['sp1', { type: 'project.updated' }]]);
  });

  it('the bulk resolve stays silent when it resolved nothing', async () => {
    prismaMock.screenDuplicateGroup.findMany.mockResolvedValueOnce([]);
    const res = mkRes();
    await resolveAllExactDuplicates(mkReq(), res);
    expect(res.body.resolvedGroups).toBe(0);
    expect(projectUpdatedCalls()).toEqual([]);
  });
});
