/**
 * registrationMethodBackfill.js — 95.md Phase 10 — one-time, idempotent
 * classification of User.registrationMethod for accounts created before the
 * field existed. Invoked at boot (server/index.js, after seedAdmins — the
 * userNumber startup-backfill precedent) and safe to run on every start: it
 * only ever touches rows where registrationMethod IS NULL, so once classified
 * (or for every new account, which writes the field at creation) it is a
 * single cheap count query.
 *
 * Classification is CONCLUSIVE, never guessed from the email domain
 * (documented in src/shared/adminUsers.js:classifyRegistrationMethod):
 *   A. Google AuthAccount created in the same transaction as the user row
 *      (≤120s apart) → 'google'  (both Google registration paths write them
 *      atomically; link-later accounts are minutes/days younger).
 *   B. Otherwise, password present → 'email'  (pre-Google-epoch accounts all
 *      had non-nullable passwords; later email registrants likewise).
 *   C. Otherwise → 'unknown' (practically empty; kept honest).
 */
import { prisma } from '../db/client.js';
import { classifyRegistrationMethod } from '../../src/shared/adminUsers.js';

const CHUNK = 1000;

/** @returns {Promise<{scanned:number, email:number, google:number, unknown:number}>} */
export async function backfillRegistrationMethods() {
  const stats = { scanned: 0, email: 0, google: 0, unknown: 0 };
  // Loop until no unclassified rows remain; each pass classifies one chunk.
  // Cursor-free: classified rows leave the WHERE, so take(CHUNK) always advances.
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { registrationMethod: null },
      select: {
        id: true,
        createdAt: true,
        password: true,
        authAccounts: { where: { provider: 'google' }, select: { createdAt: true }, take: 1 },
      },
      take: CHUNK,
    });
    if (batch.length === 0) break;

    const byMethod = { email: [], google: [], unknown: [] };
    for (const u of batch) {
      const method = classifyRegistrationMethod({
        createdAt: u.createdAt,
        hasPassword: u.password != null,
        googleAccountCreatedAt: u.authAccounts[0]?.createdAt || null,
      });
      byMethod[method].push(u.id);
    }
    for (const [method, ids] of Object.entries(byMethod)) {
      if (!ids.length) continue;
      // Guarded on registrationMethod:null so a concurrent creation-path write
      // (which sets the field explicitly) can never be overwritten.
      await prisma.user.updateMany({
        where: { id: { in: ids }, registrationMethod: null },
        data: { registrationMethod: method },
      });
      stats[method] += ids.length;
    }
    stats.scanned += batch.length;
  }
  return stats;
}

/** Boot wrapper: never throws, logs one line only when it actually classified. */
export async function runRegistrationMethodBackfillOnce() {
  try {
    const pending = await prisma.user.count({ where: { registrationMethod: null } });
    if (pending === 0) return;
    const stats = await backfillRegistrationMethods();
    console.log(`[backfill] registrationMethod classified ${stats.scanned} users (email:${stats.email} google:${stats.google} unknown:${stats.unknown})`);
  } catch (err) {
    console.error('[backfill] registrationMethod failed (will retry next boot):', err?.message || err);
  }
}
