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
