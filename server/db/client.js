/**
 * server/db/client.js — the single application Prisma client.
 *
 * Provider selection (prompt49 item 2 — PostgreSQL readiness):
 *   - Default / unset → SQLite via the standard `@prisma/client` (today's
 *     production). This path is byte-for-byte the original behaviour.
 *   - DATABASE_PROVIDER = "postgres" | "postgresql" → the dedicated Postgres
 *     client generated to ../prisma/generated/postgres-client (run
 *     `npm run db:generate:postgres` first). Selecting it here means NO call site
 *     changes — every `import { prisma } from '../db/client.js'` keeps working.
 *
 * The Postgres client is required lazily (only when actually selected) so the
 * default SQLite deployment never needs the Postgres client to exist on disk.
 */
import { PrismaClient as SqlitePrismaClient } from '@prisma/client';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function resolvePrismaClientCtor() {
  const provider = (process.env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
  if (provider === 'postgres' || provider === 'postgresql') {
    try {
      return require('../prisma/generated/postgres-client').PrismaClient;
    } catch (e) {
      throw new Error(
        'DATABASE_PROVIDER=postgres but the Postgres Prisma client is not generated. ' +
        'Run `npm run db:generate:postgres` (from server/) with POSTGRES_DATABASE_URL set. ' +
        `Underlying error: ${e.message}`
      );
    }
  }
  return SqlitePrismaClient;
}

const PrismaClient = resolvePrismaClientCtor();

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

/**
 * Apply SQLite concurrency/reliability PRAGMAs once at startup. NO-OP for Postgres.
 *
 * WHY: SQLite's default rollback-journal mode locks the WHOLE database file for
 * the duration of any write, so a single in-progress write (a screening import, a
 * batch insert, …) blocks every concurrent read until it times out — the observed
 * production `prisma.notification.count()` "database failed to respond within the
 * configured timeout" errors, and a strong candidate for the CPU-pegged symptom.
 *
 *   - journal_mode=WAL — readers run concurrently with the single writer (no more
 *     read-blocked-by-write). PERSISTENT in the DB file, so it survives restarts;
 *     one call is enough. Creates `<db>-wal` / `<db>-shm` sidecar files (operators:
 *     include them in backups, or run `PRAGMA wal_checkpoint(TRUNCATE)` first).
 *   - busy_timeout — a contended statement WAITS up to N ms for the lock instead
 *     of erroring immediately (env: SQLITE_BUSY_TIMEOUT_MS, default 8000).
 *   - synchronous=NORMAL — the safe, faster companion to WAL (durable across app
 *     crashes; only an OS crash / power loss can lose the last transaction, never
 *     corrupt the DB).
 *
 * Fail-safe: a failure logs and returns — it never blocks boot. Reversible:
 * `PRAGMA journal_mode=DELETE` restores the old mode.
 */
export async function applySqlitePragmas() {
  const provider = (process.env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
  if (provider === 'postgres' || provider === 'postgresql') return { applied: false, reason: 'not_sqlite' };
  const busyMs = Math.max(0, parseInt(process.env.SQLITE_BUSY_TIMEOUT_MS, 10) || 8000);
  try {
    // journal_mode returns the resulting mode as a row; the others are SETs.
    const modeRows = await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
    await prisma.$queryRawUnsafe(`PRAGMA busy_timeout=${busyMs};`);
    await prisma.$queryRawUnsafe('PRAGMA synchronous=NORMAL;');
    const journalMode = Array.isArray(modeRows) && modeRows[0] ? String(modeRows[0].journal_mode || '').toLowerCase() : '';
    console.log(`[db] SQLite pragmas applied (journal_mode=${journalMode || 'unknown'}, busy_timeout=${busyMs}ms, synchronous=NORMAL).`);
    return { applied: true, journalMode, busyTimeoutMs: busyMs };
  } catch (e) {
    console.error('[db] failed to apply SQLite pragmas:', e?.message || e);
    return { applied: false, error: e?.message || String(e) };
  }
}
