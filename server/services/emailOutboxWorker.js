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
 *
 * PERMANENT vs TRANSIENT TRANSPORT FAILURE. sendEmail classifies its own
 * failures: `permanent: true` is an SMTP 5xx-class reject, and the reason
 * 'recipients_skipped' means the staging recipient policy dropped every address.
 * Neither gets better by being retried — parking a 550 just re-hammers the relay
 * with a message it has already refused — so both settle the row as 'failed'
 * immediately. Only an unclassified/transient 'send_failed' takes the park path.
 *
 * TERMINAL ROWS CARRY NO VARIABLES. Every terminal patch goes through
 * settleTerminal(), which also blanks variablesJson. That blob is the RENDER
 * INPUT — for 'invite.waitlist' and the password-reset copy it holds a link
 * containing a raw single-use token — and a settled row is history, never
 * rendered again (an admin "resend" mints a fresh row). renderedSubject is kept:
 * that is what the Ops delivery list shows.
 *
 * NO LOST WAKEUPS. A kick that arrives while a drain is running is RECORDED
 * (kickPending) instead of dropped, and the drain repeats its pass until one
 * completes with no kick behind it. Without that, a row committed just after the
 * running pass's last claim query would wait for the periodic sweep. And that
 * sweep is now the backstop it was always meant to be: it kicks the drain on
 * EVERY tick, not only when it re-queued something — recoverStuckOutboxEmails
 * looks at 'sending' rows only, so 'pending' rows enqueued by ANOTHER instance
 * (or orphaned by a crash between the enqueue and its kick) are invisible to it.
 *
 * INVITATION RECONCILIATION. invitationService hands an invite to this queue and
 * records WaitlistInvitation.emailStatus = 'queued'; the authoritative delivery
 * outcome only exists here. Terminal 'invite.waitlist' rows write it back
 * (best-effort) so the Ops list does not show every invite as queued forever.
 */

import { prisma } from '../db/client.js';
import { DEFAULT_MAX_JOB_ATTEMPTS, partitionStuckJobs } from '../utils/jobRetry.js';
import { getEmailTemplate, renderTemplate } from './emailTemplates.js';
import { sendEmail, isEmailConfigured } from './emailService.js';
import { unsubscribeHeaders } from './emailUnsubscribe.js';
import { enqueueEmail } from './emailOutboxService.js';
import { MAX_DIGEST_SENDER_NAMES } from './chatDigestService.js';
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
/** A kick that landed mid-drain. Cleared at the start of every drain pass. */
let kickPending = false;
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

/**
 * reconcileInvitationEmail — write a terminal delivery outcome back onto the
 * WaitlistInvitation the row was minted for.
 *
 * invitationService.sendInvitationEmail only knows that the hand-off to this
 * queue succeeded, so it records emailStatus = 'queued'; nothing ever moved that
 * forward, leaving every invite in the Ops list permanently "queued" — including
 * the ones that bounced. Only the two DELIVERY verdicts map onto emailStatus: a
 * 'skipped_*' row means this instance had nothing to hand off to, not that the
 * invite failed, so those keep the 'queued' hand-off marker and the outbox row
 * stays the authority.
 *
 * LAZY IMPORT is required, not stylistic: invitationService → emailOutboxService
 * → (dynamic) this module, so a static import here would close the cycle at
 * module-evaluation time. Best-effort throughout — reconciliation is bookkeeping
 * and must never turn a delivered email into a failed row.
 *
 * @param {{templateKey?:string, entityId?:string|null}} row
 * @param {string} status  the terminal status just written
 * @param {string} [error] lastError for a failed outcome
 */
async function reconcileInvitationEmail(row, status, error) {
  if (!row || row.templateKey !== 'invite.waitlist' || !row.entityId) return;
  if (status !== 'sent' && status !== 'failed') return;
  try {
    const { recordInvitationEmailResult } = await import('./invitationService.js');
    await recordInvitationEmailResult(
      row.entityId,
      status === 'sent' ? { status: 'sent' } : { status: 'failed', error: error || 'Email delivery failed' },
    );
  } catch (e) {
    console.error('[email-outbox] invitation reconcile failed:', e?.message);
  }
}

/**
 * settleTerminal — patch a row into a TERMINAL state ('sent' | 'failed' |
 * 'skipped_unconfigured' | 'skipped_disabled'). EVERY terminal write goes
 * through here so two things happen exactly once, everywhere:
 *
 *   1. variablesJson is blanked. The blob exists to RENDER the message and
 *      nothing else, and for 'invite.waitlist' it contains the accept link with
 *      a raw single-use token in it (same for a password-reset link). A settled
 *      row is history — renderedSubject is what an operator reads — so keeping
 *      the plaintext token in the table forever buys nothing and risks
 *      everything. A retry does still need it, which is why the PARK path below
 *      deliberately does not come through here.
 *   2. A waitlist invitation learns its delivery outcome.
 *
 * @param {object} row  the row being settled (needs id, templateKey, entityId)
 * @param {object} data the terminal patch (must include `status`)
 */
async function settleTerminal(row, data) {
  await patch(row.id, { ...data, variablesJson: '{}' });
  await reconcileInvitationEmail(row, data.status, data.lastError);
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
    await settleTerminal(row, { status: 'failed', lastError: bounded(`Unknown email template: ${row.templateKey}`) });
    return 'failed';
  }

  // Admin copy override for this key, if any (EmailTemplate is edit-by-key).
  // ORDERED: the table has no unique constraint on templateKey, so a historic
  // double-write can leave two override rows for one key. An unordered findFirst
  // would then resolve to whichever row the planner happened to return, and the
  // same queue could render two different subjects. Oldest wins, deterministically.
  let override = null;
  try {
    override = await prisma.emailTemplate.findFirst({
      where: { templateKey: row.templateKey },
      orderBy: { createdAt: 'asc' },
    });
  } catch { override = null; } // no override table row / read blip → registry defaults

  if (override && override.enabled === false && entry.disableable) {
    await settleTerminal(row, { status: 'skipped_disabled', lastError: null });
    return 'skipped_disabled';
  }

  const variables = parseObject(row.variablesJson) || {};
  const overrides = override ? parseObject(override.fieldsJson) : undefined;

  let rendered;
  try {
    rendered = renderTemplate(row.templateKey, variables, { overrides });
  } catch (err) {
    await settleTerminal(row, { status: 'failed', lastError: bounded(err?.message, 'Email template render failed') });
    return 'failed';
  }

  if (rendered.missingRequired.length) {
    // NEVER send a template with unresolved required tokens — the recipient
    // would get copy containing a literal "[link]". Name the tokens so the fix
    // is obvious from the row alone.
    await settleTerminal(row, {
      status: 'failed',
      renderedSubject: rendered.subject || null,
      lastError: bounded(`Missing required template variable(s): ${rendered.missingRequired.join(', ')}`),
    });
    return 'failed';
  }

  if (!isEmailConfigured()) {
    await settleTerminal(row, {
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
    await settleTerminal(row, {
      status: 'sent',
      sentAt: new Date(),
      renderedSubject: rendered.subject || null,
      lastError: null,
    });
    return 'sent';
  }

  const reason = bounded(result?.error || result?.reason, 'Email send failed');

  // PERMANENT REJECT → terminal now, no park, no retry. sendEmail flags an SMTP
  // 5xx-class refusal with `permanent: true`; 'recipients_skipped' means the
  // staging recipient policy dropped every address, which is a configuration
  // fact, not a transport blip. Retrying either one only re-sends a message the
  // relay has already refused (and burns the attempts budget doing it), so the
  // row is settled with the provider's own words in lastError.
  if (result && (result.permanent === true || result.reason === 'recipients_skipped')) {
    await settleTerminal(row, {
      status: 'failed',
      renderedSubject: rendered.subject || null,
      lastError: reason,
    });
    return 'failed';
  }

  const attempts = Number(row.attempts);
  const exhausted = Number.isFinite(attempts) && attempts >= maxAttempts;
  if (exhausted) {
    await settleTerminal(row, {
      status: 'failed',
      renderedSubject: rendered.subject || null,
      lastError: bounded(`${reason} (gave up after ${maxAttempts} attempts)`),
    });
    return 'failed';
  }
  // Park for the sweep (see the RETRY BACKOFF note at the top of the file). NOT
  // settleTerminal: a parked row is going to be rendered again, so it keeps its
  // variablesJson — the blob is only scrubbed once the row stops being a message.
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
 * empty. Re-entrancy guarded, and NO KICK IS LOST: a caller that arrives while a
 * drain is in flight records the wakeup instead of returning silently, and the
 * running drain repeats its pass until one completes with nothing behind it.
 *
 * The race that costs: an enqueue commits, its kick lands here while `draining`
 * is still true, and the running pass's claim query had ALREADY run (and seen
 * nothing) before that commit became visible. Dropping the kick there stranded
 * the row until the next 5-minute sweep. Re-running the pass costs one indexed
 * findFirst and closes the window — the flag is cleared BEFORE each pass, so a
 * kick arriving during a pass is always honoured by the next one.
 *
 * Exported so tests can drive the claim loop deterministically instead of racing
 * setImmediate.
 */
export async function drainEmailOutbox() {
  if (!isEmailOutboxWorkerEnabled()) return;
  if (draining) { kickPending = true; return; }
  draining = true;
  try {
    do {
      kickPending = false;
      for (;;) {
        const row = await claimNext();
        if (!row) break;
        try {
          await processOutboxRow(row);
        } catch (e) {
          // processOutboxRow is written not to throw; if it ever does, settle the
          // row rather than let one bad message wedge the whole queue.
          console.error('[email-outbox] row failed unexpectedly:', e?.message);
          await settleTerminal(row, { status: 'failed', lastError: bounded(e?.message, 'Unexpected worker error') });
        }
      }
      // No await between the last claim and this check, so nothing can slip in
      // between "the queue is empty" and "we stopped draining".
    } while (kickPending);
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
    // templateKey + entityId ride along so the give-up branch can settle the row
    // properly (invitation reconciliation) without a second read per row.
    select: { id: true, attempts: true, heartbeatAt: true, lastError: true, templateKey: true, entityId: true },
  });
  const stuck = sending.filter((r) => {
    const last = r.heartbeatAt;
    return !last || new Date(last).getTime() < cutoff;
  });
  if (!stuck.length) return { requeued: 0, failed: 0 };
  const { giveUp, retry } = partitionStuckJobs(stuck, maxAttempts);
  for (const r of giveUp) {
    await settleTerminal(r, {
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

/**
 * runOutboxSweepTick — one periodic maintenance tick: recover stuck/parked rows,
 * then ALWAYS kick the drain.
 *
 * The kick is UNCONDITIONAL, and that is the whole point of this function. It
 * used to fire only `if (requeued)`, which made the queue's only guaranteed
 * drain trigger the enqueue-time kick — and recoverStuckOutboxEmails queries
 * status 'sending', so it can never see a stranded 'pending' row. Any pending
 * row this process did not itself enqueue (another app instance with the worker
 * disabled, a crash between the DB commit and the setImmediate, a wakeup lost to
 * the drain race) therefore sat in the table indefinitely. An empty kick costs
 * one indexed findFirst; a stranded email costs a user their invitation.
 *
 * Exported so the guarantee is unit-testable without driving a 5-minute
 * interval. Never throws — a recovery failure still kicks.
 *
 * @returns {Promise<{requeued:number, failed:number}>}
 */
export async function runOutboxSweepTick() {
  let result = { requeued: 0, failed: 0 };
  try {
    result = await recoverStuckOutboxEmails();
    if (result.requeued) console.log(`[email-outbox] periodic sweep re-queued ${result.requeued} email(s)`);
    if (result.failed) console.warn(`[email-outbox] periodic sweep failed ${result.failed} email(s) over the retry cap (${DEFAULT_MAX_JOB_ATTEMPTS})`);
  } catch (e) {
    console.error('[email-outbox] periodic sweep failed:', e?.message);
  }
  kickEmailOutboxWorker();
  return result;
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
//
// ONE BURST PER (USER, PROJECT), NOT ONE PER ROW. ChatDigestPending has an
// @@index — deliberately NOT a @@unique — on (userId, projectId), so
// chatDigestService's findFirst-then-write accumulation is racy by design: two
// chat posts landing at the same instant can each miss the other's row and
// create TWINS, two pending rows for the same pair with different
// firstMessageAt. firstMessageAt is the burst identity, so untreated twins
// enqueue under two different idempotency keys and the recipient gets two emails
// about one conversation. settleChatDigestRow therefore reads EVERY row for the
// pair, folds them into one burst, and decides + enqueues exactly once.

/** Delete settled pending rows by id. Never throws — a failed delete retries next sweep. */
async function deletePendingDigests(ids) {
  if (!ids || !ids.length) return;
  try { await prisma.chatDigestPending.deleteMany({ where: { id: { in: ids } } }); } catch { /* best-effort */ }
}

/**
 * coalesceChatDigestRows — fold every pending row for one (user, project) into a
 * single burst: earliest start, latest activity, summed count, unioned senders.
 *
 * The identity (firstMessageAt) is the MINIMUM so the merged burst dedupes
 * against whichever twin a previous sweep may already have enqueued, and
 * lastMessageAt is the MAXIMUM so a twin that is still receiving messages holds
 * the whole burst back rather than mailing half of it early.
 *
 * @param {object[]} rows      every ChatDigestPending row for the pair
 * @param {object} fallback    the row the sweep selected (raw timestamp fallback)
 * @returns {{ids:string[], firstMessageAt:*, lastMessageAt:*, messageCount:number, senderNames:string[]}}
 */
function coalesceChatDigestRows(rows, fallback) {
  const ids = [];
  const senderNames = [];
  let first = null;
  let last = null;
  let messageCount = 0;
  for (const r of rows || []) {
    if (!r || r.id === undefined || r.id === null) continue;
    if (!ids.includes(r.id)) ids.push(r.id);
    const f = new Date(r.firstMessageAt).getTime();
    const l = new Date(r.lastMessageAt).getTime();
    if (Number.isFinite(f) && (first === null || f < first)) first = f;
    if (Number.isFinite(l) && (last === null || l > last)) last = l;
    const n = Number(r.messageCount);
    if (Number.isFinite(n) && n > 0) messageCount += n;
    for (const name of parseSenderNames(r.senderNamesJson)) {
      if (senderNames.length >= MAX_DIGEST_SENDER_NAMES) break;
      if (!senderNames.includes(name)) senderNames.push(name);
    }
  }
  return {
    ids,
    // When nothing parsed, hand the RAW values straight through so
    // decideChatDigest reports 'malformed_timestamps' and drops the burst —
    // inventing a timestamp here would mail a digest we cannot date.
    firstMessageAt: first === null ? fallback?.firstMessageAt : new Date(first),
    lastMessageAt: last === null ? fallback?.lastMessageAt : new Date(last),
    messageCount,
    senderNames,
  };
}

/**
 * settleChatDigestRow — resolve ONE due (user, project) burst: coalesce its
 * pending rows, re-read the world, ask the policy, then send / drop / leave it.
 * Exported for tests.
 *
 * ACCEPTED RACE. A message that arrives between the coalescing read and the
 * delete bumps lastMessageAt/messageCount on a row we have already read, and the
 * delete then removes it anyway — that message is folded into no digest. This is
 * the same under-notify trade the delete-after-enqueue note above makes, and it
 * is bounded by one sweep's duration. The delete names ONLY the ids actually
 * read, so a row CREATED in that window (a new burst, new firstMessageAt)
 * survives and mails on the next sweep.
 *
 * @param {object} row  a ChatDigestPending row
 * @param {number} now
 * @param {{quietMs:number, maxMs:number, dailyCap:number}} config
 * @returns {Promise<'sent'|'dropped'|'waiting'>}
 */
export async function settleChatDigestRow(row, now, config) {
  const { quietMs, maxMs, dailyCap } = config;

  // COALESCE FIRST — see the ONE BURST PER (USER, PROJECT) note above.
  let siblings;
  try {
    siblings = await prisma.chatDigestPending.findMany({
      where: { userId: row.userId, projectId: row.projectId },
    });
  } catch {
    // The read failed, not the pair. Degrade to the single row we were handed
    // rather than skipping the digest entirely.
    siblings = [row];
  }
  if (Array.isArray(siblings) && !siblings.length) {
    // Another sweep (or another instance) already settled and deleted this pair.
    // Enqueueing again would be a second email for a burst that is already out.
    return 'dropped';
  }
  const burst = coalesceChatDigestRows(siblings, row);

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
    firstMessageAt: burst.firstMessageAt,
    lastMessageAt: burst.lastMessageAt,
    messageCount: burst.messageCount,
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
    await deletePendingDigests(burst.ids);
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
      senderSummary: formatSenderSummary(burst.senderNames),
      messageCount: burst.messageCount,
      // ChatDigestPending stores no message text, so there is nothing to quote
      // (see GENERIC_DIGEST_PREVIEW). `preview` is a required variable, so it has
      // to resolve non-empty or the worker would fail the row on render.
      preview: GENERIC_DIGEST_PREVIEW,
      chatUrl: chatDigestUrl(row.projectId, process.env.APP_BASE_URL),
    },
    entityId: row.projectId,
    // firstMessageAt is the BURST identity: it is fixed for the life of a row
    // (only lastMessageAt/messageCount grow), so a re-swept burst dedupes while
    // the next burst — a new row with a new firstMessageAt — sends. Coalesced to
    // the MINIMUM across the pair's rows, so racing twins resolve to one key.
    // Safe to format: decideChatDigest already dropped unparseable timestamps.
    discriminator: new Date(burst.firstMessageAt).toISOString(),
  });

  // 'error' is the outbox telling us the DB refused the write — keep the pending
  // row so the next sweep retries. Every other outcome is settled (a 'duplicate'
  // means the digest is already queued; 'invalid' can only be a programming
  // error that re-running will reproduce).
  if (!queued.enqueued && queued.reason === 'error') return 'waiting';
  await deletePendingDigests(burst.ids);
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
  // settleChatDigestRow settles a whole (user, project) pair, so a batch holding
  // both halves of a racing twin must not settle it twice: the second call would
  // find the pair already deleted and count a phantom drop.
  const settled = new Set();
  for (const row of rows || []) {
    const pair = `${row?.userId}|${row?.projectId}`;
    if (settled.has(pair)) continue;
    settled.add(pair);
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
    sweepTimer = setInterval(() => { runOutboxSweepTick().catch(() => {}); }, STUCK_MS);
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
