#!/usr/bin/env node
/**
 * verify-migration.mjs — re-run ONLY the verification pass (row counts + sampled
 * deep-equality + grand total) for an already-migrated SQLite→Postgres copy,
 * without writing anything. Use after migrate-db.mjs, or to re-confirm before a
 * cutover. Exits non-zero on any mismatch. NEVER logs connection strings.
 *
 * Env: same source/target URLs as migrate-db.mjs.
 * Flags: --only=main|waitlist|all   --sample=25
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
const only = args.only ? String(args.only) : 'all';
const sampleSize = args.sample ? Number(args.sample) : 25;

const DATABASES = {
  main: { label: 'MAIN', sourceUrlEnv: 'DATABASE_URL', targetUrlEnv: 'POSTGRES_DATABASE_URL', sqliteModule: '@prisma/client', pgClientPath: '../prisma/generated/postgres-client' },
  waitlist: { label: 'WAITLIST', sourceUrlEnv: 'BETA_WAITLIST_DATABASE_URL', targetUrlEnv: 'POSTGRES_WAITLIST_DATABASE_URL', sqliteModule: path.resolve(__dirname, '../prisma/generated/waitlist-client/index.js'), pgClientPath: '../prisma/generated/postgres-waitlist-client' },
};

function requireEnv(name) { const v = process.env[name]; if (!v) { console.error(`✗ Missing env ${name}`); process.exit(2); } return v; }

async function verifyOne(key) {
  const cfg = DATABASES[key];
  const sqlite = require(cfg.sqliteModule);
  const pg = require(cfg.pgClientPath);
  const source = new sqlite.PrismaClient({ datasources: { db: { url: requireEnv(cfg.sourceUrlEnv) } } });
  const target = new pg.PrismaClient({ datasources: { db: { url: requireEnv(cfg.targetUrlEnv) } } });
  try {
    const v = await verifyAll(source, target, { models: sqlite.Prisma.dmmf.datamodel.models, sampleSize });
    if (v.ok) console.log(`✓ ${cfg.label}: ${v.total} rows — counts + sampled rows match.`);
    else { console.error(`✗ ${cfg.label}: ${v.mismatches.length} mismatch(es):`); v.mismatches.slice(0, 25).forEach((m) => console.error('  ', JSON.stringify(m))); }
    return v.ok;
  } finally {
    await source.$disconnect().catch(() => {});
    await target.$disconnect().catch(() => {});
  }
}

const keys = only === 'all' ? Object.keys(DATABASES) : [only];
let ok = true;
for (const k of keys) ok = (await verifyOne(k)) && ok;
process.exit(ok ? 0 : 1);
