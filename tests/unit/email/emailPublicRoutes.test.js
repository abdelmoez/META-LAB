/**
 * emailPublicRoutes.test.js — 112 r2. The GET/POST split of the public
 * unsubscribe endpoint:
 *
 *   · GET is SAFE (RFC 9110): it renders a confirmation form and NEVER writes —
 *     the URL is advertised in List-Unsubscribe headers and mail-security
 *     scanners prefetch every GET, so a state-changing GET would let a robot
 *     silently unsubscribe users;
 *   · POST (the form submit, and RFC 8058 one-click POSTs) performs the flip;
 *   · both verbs share the token + optional-category gate (transactional → 400).
 *
 * handleUnsubscribe's own flip semantics are covered in emailUnsubscribe.test.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbUser = { findUnique: vi.fn(), update: vi.fn() };
vi.mock('../../../server/db/client.js', () => ({ prisma: { user: dbUser } }));

import { createUnsubscribeToken } from '../../../server/services/emailUnsubscribe.js';
import { handleUnsubscribePage, handleUnsubscribe } from '../../../server/routes/emailPublic.js';

const ENV = ['JWT_SECRET', 'APP_BASE_URL'];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  process.env.JWT_SECRET = 'unit-test-secret';
  process.env.APP_BASE_URL = 'https://app.test';
  dbUser.findUnique.mockReset();
  dbUser.update.mockReset();
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function fakeRes() {
  const r = { statusCode: 200, contentType: '', body: '' };
  r.status = (s) => { r.statusCode = s; return r; };
  r.type = (t) => { r.contentType = t; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

describe('GET /api/email/unsubscribe (handleUnsubscribePage)', () => {
  it('renders a confirmation form and performs NO write', async () => {
    const res = fakeRes();
    await handleUnsubscribePage({ query: { token: createUnsubscribeToken({ userId: 'u1', category: 'welcome' }) } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<form method="post"');
    expect(res.body).toContain('Unsubscribe');
    expect(dbUser.findUnique).not.toHaveBeenCalled();
    expect(dbUser.update).not.toHaveBeenCalled();
  });

  it('400s a garbage token without a form', async () => {
    const res = fakeRes();
    await handleUnsubscribePage({ query: { token: 'aaaa.bbbb' } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('<form');
    expect(dbUser.update).not.toHaveBeenCalled();
  });

  it('400s a transactional category without a form', async () => {
    const res = fakeRes();
    await handleUnsubscribePage({ query: { token: createUnsubscribeToken({ userId: 'u1', category: 'password.reset' }) } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('<form');
  });
});

describe('POST /api/email/unsubscribe (handleUnsubscribe)', () => {
  it('flips the preference (the one verb allowed to write)', async () => {
    dbUser.findUnique.mockResolvedValue({ emailNotifications: null });
    dbUser.update.mockResolvedValue({});
    const res = fakeRes();
    await handleUnsubscribe({ query: { token: createUnsubscribeToken({ userId: 'u1', category: 'welcome' }) } }, res);
    expect(res.statusCode).toBe(200);
    expect(dbUser.update).toHaveBeenCalledTimes(1);
    const blob = JSON.parse(dbUser.update.mock.calls[0][0].data.emailNotifications);
    expect(blob.welcome).toBe(false);
  });
});
