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
 * @param {{to:string, subject:string, html?:string, text?:string}} opts
 * @returns {Promise<{sent:boolean, id?:string, reason?:string, error?:string}>}
 */
export async function sendEmail({ to, subject, html, text } = {}) {
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

    return { sent: true, id: info?.messageId || null };
  } catch (err) {
    console.error('[emailService] sendMail failed:', err.message);
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
