/**
 * no-tracked-databases.test.js — guard for roadmap 0.3.
 *
 * The repo is public. A committed SQLite DB / .bak would leak user emails and
 * bcrypt hashes. This test fails if any database/dump artifact is git-tracked,
 * and asserts .gitignore keeps covering the patterns. (dev.db was removed and
 * is absent from history; this prevents regressions.)
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function tracked() {
  return execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
}

// NB: deliberately excludes *.sql — Prisma migration DDL (server/prisma/migrations/**)
// is committed by design. We guard against binary DBs, journals, dumps and backups.
const DB_RE = /\.(db|db-journal|sqlite|sqlite3|bak)$/i;

describe('no database/secret artifacts are tracked', () => {
  it('git tracks no *.db / *.sqlite / *.bak / *.sql files', () => {
    const offenders = tracked().filter(f => DB_RE.test(f));
    expect(offenders, `Tracked DB artifacts must be purged: ${offenders.join(', ')}`).toEqual([]);
  });

  it('git tracks no .env file', () => {
    const offenders = tracked().filter(f => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f));
    expect(offenders, `Tracked env files leak secrets: ${offenders.join(', ')}`).toEqual([]);
  });

  it('.gitignore still covers the db + env patterns', () => {
    const gi = readFileSync(new URL('../../../.gitignore', import.meta.url), 'utf8');
    expect(gi).toMatch(/\*\.db/);
    expect(gi).toMatch(/\*\.sqlite/);
    expect(gi).toMatch(/\.env/);
  });
});
