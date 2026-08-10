/**
 * emailTemplates.js — the SINGLE source of truth for outbound email copy.
 *
 * Before this module every outbound email owned its own hand-written HTML
 * document inside emailService.js. That made copy changes a code change in
 * eight places, made "which emails do we even send?" unanswerable without
 * reading 900 lines, and gave the unsubscribe layer nothing to key off.
 *
 * The registry below answers all three: every email is one entry with a stable
 * `key`, a `category` (transactional vs optional), a human `description`, its
 * variable contract, and its `defaultFields` — the structured copy. Rendering
 * is a pure function of (entry, variables, overrides).
 *
 * CONTRACT
 *   renderTemplate(templateKey, variables, { overrides })
 *     → { subject, html, text, missingRequired: string[] }
 *
 * COPY SYNTAX (registry-owned strings are TRUSTED; variable VALUES never are)
 *   [token]            — variable substitution. A token naming a declared
 *                        variable is replaced (HTML-escaped in `html`, raw in
 *                        `text`); a token naming nothing is left LITERAL.
 *   **bold**           — <strong> in html, markers stripped in text. Applied to
 *                        the registry copy only, BEFORE substitution, so a value
 *                        containing '**' can never inject emphasis.
 *   \n                 — <br> in html, a real newline in text.
 *   '[[cta]]'          — a bodyParagraph that is exactly this sentinel marks
 *                        where the CTA button goes. Without it the CTA is
 *                        appended after the paragraphs. No CTA is rendered
 *                        unless BOTH ctaLabel and ctaHref resolve non-empty.
 *   '@if:name '        — paragraph prefix; keep this paragraph only when the
 *   '@ifnot:name '       variable is (not) truthy. This is how the operator vs
 *                        self password-reset variants, the "we have a support
 *                        address" variants, and the timestamped/untimestamped
 *                        password-changed notice all stay in the registry
 *                        instead of leaking back into service code.
 *   '> ' / '!> ' / '~ ' — paragraph style prefix: neutral callout box, red alert
 *                        box, small muted line. Default is a body paragraph.
 *   Any paragraph that renders blank is dropped.
 *
 * LINKS: a variable whose whole value is an http(s)/mailto URL or a bare email
 * address becomes an anchor in the HTML part (escaped href + escaped label) and
 * stays raw in the text part. That is how the "copy and paste this link" lines
 * and the support mailto: links work without putting markup in values.
 *
 * Inline hex styles are deliberate — CSS variables and external stylesheets do
 * not work in mail clients.
 */

function env(key) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : '';
}

/**
 * escapeHtml — the ONLY escaping primitive for email HTML. Exported (it used to
 * be private to emailService) so the template renderer and any future email
 * surface share exactly one implementation.
 */
export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * renderBaseEmailLayout — the shared PecanRev email chrome (prompt14): the 600px
 * white card with the wordmark header and the footer link, into which each
 * template injects its inner body HTML. The caller is responsible for escaping
 * every value inside `bodyHtml`.
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
export function ctaButton(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
            <tr><td style="border-radius:8px;background:#6366f1;">
              <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
            </td></tr>
          </table>`;
}

// ── The registry ──────────────────────────────────────────────────────────────
//
// CATEGORY POLICY. 'transactional' = the mail is part of an action the user (or
// an operator acting on their account) just took, and suppressing it would break
// access or hide a security event. Those are never disableable — there is no
// honest "opt out of your own password reset".
//
// 'welcome' is the first honest exception, and it is classified 'optional'
// DELIBERATELY. It is not needed to complete any flow: by the time it is sent
// the account is already active and the user already got the invitation and the
// verification mail. It is onboarding guidance — genuinely useful, genuinely
// skippable. Making it a disableable entry also means the unsubscribe endpoint
// has a real, non-hypothetical thing to switch off, rather than being dead code
// waiting for a future newsletter.
//
// 'chat.digest' (112.md §2) is the second, and the clearer case: nothing in the
// product breaks if a project-chat digest never arrives — the messages are all
// still in the thread. It is the first entry that is not merely disableable but
// strictly OPT-IN (User.emailNotifications.projectChat must be explicitly true;
// see chatDigestPolicy.chatDigestPrefEnabled), because a notification email
// nobody asked for is spam even when the sender is us.
//
// (Note on count: the prompt that created this registry asked for nine keys
// "mined from the existing render fns". emailService exported nine render*
// functions, but one of them — renderBaseEmailLayout — is the shared chrome,
// not a template; and renderContactReplyEmail is an alias of renderReplyEmail,
// not a distinct email. There were exactly EIGHT distinct outbound emails at
// that point, and inventing a ninth would have meant registering an email the
// product does not send. 'chat.digest' is the ninth, added only once something
// actually sends it.)

const CTA_SENTINEL = '[[cta]]';

/** @type {Array<object>} */
const REGISTRY = [
  {
    key: 'contact.reply',
    category: 'transactional',
    description: 'Staff reply to a message someone sent through the contact form.',
    requiredVariables: ['bodyText'],
    optionalVariables: ['appName', 'greeting', 'refLine', 'signoff', 'originalSubject'],
    defaultFields: {
      subject: 'Re: [originalSubject]',
      heading: '',
      bodyParagraphs: [
        '~ [refLine]',
        '[greeting]',
        '[bodyText]',
        '[signoff]',
      ],
      footerNote: '',
    },
  },
  {
    key: 'waitlist.confirmation',
    category: 'transactional',
    description: 'Receipt confirming someone joined the beta waitlist. Creates no account and grants no access.',
    requiredVariables: [],
    optionalVariables: ['appName', 'greeting', 'siteLink', 'supportEmail'],
    defaultFields: {
      subject: "You're on the [appName] beta waitlist",
      heading: "You're on the [appName] beta waitlist",
      bodyParagraphs: [
        '[greeting]',
        "Thanks for your interest — we've added you to the waitlist for the [appName] beta. [appName] is a professional workspace for systematic reviews and meta-analyses: search building, title & abstract screening, data extraction, risk-of-bias assessment, and meta-analysis with publication-ready reporting, all in one place.",
        "> This is a **waitlist confirmation only**. It does not create an account and is not a beta invitation — joining the waitlist does not guarantee immediate access. If a place opens up, we'll email you separately with the next steps.",
        '@if:supportEmail ~ We may occasionally send you beta updates. Questions? Visit [siteLink] or contact us at [supportEmail].',
        '@ifnot:supportEmail ~ We may occasionally send you beta updates. Questions? Visit [siteLink].',
      ],
      footerNote: '',
    },
  },
  {
    key: 'password.reset',
    category: 'transactional',
    description: 'Single-use password-reset link. Has a self-service variant and an operator-initiated variant, selected by initiatedByOperator.',
    requiredVariables: ['link'],
    optionalVariables: ['appName', 'greeting', 'expiresAtText', 'initiatedByOperator'],
    defaultFields: {
      subject: 'Reset your [appName] password',
      heading: 'Reset your password',
      bodyParagraphs: [
        '[greeting]',
        '@if:initiatedByOperator A [appName] administrator started a password reset for your account. Click the button below to choose a new password.',
        '@ifnot:initiatedByOperator We received a request to reset the password for your [appName] account. Click the button below to choose a new password.',
        CTA_SENTINEL,
        "@if:link ~ If the button doesn't work, copy and paste this link into your browser:\n[link]",
        '@if:expiresAtText ~ This link expires on [expiresAtText]. After that, request a new one.',
      ],
      ctaLabel: 'Reset password',
      ctaHref: '[link]',
      footerNote: "If you didn't request this, you can safely ignore this email — your password won't change.",
    },
  },
  {
    key: 'email.verification',
    category: 'transactional',
    description: 'Single-use link confirming ownership of a newly registered email address.',
    requiredVariables: ['link'],
    optionalVariables: ['appName', 'greeting', 'expiresAtText'],
    defaultFields: {
      subject: 'Confirm your [appName] email address',
      heading: 'Confirm your email',
      bodyParagraphs: [
        '[greeting]',
        'Welcome to [appName]. Confirm your email address to activate your research workspace.',
        CTA_SENTINEL,
        "@if:link ~ If the button doesn't work, copy and paste this link into your browser:\n[link]",
        '@if:expiresAtText ~ This link expires on [expiresAtText]. After that, request a new one.',
      ],
      ctaLabel: 'Verify email',
      ctaHref: '[link]',
      footerNote: "If you didn't create this account, you can safely ignore this email.",
    },
  },
  {
    key: 'invite.projectMember',
    category: 'transactional',
    description: 'Invitation to join an existing research PROJECT as a collaborator. The recipient may or may not already have an account.',
    requiredVariables: ['link'],
    optionalVariables: ['appName', 'projectName', 'inviterName', 'roleLabel', 'expiresAtText'],
    defaultFields: {
      subject: '[inviterName] invited you to "[projectName]" on [appName]',
      heading: "You've been invited to a research project",
      bodyParagraphs: [
        '[inviterName] has invited you to join **"[projectName]"** on [appName] as **[roleLabel]**.',
        'Accept the invitation to start collaborating on screening, data extraction and analysis with the project team.',
        CTA_SENTINEL,
        "@if:link ~ If the button doesn't work, copy and paste this link into your browser:\n[link]",
        '@if:expiresAtText ~ This invitation expires on [expiresAtText]. If it has expired, ask [inviterName] to send a new one.',
      ],
      ctaLabel: 'Accept invitation',
      ctaHref: '[link]',
      footerNote: "If you weren't expecting this invitation, you can safely ignore this email.",
    },
  },
  {
    key: 'invite.waitlist',
    category: 'transactional',
    description: 'Beta ACCOUNT invitation issued when an admin converts a waitlist entry. The CTA sets the password and activates the account.',
    requiredVariables: ['link'],
    optionalVariables: ['appName', 'greeting', 'expiresAtText', 'supportEmail'],
    defaultFields: {
      subject: "You're invited to [appName]",
      heading: "You're invited to [appName]",
      bodyParagraphs: [
        '[greeting]',
        "A spot has opened up on the [appName] beta and we'd love to have you. You joined the waitlist — now you can create your account. Click below to set your password and activate access to search building, screening, data extraction, risk-of-bias assessment, and meta-analysis, all in one place.",
        CTA_SENTINEL,
        "@if:link ~ If the button doesn't work, copy and paste this link into your browser:\n[link]",
        '@if:expiresAtText ~ This invitation link expires on [expiresAtText]. After that, ask the [appName] team for a new one.',
        "@if:supportEmail ~ This link is personal to you — please don't share it. If you didn't join the [appName] waitlist or weren't expecting this, you can safely ignore this email, and feel free to reach us at [supportEmail].",
        "@ifnot:supportEmail ~ This link is personal to you — please don't share it. If you didn't join the [appName] waitlist or weren't expecting this, you can safely ignore this email.",
      ],
      ctaLabel: 'Create your password',
      ctaHref: '[link]',
      footerNote: '',
    },
  },
  {
    key: 'welcome',
    category: 'optional',
    description: 'One-time getting-started guide sent after a beta account is activated. Onboarding guidance, not access-critical — the only entry a user may switch off.',
    requiredVariables: [],
    optionalVariables: ['appName', 'greeting', 'supportEmail', 'appBaseUrl'],
    defaultFields: {
      subject: 'Welcome to the [appName] beta',
      heading: 'Welcome to the [appName] beta',
      bodyParagraphs: [
        '[greeting]',
        "Your account is active. [appName] is a professional workspace for systematic reviews and meta-analyses — here's the fastest way to your first result:",
        '**1. Create your first project** — Set the review question and scope; one project per systematic review.',
        '**2. Bring in records** — Import a RIS/CSV export from your library, or run an automated search across open databases.',
        '**3. Make your first screening decision** — Open Screening and include/exclude your first title & abstract; everything else builds from there.',
        CTA_SENTINEL,
        "@if:supportEmail > **You're on the beta.** Things will improve fast, and occasionally change under you. When something breaks or feels wrong, tell us — every report is read. Use [supportEmail] and quote the reference code you receive so we can follow up.",
        "@ifnot:supportEmail > **You're on the beta.** Things will improve fast, and occasionally change under you. When something breaks or feels wrong, tell us — every report is read. Use the in-app Help & Feedback page inside the app and quote the reference code you receive so we can follow up.",
      ],
      ctaLabel: 'Open [appName]',
      ctaHref: '[appBaseUrl]',
      footerNote: '',
    },
  },
  {
    key: 'password.changed',
    category: 'transactional',
    description: 'Security notice sent after a password change. Deliberately contains no clickable action — a security notice that trains users to click links is a phishing template.',
    requiredVariables: [],
    optionalVariables: ['appName', 'greeting', 'whenText', 'supportEmail'],
    defaultFields: {
      subject: 'Your [appName] password was changed',
      heading: 'Your password was changed',
      bodyParagraphs: [
        '[greeting]',
        '@if:whenText The password for your [appName] account was changed on [whenText]. All other signed-in sessions have been signed out.',
        '@ifnot:whenText The password for your [appName] account was changed. All other signed-in sessions have been signed out.',
        "@if:supportEmail !> **Didn't do this?** Someone else may have access to your account — reset your password from the sign-in page right away and contact us immediately at [supportEmail].",
        "@ifnot:supportEmail !> **Didn't do this?** Someone else may have access to your account — reset your password from the sign-in page right away and contact the team immediately via the in-app Help & Feedback page.",
      ],
      footerNote: 'If this was you, no action is needed.',
    },
  },
  {
    key: 'chat.digest',
    category: 'optional',
    description: 'Batched summary of unread project-chat messages, sent once a burst goes quiet. Pure notification convenience — strictly opt-in and switchable off.',
    requiredVariables: ['projectName', 'senderSummary', 'messageCount', 'preview', 'chatUrl'],
    optionalVariables: ['recipientName'],
    defaultFields: {
      subject: '[messageCount] new messages in [projectName]',
      heading: 'New messages in [projectName]',
      bodyParagraphs: [
        '@if:recipientName Hi [recipientName],',
        '[senderSummary] posted in **"[projectName]"** while you were away.',
        '> [preview]',
        // Phrased as a labelled count rather than "[messageCount] new messages"
        // so the sentence stays grammatical at a count of one.
        '~ Unread since you last opened the thread: **[messageCount]**.',
        CTA_SENTINEL,
        "@if:chatUrl ~ If the button doesn't work, copy and paste this link into your browser:\n[chatUrl]",
      ],
      ctaLabel: 'Open the chat',
      ctaHref: '[chatUrl]',
      footerNote: "You're getting this because project-chat notifications are on for your account. Turn them off any time in your profile settings.",
    },
  },
].map((e) => ({
  ...e,
  defaultFields: { heading: '', bodyParagraphs: [], ctaLabel: '', ctaHref: '', footerNote: '', ...e.defaultFields },
  disableable: e.category === 'optional',
}));

const BY_KEY = new Map(REGISTRY.map((e) => [e.key, e]));

/** Every registry entry, in declaration order. Frozen — callers must not mutate. */
export function listEmailTemplates() {
  return REGISTRY.map((e) => ({ ...e, defaultFields: { ...e.defaultFields, bodyParagraphs: [...e.defaultFields.bodyParagraphs] } }));
}

/** One registry entry by key, or null. */
export function getEmailTemplate(key) {
  return BY_KEY.get(key) || null;
}

/** All template keys. */
export function emailTemplateKeys() {
  return REGISTRY.map((e) => e.key);
}

/**
 * True when `key` names a template a user is allowed to switch off. Only
 * category==='optional' entries qualify — see the CATEGORY POLICY note above.
 */
export function isDisableableCategory(key) {
  const e = BY_KEY.get(key);
  return Boolean(e && e.disableable);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const TOKEN_RE = /\[([A-Za-z][A-Za-z0-9_]*)\]/g;
const COND_RE = /^@(if|ifnot):([A-Za-z][A-Za-z0-9_]*)\s+/;
const URL_VALUE_RE = /^(?:https?:\/\/|mailto:)\S+$/i;
const EMAIL_VALUE_RE = /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[^\s@<>"'&]+$/;

// Variables every template may use without the caller having to pass them.
const BUILTIN_DEFAULTS = { appName: 'PecanRev' };

const STYLE = {
  heading: 'font-size:17px;font-weight:700;color:#111827;margin-bottom:14px;',
  body: 'font-size:14px;color:#1f2937;line-height:1.7;margin-bottom:16px;',
  small: 'font-size:12px;color:#6b7280;line-height:1.6;margin-bottom:14px;',
  callout: 'font-size:13px;color:#374151;line-height:1.7;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:16px;',
  alert: 'font-size:13px;color:#374151;line-height:1.7;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:16px;',
  footerNote: 'font-size:12px;color:#9ca3af;margin-top:18px;line-height:1.5;',
};

function isTruthyValue(v) {
  if (v === undefined || v === null || v === false || v === 0) return false;
  const s = String(v).trim();
  return s !== '' && s !== 'false' && s !== '0';
}

function anchor(href, label) {
  return `<a href="${escapeHtml(href)}" style="color:#6366f1;text-decoration:none;word-break:break-all;">${escapeHtml(label)}</a>`;
}

/** Render one substituted VALUE for the HTML part: link-ish values become anchors. */
function htmlValue(raw) {
  const s = String(raw);
  if (URL_VALUE_RE.test(s)) return anchor(s, s);
  if (EMAIL_VALUE_RE.test(s)) return anchor(`mailto:${s}`, s);
  return escapeHtml(s);
}

/**
 * HTML rendering of one TRUSTED copy string. Order matters and is the security
 * property: the copy is escaped and emphasised FIRST, values are injected
 * (escaped or anchored) SECOND — so no value can ever introduce markup.
 */
function toHtml(copy, values, declared) {
  let out = escapeHtml(copy);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(TOKEN_RE, (m, name) => (declared.has(name) ? htmlValue(values[name]) : m));
  return out.replace(/\n/g, '<br>');
}

/** Plain-text rendering of one TRUSTED copy string. Values go in raw. */
function toText(copy, values, declared) {
  return String(copy)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(TOKEN_RE, (m, name) => (declared.has(name) ? String(values[name]) : m));
}

/** Split a bodyParagraph into { cond, style, copy }. */
function parseParagraph(raw) {
  let s = String(raw == null ? '' : raw);
  let cond = null;
  const m = s.match(COND_RE);
  if (m) {
    cond = { negate: m[1] === 'ifnot', name: m[2] };
    s = s.slice(m[0].length);
  }
  if (s === CTA_SENTINEL) return { cond, style: 'cta', copy: '' };
  let style = 'body';
  if (s.startsWith('!> ')) { style = 'alert'; s = s.slice(3); }
  else if (s.startsWith('> ')) { style = 'callout'; s = s.slice(2); }
  else if (s.startsWith('~ ')) { style = 'small'; s = s.slice(2); }
  return { cond, style, copy: s };
}

/**
 * renderTemplate — render a registry template to a ready-to-send email.
 *
 * @param {string} templateKey            registry key, e.g. 'password.reset'
 * @param {object} [variables]            token values; extra keys are ignored
 * @param {{overrides?:object}} [options] partial defaultFields replacement
 *        (subject / heading / bodyParagraphs / ctaLabel / ctaHref / footerNote)
 * @returns {{subject:string, html:string, text:string, missingRequired:string[]}}
 * @throws {Error} when templateKey is not in the registry (a programming error —
 *         a typo'd key must fail loudly, not silently send a blank email).
 */
export function renderTemplate(templateKey, variables = {}, { overrides = null } = {}) {
  const entry = BY_KEY.get(templateKey);
  if (!entry) throw new Error(`Unknown email template: ${templateKey}`);

  const vars = variables && typeof variables === 'object' ? variables : {};
  const declared = new Set([...entry.requiredVariables, ...entry.optionalVariables]);

  // Declared-but-absent → ''. Booleans collapse to ''/'true' so @if works and a
  // stray [boolean] token can never print "false" into a sentence.
  const values = {};
  for (const name of declared) {
    let v = vars[name];
    if (typeof v === 'boolean') v = v ? 'true' : '';
    if (v === undefined || v === null) v = '';
    v = String(v);
    if (v === '' && BUILTIN_DEFAULTS[name] !== undefined) v = BUILTIN_DEFAULTS[name];
    values[name] = v;
  }

  const missingRequired = entry.requiredVariables.filter((name) => !String(values[name] ?? '').trim());

  const fields = { ...entry.defaultFields };
  if (overrides && typeof overrides === 'object') {
    for (const k of ['subject', 'heading', 'bodyParagraphs', 'ctaLabel', 'ctaHref', 'footerNote']) {
      if (overrides[k] !== undefined) fields[k] = overrides[k];
    }
  }
  const paragraphs = Array.isArray(fields.bodyParagraphs) ? fields.bodyParagraphs : [];

  const subject = toText(fields.subject || '', values, declared).trim();
  const appName = values.appName || BUILTIN_DEFAULTS.appName;

  // The CTA is only real when both halves resolve.
  const ctaLabel = toText(fields.ctaLabel || '', values, declared).trim();
  const ctaHref = toText(fields.ctaHref || '', values, declared).trim();
  const hasCta = Boolean(ctaLabel && ctaHref);

  const htmlBlocks = [];
  const textBlocks = [];
  let ctaPlaced = false;

  const pushCta = () => {
    if (!hasCta || ctaPlaced) return;
    ctaPlaced = true;
    htmlBlocks.push(`          ${ctaButton(ctaHref, ctaLabel)}`);
    textBlocks.push(`${ctaLabel}: ${ctaHref}`);
  };

  const headingText = toText(fields.heading || '', values, declared).trim();
  if (headingText) {
    htmlBlocks.push(`          <div style="${STYLE.heading}">${toHtml(fields.heading, values, declared)}</div>`);
    textBlocks.push(headingText);
  }

  for (const raw of paragraphs) {
    const { cond, style, copy } = parseParagraph(raw);
    if (cond) {
      const truthy = isTruthyValue(declared.has(cond.name) ? values[cond.name] : vars[cond.name]);
      if (cond.negate ? truthy : !truthy) continue;
    }
    if (style === 'cta') { pushCta(); continue; }
    const plain = toText(copy, values, declared);
    if (!plain.trim()) continue; // a paragraph that renders to nothing is not a paragraph
    htmlBlocks.push(`          <div style="${STYLE[style]}">${toHtml(copy, values, declared)}</div>`);
    textBlocks.push(plain);
  }

  pushCta(); // no sentinel in the copy → CTA goes after the body

  const footerPlain = toText(fields.footerNote || '', values, declared);
  if (footerPlain.trim()) {
    htmlBlocks.push(`          <div style="${STYLE.footerNote}">${toHtml(fields.footerNote, values, declared)}</div>`);
    textBlocks.push(footerPlain);
  }

  const html = renderBaseEmailLayout({ appName, bodyHtml: htmlBlocks.join('\n') });

  // The plain-text part mirrors the HTML chrome's footer so both variants
  // identify the sender the same way.
  const textTail = ['—', `Sent by the ${appName} team`];
  const appBase = env('APP_BASE_URL');
  if (appBase) textTail.push(appBase);
  const text = `${textBlocks.join('\n\n')}\n\n${textTail.join('\n')}`.replace(/\n{3,}/g, '\n\n');

  return { subject, html, text, missingRequired };
}
