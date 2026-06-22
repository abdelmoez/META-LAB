/**
 * server/services/sequence.js — provider-portable monotonic counters.
 *
 * Prisma can't put `@default(autoincrement())` on a NON-primary-key column on
 * SQLite, and a naïve `MAX(col)+1` is racy under concurrency. So durable
 * monotonic ids (the user-facing numeric `User.userNumber` today) are allocated
 * by atomically incrementing a named counter row in the `AppSequence` table.
 *
 * Concurrency safety: the uniqueness guarantee comes from the single atomic
 * `UPDATE ... value = value + 1 RETURNING value` (Prisma `{ increment: 1 }`),
 * which the database serialises at the row level — two concurrent callers can
 * never receive the same post-increment value. The preceding `upsert` only
 * ensures the row exists (its own create-race is harmless: one create wins, the
 * other no-ops via `update:{}`). No interactive transaction is needed, so this
 * is identical and correct on both SQLite and PostgreSQL.
 *
 * On PostgreSQL the counter could later be replaced by a native SEQUENCE, but
 * this allocator keeps working unchanged, so nothing downstream has to care.
 */
import { prisma as defaultPrisma } from '../db/client.js';

/**
 * Allocate the next value for the named sequence. Returns a positive integer.
 * @param {string} name  logical sequence name (e.g. "userNumber")
 * @param {object} [client]  a Prisma client (defaults to the app client; pass a
 *                           tx client or an alternate provider client for tools)
 */
export async function allocateNumber(name, client = defaultPrisma) {
  if (!name || typeof name !== 'string') throw new Error('sequence name is required');
  // Ensure the row exists without clobbering an existing counter value.
  await client.appSequence.upsert({
    where: { name },
    create: { name, value: 0 },
    update: {},
  });
  const row = await client.appSequence.update({
    where: { name },
    data: { value: { increment: 1 } },
  });
  return row.value;
}

/**
 * Raise the named counter to at least `floor` (never lowers it). Used by
 * backfills to seed the counter to the current MAX before assigning gaps, so
 * freshly-allocated numbers never collide with pre-existing ones.
 */
export async function ensureSequenceAtLeast(name, floor, client = defaultPrisma) {
  const f = Number.isFinite(floor) ? Math.max(0, Math.floor(floor)) : 0;
  const existing = await client.appSequence.findUnique({ where: { name } });
  const base = Math.max(existing?.value || 0, f);
  await client.appSequence.upsert({
    where: { name },
    create: { name, value: base },
    update: { value: base },
  });
  return base;
}
