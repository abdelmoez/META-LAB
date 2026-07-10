/**
 * invitationEmail.test.js — unit tests for renderWaitlistInvitationEmail (80.md).
 * usage.js is mocked so importing the email service never constructs Prisma.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../server/utils/usage.js', () => ({
  USAGE: { EMAIL_SENT: 'EMAIL_SENT', EMAIL_FAILED: 'EMAIL_FAILED' },
  recordUsage: () => {},
}));

import { renderWaitlistInvitationEmail } from '../../server/services/emailService.js';

const ENV = ['APP_BASE_URL'];
let saved;
beforeEach(() => { saved = {}; for (const k of ENV) saved[k] = process.env[k]; for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('renderWaitlistInvitationEmail', () => {
  const link = 'https://pecanrev.com/accept-invitation?token=abc123';

  it('returns both html and text, with the exact link in each', () => {
    const { html, text } = renderWaitlistInvitationEmail({ toName: 'Jane', link });
    expect(html).toContain(link);
    expect(text).toContain(link);
    expect(html).toContain('PecanRev');
    expect(text).toContain('PecanRev');
  });

  it('includes a create-password CTA and the personal-link security notice', () => {
    const { html, text } = renderWaitlistInvitationEmail({ toName: 'Jane', link });
    expect(html).toMatch(/create your password/i);
    expect(html).toMatch(/personal to you/i);
    expect(text).toMatch(/personal to you/i);
  });

  it('renders the expiry date when provided', () => {
    const { html, text } = renderWaitlistInvitationEmail({ link, expiresAt: new Date('2026-07-20T10:00:00Z') });
    expect(html).toMatch(/expires on/i);
    expect(text).toMatch(/expires/i);
    expect(html).toContain('2026');
  });

  it('escapes HTML in the recipient name (no injection)', () => {
    const { html } = renderWaitlistInvitationEmail({ toName: '<script>alert(1)</script>', link });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in the link (no attribute-breaking injection)', () => {
    const evil = 'https://x.test/accept-invitation?token=a"><img src=x>';
    const { html } = renderWaitlistInvitationEmail({ link: evil });
    expect(html).not.toContain('"><img src=x>');
    expect(html).toContain('&quot;');
  });

  it('shows a support email when provided', () => {
    const { html, text } = renderWaitlistInvitationEmail({ link, supportEmail: 'help@pecanrev.com' });
    expect(html).toContain('mailto:help@pecanrev.com');
    expect(text).toContain('help@pecanrev.com');
  });

  it('greets generically when no name is given', () => {
    const { html } = renderWaitlistInvitationEmail({ link });
    expect(html).toMatch(/Hello,/);
  });
});
