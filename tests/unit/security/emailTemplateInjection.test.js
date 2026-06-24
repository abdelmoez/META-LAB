/**
 * emailTemplateInjection.test.js — server-side template injection / XSS guard for
 * outbound email (prompt 53, WS4). The email layer uses STATIC backtick templates
 * with values inserted as data + escapeHtml on every interpolation — there is no
 * template engine and no user-controlled template compilation. These tests pin
 * that template-syntax and HTML payloads render INERT (escaped), never evaluated.
 */
import { describe, it, expect } from 'vitest';
import {
  renderReplyEmail,
  renderInviteEmail,
  renderPasswordResetEmail,
  renderEmailVerificationEmail,
  renderBetaWaitlistConfirmationEmail,
} from '../../../server/services/emailService.js';

// Payloads that must NOT be evaluated or rendered as live markup.
const SSTI = ['{{7*7}}', '${7*7}', '<%= 7*7 %>', '#{7*7}', '{% raw %}'];
const XSS = '<script>alert(1)</script>';
const IMG = '<img src=x onerror=alert(1)>';

function assertInert(html) {
  // The security property: escapeHtml turns every injected "<" into "&lt;", so no
  // LIVE markup tag from a payload can appear. (The attribute TEXT like
  // "onerror=alert(1)" may survive, but only inside an inert "&lt;img …&gt;".)
  // The base email layout itself contains no <script>/<img>, so any raw one would
  // be an injection.
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('</script>');
}

describe('email templates render untrusted values inert (WS4)', () => {
  it('reply email escapes recipient name + body (SSTI/XSS payloads)', () => {
    const { html, text } = renderReplyEmail({
      toName: `${XSS}${SSTI.join('')}`,
      bodyText: `${IMG} ${SSTI.join(' ')}`,
      originalSubject: '{{7*7}}',
      fromName: '<b>admin</b>',
    });
    assertInert(html);
    expect(html).toContain('&lt;script&gt;'); // escaped form present
    expect(html).toContain('{{7*7}}');         // template syntax survives as literal text
    // plain-text variant carries no HTML rendering (literal text is fine there)
    expect(typeof text).toBe('string');
  });

  it('invite email escapes project / inviter / role / link', () => {
    const { html } = renderInviteEmail({
      projectName: XSS,
      inviterName: IMG,
      roleLabel: '{{7*7}}',
      link: 'https://app/invite/abc"><script>alert(1)</script>',
    });
    assertInert(html);
    expect(html).toContain('&lt;script&gt;');
  });

  it('password-reset + verification escape name + link', () => {
    for (const render of [renderPasswordResetEmail, renderEmailVerificationEmail]) {
      const { html } = render({ toName: XSS, link: `https://app/x?t=1${IMG}` });
      assertInert(html);
    }
  });

  it('waitlist confirmation escapes first name + support email', () => {
    const { html } = renderBetaWaitlistConfirmationEmail({ firstName: XSS, supportEmail: `a@b.com"><script>` });
    assertInert(html);
    expect(html).toContain('&lt;script&gt;');
  });
});
