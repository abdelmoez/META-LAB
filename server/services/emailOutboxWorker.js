/**
 * emailOutboxWorker.js — durable, DB-backed drain for the EmailOutbox
 * (the delivery half of emailOutboxService.js).
 *
 * Same shape as screeningExportWorker: an atomic claim loop (pending → sending
 * behind a `count === 1` guard so two racing drains can never both take a row),
 * a heartbeat, boot + periodic recovery of rows a crash left mid-flight, and a
 * shared attempts cap (server/utils/jobRetry.js) so a poison-pill row cannot
 * loop forever. The one structural difference is what a claimed row DOES: it is
 * rendered from the registry and handed to the mail transport instead of
 * streaming to a file.
 *
 * TERMINAL vs RETRYABLE. Only a transport failure is worth retrying, and only
 * under the cap. Everything else is decided once and never retried:
 *   'skipped_disabled'      — an admin EmailTemplate override turned this
 *                             template off, and the registry says it is
 *                             disableable. (An override that tries to disable a
 *                             transactional template is IGNORED — there is no
 *                             honest way to opt out of your own password reset,
 *                             so the registry, not the override, has the final
 *                             say.)
 *   'skipped_unconfigured'  — no SMTP in this environment. Recorded WITH the
 *                             rendered subject so a dev/preview box still shows
 *                             exactly what would have gone out.
 *   'failed' (permanent)    — the template cannot be rendered, or a required
 *                             variable is missing. A half-rendered email with a
 *                             literal "[link]" in it is worse than no email, so
 *                             missingRequired never sends: it fails with the
 *                             offending token names in lastError.
 *
 * RETRY BACKOFF. A transport failure parks the row in 'sending' with a NULLED
 * heartbeat rather than flipping it straight back to 'pending'. Re-queueing
 * immediately would let the drain loop re-claim the same row in the same pass
 * and burn the whole attempts budget against a dead relay in milliseconds;
 * parking hands the row to the stuck-sweep instead, which re-queues it on the
 * next sweep (≤ STUCK_MS later) — crash recovery and transport backoff become
 * the same mechanism, and both are bounded by the same attempts cap.
 */

import { prisma } from '../db/client.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';
import { getEmailTemplate, renderTemplate } from './emailTemplates.js';
import { sendEmail, isEmailConfigured } from './emailService.js';
import { unsubscribeHeaders } from './emailUnsubscribe.js';
import { enqueueEmail } from './emailOutboxService.js';
import {
  CHAT_DIGEST_TEMPLATE_KEY,
  GENERIC_DIGEST_PREVIEW,
  chatDigestPrefEnabled,
  chatDigestUrl,
  decideChatDigest,
  formatSenderSummary,
  parseSenderNames,
  readChatDigestConfig,
  startOfDayMs,
} from './chatDigestPolicy.js';

/** A 'sending' row whose heartbeat is older than this is treated as abandoned. */
const STUCK_MS = 5 * 60 * 1000;
/** Bound on the claim race retry loop (mirrors screeningExportWorker). */
const MAX_CLAIM_RACES = 1000;
/** lastError is operator-facing text, not a log sink — keep it short. */
const MAX_ERROR_CHARS = 500;
/** How often due chat digests are swept into the outbox. */
const DIGEST_SWEEP_MS = 60 * 1000;
/** Bounded work per digest sweep — a backlog drains over several ticks. */
const MAX_DIGEST_BATCH = 100;

let draining = false;
let sweepTimer = null;
let digestTimer = null;

/**
 * isEmailOutboxWorkerEnabled — EMAIL_OUTBOX_WORKER_ENABLED, default ON.
 * Set it to 'false' to keep a process enqueueing but never sending (useful for
 * a second app instance that should not compete for the queue, and for tests).
 * @returns {boolean}
 */
export function isEmailOutboxWorkerEnabled() {
  const v = process.env.EMAIL_OUTBOX_WORKER_ENABLED;
  if (v === undefined || v === null || String(v).trim() === '') return true;
  return String(v).trim().toLowerCase() !== 'false';
}

/** Bounded, single-line error text for the lastError column. */
function bounded(message, fallback = 'Email send failed') {
  return String(message || fallback).replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_CHARS) || fallback;
}

/** Patch an outbox row; never throws into the worker loop. */
async function patch(id, data) {
  try { await prisma.emailOutbox.update({ where: { id }, data }); } catch { /* best-effort */ }
}

/** Tolerant JSON → plain object (anything else becomes undefined). */
function parseObject(raw) {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return undefined;
}

/** Atomically claim the oldest pending row (pending → sending), or null. */
async function claimNext() {
  for (let race = 0; race < MAX_CLAIM_RACES; race++) {
    const next = await prisma.emailOutbox.findFirst({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return null;
    const claim = await prisma.emailOutbox.updateMany({
      where: { id: next.id, status: 'pending' },
      data: { status: 'sending', heartbeatAt: new Date(), attempts: { increment: 1 } },
    });
    if (claim.count === 1) return prisma.emailOutbox.findUnique({ where: { id: next.id } });
  }
  return null;
}

/**
 * processOutboxRow — render + deliver ONE claimed row. Never throws; always
 * leaves the row in a settled state (or parked for retry). Exported for tests.
 *
 * @param {object} row  a claimed EmailOutbox row (status already 'sending')
 * @param {number} [maxAttempts]
 * @returns {Promise<string>} the status the row ended in, or 'retry' when parked
 */
export async function processOutboxRow(row, maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const entry = getEmailTemplate(row.templateKey);
  if (!entry) {
    // The row names a template that no longer exists (a key was renamed under a
    // queued row). Unrenderable forever → permanent, never retried.
    await patch(row.id, { status: 'failed', lastError: bounded(`Unknown email template: ${row.templateKey}`) });
    return 'failed';
  }

  // Admin copy override for this key, if any (EmailTemplate is edit-by-key).
  let override = null;
  try {
    override = await prisma.emailTemplate.findFirst({ where: { templateKey: row.templateKey } });
  } catch { override = null; } // no override table row / read blip → registry defaults

  if (override && override.enabled === false && entry.disableable) {
    await patch(row.id, { status: 'skipped_disabled', lastError: null });
    return 'skipped_disabled';
  }

  const variables = parseObject(row.variablesJson) || {};
  const overrides = override ? parseObject(override.fieldsJson) : undefined;

  let rendered;
  try {
    rendered = renderTemplate(row.templateKey, variables, { overrides });
  } catch (err) {
    await patch(row.id, { status: 'failed', lastError: bounded(err?.message, 'Email template render failed') });
    return 'failed';
  }

  if (rendered.missingRequired.length) {
    // NEVER send a template with unresolved required tokens — the recipient
    // would get copy containing a literal "[link]". Name the tokens so the fix
    // is obvious from the row alone.
    await patch(row.id, {
      status: 'failed',
      renderedSubject: rendered.subject || null,
      lastError: bounded(`Missing required template variable(s): ${rendered.missingRequired.join(', ')}`),
    });
    return 'failed';
  }

  if (!isEmailConfigured()) {
    await patch(row.id, {
      status: 'skipped_unconfigured',
      renderedSubject: rendered.subject || null,
      lastError: null,
    });
    return 'skipped_unconfigured';
  }

  // List-Unsubscribe rides along ONLY on the disableable (category 'optional')
  // mail, and only when we know which user to key the opt-out token to.
  // Advertising an unsubscribe on a transactional email promises an opt-out we
  // will not honour — unsubscribeHeaders enforces that too, but not sending it
  // a transactional key keeps the intent explicit here.
  let headers;
  if (entry.category === 'optional' && row.recipientUserId) {
    const h = unsubscribeHeaders(row.recipientUserId, row.templateKey);
    if (h && Object.keys(h).length) headers = h;
  }

  const result = await sendEmail({
    to: row.recipient,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    context: row.templateKey,
    ...(headers ? { headers } : {}),
  });

  if (result && result.sent) {
    await patch(row.id, {
      status: 'sent',
      sentAt: new Date(),
      renderedSubject: rendered.subject || null,
      lastError: null,
    });
    return 'sent';
  }

  const reason = bounded(result?.error || result?.reason, 'Email send failed');
  const attempts = Number(row.attempts);
  const exhausted = Number.isFinite(attempts) && attempts >= maxAttempts;
  if (exhausted) {
    await patch(row.id, {
      status: 'failed',
      renderedSubject: rendered.subject || null,
      lastError: bounded(`${reason} (gave up after ${maxAttempts} attempts)`),
    });
    return 'failed';
  }
  // Park for the sweep (see the RETRY BACKOFF note at the top of the file).
  await patch(row.id, {
    status: 'sending',
    heartbeatAt: null,
    renderedSubject: rendered.subject || null,
    lastError: reason,
  });
  return 'retry';
}

/**
 * drainEmailOutbox — claim + process rows one at a time until the queue is
 * empty. Re-entrancy guarded (a kick during a drain is a no-op). Exported so
 * tests can drive the claim loop deterministically instead of racing setImmediate.
 */
export async function drainEmailOutbox() {
  if (draining || !isEmailOutboxWorkerEnabled()) return;
  draining = true;
  try {
    for (;;) {
      const row = await claimNext();
      if (!row) break;
      try {
        await processOutboxRow(row);
      } catch (e) {
        // processOutboxRow is written not to throw; if it ever does, settle the
        // row rather than let one bad message wedge the whole queue.
        console.error('[email-outbox] row failed unexpectedly:', e?.message);
        await patch(row.id, { status: 'failed', lastError: bounded(e?.message, 'Unexpected worker error') });
      }
    }
  } catch (e) {
    console.error('[email-outbox] drain:', e?.message);
  } finally {
    draining = false;
  }
}

/** Kick the worker (call after enqueueing). Idempotent / non-blocking. */
export function kickEmailOutboxWorker() {
  if (!isEmailOutboxWorkerEnabled()) return;
  setImmediate(() => { drainEmailOutbox().catch(() => {}); });
}

/**
 * recoverStuckOutboxEmails — re-queue rows left 'sending' by a crash OR parked
 * by a transport failure, under the shared retry cap; permanently fail the ones
 * whose budget is spent. Pure DB work (does NOT kick the drain) so it is
 * unit-testable in isolation.
 *
 * @param {number} [now]
 * @param {number} [maxAttempts]
 * @returns {Promise<{requeued:number, failed:number}>}
 */
export async function recoverStuckOutboxEmails(now = Date.now(), maxAttempts = DEFAULT_MAX_JOB_ATTEMPTS) {
  const cutoff = now - STUCK_MS;
  const sending = await prisma.emailOutbox.findMany({
    where: { status: 'sending' },
    select: { id: true, attempts: true, heartbeatAt: true, lastError: true },
  });
  const stuck = sending.filter((r) => {
    const last = r.heartbeatAt;
    return !last || new Date(last).getTime() < cutoff;
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const r of giveUp) {
    await patch(r.id, {
      status: 'failed',
      lastError: bounded(r.lastError
        ? `${r.lastError} (gave up after ${maxAttempts} attempts)`
        : `Email abandoned after ${maxAttempts} interrupted attempts.`),
    });
  }
  if (retry.length) {
    await prisma.emailOutbox.updateMany({
      where: { id: { in: retry.map((r) => r.id) } },
      data: { status: 'pending', heartbeatAt: null },
    });
  }
  return { requeued: retry.length, failed: giveUp.length };
}

// ── Chat digests (112.md §2) ──────────────────────────────────────────────────
//
// chatDigestService accumulates one ChatDigestPending row per (recipient,
// project) as messages arrive; this sweep is the other end of that pipe. It is a
// SWEEP rather than a scheduled job per row because "is this burst finished?" is
// only answerable by looking at the clock — there is no event that fires when a
// conversation stops.
//
// Every gate is re-checked HERE, at send time, never trusted from the row: the
// pending row records what was true when the message arrived, and preference,
// membership and read-state can all have changed since. The verdict itself is
// pure (chatDigestPolicy.decideChatDigest) so the matrix is testable without a
// database; this function only does the I/O around it.
//
// AT MOST ONCE PER BURST. The row is deleted after the enqueue, and the enqueue
// is idempotent on (templateKey | recipient | projectId | firstMessageAt). If
// the delete fails, the next sweep re-enqueues the same key and dedupes rather
// than double-sending — at the cost of not re-sending a digest whose
// messageCount grew in between. Under-notifying is the right side of that trade.

/** Delete a settled pending row. Never throws — a failed delete retries next sweep. */
async function deletePendingDigest(id) {
  try { await prisma.chatDigestPending.deleteMany({ where: { id } }); } catch { /* best-effort */ }
}

/**
 * settleChatDigestRow — resolve ONE due pending row: re-read the world, ask the
 * policy, then send / drop / leave it. Exported for tests.
 *
 * @param {object} row  a ChatDigestPending row
 * @param {number} now
 * @param {{quietMs:number, maxMs:number, dailyCap:number}} config
 * @returns {Promise<'sent'|'dropped'|'waiting'>}
 */
export async function settleChatDigestRow(row, now, config) {
  const { quietMs, maxMs, dailyCap } = config;

  const user = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { id: true, email: true, name: true, emailNotifications: true },
  });
  const project = await prisma.screenProject.findUnique({
    where: { id: row.projectId },
    select: { id: true, ownerId: true, title: true, deletedAt: true },
  });

  // MEMBERSHIP — the same shape the chat routes gate on (server/screening/access.js
  // getProjectAccess, used by screeningChatController): a soft-deleted project is
  // nonexistent for everyone including its owner; the owner is always in; anyone
  // else needs a linked member row that is still 'active' (a 'pending' invite
  // cannot act, and an 'inactive' member has been switched off).
  let isMember = false;
  if (user && project && !project.deletedAt) {
    if (project.ownerId === user.id) {
      isMember = true;
    } else {
      const member = await prisma.screenProjectMember.findFirst({
        where: { projectId: row.projectId, userId: row.userId },
        select: { status: true },
      });
      isMember = member?.status === 'active';
    }
  }

  // READ-STATE — ScreenChatRead is the server-authoritative "caught up" marker
  // the chat drawer writes on open (screeningChatController markReadCore).
  let lastReadAt = null;
  if (isMember) {
    try {
      const read = await prisma.screenChatRead.findUnique({
        where: { projectId_userId: { projectId: row.projectId, userId: row.userId } },
        select: { lastReadAt: true },
      });
      lastReadAt = read?.lastReadAt ?? null;
    } catch { lastReadAt = null; }
  }

  const base = {
    now,
    firstMessageAt: row.firstMessageAt,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount,
    quietMs,
    maxMs,
    dailyCap,
    prefEnabled: Boolean(user?.email) && chatDigestPrefEnabled(user.emailNotifications),
    isMember,
    lastReadAt,
    sentToday: 0,
  };

  // The daily cap is the only gate that costs a COUNT over the whole outbox, and
  // decideChatDigest reaches it last — so probe with 0 first and pay for the real
  // number only when every cheaper gate has already passed.
  let decision = decideChatDigest(base);
  if (decision.action === 'send') {
    let sentToday = 0;
    try {
      sentToday = await prisma.emailOutbox.count({
        where: {
          templateKey: CHAT_DIGEST_TEMPLATE_KEY,
          recipientUserId: row.userId,
          createdAt: { gte: new Date(startOfDayMs(now)) },
        },
      });
    } catch { sentToday = 0; }
    decision = decideChatDigest({ ...base, sentToday });
  }

  if (decision.action === 'wait') return 'waiting';
  if (decision.action === 'drop') {
    await deletePendingDigest(row.id);
    return 'dropped';
  }

  const queued = await enqueueEmail({
    templateKey: CHAT_DIGEST_TEMPLATE_KEY,
    recipient: user.email,
    recipientUserId: user.id,
    category: 'optional',
    variables: {
      // Absent recipientName is fine — the greeting paragraph is @if-guarded.
      ...(user.name ? { recipientName: user.name } : {}),
      projectName: project.title || 'your project',
      senderSummary: formatSenderSummary(parseSenderNames(row.senderNamesJson)),
      messageCount: row.messageCount,
      // ChatDigestPending stores no message text, so there is nothing to quote
      // (see GENERIC_DIGEST_PREVIEW). `preview` is a required variable, so it has
      // to resolve non-empty or the worker would fail the row on render.
      preview: GENERIC_DIGEST_PREVIEW,
      chatUrl: chatDigestUrl(row.projectId, process.env.APP_BASE_URL),
    },
    entityId: row.projectId,
    // firstMessageAt is the BURST identity: it is fixed for the life of the row
    // (only lastMessageAt/messageCount grow), so a re-swept row dedupes while the
    // next burst — a new row with a new firstMessageAt — sends.
    // Safe to format: decideChatDigest already dropped unparseable timestamps.
    discriminator: new Date(row.firstMessageAt).toISOString(),
  });

  // 'error' is the outbox telling us the DB refused the write — keep the pending
  // row so the next sweep retries. Every other outcome is settled (a 'duplicate'
  // means the digest is already queued; 'invalid' can only be a programming
  // error that re-running will reproduce).
  if (!queued.enqueued && queued.reason === 'error') return 'waiting';
  await deletePendingDigest(row.id);
  return queued.enqueued || queued.reason === 'duplicate' ? 'sent' : 'dropped';
}

/**
 * sweepChatDigests — find every pending digest whose quiet OR max window has
 * opened and settle it. Pure DB work (enqueue only — the drain loop sends), so
 * it is unit-testable in isolation. Never throws.
 *
 * @param {number} [now]
 * @param {{quietMs:number, maxMs:number, dailyCap:number}} [config]
 * @returns {Promise<{sent:number, dropped:number, waiting:number}>}
 */
export async function sweepChatDigests(now = Date.now(), config = readChatDigestConfig()) {
  const totals = { sent: 0, dropped: 0, waiting: 0 };
  let rows;
  try {
    rows = await prisma.chatDigestPending.findMany({
      where: {
        OR: [
          { lastMessageAt: { lte: new Date(now - config.quietMs) } },
          { firstMessageAt: { lte: new Date(now - config.maxMs) } },
        ],
      },
      orderBy: { firstMessageAt: 'asc' },
      take: MAX_DIGEST_BATCH,
    });
  } catch (e) {
    console.error('[chat-digest] sweep query failed:', e?.message);
    return totals;
  }
  for (const row of rows || []) {
    try {
      totals[await settleChatDigestRow(row, now, config)] += 1;
    } catch (e) {
      // One unreadable row must not starve the rest of the batch.
      console.error('[chat-digest] row failed:', e?.message);
    }
  }
  return totals;
}

/**
 * startEmailOutboxWorker — boot hook. Recovers interrupted/parked rows, arms the
 * periodic stuck sweep and the chat-digest sweep (both unref'd — neither holds
 * the process open), then drains. Idempotent.
 */
export async function startEmailOutboxWorker() {
  if (!isEmailOutboxWorkerEnabled()) {
    console.log('[email-outbox] worker disabled (EMAIL_OUTBOX_WORKER_ENABLED=false)');
    return;
  }
  try {
    const { requeued, failed } = await recoverStuckOutboxEmails();
    if (requeued) console.log(`[email-outbox] re-queued ${requeued} stuck email(s)`);
    if (failed) console.warn(`[email-outbox] failed ${failed} email(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[email-outbox] startup failed:', e?.message);
  }
  if (!sweepTimer) {
    sweepTimer = setInterval(async () => {
      try {
        const { requeued } = await recoverStuckOutboxEmails();
        if (requeued) { console.log(`[email-outbox] periodic sweep re-queued ${requeued} email(s)`); kickEmailOutboxWorker(); }
      } catch (e) { console.error('[email-outbox] periodic sweep failed:', e?.message); }
    }, STUCK_MS);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }
  if (!digestTimer) {
    // Ticks far more often than the quiet window (60s vs 5min default) so a
    // digest goes out close to when it becomes due rather than up to a whole
    // window late. Enqueue-only, so a tick costs nothing when nothing is due.
    digestTimer = setInterval(async () => {
      try {
        const { sent } = await sweepChatDigests();
        if (sent) console.log(`[chat-digest] queued ${sent} digest email(s)`);
      } catch (e) { console.error('[chat-digest] sweep failed:', e?.message); }
    }, DIGEST_SWEEP_MS);
    if (typeof digestTimer.unref === 'function') digestTimer.unref();
  }
  kickEmailOutboxWorker();
}
