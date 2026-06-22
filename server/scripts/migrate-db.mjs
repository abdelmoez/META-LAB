#!/usr/bin/env node
/**
 * migrate-db.mjs — copy all application data from the live SQLite databases to
 * PostgreSQL, then verify the copy. Idempotent and resumable (upsert by id).
 *
 * Prerequisites (operator):
 *   1. Provision PostgreSQL and create two databases (the waitlist stays isolated):
 *        createdb pecanrev ;  createdb pecanrev_waitlist
 *   2. Generate the Postgres clients + create the schema:
 *        npm run db:generate:postgres            # generates both PG clients
 *        POSTGRES_DATABASE_URL=...          npx prisma db push --schema=prisma/postgres/schema.prisma
 *        POSTGRES_WAITLIST_DATABASE_URL=... npx prisma db push --schema=prisma/postgres/waitlist-schema.prisma
 *   3. Set the source + target URLs in the environment:
 *        DATABASE_URL                  (existing SQLite source — main)
 *        POSTGRES_DATABASE_URL         (new Postgres target — main)
 *        BETA_WAITLIST_DATABASE_URL    (existing SQLite source — waitlist)
 *        POSTGRES_WAITLIST_DATABASE_URL(new Postgres target — waitlist)
 *   4. Run:  node scripts/migrate-db.mjs            (migrates + verifies both)
 *
 * Flags:  --only=main|waitlist   --batch=500   --no-verify
 *
 * Cutover: after a clean verify, set DATABASE_PROVIDER=postgres in the deploy
 * environment and restart. The SQLite files remain the rollback (untouched).
 * NEVER deletes the source. NEVER logs connection strings.
 */
import '../load-env.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { migrateAll, verifyAll } from '../db/migrate/core.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const only = args.only ? String(args.only) : 'all';
const batchSize = args.batch ? Number(args.batch) : 500;
const doVerify = args.verify !== false && args['no-verify'] !== true;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Missing required env var ${name}. See the header of this script.`);
    process.exit(2);
  }
  return v;
}

/** Build the SQLite source + Postgres target clients for one database. */
function buildClients({ sourceUrlEnv, targetUrlEnv, sqliteModule, pgClientPath }) {
  const sourceUrl = requireEnv(sourceUrlEnv);
  const targetUrl = requireEnv(targetUrlEnv);
  const sqlite = require(sqliteModule); // { PrismaClient, Prisma }
  let pg;
  try {
    pg = require(pgClientPath);
  } catch (e) {
    console.error(`✗ Postgres client not generated (${pgClientPath}). Run \`npm run db:generate:postgres\` first.`);
    process.exit(2);
  }
  const source = new sqlite.PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const target = new pg.PrismaClient({ datasources: { db: { url: targetUrl } } });
  const models = sqlite.Prisma.dmmf.datamodel.models;
  return { source, target, models };
}

const DATABASES = {
  main: {
    label: 'MAIN application database',
    sourceUrlEnv: 'DATABASE_URL',
    targetUrlEnv: 'POSTGRES_DATABASE_URL',
    sqliteModule: '@prisma/client',
    pgClientPath: '../prisma/generated/postgres-client',
  },
  waitlist: {
    label: 'BETA WAITLIST database (isolated)',
    sourceUrlEnv: 'BETA_WAITLIST_DATABASE_URL',
    targetUrlEnv: 'POSTGRES_WAITLIST_DATABASE_URL',
    sqliteModule: path.resolve(__dirname, '../prisma/generated/waitlist-client/index.js'),
    pgClientPath: '../prisma/generated/postgres-waitlist-client',
  },
};

async function migrateOne(key) {
  const cfg = DATABASES[key];
  console.log(`\n━━━ ${cfg.label} (${key}) ━━━`);
  const { source, target, models } = buildClients(cfg);
  try {
    const t0 = Date.now();
    const report = await migrateAll(source, target, {
      models,
      batchSize,
      onProgress: ({ model, migrated, total }) => {
        if (migrated === total || migrated % (batchSize * 4) === 0) {
          process.stdout.write(`  ${model}: ${migrated}/${total}\r`);
        }
      },
    });
    const rows = report.reduce((s, r) => s + r.migrated, 0);
    console.log(`  migrated ${rows} rows across ${report.length} models in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    if (doVerify) {
      const v = await verifyAll(source, target, { models });
      const bad = v.mismatches.length;
      if (v.ok) {
        console.log(`  ✓ verify OK — ${v.total} source rows, all counts + sampled rows match.`);
      } else {
        console.error(`  ✗ verify FAILED — ${bad} mismatch(es):`);
        for (const m of v.mismatches.slice(0, 25)) console.error('    ', JSON.stringify(m));
        return false;
      }
    }
    return true;
  } finally {
    await source.$disconnect().catch(() => {});
    await target.$disconnect().catch(() => {});
  }
}

async function main() {
  const keys = only === 'all' ? Object.keys(DATABASES) : [only];
  for (const k of keys) {
    if (!DATABASES[k]) {
      console.error(`✗ Unknown --only=${k}. Use main | waitlist | all.`);
      process.exit(2);
    }
  }
  let ok = true;
  for (const k of keys) ok = (await migrateOne(k)) && ok;
  if (!ok) {
    console.error('\n✗ Migration completed with verification failures — DO NOT cut over.');
    process.exit(1);
  }
  console.log('\n✓ All migrations verified. Safe to set DATABASE_PROVIDER=postgres and restart.');
}

main().catch((e) => {
  console.error('✗ Migration error:', e.message);
  process.exit(1);
});
