/**
 * email-admin-ops.test.js — 112.md follow-up: Ops › Email server half over HTTP.
 *
 * Verifies (a) the capability seam on every new /api/admin/email route (401
 * unauthenticated, 403 for an ordinary user, reads and writes alike), (b) the
 * registry-merged template list shape, (c) the PUT validation contract (types +
 * the required-token 400 that NAMES the missing token), (d) preview determinism
 * over the wire, (e) the non-disableable 400, and (f) the delivery envelope.
 *
 * All tests self-skip when the API on :3001 is down (health-check pattern);
 * authenticated assertions additionally skip when the seeded admin password is
 * unknown to the test process. The one write round-trip (override → restore)
 * restores in try/finally, so no global state survives the run.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false;
let adminCookie = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* 204 / non-JSON */ }
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) {
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: 'ops-112' } });
  return r.cookie;
}

beforeAll(async () => {
  try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  if (!up) return;
  for (const [email, pass] of [
    ['ops@example.com', process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026'],
    ['admin@example.com', process.env.ADMIN_SEED_PASSWORD || 'LocalTestAdmin#2026'],
  ]) {
    const r = await api('/auth/login', { method: 'POST', body: { email, password: pass } });
    if (r.status === 200) { adminCookie = r.cookie; break; }
  }
});

const READS = [
  '/admin/email/templates',
  '/admin/email/templates/welcome',
  '/admin/email/delivery',
];
const WRITES = [
  ['PUT', '/admin/email/templates/welcome', { fields: { subject: 'x' } }],
  ['DELETE', '/admin/email/templates/welcome', {}],
  ['POST', '/admin/email/templates/welcome/enabled', { enabled: true }],
  ['POST', '/admin/email/templates/welcome/preview', {}],
  ['POST', '/admin/email/templates/welcome/test-send', {}],
];

describe('112 — Email admin authorization (capability seam)', () => {
  it('unauthenticated → 401 on every new endpoint', async () => {
    if (!up) return;
    for (const e of READS) expect((await api(e)).status, e).toBe(401);
    for (const [method, e, body] of WRITES) expect((await api(e, { method, body })).status, `${method} ${e}`).toBe(401);
  });

  it('a normal (non-staff) user → 403 on every new endpoint', async () => {
    if (!up) return;
    const cookie = await register(`ops112_${rnd()}@t.local`);
    for (const e of READS) expect((await api(e, { cookie })).status, e).toBe(403);
    for (const [method, e, body] of WRITES) expect((await api(e, { method, body, cookie })).status, `${method} ${e}`).toBe(403);
  });
});

describe('112 — template list (admin)', () => {
  it('returns the full registry merged with override status', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/email/templates', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates).toHaveLength(9);
    const keys = data.templates.map((t) => t.key);
    for (const k of ['welcome', 'chat.digest', 'password.reset', 'email.verification', 'contact.reply']) {
      expect(keys).toContain(k);
    }
    for (const t of data.templates) {
      expect(typeof t.hasOverride).toBe('boolean');
      expect(typeof t.enabled).toBe('boolean');
      expect(t.effectiveFields).toBeTruthy();
      expect(Array.isArray(t.requiredVariables)).toBe(true);
    }
    // Only the 'optional' entries are disableable — the registry category policy over the wire.
    expect(data.templates.filter((t) => t.disableable).map((t) => t.key).sort()).toEqual(['chat.digest', 'welcome']);
    expect(typeof data.emailConfigured).toBe('boolean');
  });

  it('an unknown key 404s on every per-template route', async () => {
    if (!up || !adminCookie) return;
    expect((await api('/admin/email/templates/no.such', { cookie: adminCookie })).status).toBe(404);
    expect((await api('/admin/email/templates/no.such', { method: 'PUT', body: { fields: {} }, cookie: adminCookie })).status).toBe(404);
    expect((await api('/admin/email/templates/no.such/preview', { method: 'POST', cookie: adminCookie })).status).toBe(404);
  });
});

describe('112 — PUT validation contract (admin)', () => {
  it('rejects bad types and unknown keys without writing', async () => {
    if (!up || !adminCookie) return;
    expect((await api('/admin/email/templates/welcome', { method: 'PUT', body: { fields: { subject: 42 } }, cookie: adminCookie })).status).toBe(400);
    const unknown = await api('/admin/email/templates/welcome', { method: 'PUT', body: { fields: { html: '<b>x</b>' } }, cookie: adminCookie });
    expect(unknown.status).toBe(400);
    expect(unknown.data.error).toContain('html');
  });

  it('a 400 NAMES the required token an override would strip', async () => {
    if (!up || !adminCookie) return;
    const r = await api('/admin/email/templates/password.reset', {
      method: 'PUT',
      body: { fields: { subject: 'Reset', bodyParagraphs: ['No token here.'] } },
      cookie: adminCookie,
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain('[link]');
    expect(r.data.missing).toEqual(['link']);
  });

  it('override round-trip: save a diff, see it merged, restore to defaults', async () => {
    if (!up || !adminCookie) return;
    const subject = `[appName] test override ${rnd()}`;
    try {
      const put = await api('/admin/email/templates/welcome', {
        method: 'PUT', body: { fields: { subject }, reason: 'integration round-trip' }, cookie: adminCookie,
      });
      expect(put.status).toBe(200);
      expect(put.data.template.hasOverride).toBe(true);
      expect(put.data.template.effectiveFields.subject).toBe(subject);
      // Only the diff is stored — heading stays a registry default.
      expect(put.data.template.overrideFields).toEqual({ subject });
    } finally {
      const del = await api('/admin/email/templates/welcome', {
        method: 'DELETE', body: { reason: 'integration cleanup' }, cookie: adminCookie,
      });
      expect(del.status).toBe(200);
      expect(del.data.template.hasOverride).toBe(false);
    }
    const after = await api('/admin/email/templates/welcome', { cookie: adminCookie });
    expect(after.data.template.hasOverride).toBe(false);
  });
});

describe('112 — enable/disable is registry-gated (admin)', () => {
  it('a transactional template 400s; a boolean is required', async () => {
    if (!up || !adminCookie) return;
    const r = await api('/admin/email/templates/password.reset/enabled', {
      method: 'POST', body: { enabled: false }, cookie: adminCookie,
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain('password.reset');
    const nb = await api('/admin/email/templates/welcome/enabled', {
      method: 'POST', body: { enabled: 'yes' }, cookie: adminCookie,
    });
    expect(nb.status).toBe(400);
  });
});

describe('112 — preview (admin)', () => {
  it('renders deterministically with sample values', async () => {
    if (!up || !adminCookie) return;
    const a = await api('/admin/email/templates/welcome/preview', { method: 'POST', cookie: adminCookie });
    const b = await api('/admin/email/templates/welcome/preview', { method: 'POST', cookie: adminCookie });
    expect(a.status).toBe(200);
    expect(a.data.subject).toBe(b.data.subject);
    expect(a.data.html).toBe(b.data.html);
    expect(a.data.text).toBe(b.data.text);
    expect(a.data.missingRequired).toEqual([]);
    expect(a.data.html).toContain('<!DOCTYPE html>');
  });

  it('previews an unsaved draft without persisting anything', async () => {
    if (!up || !adminCookie) return;
    const draftSubject = `Draft-only subject ${rnd()}`;
    const p = await api('/admin/email/templates/welcome/preview', {
      method: 'POST', body: { fields: { subject: draftSubject } }, cookie: adminCookie,
    });
    expect(p.status).toBe(200);
    expect(p.data.subject).toBe(draftSubject);
    const t = await api('/admin/email/templates/welcome', { cookie: adminCookie });
    expect(t.data.template.effectiveFields.subject).not.toBe(draftSubject);
  });
});

describe('112 — delivery history (admin)', () => {
  it('returns the paged envelope with per-status counts and no variable payloads', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/email/delivery?limit=5', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(Array.isArray(data.deliveries)).toBe(true);
    expect(data.limit).toBe(5);
    expect(data.page).toBe(1);
    expect(typeof data.total).toBe('number');
    expect(typeof data.hasMore).toBe('boolean');
    for (const s of ['pending', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_unconfigured']) {
      expect(typeof data.counts[s]).toBe('number');
    }
    // variablesJson can carry live reset/invite links — it must never be echoed.
    const blob = JSON.stringify(data);
    expect(blob).not.toContain('variablesJson');
    expect(blob).not.toContain('idempotencyKey');
  });

  it('clamps limit and ignores junk filters instead of 400-ing', async () => {
    if (!up || !adminCookie) return;
    expect((await api('/admin/email/delivery?limit=99999', { cookie: adminCookie })).data.limit).toBe(100);
    expect((await api('/admin/email/delivery?status=nonsense', { cookie: adminCookie })).status).toBe(200);
    expect((await api('/admin/email/delivery?from=garbage&to=2026-13-99', { cookie: adminCookie })).status).toBe(200);
  });
});

describe('112 — the email section is advertised to admins only', () => {
  it('GET /admin/console lists "email" for an admin', async () => {
    if (!up || !adminCookie) return;
    const { status, data } = await api('/admin/console', { cookie: adminCookie });
    expect(status).toBe(200);
    expect(data.sections).toContain('email');
  });
});
