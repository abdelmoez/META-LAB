/**
 * db-search-mode.test.js — 93.md provider-aware `contains` filters
 * (server/db/searchMode.js). SQLite's LIKE is case-insensitive for ASCII;
 * Postgres' is not — so on Postgres the filter must add mode:'insensitive'
 * (ILIKE), while on SQLite the `mode` key must be ABSENT (the SQLite connector
 * rejects it). Hermetic: searchMode.js is side-effect-free (no Prisma client
 * instantiation), env is stubbed per test and restored.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { insensitiveContains, resolveDatabaseProvider } from '../../server/db/searchMode.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveDatabaseProvider', () => {
  it('defaults to sqlite when DATABASE_PROVIDER is unset/empty', () => {
    vi.stubEnv('DATABASE_PROVIDER', '');
    expect(resolveDatabaseProvider()).toBe('sqlite');
    expect(resolveDatabaseProvider({})).toBe('sqlite');
  });

  it('accepts postgres and postgresql (trimmed, case-insensitive) — mirroring db/client.js', () => {
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: 'postgres' })).toBe('postgres');
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: 'postgresql' })).toBe('postgres');
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: '  Postgres ' })).toBe('postgres');
  });

  it('treats anything else as sqlite (fail-safe: no mode key sent to the sqlite connector)', () => {
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: 'sqlite' })).toBe('sqlite');
    expect(resolveDatabaseProvider({ DATABASE_PROVIDER: 'mysql' })).toBe('sqlite');
  });
});

describe('insensitiveContains', () => {
  it('sqlite (default): plain { contains } with NO mode key', () => {
    vi.stubEnv('DATABASE_PROVIDER', '');
    const f = insensitiveContains('Smith');
    expect(f).toEqual({ contains: 'Smith' });
    expect('mode' in f).toBe(false);
  });

  it('postgres: { contains, mode: "insensitive" } (ILIKE)', () => {
    vi.stubEnv('DATABASE_PROVIDER', 'postgres');
    expect(insensitiveContains('Smith')).toEqual({ contains: 'Smith', mode: 'insensitive' });
  });

  it('postgresql alias behaves identically', () => {
    vi.stubEnv('DATABASE_PROVIDER', 'postgresql');
    expect(insensitiveContains('doi:10.1000/xyz')).toEqual({ contains: 'doi:10.1000/xyz', mode: 'insensitive' });
  });

  it('passes the search value through untouched (no trimming/escaping — Prisma parameterises it)', () => {
    vi.stubEnv('DATABASE_PROVIDER', 'postgres');
    expect(insensitiveContains('  50% _like ')).toEqual({ contains: '  50% _like ', mode: 'insensitive' });
  });
});
