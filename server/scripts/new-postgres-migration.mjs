#!/usr/bin/env node
/**
 * new-postgres-migration.mjs — capture schema drift as a NEW timestamped
 * PostgreSQL migration (93.md Phase 2). Cross-platform npm script:
 *
 *   db:migrate:diff:postgres   node scripts/new-postgres-migration.mjs [--name=slug] [--only=main|waitlist]
 *
 * Workflow after changing a canonical SQLite schema (prisma/schema.prisma or
 * prisma/waitlist/schema.prisma):
 *   1. npm run db:sync-postgres-schema      (regenerate the derived pg schemas)
 *   2. npm run db:migrate:diff:postgres -- --name=add_thing
 *   3. review the generated migration.sql, commit it
 *   4. npm run db:migrate:deploy:postgres   (apply on the target database)
 *
 * Under the hood, per database:
 *   prisma migrate diff --from-migrations <committed history>
 *                       --to-schema-datamodel <derived pg schema>
 *                       --script --shadow-database-url <scratch pg db>
 * → written to <history>/<YYYYMMDDHHMMSS>_<name>/migration.sql. An empty diff
 * ("-- This is an empty migration.") creates NOTHING — no noise migrations.
 *
 * SHADOW DATABASE: replaying `--from-migrations` requires a scratch PostgreSQL
 * database Prisma can freely create/drop tables in (NEVER a production DB).
 * Set POSTGRES_SHADOW_DATABASE_URL (shared by both databases; the waitlist can
 * override with POSTGRES_WAITLIST_SHADOW_DATABASE_URL). Example:
 *   createdb pecanrev_shadow
 *   POSTGRES_SHADOW_DATABASE_URL=postgresql://user:pass@localhost:5432/pecanrev_shadow
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PG_DIR = path.join(SERVER_DIR, 'prisma', 'postgres');
const TAG = '[new-postgres-migration]';

const TARGETS = {
  main: {
    schema: path.join(PG_DIR, 'schema.prisma'),
    migrationsDir: path.join(PG_DIR, 'migrations'),
    shadowEnvs: ['POSTGRES_SHADOW_DATABASE_URL'],
  },
  waitlist: {
    schema: path.join(PG_DIR, 'waitlist-schema.prisma'),
    migrationsDir: path.join(PG_DIR, 'waitlist-migrations'),
    shadowEnvs: ['POSTGRES_WAITLIST_SHADOW_DATABASE_URL', 'POSTGRES_SHADOW_DATABASE_URL'],
  },
};

const args = process.argv.slice(2);
const nameArg = (args.find((a) => a.startsWith('--name=')) || '').split('=')[1] || 'migration';
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';
// Same slug sanitation prisma itself applies to migration names.
const name = nameArg.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'migration';

if (only !== 'all' && !TARGETS[only]) {
  console.error(`${TAG} unknown --only=${only}. Use main | waitlist.`);
  process.exit(2);
}

/** UTC timestamp in prisma's migration-directory format (YYYYMMDDHHMMSS). */
function migrationStamp(d = new Date()) {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function prismaCliPath() {
  try { return require.resolve('prisma/build/index.js'); } catch { /* fall through */ }
  try { return require.resolve('prisma'); } catch { return null; }
}

function diffOne(key) {
  const t = TARGETS[key];
  const shadowUrl = t.shadowEnvs.map((e) => (process.env[e] || '').trim()).find(Boolean);
  if (!shadowUrl) {
    console.error(
      `${TAG} ${key}: no shadow database URL set (${t.shadowEnvs.join(' or ')}).\n` +
      '  Replaying the committed migrations needs a scratch PostgreSQL database\n' +
      '  (never production). createdb pecanrev_shadow, then set the env var.'
    );
    return 2;
  }
  const cli = prismaCliPath();
  if (!cli) {
    console.error(`${TAG} prisma CLI not installed — run npm ci in server/ first.`);
    return 1;
  }
  const res = spawnSync(process.execPath, [
    cli, 'migrate', 'diff',
    '--from-migrations', t.migrationsDir,
    '--to-schema-datamodel', t.schema,
    '--shadow-database-url', shadowUrl,
    '--script',
  ], { cwd: SERVER_DIR, env: process.env, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`${TAG} ${key}: prisma migrate diff FAILED (exit ${res.status ?? '?'}).`);
    if (res.stderr) console.error(res.stderr.trim());
    return res.status ?? 1;
  }
  const sql = (res.stdout || '').trim();
  if (!sql || /^--\s*This is an empty migration\.?$/i.test(sql)) {
    console.log(`${TAG} ${key}: no drift — schema and migration history already match.`);
    return 0;
  }
  const dir = path.join(t.migrationsDir, `${migrationStamp()}_${name}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'migration.sql'), `${sql}\n`, 'utf8');
  console.log(`${TAG} ${key}: wrote ${path.relative(SERVER_DIR, dir)}${path.sep}migration.sql`);
  console.log(`${TAG} ${key}: REVIEW the SQL, commit it, then npm run db:migrate:deploy:postgres.`);
  return 0;
}

const keys = only === 'all' ? Object.keys(TARGETS) : [only];
let exitCode = 0;
for (const k of keys) {
  const code = diffOne(k);
  if (code !== 0 && exitCode === 0) exitCode = code;
}
process.exit(exitCode);
