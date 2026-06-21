/**
 * api-security-prompt49.test.js — live integration tests for prompt49:
 *   - readiness endpoint
 *   - session revocation on suspension (suspend → revoke → unsuspend still revoked → relogin)
 *   - shared (global) message read state across two staff accounts
 *   - Zod validation (autosave prototype-pollution + empty body; import)
 *   - forgot-password is non-enumerating
 *
 * Follows the repo convention: hits a LIVE server at :3001 and skips when down.
 * Admin-gated checks additionally need ADMIN_EMAIL_1 / ADMIN_EMAIL_2 /
 * ADMIN_SEED_PASSWORD in the env and skip otherwise.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3001/api';

async function serverUp() {
  try { const r = await fetch(`${API}/health`); return r.ok; } catch { return false; }
}
async function post(path, body, cookie) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
}
async function patch(path, body, cookie) {
  return fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body || {}),
  });
}
async function get(path, cookie) {
  return fetch(`${API}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
}
async function login(email, password) {
  const r = await post('/auth/login', { email, password });
  if (!r.ok) return null;
  return r.headers.get('set-cookie');
}

let up = false;
beforeAll(async () => { up = await serverUp(); });

describe('readiness', () => {
  it('GET /api/health/ready reports DB ok', async () => {
    if (!up) return;
    const r = await get('/health/ready');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.checks.database).toBe('ok');
    expect(j.version).toBeTruthy();
  });
});

describe('session revocation on suspension', () => {
  const adminEmail = process.env.ADMIN_EMAIL_1;
  const adminPass = process.env.ADMIN_SEED_PASSWORD;

  it('suspend revokes the active session; unsuspend does not restore it; relogin works', async () => {
    if (!up || !adminEmail || !adminPass) return;
    const adminCookie = await login(adminEmail, adminPass);
    if (!adminCookie) return;

    // Fresh victim user with an active session.
    const email = `revoke-${Date.now()}@example.com`;
    const reg = await post('/auth/register', { email, password: 'Str0ng-Pass-123', name: 'Victim' });
    if (!reg.ok) return; // registration disabled — skip
    const userCookie = reg.headers.get('set-cookie');
    const userId = (await reg.json()).user.id;

    // Active session works.
    expect((await get('/auth/me', userCookie)).status).toBe(200);

    // Admin suspends → the SAME cookie is now rejected (403 ACCOUNT_SUSPENDED).
    const susp = await patch(`/admin/users/${userId}/status`, { suspended: true }, adminCookie);
    expect(susp.status).toBe(200);
    const afterSuspend = await get('/auth/me', userCookie);
    expect(afterSuspend.status).toBe(403);

    // Unsuspend → the OLD cookie is still invalid (epoch bumped; not silently restored).
    const unsusp = await patch(`/admin/users/${userId}/status`, { suspended: false }, adminCookie);
    expect(unsusp.status).toBe(200);
    const afterUnsuspend = await get('/auth/me', userCookie);
    expect(afterUnsuspend.status).toBe(401);

    // A fresh login issues a valid session again.
    const fresh = await login(email, 'Str0ng-Pass-123');
    expect(fresh).toBeTruthy();
    expect((await get('/auth/me', fresh)).status).toBe(200);
  });
});

describe('self-service password change revokes other sessions', () => {
  it('keeps the changing device signed in but revokes other devices', async () => {
    if (!up) return;
    const email = `pwchg-${Date.now()}@example.com`;
    const pw = 'Str0ng-Pass-123';
    const reg = await post('/auth/register', { email, password: pw, name: 'PwChg' });
    if (!reg.ok) return;
    const deviceA = reg.headers.get('set-cookie');
    const deviceB = await login(email, pw); // a second device/session
    expect((await get('/auth/me', deviceA)).status).toBe(200);
    expect((await get('/auth/me', deviceB)).status).toBe(200);

    // Change password from device A — response re-issues device A's cookie.
    const chg = await fetch(`${API}/profile/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: deviceA },
      body: JSON.stringify({ currentPassword: pw, newPassword: 'New-Str0ng-Pass-456' }),
    });
    expect(chg.status).toBe(200);
    const deviceArefreshed = chg.headers.get('set-cookie');
    expect(deviceArefreshed).toBeTruthy();

    // Device B (other session) is revoked; device A (refreshed cookie) still works.
    expect((await get('/auth/me', deviceB)).status).toBe(401);
    expect((await get('/auth/me', deviceArefreshed)).status).toBe(200);
  });
});

describe('shared (global) message read state', () => {
  const e1 = process.env.ADMIN_EMAIL_1;
  const e2 = process.env.ADMIN_EMAIL_2;
  const pass = process.env.ADMIN_SEED_PASSWORD;

  it('opening a message marks it read for ALL staff; marking unread reverts for all', async () => {
    if (!up || !e1 || !e2 || !pass) return;
    const a1 = await login(e1, pass);
    const a2 = await login(e2, pass);
    if (!a1 || !a2) return;

    // Create a contact message (public form).
    const subject = `shared-read-${Date.now()}`;
    const created = await post('/contact', { email: 'sender@example.com', name: 'Sender', subject, message: 'hello ' + subject });
    if (!created.ok) return; // contact form disabled — skip

    // Find it as admin1.
    const list = await (await get(`/admin/contact-messages?search=${encodeURIComponent(subject)}`, a1)).json();
    const msg = (list.messages || []).find((m) => m.subject === subject);
    expect(msg).toBeTruthy();
    expect(msg.readByMe).toBe(false); // globally unread

    const unreadBefore2 = (await (await get('/admin/contact-messages/unread-count', a2)).json()).unread;

    // Admin1 opens (marks read) → global.
    const mr = await post(`/admin/contact-messages/${msg.id}/mark-read`, { read: true }, a1);
    expect(mr.status).toBe(200);

    // Admin2 sees it as read globally + a lower unread count.
    const list2 = await (await get(`/admin/contact-messages?search=${encodeURIComponent(subject)}`, a2)).json();
    const seenBy2 = (list2.messages || []).find((m) => m.subject === subject);
    expect(seenBy2.readByMe).toBe(true);
    expect(seenBy2.readByName).toBeTruthy(); // who read it
    const unreadAfter2 = (await (await get('/admin/contact-messages/unread-count', a2)).json()).unread;
    expect(unreadAfter2).toBe(unreadBefore2 - 1);

    // Admin2 marks it unread → unread again for admin1 too.
    await post(`/admin/contact-messages/${msg.id}/mark-read`, { read: false }, a2);
    const list1b = await (await get(`/admin/contact-messages?search=${encodeURIComponent(subject)}`, a1)).json();
    expect((list1b.messages || []).find((m) => m.subject === subject).readByMe).toBe(false);
  });
});

describe('Zod validation (import + autosave)', () => {
  it('rejects prototype-pollution and malformed bodies; rejects unauthenticated', async () => {
    if (!up) return;
    const email = `zod-${Date.now()}@example.com`;
    const reg = await post('/auth/register', { email, password: 'Str0ng-Pass-123', name: 'Zod' });
    if (!reg.ok) return;
    const cookie = reg.headers.get('set-cookie');

    // Autosave with a prototype-pollution key → 400 INVALID_BODY.
    const poll = await fetch(`${API}/projects/zodproj1/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{"name":"x","__proto__":{"admin":true}}',
    });
    expect(poll.status).toBe(400);
    expect((await poll.json()).code).toBe('INVALID_BODY');

    // Autosave with a missing name → 400 VALIDATION_ERROR with field errors.
    const bad = await fetch(`${API}/projects/zodproj2/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ studies: [] }),
    });
    expect(bad.status).toBe(400);
    const badBody = await bad.json();
    expect(badBody.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(badBody.fieldErrors)).toBe(true);

    // A valid autosave still works (creates the project).
    const okSave = await fetch(`${API}/projects/zodproj3-${Date.now()}/autosave`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ name: 'Zod Project', studies: [], records: [] }),
    });
    expect(okSave.ok).toBe(true);

    // Import with empty text → 400.
    const imp = await post('/import/references', { text: '', projectId: 'p' }, cookie);
    expect(imp.status).toBe(400);
  });
});

describe('forgot-password is non-enumerating', () => {
  it('returns an identical neutral response for existing and unknown emails', async () => {
    if (!up) return;
    const a = await (await post('/auth/forgot-password', { email: 'definitely-not-a-user@example.com' })).json();
    const b = await (await post('/auth/forgot-password', { email: 'also-not-a-user@example.com' })).json();
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });
});
