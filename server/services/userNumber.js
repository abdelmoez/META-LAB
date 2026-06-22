/**
 * server/services/userNumber.js — the immutable, sequential, admin-visible
 * numeric user id (prompt49 item 8).
 *
 * `User.userNumber` is distinct from the internal uuid `User.id`. It is:
 *   - automatically assigned at registration (allocateUserNumber → create)
 *   - sequential (allocated from the "userNumber" AppSequence counter)
 *   - immutable (never reassigned; the Ops console treats it as read-only —
 *     it is NOT in editableUserFields)
 *   - unique (guaranteed by the atomic allocator, see services/sequence.js)
 *   - admin-visible (returned by the user APIs / Ops console)
 *
 * Existing users (registered before this column existed) are backfilled once at
 * startup in (createdAt, id) order so the number reflects registration order.
 */
import { prisma as defaultPrisma } from '../db/client.js';
import { allocateNumber, ensureSequenceAtLeast } from './sequence.js';

export const USER_NUMBER_SEQ = 'userNumber';

/** Allocate the next user number (call BEFORE user.create and pass it in). */
export async function allocateUserNumber(client = defaultPrisma) {
  return allocateNumber(USER_NUMBER_SEQ, client);
}

/**
 * Idempotently ensure a single user has a number (used for repair / safety net).
 * Never reassigns an existing number.
 */
export async function ensureUserNumber(userId, client = defaultPrisma) {
  const user = await client.user.findUnique({ where: { id: userId }, select: { userNumber: true } });
  if (!user) return null;
  if (user.userNumber != null) return user.userNumber;
  const n = await allocateUserNumber(client);
  await client.user.update({ where: { id: userId }, data: { userNumber: n } });
  return n;
}

/**
 * Backfill userNumber for every user missing one, in (createdAt, id) order.
 * Idempotent: a no-op once all users are numbered. Seeds the counter to the
 * current MAX(userNumber) first so newly-assigned numbers never collide with
 * already-numbered users. Best-effort and bounded; safe to run at every boot.
 */
export async function backfillUserNumbers(client = defaultPrisma) {
  const missing = await client.user.findMany({
    where: { userNumber: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (missing.length === 0) return { assigned: 0, alreadyNumbered: true };

  const agg = await client.user.aggregate({ _max: { userNumber: true } });
  await ensureSequenceAtLeast(USER_NUMBER_SEQ, agg?._max?.userNumber || 0, client);

  let assigned = 0;
  for (const { id } of missing) {
    try {
      const n = await allocateUserNumber(client);
      await client.user.update({ where: { id }, data: { userNumber: n } });
      assigned += 1;
    } catch { /* per-row best-effort — keep numbering the rest */ }
  }
  return { assigned };
}
