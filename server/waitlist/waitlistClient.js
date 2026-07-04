/**
 * waitlist/waitlistClient.js — the DEDICATED, lazy, fail-safe Prisma client for
 * the Beta Waitlist database (prompt48).
 *
 * WHY a separate client (not server/db/client.js):
 *   - It is generated from server/prisma/waitlist/schema.prisma into
 *     server/prisma/generated/waitlist-client, a DIFFERENT package than
 *     `@prisma/client`. The code boundary is explicit: application code imports
 *     the main client; ONLY waitlist code imports this one. A developer cannot
 *     accidentally reach waitlist rows through the normal application client and
 *     vice-versa — different model namespaces entirely.
 *
 * Fail-safe contract:
 *   - getWaitlistClient() NEVER throws. It returns { ok:true, client } only when
 *     a dedicated waitlist URL is set (BETA_WAITLIST_DATABASE_URL, or the
 *     POSTGRES_WAITLIST_DATABASE_URL fallback — see config.js) AND the matching
 *     generated client loads. Otherwise { ok:false, reason } ('not_configured' |
 *     'client_unavailable'). Callers must branch on `ok` and refuse the
 *     operation — never fall back to the main DB.
 */

import { isWaitlistDbConfigured, waitlistDbUrl, waitlistDbProvider } from './config.js';

// Global singleton (mirrors server/db/client.js) so dev hot-reload / repeated
// imports don't open multiple SQLite connections to the same file.
const globalForWaitlist = globalThis;

// The two DEDICATED generated waitlist clients. Which one loads is decided by
// the URL scheme (73.md Part 11) — the sqlite path is byte-for-byte the pre-73
// behaviour; postgres:// selects the client generated from
// prisma/postgres/waitlist-schema.prisma (previously generated but never imported).
const SQLITE_CLIENT_PATH = '../prisma/generated/waitlist-client/index.js';
const POSTGRES_CLIENT_PATH = '../prisma/generated/postgres-waitlist-client/index.js';

/**
 * The generated-client module a waitlist URL selects. file: → sqlite client;
 * postgres:// | postgresql:// → postgres client; any other scheme keeps the
 * historical sqlite import (backward compatible). Pure + exported so unit tests
 * can assert the mapping without touching the generated clients.
 */
export function waitlistClientModulePath(url) {
  return waitlistDbProvider(url) === 'postgres' ? POSTGRES_CLIENT_PATH : SQLITE_CLIENT_PATH;
}

// Sticky failures for "generated client missing/broken" — that won't change at
// runtime, so we don't retry the dynamic import every call. Keyed by module path
// so a broken postgres client never poisons a later sqlite config (and vice
// versa). A missing env var is NOT sticky (it can be provided), so that path
// returns without caching.
function importFailures() {
  if (!globalForWaitlist.__waitlistImportFailures) globalForWaitlist.__waitlistImportFailures = {};
  return globalForWaitlist.__waitlistImportFailures;
}

/**
 * Resolve the dedicated waitlist Prisma client.
 * @param {object} [opts] — test seam only: { importer } replaces the dynamic
 *   import so unit tests can assert provider selection hermetically.
 * @returns {Promise<{ok:true, client:object} | {ok:false, reason:string, error?:string}>}
 */
export async function getWaitlistClient(opts = {}) {
  if (!isWaitlistDbConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }
  if (globalForWaitlist.__waitlistClient) {
    return { ok: true, client: globalForWaitlist.__waitlistClient };
  }
  const url = waitlistDbUrl();
  const modulePath = waitlistClientModulePath(url);
  const sticky = importFailures()[modulePath];
  if (sticky) return { ok: false, ...sticky };

  try {
    // The generated client lives OUTSIDE node_modules in a path that only waitlist
    // code references. Dynamic import keeps server boot independent of it: a fresh
    // clone that hasn't run `prisma generate --schema=prisma/waitlist/schema.prisma`
    // still boots; only waitlist operations report 'client_unavailable'.
    const importer = opts.importer || ((p) => import(p));
    const mod = await importer(modulePath);
    const PrismaClient = mod.PrismaClient || mod.default?.PrismaClient;
    if (typeof PrismaClient !== 'function') {
      const failure = { reason: 'client_unavailable', error: 'PrismaClient export missing' };
      importFailures()[modulePath] = failure;
      return { ok: false, ...failure };
    }
    // Pass the datasource url explicitly so the client is bound to the dedicated
    // env var regardless of what the generated schema baked in.
    const client = new PrismaClient({ datasources: { db: { url } } });
    globalForWaitlist.__waitlistClient = client;
    return { ok: true, client };
  } catch (err) {
    const failure = { reason: 'client_unavailable', error: err?.message || String(err) };
    importFailures()[modulePath] = failure;
    console.error('[waitlist] dedicated client unavailable:', err?.message || err);
    return { ok: false, ...failure };
  }
}

/** Disconnect (tests / graceful shutdown). Never throws. */
export async function disconnectWaitlistClient() {
  const c = globalForWaitlist.__waitlistClient;
  if (c) {
    try { await c.$disconnect(); } catch { /* ignore */ }
    globalForWaitlist.__waitlistClient = undefined;
  }
}
