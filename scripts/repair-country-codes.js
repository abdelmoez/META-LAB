/**
 * repair-country-codes.js — one-time, idempotent repair for legacy User rows whose
 * registrationCountryCode was mangled by the old free-text Ops country field
 * (prompt22 follow-up). The classic case: a typed abbreviation was truncated
 * ("UAE" → "UA" / Ukraine) while registrationCountryName still held the full,
 * correct country ("United Arab Emirates"). reconcileCountryCode() trusts the name
 * to recover the right ISO alpha-2 code, then we re-derive the canonical name.
 *
 * SAFE BY DEFAULT: dry-run unless you pass --apply. Registration always writes a
 * consistent code+name, and the new Ops field is a picker, so this only ever
 * touches rows the old editor corrupted; re-running is a no-op.
 *
 * Usage:
 *   node scripts/repair-country-codes.js            # dry-run: list proposed fixes
 *   node scripts/repair-country-codes.js --apply    # write the fixes
 *
 * Needs the same env as the server (DATABASE_URL); load-env.js reads the .env.
 */
import '../server/load-env.js';
import { prisma } from '../server/db/client.js';
import { reconcileCountryCode, countryNameForCode } from '../src/shared/countries.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, registrationCountryCode: true, registrationCountryName: true },
  });

  const fixes = [];
  for (const u of users) {
    const oldCode = (u.registrationCountryCode || '').trim().toUpperCase();
    const newCode = reconcileCountryCode(u.registrationCountryCode, u.registrationCountryName);
    if (newCode && newCode !== oldCode) {
      fixes.push({
        id: u.id,
        email: u.email,
        from: `${u.registrationCountryName || '—'} (${oldCode || '—'})`,
        to: `${countryNameForCode(newCode)} (${newCode})`,
        newCode,
        newName: countryNameForCode(newCode),
      });
    }
  }

  console.log(`Scanned ${users.length} users — ${fixes.length} need repair.`);
  for (const f of fixes) console.log(`  ${f.email}: ${f.from}  ->  ${f.to}`);

  if (!fixes.length) { console.log('Nothing to repair.'); return; }

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to persist.');
    return;
  }

  let done = 0;
  for (const f of fixes) {
    await prisma.user.update({
      where: { id: f.id },
      data: { registrationCountryCode: f.newCode, registrationCountryName: f.newName },
    });
    done += 1;
  }
  console.log(`\nApplied ${done} repair(s).`);
}

main()
  .catch(err => { console.error('repair-country-codes failed:', err.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
