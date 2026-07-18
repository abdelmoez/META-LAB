#!/usr/bin/env node
/**
 * ensure-waitlist-db.mjs — make the Beta Waitlist database layer deploy-proof
 * (73.md Part 11). Runs from server/ postinstall (and manually) to:
 *
 *   1. (--with-generate) `prisma generate` BOTH dedicated waitlist clients:
 *      sqlite   prisma/waitlist/schema.prisma          → prisma/generated/waitlist-client
 *      postgres prisma/postgres/waitlist-schema.prisma → prisma/generated/postgres-waitlist-client
 *      Generation never connects to a database and needs no env vars, so it is
 *      safe everywhere (CI without waitlist env included).
 *   2. Resolve the waitlist DB URL exactly like server/waitlist/config.js
 *      (BETA_WAITLIST_DATABASE_URL canonical, POSTGRES_WAITLIST_DATABASE_URL
 *      fallback). No URL → print one skip line and exit 0.
 *   3. `prisma db push --skip-generate` with the schema matching the URL scheme
 *      so the waitlist tables exist on the deployed box (the deploy script only
 *      pushes the MAIN schema). db push here is additive; --accept-data-loss is
 *      NEVER passed, so a destructive diff makes prisma fail instead of
 *      dropping data.
 *
 * ALWAYS exits 0 — a broken/absent waitlist DB must never fail `npm ci` or a
 * deploy (the waitlist layer is fail-safe at runtime and the deploy smoke gate
 * reports the outage visibly). Failures are logged loudly instead.
 *
 * Flags:
 *   --with-generate  also run the two prisma generates (postinstall mode)
 *   --no-dotenv      skip loading server/.env (tests / explicit-env runs)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
// 93.md — shared production db-push guard (postgres pushes only; sqlite pushes
// stay allowed so the current VPS postinstall flow is byte-for-byte unchanged).
import { shouldBlockDbPush, blockMessage } from './guard-db-push.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const TAG = '[ensure-waitlist-db]';

const withGenerate = process.argv.includes('--with-generate');
const noDotenv = process.argv.includes('--no-dotenv');

// Load server/.env like the runtime does (dotenv never overrides real env), so
// a manual/postinstall run sees the same URL the server will. Optional: a bare
// CI checkout has neither .env nor waitlist env → clean skip below.
if (!noDotenv) {
  try {
    const dotenv = await import('dotenv');
    const envPath = path.join(SERVER_DIR, '.env');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  } catch { /* dotenv unavailable — rely on the real environment */ }
}

function env(key) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : '';
}

/** Mirror of server/waitlist/config.js waitlistDbUrl() resolution. */
function resolveUrl() {
  const canonical = env('BETA_WAITLIST_DATABASE_URL');
  if (canonical) return { url: canonical, source: 'BETA_WAITLIST_DATABASE_URL' };
  const pg = env('POSTGRES_WAITLIST_DATABASE_URL');
  if (pg) return { url: pg, source: 'POSTGRES_WAITLIST_DATABASE_URL' };
  return { url: '', source: '' };
}

/** Mirror of server/waitlist/config.js waitlistDbProvider(). */
function providerOf(url) {
  if (url.startsWith('file:')) return 'sqlite';
  if (/^postgres(ql)?:\/\//i.test(url)) return 'postgres';
  return 'unknown';
}

/**
 * Run `npx prisma <args>` from server/. Logs a one-line verdict; never throws.
 * shell:true because npx is npx.cmd on Windows; all args are static strings and
 * URLs travel via env, never argv.
 */
function prisma(args, extraEnv, label) {
  const res = spawnSync('npx', ['prisma', ...args], {
    cwd: SERVER_DIR,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: true,
  });
  const ok = res.status === 0;
  const why = res.error ? res.error.message : `exit ${res.status ?? '?'}`;
  console.log(`${TAG} ${label}: ${ok ? 'ok' : `FAILED (${why})`}`);
  return ok;
}

if (withGenerate) {
  prisma(['generate', '--schema=prisma/waitlist/schema.prisma'], {}, 'generate sqlite waitlist client');
  prisma(['generate', '--schema=prisma/postgres/waitlist-schema.prisma'], {}, 'generate postgres waitlist client');
}

const { url, source } = resolveUrl();
if (!url) {
  console.log(`${TAG} no waitlist DB URL set (BETA_WAITLIST_DATABASE_URL / POSTGRES_WAITLIST_DATABASE_URL) — skipping db push.`);
  process.exit(0);
}

const provider = providerOf(url);
console.log(`${TAG} waitlist DB URL from ${source} (provider: ${provider}).`);

if (provider === 'sqlite') {
  prisma(
    ['db', 'push', '--skip-generate', '--schema=prisma/waitlist/schema.prisma'],
    { BETA_WAITLIST_DATABASE_URL: url },
    'db push (sqlite waitlist schema)'
  );
} else if (provider === 'postgres') {
  // 93.md — production guard: a postgres waitlist DB must be changed through the
  // versioned migrations (prisma/postgres/waitlist-migrations), never db push.
  // The script's ALWAYS-exit-0 contract holds: we log loudly and skip the push
  // (ALLOW_DB_PUSH=1 is the deliberate escape hatch).
  if (shouldBlockDbPush(process.env)) {
    console.error(`${TAG} ${blockMessage('waitlist postgres db push')}`);
    console.log(`${TAG} skipped postgres db push (production guard) — run npm run db:migrate:deploy:postgres instead.`);
  } else {
    prisma(
      ['db', 'push', '--skip-generate', '--schema=prisma/postgres/waitlist-schema.prisma'],
      {
        POSTGRES_WAITLIST_DATABASE_URL: url,
        // 93.md — the derived pg schema declares directUrl; default it to the
        // pooled URL for this child process when no separate direct URL exists.
        POSTGRES_WAITLIST_DIRECT_DATABASE_URL: env('POSTGRES_WAITLIST_DIRECT_DATABASE_URL') || url,
      },
      'db push (postgres waitlist schema)'
    );
  }
} else {
  console.log(`${TAG} unrecognised waitlist URL scheme — skipping db push.`);
}

process.exit(0);
