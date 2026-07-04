/**
 * waitlist-isolation.test.js — proves the strict DB boundary (prompt48 §3) at the
 * SOURCE level: no waitlist module may import the main application DB client or the
 * bare `@prisma/client`. Also checks the fail-safe config contract. Pure (fs only).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isWaitlistDbConfigured, waitlistDbUrl } from '../../server/waitlist/config.js';
import { getWaitlistClient } from '../../server/waitlist/waitlistClient.js';

const waitlistDir = fileURLToPath(new URL('../../server/waitlist/', import.meta.url));
const ctrlDir = fileURLToPath(new URL('../../server/controllers/', import.meta.url));

const MAIN_CLIENT_RE = /from ['"][^'"]*db\/client\.js['"]/;
const BARE_PRISMA_RE = /from ['"]@prisma\/client['"]/;

describe('waitlist code boundary (DB isolation)', () => {
  it('no waitlist module imports the main DB client or @prisma/client', () => {
    const files = readdirSync(waitlistDir).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(waitlistDir + f, 'utf8');
      expect(MAIN_CLIENT_RE.test(src), `${f} must not import the main DB client`).toBe(false);
      expect(BARE_PRISMA_RE.test(src), `${f} must not import @prisma/client directly`).toBe(false);
    }
  });

  it('the waitlist client imports ONLY the dedicated generated client', () => {
    const src = readFileSync(`${waitlistDir}waitlistClient.js`, 'utf8');
    expect(src).toMatch(/prisma\/generated\/waitlist-client/);
  });

  it('the public + admin waitlist controllers route through the service, not the main client', () => {
    for (const f of ['waitlistController.js', 'waitlistAdminController.js']) {
      const src = readFileSync(ctrlDir + f, 'utf8');
      expect(MAIN_CLIENT_RE.test(src), `${f} must not import the main DB client`).toBe(false);
      expect(src).toMatch(/waitlistService\.js/);
    }
  });
});

describe('waitlist config fail-safe', () => {
  const KEY = 'BETA_WAITLIST_DATABASE_URL';
  // 73.md Part 11 — the postgres var is a valid fallback source; clear it too so
  // "unconfigured" below is hermetic on machines that export it.
  const PG_KEY = 'POSTGRES_WAITLIST_DATABASE_URL';
  let saved;
  let savedPg;
  beforeEach(() => {
    saved = process.env[KEY]; delete process.env[KEY];
    savedPg = process.env[PG_KEY]; delete process.env[PG_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved;
    if (savedPg === undefined) delete process.env[PG_KEY]; else process.env[PG_KEY] = savedPg;
  });

  it('reports unconfigured when the dedicated env var is unset', () => {
    expect(isWaitlistDbConfigured()).toBe(false);
    expect(waitlistDbUrl()).toBe('');
  });

  it('reports configured when the dedicated env var is set', () => {
    process.env[KEY] = 'file:./x.db';
    expect(isWaitlistDbConfigured()).toBe(true);
  });

  it('getWaitlistClient fails safe (never throws) when unconfigured', async () => {
    const r = await getWaitlistClient();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_configured');
  });
});
