/**
 * sendTemplatedEmail.test.js — the GOVERNED direct-send path in
 * server/services/emailService.js.
 *
 * WHY THIS FILE EXISTS. Before sendTemplatedEmail, only the outbox worker read
 * the EmailTemplate table, so the direct-send call sites (password reset, email
 * verification, contact reply, waitlist confirmation, welcome, password-changed)
 * rendered registry defaults no matter what an admin had saved. The ops console
 * preview showed the edit; the recipient got the old copy; switching 'welcome'
 * off did nothing. Every test below pins one half of that fix, in the order the
 * function applies them:
 *
 *   1. THE OVERRIDE BINDS — subject and body come from EmailTemplate.fieldsJson.
 *   2. THE DISABLE SWITCH BINDS — and only for disableable ('optional') keys, so
 *      nobody can switch off a password reset by editing a row.
 *   3. THE OPT-OUT BINDS — User.emailNotifications suppresses an optional send,
 *      and can never suppress a transactional one.
 *   4. LIST-UNSUBSCRIBE RIDES ALONG — merged OVER caller headers, so a caller
 *      cannot shadow the opt-out link with its own value.
 *   5. HALF-RENDERED MAIL IS NEVER SENT — a missing required variable is a
 *      refusal, not a "[link]" in someone's inbox.
 *   6. IT NEVER THROWS — a database blip degrades to registry copy; it must
 *      never take down the request that triggered the send.
 *
 * The transport is a nodemailer mock, so every assertion is on the exact message
 * handed to the MTA rather than on an intermediate return value — that is the
 * only place where "did the override actually reach the recipient?" is visible.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// vi.hoisted because both factories below are lifted above the imports, and the
// db mock is pulled in during module evaluation (usage.js imports the client at
// load) — a plain const would still be in its temporal dead zone by then.
const { sendMail, createTransport, emailTemplate, user, usageEvent } = vi.hoisted(() => {
  const send = vi.fn(async () => ({ messageId: 'mid-1' }));
  return {
    sendMail: send,
    createTransport: vi.fn(() => ({ sendMail: send })),
    // emailTemplate.findFirst = the admin override row; user.findUnique = the
    // preference blob; usageEvent.create = recordUsage's fire-and-forget write.
    emailTemplate: { findFirst: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => null) },
    usageEvent: { create: vi.fn(async () => ({})) },
  };
});

// nodemailer is installed ONLY under server/node_modules (the server has its own
// package.json), so the bare specifier resolves to a different file id from this
// test than from server/services/* — the mock must name the RESOLVED entry file
// to intercept the service's dynamic import(). Same target as
// tests/unit/emailStagingRetry.test.js.
vi.mock('../../../server/node_modules/nodemailer/lib/nodemailer.js', () => ({ default: { createTransport } }));
vi.mock('../../../server/db/client.js', () => ({ prisma: { emailTemplate, user, usageEvent } }));

import {
  sendTemplatedEmail,
  sendEmail,
  welcomeVariables,
  passwordResetVariables,
  contactReplyVariables,
} from '../../../server/services/emailService.js';

const ENV = ['SMTP_HOST', 'SMTP_PORT', 'EMAIL_FROM', 'APP_BASE_URL', 'JWT_SECRET', 'EMAIL_RETRY_DELAY_MS'];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV) saved[k] = process.env[k];
  process.env.SMTP_HOST = 'smtp.test';
  process.env.EMAIL_FROM = 'PecanRev <no-reply@pecanrev.test>';
  process.env.APP_BASE_URL = 'https://app.test';
  process.env.JWT_SECRET = 'unit-test-secret';
  process.env.EMAIL_RETRY_DELAY_MS = '1';
  sendMail.mockReset().mockResolvedValue({ messageId: 'mid-1' });
  createTransport.mockClear();
  emailTemplate.findFirst.mockReset().mockResolvedValue(null);
  user.findUnique.mockReset().mockResolvedValue(null);
  usageEvent.create.mockReset().mockResolvedValue({});
});

afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/** The single message handed to the transport. */
const message = () => sendMail.mock.calls[0][0];

/** An EmailTemplate row for `key` with `fields` as its saved override. */
function overrideRow(key, fields, enabled = true) {
  return { id: `tpl-${key}`, templateKey: key, fieldsJson: JSON.stringify(fields), enabled, createdAt: new Date('2026-01-01') };
}

describe('sendTemplatedEmail — the admin copy override', () => {
  it('renders with EmailTemplate.fieldsJson, so an edit reaches the recipient', async () => {
    emailTemplate.findFirst.mockResolvedValue(overrideRow('welcome', {
      subject: 'Your [appName] workspace is ready',
      heading: 'Edited heading',
      bodyParagraphs: ['Edited first paragraph.'],
    }));

    const r = await sendTemplatedEmail({
      templateKey: 'welcome',
      variables: welcomeVariables({ toName: 'Jane' }),
      to: 'jane@test.org',
    });

    expect(r.sent).toBe(true);
    const msg = message();
    expect(msg.subject).toBe('Your PecanRev workspace is ready');
    expect(msg.html).toContain('Edited heading');
    expect(msg.html).toContain('Edited first paragraph.');
    // The registry default is gone, not merely appended to.
    expect(msg.html).not.toContain('Welcome to the PecanRev beta');
    expect(msg.text).toContain('Edited first paragraph.');
  });

  it('reads the override deterministically — oldest row wins when a key is duplicated', async () => {
    // EmailTemplate has no unique index on templateKey. Without an explicit
    // order, two rows for one key make "which copy did the user get?"
    // database-dependent — the same edit could send different mail on SQLite and
    // Postgres. createdAt:asc pins it to the row the editor has been updating.
    await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org' });
    expect(emailTemplate.findFirst).toHaveBeenCalledWith({
      where: { templateKey: 'welcome' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('falls back to registry copy when there is no override row', async () => {
    await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({ toName: 'Jane' }), to: 'a@test.org' });
    expect(message().subject).toBe('Welcome to the PecanRev beta');
    expect(message().html).toContain('Hi Jane,');
  });

  it('ignores a junk fieldsJson blob instead of sending a blank email', async () => {
    emailTemplate.findFirst.mockResolvedValue({ ...overrideRow('welcome', {}), fieldsJson: '{not json' });
    await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org' });
    expect(message().subject).toBe('Welcome to the PecanRev beta');
  });

  it('an explicit subject (operator-composed mail) wins over the rendered one', async () => {
    // The contact-reply subject is typed per message by staff; it is not
    // template copy and must survive.
    await sendTemplatedEmail({
      templateKey: 'contact.reply',
      variables: contactReplyVariables({ bodyText: 'hello', originalSubject: 'Licensing' }),
      to: 'a@test.org',
      subject: 'Re: Licensing (follow-up)',
    });
    expect(message().subject).toBe('Re: Licensing (follow-up)');
  });
});

describe('sendTemplatedEmail — the disable switch', () => {
  it('sends NOTHING when a disableable template is switched off', async () => {
    emailTemplate.findFirst.mockResolvedValue(overrideRow('welcome', {}, false));

    const r = await sendTemplatedEmail({
      templateKey: 'welcome',
      variables: welcomeVariables({}),
      to: 'a@test.org',
      recipientUserId: 'user-1',
    });

    expect(r).toEqual({ sent: false, skipped: true, reason: 'template_disabled' });
    expect(sendMail).not.toHaveBeenCalled();
    // Skipped BEFORE rendering and before the preference read: a disabled
    // template should cost nothing.
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('cannot switch off a TRANSACTIONAL template, whatever the row says', async () => {
    emailTemplate.findFirst.mockResolvedValue(overrideRow('password.reset', {}, false));
    const r = await sendTemplatedEmail({
      templateKey: 'password.reset',
      variables: passwordResetVariables({ link: 'https://app.test/reset?token=t' }),
      to: 'a@test.org',
    });
    expect(r.sent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('sendTemplatedEmail — the recipient opt-out', () => {
  it('skips an optional send for a user who unsubscribed', async () => {
    user.findUnique.mockResolvedValue({ emailNotifications: '{"welcome":false}' });

    const r = await sendTemplatedEmail({
      templateKey: 'welcome',
      variables: welcomeVariables({}),
      to: 'a@test.org',
      recipientUserId: 'user-1',
    });

    expect(r).toEqual({ sent: false, skipped: true, reason: 'unsubscribed' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('is opt-OUT: an absent or unrelated preference still sends', async () => {
    user.findUnique.mockResolvedValue({ emailNotifications: '{"chat.digest":false}' });
    const r = await sendTemplatedEmail({
      templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org', recipientUserId: 'user-1',
    });
    expect(r.sent).toBe(true);
  });

  it('never lets the blob suppress a transactional send, and never reads it', async () => {
    user.findUnique.mockResolvedValue({ emailNotifications: '{"password.reset":false}' });
    const r = await sendTemplatedEmail({
      templateKey: 'password.reset',
      variables: passwordResetVariables({ link: 'https://app.test/reset?token=t' }),
      to: 'a@test.org',
      recipientUserId: 'user-1',
    });
    expect(r.sent).toBe(true);
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('sends when the preference read fails — a blip must not silence mail', async () => {
    user.findUnique.mockRejectedValue(new Error('no such column: emailNotifications'));
    const r = await sendTemplatedEmail({
      templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org', recipientUserId: 'user-1',
    });
    expect(r.sent).toBe(true);
  });
});

describe('sendTemplatedEmail — unsubscribe headers', () => {
  it('attaches both RFC 8058 headers to an optional send with a known user', async () => {
    await sendTemplatedEmail({
      templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org', recipientUserId: 'user-1',
    });
    const { headers } = message();
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/app\.test\/api\/email\/unsubscribe\?token=.+>$/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('merges OVER caller headers — a caller cannot shadow the opt-out link', async () => {
    await sendTemplatedEmail({
      templateKey: 'welcome',
      variables: welcomeVariables({}),
      to: 'a@test.org',
      recipientUserId: 'user-1',
      headers: { 'X-PecanRev-Trace': 'abc', 'List-Unsubscribe': '<https://evil.test/keep-sending>' },
    });
    const { headers } = message();
    expect(headers['X-PecanRev-Trace']).toBe('abc');
    expect(headers['List-Unsubscribe']).toContain('https://app.test/api/email/unsubscribe');
  });

  it('attaches no unsubscribe header to transactional mail, but keeps caller headers', async () => {
    await sendTemplatedEmail({
      templateKey: 'password.reset',
      variables: passwordResetVariables({ link: 'https://app.test/reset?token=t' }),
      to: 'a@test.org',
      recipientUserId: 'user-1',
      headers: { 'X-PecanRev-Trace': 'abc' },
    });
    expect(message().headers).toEqual({ 'X-PecanRev-Trace': 'abc' });
  });

  it('sends with no headers at all when there is nothing to attach', async () => {
    await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org' });
    expect(message().headers).toBeUndefined();
  });
});

describe('sendTemplatedEmail — refusals that are not failures of nerve', () => {
  it('refuses to send a half-rendered email and names the missing variable', async () => {
    const r = await sendTemplatedEmail({
      templateKey: 'password.reset',
      variables: passwordResetVariables({ toName: 'Jane' }), // no link
      to: 'a@test.org',
    });
    expect(r).toEqual({ sent: false, reason: 'render_failed', missingRequired: ['link'] });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('reports an unknown template key instead of throwing into the caller', async () => {
    const r = await sendTemplatedEmail({ templateKey: 'not.a.template', to: 'a@test.org' });
    expect(r).toEqual({ sent: false, reason: 'unknown_template' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('degrades to registry copy when the override read fails', async () => {
    emailTemplate.findFirst.mockRejectedValue(new Error('database is locked'));
    const r = await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org' });
    expect(r.sent).toBe(true);
    expect(message().subject).toBe('Welcome to the PecanRev beta');
  });

  it('passes the transport failure through unchanged (never throws)', async () => {
    const err = new Error('550 mailbox unavailable');
    err.responseCode = 550;
    sendMail.mockRejectedValue(err);
    const r = await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org' });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('send_failed');
    expect(r.permanent).toBe(true);
  });

  it('defaults the usage context to the template key', async () => {
    await sendTemplatedEmail({ templateKey: 'welcome', variables: welcomeVariables({}), to: 'a@test.org' });
    const meta = JSON.parse(usageEvent.create.mock.calls[0][0].data.meta);
    expect(meta.context).toBe('welcome');
  });
});

describe('sendEmail — the permanent/transient contract for the queue', () => {
  it('marks an SMTP 5xx reject permanent, so a queue never re-sends it', async () => {
    const err = new Error('550 mailbox unavailable');
    err.responseCode = 550;
    sendMail.mockRejectedValue(err);

    const r = await sendEmail({ to: 'a@test.org', subject: 's', text: 't' });
    expect(r).toMatchObject({ sent: false, reason: 'send_failed', permanent: true });
    // Permanent means it was not retried in-function either.
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('marks a dropped connection transient, so a queue retries it', async () => {
    const err = new Error('socket hang up');
    err.code = 'ECONNRESET';
    sendMail.mockRejectedValue(err);

    const r = await sendEmail({ to: 'a@test.org', subject: 's', text: 't' });
    expect(r).toMatchObject({ sent: false, reason: 'send_failed', permanent: false });
    expect(sendMail).toHaveBeenCalledTimes(2); // the one bounded in-function retry
  });

  it('marks an SMTP 4xx temporary rejection transient', async () => {
    const err = new Error('451 try again later');
    err.responseCode = 451;
    sendMail.mockRejectedValue(err);
    expect((await sendEmail({ to: 'a@test.org', subject: 's', text: 't' })).permanent).toBe(false);
  });

  it('does not put a permanent flag on the non-attempt early-outs', async () => {
    // not_configured / no_recipient never touched a transport, so there is no
    // transport verdict to report — claiming one would be a guess.
    expect(await sendEmail({ subject: 's' })).toEqual({ sent: false, reason: 'no_recipient' });
    delete process.env.SMTP_HOST;
    expect(await sendEmail({ to: 'a@test.org', subject: 's' })).toEqual({ sent: false, reason: 'not_configured' });
  });
});
