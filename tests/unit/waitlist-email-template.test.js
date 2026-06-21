/**
 * waitlist-email-template.test.js — the branded confirmation email (prompt48 §6).
 * usage.js is mocked so importing emailService never constructs the Prisma client.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/utils/usage.js', () => ({
  USAGE: { EMAIL_SENT: 'EMAIL_SENT', EMAIL_FAILED: 'EMAIL_FAILED' },
  recordUsage: () => {},
}));

import { renderBetaWaitlistConfirmationEmail } from '../../server/services/emailService.js';

describe('renderBetaWaitlistConfirmationEmail', () => {
  it('returns non-empty html + text', () => {
    const { html, text } = renderBetaWaitlistConfirmationEmail({ firstName: 'Jane' });
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('greets by name and mentions the waitlist', () => {
    const { html, text } = renderBetaWaitlistConfirmationEmail({ firstName: 'Jane' });
    expect(html).toContain('Hi Jane,');
    expect(html.toLowerCase()).toContain('waitlist');
    expect(text.toLowerCase()).toContain('waitlist');
  });

  it('clarifies it is NOT an account/invitation and contains no password or login link', () => {
    const { html, text } = renderBetaWaitlistConfirmationEmail({ firstName: 'Jane' });
    const lc = (html + ' ' + text).toLowerCase();
    expect(lc).toContain('does not create an account');
    expect(lc).toContain('not a beta invitation');
    expect(lc).not.toContain('password');
    expect(lc).not.toContain('/login');
    expect(lc).not.toContain('reset?token');
  });

  it('escapes HTML in the applicant name', () => {
    const { html } = renderBetaWaitlistConfirmationEmail({ firstName: '<script>x</script>' });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to a generic greeting with no name', () => {
    const { html } = renderBetaWaitlistConfirmationEmail({});
    expect(html).toContain('Hello,');
  });
});
