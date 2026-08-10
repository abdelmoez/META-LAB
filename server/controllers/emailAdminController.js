/**
 * emailAdminController.js — Ops Console › Email: template management (registry
 * merged with EmailTemplate overrides) + the EmailOutbox delivery history.
 *
 * 112.md follow-up surface. Mounted under the admin router (requireAuth already
 * ran) behind the capability seam requireAdmin.js defines:
 *   view_email_delivery     — admin + mod. Read-only template/delivery inspection.
 *   manage_email_templates  — admin ONLY (by omission from MOD_PERMISSIONS).
 *     Every write, plus preview/test-send (they are editor actions, not reads).
 *
 * DESIGN RULES, inherited from the email system itself:
 *   - The REGISTRY (server/services/emailTemplates.js) owns canonical copy. The
 *     EmailTemplate table stores OVERRIDES ONLY, so Restore Default = delete the
 *     row — there is no second copy of the defaults to drift.
 *   - A PUT stores only the fields that actually DIFFER from the registry
 *     defaults; an override edited back to the defaults deletes itself. That
 *     keeps "customized" badges honest and restore idempotent.
 *   - Required variables must stay reachable: an override may not remove the
 *     last [token] of a required variable from subject+bodyParagraphs — a sent
 *     email with a missing reset link is worse than a rejected save (the worker
 *     would fail the row, but only AFTER a user asked for the email).
 *   - Only registry-disableable templates (category 'optional') can be switched
 *     off. Toggling a transactional template is a 400 here AND ignored by the
 *     worker — defence in both places.
 *   - Previews and test-sends render with DETERMINISTIC sample values derived
 *     from the variable names, so two previews of the same draft are
 *     byte-identical and unit-testable.
 *   - The delivery list never returns variablesJson or idempotencyKey: variable
 *     blobs can carry live password-reset/invite links, and the read endpoint is
 *     mod-visible. Bodies are never stored at all (outbox contract).
 */

import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import {
  listEmailTemplates, getEmailTemplate, renderTemplate,
} from '../services/emailTemplates.js';
import { enqueueEmail } from '../services/emailOutboxService.js';
import { isEmailConfigured } from '../services/emailService.js';
// Shared Ops paging + date parsing (109 r2 end-of-day rule) — one implementation,
// so the Email delivery table filters exactly like every other Ops table.
import { parseJobPage, parseDate } from './researchOpsJobsController.js';

/* ─── field validation (pure; unit-tested without a database) ────────────── */

/** The only keys an override may carry — the renderTemplate overrides contract. */
export const OVERRIDABLE_FIELDS = Object.freeze(['subject', 'heading', 'bodyParagraphs', 'ctaLabel', 'ctaHref', 'footerNote']);

/**
 * Length caps. Generous relative to the shipped copy (longest default paragraph
 * ≈ 400 chars) but hard: an unbounded TEXT column written from an admin form is
 * the same storage-amplification hazard the outbox variables cap closes.
 */
export const TEMPLATE_FIELD_LIMITS = Object.freeze({
  subject: 200,
  heading: 200,
  bodyParagraph: 2000,
  bodyParagraphCount: 30,
  ctaLabel: 80,
  ctaHref: 600,
  footerNote: 500,
});

/**
 * validateTemplateFields — PURE. Checks a submitted `fields` object against one
 * registry entry: allowed keys, types, length caps, and (unless requireTokens is
 * false, the preview path) that every REQUIRED variable still has a [token]
 * somewhere in the EFFECTIVE subject+bodyParagraphs (submitted fields merged
 * over the registry defaults — a partial override inherits the defaults' tokens).
 *
 * @param {object} entry   registry entry (getEmailTemplate)
 * @param {*} raw          request-supplied fields
 * @param {{requireTokens?: boolean}} [opts]
 * @returns {{ok:true, fields:object} | {ok:false, error:string, missing?:string[]}}
 */
export function validateTemplateFields(entry, raw, { requireTokens = true } = {}) {
  if (!entry) return { ok: false, error: 'Unknown email template' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'fields must be an object' };
  }
  const unknown = Object.keys(raw).filter((k) => !OVERRIDABLE_FIELDS.includes(k));
  if (unknown.length) return { ok: false, error: `Unknown field(s): ${unknown.join(', ')}` };

  const fields = {};
  for (const k of OVERRIDABLE_FIELDS) {
    const v = raw[k];
    if (v === undefined) continue;
    if (k === 'bodyParagraphs') {
      if (!Array.isArray(v) || v.some((p) => typeof p !== 'string')) {
        return { ok: false, error: 'bodyParagraphs must be an array of strings' };
      }
      if (v.length > TEMPLATE_FIELD_LIMITS.bodyParagraphCount) {
        return { ok: false, error: `bodyParagraphs: at most ${TEMPLATE_FIELD_LIMITS.bodyParagraphCount} paragraphs` };
      }
      const over = v.findIndex((p) => p.length > TEMPLATE_FIELD_LIMITS.bodyParagraph);
      if (over !== -1) {
        return { ok: false, error: `bodyParagraphs[${over}] exceeds ${TEMPLATE_FIELD_LIMITS.bodyParagraph} characters` };
      }
      fields[k] = [...v];
    } else {
      if (typeof v !== 'string') return { ok: false, error: `${k} must be a string` };
      if (v.length > TEMPLATE_FIELD_LIMITS[k]) {
        return { ok: false, error: `${k} exceeds ${TEMPLATE_FIELD_LIMITS[k]} characters` };
      }
      fields[k] = v;
    }
  }

  if (requireTokens && entry.requiredVariables.length) {
    const effective = { ...entry.defaultFields, ...fields };
    const paragraphs = Array.isArray(effective.bodyParagraphs) ? effective.bodyParagraphs : [];
    const missing = entry.requiredVariables.filter((name) => {
      const token = `[${name}]`;
      if (String(effective.subject || '').includes(token)) return false;
      return !paragraphs.some((p) => String(p).includes(token));
    });
    if (missing.length) {
      return {
        ok: false,
        missing,
        error: `Missing required variable token(s) in subject/body: ${missing.map((n) => `[${n}]`).join(', ')}. `
          + 'Every required variable must appear somewhere in the subject or a body paragraph.',
      };
    }
  }

  return { ok: true, fields };
}

/**
 * diffFieldsAgainstDefaults — PURE. Keep only the submitted fields that differ
 * from the registry defaults (arrays compared structurally). An override that
 * says nothing new is no override — the PUT handler deletes the row instead.
 */
export function diffFieldsAgainstDefaults(entry, fields) {
  const out = {};
  for (const k of OVERRIDABLE_FIELDS) {
    if (fields[k] === undefined) continue;
    const def = entry.defaultFields[k];
    const same = k === 'bodyParagraphs'
      ? JSON.stringify(fields[k]) === JSON.stringify(Array.isArray(def) ? def : [])
      : String(fields[k]) === String(def ?? '');
    if (!same) out[k] = fields[k];
  }
  return out;
}

/* ─── deterministic preview samples (pure) ───────────────────────────────── */

/**
 * sampleValueFor — PURE function of the variable NAME. Two previews of the same
 * draft must be byte-identical, so nothing here reads a clock, a counter or
 * Math.random. Ordering matters: the most specific patterns win.
 */
export function sampleValueFor(name) {
  const n = String(name);
  const lower = n.toLowerCase();
  if (n === 'appName') return 'PecanRev';
  if (lower.includes('link') || lower.includes('url') || lower.includes('href')) {
    return `https://example.com/sample/${lower}`;
  }
  if (lower.includes('email')) return `${lower.replace(/[^a-z0-9]/g, '') || 'sample'}@example.com`;
  if (lower.includes('greeting')) return 'Hi Jordan,';
  if (lower.includes('signoff')) return '— The PecanRev team';
  if (lower.includes('subject')) return 'Your question about PecanRev';
  if (lower.includes('ref')) return 'Ref: SAMPLE-1234';
  if (lower.includes('bodytext') || lower.includes('message')) {
    return 'This is a sample message body, used only for previews and test sends.';
  }
  if (lower.includes('project')) return 'Sample Systematic Review';
  if (lower.includes('role')) return 'Reviewer';
  if (lower.includes('inviter') || lower.endsWith('name')) return 'Jordan Sample';
  if (lower.includes('when') || lower.includes('expires') || lower.includes('date') || lower.endsWith('attext')) {
    return 'January 1, 2026, 12:00 UTC';
  }
  // Boolean-ish flags render their @if branch in previews.
  if (/^(is|has|initiatedby)/i.test(n)) return true;
  return `Sample ${n}`;
}

/** Deterministic sample values for every declared variable of one entry. */
export function sampleVariables(entry) {
  const out = {};
  for (const name of [...entry.requiredVariables, ...entry.optionalVariables]) {
    out[name] = sampleValueFor(name);
  }
  return out;
}

/* ─── toggle verdict (pure) ──────────────────────────────────────────────── */

/**
 * canToggleTemplate — PURE. Only registry-disableable templates may be switched
 * off; there is no honest "opt out of your own password reset" (registry
 * CATEGORY POLICY), so the 400 names the category rule instead of hand-waving.
 */
export function canToggleTemplate(key) {
  const entry = getEmailTemplate(key);
  if (!entry) return { ok: false, status: 404, error: 'Unknown email template' };
  if (!entry.disableable) {
    return {
      ok: false,
      status: 400,
      error: `'${key}' is a ${entry.category} email and cannot be disabled — only optional templates have an off switch.`,
    };
  }
  return { ok: true, entry };
}

/* ─── merged template view ───────────────────────────────────────────────── */

function parseObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return {};
}

/**
 * templateView — one registry entry merged with its override row (or null).
 * `enabled` is EFFECTIVE: non-disableable templates are always true, whatever a
 * stale row says (mirrors the worker, which ignores such rows too).
 */
export function templateView(entry, override = null) {
  const overrideFields = override ? parseObject(override.fieldsJson) : {};
  const hasOverride = Object.keys(overrideFields).length > 0;
  return {
    key: entry.key,
    category: entry.category,
    description: entry.description,
    requiredVariables: [...entry.requiredVariables],
    optionalVariables: [...entry.optionalVariables],
    disableable: entry.disableable,
    defaultFields: { ...entry.defaultFields, bodyParagraphs: [...entry.defaultFields.bodyParagraphs] },
    overrideFields: hasOverride ? overrideFields : null,
    effectiveFields: { ...entry.defaultFields, ...overrideFields },
    hasOverride,
    enabled: entry.disableable ? !(override && override.enabled === false) : true,
    overrideUpdatedAt: override ? override.updatedAt : null,
  };
}

/** First override row per key (matches the worker's findFirst pick). */
async function overridesByKey() {
  const rows = await prisma.emailTemplate.findMany({ orderBy: { createdAt: 'asc' } });
  const map = new Map();
  for (const r of rows) if (!map.has(r.templateKey)) map.set(r.templateKey, r);
  return map;
}

async function overrideFor(key) {
  return prisma.emailTemplate.findFirst({ where: { templateKey: key }, orderBy: { createdAt: 'asc' } });
}

/* ─── GET /api/admin/email/templates ─────────────────────────────────────── */

export async function listEmailTemplatesAdmin(req, res) {
  try {
    const overrides = await overridesByKey();
    const templates = listEmailTemplates().map((e) => templateView(e, overrides.get(e.key) || null));
    return res.json({ templates, emailConfigured: isEmailConfigured() });
  } catch (err) {
    console.error('[email-admin] listEmailTemplatesAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── GET /api/admin/email/templates/:key ────────────────────────────────── */

export async function getEmailTemplateAdmin(req, res) {
  try {
    const key = String(req.params.key);
    const entry = getEmailTemplate(key);
    if (!entry) return res.status(404).json({ error: 'Unknown email template' });
    const override = await overrideFor(key);
    return res.json({ template: templateView(entry, override), emailConfigured: isEmailConfigured() });
  } catch (err) {
    console.error('[email-admin] getEmailTemplateAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── PUT /api/admin/email/templates/:key ────────────────────────────────── */

/** Audited copy edit. Stores only the diff vs defaults; an empty diff restores. */
export async function updateEmailTemplateAdmin(req, res) {
  try {
    const key = String(req.params.key);
    const entry = getEmailTemplate(key);
    if (!entry) return res.status(404).json({ error: 'Unknown email template' });

    const verdict = validateTemplateFields(entry, req.body?.fields);
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.error, ...(verdict.missing ? { missing: verdict.missing } : {}) });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    const overrideFields = diffFieldsAgainstDefaults(entry, verdict.fields);
    const existing = await overrideFor(key);
    const before = existing ? parseObject(existing.fieldsJson) : {};

    if (Object.keys(overrideFields).length === 0) {
      // Edited back to the defaults → the override row has nothing to say.
      if (existing) {
        if (existing.enabled === false && entry.disableable) {
          // Keep the disable flag; only the copy override is cleared.
          await prisma.emailTemplate.update({
            where: { id: existing.id },
            data: { fieldsJson: '{}', updatedById: req.user.id },
          });
        } else {
          await prisma.emailTemplate.deleteMany({ where: { templateKey: key } });
        }
      }
    } else if (existing) {
      await prisma.emailTemplate.update({
        where: { id: existing.id },
        data: { fieldsJson: JSON.stringify(overrideFields), updatedById: req.user.id },
      });
    } else {
      await prisma.emailTemplate.create({
        data: { templateKey: key, fieldsJson: JSON.stringify(overrideFields), enabled: true, updatedById: req.user.id },
      });
    }

    await logAdminAction(
      req, 'UPDATE_EMAIL_TEMPLATE', 'EmailTemplate', key,
      { before, after: overrideFields, changed: Object.keys({ ...before, ...overrideFields }) },
      reason ? { reason } : undefined,
    );

    const override = await overrideFor(key);
    return res.json({ ok: true, template: templateView(entry, override) });
  } catch (err) {
    console.error('[email-admin] updateEmailTemplateAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── DELETE /api/admin/email/templates/:key — restore default ───────────── */

export async function restoreEmailTemplateAdmin(req, res) {
  try {
    const key = String(req.params.key);
    const entry = getEmailTemplate(key);
    if (!entry) return res.status(404).json({ error: 'Unknown email template' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    const existing = await overrideFor(key);
    const before = existing ? parseObject(existing.fieldsJson) : {};
    const hadOverride = Boolean(existing);
    // Restore = delete the row(s): the registry defaults become effective again,
    // and a disable flag is cleared too (restore means "back to shipped state").
    if (hadOverride) await prisma.emailTemplate.deleteMany({ where: { templateKey: key } });

    await logAdminAction(
      req, 'RESTORE_EMAIL_TEMPLATE', 'EmailTemplate', key,
      { before, hadOverride },
      reason ? { reason } : undefined,
    );
    return res.json({ ok: true, hadOverride, template: templateView(entry, null) });
  } catch (err) {
    console.error('[email-admin] restoreEmailTemplateAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── POST /api/admin/email/templates/:key/enabled ───────────────────────── */

export async function setEmailTemplateEnabledAdmin(req, res) {
  try {
    const key = String(req.params.key);
    const verdict = canToggleTemplate(key);
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const enabled = req.body.enabled;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    const existing = await overrideFor(key);
    const beforeEnabled = existing ? existing.enabled !== false : true;
    if (existing) {
      await prisma.emailTemplate.update({
        where: { id: existing.id },
        data: { enabled, updatedById: req.user.id },
      });
    } else {
      await prisma.emailTemplate.create({
        data: { templateKey: key, fieldsJson: '{}', enabled, updatedById: req.user.id },
      });
    }

    await logAdminAction(
      req, 'EMAIL_TEMPLATE_TOGGLE', 'EmailTemplate', key,
      { before: beforeEnabled, after: enabled, enabled },
      reason ? { reason } : undefined,
    );
    const override = await overrideFor(key);
    return res.json({ ok: true, template: templateView(verdict.entry, override) });
  } catch (err) {
    console.error('[email-admin] setEmailTemplateEnabledAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── POST /api/admin/email/templates/:key/preview ───────────────────────── */

/**
 * Render a preview with deterministic sample values. body.fields (the editor's
 * current draft) previews unsaved copy; omitted → the stored override (i.e. what
 * the worker would actually send). Type/cap validation applies; the required-
 * token gate does NOT (an admin mid-edit must be able to SEE the draft).
 */
export async function previewEmailTemplateAdmin(req, res) {
  try {
    const key = String(req.params.key);
    const entry = getEmailTemplate(key);
    if (!entry) return res.status(404).json({ error: 'Unknown email template' });

    let overrides;
    if (req.body && req.body.fields !== undefined) {
      const verdict = validateTemplateFields(entry, req.body.fields, { requireTokens: false });
      if (!verdict.ok) return res.status(400).json({ error: verdict.error });
      overrides = verdict.fields;
    } else {
      const override = await overrideFor(key);
      const stored = override ? parseObject(override.fieldsJson) : {};
      overrides = Object.keys(stored).length ? stored : undefined;
    }

    const sample = sampleVariables(entry);
    const rendered = renderTemplate(key, sample, { overrides });
    return res.json({
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      missingRequired: rendered.missingRequired,
      sampleVariables: sample,
    });
  } catch (err) {
    console.error('[email-admin] previewEmailTemplateAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── POST /api/admin/email/templates/:key/test-send ─────────────────────── */

/** All test sends share this entityId so the hourly cap is one cheap count. */
export const TEST_SEND_ENTITY_ID = 'ops-test-send';
export const TEST_SEND_HOURLY_CAP = 5;

/**
 * Enqueue a test email TO THE CALLING ADMIN ONLY (never an arbitrary recipient —
 * an admin mail form that emails anyone is a phishing tool). Sample variables,
 * stored override applied by the worker, capped at 5/hour per admin via the
 * outbox rows themselves (no new table, survives restarts).
 */
export async function testSendEmailTemplateAdmin(req, res) {
  try {
    const key = String(req.params.key);
    const entry = getEmailTemplate(key);
    if (!entry) return res.status(404).json({ error: 'Unknown email template' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';

    const admin = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true },
    });
    if (!admin?.email) return res.status(400).json({ error: 'Your account has no email address to send to.' });

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await prisma.emailOutbox.count({
      where: { recipientUserId: admin.id, entityId: TEST_SEND_ENTITY_ID, createdAt: { gte: hourAgo } },
    });
    if (recent >= TEST_SEND_HOURLY_CAP) {
      return res.status(429).json({
        error: `Test-send limit reached (${TEST_SEND_HOURLY_CAP} per hour per admin). Try again later.`,
      });
    }

    const result = await enqueueEmail({
      templateKey: key,
      recipient: admin.email,
      recipientUserId: admin.id,
      variables: sampleVariables(entry),
      entityId: TEST_SEND_ENTITY_ID,
      // A fresh discriminator per request: every test send is a deliberate,
      // distinct email — the idempotency dedupe must not swallow the second one.
      discriminator: `t${Date.now()}`,
    });

    if (!result.enqueued && result.reason === 'paused') {
      return res.status(409).json({ error: 'Invitations are paused, so invite templates cannot be test-sent right now.' });
    }
    if (!result.enqueued && result.reason !== 'duplicate') {
      return res.status(result.reason === 'invalid' ? 400 : 500).json({ error: result.error || 'Could not enqueue the test email.' });
    }

    await logAdminAction(
      req, 'EMAIL_TEST_SEND', 'EmailTemplate', key,
      { recipient: admin.email, outboxId: result.outboxId || null },
      reason ? { reason } : undefined,
    );
    return res.json({
      ok: true,
      outboxId: result.outboxId || null,
      recipient: admin.email,
      emailConfigured: isEmailConfigured(),
    });
  } catch (err) {
    console.error('[email-admin] testSendEmailTemplateAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── GET /api/admin/email/delivery ──────────────────────────────────────── */

/** Every status the outbox pipeline can leave a row in. */
export const DELIVERY_STATUSES = Object.freeze([
  'pending', 'sending', 'sent', 'failed', 'skipped_disabled', 'skipped_unconfigured',
]);

/**
 * buildDeliveryWhere — PURE. Junk filters are ignored, never 400 (the Ops filter
 * bar must not be able to wedge itself); a date-only `to` widens to end-of-day.
 */
export function buildDeliveryWhere(query = {}) {
  const where = {};
  const status = String(query.status || '').trim();
  if (status && DELIVERY_STATUSES.includes(status)) where.status = status;
  const templateKey = String(query.templateKey || '').trim();
  // Accepted verbatim (bounded): historical rows may carry keys the registry has
  // since renamed, and an equality match on our own column is injection-safe.
  if (templateKey && templateKey.length <= 100) where.templateKey = templateKey;
  const from = parseDate(query.from);
  const to = parseDate(query.to, { endOfDay: true });
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  return where;
}

export async function listEmailDeliveryAdmin(req, res) {
  try {
    const { page, limit, skip } = parseJobPage(req.query);
    const where = buildDeliveryWhere(req.query);

    const [total, rows, grouped] = await Promise.all([
      prisma.emailOutbox.count({ where }),
      prisma.emailOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        // variablesJson (may carry live reset/invite links) and idempotencyKey
        // are DELIBERATELY absent — this endpoint is mod-visible.
        select: {
          id: true, templateKey: true, recipient: true, recipientUserId: true,
          category: true, status: true, attempts: true, lastError: true,
          renderedSubject: true, sentAt: true, createdAt: true, updatedAt: true,
        },
      }),
      prisma.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(DELIVERY_STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = g._count._all;

    return res.json({
      deliveries: rows,
      total,
      page,
      limit,
      hasMore: skip + rows.length < total,
      counts,
      emailConfigured: isEmailConfigured(),
    });
  } catch (err) {
    console.error('[email-admin] listEmailDeliveryAdmin:', err?.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
