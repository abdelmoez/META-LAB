/**
 * emailService.js — outbound email for the META·LAB ops console (prompt4 Task 4).
 *
 * Configuration is environment-driven. When SMTP is not configured (or nodemailer
 * cannot be loaded), sendEmail NEVER throws — it returns { sent:false, reason }
 * so callers can persist a draft and surface a "not configured" notice instead of
 * a 500. This keeps the console fully usable in dev/preview environments.
 *
 * Env vars:
 *   EMAIL_PROVIDER  — informational label (e.g. "smtp", "resend", "sendgrid"). Optional.
 *   SMTP_HOST       — SMTP server host. Required to actually send.
 *   SMTP_PORT       — SMTP port (default 587).
 *   SMTP_USER       — SMTP auth username. Optional (some relays allow unauthenticated).
 *   SMTP_PASS       — SMTP auth password. Optional.
 *   EMAIL_FROM      — From header, e.g. "META·LAB <no-reply@metalab.app>". Required to send.
 *   APP_BASE_URL    — public base URL, used in email footer links. Optional.
 */

import { recordUsage, USAGE } from '../utils/usage.js';
// NOTE on imports: usage.js imports ONLY the prisma client — no controller or
// service imports — so this cannot create a circular dependency.

function env(key) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : '';
}

/**
 * isEmailConfigured — true only when the minimum required env is present to send.
 * @returns {boolean}
 */
export function isEmailConfigured() {
  return Boolean(env('SMTP_HOST') && env('EMAIL_FROM'));
}

/**
 * sendEmail — send a single email. Never throws.
 * Records an EMAIL_SENT / EMAIL_FAILED UsageEvent (prompt9, best-effort) for
 * every REAL send attempt — the not_configured / no_recipient early-outs are
 * not attempts and are not counted (dev environments without SMTP would
 * otherwise flood EMAIL_FAILED).
 * @param {{to:string, subject:string, html?:string, text?:string, context?:string}} opts
 *        `context` is an optional metrics label (e.g. 'invite', 'contact_reply').
 * @returns {Promise<{sent:boolean, id?:string, reason?:string, error?:string}>}
 */
export async function sendEmail({ to, subject, html, text, context } = {}) {
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }
  if (!to) {
    return { sent: false, reason: 'no_recipient' };
  }

  let nodemailer;
  try {
    const mod = await import('nodemailer');
    nodemailer = mod.default || mod;
  } catch (err) {
    console.error('[emailService] nodemailer import failed:', err.message);
    return { sent: false, reason: 'not_configured', error: err.message };
  }

  try {
    const port = parseInt(env('SMTP_PORT'), 10) || 587;
    const user = env('SMTP_USER');
    const pass = env('SMTP_PASS');

    const transport = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port,
      secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
      ...(user || pass ? { auth: { user, pass } } : {}),
    });

    const info = await transport.sendMail({
      from: env('EMAIL_FROM'),
      to,
      subject: subject || '(no subject)',
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
    });

    recordUsage({ type: USAGE.EMAIL_SENT, meta: { context: context || null } });
    return { sent: true, id: info?.messageId || null };
  } catch (err) {
    console.error('[emailService] sendMail failed:', err.message);
    recordUsage({ type: USAGE.EMAIL_FAILED, meta: { context: context || null, error: err.message } });
    return { sent: false, reason: 'send_failed', error: err.message };
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * renderReplyEmail — build a clean, professional META·LAB-styled reply email.
 * Returns both an HTML body (inline styles, dark-on-light) and a plain-text fallback.
 *
 * @param {{appName?:string, toName?:string, bodyText:string, originalSubject?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function renderReplyEmail({ appName = 'META·LAB', toName = '', bodyText = '', originalSubject = '' } = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const safeBodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br>');
  const appBase = env('APP_BASE_URL');
  const year = new Date().getFullYear();

  const refLine = originalSubject
    ? `<div style="font-size:12px;color:#6b7280;margin-bottom:18px;">In reply to: ${escapeHtml(originalSubject)}</div>`
    : '';

  const footerLink = appBase
    ? `<a href="${escapeHtml(appBase)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(appBase)}</a>`
    : `${escapeHtml(appName)}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:22px 32px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:#111827;">META&#183;LAB</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          ${refLine}
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:16px;">${escapeHtml(greeting)}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;">${safeBodyHtml}</div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;background:#fafafa;">
          <div style="font-size:12px;color:#9ca3af;line-height:1.5;">
            Sent by the ${escapeHtml(appName)} team &#183; ${footerLink}<br>
            &#169; ${year} ${escapeHtml(appName)}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textParts = [];
  if (originalSubject) textParts.push(`In reply to: ${originalSubject}`, '');
  textParts.push(toName ? `Hi ${toName},` : 'Hello,', '', bodyText, '', '—', `Sent by the ${appName} team`);
  if (appBase) textParts.push(appBase);
  const text = textParts.join('\n');

  return { html, text };
}

/**
 * renderInviteEmail — build the META·LAB-styled project invite email (prompt9).
 * Same 600px white-card table layout as renderReplyEmail; inline hex styles are
 * the correct convention for email HTML (CSS variables don't work in clients).
 * Every interpolated value is escaped. The link carries the single-use invite
 * token — the email body never mentions account existence or permissions
 * beyond the role label.
 *
 * @param {{appName?:string, projectName?:string, inviterName?:string,
 *          roleLabel?:string, link:string, expiresAt?:Date|string|null}} opts
 * @returns {{html:string, text:string}}
 */
export function renderInviteEmail({
  appName = 'META·LAB',
  projectName = '',
  inviterName = '',
  roleLabel = '',
  link = '',
  expiresAt = null,
} = {}) {
  const safeProject = escapeHtml(projectName || 'a research project');
  const safeInviter = escapeHtml(inviterName || 'A project manager');
  const safeRole = escapeHtml(roleLabel || 'member');
  const safeLink = escapeHtml(link);
  const appBase = env('APP_BASE_URL');
  const year = new Date().getFullYear();

  let expiryDateText = '';
  if (expiresAt) {
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isNaN(d.getTime())) {
      expiryDateText = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  const expiryHtml = expiryDateText
    ? `<div style="font-size:12px;color:#6b7280;margin-top:18px;">This invitation expires on ${escapeHtml(expiryDateText)}. If it has expired, ask ${safeInviter} to send a new one.</div>`
    : '';

  const footerLink = appBase
    ? `<a href="${escapeHtml(appBase)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(appBase)}</a>`
    : `${escapeHtml(appName)}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:22px 32px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:#111827;">META&#183;LAB</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;">
          <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:14px;">You&#39;ve been invited to a research project</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:8px;">
            ${safeInviter} has invited you to join <strong>&#8220;${safeProject}&#8221;</strong> on ${escapeHtml(appName)} as <strong>${safeRole}</strong>.
          </div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:24px;">
            Accept the invitation to start collaborating on screening, data extraction and analysis with the project team.
          </div>
          <!-- CTA -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:8px;background:#6366f1;">
              <a href="${safeLink}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Accept invitation</a>
            </td></tr>
          </table>
          <div style="font-size:12px;color:#6b7280;margin-top:22px;line-height:1.6;">
            If the button doesn&#39;t work, copy and paste this link into your browser:<br>
            <a href="${safeLink}" style="color:#6366f1;text-decoration:none;word-break:break-all;">${safeLink}</a>
          </div>
          ${expiryHtml}
          <div style="font-size:12px;color:#9ca3af;margin-top:18px;line-height:1.5;">
            If you weren&#39;t expecting this invitation, you can safely ignore this email.
          </div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;background:#fafafa;">
          <div style="font-size:12px;color:#9ca3af;line-height:1.5;">
            Sent by the ${escapeHtml(appName)} team &#183; ${footerLink}<br>
            &#169; ${year} ${escapeHtml(appName)}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textParts = [
    `You've been invited to a research project`,
    '',
    `${inviterName || 'A project manager'} has invited you to join "${projectName || 'a research project'}" on ${appName} as ${roleLabel || 'member'}.`,
    '',
    `Accept the invitation: ${link}`,
  ];
  if (expiryDateText) textParts.push('', `This invitation expires on ${expiryDateText}.`);
  textParts.push('', `If you weren't expecting this invitation, you can safely ignore this email.`, '', '—', `Sent by the ${appName} team`);
  if (appBase) textParts.push(appBase);
  const text = textParts.join('\n');

  return { html, text };
}
