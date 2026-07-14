/**
 * 88.md — server provenance layer tests against an in-memory Prisma mock: the event
 * writer + classification, the ATOMIC mutateProjectBlobWithEvents (state+events in one
 * tx, CAS-safe), listing/filtering/summary, honest legacy baseline (idempotent), and
 * append-only reason/invalidate integrity. No live DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory Prisma mock (module-level so vi.mock's factory can close over it) ──
const db = { events: [], project: null, seq: 0 };

function matches(row, where = {}) {
  for (const [k, cond] of Object.entries(where)) {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lt' in cond && !(v < cond.lt)) return false;
      if ('gte' in cond && !(v >= cond.gte)) return false;
      if ('not' in cond && v === cond.not) return false;
    } else if (v !== cond) return false;
  }
  return true;
}

const prisma = {
  projectEvent: {
    async create({ data }) {
      if (data.idempotencyKey && db.events.some((e) => e.idempotencyKey === data.idempotencyKey)) {
        const err = new Error('unique'); err.code = 'P2002'; throw err;
      }
      const row = { id: ++db.seq, serverTs: new Date(), createdAt: new Date(), ...data };
      db.events.push(row); return row;
    },
    async createMany({ data }) {
      let count = 0;
      for (const d of data) {
        if (d.idempotencyKey && db.events.some((e) => e.idempotencyKey === d.idempotencyKey)) continue;
        db.events.push({ id: ++db.seq, serverTs: new Date(), createdAt: new Date(), ...d }); count++;
      }
      return { count };
    },
    async findMany({ where = {}, orderBy = {}, take = 100 }) {
      let rows = db.events.filter((e) => matches(e, where));
      if (orderBy.id === 'desc') rows = rows.sort((a, b) => b.id - a.id);
      return rows.slice(0, take);
    },
    async findFirst({ where = {}, orderBy = {} }) {
      let rows = db.events.filter((e) => matches(e, where));
      if (orderBy.id === 'desc') rows = rows.sort((a, b) => b.id - a.id);
      return rows[0] || null;
    },
    async findUnique({ where: { id } }) { return db.events.find((e) => e.id === id) || null; },
    async update({ where: { id }, data }) {
      const row = db.events.find((e) => e.id === id);
      Object.assign(row, data); return row;
    },
    async count({ where = {} }) { return db.events.filter((e) => matches(e, where)).length; },
    async groupBy({ by, where = {} }) {
      const rows = db.events.filter((e) => matches(e, where));
      const key = by[0]; const m = new Map();
      for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
      return Array.from(m, ([k, c]) => ({ [key]: k, _count: c }));
    },
  },
  project: {
    async findFirst({ where = {} }) {
      if (!db.project) return null;
      if (where.id && db.project.id !== where.id) return null;
      return { ...db.project };
    },
    async updateMany({ where = {}, data = {} }) {
      if (!db.project || db.project.id !== where.id) return { count: 0 };
      if (where.autosaveRev != null && db.project.autosaveRev !== where.autosaveRev) return { count: 0 };
      if (data.data !== undefined) db.project.data = data.data;
      if (data.autosaveRev && data.autosaveRev.increment) db.project.autosaveRev += data.autosaveRev.increment;
      return { count: 1 };
    },
  },
  async $transaction(fn) { return fn(prisma); },
};

vi.mock('../../../server/db/client.js', () => ({ prisma }));

// Import AFTER the mock is registered.
const { recordEvent, buildEventRow, ledgerAvailable } = await import('../../../server/provenance/recordEvent.js');
const { mutateProjectBlobWithEvents, recordBlobDiff } = await import('../../../server/provenance/mutateWithEvents.js');
const svc = await import('../../../server/provenance/provenanceService.js');

beforeEach(() => { db.events = []; db.project = null; db.seq = 0; });

describe('recordEvent + classification', () => {
  it('classifies + persists a model-change event with computed fields', async () => {
    const row = await recordEvent(
      { eventType: 'META_ANALYSIS_MODEL_CHANGED', entityType: 'project', prevValue: 'fixed', newValue: 'random', diff: { kind: 'scalar', prev: 'fixed', next: 'random' } },
      { projectId: 'p1', projectRev: 3, actorUserId: 'u1', actorName: 'Dr X' });
    expect(row.significance).toBe(5);
    expect(JSON.parse(row.manuscriptSections)).toContain('methods');
    expect(row.requiresManuscriptRefresh).toBe(true);
    expect(row.requiresReview).toBe(true);
    expect(row.projectRev).toBe(3);
    expect(row.actorName).toBe('Dr X');
  });
  it('ledgerAvailable true with the mock', () => { expect(ledgerAvailable()).toBe(true); });
  it('idempotencyKey dedups a retried submission (P2002 → null, no dup row)', async () => {
    const draft = { eventType: 'STUDY_EXCLUDED', entityType: 'study', entityId: 's1', idempotencyKey: 'k1', diff: { kind: 'scalar', prev: 'included', next: 'removed' } };
    const a = await recordEvent(draft, { projectId: 'p1' });
    const b = await recordEvent(draft, { projectId: 'p1' });
    expect(a).toBeTruthy();
    expect(b).toBe(null);
    expect(db.events.length).toBe(1);
  });
  it('sanitizes sensitive values in buildEventRow', () => {
    const r = buildEventRow({ eventType: 'PROJECT_RENAMED', newValue: { token: 'abc', name: 'ok' } }, { projectId: 'p1' });
    expect(JSON.parse(r.newValue).token).toBe('[redacted]');
  });
});

describe('mutateProjectBlobWithEvents — atomic state + events', () => {
  beforeEach(() => { db.project = { id: 'p1', name: 'P', data: JSON.stringify({ analysisSettings: { model: 'fixed' } }), autosaveRev: 0, deletedAt: null }; });

  it('commits the blob change AND its event together', async () => {
    const out = await mutateProjectBlobWithEvents('p1', (d) => { d.analysisSettings.model = 'random'; return { result: 'ok' }; }, { actorUserId: 'u1', origin: 'user_action', reason: 'heterogeneity' });
    expect(out.committed).toBe(true);
    expect(out.eventsWritten).toBe(1);
    expect(JSON.parse(db.project.data).analysisSettings.model).toBe('random');
    expect(db.project.autosaveRev).toBe(1);
    const ev = db.events[0];
    expect(ev.eventType).toBe('META_ANALYSIS_MODEL_CHANGED');
    expect(ev.reason).toBe('heterogeneity');
    expect(ev.projectRev).toBe(1);
  });

  it('a no-op mutation (commit:false) writes neither state nor events', async () => {
    const out = await mutateProjectBlobWithEvents('p1', () => ({ commit: false, result: 'noop' }), {});
    expect(out.committed).toBe(false);
    expect(db.events.length).toBe(0);
    expect(db.project.autosaveRev).toBe(0);
  });

  it('a cosmetic-only mutation commits state but writes no scientific event', async () => {
    const out = await mutateProjectBlobWithEvents('p1', (d) => { d.chartColor = '#abc'; return {}; }, {});
    expect(out.committed).toBe(true);
    expect(out.eventsWritten).toBe(0);
    expect(JSON.parse(db.project.data).chartColor).toBe('#abc');
  });

  it('rolls back events if the CAS is lost (state unchanged by loser)', async () => {
    // Simulate a concurrent bump: mutate reads rev 0, but we advance the row to rev 1
    // on the first attempt so the CAS updateMany returns count 0 → retry re-reads.
    let firstAttempt = true;
    const orig = prisma.project.findFirst;
    prisma.project.findFirst = async (args) => {
      const row = await orig(args);
      if (firstAttempt && row && args.where && args.where.deletedAt === null) { firstAttempt = false; db.project.autosaveRev = 5; }
      return row;
    };
    const out = await mutateProjectBlobWithEvents('p1', (d) => { d.analysisSettings.model = 'random'; return {}; }, {});
    prisma.project.findFirst = orig;
    expect(out.committed).toBe(true); // eventually lands on retry at rev 5→6
    expect(db.project.autosaveRev).toBe(6);
    expect(db.events.filter((e) => e.eventType === 'META_ANALYSIS_MODEL_CHANGED').length).toBe(1);
  });
});

describe('listEvents + summary + baseline + integrity', () => {
  beforeEach(() => { db.project = { id: 'p1', name: 'P', data: JSON.stringify({ search: { dbs: { PubMed: 1 } }, analysisSettings: { model: 'random' }, studies: [{ id: 's1', outcome: 'mortality' }] }), autosaveRev: 0, deletedAt: null }; });

  it('baselineProject writes ONE reconstructed baseline and is idempotent', async () => {
    const projectData = JSON.parse(db.project.data);
    const a = await svc.baselineProject('p1', projectData, { actorUserId: 'u1' });
    expect(a.created).toBe(true);
    const row = db.events.find((e) => e.eventType === 'PROJECT_STATE_BASELINE');
    expect(row.reconstructed).toBe(true);
    expect(row.origin).toBe('migration');
    const b = await svc.baselineProject('p1', projectData, {});
    expect(b.created).toBe(false);
    expect(db.events.filter((e) => e.eventType === 'PROJECT_STATE_BASELINE').length).toBe(1);
  });

  it('listEvents filters by scientific significance and paginates', async () => {
    await recordEvent({ eventType: 'CHART_APPEARANCE_CHANGED', diff: { kind: 'scalar', prev: 'a', next: 'b' } }, { projectId: 'p1', keepOperational: true });
    await recordEvent({ eventType: 'META_ANALYSIS_MODEL_CHANGED', diff: { kind: 'scalar', prev: 'fixed', next: 'random' } }, { projectId: 'p1' });
    const all = await svc.listEvents('p1', {});
    expect(all.events.length).toBe(2);
    const sci = await svc.listEvents('p1', { filter: 'scientific' });
    expect(sci.events.every((e) => e.significance >= 3)).toBe(true);
    expect(sci.events.some((e) => e.eventType === 'META_ANALYSIS_MODEL_CHANGED')).toBe(true);
    expect(sci.events.some((e) => e.eventType === 'CHART_APPEARANCE_CHANGED')).toBe(false);
  });

  it('summary returns category counts + derived state', async () => {
    await recordEvent({ eventType: 'ELIGIBILITY_CRITERIA_CHANGED', diff: { kind: 'scalar', prev: 'a', next: 'b' } }, { projectId: 'p1' });
    const s = await svc.summary('p1', JSON.parse(db.project.data));
    expect(s.available).toBe(true);
    expect(s.total).toBe(1);
    expect(s.potentialDeviations.length).toBe(1); // eligibility change is critical
    expect(s.derivedState.analysis.model).toBe('random');
  });

  it('addReason fills a missing reason but refuses to overwrite (append-only)', async () => {
    const ev = await recordEvent({ eventType: 'STUDY_EXCLUDED', entityType: 'study', entityId: 's1', diff: { kind: 'scalar', prev: 'included', next: 'removed' } }, { projectId: 'p1' });
    const r1 = await svc.addReason(ev.id, 'wrong population', { actorUserId: 'u1', actorName: 'Dr X' });
    expect(r1.updated).toBe(true);
    expect(db.events.find((e) => e.id === ev.id).reason).toBe('wrong population');
    const r2 = await svc.addReason(ev.id, 'changed my mind', {});
    expect(r2.updated).toBe(false);
    expect(r2.reason).toBe('already-has-reason');
  });

  it('invalidateEvent soft-invalidates (never deletes) and hides from default list', async () => {
    const ev = await recordEvent({ eventType: 'META_ANALYSIS_MODEL_CHANGED', diff: { kind: 'scalar', prev: 'fixed', next: 'random' } }, { projectId: 'p1' });
    await svc.invalidateEvent(ev.id, { actorUserId: 'admin', reason: 'test artifact' });
    expect(db.events.find((e) => e.id === ev.id).invalidated).toBe(true);
    const list = await svc.listEvents('p1', {});
    expect(list.events.some((e) => e.id === ev.id)).toBe(false);
    const withInv = await svc.listEvents('p1', { includeInvalidated: true });
    expect(withInv.events.some((e) => e.id === ev.id)).toBe(true);
  });
});

describe('recordBlobDiff — best-effort autosave capture', () => {
  it('appends events for a scientific blob change', async () => {
    const n = await recordBlobDiff('p1', { analysisSettings: { model: 'fixed' } }, { analysisSettings: { model: 'random' } }, { actorUserId: 'u1' });
    expect(n).toBe(1);
    expect(db.events[0].eventType).toBe('META_ANALYSIS_MODEL_CHANGED');
  });
  it('no scientific change → no events', async () => {
    const n = await recordBlobDiff('p1', { name: 'a' }, { name: 'a', chartColor: '#fff' }, {});
    expect(n).toBe(0);
  });
});
