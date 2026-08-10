/**
 * emailUnsubscribe.test.js — the signed opt-out token, the List-Unsubscribe
 * header, the preference blob, and the public /api/email/unsubscribe handler.
 *
 * The prisma client module is mocked so nothing here constructs a real
 * PrismaClient; the blob-semantics tests inject their own fake client directly
 * instead, which keeps them independent of the mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dbUser = { findUnique: vi.fn(), update: vi.fn() };
vi.mock('../../../server/db/client.js', () => ({ prisma: { user: dbUser } }));

import {
  createUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
  unsubscribeHeaders,
  parseEmailPreferences,
  isEmailCategoryEnabled,
  applyEmailPreference,
  setEmailPreference,
  UNSUBSCRIBE_TTL_MS,
  EMAIL_PREFERENCE_MAX_CHARS,
} from '../../../server/services/emailUnsubscribe.js';
import { handleUnsubscribe } from '../../../server/routes/emailPublic.js';

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
  vi.useRealTimers();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function fakeRes() {
  const r = { statusCode: 200, contentType: '', body: '' };
  r.status = (s) => { r.statusCode = s; return r; };
  r.type = (t) => { r.contentType = t; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

describe('unsubscribe token', () => {
  it('round-trips userId + category + issuedAt', () => {
    const token = createUnsubscribeToken({ userId: 'user-1', category: 'welcome' });
    const out = verifyUnsubscribeToken(token);
    expect(out.ok).toBe(true);
    expect(out.payload.userId).toBe('user-1');
    expect(out.payload.category).toBe('welcome');
    expect(typeof out.payload.issuedAt).toBe('number');
  });

  it('rejects a tampered signature, a tampered body, and structural junk', () => {
    const token = createUnsubscribeToken({ userId: 'user-1', category: 'welcome' });
    const [body, sig] = token.split('.');

    // Signature flipped.
    const badSigChar = sig[0] === 'A' ? 'B' : 'A';
    expect(verifyUnsubscribeToken(`${body}.${badSigChar}${sig.slice(1)}`)).toEqual({ ok: false, error: 'invalid' });

    // Body retargeted at another user, original signature kept.
    const forged = Buffer.from(JSON.stringify({ v: 1, userId: 'victim', category: 'welcome', issuedAt: Date.now() })).toString('base64url');
    expect(verifyUnsubscribeToken(`${forged}.${sig}`).ok).toBe(false);

    // Length-mismatched signature must not reach timingSafeEqual.
    expect(verifyUnsubscribeToken(`${body}.short`)).toEqual({ ok: false, error: 'invalid' });
    expect(verifyUnsubscribeToken(`${body}`)).toEqual({ ok: false, error: 'invalid' });
    expect(verifyUnsubscribeToken('')).toEqual({ ok: false, error: 'missing' });
    expect(verifyUnsubscribeToken(null)).toEqual({ ok: false, error: 'missing' });
  });

  it('is domain-separated: a token minted under a different secret never verifies', () => {
    const token = createUnsubscribeToken({ userId: 'user-1', category: 'welcome' });
    process.env.JWT_SECRET = 'a-different-secret';
    expect(verifyUnsubscribeToken(token).ok).toBe(false);
  });

  it('expires after the 30-day TTL', () => {
    expect(UNSUBSCRIBE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const start = Date.UTC(2030, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const token = createUnsubscribeToken({ userId: 'user-1', category: 'welcome' });

    vi.setSystemTime(start + UNSUBSCRIBE_TTL_MS - 1000);
    expect(verifyUnsubscribeToken(token).ok).toBe(true);

    vi.setSystemTime(start + UNSUBSCRIBE_TTL_MS + 1000);
    expect(verifyUnsubscribeToken(token)).toEqual({ ok: false, error: 'expired' });
  });
});

describe('List-Unsubscribe headers', () => {
  it('are emitted for a disableable category and point at the public route', () => {
    const headers = unsubscribeHeaders('user-1', 'welcome');
    expect(Object.keys(headers).sort()).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post']);
    const value = headers['List-Unsubscribe'];
    expect(value.startsWith('<https://app.test/api/email/unsubscribe?token=')).toBe(true);
    expect(value.endsWith('>')).toBe(true);

    const token = decodeURIComponent(value.slice(value.indexOf('token=') + 6, -1));
    expect(verifyUnsubscribeToken(token).payload).toMatchObject({ userId: 'user-1', category: 'welcome' });
  });

  it('advertises RFC 8058 one-click with the exact literal the RFC mandates', () => {
    // Gmail/Outlook show their native Unsubscribe button only when BOTH headers
    // are present, and they POST to the List-Unsubscribe URL. The value is a
    // fixed literal — any drift (spacing, casing, a URL) silently disables the
    // button, which is the failure this pin exists to catch.
    expect(unsubscribeHeaders('user-1', 'welcome')['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('emits the one-click header ONLY together with a real List-Unsubscribe', () => {
    // Advertising one-click on mail that carries no opt-out URL (transactional,
    // or a missing APP_BASE_URL) would promise a button with nothing behind it.
    expect(unsubscribeHeaders('user-1', 'password.reset')['List-Unsubscribe-Post']).toBeUndefined();
    delete process.env.APP_BASE_URL;
    expect(unsubscribeHeaders('user-1', 'welcome')['List-Unsubscribe-Post']).toBeUndefined();
  });

  it('are NEVER emitted for transactional mail', () => {
    for (const key of ['password.reset', 'invite.waitlist', 'password.changed', 'contact.reply']) {
      expect(unsubscribeHeaders('user-1', key)).toEqual({});
    }
    expect(unsubscribeHeaders('user-1', 'not.a.template')).toEqual({});
  });

  it('degrade to no header rather than a broken link when APP_BASE_URL is unset', () => {
    delete process.env.APP_BASE_URL;
    expect(unsubscribeUrl('user-1', 'welcome')).toBe('');
    expect(unsubscribeHeaders('user-1', 'welcome')).toEqual({});
  });
});

describe('preference blob semantics', () => {
  it('parses a stored JSON string and tolerates junk without throwing', () => {
    expect(parseEmailPreferences('{"welcome":false}')).toEqual({ welcome: false });
    expect(parseEmailPreferences({ welcome: true })).toEqual({ welcome: true });
    expect(parseEmailPreferences('not json')).toEqual({});
    expect(parseEmailPreferences('[1,2]')).toEqual({});
    expect(parseEmailPreferences(null)).toEqual({});
    // non-boolean values are discarded, not coerced
    expect(parseEmailPreferences('{"welcome":"nope","x":true}')).toEqual({ x: true });
  });

  it('is opt-OUT: absent means enabled, and transactional is always enabled', () => {
    expect(isEmailCategoryEnabled(null, 'welcome')).toBe(true);
    expect(isEmailCategoryEnabled('{"welcome":false}', 'welcome')).toBe(false);
    expect(isEmailCategoryEnabled('{"welcome":true}', 'welcome')).toBe(true);
    // a blob claiming to disable a transactional email is ignored
    expect(isEmailCategoryEnabled('{"password.reset":false}', 'password.reset')).toBe(true);
  });

  it('merges into the existing blob instead of replacing it, and caps at 500 chars', () => {
    const merged = applyEmailPreference('{"other":true}', 'welcome', false);
    expect(merged.ok).toBe(true);
    expect(JSON.parse(merged.json)).toEqual({ other: true, welcome: false });

    const huge = {};
    for (let i = 0; i < 60; i++) huge[`category-number-${i}`] = true;
    expect(JSON.stringify(huge).length).toBeGreaterThan(EMAIL_PREFERENCE_MAX_CHARS);
    expect(applyEmailPreference(JSON.stringify(huge), 'welcome', false)).toEqual({ ok: false, error: 'too_large' });
  });
});

describe('setEmailPreference', () => {
  const client = (existing) => ({
    user: {
      findUnique: vi.fn().mockResolvedValue(existing === undefined ? null : { emailNotifications: existing }),
      update: vi.fn().mockResolvedValue({}),
    },
  });

  it('writes the merged blob as a JSON string on User.emailNotifications', async () => {
    const db = client('{"other":true}');
    const out = await setEmailPreference('user-1', 'welcome', false, db);
    expect(out).toEqual({ ok: true, preferences: { other: true, welcome: false } });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailNotifications: JSON.stringify({ other: true, welcome: false }) },
    });
  });

  it('can opt back in', async () => {
    const db = client('{"welcome":false}');
    const out = await setEmailPreference('user-1', 'welcome', true, db);
    expect(out.preferences).toEqual({ welcome: true });
  });

  it('refuses to disable a transactional template or an unknown one', async () => {
    const db = client('{}');
    expect(await setEmailPreference('user-1', 'password.reset', false, db)).toEqual({ ok: false, error: 'not_disableable' });
    expect(await setEmailPreference('user-1', 'made.up', false, db)).toEqual({ ok: false, error: 'unknown_category' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('reports a missing user and never throws on a database error', async () => {
    expect(await setEmailPreference('', 'welcome', false, client('{}'))).toEqual({ ok: false, error: 'not_found' });
    expect(await setEmailPreference('ghost', 'welcome', false, client(undefined))).toEqual({ ok: false, error: 'not_found' });

    // What happens TODAY, before W1-B adds the column: prisma rejects the write.
    const broken = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ emailNotifications: null }),
        update: vi.fn().mockRejectedValue(new Error('Unknown arg `emailNotifications`')),
      },
    };
    expect(await setEmailPreference('user-1', 'welcome', false, broken)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('GET /api/email/unsubscribe', () => {
  it('turns off a disableable category and confirms with a self-contained page', async () => {
    dbUser.findUnique.mockResolvedValue({ emailNotifications: null });
    dbUser.update.mockResolvedValue({});

    const res = fakeRes();
    await handleUnsubscribe({ query: { token: createUnsubscribeToken({ userId: 'user-1', category: 'welcome' }) } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe('html');
    expect(res.body).toContain('You have been unsubscribed');
    expect(res.body.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(res.body).not.toContain('<script'); // no SPA, no JS dependency
    expect(dbUser.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailNotifications: JSON.stringify({ welcome: false }) },
    });
  });

  it('400s a token naming a TRANSACTIONAL category, without touching the database', async () => {
    const res = fakeRes();
    await handleUnsubscribe({ query: { token: createUnsubscribeToken({ userId: 'user-1', category: 'password.reset' }) } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('This email cannot be turned off');
    expect(dbUser.update).not.toHaveBeenCalled();
  });

  it('400s a missing, forged, or expired token with distinct copy', async () => {
    const missing = fakeRes();
    await handleUnsubscribe({ query: {} }, missing);
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toContain('This link is not valid');

    const forged = fakeRes();
    await handleUnsubscribe({ query: { token: 'aaaa.bbbb' } }, forged);
    expect(forged.statusCode).toBe(400);

    const start = Date.UTC(2030, 0, 1);
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const token = createUnsubscribeToken({ userId: 'user-1', category: 'welcome' });
    vi.setSystemTime(start + UNSUBSCRIBE_TTL_MS + 1000);
    const expired = fakeRes();
    await handleUnsubscribe({ query: { token } }, expired);
    expect(expired.statusCode).toBe(400);
    expect(expired.body).toContain('This link has expired');
    expect(dbUser.update).not.toHaveBeenCalled();
  });

  it('503s (never 500s) when the preference cannot be saved', async () => {
    dbUser.findUnique.mockResolvedValue({ emailNotifications: null });
    dbUser.update.mockRejectedValue(new Error('Unknown arg `emailNotifications`'));

    const res = fakeRes();
    await handleUnsubscribe({ query: { token: createUnsubscribeToken({ userId: 'user-1', category: 'welcome' }) } }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('We could not save that');
  });
});
