/**
 * sqlite-pragmas.test.js — verifies applySqlitePragmas() puts the main SQLite DB
 * into WAL mode with a busy_timeout, so an in-progress write can no longer block
 * concurrent reads into a "database failed to respond" timeout. Runs against the
 * real dev SQLite DB (WAL is persistent + harmless in dev). `npm run test:integration`.
 */
import { describe, it, expect } from 'vitest';
import { prisma, applySqlitePragmas } from '../../server/db/client.js';

describe('applySqlitePragmas — main SQLite concurrency config', () => {
  it('switches the DB to WAL mode and sets a positive busy_timeout', async () => {
    const res = await applySqlitePragmas();
    expect(res.applied).toBe(true);
    expect(res.journalMode).toBe('wal');
    expect(res.busyTimeoutMs).toBeGreaterThan(0);

    // Confirm directly from the live connection (not just the function's report).
    const jm = await prisma.$queryRawUnsafe('PRAGMA journal_mode;');
    expect(String(jm[0].journal_mode).toLowerCase()).toBe('wal');
    const bt = await prisma.$queryRawUnsafe('PRAGMA busy_timeout;');
    expect(Number(bt[0].timeout)).toBeGreaterThan(0);
  });

  it('is idempotent — applying twice stays WAL', async () => {
    await applySqlitePragmas();
    const res = await applySqlitePragmas();
    expect(res.applied).toBe(true);
    expect(res.journalMode).toBe('wal');
  });
});
