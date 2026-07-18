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
 * 93.md Phase 2 additions:
 *   --dry-run             print the dependency-ordered plan + per-model source
 *                         row counts + the orphan report. ZERO writes — the
 *                         target is never even connected to.
 *   --allow-orphans       proceed despite orphaned child rows (rows whose
 *                         required FK parent is missing in the source). Default
 *                         is ABORT before any transfer: orphans that SQLite
 *                         tolerates fail the Postgres copy mid-flight.
 *   --confirm-production  required when NODE_ENV=production OR the target URL
 *                         host is not localhost/127.0.0.1 — a remote/production
 *                         database is never written to by accident.
 *
 * A `file:` target URL selects the SQLite client for the TARGET too, so the
 * whole pipeline (plan → orphans → copy → verify) can be rehearsed against a
 * scratch SQLite file without a live Postgres.
 *
 * Cutover: after a clean verify, set DATABASE_PROVIDER=postgres in the deploy
 * environment and restart. The SQLite files remain the rollback (untouched).
 * NEVER deletes the source. NEVER logs connection strings.
 */
import '../load-env.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  migrateAll, verifyAll, findOrphans, dryRunPlan, targetRequiresConfirmation,
} from '../db/migrate/core.js';

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
// 93.md flags — see the header.
const dryRun = args['dry-run'] === true;
const allowOrphans = args['allow-orphans'] === true;
const confirmProduction = args['confirm-production'] === true;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Missing required env var ${name}. See the header of this script.`);
    process.exit(2);
  }
  return v;
}

/**
 * Build the SQLite source + target clients for one database.
 * 93.md: a `file:` TARGET url selects the SQLite client too (scratch-DB
 * rehearsal, mirroring the round-trip integration test); anything else keeps
 * the generated Postgres client. In --dry-run mode the target is NOT built —
 * dry-run is read-only on the source and must work before Postgres even exists
 * (the target env var may be unset).
 */
function buildClients({ sourceUrlEnv, targetUrlEnv, sqliteModule, pgClientPath }) {
  const sourceUrl = requireEnv(sourceUrlEnv);
  const targetUrl = dryRun ? (process.env[targetUrlEnv] || '') : requireEnv(targetUrlEnv);
  const sqlite = require(sqliteModule); // { PrismaClient, Prisma }
  const models = sqlite.Prisma.dmmf.datamodel.models;
  const source = new sqlite.PrismaClient({ datasources: { db: { url: sourceUrl } } });
  if (dryRun) return { source, target: null, models, targetUrl };

  let TargetCtor;
  if (targetUrl.startsWith('file:')) {
    TargetCtor = sqlite.PrismaClient; // scratch SQLite rehearsal target
  } else {
    try {
      TargetCtor = require(pgClientPath).PrismaClient;
    } catch (e) {
      console.error(`✗ Postgres client not generated (${pgClientPath}). Run \`npm run db:generate:postgres\` first.`);
      process.exit(2);
    }
  }
  const target = new TargetCtor({ datasources: { db: { url: targetUrl } } });
  return { source, target, models, targetUrl };
}

/** Print the orphan report (93.md). Returns true when the run may proceed. */
function reportOrphans(orphans) {
  if (orphans.length === 0) {
    console.log('  ✓ orphan check: no child rows with a missing required-FK parent.');
    return true;
  }
  console.error(`  ✗ orphan check: ${orphans.length} relation(s) have children whose required parent is MISSING:`);
  for (const o of orphans) {
    console.error(
      `    ${o.model}.${o.fkField} → ${o.parentModel}: ${o.rows} orphaned row(s); ` +
      `sample missing parent ids: ${o.sampleMissingParents.join(', ')}`
    );
  }
  if (allowOrphans) {
    console.error('  ⚠ --allow-orphans set — proceeding anyway. These rows WILL fail FK checks on Postgres.');
    return true;
  }
  console.error('  Aborting BEFORE any transfer. Fix the rows (or re-run with --allow-orphans to waive).');
  return false;
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
  const { source, target, models, targetUrl } = buildClients(cfg);
  try {
    // 93.md (c) — production confirmation FIRST (before any long scan): writing
    // to a production/remote target must be explicit. Dry-run never writes, so
    // it is exempt.
    if (!dryRun && targetRequiresConfirmation({ targetUrl, nodeEnv: process.env.NODE_ENV }) && !confirmProduction) {
      console.error('  ✗ Target looks like PRODUCTION (NODE_ENV=production or a non-local target host).');
      console.error('    Re-run with --confirm-production to proceed (or --dry-run to inspect safely).');
      return false;
    }

    // 93.md (b) — pre-flight orphan detection, BEFORE any transfer.
    const orphans = await findOrphans(source, models);
    if (!reportOrphans(orphans)) return false;

    // 93.md (a) — dry-run: dependency-ordered plan + source counts, zero writes.
    if (dryRun) {
      const plan = await dryRunPlan(source, models);
      const width = Math.max(...plan.map((p) => p.model.length), 5);
      console.log(`  DRY RUN — transfer plan (dependency order), source row counts:`);
      for (const p of plan) console.log(`    ${p.model.padEnd(width)}  ${p.rows}`);
      const total = plan.reduce((s, p) => s + p.rows, 0);
      console.log(`  DRY RUN — ${total} rows across ${plan.length} models. Nothing was written (target untouched).`);
      return true;
    }

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
    if (target) await target.$disconnect().catch(() => {});
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
    console.error(dryRun
      ? '\n✗ Dry run found blocking problems (see above) — fix them before migrating.'
      : '\n✗ Migration did not complete cleanly (refused pre-flight or failed verification — see above). DO NOT cut over.');
    process.exit(1);
  }
  console.log(dryRun
    ? '\n✓ Dry run complete. Nothing was written. Re-run without --dry-run to migrate.'
    : '\n✓ All migrations verified. Safe to set DATABASE_PROVIDER=postgres and restart.');
}

main().catch((e) => {
  console.error('✗ Migration error:', e.message);
  process.exit(1);
});
