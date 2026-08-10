/**
 * emailService.js — outbound email for the META·LAB ops console (prompt4 Task 4).
 *
 * Configuration is environment-driven. When SMTP is not configured (or nodemailer
 * cannot be loaded), sendEmail NEVER throws — it returns { sent:false, reason }
 * so callers can persist a draft and surface a "not configured" notice instead of
 * a 500. This keeps the console fully usable in dev/preview environments.
 *
 * COPY LIVES IN ./emailTemplates.js. The render* functions below are thin
 * adapters: they keep their historical signatures (and their {html,text} return
 * shape, so every existing call site is untouched), translate their arguments
 * into template variables, and delegate to renderTemplate(). Nothing in this
 * file writes email markup any more.
 *
 * SENDING GOES THROUGH sendTemplatedEmail. renderTemplate + sendEmail are the
 * primitives; sendTemplatedEmail is the only path that also applies the three
 * things an operator and a recipient can actually control — the admin copy
 * override, the per-template disable switch, and the user's opt-out (plus the
 * List-Unsubscribe headers that make the opt-out reachable). Adding a new
 * outbound email means calling sendTemplatedEmail (or enqueueing through
 * emailOutboxService, which applies the same three); calling sendEmail with a
 * hand-rendered body silently opts that email out of all of it.
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
import { renderTemplate, getEmailTemplate } from './emailTemplates.js';
import { unsubscribeHeaders, isEmailCategoryEnabled } from './emailUnsubscribe.js';
import { prisma } from '../db/client.js';
// NOTE on imports: usage.js imports ONLY the prisma client — no controller or
// service imports — so this cannot create a circular dependency. emailTemplates
// imports nothing at all, and emailUnsubscribe imports only emailTemplates (it
// reaches prisma lazily), so neither can import its way back to here.

// The shared email chrome moved to emailTemplates.js (it is copy, not transport)
// but stays exported from here: it is part of this module's public surface and
// existing tests / callers import it from emailService.
export { renderBaseEmailLayout, escapeHtml } from './emailTemplates.js';

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

// Once-per-boot flag for the staging-vars-in-production misconfiguration warning.
let stagingVarsInProductionWarned = false;

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
 * @param {{to:string, subject:string, html?:string, text?:string, context?:string,
 *          headers?:Record<string,string>}} opts
 *        `context` is an optional metrics label (e.g. 'invite', 'contact_reply').
 *        `headers` is an optional map of extra RFC-5322 headers passed straight
 *        through to the transport — this is how List-Unsubscribe rides along on
 *        the disableable emails (see emailUnsubscribe.unsubscribeHeaders). It is
 *        purely additive: omit it and the transport call is byte-identical to
 *        what it was before.
 * @returns {Promise<{sent:boolean, id?:string, reason?:string, error?:string}>}
 */
export async function sendEmail({ to, subject, html, text, context, headers } = {}) {
  if (!isEmailConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }
  if (!to) {
    return { sent: false, reason: 'no_recipient' };
  }

  // 93.md §6.1 — staging protection. In production this is a straight pass-through.
  // Review fix (round 2): a PRODUCTION-resolving box with staging vars set is a
  // misconfiguration trap — usually a staging host that forgot APP_ENV=staging,
  // now silently emailing REAL users. Warn loudly (once per boot) so the
  // operator sees it in the pm2 log immediately instead of after a complaint.
  if (!stagingVarsInProductionWarned && isProductionEmailEnv()
      && (String(process.env.EMAIL_REDIRECT_ALL_TO || '').trim() || String(process.env.EMAIL_ALLOWLIST || '').trim())) {
    stagingVarsInProductionWarned = true;
    console.warn('[emailService] WARNING: EMAIL_REDIRECT_ALL_TO / EMAIL_ALLOWLIST is set but this process '
      + 'resolves as PRODUCTION (APP_ENV/NODE_ENV) — staging email protection is INACTIVE and real '
      + 'recipients will be emailed. If this box is staging, set APP_ENV=staging; if it is production, '
      + 'remove the staging email variables.');
  }
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
  const extraHeaders = headers && typeof headers === 'object' && Object.keys(headers).length ? headers : null;

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
        ...(extraHeaders ? { headers: extraHeaders } : {}),
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
  // `permanent` is the retry contract for every queue in front of this function
  // (today: emailOutboxWorker). The classifier already knows a 5xx SMTP reject
  // from a dropped socket; without surfacing it the caller has only a string to
  // guess from and re-queues rejects that will never be accepted. Same predicate
  // that gates the in-function retry above, inverted: transient → retryable.
  return { sent: false, reason: 'send_failed', error: lastErr.message, permanent: !isTransientEmailError(lastErr) };
}

// ── Template adapters ─────────────────────────────────────────────────────────
// Each render* function keeps the signature its call sites already use and
// returns { html, text }. Everything they do is (a) turn a Date into the display
// string the copy expects and (b) resolve the small value-level fallbacks the
// old hand-written bodies had inline. The copy itself is in emailTemplates.js.
//
// Each one is now a two-line shell over an exported *Variables builder. That
// split exists because sendTemplatedEmail (below) needs the VARIABLES, not a
// pre-rendered body: it has to render with the admin's overrides applied, which
// a render* adapter — which renders against registry defaults — cannot do. Call
// sites therefore pass `xVariables(opts)` rather than growing a second, drifting
// copy of the salutation/date/fallback rules. The render* adapters stay exported
// and unchanged in behaviour: the unit tests and the ops preview use them.

/** "20 July 2026, 10:00" — the datetime form used by expiry/change notices. */
function formatDateTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** "20 July 2026" — the date-only form used by the project-invite expiry line. */
function formatDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Hi Jane," / "Hello," — one salutation rule for every template. */
function salutation(name) {
  return name ? `Hi ${name},` : 'Hello,';
}

// The three value-shaping helpers above are the copy contract, not transport
// detail: a template variable is a STRING, so whoever builds the variables has
// to format the date and the salutation exactly the way the render adapters do.
// Call sites that enqueue through emailOutboxService build those variables
// themselves, so they get the same helpers rather than a second, drifting copy.
export {
  formatDate as formatEmailDate,
  formatDateTime as formatEmailDateTime,
  salutation as emailSalutation,
};

/**
 * renderReplyEmail — clean, professional PecanRev-styled reply email.
 * Returns both an HTML body and a plain-text fallback.
 *
 * @param {{appName?:string, toName?:string, bodyText:string, originalSubject?:string, fromName?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function contactReplyVariables({ appName = 'PecanRev', toName = '', bodyText = '', originalSubject = '', fromName = '' } = {}) {
  return {
    appName,
    greeting: salutation(toName),
    bodyText,
    originalSubject,
    refLine: originalSubject ? `In reply to: ${originalSubject}` : '',
    // The signature shows the NAME of the staff member who wrote this — never
    // their email address (which is the shared no-reply mailbox).
    signoff: fromName ? `Best regards,\n${fromName}\n${appName} team` : `— The ${appName} team`,
  };
}

export function renderReplyEmail(opts = {}) {
  const { html, text } = renderTemplate('contact.reply', contactReplyVariables(opts));
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
 * joined the PecanRev BETA WAITLIST (prompt48 §6). Explicitly NOT an
 * account-creation email and NOT a beta-access invitation.
 *
 * @param {{appName?:string, firstName?:string, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function waitlistConfirmationVariables({ appName = 'PecanRev', firstName = '', supportEmail = '' } = {}) {
  return {
    appName,
    greeting: salutation(firstName),
    siteLink: env('APP_BASE_URL') || appName,
    supportEmail,
  };
}

export function renderBetaWaitlistConfirmationEmail(opts = {}) {
  const { html, text } = renderTemplate('waitlist.confirmation', waitlistConfirmationVariables(opts));
  return { html, text };
}

/**
 * renderPasswordResetEmail — PecanRev-styled password-reset email (prompt14 Task 4).
 * `initiatedByOperator` selects the administrator-started copy variant.
 *
 * @param {{appName?:string, toName?:string, link:string,
 *          expiresAt?:Date|string|null, initiatedByOperator?:boolean}} opts
 * @returns {{html:string, text:string}}
 */
export function passwordResetVariables({
  appName = 'PecanRev',
  toName = '',
  link = '',
  expiresAt = null,
  initiatedByOperator = false,
} = {}) {
  return {
    appName,
    greeting: salutation(toName),
    link,
    expiresAtText: formatDateTime(expiresAt),
    initiatedByOperator: Boolean(initiatedByOperator),
  };
}

export function renderPasswordResetEmail(opts = {}) {
  const { html, text } = renderTemplate('password.reset', passwordResetVariables(opts));
  return { html, text };
}

/**
 * renderEmailVerificationEmail — email-verification email (prompt26).
 * @param {{appName?:string, toName?:string, link:string, expiresAt?:Date|string|null}} opts
 * @returns {{html:string, text:string}}
 */
export function emailVerificationVariables({ appName = 'PecanRev', toName = '', link = '', expiresAt = null } = {}) {
  return {
    appName,
    greeting: salutation(toName),
    link,
    expiresAtText: formatDateTime(expiresAt),
  };
}

export function renderEmailVerificationEmail(opts = {}) {
  const { html, text } = renderTemplate('email.verification', emailVerificationVariables(opts));
  return { html, text };
}

/**
 * renderInviteEmail — the PROJECT invite email (prompt9). Historically this was
 * the one template that duplicated the whole HTML document (header, card,
 * footer, its own CTA clone) instead of using the shared layout; it now goes
 * through the same registry + base layout as everything else, so the chrome can
 * only ever drift in one place.
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
  const { html, text } = renderTemplate('invite.projectMember', {
    appName,
    projectName: projectName || 'a research project',
    inviterName: inviterName || 'A project manager',
    roleLabel: roleLabel || 'member',
    link,
    expiresAtText: formatDate(expiresAt),
  });
  return { html, text };
}

/**
 * renderWaitlistInvitationEmail — 80.md Phase 7. Sent when an admin converts a
 * WAITLIST entry into an account invitation: the CTA creates the person's
 * PASSWORD and activates a real account.
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
  const { html, text } = renderTemplate('invite.waitlist', {
    appName,
    greeting: salutation(toName),
    link,
    expiresAtText: formatDateTime(expiresAt),
    supportEmail,
  });
  return { html, text };
}

/**
 * renderWelcomeEmail — 93.md §6.3. Welcome / getting-started email sent ONCE per
 * user after a waitlist-invitation acceptance completes. This is the one
 * DISABLEABLE email (registry category 'optional') — see emailTemplates.js.
 *
 * @param {{appName?:string, toName?:string, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function welcomeVariables({ appName = 'PecanRev', toName = '', supportEmail = '' } = {}) {
  return {
    appName,
    greeting: salutation(toName),
    supportEmail,
    appBaseUrl: env('APP_BASE_URL'),
  };
}

export function renderWelcomeEmail(opts = {}) {
  const { html, text } = renderTemplate('welcome', welcomeVariables(opts));
  return { html, text };
}

/**
 * renderPasswordChangedEmail — 93.md §6.3. Best-effort security notice sent
 * after a successful password change. Contains no links to click (deliberately —
 * a security notice that trains users to click links is a phishing template).
 *
 * @param {{appName?:string, toName?:string, changedAt?:Date|string|null, supportEmail?:string}} opts
 * @returns {{html:string, text:string}}
 */
export function passwordChangedVariables({ appName = 'PecanRev', toName = '', changedAt = null, supportEmail = '' } = {}) {
  return {
    appName,
    greeting: salutation(toName),
    whenText: formatDateTime(changedAt),
    supportEmail,
  };
}

export function renderPasswordChangedEmail(opts = {}) {
  const { html, text } = renderTemplate('password.changed', passwordChangedVariables(opts));
  return { html, text };
}

// ── The one governed send path ────────────────────────────────────────────────
/**
 * Tolerant read of an EmailTemplate.fieldsJson blob. Junk → undefined, which
 * renderTemplate reads as "no overrides" (registry defaults), never as an empty
 * template. Mirrors emailOutboxWorker.parseObject.
 */
function parseFieldsJson(raw) {
  if (!raw) return undefined;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return undefined;
}

/**
 * sendTemplatedEmail — render a registry template WITH the admin's overrides and
 * the recipient's preferences applied, then send it. Never throws.
 *
 * WHY THIS EXISTS. Until now only emailOutboxWorker consulted the EmailTemplate
 * table, so the eight direct-send call sites rendered registry defaults: an
 * admin could edit copy in the ops console, see the change in the preview and
 * the test-send, and still have real users receive the old text — and switching
 * 'welcome' off was a no-op. Three governance layers were being skipped, so all
 * three live here, in the order that keeps them honest:
 *
 *   1. DISABLE   — a disableable template whose override row says enabled:false
 *                  is not sent at all (checked BEFORE rendering: a disabled
 *                  template should cost nothing).
 *   2. OPT-OUT   — for category 'optional' with a known recipient, the user's
 *                  User.emailNotifications blob wins over everything.
 *   3. HEADERS   — List-Unsubscribe (+ RFC 8058 one-click POST) for the same
 *                  category-'optional' + known-user case, merged OVER whatever
 *                  the caller passed so a caller can never shadow the opt-out.
 *
 * A skip is not a failure: it returns { sent:false, skipped:true, reason } so a
 * caller can tell "we deliberately did not send" from "we tried and could not".
 *
 * @param {{templateKey:string, variables?:object, to:string, subject?:string|null,
 *          recipientUserId?:string|null, headers?:Record<string,string>|null,
 *          context?:string|null, client?:object|null}} opts
 *        `subject` overrides the RENDERED subject and is only for mail whose
 *        subject is per-message operator input (the contact reply / staff
 *        compose composer); leave it null everywhere else so an admin's subject
 *        edit actually reaches the recipient.
 *        `context` is the usage-metric label; defaults to templateKey.
 *        `client` is an injectable prisma-shaped client for tests.
 * @returns {Promise<{sent:boolean, id?:string, skipped?:boolean, reason?:string,
 *          error?:string, permanent?:boolean, missingRequired?:string[]}>}
 */
export async function sendTemplatedEmail({
  templateKey,
  variables = {},
  to,
  subject = null,
  recipientUserId = null,
  headers = null,
  context = null,
  client = null,
} = {}) {
  try {
    const entry = getEmailTemplate(templateKey);
    if (!entry) {
      // A typo'd key must be loud but must not 500 the request that triggered it.
      console.error(`[emailService] sendTemplatedEmail: unknown email template "${templateKey}"`);
      return { sent: false, reason: 'unknown_template' };
    }
    const db = client || prisma;

    // EmailTemplate is edit-by-key with no unique index on templateKey, so a
    // duplicate row is possible; ordering by createdAt makes "which override
    // wins" deterministic (oldest — the row the editor has been updating) rather
    // than whatever the database happens to return first. A read failure means
    // registry defaults, never a dropped email.
    let override = null;
    try {
      override = await db.emailTemplate.findFirst({ where: { templateKey }, orderBy: { createdAt: 'asc' } });
    } catch { override = null; }

    if (entry.disableable && override && override.enabled === false) {
      return { sent: false, skipped: true, reason: 'template_disabled' };
    }

    if (entry.category === 'optional' && recipientUserId) {
      try {
        const user = await db.user.findUnique({
          where: { id: String(recipientUserId) },
          select: { emailNotifications: true },
        });
        // isEmailCategoryEnabled owns the opt-OUT semantics (absent → enabled)
        // AND re-asserts that a transactional key can never be switched off,
        // so the rule lives in exactly one place for both send paths.
        if (user && !isEmailCategoryEnabled(user.emailNotifications, templateKey)) {
          return { sent: false, skipped: true, reason: 'unsubscribed' };
        }
      } catch { /* preference read blip → send (opt-OUT model: absence means enabled) */ }
    }

    // unsubscribeHeaders returns {} for transactional keys and when APP_BASE_URL
    // or JWT_SECRET cannot produce a real link, so this is safe to call blind.
    let finalHeaders = headers && typeof headers === 'object' ? { ...headers } : null;
    if (recipientUserId) {
      const unsub = unsubscribeHeaders(recipientUserId, templateKey);
      if (unsub && Object.keys(unsub).length) finalHeaders = { ...(finalHeaders || {}), ...unsub };
    }

    let rendered;
    try {
      rendered = renderTemplate(templateKey, variables || {}, { overrides: parseFieldsJson(override?.fieldsJson) });
    } catch (err) {
      console.error(`[emailService] ${templateKey}: template render failed:`, err?.message || err);
      return { sent: false, reason: 'render_failed', error: String(err?.message || err) };
    }

    if (rendered.missingRequired.length) {
      // NEVER send a half-rendered email — the recipient would get copy with a
      // literal "[link]" in it. Name the tokens so the fix is obvious from the log.
      console.error(`[emailService] ${templateKey}: missing required template variable(s): ${rendered.missingRequired.join(', ')} — not sent`);
      return { sent: false, reason: 'render_failed', missingRequired: rendered.missingRequired };
    }

    return await sendEmail({
      to,
      subject: (typeof subject === 'string' && subject.trim()) ? subject : rendered.subject,
      html: rendered.html,
      text: rendered.text,
      context: context || templateKey,
      ...(finalHeaders ? { headers: finalHeaders } : {}),
    });
  } catch (err) {
    console.error('[emailService] sendTemplatedEmail failed:', err?.message || err);
    return { sent: false, reason: 'error' };
  }
}

/** Env-configurable support address (93.md §6.3). Empty string when unset. */
export function configuredSupportEmail() {
  const v = process.env.SUPPORT_EMAIL || process.env.WAITLIST_SUPPORT_EMAIL;
  return v && String(v).trim() ? String(v).trim() : '';
}

/**
 * sendPasswordChangedNotice — 93.md §6.3. Best-effort convenience used by
 * passwordResetService + profileController.changePassword. NEVER throws and
 * never blocks the caller's main flow on failure (sendTemplatedEmail already
 * never throws; this wrapper also swallows any remaining surprise).
 *
 * Routed through sendTemplatedEmail so an admin's copy edit reaches the
 * recipient. 'password.changed' is transactional, so neither the disable switch
 * nor the opt-out blob can suppress it — a security notice is not optional.
 * @param {{to:string, toName?:string, recipientUserId?:string|null}} opts
 * @returns {Promise<{sent:boolean, reason?:string}>}
 */
export async function sendPasswordChangedNotice({ to, toName = '', recipientUserId = null } = {}) {
  try {
    if (!to || !isEmailConfigured()) return { sent: false, reason: 'not_configured' };
    return await sendTemplatedEmail({
      templateKey: 'password.changed',
      variables: passwordChangedVariables({
        appName: 'PecanRev',
        toName,
        changedAt: new Date(),
        supportEmail: configuredSupportEmail(),
      }),
      to,
      recipientUserId,
      context: 'password_changed',
    });
  } catch (err) {
    console.error('[emailService] password-changed notice failed:', err?.message || err);
    return { sent: false, reason: 'send_failed' };
  }
}
