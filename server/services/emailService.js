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
 *
 * 93.md §6.1 — staging email protection (NON-production only; the production
 * path is completely untouched):
 *   EMAIL_REDIRECT_ALL_TO — when set, EVERY recipient is rewritten to this
 *                           address and the subject is prefixed with
 *                           "[staging→original@addr]" so a staging environment
 *                           with real SMTP creds can never email a real user.
 *   EMAIL_ALLOWLIST       — comma-separated addresses and/or domains. When set
 *                           (and no redirect), recipients NOT on the list are
 *                           dropped (logged + counted as skipped). When neither
 *                           var is set, behavior is unchanged (dev already
 *                           no-ops without SMTP config).
 *   EMAIL_RETRY_DELAY_MS  — backoff before the single retry on a TRANSIENT
 *                           transport error (default 2000ms; tests set 1).
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

// ── 93.md §6.1 — staging recipient policy (pure, exported for unit tests) ──────
/**
 * True when this process is a PRODUCTION deployment. APP_ENV wins over NODE_ENV
 * so a staging box running with NODE_ENV=production (common for perf parity)
 * can still opt into the staging email guards via APP_ENV=staging.
 */
export function isProductionEmailEnv(envObj = process.env) {
  const appEnv = String(envObj.APP_ENV || '').trim().toLowerCase();
  if (appEnv) return appEnv === 'production';
  return String(envObj.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/** Parse a comma-separated recipient string into clean lowercase addresses. */
function splitRecipients(to) {
  return String(to || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does `addr` match an allowlist entry (exact address, or bare domain)? */
function allowlistMatch(addr, entry) {
  const a = addr.toLowerCase();
  const e = entry.toLowerCase();
  if (e.includes('@')) return a === e;             // full address entry
  return a.endsWith(`@${e}`) || a.endsWith(`.${e}`); // domain entry (incl. subdomains)
}

/**
 * applyStagingEmailPolicy — decide what a NON-production send may actually do.
 * PURE (no I/O, no env mutation) so it is directly unit-testable. Production
 * environments always get `{ action:'send' }` with recipients untouched.
 *
 * @param {{to:string, subject:string}} msg
 * @param {object} [envObj] injectable env for tests (defaults to process.env)
 * @returns {{action:'send'|'skip', to:string, subject:string,
 *            redirected:boolean, skipped:string[]}}
 */
export function applyStagingEmailPolicy({ to, subject } = {}, envObj = process.env) {
  const base = { action: 'send', to: String(to || ''), subject: String(subject || ''), redirected: false, skipped: [] };
  if (isProductionEmailEnv(envObj)) return base; // production path completely untouched

  const redirectTo = String(envObj.EMAIL_REDIRECT_ALL_TO || '').trim();
  if (redirectTo) {
    // Every recipient rewritten; subject records who it was originally for.
    return {
      action: 'send',
      to: redirectTo,
      subject: `[staging→${base.to || 'unknown'}] ${base.subject}`,
      redirected: true,
      skipped: [],
    };
  }

  const allowlistRaw = String(envObj.EMAIL_ALLOWLIST || '').trim();
  if (allowlistRaw) {
    const entries = allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const recipients = splitRecipients(base.to);
    const kept = [];
    const skipped = [];
    for (const r of recipients) {
      if (entries.some((e) => allowlistMatch(r, e))) kept.push(r);
      else skipped.push(r);
    }
    if (!kept.length) return { ...base, action: 'skip', to: '', skipped };
    return { ...base, to: kept.join(', '), skipped };
  }

  return base; // neither var set → behavior unchanged
}

// ── 93.md §6.1 — transient-vs-permanent transport error classification ─────────
// Connection-class nodemailer codes are transient (worth ONE retry); SMTP 5xx
// responses are permanent rejects (NEVER retried — retrying a 550 just hammers
// the relay's reputation). SMTP 4xx (421/450/451…) is a temporary server-side
// condition → transient.
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
]);

/** True when the nodemailer/socket error is a transient transport failure. */
export function isTransientEmailError(err) {
  if (!err) return false;
  const responseCode = Number(err.responseCode);
  if (Number.isFinite(responseCode) && responseCode >= 400) {
    return responseCode < 500; // 4xx-connect/temporary class → transient; 5xx → permanent
  }
  if (err.code && TRANSIENT_ERROR_CODES.has(String(err.code))) return true;
  return false;
}

function retryDelayMs() {
  const n = parseInt(process.env.EMAIL_RETRY_DELAY_MS, 10);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * sendEmail — send a single email. Never throws.
 * Records an EMAIL_SENT / EMAIL_FAILED UsageEvent (prompt9, best-effort) for
 * every REAL send attempt — the not_configured / no_recipient early-outs are
 * not attempts and are not counted (dev environments without SMTP would
 * otherwise flood EMAIL_FAILED).
 *
 * 93.md §6.1 additions (both invisible in production):
 *   - staging recipient policy (redirect-all / allowlist) applied first;
 *   - ONE bounded retry (~2s backoff) on TRANSIENT transport errors only —
 *     permanent SMTP rejects (5xx) are never retried. The delivery-failure
 *     logging contract is unchanged: one console.error + one EMAIL_FAILED
 *     usage event for the FINAL outcome.
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

  // 93.md §6.1 — staging protection. In production this is a straight pass-through.
  const policy = applyStagingEmailPolicy({ to, subject });
  if (policy.skipped.length) {
    console.log(`[emailService] staging allowlist skipped recipient(s): ${policy.skipped.join(', ')} (context=${context || 'none'})`);
  }
  if (policy.action === 'skip') {
    // Nothing deliverable — not a real attempt, so no EMAIL_FAILED usage event.
    return { sent: false, reason: 'recipients_skipped', skipped: policy.skipped };
  }
  if (policy.redirected) {
    console.log(`[emailService] staging redirect: ${to} → ${policy.to} (context=${context || 'none'})`);
  }
  const finalTo = policy.to;
  const finalSubject = policy.subject || '(no subject)';

  let nodemailer;
  try {
    const mod = await import('nodemailer');
    nodemailer = mod.default || mod;
  } catch (err) {
    console.error('[emailService] nodemailer import failed:', err.message);
    return { sent: false, reason: 'not_configured', error: err.message };
  }

  const port = parseInt(env('SMTP_PORT'), 10) || 587;
  const user = env('SMTP_USER');
  const pass = env('SMTP_PASS');

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const transport = nodemailer.createTransport({
        host: env('SMTP_HOST'),
        port,
        secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
        ...(user || pass ? { auth: { user, pass } } : {}),
      });

      const info = await transport.sendMail({
        from: env('EMAIL_FROM'),
        to: finalTo,
        subject: finalSubject,
        ...(text ? { text } : {}),
        ...(html ? { html } : {}),
      });

      recordUsage({ type: USAGE.EMAIL_SENT, meta: { context: context || null } });
      return { sent: true, id: info?.messageId || null };
    } catch (err) {
      lastErr = err;
      // Retry EXACTLY once, only for transient transport errors (93.md §6.1).
      if (attempt === 0 && isTransientEmailError(err)) {
        console.warn(`[emailService] transient send error (${err.code || err.responseCode || 'unknown'}) — retrying once in ${retryDelayMs()}ms`);
        await sleep(retryDelayMs());
        continue;
      }
      break;
    }
  }

  console.error('[emailService] sendMail failed:', lastErr.message);
  recordUsage({ type: USAGE.EMAIL_FAILED, meta: { context: context || null, error: lastErr.message } });
  return { sent: false, reason: 'send_failed', error: lastErr.message };
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
 * renderBetaWaitlistConfirmationEmail — branded confirmation that an applicant
 * joined the PecanRev BETA WAITLIST (prompt48 §6). This is explicitly NOT an
 * account-creation email and NOT a beta-access invitation: it contains NO
 * password, login link, or onboarding link. Joining the waitlist does not
 * guarantee access. Returns both HTML and a plain-text fallback.
 *
 * @param {{appName?:string, firstName?:string, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function renderBetaWaitlistConfirmationEmail({ appName = 'PecanRev', firstName = '', supportEmail = '' } = {}) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hello,';
  const appBase = env('APP_BASE_URL');
  const siteLink = appBase
    ? `<a href="${escapeHtml(appBase)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(appBase)}</a>`
    : escapeHtml(appName);
  const supportHtml = supportEmail
    ? `<a href="mailto:${escapeHtml(supportEmail)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(supportEmail)}</a>`
    : siteLink;

  const bodyHtml = `          <div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:14px;">You're on the ${escapeHtml(appName)} beta waitlist</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:14px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:16px;">
            Thanks for your interest — we've added you to the waitlist for the ${escapeHtml(appName)} beta.
            ${escapeHtml(appName)} is a professional workspace for systematic reviews and meta-analyses:
            search building, title &amp; abstract screening, data extraction, risk-of-bias assessment, and
            meta-analysis with publication-ready reporting, all in one place.
          </div>
          <div style="font-size:13px;color:#374151;line-height:1.7;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
            This is a <strong>waitlist confirmation only</strong>. It does not create an account and is not a
            beta invitation — joining the waitlist does not guarantee immediate access. If a place opens up,
            we'll email you separately with the next steps.
          </div>
          <div style="font-size:13px;color:#6b7280;line-height:1.7;">
            We may occasionally send you beta updates. Questions? Visit ${siteLink} or contact us at ${supportHtml}.
          </div>`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });

  const textParts = [
    `You're on the ${appName} beta waitlist`,
    '',
    firstName ? `Hi ${firstName},` : 'Hello,',
    '',
    `Thanks for your interest — we've added you to the waitlist for the ${appName} beta. ${appName} is a professional workspace for systematic reviews and meta-analyses: search building, title & abstract screening, data extraction, risk-of-bias assessment, and meta-analysis with publication-ready reporting, all in one place.`,
    '',
    'This is a waitlist confirmation only. It does not create an account and is not a beta invitation — joining the waitlist does not guarantee immediate access. If a place opens up, we\'ll email you separately with the next steps.',
    '',
    `We may occasionally send you beta updates. Questions? Contact us${supportEmail ? ` at ${supportEmail}` : appBase ? ` via ${appBase}` : ''}.`,
    '',
    `— The ${appName} team`,
  ];
  if (appBase && !supportEmail) textParts.push(appBase);

  return { html, text: textParts.join('\n') };
}

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

/**
 * renderWaitlistInvitationEmail — 80.md Phase 7. The professional PecanRev email
 * sent when an admin converts a WAITLIST entry into an account invitation. This is
 * distinct from renderInviteEmail (a PROJECT-membership invite for an existing
 * account) and from renderBetaWaitlistConfirmationEmail (a non-account waitlist
 * receipt): here the CTA creates the person's PASSWORD and activates a real
 * account. The link carries the single-use invitation token; every interpolated
 * value is escaped. Returns HTML + plain text (both, per Phase 7).
 *
 * @param {{appName?:string, toName?:string, link:string,
 *          expiresAt?:Date|string|null, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function renderWaitlistInvitationEmail({
  appName = 'PecanRev',
  toName = '',
  link = '',
  expiresAt = null,
  supportEmail = '',
} = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const appBase = env('APP_BASE_URL');
  const supportHtml = supportEmail
    ? `<a href="mailto:${escapeHtml(supportEmail)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(supportEmail)}</a>`
    : (appBase
      ? `<a href="${escapeHtml(appBase)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(appBase)}</a>`
      : escapeHtml(appName));

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
    ? `<div style="font-size:12px;color:#6b7280;margin-top:18px;">This invitation link expires on ${escapeHtml(expiryText)}. After that, ask the ${escapeHtml(appName)} team for a new one.</div>`
    : '';

  const bodyHtml = `          <div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:14px;">You're invited to ${escapeHtml(appName)}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:22px;">
            A spot has opened up on the ${escapeHtml(appName)} beta and we'd love to have you. You joined the
            waitlist &mdash; now you can create your account. Click below to set your password and activate access
            to search building, screening, data extraction, risk-of-bias assessment, and meta-analysis, all in one place.
          </div>
          ${ctaButton(link, 'Create your password')}
          <div style="font-size:12px;color:#6b7280;margin-top:22px;line-height:1.6;">
            If the button doesn&#39;t work, copy and paste this link into your browser:<br>
            <a href="${escapeHtml(link)}" style="color:#6366f1;text-decoration:none;word-break:break-all;">${escapeHtml(link)}</a>
          </div>
          ${expiryHtml}
          <div style="font-size:12px;color:#9ca3af;margin-top:18px;line-height:1.6;">
            This link is personal to you &mdash; please don&#39;t share it. If you didn&#39;t join the ${escapeHtml(appName)}
            waitlist or weren&#39;t expecting this, you can safely ignore this email, and feel free to reach us at ${supportHtml}.
          </div>`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });

  const textParts = [
    `You're invited to ${appName}`,
    '',
    toName ? `Hi ${toName},` : 'Hello,',
    '',
    `A spot has opened up on the ${appName} beta and we'd love to have you. You joined the waitlist — now you can create your account. Open the link below to set your password and activate access to search building, screening, data extraction, risk-of-bias assessment, and meta-analysis, all in one place.`,
    '',
    `Create your password: ${link}`,
  ];
  if (expiryText) textParts.push('', `This invitation link expires on ${expiryText}. After that, ask the ${appName} team for a new one.`);
  textParts.push(
    '',
    `This link is personal to you — please don't share it. If you didn't join the ${appName} waitlist or weren't expecting this, you can safely ignore this email${supportEmail ? `, or contact us at ${supportEmail}` : ''}.`,
    '',
    '—',
    `Sent by the ${appName} team`,
  );
  if (appBase) textParts.push(appBase);

  return { html, text: textParts.join('\n') };
}

/**
 * renderWelcomeEmail — 93.md §6.3. Welcome / getting-started email sent ONCE per
 * user (idempotency via User.welcomeEmailSentAt, claimed atomically by the
 * caller) after a waitlist-invitation acceptance completes. Guides the new beta
 * user to first value (create a project → import or search records → make the
 * first screening decision), states the beta status honestly, and points at the
 * feedback path. Every interpolated value is escaped; sender/support address are
 * env-configurable (EMAIL_FROM / SUPPORT_EMAIL or WAITLIST_SUPPORT_EMAIL).
 *
 * @param {{appName?:string, toName?:string, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function renderWelcomeEmail({ appName = 'PecanRev', toName = '', supportEmail = '' } = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const appBase = env('APP_BASE_URL');
  const supportHtml = supportEmail
    ? `<a href="mailto:${escapeHtml(supportEmail)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(supportEmail)}</a>`
    : 'the in-app <strong>Help &amp; Feedback</strong> page';

  const steps = [
    ['Create your first project', 'Set the review question and scope — one project per systematic review.'],
    ['Bring in records', 'Import a RIS/CSV export from your library, or run an automated search across open databases.'],
    ['Make your first screening decision', 'Open Screening and include/exclude your first title &amp; abstract — everything else builds from there.'],
  ];
  const stepsHtml = steps.map(([t, d], i) => `
            <tr>
              <td style="vertical-align:top;padding:0 12px 14px 0;"><span style="display:inline-block;width:24px;height:24px;border-radius:50%;background:#eef2ff;color:#6366f1;font-size:13px;font-weight:700;text-align:center;line-height:24px;">${i + 1}</span></td>
              <td style="padding:0 0 14px 0;">
                <div style="font-size:14px;font-weight:600;color:#111827;">${t}</div>
                <div style="font-size:13px;color:#4b5563;line-height:1.6;">${d}</div>
              </td>
            </tr>`).join('');

  const openLink = appBase
    ? ctaButton(appBase, `Open ${appName}`)
    : '';

  const bodyHtml = `          <div style="font-size:17px;font-weight:700;color:#111827;margin-bottom:14px;">Welcome to the ${escapeHtml(appName)} beta</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:18px;">
            Your account is active. ${escapeHtml(appName)} is a professional workspace for systematic reviews and
            meta-analyses — here's the fastest way to your first result:
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
${stepsHtml}
          </table>
          ${openLink}
          <div style="font-size:13px;color:#374151;line-height:1.7;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-top:20px;">
            <strong>You're on the beta.</strong> Things will improve fast, and occasionally change under you.
            When something breaks or feels wrong, tell us — every report is read. Use ${supportHtml}${supportEmail ? '' : ' inside the app'}
            and quote the reference code you receive so we can follow up.
          </div>`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });

  const textParts = [
    `Welcome to the ${appName} beta`,
    '',
    toName ? `Hi ${toName},` : 'Hello,',
    '',
    `Your account is active. Here's the fastest way to your first result:`,
    '',
    `1. Create your first project — set the review question and scope.`,
    `2. Bring in records — import a RIS/CSV export, or run an automated search across open databases.`,
    `3. Make your first screening decision — open Screening and include/exclude your first title & abstract.`,
    '',
    `You're on the beta. When something breaks or feels wrong, tell us — every report is read.`,
    supportEmail ? `Feedback: ${supportEmail}` : `Feedback: use the in-app Help & Feedback page.`,
    '',
    '—',
    `Sent by the ${appName} team`,
  ];
  if (appBase) textParts.push(appBase);

  return { html, text: textParts.join('\n') };
}

/**
 * renderPasswordChangedEmail — 93.md §6.3. Small security notice sent
 * BEST-EFFORT after a successful password change (token reset OR profile
 * change). Contains no links to click (deliberately — a security notice that
 * trains users to click links is a phishing template) beyond the standard
 * footer; tells the user what to do if it wasn't them.
 *
 * @param {{appName?:string, toName?:string, changedAt?:Date|string|null, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function renderPasswordChangedEmail({ appName = 'PecanRev', toName = '', changedAt = null, supportEmail = '' } = {}) {
  const greeting = toName ? `Hi ${escapeHtml(toName)},` : 'Hello,';
  const appBase = env('APP_BASE_URL');

  let whenText = '';
  if (changedAt) {
    const d = changedAt instanceof Date ? changedAt : new Date(changedAt);
    if (!Number.isNaN(d.getTime())) {
      whenText = d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  }
  const supportHtml = supportEmail
    ? `contact us immediately at <a href="mailto:${escapeHtml(supportEmail)}" style="color:#6366f1;text-decoration:none;">${escapeHtml(supportEmail)}</a>`
    : 'contact the team immediately via the in-app Help &amp; Feedback page';

  const bodyHtml = `          <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:14px;">Your password was changed</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.6;margin-bottom:8px;">${greeting}</div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:16px;">
            The password for your ${escapeHtml(appName)} account was changed${whenText ? ` on ${escapeHtml(whenText)}` : ''}.
            All other signed-in sessions have been signed out.
          </div>
          <div style="font-size:13px;color:#374151;line-height:1.7;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;">
            <strong>Didn't do this?</strong> Someone else may have access to your account —
            reset your password from the sign-in page right away and ${supportHtml}.
          </div>
          <div style="font-size:12px;color:#9ca3af;margin-top:18px;line-height:1.5;">
            If this was you, no action is needed.
          </div>`;

  const html = renderBaseEmailLayout({ appName, bodyHtml });

  const textParts = [
    'Your password was changed',
    '',
    toName ? `Hi ${toName},` : 'Hello,',
    '',
    `The password for your ${appName} account was changed${whenText ? ` on ${whenText}` : ''}. All other signed-in sessions have been signed out.`,
    '',
    `Didn't do this? Reset your password from the sign-in page right away and ${supportEmail ? `contact us immediately at ${supportEmail}` : 'contact the team immediately via the in-app Help & Feedback page'}.`,
    '',
    'If this was you, no action is needed.',
    '',
    '—',
    `Sent by the ${appName} team`,
  ];
  if (appBase) textParts.push(appBase);

  return { html, text: textParts.join('\n') };
}

/** Env-configurable support address (93.md §6.3). Empty string when unset. */
export function configuredSupportEmail() {
  const v = process.env.SUPPORT_EMAIL || process.env.WAITLIST_SUPPORT_EMAIL;
  return v && String(v).trim() ? String(v).trim() : '';
}

/**
 * sendPasswordChangedNotice — 93.md §6.3. Best-effort convenience used by
 * passwordResetService + profileController.changePassword. NEVER throws and
 * never blocks the caller's main flow on failure (sendEmail already never
 * throws; this wrapper also swallows render-time surprises).
 * @param {{to:string, toName?:string}} opts
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
export async function sendPasswordChangedNotice({ to, toName = '' } = {}) {
  try {
    if (!to || !isEmailConfigured()) return { sent: false, reason: 'not_configured' };
    const { html, text } = renderPasswordChangedEmail({
      appName: 'PecanRev',
      toName,
      changedAt: new Date(),
      supportEmail: configuredSupportEmail(),
    });
    return await sendEmail({
      to,
      subject: 'Your PecanRev password was changed',
      html,
      text,
      context: 'password_changed',
    });
  } catch (err) {
    console.error('[emailService] password-changed notice failed:', err?.message || err);
    return { sent: false, reason: 'send_failed' };
  }
}
