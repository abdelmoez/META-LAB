/**
 * waitlist-invitation.test.js — integration tests for the waitlist → account
 * invitation workflow (80.md). Runs against a LIVE server on 127.0.0.1:3001 (or
 * TEST_API_URL). Self-skips (vacuous pass) when the server is unreachable, per this
 * suite's convention — always assert the T1 reachability guard is green.
 *
 * Two surfaces are exercised:
 *   - ADMIN HTTP: login as admin, seed a public applicant, list (with enrichment),
 *     invite / resend / revoke / history, bulk invite.
 *   - PUBLIC ACCEPT HTTP: because the raw token is never returned by any API (only
 *     emailed), we mint it via the invitation SERVICE (same DB the server uses),
 *     then drive the public /accept-invitation endpoints over HTTP: validate,
 *     accept (valid → creates a loginable account), single-use replay, expired,
 *     revoked.
 *
 * Run with the server up + SMTP unset (so no real email sends):  npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createInvitation, resolveInvitationToken } from '../../server/services/invitationService.js';
import { prisma } from '../../server/db/client.js';

const API = (process.env.TEST_API_URL || 'http://127.0.0.1:3001/api').replace(/\/+$/, '');
const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

let up = false;
let adminCookie = '';

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, data, cookie: (setCookie.match(/metalab_session=[^;]+/) || [''])[0] };
}

async function loginAdmin() {
  const candidates = [
    [process.env.ADMIN_EMAIL_1, process.env.ADMIN_SEED_PASSWORD],
    ['admin@example.com', 'LocalDevAdmin!2026'],
    ['admin@metalab.local', 'MetaLabAdmin2026!'],
  ];
  for (const [email, password] of candidates) {
    if (!email || !password) continue;
    const r = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (r.status === 200 && r.cookie) return r.cookie;
  }
  return '';
}

const createdEmails = [];
const createdUserIds = [];

beforeAll(async () => {
  try { up = (await fetch(API + '/health')).ok; } catch { up = false; }
  if (up) adminCookie = await loginAdmin();
}, 30000);

afterAll(async () => {
  // Best-effort cleanup of anything this suite created.
  try {
    for (const uid of createdUserIds) {
      await prisma.userTierAssignment.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.securityEvent.deleteMany({ where: { userId: uid } }).catch(() => {});
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    for (const email of createdEmails) {
      await prisma.waitlistInvitation.deleteMany({ where: { normalizedEmail: email } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email } }).catch(() => {});
    }
  } catch { /* ignore */ }
  await prisma.$disconnect().catch(() => {});
});

describe('T1 — server reachable', () => {
  it('is up (integration tests require a running server)', () => {
    expect(up).toBe(true);
  });
});

describe('admin invitation surface', () => {
  it('requires authentication (401 without a cookie)', async () => {
    if (!up) return;
    const r = await api('/admin/beta-waitlist/applicants/does-not-exist/invite', { method: 'POST', body: {} });
    expect([401, 403]).toContain(r.status);
  });

  it('invites a seeded applicant, then resends and revokes', async () => {
    if (!up) return;
    expect(adminCookie).not.toBe('');

    // Seed a real applicant via the public submit endpoint.
    const email = `inv_${uniq()}@example.test`;
    createdEmails.push(email.toLowerCase());
    const sub = await api('/waitlist', { method: 'POST', body: { email, firstName: 'Test', lastName: 'Invitee', countryCode: 'US', consent: true } });
    expect([200, 201]).toContain(sub.status);

    // Find the applicant id via the admin list (search by email) + confirm enrichment.
    const list = await api(`/admin/beta-waitlist/applicants?search=${encodeURIComponent(email)}&limit=5`, { cookie: adminCookie });
    expect(list.status).toBe(200);
    const row = (list.data.rows || []).find((r) => r.email === email);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty('inviteState');
    expect(row).toHaveProperty('eligibility');
    expect(row.inviteState).toBe('waiting');
    const id = row.id;

    // Invite (SMTP unset in the test server → invited_no_email; if configured → invited).
    const invite = await api(`/admin/beta-waitlist/applicants/${id}/invite`, { method: 'POST', body: {}, cookie: adminCookie });
    expect(invite.status).toBe(200);
    expect(['invited', 'invited_no_email', 'email_failed']).toContain(invite.data.result.code);

    // History now shows one invitation, never a token/tokenHash.
    const hist1 = await api(`/admin/beta-waitlist/applicants/${id}/invitations`, { cookie: adminCookie });
    expect(hist1.status).toBe(200);
    expect(hist1.data.invitations.length).toBe(1);
    expect(hist1.data.invitations[0]).not.toHaveProperty('tokenHash');
    expect(hist1.data.invitations[0].attempt).toBe(1);

    // Resend rotates to attempt 2 (cooldown default 60s, but a fresh test server
    // may have it unset/short; accept either a new attempt or a 429 cooldown).
    const resend = await api(`/admin/beta-waitlist/applicants/${id}/invite/resend`, { method: 'POST', body: {}, cookie: adminCookie });
    expect([200, 429]).toContain(resend.status);

    // Revoke the active invitation.
    const revoke = await api(`/admin/beta-waitlist/applicants/${id}/invite/revoke`, { method: 'POST', body: {}, cookie: adminCookie });
    expect(revoke.status).toBe(200);
    expect(revoke.data.ok).toBe(true);

    // After revoke there is no active invitation to revoke again.
    const revoke2 = await api(`/admin/beta-waitlist/applicants/${id}/invite/revoke`, { method: 'POST', body: {}, cookie: adminCookie });
    expect(revoke2.status).toBe(409);
  });

  it('bulk invite requires ids[] or allMatchingFilter', async () => {
    if (!up) return;
    const r = await api('/admin/beta-waitlist/invitations/bulk', { method: 'POST', body: {}, cookie: adminCookie });
    expect(r.status).toBe(400);
  });
});

describe('public accept surface', () => {
  it('validates a live token (masked email) and rejects a garbage token', async () => {
    if (!up) return;
    const email = `acc_${uniq()}@example.test`;
    createdEmails.push(email.toLowerCase());
    const { token } = await createInvitation({ applicantId: `appl_${uniq()}`, email, name: 'Accept Tester', invitedByUserId: 'admin-test' });

    const good = await api(`/accept-invitation/${token}`);
    expect(good.status).toBe(200);
    expect(good.data.valid).toBe(true);
    expect(good.data.email).toMatch(/\*\*\*/); // masked
    expect(JSON.stringify(good.data)).not.toContain(token); // never echoes the raw token

    const bad = await api('/accept-invitation/deadbeefdeadbeef');
    expect(bad.status).toBe(404);
    expect(bad.data.valid).toBe(false);
  });

  it('accepts a valid token → creates a loginable account; replay is single-use', async () => {
    if (!up) return;
    const email = `acc2_${uniq()}@example.test`;
    createdEmails.push(email.toLowerCase());
    const { token } = await createInvitation({ applicantId: `appl_${uniq()}`, email, name: 'Login Tester', invitedByUserId: 'admin-test' });

    // Short password rejected on the server (defence in depth).
    const short = await api(`/accept-invitation/${token}/accept`, { method: 'POST', body: { password: 'short', acceptedTerms: true } });
    expect(short.status).toBe(400);

    // Valid accept → 201 + session cookie.
    const password = 'AcceptMe9!secure';
    const acc = await api(`/accept-invitation/${token}/accept`, { method: 'POST', body: { password, name: 'Login Tester', acceptedTerms: true } });
    expect(acc.status).toBe(201);
    expect(acc.data.ok).toBe(true);
    expect(acc.cookie).not.toBe('');
    if (acc.data.user?.id) createdUserIds.push(acc.data.user.id);

    // The new account can log in with the chosen password.
    const login = await api('/auth/login', { method: 'POST', body: { email, password } });
    expect(login.status).toBe(200);

    // Replaying the used token is rejected (single-use).
    const replay = await api(`/accept-invitation/${token}/accept`, { method: 'POST', body: { password, acceptedTerms: true } });
    expect(replay.status).toBe(409);
    expect(replay.data.code).toBe('accepted');
  });

  it('rejects an expired token (410) and a revoked token (410)', async () => {
    if (!up) return;
    // Expired
    const e1 = `exp_${uniq()}@example.test`; createdEmails.push(e1.toLowerCase());
    const exp = await createInvitation({ applicantId: `appl_${uniq()}`, email: e1, invitedByUserId: 'admin-test' });
    await prisma.waitlistInvitation.update({ where: { id: exp.invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expRes = await api(`/accept-invitation/${exp.token}/accept`, { method: 'POST', body: { password: 'AcceptMe9!secure', acceptedTerms: true } });
    expect(expRes.status).toBe(410);

    // Revoked
    const e2 = `rev_${uniq()}@example.test`; createdEmails.push(e2.toLowerCase());
    const rev = await createInvitation({ applicantId: `appl_${uniq()}`, email: e2, invitedByUserId: 'admin-test' });
    await prisma.waitlistInvitation.update({ where: { id: rev.invitation.id }, data: { status: 'revoked', revokedAt: new Date() } });
    const revStatus = await resolveInvitationToken(rev.token);
    expect(revStatus.status).toBe('revoked');
    const revRes = await api(`/accept-invitation/${rev.token}/accept`, { method: 'POST', body: { password: 'AcceptMe9!secure', acceptedTerms: true } });
    expect(revRes.status).toBe(410);
  });
});
