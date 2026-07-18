/**
 * emailStagingRetry.test.js — unit tests for 93.md §6.1: staging email
 * protection (redirect-all / allowlist, production untouched) and the bounded
 * one-retry policy for transient transport errors.
 *
 * nodemailer is MOCKED (the service imports it dynamically, which vi.mock
 * intercepts) so retry behavior is asserted by counting sendMail calls — no
 * sockets, no real sends. usage.js is mocked like tests/unit/emailService.test.js
 * so importing the service never constructs the Prisma client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/utils/usage.js', () => ({
  USAGE: { EMAIL_SENT: 'EMAIL_SENT', EMAIL_FAILED: 'EMAIL_FAILED' },
  recordUsage: () => {},
}));

// Controllable nodemailer mock. NOTE: nodemailer is installed ONLY under
// server/node_modules (the server has its own package.json), so the bare
// specifier 'nodemailer' resolves to a different file id from this test file
// than from server/services/* — the mock must target the RESOLVED entry file
// so it intercepts the service's dynamic `import('nodemailer')`.
const sendMailMock = vi.fn();
vi.mock('../../server/node_modules/nodemailer/lib/nodemailer.js', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

import {
  applyStagingEmailPolicy,
  isProductionEmailEnv,
  isTransientEmailError,
  sendEmail,
  renderWelcomeEmail,
  renderPasswordChangedEmail,
} from '../../server/services/emailService.js';

const EMAIL_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_PROVIDER', 'APP_BASE_URL', 'APP_ENV', 'EMAIL_REDIRECT_ALL_TO', 'EMAIL_ALLOWLIST', 'EMAIL_RETRY_DELAY_MS'];
let saved;
beforeEach(() => {
  saved = {};
  for (const k of EMAIL_ENV) saved[k] = process.env[k];
  for (const k of EMAIL_ENV) delete process.env[k];
  sendMailMock.mockReset();
});
afterEach(() => {
  for (const k of EMAIL_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('isProductionEmailEnv', () => {
  it('APP_ENV wins over NODE_ENV', () => {
    expect(isProductionEmailEnv({ APP_ENV: 'staging', NODE_ENV: 'production' })).toBe(false);
    expect(isProductionEmailEnv({ APP_ENV: 'production', NODE_ENV: 'test' })).toBe(true);
  });
  it('falls back to NODE_ENV', () => {
    expect(isProductionEmailEnv({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionEmailEnv({ NODE_ENV: 'test' })).toBe(false);
    expect(isProductionEmailEnv({})).toBe(false);
  });
});

describe('applyStagingEmailPolicy (93.md §6.1)', () => {
  const msg = { to: 'real.user@hospital.org', subject: 'Hello' };

  it('production is completely untouched even with both vars set', () => {
    const out = applyStagingEmailPolicy(msg, {
      NODE_ENV: 'production',
      EMAIL_REDIRECT_ALL_TO: 'sink@dev.test',
      EMAIL_ALLOWLIST: 'nobody@x.y',
    });
    expect(out).toEqual({ action: 'send', to: msg.to, subject: msg.subject, redirected: false, skipped: [] });
  });

  it('redirects every recipient and prefixes the subject with the original address', () => {
    const out = applyStagingEmailPolicy(msg, { NODE_ENV: 'test', EMAIL_REDIRECT_ALL_TO: 'sink@dev.test' });
    expect(out.action).toBe('send');
    expect(out.to).toBe('sink@dev.test');
    expect(out.subject).toBe('[staging→real.user@hospital.org] Hello');
    expect(out.redirected).toBe(true);
  });

  it('redirect takes precedence over the allowlist', () => {
    const out = applyStagingEmailPolicy(msg, { NODE_ENV: 'test', EMAIL_REDIRECT_ALL_TO: 'sink@dev.test', EMAIL_ALLOWLIST: 'hospital.org' });
    expect(out.to).toBe('sink@dev.test');
    expect(out.redirected).toBe(true);
  });

  it('allowlist keeps exact-address matches (case-insensitive)', () => {
    const out = applyStagingEmailPolicy({ to: 'Dev@Team.Test', subject: 's' }, { NODE_ENV: 'test', EMAIL_ALLOWLIST: 'dev@team.test' });
    expect(out.action).toBe('send');
    expect(out.skipped).toEqual([]);
  });

  it('allowlist keeps domain matches and drops the rest (counted as skipped)', () => {
    const out = applyStagingEmailPolicy(
      { to: 'a@team.test, evil@elsewhere.com, b@sub.team.test', subject: 's' },
      { NODE_ENV: 'test', EMAIL_ALLOWLIST: 'team.test' },
    );
    expect(out.action).toBe('send');
    expect(out.to).toBe('a@team.test, b@sub.team.test');
    expect(out.skipped).toEqual(['evil@elsewhere.com']);
  });

  it('allowlist with NO matching recipient skips the send entirely', () => {
    const out = applyStagingEmailPolicy(msg, { NODE_ENV: 'test', EMAIL_ALLOWLIST: 'team.test, dev@other.io' });
    expect(out.action).toBe('skip');
    expect(out.skipped).toEqual(['real.user@hospital.org']);
  });

  it('neither var set → behavior unchanged', () => {
    const out = applyStagingEmailPolicy(msg, { NODE_ENV: 'test' });
    expect(out).toEqual({ action: 'send', to: msg.to, subject: msg.subject, redirected: false, skipped: [] });
  });
});

describe('isTransientEmailError (93.md §6.1 retry classification)', () => {
  it('connection-class codes are transient', () => {
    for (const code of ['ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'EDNS']) {
      expect(isTransientEmailError({ code })).toBe(true);
    }
  });
  it('SMTP 4xx is transient; 5xx is a permanent reject', () => {
    expect(isTransientEmailError({ responseCode: 421 })).toBe(true);
    expect(isTransientEmailError({ responseCode: 450 })).toBe(true);
    expect(isTransientEmailError({ responseCode: 550 })).toBe(false);
    expect(isTransientEmailError({ responseCode: 554 })).toBe(false);
  });
  it('a 5xx response wins even when a code is also present', () => {
    expect(isTransientEmailError({ code: 'EENVELOPE', responseCode: 550 })).toBe(false);
  });
  it('unknown/absent errors are NOT retried', () => {
    expect(isTransientEmailError(null)).toBe(false);
    expect(isTransientEmailError({})).toBe(false);
    expect(isTransientEmailError({ code: 'ESOMETHINGELSE' })).toBe(false);
  });
});

describe('sendEmail — retry + staging integration (mocked transport)', () => {
  beforeEach(() => {
    process.env.SMTP_HOST = 'smtp.test';
    process.env.EMAIL_FROM = 'PecanRev <no-reply@test>';
    process.env.EMAIL_RETRY_DELAY_MS = '1';
  });

  it('retries ONCE on a transient error, then succeeds', async () => {
    const transient = Object.assign(new Error('connect refused'), { code: 'ECONNECTION' });
    sendMailMock.mockRejectedValueOnce(transient).mockResolvedValueOnce({ messageId: 'ok-2' });
    const r = await sendEmail({ to: 'a@team.test', subject: 'x', text: 'y' });
    expect(r.sent).toBe(true);
    expect(r.id).toBe('ok-2');
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a permanent SMTP reject (5xx)', async () => {
    const permanent = Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 });
    sendMailMock.mockRejectedValue(permanent);
    const r = await sendEmail({ to: 'a@team.test', subject: 'x', text: 'y' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('send_failed');
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the single retry when the transient error persists', async () => {
    const transient = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    sendMailMock.mockRejectedValue(transient);
    const r = await sendEmail({ to: 'a@team.test', subject: 'x', text: 'y' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('send_failed');
    expect(sendMailMock).toHaveBeenCalledTimes(2); // initial + exactly one retry
  });

  it('applies the staging redirect to the actual transport call', async () => {
    process.env.EMAIL_REDIRECT_ALL_TO = 'sink@dev.test';
    sendMailMock.mockResolvedValue({ messageId: 'ok' });
    const r = await sendEmail({ to: 'real@hospital.org', subject: 'Hi', text: 'y' });
    expect(r.sent).toBe(true);
    const call = sendMailMock.mock.calls[0][0];
    expect(call.to).toBe('sink@dev.test');
    expect(call.subject).toBe('[staging→real@hospital.org] Hi');
  });

  it('allowlist dropping every recipient short-circuits without touching the transport', async () => {
    process.env.EMAIL_ALLOWLIST = 'team.test';
    const r = await sendEmail({ to: 'real@hospital.org', subject: 'Hi', text: 'y' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('recipients_skipped');
    expect(r.skipped).toEqual(['real@hospital.org']);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe('93.md §6.3 templates — escaping + content', () => {
  const XSS = '<script>alert(1)</script>';
  it('renderWelcomeEmail escapes the name and carries the first-value steps', () => {
    const { html, text } = renderWelcomeEmail({ toName: XSS, supportEmail: 'support@pecanrev.com' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Create your first project');
    expect(html).toContain('beta');
    expect(html).toContain('support@pecanrev.com');
    expect(text).toContain('first screening decision');
  });
  it('renderPasswordChangedEmail escapes values and explains the wasn\'t-me path', () => {
    const { html, text } = renderPasswordChangedEmail({ toName: '<x>', changedAt: new Date('2030-01-01T12:00:00Z'), supportEmail: 'support@pecanrev.com' });
    expect(html).not.toContain('<x>');
    expect(html).toContain('&lt;x&gt;');
    expect(html).toContain('Your password was changed');
    expect(text).toContain("Didn't do this?");
    expect(text).toContain('support@pecanrev.com');
  });
});
