/**
 * 119.md §8 — "Only the project's Owner and Leader may view the Logbook … enforced
 * through navigation visibility, route guards, API authorization, database
 * queries, export authorization, real-time subscriptions, and direct-resource
 * access tests. Members, contributors, and viewers must not retrieve Logbook data
 * by manually entering a URL or calling an endpoint."
 *
 * This file is the DIRECT-RESOURCE test for every layer we own on the server:
 *   · the capability registry (nav visibility)      — capabilities/resolveAccess
 *   · the access resolver                            — logbookAccess.js
 *   · the route guard                                — routes/logbook.js
 *   · every API handler, called directly             — logbookController.js
 *   · the query scope handed to the reader           — never req.params
 *   · the export endpoint                            — its own gate + audit row
 *   · the SSE recipient filter                       — bus.emitToProjectLeaders
 *
 * Every non-leader role is asserted to receive 403/404 and NEVER a single event.
 * Hermetic — no DB, no HTTP.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ── Test doubles ─────────────────────────────────────────────────────────── */
const state = {
  access: null,          // getProjectAccess result
  mlAccess: null,        // getMetaLabMemberAccess result
  project: null,         // prisma.project row
  linkedScreen: null,    // linked ScreenProject row
  logs: [],              // ProjectLogEvent rows written by the controller
  connections: [],       // SSE recipients that would receive a leaders-only poke
  members: [],
};

const prisma = {
  project: { async findFirst({ where }) { return state.project && state.project.id === where.id ? state.project : null; } },
  screenProject: {
    async findFirst() { return state.linkedScreen; },
    async findUnique() { return state.linkedScreen; },
  },
  screenProjectMember: { async findMany({ where }) { return state.members.filter((m) => (!where.role || where.role.in.includes(m.role))); } },
  projectLogEvent: {
    async create({ data }) { const row = { id: state.logs.length + 1, createdAt: new Date(), ...data }; state.logs.push(row); return row; },
    async update({ where: { id }, data }) { Object.assign(state.logs[id - 1], data); return state.logs[id - 1]; },
    async findFirst() { return null; },
  },
};

vi.mock('../../../server/db/client.js', () => ({ prisma }));
vi.mock('../../../server/screening/access.js', () => ({ getProjectAccess: vi.fn(async () => state.access) }));
vi.mock('../../../server/screening/metalabAccess.js', () => ({ getMetaLabMemberAccess: vi.fn(async () => state.mlAccess) }));
vi.mock('../../../server/realtime/bus.js', () => ({ emitToProjectLeaders: vi.fn(), emitToProjectMembers: vi.fn(), emitToUsers: vi.fn() }));

const listLogbook = vi.fn(async () => ({ available: true, events: [{ id: 'logbook:1', summary: 'secret' }], nextCursor: null, hasMore: false, sources: [] }));
const logbookFacets = vi.fn(async () => ({ engines: [], actions: [], statuses: [], actors: [], roles: [] }));
const collectForExport = vi.fn(async () => ({ rows: [{ id: 'logbook:1', at: new Date(), summary: 'secret' }], truncated: false }));

vi.mock('../../../server/logbook/logbookQuery.js', async (orig) => {
  const actual = await orig();
  return { ...actual, listLogbook, logbookFacets, collectForExport };
});

const { resolveLogbookAccess } = await import('../../../server/logbook/logbookAccess.js');
const LB = await import('../../../server/controllers/logbookController.js');
const { requireProjectLeader } = await import('../../../server/routes/logbook.js');
const svc = await import('../../../server/logbook/logbookService.js');

/* ── Fixtures ─────────────────────────────────────────────────────────────── */
const PROJECT = { id: 'sp1', title: 'Vitamin D review', linkedMetaLabProjectId: 'ml1', deletedAt: null, ownerId: 'owner1' };

const accessFor = (role, extra = {}) => ({
  project: PROJECT,
  role,
  isOwner: role === 'owner',
  isLeader: role === 'owner' || role === 'leader',
  active: true,
  perms: { canManageMembers: true, canManageSettings: true, canExport: true },
  ...extra,
});

/** Every project role that is NOT owner/leader — none of them may see the Logbook. */
const NON_LEADER_ROLES = ['reviewer', 'contributor', 'viewer', 'screener'];

const mkRes = () => {
  const res = { statusCode: 200, body: undefined, headers: {}, sent: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = (b) => { res.sent = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
};
const mkReq = (over = {}) => ({
  params: { pid: 'sp1' }, query: {}, headers: {}, path: '/projects/sp1/events',
  user: { id: 'u9', name: 'Dr Nine', email: 'nine@example.org' },
  ...over,
});

const HANDLERS = [
  ['getLogbookEvents', LB.getLogbookEvents],
  ['getLogbookFacets', LB.getLogbookFacets],
  ['exportLogbook', LB.exportLogbook],
];

beforeEach(() => {
  vi.clearAllMocks();
  state.access = null; state.mlAccess = null; state.project = null; state.linkedScreen = null;
  state.logs = []; state.members = [];
  svc._resetOutbox(); svc._resetSessions(); svc._resetLinkCache(); svc._resetPokes();
  listLogbook.mockResolvedValue({ available: true, events: [{ id: 'logbook:1', summary: 'secret' }], nextCursor: null, hasMore: false, sources: [] });
  collectForExport.mockResolvedValue({ rows: [{ id: 'logbook:1', at: new Date(), summary: 'secret' }], truncated: false });
});

/* ── 1. Nav visibility (the capability registry) ──────────────────────────── */
describe('layer 1 — navigation visibility (capabilities registry)', () => {
  it('viewLogbook / exportLogbook are leader_only with NO permission escape hatch', async () => {
    const { CAPABILITIES } = await import('../../../src/shared/access/capabilities.js');
    for (const key of ['viewLogbook', 'exportLogbook']) {
      expect(CAPABILITIES[key]).toBeTruthy();
      expect(CAPABILITIES[key].restriction).toBe('leader_only');
      // A `perm` would let a member with that flag through resolveCapability.
      expect(CAPABILITIES[key].perm).toBeUndefined();
      expect(CAPABILITIES[key].edit).toBe(false);
    }
  });

  it('resolveCapability allows owner/leader and denies every other role', async () => {
    const { resolveCapability } = await import('../../../src/shared/access/resolveAccess.js');
    expect(resolveCapability('viewLogbook', { isOwner: true }).allowed).toBe(true);
    expect(resolveCapability('viewLogbook', { isLeader: true }).allowed).toBe(true);
    for (const role of NON_LEADER_ROLES) {
      const d = resolveCapability('viewLogbook', { role, perms: { canManageMembers: true, canExport: true } });
      expect(d.allowed).toBe(false);
      expect(d.restrictionType).toBe('leader_only');
      expect(d.message).toMatch(/owner and leaders/i);
    }
  });
});

/* ── 2. The access resolver ───────────────────────────────────────────────── */
describe('layer 2 — resolveLogbookAccess', () => {
  it('allows the workspace owner and resolves BOTH project ids', async () => {
    state.access = accessFor('owner');
    const gate = await resolveLogbookAccess('sp1', { id: 'owner1' });
    expect(gate.ok).toBe(true);
    expect(gate.scope).toEqual({ projectId: 'sp1', metaLabProjectId: 'ml1' });
    expect(gate.role).toBe('owner');
  });

  it('allows a leader', async () => {
    state.access = accessFor('leader');
    expect((await resolveLogbookAccess('sp1', { id: 'u2' })).ok).toBe(true);
  });

  it.each(NON_LEADER_ROLES)('denies a %s with 403 and no data', async (role) => {
    state.access = accessFor(role);
    const gate = await resolveLogbookAccess('sp1', { id: 'u9' });
    expect(gate.ok).toBe(false);
    expect(gate.status).toBe(403);
    expect(gate.error).toMatch(/owner and leaders/i);
    expect(gate.events).toBeUndefined();
  });

  it('a non-member gets 404 (existence hiding), not 403', async () => {
    state.access = null; state.project = null;
    const gate = await resolveLogbookAccess('sp1', { id: 'stranger' });
    expect(gate.status).toBe(404);
    expect(gate.scope).toBeUndefined();
  });

  it('an unauthenticated call is 404', async () => {
    expect((await resolveLogbookAccess('sp1', null)).status).toBe(404);
  });

  it('META·LAB entry: the project owner is allowed; a non-leader member is 403', async () => {
    state.access = null;
    state.project = { id: 'ml1', userId: 'owner1', name: 'Vitamin D review' };
    state.linkedScreen = { id: 'sp1' };

    const owner = await resolveLogbookAccess('ml1', { id: 'owner1' });
    expect(owner.ok).toBe(true);
    expect(owner.scope).toEqual({ projectId: 'sp1', metaLabProjectId: 'ml1' });

    state.mlAccess = { role: 'reviewer', canView: true };
    const member = await resolveLogbookAccess('ml1', { id: 'u9' });
    expect(member.ok).toBe(false);
    expect(member.status).toBe(403);

    state.mlAccess = { role: 'leader', canView: true };
    expect((await resolveLogbookAccess('ml1', { id: 'u2' })).ok).toBe(true);

    state.mlAccess = null;
    expect((await resolveLogbookAccess('ml1', { id: 'stranger' })).status).toBe(404);
  });
});

/* ── 3. The route guard ───────────────────────────────────────────────────── */
describe('layer 3 — route guard (a hand-typed URL never reaches a handler)', () => {
  it.each(NON_LEADER_ROLES)('%s → 403 and next() is NEVER called', async (role) => {
    state.access = accessFor(role);
    const res = mkRes();
    const next = vi.fn();
    await requireProjectLeader(mkReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toMatch(/owner and leaders/i);
    expect(res.body.events).toBeUndefined();
  });

  it('a stranger → 404 and next() is never called', async () => {
    state.access = null; state.project = null;
    const res = mkRes(); const next = vi.fn();
    await requireProjectLeader(mkReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
  });

  it('a leader passes through with the resolved gate attached', async () => {
    state.access = accessFor('leader');
    const req = mkReq(); const res = mkRes(); const next = vi.fn();
    await requireProjectLeader(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.logbookGate.scope).toEqual({ projectId: 'sp1', metaLabProjectId: 'ml1' });
  });

  it('records the denied attempt as a §8 Logbook-security event', async () => {
    state.access = accessFor('reviewer');
    await requireProjectLeader(mkReq({ path: '/projects/sp1/export' }), mkRes(), vi.fn());
    expect(state.logs).toHaveLength(1);
    expect(state.logs[0].action).toBe('LOGBOOK_ACCESS_DENIED');
    expect(state.logs[0].status).toBe('failure');
    expect(state.logs[0].engine).toBe('logbook');
    expect(state.logs[0].actorId).toBe('u9');
    expect(state.logs[0].resourceId).toBe('export');
  });

  it('a stranger\'s denied probe writes NOTHING (no scope to attribute it to)', async () => {
    state.access = null; state.project = null;
    await requireProjectLeader(mkReq(), mkRes(), vi.fn());
    expect(state.logs).toHaveLength(0);
  });
});

/* ── 4. Every API handler, called directly ────────────────────────────────── */
describe('layer 4 — API authorization on every handler (direct-resource access)', () => {
  for (const [name, handler] of HANDLERS) {
    it.each(NON_LEADER_ROLES)(`${name} → 403 for a %s, and no events in the body`, async (role) => {
      state.access = accessFor(role);
      const res = mkRes();
      await handler(mkReq(), res);
      expect(res.statusCode).toBe(403);
      expect(res.body.events).toBeUndefined();
      expect(res.body.facets).toBeUndefined();
      expect(res.sent).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('secret');
    });

    it(`${name} → 404 for a non-member, with no existence leak`, async () => {
      state.access = null; state.project = null;
      const res = mkRes();
      await handler(mkReq(), res);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Project not found' });
    });

    it(`${name} never reaches the query layer when denied`, async () => {
      state.access = accessFor('viewer');
      await handler(mkReq(), mkRes());
      expect(listLogbook).not.toHaveBeenCalled();
      expect(logbookFacets).not.toHaveBeenCalled();
      expect(collectForExport).not.toHaveBeenCalled();
    });
  }

  it('a leader gets the page, and the viewer role is echoed', async () => {
    state.access = accessFor('leader');
    const res = mkRes();
    await LB.getLogbookEvents(mkReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.viewer).toEqual({ role: 'leader', isOwner: false });
  });
});

/* ── 5. Query scoping ─────────────────────────────────────────────────────── */
describe('layer 5 — database-query scoping', () => {
  it('queries with the RESOLVED scope, never with req.params', async () => {
    state.access = accessFor('owner');
    // A caller trying to widen the read by smuggling ids through the query string.
    await LB.getLogbookEvents(mkReq({
      params: { pid: 'sp1' },
      query: { projectId: 'spOTHER', metaLabProjectId: 'mlOTHER', limit: '10' },
    }), mkRes());
    expect(listLogbook).toHaveBeenCalledTimes(1);
    const [scope] = listLogbook.mock.calls[0];
    expect(scope).toEqual({ projectId: 'sp1', metaLabProjectId: 'ml1' });
  });

  it('normalises hostile filter input before it reaches the reader', async () => {
    state.access = accessFor('owner');
    await LB.getLogbookEvents(mkReq({ query: { limit: '100000', sort: 'DROP TABLE' } }), mkRes());
    const [, filters] = listLogbook.mock.calls[0];
    expect(filters.limit).toBeLessThanOrEqual(200);
    expect(filters.sort).toBe('desc');
  });
});

/* ── 6. Export authorization + its audit row ──────────────────────────────── */
describe('layer 6 — export authorization', () => {
  it('a leader can export CSV, and the export is itself logged', async () => {
    state.access = accessFor('leader');
    const res = mkRes();
    await LB.exportLogbook(mkReq({ query: { format: 'csv' } }), res);
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    expect(res.headers['Content-Disposition']).toMatch(/attachment; filename="logbook_/);
    expect(String(res.sent)).toContain('timestampUtc');
    const exported = state.logs.filter((r) => r.action === 'LOGBOOK_EXPORTED');
    expect(exported).toHaveLength(1);
    expect(exported[0].engine).toBe('logbook');
    expect(exported[0].severity).toBeGreaterThanOrEqual(4);
    expect(JSON.parse(exported[0].metadata).rowCount).toBe(1);
  });

  it('JSON export carries an explicit timezone and truncation flag', async () => {
    state.access = accessFor('owner');
    const res = mkRes();
    await LB.exportLogbook(mkReq({ query: { format: 'json' } }), res);
    const body = JSON.parse(res.sent);
    expect(body.timezone).toBe('UTC');
    expect(body.truncated).toBe(false);
    expect(body.events).toHaveLength(1);
  });

  it.each(NON_LEADER_ROLES)('a %s gets 403 and no file body at all', async (role) => {
    state.access = accessFor(role);
    const res = mkRes();
    await LB.exportLogbook(mkReq({ query: { format: 'csv' } }), res);
    expect(res.statusCode).toBe(403);
    expect(res.sent).toBeUndefined();
    expect(res.headers['Content-Disposition']).toBeUndefined();
    expect(state.logs.some((r) => r.action === 'LOGBOOK_EXPORTED')).toBe(false);
  });
});

/* ── 7. Views are logged (and coalesced, not spammed) ─────────────────────── */
describe('layer 7 — the Logbook logs its own access', () => {
  it('a view writes ONE coalesced LOGBOOK_VIEWED row even across many pages', async () => {
    state.access = accessFor('leader');
    for (let i = 0; i < 5; i++) await LB.getLogbookEvents(mkReq(), mkRes());
    const views = state.logs.filter((r) => r.action === 'LOGBOOK_VIEWED');
    expect(views).toHaveLength(1);
    expect(JSON.parse(views[0].metadata).eventCount).toBe(5);
  });
});

/* ── 8. Real-time subscription filter ─────────────────────────────────────── */
describe('layer 8 — SSE recipients are owner+leaders only', () => {
  it('emitToProjectLeaders queries members with role in (owner, leader) and adds the owner', async () => {
    // Import the REAL bus (this file mocks it for the controller under test).
    const bus = await vi.importActual('../../../server/realtime/bus.js');
    const seen = [];
    const fakeRes = { write: (frame) => seen.push(frame) };
    bus.register('owner1', fakeRes);
    bus.register('leader1', fakeRes);
    bus.register('reviewer1', fakeRes);

    // The mocked prisma above returns only role-filtered members.
    state.linkedScreen = { ownerId: 'owner1', deletedAt: null };
    state.members = [
      { userId: 'leader1', role: 'leader' },
      { userId: 'reviewer1', role: 'reviewer' },
    ];
    bus.emitToProjectLeaders('sp1', { type: 'logbook.updated' });
    await new Promise((r) => setTimeout(r, 5));

    // Two recipients (owner + leader) share one stream object → two frames.
    expect(seen).toHaveLength(2);
    bus.unregister('owner1', fakeRes); bus.unregister('leader1', fakeRes); bus.unregister('reviewer1', fakeRes);
  });
});
