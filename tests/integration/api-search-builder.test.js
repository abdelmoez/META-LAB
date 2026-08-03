/**
 * api-search-builder.test.js — 97.md Phase 16/18 (QA M8/M29/M30). FUNCTIONAL
 * coverage of the putSearch envelope over the REAL route:
 *   - baseRevision strict CAS: a stale full-state write answers 409 and changes
 *     NOTHING ("Stale revisions are rejected safely");
 *   - partial-body single-key writers (searchMode) keep the documented LWW and
 *     never touch concepts;
 *   - auditAction:'regenerated' → a SEARCH_REGENERATED WorkflowStateAudit row
 *     ("Regeneration is auditable"); ordinary saves stay SEARCH_UPDATED;
 *   - meta round-trip: the PUT echoes the identity-stamped meta (generatedBy /
 *     manuallyModifiedBy from the session — QA M3) and GET returns it.
 *
 * Canonical harness pattern: self-skips (visibly, via ctx.skip()) when the dev
 * server at 127.0.0.1:3001 is down or no seeded admin authenticates. The admin
 * passes the searchEngine flag gate via the featureAccess admin bypass and owns
 * the project it creates, so the whole flow runs against default flags.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API = 'http://127.0.0.1:3001/api';

async function hit(path, opts = {}) {
  try { return await fetch(`${API}${path}`, opts); }
  catch { return fetch(`${API}${path}`, opts); } // one retry
}

let up = false;
let cookie = '';
let projectId = '';

async function loginAdmin() {
  const candidates = [
    [process.env.ADMIN_EMAIL_1 || process.env.ADMIN_EMAIL, process.env.ADMIN_SEED_PASSWORD],
    ['admin@example.com', 'LocalDevAdmin!2026'],
    ['admin@metalab.local', 'MetaLabAdmin2026!'],
  ];
  for (const [email, password] of candidates) {
    if (!email || !password) continue;
    try {
      const res = await hit('/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        const c = (res.headers.get('set-cookie') || '').split(';')[0] || '';
        if (c) return c;
      }
    } catch { /* try next */ }
  }
  return '';
}

const J = { 'Content-Type': 'application/json' };
const put = (body) => hit(`/search-builder/${projectId}`, {
  method: 'PUT', headers: { ...J, cookie }, body: JSON.stringify(body),
});
const get = () => hit(`/search-builder/${projectId}`, { headers: { cookie } });

const GROUP = (id, label, texts) => ({
  id, label, op: 'AND', source: 'user_added',
  terms: texts.map((text, i) => ({ id: `${id}-t${i}`, text, type: 'freetext', field: 'tiab', source: 'user_added' })),
});

beforeAll(async () => {
  try { up = (await hit('/health')).ok; } catch { up = false; }
  if (!up) return;
  cookie = await loginAdmin();
  if (!cookie) { up = false; return; }
  const res = await hit('/projects', {
    method: 'POST', headers: { ...J, cookie },
    body: JSON.stringify({ name: `sb-97-it-${Date.now()}` }),
  });
  if (!res.ok) { up = false; return; }
  const proj = await res.json().catch(() => null);
  projectId = (proj && (proj.id || (proj.project && proj.project.id))) || '';
  if (!projectId) up = false;
}, 30000);

afterAll(async () => {
  if (up && projectId) {
    try {
      await hit(`/projects/${projectId}/delete`, { method: 'POST', headers: { ...J, cookie }, body: JSON.stringify({ confirm: true }) });
    } catch { /* best-effort cleanup */ }
  }
});

describe('putSearch envelope — baseRevision CAS + auditAction + meta round-trip', () => {
  it('seeds the strategy (revision 1) and a matching baseRevision write lands (revision 2)', async (ctx) => {
    if (!up) return ctx.skip();
    const seed = await put({ concepts: [GROUP('g1', 'Search Group 1', ['heart failure'])] });
    expect(seed.status).toBe(200);
    const ack1 = await seed.json();
    expect(ack1.ok).toBe(true);
    expect(ack1.revision).toBe(1);

    const second = await put({
      concepts: [GROUP('g1', 'Search Group 1', ['heart failure', 'cardiac failure'])],
      baseRevision: 1,
    });
    expect(second.status).toBe(200);
    expect((await second.json()).revision).toBe(2);
  });

  it('QA M29 — a STALE baseRevision answers 409 and changes NOTHING', async (ctx) => {
    if (!up) return ctx.skip();
    const before = await (await get()).json();
    const stale = await put({
      concepts: [GROUP('gX', 'Clobber', ['stale overwrite'])],
      baseRevision: (before.revision || 2) - 1,
    });
    expect(stale.status).toBe(409);
    const staleBody = await stale.json().catch(() => null);
    expect(staleBody && staleBody.conflict).toBe(true);
    const after = await (await get()).json();
    expect(after.revision).toBe(before.revision); // no write
    expect(JSON.stringify(after.concepts)).toBe(JSON.stringify(before.concepts)); // no overwrite
  });

  it('a partial single-key body (searchMode, no baseRevision) keeps LWW and never touches concepts', async (ctx) => {
    if (!up) return ctx.skip();
    const before = await (await get()).json();
    const res = await put({ searchMode: 'manual' });
    expect(res.status).toBe(200);
    const after = await (await get()).json();
    expect(after.searchMode).toBe('manual');
    expect(after.revision).toBe(before.revision + 1); // the envelope moved…
    expect(JSON.stringify(after.concepts)).toBe(JSON.stringify(before.concepts)); // …the content did not
  });

  it('QA H3 (server side) — after a single-key bump, a full save with the NEW revision lands cleanly', async (ctx) => {
    if (!up) return ctx.skip();
    const now = await (await get()).json();
    const res = await put({
      concepts: [GROUP('g1', 'Search Group 1', ['heart failure', 'cardiac failure', 'CHF'])],
      baseRevision: now.revision,
    });
    expect(res.status).toBe(200);
  });

  it('QA M30 — auditAction:"regenerated" writes a SEARCH_REGENERATED audit row (ordinary saves stay SEARCH_UPDATED)', async (ctx) => {
    if (!up) return ctx.skip();
    const now = await (await get()).json();
    const res = await put({
      concepts: [GROUP('r1', 'Search Group 1', ['regenerated term'])],
      questionSnapshot: 'regenerated question',
      auditAction: 'regenerated',
      baseRevision: now.revision,
    });
    expect(res.status).toBe(200);
    const audit = await hit(`/workspaces/${projectId}/audit`, { headers: { cookie } });
    if (audit.status === 404) return ctx.skip(); // workflow-state audit surface flag-gated off for this env
    const { entries } = await audit.json();
    const actions = (entries || []).map((e) => e.action);
    expect(actions).toContain('SEARCH_REGENERATED');
    expect(actions).toContain('SEARCH_UPDATED');
    const regenRow = (entries || []).find((e) => e.action === 'SEARCH_REGENERATED');
    expect(regenRow.moduleKey).toBe('search');
  });

  it('QA M3 — meta PUT echoes the session-stamped identity and GET round-trips it', async (ctx) => {
    if (!up) return ctx.skip();
    const now = await (await get()).json();
    const meta = {
      generatedAt: '2026-08-02T10:00:00.000Z',
      sourceQuestion: 'regenerated question',
      manuallyModifiedAt: '2026-08-02T11:00:00.000Z',
    };
    const res = await put({ meta, baseRevision: now.revision });
    expect(res.status).toBe(200);
    const ack = await res.json();
    // The echo carries the server-stamped identity (client sent none).
    expect(ack.meta).toBeTruthy();
    expect(ack.meta.generatedAt).toBe(meta.generatedAt);
    expect(ack.meta.generatedBy && ack.meta.generatedBy.id).toBeTruthy();
    expect(ack.meta.manuallyModifiedBy && ack.meta.manuallyModifiedBy.id).toBeTruthy();
    // GET returns the exact stored block.
    const doc = await (await get()).json();
    expect(doc.meta).toEqual(ack.meta);
  });

  it('an unauthenticated PUT is rejected before any gate', async (ctx) => {
    if (!up) return ctx.skip();
    const res = await hit(`/search-builder/${projectId}`, {
      method: 'PUT', headers: J, body: JSON.stringify({ concepts: [] }),
    });
    expect([401, 403]).toContain(res.status);
  });
});
