/**
 * emailService.test.js — unit tests for the shared email service (prompt14 Task 9).
 *
 * Pure/config functions only — no live server, no DB. usage.js is mocked so
 * importing the service never constructs the Prisma client (the service's only
 * non-pure dependency is recordUsage).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/utils/usage.js', () => ({
  USAGE: { EMAIL_SENT: 'EMAIL_SENT', EMAIL_FAILED: 'EMAIL_FAILED' },
  recordUsage: () => {},
}));

import {
  isEmailConfigured,
  emailStatus,
  sendEmail,
  renderReplyEmail,
  renderContactReplyEmail,
  renderInviteEmail,
  renderPasswordResetEmail,
  renderBaseEmailLayout,
} from '../../server/services/emailService.js';

const EMAIL_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'EMAIL_PROVIDER', 'APP_BASE_URL'];
let saved;
beforeEach(() => { saved = {}; for (const k of EMAIL_ENV) saved[k] = process.env[k]; for (const k of EMAIL_ENV) delete process.env[k]; });
afterEach(() => { for (const k of EMAIL_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('isEmailConfigured', () => {
  it('is false when SMTP_HOST is missing', () => {
    process.env.EMAIL_FROM = 'META·LAB <no-reply@x.com>';
    expect(isEmailConfigured()).toBe(false);
  });
  it('is false when EMAIL_FROM is missing', () => {
    process.env.SMTP_HOST = 'smtp.x.com';
    expect(isEmailConfigured()).toBe(false);
  });
  it('is true only when both SMTP_HOST and EMAIL_FROM are present', () => {
    process.env.SMTP_HOST = 'smtp.x.com';
    process.env.EMAIL_FROM = 'META·LAB <no-reply@x.com>';
    expect(isEmailConfigured()).toBe(true);
  });
  it('treats whitespace-only values as unset', () => {
    process.env.SMTP_HOST = '   ';
    process.env.EMAIL_FROM = 'a@b.c';
    expect(isEmailConfigured()).toBe(false);
  });
});

describe('emailStatus — secret-free snapshot', () => {
  it('reports config as booleans + provider label and NEVER leaks secret values', () => {
    process.env.SMTP_HOST = 'secret-host.internal';
    process.env.SMTP_USER = 'secret-user';
    process.env.SMTP_PASS = 'super-secret-password';
    process.env.EMAIL_FROM = 'META·LAB <no-reply@x.com>';
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.APP_BASE_URL = 'https://app.example.com';

    const s = emailStatus();
    expect(s).toEqual({
      configured: true,
      provider: 'resend',
      smtpHostConfigured: true,
      emailFromConfigured: true,
      smtpAuthConfigured: true,
      appBaseUrlConfigured: true,
    });
    const blob = JSON.stringify(s);
    expect(blob).not.toContain('secret-host.internal');
    expect(blob).not.toContain('secret-user');
    expect(blob).not.toContain('super-secret-password');
  });
  it('defaults provider to "smtp" and flags unconfigured', () => {
    const s = emailStatus();
    expect(s.configured).toBe(false);
    expect(s.provider).toBe('smtp');
    expect(s.smtpAuthConfigured).toBe(false);
  });
});

describe('sendEmail — never throws', () => {
  it('returns { sent:false, reason:"not_configured" } when SMTP is unset', async () => {
    const r = await sendEmail({ to: 'a@b.c', subject: 'hi', text: 'x' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('not_configured');
  });
  it('returns { sent:false, reason:"no_recipient" } when configured but no recipient', async () => {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.EMAIL_FROM = 'a@b.c';
    const r = await sendEmail({ subject: 'hi', text: 'x' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('no_recipient');
  });
  it('catches transport failure and resolves { sent:false } instead of throwing', async () => {
    // Point at a closed local port → fast ECONNREFUSED, no hang, no real send.
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '2';
    process.env.EMAIL_FROM = 'a@b.c';
    const r = await sendEmail({ to: 'a@b.c', subject: 'hi', text: 'x', context: 'test' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('send_failed');
  }, 15000);
});

describe('template escaping — no HTML injection', () => {
  const XSS = '<script>alert(1)</script>';
  it('renderReplyEmail escapes the body', () => {
    const { html, text } = renderReplyEmail({ toName: '<b>n</b>', bodyText: XSS, originalSubject: '"sub"' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;n&lt;/b&gt;'); // toName escaped
    expect(text).toContain(XSS); // plain-text variant is not HTML — raw is fine
  });
  it('renderContactReplyEmail is the same function (alias)', () => {
    expect(renderContactReplyEmail).toBe(renderReplyEmail);
  });
  it('renderInviteEmail escapes project/inviter/role', () => {
    const { html } = renderInviteEmail({
      projectName: '<img src=x onerror=1>',
      inviterName: '"><svg/onload=1>',
      roleLabel: '<i>role</i>',
      link: 'https://app.example.com/invite/abc',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg/onload');
    expect(html).not.toContain('<i>role</i>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('https://app.example.com/invite/abc');
  });
  it('renderPasswordResetEmail escapes name and link', () => {
    const { html, text } = renderPasswordResetEmail({
      toName: '<x>',
      link: 'https://app.example.com/reset?token=a&b=2',
      expiresAt: new Date('2030-01-01T12:00:00Z'),
    });
    expect(html).not.toContain('<x>');
    expect(html).toContain('&lt;x&gt;');
    // '&' in the link is HTML-escaped inside the HTML body…
    expect(html).toContain('token=a&amp;b=2');
    // …but the plain-text variant carries the raw link.
    expect(text).toContain('https://app.example.com/reset?token=a&b=2');
    expect(html).toContain('Reset password'); // CTA present
  });
  it('renderBaseEmailLayout wraps body and escapes the footer app name', () => {
    const html = renderBaseEmailLayout({ appName: '<evil>', bodyHtml: '<div>BODY_MARKER</div>' });
    expect(html).toContain('<div>BODY_MARKER</div>'); // caller-trusted body passed through
    expect(html).not.toContain('<evil>');
    expect(html).toContain('&lt;evil&gt;');
  });
});
