/**
 * chatDigestService.js — 112.md §2 (project-chat email digests, pending side).
 *
 * On every chat message we UPSERT one ChatDigestPending row per opted-in
 * recipient (never the sender). The outbox worker later turns quiet/aged rows
 * into a single 'chat.digest' email — this module never sends anything.
 *
 * Pure by construction: callers inject { prisma, now } so the accumulation
 * matrix is testable with a fake client and a fixed clock. The preference gate
 * is strict opt-IN (`projectChat === true`): absent/null/malformed blobs mean
 * no digest, because this is a new email class (see profileController).
 *
 * ChatDigestPending has @@index (not @@unique) on (userId, projectId) — same
 * live-table rule as EmailOutbox — so the upsert is findFirst-then-write. A
 * racing double-insert is harmless: the worker sweep emails at most one digest
 * per (user, project, window) via the outbox idempotency key and deletes every
 * matching pending row.
 */

import { prisma as defaultPrisma } from '../db/client.js';
import { parseEmailPreferences } from './emailUnsubscribe.js';

/** Most sender names kept on a pending row; the email shows "A, B and N others". */
export const MAX_DIGEST_SENDER_NAMES = 5;

/** Plain-text one-line preview: trim, collapse whitespace, hard-cap 140 chars. */
export function safeChatPreview(text) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= 140) return s;
  return `${s.slice(0, 139).trimEnd()}…`;
}

/** Parse a senderNamesJson blob defensively — always a string array. */
function parseSenderNames(raw) {
  try {
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.filter(n => typeof n === 'string') : [];
  } catch { return []; }
}

/**
 * Record one chat message against every opted-in recipient's pending digest.
 *
 * @param {object} args
 * @param {string} args.projectId   ScreenProject id (the chat thread key)
 * @param {string} args.senderId    userId of the author — never digested to
 * @param {string} args.senderName  display name shown in the digest summary
 * @param {Array<{userId: string|null, emailNotifications: string|null}>} args.members
 *   candidate recipients (caller passes active members + owner; pending
 *   invite rows with null userId are skipped here)
 * @param {object} [args.prisma]    injectable client (tests)
 * @param {Date}   [args.now]       injectable clock (tests)
 * @returns {Promise<{recorded: number}>} count of rows created/updated
 */
export async function recordChatMessage({ projectId, senderId, senderName, members, prisma = defaultPrisma, now = new Date() }) {
  if (!projectId || !Array.isArray(members)) return { recorded: 0 };
  const seen = new Set();
  const recipients = [];
  for (const m of members) {
    if (!m?.userId || m.userId === senderId || seen.has(m.userId)) continue;
    seen.add(m.userId);
    if (parseEmailPreferences(m.emailNotifications).projectChat === true) recipients.push(m.userId);
  }
  let recorded = 0;
  for (const userId of recipients) {
    try {
      const existing = await prisma.chatDigestPending.findFirst({ where: { userId, projectId } });
      if (existing) {
        const names = parseSenderNames(existing.senderNamesJson);
        if (senderName && !names.includes(senderName) && names.length < MAX_DIGEST_SENDER_NAMES) names.push(senderName);
        await prisma.chatDigestPending.update({
          where: { id: existing.id },
          data: {
            lastMessageAt: now,
            messageCount: existing.messageCount + 1,
            senderNamesJson: JSON.stringify(names),
          },
        });
      } else {
        await prisma.chatDigestPending.create({
          data: {
            userId, projectId,
            firstMessageAt: now, lastMessageAt: now,
            messageCount: 1,
            senderNamesJson: JSON.stringify(senderName ? [senderName] : []),
          },
        });
      }
      recorded += 1;
    } catch (err) {
      // Best-effort per recipient: one bad row must not starve the others.
      console.error('[chatDigest] record error:', err.message);
    }
  }
  return { recorded };
}
