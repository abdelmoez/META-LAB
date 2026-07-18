#!/usr/bin/env node
/**
 * postgres-migrate.mjs — run the VERSIONED PostgreSQL migration workflow for
 * BOTH databases (93.md Phase 2): the main app DB and the isolated beta-waitlist
 * DB. Cross-platform (no shell operators), invoked by the npm scripts:
 *
 *   db:migrate:deploy:postgres    node scripts/postgres-migrate.mjs deploy
 *   db:migrate:status:postgres    node scripts/postgres-migrate.mjs status
 *   db:migrate:baseline:postgres  node scripts/postgres-migrate.mjs baseline
 *
 * Commands:
 *   deploy    prisma migrate deploy   — apply committed, reviewed migrations.
 *   status    prisma migrate status   — report applied/pending (exit ≠0 when pending).
 *   baseline  prisma migrate resolve --applied 000000000000_init — ONE-TIME mark
 *             for a database that ALREADY has the schema (created via db push
 *             before 93.md): records the init baseline as applied WITHOUT running
 *             it, so subsequent `deploy` runs only apply newer migrations.
 *   push      prisma db push — dev-only convenience (npm run db:push:postgres
 *             prepends the guard; blocked in production without ALLOW_DB_PUSH=1,
 *             re-checked here for defense in depth). Runs through this script —
 *             not the raw CLI — so the directUrl env defaulting below applies:
 *             a single-URL deployment must not fail on "Environment variable
 *             not found: POSTGRES_DIRECT_DATABASE_URL".
 *
 * Flags: --only=main|waitlist   (default: both)
 *
 * WHY the waitlist staging dance: Prisma resolves the migrations directory as
 * `<schema dir>/migrations`, and BOTH derived pg schemas live in prisma/postgres/.
 * The main schema owns prisma/postgres/migrations; the committed waitlist history
 * lives in prisma/postgres/waitlist-migrations (never mix the two — the DBs are
 * strictly isolated, prompt48). For waitlist commands we stage a temp dir with
 * {schema.prisma, migrations/} copies and point --schema at it. deploy/status/
 * resolve never run generators, so the staged generator output path is inert.
 *
 * directUrl (93.md): the derived schemas declare directUrl env vars so CLI
 * commands bypass a transaction pooler. When no separate direct URL is set we
 * default it to the pooled URL for the child process — runtime parity with
 * server/db/client.js.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
// 93.md — production guard, re-checked here so a direct `postgres-migrate.mjs
// push` invocation is as safe as the npm script (guard && push).
import { shouldBlockDbPush, blockMessage } from './guard-db-push.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const PG_DIR = path.join(SERVER_DIR, 'prisma', 'postgres');
const TAG = '[postgres-migrate]';

const TARGETS = {
  main: {
    label: 'MAIN application database',
    schema: path.join(PG_DIR, 'schema.prisma'),
    migrationsDir: path.join(PG_DIR, 'migrations'),
    // main migrations already sit next to the schema — no staging needed.
    needsStaging: false,
    urlEnv: 'POSTGRES_DATABASE_URL',
    directUrlEnv: 'POSTGRES_DIRECT_DATABASE_URL',
  },
  waitlist: {
    label: 'BETA WAITLIST database (isolated)',
    schema: path.join(PG_DIR, 'waitlist-schema.prisma'),
    migrationsDir: path.join(PG_DIR, 'waitlist-migrations'),
    needsStaging: true,
    urlEnv: 'POSTGRES_WAITLIST_DATABASE_URL',
    directUrlEnv: 'POSTGRES_WAITLIST_DIRECT_DATABASE_URL',
  },
};

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) || '';
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'all';

const COMMANDS = {
  deploy: ['migrate', 'deploy'],
  status: ['migrate', 'status'],
  baseline: ['migrate', 'resolve', '--applied', '000000000000_init'],
  push: ['db', 'push'],
};

if (!COMMANDS[command]) {
  console.error(`${TAG} usage: node scripts/postgres-migrate.mjs <deploy|status|baseline|push> [--only=main|waitlist]`);
  process.exit(2);
}
if (command === 'push' && shouldBlockDbPush(process.env)) {
  console.error(blockMessage('prisma db push (postgres)'));
  process.exit(1);
}
if (only !== 'all' && !TARGETS[only]) {
  console.error(`${TAG} unknown --only=${only}. Use main | waitlist.`);
  process.exit(2);
}

/** Locate the prisma CLI entry so we can spawn `node <cli>` — no shell, no npx quoting. */
function prismaCliPath() {
  try {
    return require.resolve('prisma/build/index.js');
  } catch {
    try {
      // package main also points at the CLI bundle
      return require.resolve('prisma');
    } catch {
      return null;
    }
  }
}

/** Run `prisma <args>` from server/ via the local CLI. Returns exit code. */
function runPrisma(prismaArgs, extraEnv, label) {
  const cli = prismaCliPath();
  if (!cli) {
    console.error(`${TAG} prisma CLI not installed — run npm ci in server/ first.`);
    return 1;
  }
  const res = spawnSync(process.execPath, [cli, ...prismaArgs], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  const code = res.status ?? 1;
  console.log(`${TAG} ${label}: ${code === 0 ? 'ok' : `FAILED (exit ${code})`}`);
  return code;
}

function runOne(key) {
  const t = TARGETS[key];
  const url = (process.env[t.urlEnv] || '').trim();
  if (!url) {
    console.error(`${TAG} ${key}: ${t.urlEnv} is not set — cannot run \`${command}\`. Set it (and optionally ${t.directUrlEnv}) first.`);
    return 2;
  }
  // Default the direct URL to the pooled URL for the child prisma process.
  const extraEnv = { [t.directUrlEnv]: (process.env[t.directUrlEnv] || '').trim() || url };

  let schemaPath = t.schema;
  let stagingDir = null;
  // Staging exists only so migration-HISTORY commands find the right migrations
  // dir; `db push` never reads it, so it targets the real schema path directly.
  if (t.needsStaging && command !== 'push') {
    stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pecanrev-waitlist-migrate-'));
    schemaPath = path.join(stagingDir, 'schema.prisma');
    fs.copyFileSync(t.schema, schemaPath);
    fs.cpSync(t.migrationsDir, path.join(stagingDir, 'migrations'), { recursive: true });
  }
  try {
    console.log(`\n${TAG} ━━━ ${t.label} (${key}) — prisma ${COMMANDS[command].join(' ')} ━━━`);
    return runPrisma([...COMMANDS[command], `--schema=${schemaPath}`], extraEnv, `${command} (${key})`);
  } finally {
    if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

const keys = only === 'all' ? Object.keys(TARGETS) : [only];
let exitCode = 0;
for (const k of keys) {
  const code = runOne(k);
  if (code !== 0 && exitCode === 0) exitCode = code;
}
if (command === 'baseline' && exitCode === 0) {
  console.log(`\n${TAG} baseline recorded. From now on use npm run db:migrate:deploy:postgres for schema changes.`);
}
process.exit(exitCode);
