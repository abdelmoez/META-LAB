/**
 * 119.md §8 — the Logbook WRITER: stable vocabulary, row construction (bounded +
 * sanitised), the best-effort writer + its outbox, the TRANSACTIONAL writer
 * (which must throw so a critical mutation rolls back), coalesced edit sessions,
 * and the manuscript autosave diff. Hermetic: an in-memory Prisma mock, no DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const db = { logs: [], seq: 0, screenProjects: [], users: [], failNext: 0 };

const prisma = {
  projectLogEvent: {
    async create({ data }) {
      if (db.failNext > 0) { db.failNext -= 1; throw new Error('db down'); }
      if (data.idempotencyKey && db.logs.some((r) => r.idempotencyKey === data.idempotencyKey)) {
        const e = new Error('unique'); e.code = 'P2002'; throw e;
      }
      const row = { id: ++db.seq, createdAt: new Date(), ...data };
      db.logs.push(row);
      return row;
    },
    async update({ where: { id }, data }) {
      const row = db.logs.find((r) => r.id === id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    async findFirst() { return null; },
  },
  screenProject: {
    async findUnique({ where: { id } }) { return db.screenProjects.find((p) => p.id === id) || null; },
    async findFirst({ where }) {
      return db.screenProjects.find((p) => p.linkedMetaLabProjectId === where.linkedMetaLabProjectId) || null;
    },
  },
  user: {
    async findUnique({ where: { id } }) { return db.users.find((u) => u.id === id) || null; },
  },
  async $transaction(fn) { return fn(prisma); },
};

vi.mock('../../../server/db/client.js', () => ({ prisma }));
vi.mock('../../../server/realtime/bus.js', () => ({
  emitToProjectLeaders: vi.fn(), emitToProjectMembers: vi.fn(), emitToUsers: vi.fn(),
}));

const svc = await import('../../../server/logbook/logbookService.js');
const V = await import('../../../server/logbook/vocabulary.js');
const MS = await import('../../../server/logbook/manuscriptSession.js');

beforeEach(() => {
  db.logs = []; db.seq = 0; db.failNext = 0;
  db.screenProjects = [{ id: 'sp1', linkedMetaLabProjectId: 'ml1', deletedAt: null }];
  db.users = [{ id: 'u1', name: 'Dr Ada', email: 'ada@example.org' }];
  svc._resetOutbox(); svc._resetSessions(); svc._resetLinkCache(); svc._resetPokes();
});

describe('vocabulary — a stable, closed event taxonomy', () => {
  it('every registered action declares a known engine, category and severity', () => {
    for (const key of V.LOG_ACTION_KEYS) {
      const spec = V.LOG_ACTIONS[key];
      expect(spec.action).toBe(key);
      expect(V.LOG_ENGINES).toContain(spec.engine);
      expect(V.LOG_CATEGORIES).toContain(spec.category);
      expect(spec.severity).toBeGreaterThanOrEqual(0);
      expect(spec.severity).toBeLessThanOrEqual(5);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it('covers every §8 engine that the backend writes to', () => {
    const engines = new Set(V.LOG_ACTION_KEYS.map((k) => V.LOG_ACTIONS[k].engine));
    for (const e of ['core', 'search', 'analysis', 'manuscript', 'files', 'logbook']) {
      expect(engines.has(e)).toBe(true);
    }
  });

  it('the Logbook security trio exists (view / export / denied)', () => {
    expect(V.LOG_ACTIONS.LOGBOOK_VIEWED.engine).toBe('logbook');
    expect(V.LOG_ACTIONS.LOGBOOK_EXPORTED.engine).toBe('logbook');
    expect(V.LOG_ACTIONS.LOGBOOK_ACCESS_DENIED.actionCategory ?? V.LOG_ACTIONS.LOGBOOK_ACCESS_DENIED.category).toBe('security');
  });

  it('classifies legacy ScreenAuditLog actions onto the same engine taxonomy', () => {
    expect(V.classifyScreenAuditAction('MEMBER_ADDED').engine).toBe('core');
    expect(V.classifyScreenAuditAction('PDF_UPLOADED').engine).toBe('files');
    expect(V.classifyScreenAuditAction('CONFLICT_RESOLVED').engine).toBe('screening');
    expect(V.classifyScreenAuditAction('KEYWORD_ADDED').engine).toBe('search');       // prefix rule
    expect(V.classifyScreenAuditAction('ELIGIBILITY_ADJUDICATED').engine).toBe('protocol');
    expect(V.classifyScreenAuditAction('SOMETHING_NEW_ENTIRELY').engine).toBe('core'); // never throws
  });

  it('every mirrored ScreenAuditLog action is one the native writer actually emits', () => {
    // PROJECT_UNARCHIVED is the LEGACY string for the native PROJECT_RESTORED.
    const nativeEquivalent = { PROJECT_UNARCHIVED: 'PROJECT_RESTORED' };
    for (const a of V.MIRRORED_SCREEN_AUDIT_ACTIONS) {
      expect(V.LOG_ACTION_KEYS).toContain(nativeEquivalent[a] || a);
    }
  });
});

describe('buildLogRow — bounded, sanitised, self-describing', () => {
  it('fills engine/category/summary/severity from the registry', () => {
    const row = svc.buildLogRow({ action: 'MEMBER_ADDED' }, { projectId: 'sp1', actorId: 'u1', actorName: 'Dr Ada', actorRole: 'leader' });
    expect(row.engine).toBe('core');
    expect(row.actionCategory).toBe('create');
    expect(row.summary).toBe('Added a member');
    expect(row.severity).toBe(V.LOG_SEVERITY.SENSITIVE);
    expect(row.actorRole).toBe('leader');
    expect(row.status).toBe('success');
  });

  it('an UNREGISTERED action still writes (never lose an event) and degrades honestly', () => {
    const row = svc.buildLogRow({ action: 'SOMETHING_NEW' }, { projectId: 'sp1' });
    expect(row.action).toBe('SOMETHING_NEW');
    expect(row.engine).toBe('core');
    expect(row.summary).toBe('Something new');
  });

  it('redacts secret-shaped values and never stores a token', () => {
    const row = svc.buildLogRow(
      { action: 'PROJECT_SETTINGS_CHANGED', after: { apiToken: 'sk-live-123', password: 'hunter2', title: 'Fine' } },
      { projectId: 'sp1' });
    expect(row.afterSummary).not.toContain('sk-live-123');
    expect(row.afterSummary).not.toContain('hunter2');
    expect(JSON.parse(row.afterSummary).title).toBe('Fine');
  });

  it('bounds every JSON field so one huge diff cannot bloat the table', () => {
    const row = svc.buildLogRow(
      { action: 'MANUSCRIPT_EDIT_SESSION', after: { blob: 'x'.repeat(200000) } },
      { projectId: 'sp1' });
    expect(row.afterSummary.length).toBeLessThanOrEqual(6000);
  });

  it('stores a lowercased searchText so search behaves the same on SQLite and Postgres', () => {
    const row = svc.buildLogRow(
      { action: 'MEMBER_ADDED', summary: 'Added ADA@Example.ORG as leader', resourceLabel: 'ADA@Example.ORG' },
      { projectId: 'sp1', actorName: 'Dr Ada' });
    expect(row.searchText).toContain('ada@example.org');
    expect(row.searchText).toBe(row.searchText.toLowerCase());
  });
});

describe('recordLogEvent — best-effort writer', () => {
  it('writes a scoped row and resolves the counterpart project id', async () => {
    const row = await svc.recordLogEvent({ action: 'MEMBER_ADDED', resourceId: 'm1' }, { projectId: 'sp1', actorId: 'u1' });
    expect(row).toBeTruthy();
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0].projectId).toBe('sp1');
    expect(db.logs[0].metaLabProjectId).toBe('ml1'); // resolved from the link
  });

  it('resolves the ScreenProject id when only the META·LAB id is known', async () => {
    await svc.recordLogEvent({ action: 'MANUSCRIPT_EDIT_SESSION' }, { metaLabProjectId: 'ml1' });
    expect(db.logs[0].projectId).toBe('sp1');
  });

  it('drops a completely unscoped draft rather than writing an unreadable row', async () => {
    const row = await svc.recordLogEvent({ action: 'MEMBER_ADDED' }, {});
    expect(row).toBe(null);
    expect(db.logs).toHaveLength(0);
  });

  it('NEVER throws on a DB failure — it parks the row in the outbox and retries', async () => {
    db.failNext = 1;
    const first = await svc.recordLogEvent({ action: 'EXPORT_GENERATED' }, { projectId: 'sp1' });
    expect(first).toBe(null);
    expect(svc.outboxSize()).toBe(1);
    expect(db.logs).toHaveLength(0);

    // The next successful write drains the parked row too — nothing is lost.
    await svc.recordLogEvent({ action: 'EXPORT_GENERATED' }, { projectId: 'sp1' });
    await svc.flushOutbox();
    expect(svc.outboxSize()).toBe(0);
    expect(db.logs.length).toBe(2);
  });

  it('a duplicate idempotencyKey is a no-op, not an outbox entry', async () => {
    const draft = { action: 'EXPORT_GENERATED', idempotencyKey: 'k1' };
    expect(await svc.recordLogEvent(draft, { projectId: 'sp1' })).toBeTruthy();
    expect(await svc.recordLogEvent(draft, { projectId: 'sp1' })).toBe(null);
    expect(db.logs).toHaveLength(1);
    expect(svc.outboxSize()).toBe(0);
  });
});

describe('transactional writer — a critical mutation cannot lose its audit', () => {
  it('withLoggedTransaction commits the mutation and its row together', async () => {
    let mutated = false;
    const out = await svc.withLoggedTransaction(
      async () => { mutated = true; return { id: 'm9' }; },
      (r) => ({ action: 'MEMBER_ADDED', resourceId: r.id, mirrors: 'screen_audit' }),
      { projectId: 'sp1', actorId: 'u1', actorName: 'Dr Ada', actorRole: 'owner' });
    expect(mutated).toBe(true);
    expect(out.id).toBe('m9');
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0].resourceId).toBe('m9');
    expect(db.logs[0].mirrors).toBe('screen_audit');
  });

  it('recordLogEventTx THROWS on a write failure so the caller\'s transaction rolls back', async () => {
    db.failNext = 1;
    await expect(
      svc.recordLogEventTx(prisma, { action: 'OWNERSHIP_TRANSFERRED' }, { projectId: 'sp1' }),
    ).rejects.toThrow(/db down/);
  });

  it('recordLogEventTx swallows an idempotent replay (P2002) instead of aborting', async () => {
    await svc.recordLogEventTx(prisma, { action: 'MEMBER_ADDED', idempotencyKey: 'kx' }, { projectId: 'sp1' });
    const again = await svc.recordLogEventTx(prisma, { action: 'MEMBER_ADDED', idempotencyKey: 'kx' }, { projectId: 'sp1' });
    expect(again).toBe(null);
    expect(db.logs).toHaveLength(1);
  });
});

describe('coalesced sessions — typing and PDF ranges do not flood the log', () => {
  it('the first call appends; later calls within the window UPDATE the same row', async () => {
    const ctx = { projectId: 'sp1', actorId: 'u1', actorName: 'Dr Ada' };
    const a = await svc.recordSessionEvent({ action: 'MANUSCRIPT_EDIT_SESSION', resourceId: 'd1', sessionParts: ['methods'] }, ctx);
    const b = await svc.recordSessionEvent({ action: 'MANUSCRIPT_EDIT_SESSION', resourceId: 'd1', sessionParts: ['results'] }, ctx);
    const c = await svc.recordSessionEvent({ action: 'MANUSCRIPT_EDIT_SESSION', resourceId: 'd1', sessionParts: ['results'] }, ctx);
    expect(a.coalesced).toBe(false);
    expect(b.coalesced).toBe(true);
    expect(c.coalesced).toBe(true);
    expect(db.logs).toHaveLength(1);
    const meta = JSON.parse(db.logs[0].metadata);
    expect(meta.eventCount).toBe(3);
    expect(meta.parts.sort()).toEqual(['methods', 'results']);
    expect(db.logs[0].summary).toContain('3 changes in this session');
  });

  it('a DIFFERENT actor or resource opens its own session row', async () => {
    await svc.recordSessionEvent({ action: 'FILE_DOWNLOADED', resourceId: 'pdf1' }, { projectId: 'sp1', actorId: 'u1' });
    await svc.recordSessionEvent({ action: 'FILE_DOWNLOADED', resourceId: 'pdf1' }, { projectId: 'sp1', actorId: 'u2' });
    await svc.recordSessionEvent({ action: 'FILE_DOWNLOADED', resourceId: 'pdf2' }, { projectId: 'sp1', actorId: 'u1' });
    expect(db.logs).toHaveLength(3);
  });
});

describe('manuscript autosave → edit-session diff', () => {
  const draft = (sections) => ({ id: 'd1', title: 'Draft A', sections });

  it('detects only the sections whose content actually changed', () => {
    const before = { manuscripts: [draft({ methods: { content: 'a' }, results: { content: 'b' } })] };
    const after = { manuscripts: [draft({ methods: { content: 'a' }, results: { content: 'B!' } })] };
    const { drafts } = MS.diffManuscript(before, after);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sections).toEqual(['results']);
  });

  it('an autosave that did not touch the manuscript produces NO event', async () => {
    const blob = { manuscripts: [draft({ methods: { content: 'a' } })], other: 1 };
    const n = await MS.captureManuscriptSession('ml1', blob, { ...blob, other: 2 }, { actorId: 'u1' });
    expect(n).toBe(0);
    expect(db.logs).toHaveLength(0);
  });

  it('groups repeated autosaves of the same draft into ONE session row', async () => {
    const ctx = { actorId: 'u1', actorName: 'Dr Ada' };
    const v = (s) => ({ manuscripts: [draft({ methods: { content: s } })] });
    await MS.captureManuscriptSession('ml1', v('a'), v('ab'), ctx);
    await MS.captureManuscriptSession('ml1', v('ab'), v('abc'), ctx);
    await MS.captureManuscriptSession('ml1', v('abc'), v('abcd'), ctx);
    expect(db.logs).toHaveLength(1);
    expect(db.logs[0].action).toBe('MANUSCRIPT_EDIT_SESSION');
    expect(db.logs[0].engine).toBe('manuscript');
    expect(JSON.parse(db.logs[0].metadata).eventCount).toBe(3);
  });

  it('a brand-new draft is reported as created', () => {
    const { drafts } = MS.diffManuscript({ manuscripts: [] }, { manuscripts: [draft({ methods: { content: 'x' } })] });
    expect(drafts[0].added).toBe(true);
  });
});

describe('actor identity', () => {
  it('resolveActorIdentity denormalises the display name at the time', async () => {
    const a = await svc.resolveActorIdentity('u1');
    expect(a).toEqual({ actorId: 'u1', actorName: 'Dr Ada', actorRole: '', actorType: 'user' });
  });
  it('an unknown user resolves to an empty name — never a fabricated one', async () => {
    const a = await svc.resolveActorIdentity('ghost');
    expect(a.actorName).toBe('');
  });
});
