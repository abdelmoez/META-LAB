/**
 * emailOutboxService.js — the ONE way application code asks for an email.
 *
 * WHY. Every outbound email used to be a `render* + await sendEmail(...)` pair
 * inline in a request handler. That coupled a user-visible response to an SMTP
 * round-trip (a hung relay stalls the request), lost the email entirely if the
 * process died mid-send, and made "did we already email this person about this
 * exact thing?" unanswerable — so a double-clicked Invite button sent two
 * invitations. Handing the request off to a durable EmailOutbox row fixes all
 * three: the caller returns immediately, a crash leaves a claimable row behind,
 * and the idempotency key makes a repeat request a no-op.
 *
 * CONTRACT
 *   enqueueEmail({ templateKey, recipient, recipientUserId?, variables,
 *                  entityId, discriminator, category })
 *     → { enqueued:boolean, reason?:'duplicate'|'paused'|'invalid'|'error',
 *         outboxId?:string }
 *
 *   NEVER throws. Every failure mode is a typed `reason`, because every caller
 *   is a best-effort side effect that must not be able to fail its request:
 *     'duplicate' — an identical request is already in the outbox (see below).
 *                   `outboxId` still points at the row that WILL be / was sent,
 *                   so callers can treat duplicate as success.
 *     'paused'    — an 'invite.*' template while the operator has invitations
 *                   paused (SiteSetting appSettings.invitationsPaused).
 *     'invalid'   — programming/input error: unknown template key, implausible
 *                   recipient, category disagreeing with the registry,
 *                   non-object or oversized variables. Nothing is written.
 *     'error'     — the database rejected the write. Not a validation outcome;
 *                   logged and reported so the caller can degrade (e.g. surface
 *                   the copyable invite link instead of claiming an email).
 *
 * IDEMPOTENCY. `templateKey|recipient(lowercased)|entityId|discriminator`.
 *   - entityId       the thing the email is ABOUT (invitation row, member row).
 *   - discriminator  what makes a legitimate RE-send distinct — for invitations
 *                    the expiry timestamp, which changes every time a fresh
 *                    token is minted. Same link → deduped; new link → sent.
 * The column carries a PLAIN index, not a unique constraint (a unique index
 * would turn an ordinary duplicate into a P2002 that every call site would have
 * to catch), so the dedupe is done in code: findFirst-then-create inside ONE
 * `prisma.$transaction`. Under SQLite (one writer) that is genuinely atomic;
 * under Postgres READ COMMITTED two simultaneous enqueues of the same key can
 * both miss and both insert — the duplicate is bounded to that microscopic
 * window and the worker sends two identical mails rather than zero. Deliberate:
 * an occasional duplicate invite is a far cheaper failure than a lost one.
 */

import { prisma } from '../db/client.js';
import { getEmailTemplate } from './emailTemplates.js';

/**
 * Cap on the serialized variable blob. Template variables are short strings
 * (names, links, dates); anything larger is a caller accidentally stuffing a
 * record/entity into the payload, and an unbounded TEXT column written from a
 * request path is a storage-amplification bug waiting to happen.
 */
export const MAX_VARIABLES_JSON_CHARS = 8000;

/** RFC-5322 is not worth implementing here — this rejects the obvious junk. */
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * isPlausibleRecipient — cheap sanity gate so a null/blank/garbage address
 * becomes a typed 'invalid' at enqueue time instead of a row the worker will
 * claim, render and fail on five times.
 * @param {*} value
 * @returns {boolean}
 */
export function isPlausibleRecipient(value) {
  const s = String(value ?? '').trim();
  return s.length > 0 && s.length <= 320 && EMAIL_RE.test(s);
}

/**
 * buildIdempotencyKey — PURE. Exported so tests (and any future admin "resend"
 * surface) can compute the exact key without duplicating the format.
 * @param {{templateKey:string, recipient:string, entityId?:*, discriminator?:*}} o
 * @returns {string}
 */
export function buildIdempotencyKey({ templateKey, recipient, entityId, discriminator } = {}) {
  return [
    String(templateKey ?? ''),
    String(recipient ?? '').trim().toLowerCase(),
    entityId == null ? '' : String(entityId),
    discriminator == null ? '' : String(discriminator),
  ].join('|');
}

/** A real, non-array object (the only shape `variables` may take). */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * invitationsArePaused — the operator's global invitation kill-switch, read
 * from the same appSettings SiteSetting blob invitationService.getInvitationControls
 * uses. Read directly (rather than importing that service) so this module stays
 * free of an import cycle: invitationService enqueues through here.
 *
 * FAIL-OPEN, matching getInvitationControls: a settings-read hiccup must not be
 * able to silently stop every invitation in the product.
 */
async function invitationsArePaused() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'appSettings' } });
    const s = row ? JSON.parse(row.value || '{}') : {};
    return s.invitationsPaused === true;
  } catch {
    return false;
  }
}

/**
 * Nudge the drain loop after a successful enqueue. Imported LAZILY and
 * fire-and-forget: the worker pulls in the mail transport, and a service used
 * from request handlers should not drag that in (nor care whether the worker is
 * even enabled — `kickEmailOutboxWorker` decides that for itself).
 */
function kickWorker() {
  import('./emailOutboxWorker.js')
    .then((m) => m.kickEmailOutboxWorker())
    .catch(() => { /* worker unavailable — the boot drain / sweep still picks the row up */ });
}

/**
 * enqueueEmail — persist an email request. Never throws; never sends.
 *
 * @param {{templateKey:string, recipient:string, recipientUserId?:string|null,
 *          variables?:object, entityId?:string|null, discriminator?:*,
 *          category?:string}} opts
 * @returns {Promise<{enqueued:boolean, reason?:string, outboxId?:string, error?:string}>}
 */
export async function enqueueEmail({
  templateKey,
  recipient,
  recipientUserId = null,
  variables = {},
  entityId = null,
  discriminator = '',
  category = '',
} = {}) {
  // ── Validation (nothing is written unless every check passes) ──────────────
  const entry = getEmailTemplate(templateKey);
  if (!entry) return { enqueued: false, reason: 'invalid', error: `unknown template key: ${String(templateKey)}` };

  const to = String(recipient ?? '').trim();
  if (!isPlausibleRecipient(to)) return { enqueued: false, reason: 'invalid', error: 'implausible recipient address' };

  // A caller that names a category is asserting what it thinks it is sending.
  // Disagreeing with the registry means one of the two is wrong — refuse rather
  // than quietly send a transactional mail under optional-category rules (which
  // would attach an unsubscribe header we do not honour), or vice versa.
  if (category && String(category) !== entry.category) {
    return { enqueued: false, reason: 'invalid', error: `category '${category}' does not match registry category '${entry.category}'` };
  }

  if (!isPlainObject(variables)) return { enqueued: false, reason: 'invalid', error: 'variables must be a plain object' };
  let variablesJson;
  try {
    variablesJson = JSON.stringify(variables);
  } catch {
    return { enqueued: false, reason: 'invalid', error: 'variables are not serializable' };
  }
  if (typeof variablesJson !== 'string') variablesJson = '{}';
  if (variablesJson.length > MAX_VARIABLES_JSON_CHARS) {
    return { enqueued: false, reason: 'invalid', error: `variables exceed ${MAX_VARIABLES_JSON_CHARS} characters` };
  }

  // ── The invitation kill-switch ─────────────────────────────────────────────
  // invitationsPaused is documented and surfaced ONLY as the beta-waitlist
  // emergency brake (Ops › Beta Waitlist; settingsController) — pre-112 it never
  // touched project-member invites, so pausing those here would be a silent
  // behavior change the UI has no copy for. Scope the gate to the waitlist key.
  if (String(templateKey) === 'invite.waitlist' && (await invitationsArePaused())) {
    return { enqueued: false, reason: 'paused' };
  }

  const idempotencyKey = buildIdempotencyKey({ templateKey, recipient: to, entityId, discriminator });

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.emailOutbox.findFirst({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) return { duplicate: true, id: existing.id };
      const created = await tx.emailOutbox.create({
        data: {
          templateKey: String(templateKey),
          recipient: to,
          recipientUserId: recipientUserId ? String(recipientUserId) : null,
          category: entry.category,
          status: 'pending',
          idempotencyKey,
          entityId: entityId == null || entityId === '' ? null : String(entityId),
          variablesJson,
          attempts: 0,
        },
        select: { id: true },
      });
      return { duplicate: false, id: created.id };
    });

    if (outcome.duplicate) return { enqueued: false, reason: 'duplicate', outboxId: outcome.id };
    kickWorker();
    return { enqueued: true, outboxId: outcome.id };
  } catch (err) {
    console.error('[email-outbox] enqueue failed:', err?.message || err);
    return { enqueued: false, reason: 'error', error: String(err?.message || err).slice(0, 300) };
  }
}
