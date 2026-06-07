#!/usr/bin/env node
/**
 * seed-admins.js — Creates exactly two admin users from env vars.
 *
 * Run from project root:
 *   node server/scripts/seed-admins.js
 *
 * Required env vars (in server/.env):
 *   ADMIN_EMAIL_1        — first admin email
 *   ADMIN_EMAIL_2        — second admin email
 *   ADMIN_SEED_PASSWORD  — initial password (min 12 chars)
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../auth/password.js';

const prisma = new PrismaClient();

async function main() {
  const email1 = process.env.ADMIN_EMAIL_1?.trim().toLowerCase();
  const email2 = process.env.ADMIN_EMAIL_2?.trim().toLowerCase();
  const seedPassword = process.env.ADMIN_SEED_PASSWORD;

  // Validate env vars
  if (!email1 || !email2) {
    console.error('ERROR: ADMIN_EMAIL_1 and ADMIN_EMAIL_2 must be set in server/.env');
    process.exit(1);
  }
  if (!seedPassword || seedPassword.length < 12) {
    console.error('ERROR: ADMIN_SEED_PASSWORD must be set and at least 12 characters long');
    process.exit(1);
  }

  const adminEmails = [email1, email2];

  // Warn if more than 2 admins currently exist
  const existingAdmins = await prisma.user.findMany({ where: { role: 'admin' }, select: { email: true } });
  const existingNonTargetAdmins = existingAdmins.filter(a => !adminEmails.includes(a.email));
  if (existingNonTargetAdmins.length > 0) {
    console.warn('WARNING: The following existing admin(s) are not in the seed list and will remain:');
    for (const a of existingNonTargetAdmins) {
      console.warn(`  - ${a.email}`);
    }
    const totalAfter = existingNonTargetAdmins.length + adminEmails.length;
    if (totalAfter > 2) {
      console.warn(`WARNING: After seeding there will be ${totalAfter} admin users (more than 2).`);
    }
  }

  const hashedPassword = await hashPassword(seedPassword);
  const results = [];

  for (const email of adminEmails) {
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      await prisma.user.update({
        where: { email },
        data: {
          role: 'admin',
          password: hashedPassword,
          suspended: false,
        },
      });
      results.push({ email, action: 'updated (role=admin, password reset, unsuspended)' });
    } else {
      await prisma.user.create({
        data: {
          email,
          name: 'Admin',
          password: hashedPassword,
          role: 'admin',
          suspended: false,
        },
      });
      results.push({ email, action: 'created (role=admin)' });
    }
  }

  console.log('\n=== Admin Seed Summary ===');
  for (const r of results) {
    console.log(`  ${r.email}: ${r.action}`);
  }
  console.log('=========================\n');
  console.log('Done. Remember to change admin passwords after first login.');
}

main()
  .catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
