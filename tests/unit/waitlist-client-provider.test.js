/**
 * waitlist-client-provider.test.js — 73.md Part 11: provider-aware waitlist DB
 * layer. Covers URL-scheme → generated-client selection, the
 * POSTGRES_WAITLIST_DATABASE_URL fallback, postgres URL redaction, and the
 * ensure-waitlist-db script's skip-when-unset behaviour. Hermetic: the dynamic
 * import is injected (never touches the generated clients on disk) and the
 * ensure script is spawned with --no-dotenv and both URL vars blanked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  waitlistDbUrl,
  waitlistDbUrlSource,
  isWaitlistDbConfigured,
  waitlistDbProvider,
  redactedDbTarget,
  waitlistConfigStatus,
} from '../../server/waitlist/config.js';
import { getWaitlistClient, waitlistClientModulePath } from '../../server/waitlist/waitlistClient.js';

const CANONICAL = 'BETA_WAITLIST_DATABASE_URL';
const FALLBACK = 'POSTGRES_WAITLIST_DATABASE_URL';
const SQLITE_PATH = '../prisma/generated/waitlist-client/index.js';
const PG_PATH = '../prisma/generated/postgres-waitlist-client/index.js';

let saved;
beforeEach(() => {
  saved = { canonical: process.env[CANONICAL], fallback: process.env[FALLBACK] };
  delete process.env[CANONICAL];
  delete process.env[FALLBACK];
  delete globalThis.__waitlistClient;
  delete globalThis.__waitlistImportFailures;
});
afterEach(() => {
  if (saved.canonical === undefined) delete process.env[CANONICAL]; else process.env[CANONICAL] = saved.canonical;
  if (saved.fallback === undefined) delete process.env[FALLBACK]; else process.env[FALLBACK] = saved.fallback;
  delete globalThis.__waitlistClient;
  delete globalThis.__waitlistImportFailures;
});

describe('URL-scheme provider selection', () => {
  it('maps schemes to providers', () => {
    expect(waitlistDbProvider('file:./beta-waitlist.db')).toBe('sqlite');
    expect(waitlistDbProvider('file:/var/lib/metalab/waitlist.db')).toBe('sqlite');
    expect(waitlistDbProvider('postgres://u:p@h:5432/wl')).toBe('postgres');
    expect(waitlistDbProvider('postgresql://u:p@h:5432/wl?schema=public')).toBe('postgres');
    expect(waitlistDbProvider('POSTGRESQL://u:p@h/wl')).toBe('postgres');
    expect(waitlistDbProvider('mysql://u:p@h/wl')).toBe('unknown');
    expect(waitlistDbProvider('')).toBe('unknown');
  });

  it('maps providers to the dedicated generated client modules', () => {
    expect(waitlistClientModulePath('file:./beta-waitlist.db')).toBe(SQLITE_PATH);
    expect(waitlistClientModulePath('postgres://u:p@h:5432/wl')).toBe(PG_PATH);
    expect(waitlistClientModulePath('postgresql://u:p@h:5432/wl')).toBe(PG_PATH);
    // Unknown schemes keep the historical sqlite import (backward compatible).
    expect(waitlistClientModulePath('mysql://u:p@h/wl')).toBe(SQLITE_PATH);
  });
});

describe('POSTGRES_WAITLIST_DATABASE_URL fallback', () => {
  it('is used when the canonical var is unset', () => {
    process.env[FALLBACK] = 'postgresql://u:p@h:5432/wl';
    expect(waitlistDbUrl()).toBe('postgresql://u:p@h:5432/wl');
    expect(waitlistDbUrlSource()).toBe(FALLBACK);
    expect(isWaitlistDbConfigured()).toBe(true);
    expect(waitlistDbProvider()).toBe('postgres');
  });

  it('never shadows the canonical var when both are set', () => {
    process.env[CANONICAL] = 'file:./beta-waitlist.db';
    process.env[FALLBACK] = 'postgresql://u:p@h:5432/wl';
    expect(waitlistDbUrl()).toBe('file:./beta-waitlist.db');
    expect(waitlistDbUrlSource()).toBe(CANONICAL);
    expect(waitlistDbProvider()).toBe('sqlite');
  });

  it('reports unconfigured when neither var is set', () => {
    expect(waitlistDbUrl()).toBe('');
    expect(waitlistDbUrlSource()).toBe('');
    expect(isWaitlistDbConfigured()).toBe(false);
  });
});

describe('redaction of postgres URLs', () => {
  it('exposes only the scheme — no credentials, host, or database name', () => {
    process.env[CANONICAL] = 'postgresql://wl_user:s3cret@db.internal:5432/waitlist?schema=public';
    const target = redactedDbTarget();
    expect(target).toBe('postgresql://…');
    expect(target).not.toContain('wl_user');
    expect(target).not.toContain('s3cret');
    expect(target).not.toContain('db.internal');
    expect(target).not.toContain('waitlist');
  });

  it('waitlistConfigStatus stays secret-free and includes the provider', () => {
    process.env[CANONICAL] = 'postgres://wl_user:s3cret@db.internal:5432/waitlist';
    expect(waitlistConfigStatus()).toEqual({
      dbConfigured: true,
      target: 'postgres://…',
      provider: 'postgres',
    });
  });
});

describe('getWaitlistClient provider-aware import (injected importer)', () => {
  it('imports the postgres client for postgres URLs and binds the datasource url', async () => {
    process.env[CANONICAL] = 'postgresql://wl_user:s3cret@db.internal:5432/waitlist';
    const imported = [];
    let ctorArgs = null;
    class FakePrismaClient { constructor(args) { ctorArgs = args; } }
    const importer = async (p) => { imported.push(p); return { PrismaClient: FakePrismaClient }; };

    const r = await getWaitlistClient({ importer });
    expect(r.ok).toBe(true);
    expect(r.client).toBeInstanceOf(FakePrismaClient);
    expect(imported).toEqual([PG_PATH]);
    expect(ctorArgs).toEqual({ datasources: { db: { url: 'postgresql://wl_user:s3cret@db.internal:5432/waitlist' } } });
  });

  it('imports the sqlite client for file: URLs (pre-73 behaviour)', async () => {
    process.env[CANONICAL] = 'file:./beta-waitlist.db';
    const imported = [];
    class FakePrismaClient { constructor() {} }
    const importer = async (p) => { imported.push(p); return { PrismaClient: FakePrismaClient }; };

    const r = await getWaitlistClient({ importer });
    expect(r.ok).toBe(true);
    expect(imported).toEqual([SQLITE_PATH]);
  });

  it('keeps the sticky import-failure contract (no retry, never throws)', async () => {
    process.env[CANONICAL] = 'file:./beta-waitlist.db';
    let attempts = 0;
    const importer = async () => { attempts += 1; throw new Error('generated client missing'); };

    const r1 = await getWaitlistClient({ importer });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe('client_unavailable');
    const r2 = await getWaitlistClient({ importer });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('client_unavailable');
    expect(attempts).toBe(1); // sticky — the broken import is not retried
  });

  it('a sticky sqlite failure does not poison the postgres path', async () => {
    process.env[CANONICAL] = 'file:./beta-waitlist.db';
    const failing = async () => { throw new Error('generated client missing'); };
    await getWaitlistClient({ importer: failing });

    process.env[CANONICAL] = 'postgresql://u:p@h:5432/wl';
    class FakePrismaClient { constructor() {} }
    const r = await getWaitlistClient({ importer: async () => ({ PrismaClient: FakePrismaClient }) });
    expect(r.ok).toBe(true);
  });
});

describe('ensure-waitlist-db.mjs', () => {
  it('exits 0 with a single skip line when no waitlist URL is set', () => {
    const script = fileURLToPath(new URL('../../server/scripts/ensure-waitlist-db.mjs', import.meta.url));
    const res = spawnSync(process.execPath, [script, '--no-dotenv'], {
      // Blank (not deleted) so inherited values can never leak in; the script
      // treats whitespace-only values as unset, mirroring config.js env().
      env: { ...process.env, [CANONICAL]: '', [FALLBACK]: '' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/no waitlist DB URL set/);
    expect(res.stdout).toMatch(/skipping db push/);
  });
});
