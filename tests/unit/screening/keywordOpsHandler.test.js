/**
 * keywordOpsHandler.test.js — 107.md §2 (rec round). The POST /keywords/ops handler
 * itself, not just the pure reducer underneath it.
 *
 * What this pins:
 *  1. LOST UPDATE. The write is conditional on the exact pre-image that was read
 *     (updateMany + full-column WHERE), and a losing writer re-reads and re-applies
 *     the reducer, so two concurrent single-term ops COMPOSE. A bare
 *     `prisma.$transaction` is atomic but not isolated — on Postgres (READ
 *     COMMITTED) the second UPDATE, keyed only on `id`, silently overwrote the first
 *     with values computed from its stale read. The fake prisma below implements
 *     exactly that guard semantics, so the test fails if the WHERE clause is dropped.
 *  2. The `reject:false` (Undo) variant is accepted, validated and threaded into the
 *     shared reducer.
 *  3. A side that was deliberately emptied is never re-seeded with the shared
 *     defaults by a later op.
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

// A single ScreenProject row plus the compare-and-swap the real database performs:
// updateMany applies ONLY when every column in `where` still matches.
const db = { row: null, beforeUpdate: null, updates: 0 };

const prismaMock = {
  screenProject: {
    findUnique: vi.fn(async ({ where }) => (db.row && db.row.id === where.id ? { ...db.row } : null)),
    updateMany: vi.fn(async ({ where, data }) => {
      if (db.beforeUpdate) db.beforeUpdate();
      db.updates += 1;
      if (!db.row || db.row.id !== where.id) return { count: 0 };
      for (const col of ['inclusionKeywords', 'exclusionKeywords', 'keywordMeta']) {
        if (where[col] !== undefined && where[col] !== db.row[col]) return { count: 0 };
      }
      db.row = { ...db.row, ...data };
      return { count: 1 };
    }),
    update: vi.fn(async () => { throw new Error('unguarded update() must not be used'); }),
  },
  project: { updateMany: vi.fn(async () => ({ count: 0 })) },
  $transaction: vi.fn(async (fn) => fn(prismaMock)),
};
vi.mock('../../../server/db/client.js', () => ({ prisma: prismaMock }));

const { keywordOps } = await import('../../../server/controllers/screeningController.js');
const { getProjectAccess } = await import('../../../server/screening/access.js');
const { emitToProjectMembers } = await import('../../../server/realtime/bus.js');
const { DEFAULT_INCLUDE_KEYWORDS } = await import('../../../src/research-engine/screening/defaultKeywords.js');

const PID = 'sp1';
const mkRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const call = async (body) => {
  const res = mkRes();
  await keywordOps({ params: { pid: PID }, user: { id: 'u1' }, body }, res);
  return res;
};
const seed = (over = {}) => {
  db.row = {
    id: PID,
    inclusionKeywords: '["a","b"]',
    exclusionKeywords: '[]',
    keywordMeta: '{}',
    ...over,
  };
  db.beforeUpdate = null;
  db.updates = 0;
};
const incl = () => JSON.parse(db.row.inclusionKeywords);
const meta = () => JSON.parse(db.row.keywordMeta);

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  getProjectAccess.mockResolvedValue({
    project: { id: PID, linkedMetaLabProjectId: null },
    canManageSettings: true,
  });
});

describe('keywordOps — access + validation', () => {
  it('404s an outsider and 403s a member who cannot manage settings', async () => {
    getProjectAccess.mockResolvedValueOnce(null);
    expect((await call({ type: 'add', list: 'include', term: 'x' })).statusCode).toBe(404);
    getProjectAccess.mockResolvedValueOnce({ project: { id: PID }, canManageSettings: false });
    expect((await call({ type: 'add', list: 'include', term: 'x' })).statusCode).toBe(403);
    expect(prismaMock.screenProject.updateMany).not.toHaveBeenCalled();
  });

  it('accepts reject:false on remove/move and 400s it anywhere else', async () => {
    expect((await call({ type: 'remove', list: 'include', term: 'a', reject: false })).statusCode).toBe(200);
    seed();
    expect((await call({ type: 'move', list: 'include', term: 'a', reject: false })).statusCode).toBe(200);
    seed();
    for (const type of ['add', 'accept', 'reject']) {
      const res = await call({ type, list: 'include', term: 'z', reject: false });
      expect(res.statusCode, type).toBe(400);
    }
    const bad = await call({ type: 'remove', list: 'include', term: 'a', reject: 'nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toMatch(/reject must be a boolean/);
  });

  it('404s when the row disappears between the access check and the read', async () => {
    db.row = null;
    expect((await call({ type: 'add', list: 'include', term: 'x' })).statusCode).toBe(404);
  });
});

describe('keywordOps — the write is guarded by the pre-image it read', () => {
  it('never uses the unguarded update(); the WHERE carries all three columns', async () => {
    const res = await call({ type: 'add', list: 'include', term: 'sepsis' });
    expect(res.statusCode).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(incl()).toEqual(['a', 'b', 'sepsis']);
    expect(prismaMock.screenProject.update).not.toHaveBeenCalled();
    expect(prismaMock.screenProject.updateMany.mock.calls[0][0].where).toEqual({
      id: PID,
      inclusionKeywords: '["a","b"]',
      exclusionKeywords: '[]',
      keywordMeta: '{}',
    });
  });

  it('LOST UPDATE regression: a concurrent add commits between our SELECT and UPDATE', async () => {
    // Leader B commits {add "delirium"} while leader A's transaction is open. A's
    // guarded write misses, A re-reads B's state and re-applies its own op on top.
    db.beforeUpdate = () => {
      db.beforeUpdate = null;
      db.row = { ...db.row, inclusionKeywords: '["a","b","delirium"]' };
    };
    const res = await call({ type: 'add', list: 'include', term: 'sepsis' });
    expect(res.statusCode).toBe(200);
    expect(incl()).toEqual(['a', 'b', 'delirium', 'sepsis']);   // BOTH terms survive
    expect(JSON.parse(res.body.inclusionKeywords)).toEqual(['a', 'b', 'delirium', 'sepsis']);
    expect(prismaMock.screenProject.findUnique).toHaveBeenCalledTimes(2);
  });

  it('a concurrent verdict on the SAME term composes instead of clobbering', async () => {
    db.beforeUpdate = () => {
      db.beforeUpdate = null;
      db.row = { ...db.row, keywordMeta: JSON.stringify({ version: 1, decisions: { include: { rodent: 'rejected' }, exclude: {} }, origins: { include: {}, exclude: {} } }) };
    };
    const res = await call({ type: 'reject', list: 'include', term: 'epilepsy' });
    expect(res.statusCode).toBe(200);
    expect(meta().decisions.include).toEqual({ rodent: 'rejected', epilepsy: 'rejected' });
  });

  it('gives up with a 409 + error code after a bounded number of attempts', async () => {
    let n = 0;
    db.beforeUpdate = () => { db.row = { ...db.row, keywordMeta: JSON.stringify({ n: n++ }) }; };
    const res = await call({ type: 'add', list: 'include', term: 'sepsis' });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('KEYWORD_OP_CONTENTION');
    expect(prismaMock.screenProject.findUnique).toHaveBeenCalledTimes(5);
    expect(incl()).toEqual(['a', 'b']);           // nothing half-applied
    expect(emitToProjectMembers).not.toHaveBeenCalled();
  });

  it('a no-op op writes nothing and emits nothing', async () => {
    const res = await call({ type: 'add', list: 'include', term: 'A' });   // already present
    expect(res.statusCode).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(res.body.reason).toBe('duplicate');
    expect(prismaMock.screenProject.updateMany).not.toHaveBeenCalled();
    expect(emitToProjectMembers).not.toHaveBeenCalled();
  });
});

describe('keywordOps — Undo variant + the emptied-side marker', () => {
  it('reject:false removes the term without recording a verdict', async () => {
    await call({ type: 'add', list: 'include', term: 'drug-resistant epilepsy' });
    const before = db.row.keywordMeta;
    const res = await call({ type: 'remove', list: 'include', term: 'drug-resistant epilepsy', reject: false });
    expect(res.statusCode).toBe(200);
    expect(incl()).toEqual(['a', 'b']);
    expect(meta().decisions.include).toEqual({});
    expect(meta().origins.include).toEqual({});
    expect(before).not.toBe(db.row.keywordMeta);
  });

  it('plain remove still records the deliberate rejection', async () => {
    await call({ type: 'remove', list: 'include', term: 'b' });
    expect(incl()).toEqual(['a']);
    expect(meta().decisions.include.b).toBe('rejected');
  });

  it('removing the last term empties the column and no later op re-seeds the defaults', async () => {
    seed({ inclusionKeywords: '["seizure"]' });
    await call({ type: 'remove', list: 'include', term: 'seizure' });
    expect(db.row.inclusionKeywords).toBe('[]');
    expect(meta().seeded).toEqual({ include: true });

    await call({ type: 'reject', list: 'include', term: 'epilepsy' });
    expect(db.row.inclusionKeywords).toBe('[]');
    expect(incl()).not.toContain(DEFAULT_INCLUDE_KEYWORDS[0]);
  });

  it('a legacy EMPTY side still materializes the shared defaults on its first edit', async () => {
    seed({ inclusionKeywords: '[]' });
    await call({ type: 'add', list: 'include', term: 'my term' });
    expect(incl()).toEqual([...DEFAULT_INCLUDE_KEYWORDS, 'my term']);
    expect(meta().seeded).toEqual({ include: true });
  });
});
