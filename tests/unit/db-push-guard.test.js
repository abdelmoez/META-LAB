/**
 * db-push-guard.test.js — 93.md production guard for `prisma db push`
 * (server/scripts/guard-db-push.mjs). The predicate is pure and hermetic
 * (explicit env objects; importing the module never runs its CLI main — that is
 * gated on process.argv[1]). The same predicate gates the postgres branch of
 * ensure-waitlist-db.mjs; the sqlite postinstall path is intentionally
 * unguarded and stays allowed.
 */
import { describe, it, expect } from 'vitest';
import { shouldBlockDbPush, blockMessage } from '../../server/scripts/guard-db-push.mjs';

describe('shouldBlockDbPush', () => {
  it('blocks in production without the escape hatch', () => {
    expect(shouldBlockDbPush({ NODE_ENV: 'production' })).toBe(true);
    expect(shouldBlockDbPush({ NODE_ENV: 'production', ALLOW_DB_PUSH: '' })).toBe(true);
    expect(shouldBlockDbPush({ NODE_ENV: 'production', ALLOW_DB_PUSH: '0' })).toBe(true);
    expect(shouldBlockDbPush({ NODE_ENV: 'production', ALLOW_DB_PUSH: 'true' })).toBe(true); // only the literal "1"
  });

  it('allows in production ONLY with ALLOW_DB_PUSH=1 (trimmed)', () => {
    expect(shouldBlockDbPush({ NODE_ENV: 'production', ALLOW_DB_PUSH: '1' })).toBe(false);
    expect(shouldBlockDbPush({ NODE_ENV: 'production', ALLOW_DB_PUSH: ' 1 ' })).toBe(false);
  });

  it('never blocks outside production (dev/test/CI keep working unchanged)', () => {
    expect(shouldBlockDbPush({})).toBe(false);
    expect(shouldBlockDbPush({ NODE_ENV: 'development' })).toBe(false);
    expect(shouldBlockDbPush({ NODE_ENV: 'test' })).toBe(false);
    expect(shouldBlockDbPush({ NODE_ENV: '' })).toBe(false);
  });

  it('blockMessage names the migration-workflow alternative and the escape hatch', () => {
    const msg = blockMessage('waitlist postgres db push');
    expect(msg).toContain('waitlist postgres db push');
    expect(msg).toContain('db:migrate:deploy:postgres');
    expect(msg).toContain('ALLOW_DB_PUSH=1');
  });
});
