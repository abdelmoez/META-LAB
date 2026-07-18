/**
 * server/db/searchMode.js — provider-aware `contains` search filters (93.md).
 *
 * WHY: SQLite's LIKE is case-INSENSITIVE for ASCII by default, so every search
 * box in the app has always behaved case-insensitively. PostgreSQL's LIKE is
 * case-SENSITIVE — after cutover the same Prisma `{ contains: term }` filter
 * silently stops matching "Smith" for "smith". Prisma's fix is
 * `mode: 'insensitive'` (→ ILIKE), but that key is REJECTED by the SQLite
 * connector, so it cannot be added unconditionally. This helper picks per
 * provider at call time.
 *
 * Provider detection is the SINGLE source of truth here and is REUSED by
 * server/db/client.js (which imports resolveDatabaseProvider — this module is
 * import-cycle-free and side-effect-free, so unit tests can use it without
 * instantiating a Prisma client).
 *
 * Usage in controllers:
 *   import { insensitiveContains } from '../db/searchMode.js';
 *   where.OR = [{ email: insensitiveContains(term) }, { name: insensitiveContains(term) }];
 */

/**
 * The active database provider: 'postgres' | 'sqlite'. Mirrors the runtime
 * client selection (DATABASE_PROVIDER=postgres|postgresql → postgres; anything
 * else → sqlite, the default deployment).
 */
export function resolveDatabaseProvider(env = process.env) {
  const provider = (env.DATABASE_PROVIDER || 'sqlite').trim().toLowerCase();
  return provider === 'postgres' || provider === 'postgresql' ? 'postgres' : 'sqlite';
}

/**
 * A case-insensitive `contains` filter for the ACTIVE provider:
 *   postgres → { contains: value, mode: 'insensitive' }   (ILIKE)
 *   sqlite   → { contains: value }                        (LIKE — already
 *               case-insensitive for ASCII; `mode` would throw)
 */
export function insensitiveContains(value) {
  return resolveDatabaseProvider() === 'postgres'
    ? { contains: value, mode: 'insensitive' }
    : { contains: value };
}
