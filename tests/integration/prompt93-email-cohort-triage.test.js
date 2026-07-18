/**
 * prompt93-email-cohort-triage.test.js — integration tests for 93.md §6.1/§6.3/
 * §9.1/§9.3: invitations-paused 409, cohort persisted + filtered, contact
 * reference + triage PATCH validation, and welcome-email idempotency.
 *
 * Runs against a LIVE server on 127.0.0.1:3001 (or TEST_API_URL). Self-skips
 * (vacuous pass) when the server is unreachable, per this suite's convention —
 * always assert the T1 reachability guard is green. Run serially:
 *   npm run test:integration   (or: vitest run tests/integration/prompt93-email-cohort-triage.test.js)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../server/db/client.js';
import { sendWelcomeEmailOnce } from '../../server/services/invitationService.js';

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

/** Read-merge-write appSettings so tests never clobber unrelated keys. */
async function patchAppSettings(patch) {
  const cur = await api('/admin/settings', { cookie: adminCookie });
  const app = { ...((cur.data && cur.data.appSettings) || {}), ...patch };
  const put = await api('/admin/settings', { method: 'PUT', body: { appSettings: app }, cookie: adminCookie });
  return put.status;
}

const createdEmails = [];
const createdUserIds = [];
const createdMessageIds = [];

beforeAll(async () => {
  try { up = (await fetch(API + '/health')).ok; } catch { up = false; }
  if (up) adminCookie = await loginAdmin();
}, 30000);

afterAll(async () => {
  try {
    // Always leave the pause/cap controls off, whatever a failed test left behind.
    if (up && adminCookie) await patchAppSettings({ invitationsPaused: false, maxActiveInvitations: null });
    for (const id of createdMessageIds) {
      await api(`/admin/contact-messages/${id}`, { method: 'DELETE', cookie: adminCookie }).catch(() => {});
    }
    for (const uid of createdUserIds) {
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

// Seed a public applicant + find its admin-list row (shared helper).
async function seedApplicant() {
  const email = `p93_${uniq()}@example.test`;
  createdEmails.push(email.toLowerCase());
  const sub = await api('/waitlist', { method: 'POST', body: { email, firstName: 'P93', lastName: 'Tester', countryCode: 'US', consent: true } });
  expect([200, 201]).toContain(sub.status);
  const list = await api(`/admin/beta-waitlist/applicants?search=${encodeURIComponent(email)}&limit=5`, { cookie: adminCookie });
  expect(list.status).toBe(200);
  const row = (list.data.rows || []).find((r) => r.email === email);
  expect(row).toBeTruthy();
  return { email, id: row.id };
}

describe('93.md §9.1 — invitationsPaused', () => {
  it('single, resend and bulk invites 409 with INVITATIONS_PAUSED while paused', async () => {
    if (!up) return;
    expect(adminCookie).not.toBe('');
    const { id } = await seedApplicant();

    expect(await patchAppSettings({ invitationsPaused: true })).toBe(200);
    try {
      const inv = await api(`/admin/beta-waitlist/applicants/${id}/invite`, { method: 'POST', body: {}, cookie: adminCookie });
      expect(inv.status).toBe(409);
      expect(inv.data.code).toBe('INVITATIONS_PAUSED');
      expect(inv.data.error).toBe('Invitations are paused');

      const rs = await api(`/admin/beta-waitlist/applicants/${id}/invite/resend`, { method: 'POST', body: {}, cookie: adminCookie });
      expect(rs.status).toBe(409);
      expect(rs.data.code).toBe('INVITATIONS_PAUSED');

      const bulk = await api('/admin/beta-waitlist/invitations/bulk', { method: 'POST', body: { ids: [id] }, cookie: adminCookie });
      expect(bulk.status).toBe(409);
      expect(bulk.data.code).toBe('INVITATIONS_PAUSED');
    } finally {
      expect(await patchAppSettings({ invitationsPaused: false })).toBe(200);
    }

    // After resuming, the same invite goes through.
    const inv2 = await api(`/admin/beta-waitlist/applicants/${id}/invite`, { method: 'POST', body: {}, cookie: adminCookie });
    expect(inv2.status).toBe(200);
  }, 30000);
});

describe('93.md §9.1 — cohort persisted, returned and filterable', () => {
  it('stamps the cohort at invite time and filters both list endpoints by it', async () => {
    if (!up) return;
    const cohort = `itest-${uniq()}`.slice(0, 64);
    const { email, id } = await seedApplicant();

    const inv = await api(`/admin/beta-waitlist/applicants/${id}/invite`, { method: 'POST', body: { cohort }, cookie: adminCookie });
    expect(inv.status).toBe(200);
    expect(['invited', 'invited_no_email', 'email_failed']).toContain(inv.data.result.code);

    // Main-db invitations list: filterable by cohort + returns it (never tokenHash).
    const listInv = await api(`/admin/beta-waitlist/invitations?cohort=${encodeURIComponent(cohort)}`, { cookie: adminCookie });
    expect(listInv.status).toBe(200);
    expect(listInv.data.total).toBe(1);
    const iv = listInv.data.invitations[0];
    expect(iv.cohort).toBe(cohort);
    expect(iv.email).toBe(email);
    expect(iv).not.toHaveProperty('tokenHash');

    // Applicants list: the cohort filter narrows to this applicant.
    const listApp = await api(`/admin/beta-waitlist/applicants?cohort=${encodeURIComponent(cohort)}`, { cookie: adminCookie });
    expect(listApp.status).toBe(200);
    expect(listApp.data.total).toBe(1);
    expect(listApp.data.rows[0].email).toBe(email);
    expect(listApp.data.rows[0].invitation?.cohort).toBe(cohort);

    // An unknown cohort yields an honest empty page — never an error.
    const none = await api(`/admin/beta-waitlist/applicants?cohort=${encodeURIComponent('no-such-cohort-' + uniq())}`, { cookie: adminCookie });
    expect(none.status).toBe(200);
    expect(none.data.total).toBe(0);

    // Server-side validation: an over-long cohort is a 400, not a truncation.
    const long = await api(`/admin/beta-waitlist/applicants/${id}/invite`, { method: 'POST', body: { cohort: 'x'.repeat(65) }, cookie: adminCookie });
    expect(long.status).toBe(400);
    expect(long.data.code).toBe('invalid_cohort');
  }, 30000);
});

describe('93.md §9.3 — contact reference + triage', () => {
  it('returns FB-XXXXXX, stores validated severity, and PATCH triage validates enums', async () => {
    if (!up) return;
    const email = `fb_${uniq()}@example.test`;

    const sub = await api('/contact', { method: 'POST', body: { email, message: 'It broke on step 3', subject: 'Bug', severity: 'high' } });
    expect(sub.status).toBe(200);
    expect(sub.data.ok).toBe(true);
    expect(sub.data.reference).toMatch(/^FB-[A-Z2-7]{6}$/);

    // Invalid severity is DROPPED (public endpoint stays lenient), never a 400.
    const sub2 = await api('/contact', { method: 'POST', body: { email, message: 'second report', severity: 'urgent!!' } });
    expect(sub2.status).toBe(200);
    expect(sub2.data.reference).toMatch(/^FB-/);

    // Admin sees the reference + severity on the stored message.
    const list = await api(`/admin/contact-messages?search=${encodeURIComponent(email)}`, { cookie: adminCookie });
    expect(list.status).toBe(200);
    const messages = (list.data.messages || []).filter((m) => m.email === email);
    expect(messages.length).toBe(2);
    for (const m of messages) createdMessageIds.push(m.id);
    const first = messages.find((m) => m.reference === sub.data.reference);
    expect(first).toBeTruthy();
    expect(first.severity).toBe('high');
    expect(first.triageStatus).toBe('new');
    const second = messages.find((m) => m.reference === sub2.data.reference);
    expect(second.severity).toBeNull();

    // Valid triage PATCH: stamps triagedAt + updates fields.
    const ok = await api(`/admin/contact-messages/${first.id}`, {
      method: 'PATCH',
      body: { triageStatus: 'acknowledged', severity: 'critical', triageNote: 'Repro confirmed on step 3' },
      cookie: adminCookie,
    });
    expect(ok.status).toBe(200);
    expect(ok.data.message.triageStatus).toBe('acknowledged');
    expect(ok.data.message.severity).toBe('critical');
    expect(ok.data.message.triageNote).toBe('Repro confirmed on step 3');
    expect(ok.data.message.triagedAt).toBeTruthy();

    // Invalid enums are 400s.
    const badStatus = await api(`/admin/contact-messages/${first.id}`, { method: 'PATCH', body: { triageStatus: 'bogus' }, cookie: adminCookie });
    expect(badStatus.status).toBe(400);
    const badSeverity = await api(`/admin/contact-messages/${first.id}`, { method: 'PATCH', body: { severity: 'bogus' }, cookie: adminCookie });
    expect(badSeverity.status).toBe(400);

    // Legacy read/archived behavior unchanged.
    const legacy = await api(`/admin/contact-messages/${first.id}`, { method: 'PATCH', body: { archived: true }, cookie: adminCookie });
    expect(legacy.status).toBe(200);
    expect(legacy.data.message.archived).toBe(true);
  }, 30000);
});

describe('93.md §6.3 — welcome email idempotency (service-level, same DB as the server)', () => {
  const SMTP_ENV = ['SMTP_HOST', 'SMTP_PORT', 'EMAIL_FROM', 'EMAIL_RETRY_DELAY_MS'];
  let savedEnv;

  it('claims welcomeEmailSentAt atomically — a second call never re-sends', async () => {
    if (!up) return;
    savedEnv = {};
    for (const k of SMTP_ENV) savedEnv[k] = process.env[k];
    try {
      const email = `welcome_${uniq()}@example.test`;
      createdEmails.push(email.toLowerCase());
      const user = await prisma.user.create({
        data: { email: email.toLowerCase(), password: 'x-not-a-real-hash', name: 'Welcome Tester' },
        select: { id: true },
      });
      createdUserIds.push(user.id);

      // NOT configured → no send AND no claim (a later-configured env can still welcome).
      for (const k of SMTP_ENV) delete process.env[k];
      const unconfigured = await sendWelcomeEmailOnce(user.id);
      expect(unconfigured).toEqual({ sent: false, reason: 'not_configured' });
      let row = await prisma.user.findUnique({ where: { id: user.id }, select: { welcomeEmailSentAt: true } });
      expect(row.welcomeEmailSentAt).toBeNull();

      // "Configured" against a closed local port → the claim happens BEFORE the
      // (failing) send; the flag is burned exactly once (at-most-once semantics).
      process.env.SMTP_HOST = '127.0.0.1';
      process.env.SMTP_PORT = '2';
      process.env.EMAIL_FROM = 'PecanRev <no-reply@test.local>';
      process.env.EMAIL_RETRY_DELAY_MS = '1';

      const first = await sendWelcomeEmailOnce(user.id);
      expect(first.sent).toBe(false); // provider unreachable — but the claim stands
      row = await prisma.user.findUnique({ where: { id: user.id }, select: { welcomeEmailSentAt: true } });
      expect(row.welcomeEmailSentAt).not.toBeNull();
      const stamp = row.welcomeEmailSentAt.getTime();

      const second = await sendWelcomeEmailOnce(user.id);
      expect(second).toEqual({ sent: false, reason: 'already_sent' });
      row = await prisma.user.findUnique({ where: { id: user.id }, select: { welcomeEmailSentAt: true } });
      expect(row.welcomeEmailSentAt.getTime()).toBe(stamp); // untouched — one claim, ever
    } finally {
      for (const k of SMTP_ENV) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    }
  }, 30000);
});
