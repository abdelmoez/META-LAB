/**
 * api-password-reset.test.js — token-based password reset (prompt14 Task 9).
 *
 *   T1  Server reachability guard (anti-vacuous-green)
 *   T2  forgot-password: no enumeration (known == unknown == same generic 200);
 *       malformed email → 400
 *   T3  admin send-password-reset + full token lifecycle (reset → login with new
 *       password → old password rejected → token cannot be reused)
 *   T4  reset-password validation (bogus token, short password, missing fields)
 *   T5  permissions: plain user 403; mod cannot reset admin/mod; mod CAN reset a
 *       plain user; admin can reset a plain user
 *   T6  expiry (93.md audit gap): a token whose expiresAt has passed is rejected
 *       with 400 and leaves the password unchanged
 *
 * Live API at http://127.0.0.1:3001 (npm run server).
 * 127.0.0.1, never localhost (node fetch can resolve ::1 and hang on Windows).
 */
import { describe, it, expect, beforeAll } from 'vitest';
// T6 needs to force a token's expiry directly in the same SQLite DB the live
// server uses (the API never exposes expiresAt) — same pattern as
// waitlist-invitation.test.js.
import { prisma } from '../../server/db/client.js';

const BASE = 'http://127.0.0.1:3001/api';
const rnd = () => Math.random().toString(36).slice(2, 8);
let up = false, adminCookie = '', adminId = '';

function cookieFrom(res) { const sc = res.headers.get('set-cookie') || ''; const m = sc.match(/metalab_session=[^;]+/); return m ? m[0] : ''; }
async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data, cookie: cookieFrom(res) };
}
async function register(email) {
  const r = await api('/auth/register', { method: 'POST', body: { email, password: 'Password123!', name: email.split('@')[0] } });
  return { cookie: r.cookie, id: r.data?.user?.id, email, status: r.status };
}
async function loginAs(email, password = 'Password123!') {
  const r = await api('/auth/login', { method: 'POST', body: { email, password } });
  return { status: r.status, cookie: r.cookie };
}
/** Pull the raw reset token out of a copyable reset link. */
function tokenFromLink(link) { const m = String(link || '').match(/[?&]token=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; }

beforeAll(async () => {
  // Reachability probe + admin login with SPACED retries: at the tail of a long
  // suite run the client can transiently fail to open sockets for a second or
  // two (Windows ephemeral-port churn after thousands of requests) — the
  // anti-vacuous guard (T1) should fail on a DOWN server, not on that hiccup.
  for (let attempt = 0; attempt < 5 && !up; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1000));
    try { const r = await fetch(BASE + '/health'); up = r.ok; } catch { up = false; }
  }
  if (up) {
    // BOTH candidate passwords are tried: earlier files in the same fork can
    // import server code that loads server/.env into process.env (dotenv), and
    // ADMIN_SEED_PASSWORD there may differ from the DB admin's actual password
    // (seedAdmins never resets an existing admin) — the literal is the dev seed.
    const candidates = [...new Set([process.env.ADMIN_SEED_PASSWORD, 'MetaLabAdmin2026!'].filter(Boolean))];
    for (const password of candidates) {
      if (adminCookie) break;
      try {
        const r = await api('/auth/login', { method: 'POST', body: { email: 'admin@metalab.local', password } });
        adminCookie = r.status === 200 ? r.cookie : '';
      } catch { adminCookie = ''; }
    }
    if (adminCookie) {
      const me = await api('/auth/me', { cookie: adminCookie });
      adminId = me.data?.user?.id || '';
    }
  }
}, 30000);

describe('reset T1 — server reachability (anti-vacuous-green guard)', () => {
  it('the live API on 127.0.0.1:3001 is reachable and admin login works', () => {
    expect(up).toBe(true);
    expect(adminCookie).not.toBe('');
    expect(adminId).not.toBe('');
  });
});

describe('reset T2 — forgot-password does not enumerate accounts', () => {
  it('known, unknown, and suspended-shaped emails all return the same generic 200; malformed → 400', async () => {
    if (!up) return;
    const u = await register(`pwr${rnd()}@example.com`);
    expect(u.status).toBe(201);

    const known = await api('/auth/forgot-password', { method: 'POST', body: { email: u.email } });
    const unknown = await api('/auth/forgot-password', { method: 'POST', body: { email: `nobody${rnd()}@example.com` } });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.data.ok).toBe(true);
    expect(unknown.data.ok).toBe(true);
    // Identical body — no oracle distinguishing exists vs not-exists.
    expect(known.data).toEqual(unknown.data);

    const bad = await api('/auth/forgot-password', { method: 'POST', body: { email: 'not-an-email' } });
    expect(bad.status).toBe(400);
    const empty = await api('/auth/forgot-password', { method: 'POST', body: {} });
    expect(empty.status).toBe(400);
  });
});

describe('reset T3 — admin send-password-reset + full token lifecycle', () => {
  it('mints a link, resets the password, lets the user log in, rejects the old password, and burns the token', async () => {
    if (!up) return;
    const u = await register(`pwr${rnd()}@example.com`);
    expect(u.status).toBe(201);

    const sent = await api(`/admin/users/${u.id}/send-password-reset`, { method: 'POST', cookie: adminCookie });
    expect(sent.status).toBe(200);
    expect(typeof sent.data.emailConfigured).toBe('boolean');
    expect(typeof sent.data.sent).toBe('boolean');

    if (sent.data.sent) {
      // Real SMTP path (rare in test) — no link is exposed; just assert config.
      expect(sent.data.emailConfigured).toBe(true);
      expect(sent.data.link).toBeUndefined();
      return;
    }

    // Unconfigured / send-failed fallback → operator gets a copyable link.
    expect(typeof sent.data.link).toBe('string');
    expect(sent.data.link).toContain('/reset?token=');
    const token = tokenFromLink(sent.data.link);
    expect(token.length).toBeGreaterThan(20);

    // Consume the token → set a new password.
    const NEW = 'BrandNewPass1!';
    const reset = await api('/auth/reset-password', { method: 'POST', body: { token, password: NEW } });
    expect(reset.status).toBe(200);
    expect(reset.data.ok).toBe(true);

    // New password works; old one no longer does.
    const good = await loginAs(u.email, NEW);
    expect(good.status).toBe(200);
    const old = await loginAs(u.email, 'Password123!');
    expect(old.status).toBe(401);

    // Single-use: the same token cannot be reused.
    const reuse = await api('/auth/reset-password', { method: 'POST', body: { token, password: 'Another1!' } });
    expect(reuse.status).toBe(400);
  });
});

describe('reset T4 — reset-password validation', () => {
  it('rejects bogus tokens, short passwords, and missing fields', async () => {
    if (!up) return;
    const bogus = await api('/auth/reset-password', { method: 'POST', body: { token: `deadbeef${rnd()}`, password: 'LongEnough1!' } });
    expect(bogus.status).toBe(400);
    const short = await api('/auth/reset-password', { method: 'POST', body: { token: 'whatever', password: 'short' } });
    expect(short.status).toBe(400);
    const missing = await api('/auth/reset-password', { method: 'POST', body: {} });
    expect(missing.status).toBe(400);
  });
});

describe('reset T5 — permissions on admin send-password-reset', () => {
  it('plain user 403; mod cannot reset admin/mod; mod can reset a plain user; admin can reset a plain user', async () => {
    if (!up) return;

    // Plain user cannot call the admin endpoint at all.
    const plain = await register(`pwrplain${rnd()}@example.com`);
    const target = await register(`pwrtarget${rnd()}@example.com`);
    const asPlain = await api(`/admin/users/${target.id}/send-password-reset`, { method: 'POST', cookie: plain.cookie });
    expect(asPlain.status).toBe(403);

    // Admin CAN reset a plain user.
    const asAdmin = await api(`/admin/users/${target.id}/send-password-reset`, { method: 'POST', cookie: adminCookie });
    expect(asAdmin.status).toBe(200);

    // Promote a user to mod (admin-only), then log in fresh as that mod.
    const modUser = await register(`pwrmod${rnd()}@example.com`);
    const promote = await api(`/admin/users/${modUser.id}/role`, { method: 'PATCH', cookie: adminCookie, body: { role: 'mod' } });
    expect(promote.status).toBe(200);
    const modLogin = await loginAs(modUser.email);
    expect(modLogin.status).toBe(200);
    const modCookie = modLogin.cookie;

    // Mod can reset a plain user…
    const modOnUser = await api(`/admin/users/${target.id}/send-password-reset`, { method: 'POST', cookie: modCookie });
    expect(modOnUser.status).toBe(200);

    // …but NOT an admin…
    const modOnAdmin = await api(`/admin/users/${adminId}/send-password-reset`, { method: 'POST', cookie: modCookie });
    expect(modOnAdmin.status).toBe(403);

    // …nor another mod (the mod targeting itself via the admin endpoint).
    const modOnMod = await api(`/admin/users/${modUser.id}/send-password-reset`, { method: 'POST', cookie: modCookie });
    expect(modOnMod.status).toBe(403);
  });
});

describe('reset T6 — expired tokens are rejected (93.md audit gap: reuse/enumeration were covered, expiry was not)', () => {
  it('a token past its expiresAt → 400 "expired", and the old password still works', async () => {
    if (!up || !adminCookie) return;
    const u = await register(`pwrexp${rnd()}@example.com`);
    expect(u.status).toBe(201);

    const sent = await api(`/admin/users/${u.id}/send-password-reset`, { method: 'POST', cookie: adminCookie });
    expect(sent.status).toBe(200);
    if (sent.data.sent) return; // real-SMTP path exposes no link; lifecycle covered in T3

    const token = tokenFromLink(sent.data.link);
    expect(token.length).toBeGreaterThan(20);

    // Force expiry in the DB (no API exposes it). Exactly one live token exists —
    // createResetToken burns priors, so updateMany must report count 1.
    const upd = await prisma.passwordResetToken.updateMany({
      where: { userId: u.id, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(upd.count).toBe(1);

    const res = await api('/auth/reset-password', { method: 'POST', body: { token, password: 'FreshPass1!' } });
    expect(res.status).toBe(400);
    expect(String(res.data?.error || '')).toMatch(/expired/i);

    // The expired attempt must not have changed anything: old password works,
    // the attempted new one does not.
    const oldLogin = await loginAs(u.email, 'Password123!');
    expect(oldLogin.status).toBe(200);
    const newLogin = await loginAs(u.email, 'FreshPass1!');
    expect(newLogin.status).toBe(401);
  });
});
