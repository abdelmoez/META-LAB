#!/usr/bin/env node
/**
 * guard-db-push.mjs — refuse `prisma db push` in production (93.md Phase 2).
 *
 * WHY: `db push` diffs the live database against the schema with NO migration
 * history and NO review step — on a production PostgreSQL instance a bad diff
 * can silently drop or rewrite columns. Production schema changes must go
 * through the versioned migrations instead:
 *
 *     npm run db:migrate:diff:postgres     # capture drift as a new migration
 *     npm run db:migrate:deploy:postgres   # apply reviewed migrations
 *
 * This script is prepended to the db:push:postgres npm script (guard && push),
 * so the push only ever runs when the guard exits 0. Escape hatch for a true
 * emergency: ALLOW_DB_PUSH=1 (deliberate, greppable, and logged).
 *
 * The same predicate is reused by ensure-waitlist-db.mjs around its internal
 * postgres `db push` (its SQLite path stays unguarded — the VPS postinstall
 * flow that pushes the SQLite waitlist schema must keep working unchanged).
 */

// 93.md round 2 (review fix) — load server/.env first. An operator SSH shell
// on the VPS has NO NODE_ENV exported (only pm2's app processes do), so the
// guard silently failed OPEN for exactly the manual runs it exists to stop.
// server/.env carries NODE_ENV=production on the VPS (documented in
// .env.example + the deploy runbook), which this import makes visible here.
import '../load-env.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Pure predicate: should a `prisma db push` be blocked for this environment?
 * Blocked when NODE_ENV is "production" and the ALLOW_DB_PUSH=1 escape hatch
 * is not set. Exported for unit tests and for ensure-waitlist-db.mjs.
 */
export function shouldBlockDbPush(env = process.env) {
  return String(env.NODE_ENV || '').trim() === 'production' && String(env.ALLOW_DB_PUSH || '').trim() !== '1';
}

/** The operator-facing refusal message (shared with ensure-waitlist-db.mjs). */
export function blockMessage(context = 'db push') {
  return (
    `✗ Refusing ${context} in production (NODE_ENV=production).\n` +
    '  `prisma db push` bypasses the versioned migration history and can be destructive.\n' +
    '  Use the migration workflow instead:\n' +
    '    npm run db:migrate:diff:postgres     (capture schema drift as a migration)\n' +
    '    npm run db:migrate:deploy:postgres   (apply reviewed migrations)\n' +
    '  Emergency escape hatch (know what you are doing): ALLOW_DB_PUSH=1'
  );
}

function main() {
  if (shouldBlockDbPush(process.env)) {
    console.error(blockMessage('prisma db push'));
    process.exit(1);
  }
  // Quiet success in dev; one line in production-with-escape-hatch so the
  // override is visible in deploy logs.
  if (String(process.env.NODE_ENV || '').trim() === 'production') {
    console.log('[guard-db-push] ALLOW_DB_PUSH=1 set — allowing db push in production.');
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
