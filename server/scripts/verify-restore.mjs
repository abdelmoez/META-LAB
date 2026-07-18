#!/usr/bin/env node
/**
 * verify-restore.mjs — prove a database BACKUP actually restores (93.md Phase 2).
 *
 * A backup that has never been restored is a hope, not a backup. Operators
 * restore the latest dump into a SCRATCH database, then run this to compare the
 * restored copy against the live source using the same verification machinery as
 * the SQLite→Postgres migration (server/db/migrate/core.js verifyAll: per-model
 * row counts + sampled deep row equality + grand total).
 *
 * Usage (npm run db:verify:restore, from server/):
 *   SOURCE_DATABASE_URL=...   RESTORED_DATABASE_URL=...   node scripts/verify-restore.mjs
 *
 * Env / args (args win; providers inferred from the URL scheme when omitted):
 *   SOURCE_DATABASE_URL      | --source-url=...       the live/source database
 *   RESTORED_DATABASE_URL    | --restored-url=...     the restored scratch copy
 *   SOURCE_DATABASE_PROVIDER | --source-provider=     sqlite | postgres
 *   RESTORED_DATABASE_PROVIDER | --restored-provider= sqlite | postgres
 *   --db=main|waitlist   which schema/client pair to verify (default main)
 *   --sample=25          rows per model for deep equality sampling
 *
 * READ-ONLY on both sides. Exits 0 on PASS, 1 on FAIL, 2 on usage errors.
 * NEVER logs connection strings. Note: rows written to the SOURCE after the
 * backup was taken will (correctly) show as count mismatches — verify against a
 * quiesced source or accept small drift knowingly.
 */
import '../load-env.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { verifyAll } from '../db/migrate/core.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const db = args.db ? String(args.db) : 'main';
const sampleSize = args.sample ? Number(args.sample) : 25;

// Client modules per database, per provider (same pairs migrate-db.mjs uses).
const DATABASES = {
  main: {
    sqlite: '@prisma/client',
    postgres: '../prisma/generated/postgres-client',
  },
  waitlist: {
    sqlite: path.resolve(__dirname, '../prisma/generated/waitlist-client/index.js'),
    postgres: '../prisma/generated/postgres-waitlist-client',
  },
};

if (!DATABASES[db]) {
  console.error(`✗ Unknown --db=${db}. Use main | waitlist.`);
  process.exit(2);
}

function resolveSide(name, urlKeys, providerKeys) {
  const url = String(args[urlKeys.arg] || process.env[urlKeys.env] || '').trim();
  if (!url) {
    console.error(`✗ Missing ${name} URL — set ${urlKeys.env} or pass --${urlKeys.arg}=...`);
    process.exit(2);
  }
  let provider = String(args[providerKeys.arg] || process.env[providerKeys.env] || '').trim().toLowerCase();
  if (!provider) provider = url.startsWith('file:') ? 'sqlite' : (/^postgres(ql)?:\/\//i.test(url) ? 'postgres' : '');
  if (provider === 'postgresql') provider = 'postgres';
  if (provider !== 'sqlite' && provider !== 'postgres') {
    console.error(`✗ Cannot determine ${name} provider — pass --${providerKeys.arg}=sqlite|postgres.`);
    process.exit(2);
  }
  return { url, provider };
}

function buildClient({ url, provider }, label) {
  const modulePath = DATABASES[db][provider];
  let mod;
  try {
    mod = require(modulePath);
  } catch (e) {
    console.error(`✗ ${label} client not generated (${modulePath}). Run \`npm run db:generate:postgres\` / the waitlist generate first.`);
    process.exit(2);
  }
  return { client: new mod.PrismaClient({ datasources: { db: { url } } }), mod };
}

async function main() {
  const sourceSide = resolveSide('source',
    { arg: 'source-url', env: 'SOURCE_DATABASE_URL' },
    { arg: 'source-provider', env: 'SOURCE_DATABASE_PROVIDER' });
  const restoredSide = resolveSide('restored',
    { arg: 'restored-url', env: 'RESTORED_DATABASE_URL' },
    { arg: 'restored-provider', env: 'RESTORED_DATABASE_PROVIDER' });

  const { client: source, mod } = buildClient(sourceSide, 'source');
  const { client: restored } = buildClient(restoredSide, 'restored');
  const models = mod.Prisma.dmmf.datamodel.models;

  let exitCode = 1;
  try {
    console.log(`━━━ restore verification (${db}) — source(${sourceSide.provider}) vs restored(${restoredSide.provider}) ━━━`);
    const v = await verifyAll(source, restored, { models, sampleSize });
    for (const m of v.models) {
      const flag = m.equalCounts && m.sampleMismatches === 0 ? '✓' : '✗';
      console.log(`  ${flag} ${m.model}: source=${m.source} restored=${m.target} sampled=${m.sampleChecked} sampleMismatches=${m.sampleMismatches}`);
    }
    if (v.ok) {
      console.log(`\n✓ PASS — ${v.total} source rows; every model count matches and all sampled rows are identical.`);
      exitCode = 0;
    } else {
      console.error(`\n✗ FAIL — ${v.mismatches.length} mismatch(es). The restore does NOT match the source:`);
      for (const m of v.mismatches.slice(0, 25)) console.error('  ', JSON.stringify(m));
      exitCode = 1;
    }
  } finally {
    // disconnect BEFORE exiting (process.exit would cut the awaits short)
    await source.$disconnect().catch(() => {});
    await restored.$disconnect().catch(() => {});
  }
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('✗ verify-restore error:', e.message);
  process.exit(1);
});
