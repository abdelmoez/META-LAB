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
 *   EMAIL_FROM      — From header, e.g. "PecanRev <no-reply@pecanrev.com>". Required to send.
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
 * emailStatus — a SECRET-FREE snapshot of the mail configuration for the ops
 * console (prompt14 Task 5). Returns only booleans + the informational provider
 * label — NEVER the SMTP host, user, password, or from-address values, so it is
 * safe to ship to the admin/mod UI and over the API.
 * @returns {{configured:boolean, provider:string, smtpHostConfigured:boolean,
 *   emailFromConfigured:boolean, smtpAuthConfigured:boolean, appBaseUrlConfigured:boolean}}
 */
export function emailStatus() {
  return {
    configured: isEmailConfigured(),
    provider: env('EMAIL_PROVIDER') || 'smtp',
    smtpHostConfigured: Boolean(env('SMTP_HOST')),
    emailFromConfigured: Boolean(env('EMAIL_FROM')),
    smtpAuthConfigured: Boolean(env('SMTP_USER') || env('SMTP_PASS')),
    appBaseUrlConfigured: Boolean(env('APP_BASE_URL')),
  };
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
 * renderBaseEmailLayout — the shared META·LAB email chrome (prompt14): the 600px
 * white card with the wordmark header and the footer link, into which each
 * template injects its inner body HTML. Inline hex styles are intentional — CSS
 * variables / external stylesheets don't work in mail clients. The caller is
 * responsible for escaping every value inside `bodyHtml`.
 *
 * @param {{appName?:string, bodyHtml:string}} opts
 * @returns {string} full HTML document
 */
export function renderBaseEmailLayout({ appName = 'PecanRev', bodyHtml = '' } = {}) {
  const appBase = env('APP_BASE_URL');
  const year = new Date().getFullYear();
  const footerLink = appBase
    ? `<a href="${escapeHtml(appBase)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(appBase)}</a>`
    : `${escapeHtml(appName)}`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:22px 32px;border-bottom:1px solid #e5e7eb;">
          <span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:#111827;">PecanRev</span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px 32px;">
${bodyHtml}
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
}

/** Shared inline-styled CTA button (escaped href + label). */
function ctaButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:8px;background:#6366f1;">
              <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
            </td></tr>
          </table>`;
}

/**
 * renderReplyEmail — clean, professional META·LAB-styled reply email.
 * Returns both an HTML body and a plain-text fallback.
 *
 * @param {{appName?:string, toName?:string, bodyText:string, originalSubject?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function renderReplyEmail({ appName = 'PecanRev', toName = '', bodyText = '', originalSubject = '', fromName = '' } = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const safeBodyHtml = escapeHtml(bodyText).replace(/\n/g, '<br>');
  const appBase = env('APP_BASE_URL');

  const refLine = originalSubject
    ? `<div style="font-size:12px;color:#6b7280;margin-bottom:18px;">In reply to: ${escapeHtml(originalSubject)}</div>`
    : '';

  // The signature shows the NAME of the staff member who wrote this — never their email
  // address (which is the shared no-reply mailbox). Falls back to the team name.
  const signoff = fromName
    ? `<div style="font-size:14px;color:#1f2937;line-height:1.6;margin-top:22px;">Best regards,<br><strong>${escapeHtml(fromName)}</strong><br><span style="color:#6b7280;">${escapeHtml(appName)} team</span></div>`
    : `<div style="font-size:14px;color:#6b7280;line-height:1.6;margin-top:22px;">— The ${escapeHtml(appName)} team</div>`;

  const bodyHtml = `          ${refLine}
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:16px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;">${safeBodyHtml}</div>
          ${signoff}`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });

  const textParts = [];
  if (originalSubject) textParts.push(`In reply to: ${originalSubject}`, '');
  textParts.push(toName ? `Hi ${toName},` : 'Hello,', '', bodyText, '', fromName ? `Best regards,\n${fromName}\n${appName} team` : `— The ${appName} team`);
  if (appBase) textParts.push(appBase);
  const text = textParts.join('\n');

  return { html, text };
}

/**
 * renderContactReplyEmail — explicit alias for renderReplyEmail (prompt14 names
 * the contract this way). Same output; kept as a stable export so call sites can
 * use either name.
 */
export const renderContactReplyEmail = renderReplyEmail;

/**
 * renderPasswordResetEmail — META·LAB-styled password-reset email (prompt14 Task 4).
 * The link carries the single-use reset token; the body never reveals account
 * details. Every interpolated value is escaped. Returns HTML + plain text.
 *
 * @param {{appName?:string, toName?:string, link:string,
 *          expiresAt?:Date|string|null, initiatedByOperator?:boolean}} opts
 * @returns {{html:string, text:string}}
 */
export function renderPasswordResetEmail({
  appName = 'PecanRev',
  toName = '',
  link = '',
  expiresAt = null,
  initiatedByOperator = false,
} = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const appBase = env('APP_BASE_URL');

  let expiryText = '';
  if (expiresAt) {
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isNaN(d.getTime())) {
      expiryText = d.toLocaleString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }
  }
  const expiryHtml = expiryText
    ? `<div style="font-size:12px;color:#6b7280;margin-top:18px;">This link expires on ${escapeHtml(expiryText)}. After that, request a new one.</div>`
    : '';

  const intro = initiatedByOperator
    ? `A ${escapeHtml(appName)} administrator started a password reset for your account.`
    : `We received a request to reset the password for your ${escapeHtml(appName)} account.`;

  const bodyHtml = `          <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:14px;">Reset your password</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:24px;">
            ${intro} Click the button below to choose a new password.
          </div>
          ${ctaButton(link, 'Reset password')}
          <div style="font-size:12px;color:#6b7280;margin-top:22px;line-height:1.6;">
            If the button doesn&#39;t work, copy and paste this link into your browser:<br>
            <a href="${escapeHtml(link)}" style="color:#6366f1;text-decoration:none;word-break:break-all;">${escapeHtml(link)}</a>
          </div>
          ${expiryHtml}
          <div style="font-size:12px;color:#9ca3af;margin-top:18px;line-height:1.5;">
            If you didn&#39;t request this, you can safely ignore this email &#8212; your password won&#39;t change.
          </div>`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });

  const textParts = [
    'Reset your password',
    '',
    toName ? `Hi ${toName},` : 'Hello,',
    '',
    initiatedByOperator
      ? `A ${appName} administrator started a password reset for your account.`
      : `We received a request to reset the password for your ${appName} account.`,
    '',
    `Reset your password: ${link}`,
  ];
  if (expiryText) textParts.push('', `This link expires on ${expiryText}.`);
  textParts.push('', `If you didn't request this, you can safely ignore this email — your password won't change.`, '', '—', `Sent by the ${appName} team`);
  if (appBase) textParts.push(appBase);
  const text = textParts.join('\n');

  return { html, text };
}

/**
 * renderEmailVerificationEmail — META·LAB-styled email-verification email (prompt26).
 * The link carries the single-use verify token; every value is escaped.
 * @param {{appName?:string, toName?:string, link:string, expiresAt?:Date|string|null}} opts
 * @returns {{html:string, text:string}}
 */
export function renderEmailVerificationEmail({ appName = 'PecanRev', toName = '', link = '', expiresAt = null } = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const appBase = env('APP_BASE_URL');

  let expiryText = '';
  if (expiresAt) {
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (!Number.isNaN(d.getTime())) {
      expiryText = d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
  const expiryHtml = expiryText
    ? `<div style="font-size:12px;color:#6b7280;margin-top:18px;">This link expires on ${escapeHtml(expiryText)}. After that, request a new one.</div>`
    : '';

  const bodyHtml = `          <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:14px;">Confirm your email</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:24px;">
            Welcome to ${escapeHtml(appName)}. Confirm your email address to activate your research workspace.
          </div>
          ${ctaButton(link, 'Verify email')}
          <div style="font-size:12px;color:#6b7280;margin-top:22px;line-height:1.6;">
            If the button doesn&#39;t work, copy and paste this link into your browser:<br>
            <a href="${escapeHtml(link)}" style="color:#6366f1;text-decoration:none;word-break:break-all;">${escapeHtml(link)}</a>
          </div>
          ${expiryHtml}
          <div style="font-size:12px;color:#9ca3af;margin-top:18px;line-height:1.5;">
            If you didn&#39;t create this account, you can safely ignore this email.
          </div>`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });
  const textParts = [
    'Confirm your email', '', toName ? `Hi ${toName},` : 'Hello,', '',
    `Welcome to ${appName}. Confirm your email to activate your workspace.`, '',
    `Verify your email: ${link}`,
  ];
  if (expiryText) textParts.push('', `This link expires on ${expiryText}.`);
  textParts.push('', `If you didn't create this account, you can safely ignore this email.`, '', '—', `Sent by the ${appName} team`);
  if (appBase) textParts.push(appBase);
  return { html, text: textParts.join('\n') };
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
  appName = 'PecanRev',
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
          <span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:#111827;">PecanRev</span>
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
