// One-off: restore seeded admin password after probe reset it (prompt7 diagnostics).
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const pw = process.env.ADMIN_SEED_PASSWORD || 'MetaLabAdmin2026!';
const hash = await bcrypt.hash(pw, 12);
const r = await prisma.user.update({
  where: { email: 'admin@metalab.local' },
  data: { password: hash },
});
console.log('restored password for', r.email);
await prisma.$disconnect();
