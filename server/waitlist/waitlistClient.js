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
 *     BETA_WAITLIST_DATABASE_URL is set AND the generated client loads. Otherwise
 *     { ok:false, reason } ('not_configured' | 'client_unavailable'). Callers must
 *     branch on `ok` and refuse the operation — never fall back to the main DB.
 */

import { isWaitlistDbConfigured, waitlistDbUrl } from './config.js';

// Global singleton (mirrors server/db/client.js) so dev hot-reload / repeated
// imports don't open multiple SQLite connections to the same file.
const globalForWaitlist = globalThis;

// Sticky failure for "generated client missing/broken" — that won't change at
// runtime, so we don't retry the dynamic import every call. A missing env var is
// NOT sticky (it can be provided), so that path returns without caching.
let importFailure = globalForWaitlist.__waitlistImportFailure || null;

/**
 * Resolve the dedicated waitlist Prisma client.
 * @returns {Promise<{ok:true, client:object} | {ok:false, reason:string, error?:string}>}
 */
export async function getWaitlistClient() {
  if (!isWaitlistDbConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }
  if (globalForWaitlist.__waitlistClient) {
    return { ok: true, client: globalForWaitlist.__waitlistClient };
  }
  if (importFailure) return { ok: false, ...importFailure };

  try {
    // The generated client lives OUTSIDE node_modules in a path that only waitlist
    // code references. Dynamic import keeps server boot independent of it: a fresh
    // clone that hasn't run `prisma generate --schema=prisma/waitlist/schema.prisma`
    // still boots; only waitlist operations report 'client_unavailable'.
    const mod = await import('../prisma/generated/waitlist-client/index.js');
    const PrismaClient = mod.PrismaClient || mod.default?.PrismaClient;
    if (typeof PrismaClient !== 'function') {
      importFailure = { reason: 'client_unavailable', error: 'PrismaClient export missing' };
      globalForWaitlist.__waitlistImportFailure = importFailure;
      return { ok: false, ...importFailure };
    }
    // Pass the datasource url explicitly so the client is bound to the dedicated
    // env var regardless of what the generated schema baked in.
    const client = new PrismaClient({ datasources: { db: { url: waitlistDbUrl() } } });
    globalForWaitlist.__waitlistClient = client;
    return { ok: true, client };
  } catch (err) {
    importFailure = { reason: 'client_unavailable', error: err?.message || String(err) };
    globalForWaitlist.__waitlistImportFailure = importFailure;
    console.error('[waitlist] dedicated client unavailable:', err?.message || err);
    return { ok: false, ...importFailure };
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
