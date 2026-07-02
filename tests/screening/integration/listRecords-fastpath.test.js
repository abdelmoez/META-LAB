/**
 * listRecords-fastpath.test.js — 65.md SCR-1: the paged DB fast path for
 * GET /projects/:pid/records. Runs against the real dev DB by calling the
 * controller directly with a mock req/res (no HTTP server needed — same pattern
 * as tests/integration/screening-perf-jobs.test.js).
 *
 * Proves:
 *  - the default request (filter all) pages via skip/take with a stable order:
 *    pages are disjoint, their union is the whole project, totals are exact;
 *  - opened_me / unopened_me map exactly onto the caller's open-state rows;
 *  - the fast path's rows are structurally identical to the in-memory path's
 *    (same keys, same decisions/flags) for the same records.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../../server/db/client.js';
import { listRecords } from '../../../server/controllers/screeningController.js';

const tag = `fastpath65_${Date.now()}`;
const N = 60;

let user, project, recs;

/** Minimal express-compatible req/res pair; returns the captured json body. */
function call(fn, { pid, userId, query = {} }) {
  return new Promise((resolve, reject) => {
    const req = { params: { pid }, user: { id: userId, email: `${tag}@x.io` }, query };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
      send(body) { resolve({ status: this.statusCode, body }); },
      setHeader() {},
    };
    fn(req, res).catch(reject);
  });
}

beforeAll(async () => {
  user = await prisma.user.create({ data: { email: `${tag}@x.io`, password: 'x', name: 'Fast65' } });
  project = await prisma.screenProject.create({ data: { ownerId: user.id, title: 'Fastpath 65' } });
  // Distinct createdAt per record → deterministic order on both paths.
  const t0 = Date.now() - N * 1000;
  recs = [];
  for (let i = 0; i < N; i++) {
    recs.push(await prisma.screenRecord.create({
      data: {
        projectId: project.id,
        title: `FASTPATH study ${String(i).padStart(2, '0')}`,
        authors: `Author ${i}`, year: '2021',
        createdAt: new Date(t0 + i * 1000),
      },
    }));
  }
  // One decision (mine) + one opened record for the filter/parity checks.
  await prisma.screenDecision.create({
    data: { recordId: recs[0].id, projectId: project.id, reviewerId: user.id, reviewerName: 'Fast65', stage: 'title_abstract', decision: 'include' },
  });
  await prisma.screenRecordOpenState.create({
    data: { projectId: project.id, recordId: recs[1].id, userId: user.id },
  });
});

afterAll(async () => {
  try {
    await prisma.screenRecordOpenState.deleteMany({ where: { projectId: project.id } });
    await prisma.screenDecision.deleteMany({ where: { projectId: project.id } });
    await prisma.screenRecord.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProjectMember.deleteMany({ where: { projectId: project.id } });
    await prisma.screenProject.deleteMany({ where: { id: project.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  } catch { /* best-effort */ }
});

describe('listRecords fast path — paging correctness', () => {
  it('pages the default request via the DB: exact totals, disjoint pages, full coverage, stable order', async () => {
    const p1 = await call(listRecords, { pid: project.id, userId: user.id, query: { page: '1', limit: '50' } });
    const p2 = await call(listRecords, { pid: project.id, userId: user.id, query: { page: '2', limit: '50' } });
    expect(p1.status).toBe(200);
    expect(p1.body.total).toBe(N);
    expect(p1.body.pages).toBe(2);
    expect(p1.body.page).toBe(1);
    expect(p1.body.records.length).toBe(50);
    expect(p2.body.records.length).toBe(N - 50);

    const ids1 = p1.body.records.map(r => r.id);
    const ids2 = p2.body.records.map(r => r.id);
    const union = new Set([...ids1, ...ids2]);
    expect(union.size).toBe(N);                               // no duplicates, no gaps
    // createdAt-ascending order across the page boundary.
    expect(ids1[0]).toBe(recs[0].id);
    expect(ids2[ids2.length - 1]).toBe(recs[N - 1].id);
    const times = [...p1.body.records, ...p2.body.records].map(r => new Date(r.createdAt).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
  });

  it('opened_me / unopened_me filters map exactly onto MY open-state rows', async () => {
    const opened = await call(listRecords, { pid: project.id, userId: user.id, query: { filter: 'opened_me', limit: '50' } });
    expect(opened.body.total).toBe(1);
    expect(opened.body.records[0].id).toBe(recs[1].id);
    expect(opened.body.records[0].myOpened).toBe(true);

    const unopened = await call(listRecords, { pid: project.id, userId: user.id, query: { filter: 'unopened_me', limit: '200' } });
    expect(unopened.body.total).toBe(N - 1);
    expect(unopened.body.records.some(r => r.id === recs[1].id)).toBe(false);
  });

  it('fast-path rows are structurally identical to in-memory-path rows', async () => {
    // A search that matches EVERY record forces the in-memory path over the same set.
    const fast = await call(listRecords, { pid: project.id, userId: user.id, query: { page: '1', limit: '50' } });
    const slow = await call(listRecords, { pid: project.id, userId: user.id, query: { page: '1', limit: '50', search: 'FASTPATH' } });
    expect(slow.body.total).toBe(N);
    expect(fast.body.records.length).toBe(slow.body.records.length);

    const slowById = new Map(slow.body.records.map(r => [r.id, r]));
    for (const f of fast.body.records) {
      const s = slowById.get(f.id);
      expect(s).toBeTruthy();
      // Same response structure (key set) and same derived fields.
      expect(Object.keys(f).sort()).toEqual(Object.keys(s).sort());
      expect(f.myOpened).toBe(s.myOpened);
      expect(f.includeCount).toBe(s.includeCount);
      expect(f.quorumMet).toBe(s.quorumMet);
      expect(f.disputed).toBe(s.disputed);
      expect(f.myDecision?.decision ?? null).toBe(s.myDecision?.decision ?? null);
      expect(f.reviewerDecisions.length).toBe(s.reviewerDecisions.length);
    }
    // Envelope shape parity.
    expect(Object.keys(fast.body).sort()).toEqual(Object.keys(slow.body).sort());
  });

  it('decision filters still go through the in-memory path and stay correct', async () => {
    const inc = await call(listRecords, { pid: project.id, userId: user.id, query: { filter: 'included', limit: '50' } });
    expect(inc.body.total).toBe(1);
    expect(inc.body.records[0].id).toBe(recs[0].id);
    expect(inc.body.records[0].myDecision.decision).toBe('include');
  });
});
