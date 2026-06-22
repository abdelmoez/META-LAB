/**
 * server/auth/seedAdmins.js
 * Idempotent admin seeding used at server startup (Part 13).
 *
 * Ensures the two configured admin accounts exist and have the admin role.
 * Unlike the CLI tool (scripts/seed-admins.js), this does NOT reset an existing
 * admin's password on every boot — that would clobber a password the user has
 * since changed. Missing admins are created with ADMIN_SEED_PASSWORD.
 */
import { prisma } from '../db/client.js';
import { hashPassword } from './password.js';
import { allocateUserNumber } from '../services/userNumber.js';

export async function seedAdmins({ silent = false } = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };
  const warn = (...a) => { if (!silent) console.warn(...a); };

  const email1 = process.env.ADMIN_EMAIL_1?.trim().toLowerCase();
  const email2 = process.env.ADMIN_EMAIL_2?.trim().toLowerCase();
  const seedPassword = process.env.ADMIN_SEED_PASSWORD;

  if (!email1 || !email2) { warn('[seed] ADMIN_EMAIL_1/ADMIN_EMAIL_2 not set — skipping admin seed'); return { seeded: 0, skipped: true }; }
  if (!seedPassword || seedPassword.length < 12) { warn('[seed] ADMIN_SEED_PASSWORD missing or <12 chars — skipping admin seed'); return { seeded: 0, skipped: true }; }

  const emails = [...new Set([email1, email2])];
  let seeded = 0, created = 0;
  for (const email of emails) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== 'admin' || existing.suspended) {
        await prisma.user.update({ where: { email }, data: { role: 'admin', suspended: false } });
        seeded++;
      }
    } else {
      // Allocate the immutable numeric id at create (closes the first-boot race
      // where the startup backfill could run before the admin is seeded).
      const userNumber = await allocateUserNumber().catch(() => null);
      await prisma.user.create({
        data: { email, name: 'Admin', password: await hashPassword(seedPassword), role: 'admin', suspended: false, userNumber },
      });
      created++; seeded++;
    }
  }
  log(`[seed] admin seed ok — ${emails.join(', ')} (${created} created)`);
  return { seeded, created, skipped: false };
}
