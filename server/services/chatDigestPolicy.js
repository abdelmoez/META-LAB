/**
 * chatDigestPolicy.js — the PURE decision layer for project-chat email digests
 * (112.md §2, DELIVERY side).
 *
 * chatDigestService.js owns the accumulation half: one ChatDigestPending row per
 * (recipient, project), grown by every message. This module owns the question
 * that row cannot answer for itself — *should this burst become an email yet,
 * and is it still honest to send it?* — and answers it without touching a
 * database, a clock or an environment it did not receive as an argument.
 *
 * WHY A SEPARATE MODULE. The sweep in emailOutboxWorker.js is five sequential
 * reads (user, project, membership, read-state, today's outbox count) wrapped
 * around ONE verdict. Leaving the verdict inline would mean the only way to test
 * "a user who read the thread 3 seconds after the last message must never be
 * emailed" is to stand up five fake prisma delegates. Extracted, that case is
 * one function call.
 *
 * THE WINDOWS. A digest waits for the conversation to go quiet (QUIET_MS since
 * the LAST message) so a live back-and-forth produces one email instead of ten.
 * A thread that never goes quiet would otherwise never send at all, so MAX_MS
 * since the FIRST message forces it out. Either window opening is enough.
 *
 * THE RE-CHECKS. Everything true when the row was written can be false by the
 * time it is due: the user may have switched the preference off, been removed
 * from the project, or simply opened the chat and read every message. Each of
 * those makes the row garbage, not a later send — so they resolve to 'drop'
 * (delete the row), never to 'wait'.
 *
 * VERDICTS
 *   'wait' — neither window is open yet. Leave the row alone.
 *   'drop' — this row will never become a legitimate email. Delete it, send nothing.
 *   'send' — enqueue the digest, then delete the row.
 */

import { parseEmailPreferences } from './emailUnsubscribe.js';

/** Registry key this policy sends under. */
export const CHAT_DIGEST_TEMPLATE_KEY = 'chat.digest';

/** Quiet period since the LAST message before a burst is mailed. */
export const DEFAULT_QUIET_MS = 5 * 60 * 1000;
/** Hard ceiling since the FIRST message — a never-quiet thread still gets mailed. */
export const DEFAULT_MAX_MS = 30 * 60 * 1000;
/** Digests per user per (UTC) day. A busy reviewer is not a mailing list. */
export const DEFAULT_DAILY_CAP = 10;

/** Senders named before the summary collapses to "and N others". */
export const MAX_NAMED_SENDERS = 2;

/**
 * ChatDigestPending carries no message text (see the model — userId, projectId,
 * firstMessageAt, lastMessageAt, messageCount, senderNamesJson and nothing
 * else), so the digest cannot quote the conversation. Rather than send a
 * template with an empty required `preview`, the sweep substitutes this generic
 * line. If a preview column is ever added to the pending row, pass it through
 * and this constant becomes the fallback instead of the only value.
 */
export const GENERIC_DIGEST_PREVIEW = 'New messages are waiting in the project chat.';

/** Path (relative to APP_BASE_URL) of the workspace whose chat drawer this is. */
export const CHAT_PROJECT_PATH = '/sift-beta/projects';

/** Date | number | ISO string → epoch ms, or NaN. */
function ms(value) {
  if (value === null || value === undefined) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? NaN : t;
}

/** A non-negative integer from env-ish input, or the fallback. */
function nonNegative(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * readChatDigestConfig — the three tunables, read from an injected env bag so
 * the sweep's timing is testable without mutating process.env.
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{quietMs:number, maxMs:number, dailyCap:number}}
 */
export function readChatDigestConfig(env = process.env) {
  const e = env || {};
  return {
    quietMs: nonNegative(e.EMAIL_CHAT_DIGEST_QUIET_MS, DEFAULT_QUIET_MS),
    maxMs: nonNegative(e.EMAIL_CHAT_DIGEST_MAX_MS, DEFAULT_MAX_MS),
    dailyCap: nonNegative(e.EMAIL_CHAT_DIGEST_DAILY_CAP, DEFAULT_DAILY_CAP),
  };
}

/**
 * chatDigestPrefEnabled — the recipient's consent, read from the
 * User.emailNotifications blob.
 *
 * STRICT OPT-IN on `projectChat` (matching chatDigestService and the schema
 * comment): absent, null or malformed means NO digest. This is a new email
 * class and nobody is subscribed to it by default.
 *
 * ALSO honours a `chat.digest: false` flag. The outbox worker attaches a
 * List-Unsubscribe header to every category-'optional' row, and the one-click
 * endpoint writes the TEMPLATE KEY into the same blob — so without this second
 * read the header would advertise an opt-out we then ignored.
 *
 * @param {string|object|null} raw  stored emailNotifications value
 * @returns {boolean}
 */
export function chatDigestPrefEnabled(raw) {
  const prefs = parseEmailPreferences(raw);
  return prefs.projectChat === true && prefs[CHAT_DIGEST_TEMPLATE_KEY] !== false;
}

/** Defensive parse of senderNamesJson — always a trimmed, de-duplicated string[]. */
export function parseSenderNames(raw) {
  let arr;
  try {
    arr = JSON.parse(raw || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const n of arr) {
    if (typeof n !== 'string') continue;
    const s = n.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * formatSenderSummary — "A", "A and B", "A, B and 3 others".
 *
 * Never returns empty: a digest whose senders are all blank still has to name
 * someone, and "A teammate posted…" is honest where "" would render a sentence
 * starting mid-air.
 *
 * @param {string[]} names
 * @param {number} [maxNamed]
 * @returns {string}
 */
export function formatSenderSummary(names, maxNamed = MAX_NAMED_SENDERS) {
  const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n.trim()) : [];
  const limit = Math.max(1, Number(maxNamed) || MAX_NAMED_SENDERS);
  if (!list.length) return 'A teammate';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  const named = list.slice(0, limit);
  const others = list.length - named.length;
  return `${named.join(', ')} and ${others} other${others === 1 ? '' : 's'}`;
}

/**
 * startOfDayMs — UTC midnight for the daily cap window. UTC (not server-local)
 * so the cap boundary is the same on every instance and reproducible in tests.
 * @param {Date|number|string} now
 * @returns {number}
 */
export function startOfDayMs(now) {
  const t = ms(now);
  const d = new Date(Number.isFinite(t) ? t : Date.now());
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * chatDigestUrl — absolute link to the project whose chat this digest is about.
 *
 * Chat is a drawer on the project page rather than a route of its own, so there
 * is no deeper anchor to link to; the project page is the closest honest target.
 * Mirrors invitationService's URL building: a missing APP_BASE_URL degrades to a
 * root-relative path rather than blocking the send.
 *
 * @param {string} projectId
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function chatDigestUrl(projectId, baseUrl = '') {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  return `${base}${CHAT_PROJECT_PATH}/${encodeURIComponent(String(projectId ?? ''))}`;
}

/**
 * decideChatDigest — the whole verdict, as one pure function.
 *
 * Gate ORDER is the contract, not an implementation detail: the windows come
 * first (a row that is not due yet is not evaluated at all), and the daily cap
 * comes LAST so the sweep can probe with sentToday=0 and pay for the outbox
 * COUNT only when every cheaper gate has already passed.
 *
 * @param {object} input
 * @param {Date|number|string} input.now
 * @param {Date|number|string} input.firstMessageAt
 * @param {Date|number|string} input.lastMessageAt
 * @param {number} input.messageCount
 * @param {number} [input.quietMs]
 * @param {number} [input.maxMs]
 * @param {boolean} input.prefEnabled   projectChat opt-in still true
 * @param {boolean} input.isMember      still an active member (or the owner)
 * @param {Date|number|string|null} [input.lastReadAt]  ScreenChatRead.lastReadAt
 * @param {number} [input.sentToday]    chat.digest outbox rows today
 * @param {number} [input.dailyCap]
 * @returns {{action:'send'|'drop'|'wait', reason:string}}
 */
export function decideChatDigest(input = {}) {
  const now = ms(input.now);
  const first = ms(input.firstMessageAt);
  const last = ms(input.lastMessageAt);
  const quietMs = Number.isFinite(input.quietMs) ? input.quietMs : DEFAULT_QUIET_MS;
  const maxMs = Number.isFinite(input.maxMs) ? input.maxMs : DEFAULT_MAX_MS;
  const count = Number(input.messageCount);

  // A row we cannot reason about can never become a defensible email, and
  // leaving it would make it immortal — every sweep would re-examine it forever.
  if (!Number.isFinite(now) || !Number.isFinite(first) || !Number.isFinite(last)) {
    return { action: 'drop', reason: 'malformed_timestamps' };
  }
  if (!Number.isFinite(count) || count <= 0) return { action: 'drop', reason: 'empty' };

  const quietElapsed = now - last >= quietMs;
  const maxElapsed = now - first >= maxMs;
  if (!quietElapsed && !maxElapsed) return { action: 'wait', reason: 'window_open' };

  if (input.prefEnabled !== true) return { action: 'drop', reason: 'pref_off' };
  if (input.isMember !== true) return { action: 'drop', reason: 'not_member' };

  // Read-state suppression. The user already saw everything this row describes,
  // so the email would be a notification about nothing.
  const read = ms(input.lastReadAt);
  if (Number.isFinite(read) && read >= last) return { action: 'drop', reason: 'already_read' };

  const dailyCap = Number.isFinite(input.dailyCap) ? input.dailyCap : DEFAULT_DAILY_CAP;
  const sentToday = Number(input.sentToday) || 0;
  // Over the cap the row is DROPPED, not deferred: carrying it to tomorrow would
  // deliver a digest about a day-old conversation nobody is still waiting on.
  if (sentToday >= dailyCap) return { action: 'drop', reason: 'daily_cap' };

  return { action: 'send', reason: quietElapsed ? 'quiet' : 'max_age' };
}
