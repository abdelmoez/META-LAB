/**
 * verify-existing-users.js — retroactively mark existing users as email-verified.
 *
 * Sets User.emailVerifiedAt = User.createdAt for every account that is currently
 * unverified (emailVerifiedAt IS NULL). Use this when email delivery was unavailable
 * during sign-up so already-registered users are not locked out once verification is
 * enforced. Idempotent: re-running only touches accounts that are still NULL.
 *
 * Works on SQLite (dev) and PostgreSQL (prod) — the statement uses standard
 * double-quoted identifiers. Run from the repo root or server/:
 *   node server/scripts/verify-existing-users.js
 * It uses DATABASE_URL from the environment (server/.env via load-env / the deploy env).
 */
import '../load-env.js';
import { prisma } from '../db/client.js';

async function main() {
  const before = await prisma.user.count({ where: { emailVerifiedAt: null } });
  console.log(`[verify-existing-users] unverified (emailVerifiedAt IS NULL) before: ${before}`);
  if (before === 0) { console.log('[verify-existing-users] nothing to do.'); return; }

  const affected = await prisma.$executeRaw`UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL`;
  const after = await prisma.user.count({ where: { emailVerifiedAt: null } });
  console.log(`[verify-existing-users] rows updated: ${affected} · remaining unverified: ${after}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[verify-existing-users] failed:', e.message); process.exit(1); });
