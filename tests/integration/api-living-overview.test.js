/**
 * tests/integration/api-living-overview.test.js — 75.md Phase 5 regression guard.
 *
 * ROOT-CAUSE REGRESSION (the exact previously-uncovered path):
 * getUpdateQueue() filtered `screenRecordId: { not: null }` on a NON-nullable
 * column (`screenRecordId String @default("")`). Prisma 5.22 rejects `{ not: null }`
 * on a non-nullable field at query-validation time, so the FIRST time any
 * `living:`-keyed run existed for a project, GET /overview AND /queue threw
 * PrismaClientValidationError and 500'd permanently. Fixed to `{ not: '' }`.
 *
 * This suite reproduces that precondition in-process (service level) against the
 * real dev SQLite DB: it seeds a `living:`-keyed run with landed + empty-provenance
 * + wrong-outcome source records and a decided record, then asserts getUpdateQueue
 * RESOLVES (previously it THREW) and returns only the landed, undecided record.
 * It also proves the additive weekly day/hour columns round-trip through
 * createSavedSearch → the DB → shapeSearch.
 *
 * It writes to and self-cleans the shared DB (NOT part of the hermetic unit gate),
 * mirroring pecanSearch.integration.test.js. It never mutates the global feature
 * flag, so it is safe beside the flag-gate suite (which asserts 404 while OFF).
 *
 * NOTE: the full HTTP route (GET /overview + /queue → 200) exercises this SAME
 * getUpdateQueue behind the livingReview flag + an authenticated project owner. It
 * is verified after the orchestrator restarts the server with this fix; the running
 * dev server still holds the PRE-FIX code, so an HTTP 200 assertion cannot pass
 * until that restart. Enabling the global flag here to force the HTTP path would
 * break the sibling gate tests, so it is intentionally left to the restart step.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { getUpdateQueue, createSavedSearch } from '../../server/living/livingService.js';

const tag = `living_ov_${Date.now()}`;
let user, project, sp, run, r1, r2;

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'Living Overview' } });
  project = await prisma.project.create({ data: { userId: user.id, name: 'Living Overview', data: '{}' } });
  sp = await prisma.screenProject.create({ data: { ownerId: user.id, title: 'Linked WS', linkedMetaLabProjectId: project.id } });

  // Two landed screening records. r1 stays undecided (queue-eligible); r2 gets a
  // screening decision so getUpdateQueue must drop it.
  r1 = await prisma.screenRecord.create({ data: { projectId: sp.id, title: 'Landed record 1', pmid: '111' } });
  r2 = await prisma.screenRecord.create({ data: { projectId: sp.id, title: 'Landed record 2', pmid: '222' } });
  await prisma.screenDecision.create({ data: { projectId: sp.id, recordId: r2.id, reviewerId: user.id, decision: 'include' } });

  // A `living:`-keyed completed run — the exact precondition that used to brick the
  // overview/queue query.
  run = await prisma.pecanSearchRun.create({ data: {
    metaLabProjectId: project.id, screenProjectId: sp.id, state: 'completed',
    name: 'Living update — regression', idempotencyKey: `living:${tag}:2026-07-12T03:00:00.000Z`,
  } });

  // Source records exercising every branch of the FIXED filter:
  await prisma.pecanSourceRecord.createMany({ data: [
    { runId: run.id, provider: 'pubmed', providerRecordId: 'p1', screenRecordId: r1.id, dedupOutcome: 'new' },        // included
    { runId: run.id, provider: 'pubmed', providerRecordId: 'p2', screenRecordId: r2.id, dedupOutcome: 'new' },        // landed but decided → excluded downstream
    { runId: run.id, provider: 'pubmed', providerRecordId: 'p3', screenRecordId: '',    dedupOutcome: 'new' },        // empty provenance → excluded by `not: ''`
    { runId: run.id, provider: 'pubmed', providerRecordId: 'p4', screenRecordId: r1.id, dedupOutcome: 'exact_dup' },  // wrong dedupOutcome → excluded
  ] });
});

afterAll(async () => {
  try {
    await prisma.livingSavedSearch.deleteMany({ where: { metaLabProjectId: project.id } });
    await prisma.pecanSourceRecord.deleteMany({ where: { runId: run.id } });
    await prisma.pecanSearchRun.deleteMany({ where: { metaLabProjectId: project.id } });
    await prisma.screenDecision.deleteMany({ where: { projectId: sp.id } });
    await prisma.screenRecord.deleteMany({ where: { projectId: sp.id } });
    await prisma.screenProject.deleteMany({ where: { id: sp.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.user.delete({ where: { id: user.id } });
  } catch { /* best-effort cleanup */ }
});

describe('getUpdateQueue — living-keyed run present (root-fix regression)', () => {
  it('RESOLVES instead of throwing PrismaClientValidationError (the 500 bug)', async () => {
    // Before the fix this rejected with `Argument \`not\` must not be null.`
    const queue = await getUpdateQueue(project.id, { limit: 50 });
    expect(queue).toBeTruthy();
    expect(Array.isArray(queue.records)).toBe(true);
    expect(Array.isArray(queue.runs)).toBe(true);
  });

  it('surfaces the living run and returns only the landed, undecided, new record', async () => {
    const queue = await getUpdateQueue(project.id, { limit: 50 });
    expect(queue.runs.map(r => r.id)).toContain(run.id);
    // r1: landed + new + undecided → present. r2: decided → dropped.
    // '' provenance + exact_dup rows → never eligible.
    expect(queue.records).toHaveLength(1);
    expect(queue.records[0].recordId).toBe(r1.id);
    expect(queue.totalPending).toBe(1);
  });

  it('early-returns an empty queue for a project with no living-keyed runs', async () => {
    const other = await prisma.project.create({ data: { userId: user.id, name: 'No runs', data: '{}' } });
    try {
      const queue = await getUpdateQueue(other.id, { limit: 50 });
      expect(queue.records).toEqual([]);
      expect(queue.runs).toEqual([]);
    } finally {
      await prisma.project.delete({ where: { id: other.id } });
    }
  });
});

describe('createSavedSearch — weekly day/hour columns round-trip (75.md Phase 5)', () => {
  it('persists scheduleDayOfWeek + scheduleHourUtc and anchors nextRunAt to them', async () => {
    const search = await createSavedSearch(project.id, {
      name: 'Weekly Monday 09:00 UTC',
      cadence: 'weekly',
      canonicalQuery: { concepts: [], filters: {} },
      providerIds: ['pubmed'],
      scheduleDayOfWeek: 1, // Monday
      scheduleHourUtc: 9,
    }, user);
    expect(search.scheduleDayOfWeek).toBe(1);
    expect(search.scheduleHourUtc).toBe(9);
    const d = new Date(search.nextRunAt);
    expect(d.getUTCDay()).toBe(1);      // Monday
    expect(d.getUTCHours()).toBe(9);    // 09:00 UTC
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it('legacy weekly (no day/hour) still defaults to +7 days at 03:00 UTC', async () => {
    const search = await createSavedSearch(project.id, {
      name: 'Weekly legacy',
      cadence: 'weekly',
      canonicalQuery: { concepts: [], filters: {} },
      providerIds: ['pubmed'],
    }, user);
    expect(search.scheduleDayOfWeek).toBeNull();
    expect(search.scheduleHourUtc).toBeNull();
    expect(new Date(search.nextRunAt).getUTCHours()).toBe(3);
  });

  it('rejects an out-of-range day or hour with a 400 (no row created)', async () => {
    const before = await prisma.livingSavedSearch.count({ where: { metaLabProjectId: project.id } });
    await expect(createSavedSearch(project.id, {
      cadence: 'weekly', canonicalQuery: { concepts: [] }, providerIds: ['pubmed'], scheduleDayOfWeek: 9,
    }, user)).rejects.toMatchObject({ status: 400 });
    await expect(createSavedSearch(project.id, {
      cadence: 'weekly', canonicalQuery: { concepts: [] }, providerIds: ['pubmed'], scheduleHourUtc: 24,
    }, user)).rejects.toMatchObject({ status: 400 });
    const after = await prisma.livingSavedSearch.count({ where: { metaLabProjectId: project.id } });
    expect(after).toBe(before);
  });
});
