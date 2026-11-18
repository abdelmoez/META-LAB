/**
 * smokeDeploy.test.js — the post-deploy smoke test's /api/version rules
 * (scripts/smoke-version-check.mjs → checkVersion, used by scripts/smoke-deploy.mjs).
 *
 * The public /api/version body is { name, version } only: the commit hash is
 * returned to authenticated callers only (prompt 52 — fingerprinting). The
 * smoke runs unauthenticated, so it must (a) skip the commit comparison when no
 * commit is exposed, (b) require the public version to equal EXPECT_VERSION, and
 * (c) still enforce EXPECT_COMMIT whenever a commit IS present.
 */
import { describe, it, expect } from 'vitest';
import { checkVersion, describeFetchError } from '../../scripts/smoke-version-check.mjs';

const SHA = '440f65865fbf8951fc74836822586e19b9a7ccf2';

describe('smoke-deploy checkVersion', () => {
  it('passes the designed public body (no commit) when the version matches, and says the commit check was skipped', () => {
    const r = checkVersion({ name: 'PecanRev', version: '4.29.0' }, { expectCommit: SHA, expectVersion: '4.29.0' });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatch(/commit check skipped/);
  });

  it('fails when the public version differs from EXPECT_VERSION', () => {
    const r = checkVersion({ name: 'PecanRev', version: '4.28.0' }, { expectCommit: SHA, expectVersion: '4.29.0' });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/expected v4\.29\.0/);
  });

  it('fails when no version is reported at all', () => {
    expect(checkVersion({ name: 'PecanRev' }, { expectVersion: '4.29.0' }).ok).toBe(false);
    expect(checkVersion(null, {}).ok).toBe(false);
  });

  it('accepts a present commit that matches EXPECT_COMMIT (short or full SHA)', () => {
    expect(checkVersion({ version: '4.29.0', commit: '440f658' }, { expectCommit: SHA, expectVersion: '4.29.0' }).ok).toBe(true);
    expect(checkVersion({ version: '4.29.0', commit: SHA }, { expectCommit: '440f658', expectVersion: '4.29.0' }).ok).toBe(true);
  });

  it('fails a present commit that does not match EXPECT_COMMIT, even with the right version', () => {
    const r = checkVersion({ version: '4.29.0', commit: 'deadbee' }, { expectCommit: SHA, expectVersion: '4.29.0' });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/does not match/);
  });

  it('without expectations only requires a version (local/manual use)', () => {
    expect(checkVersion({ version: '4.29.0' }).ok).toBe(true);
  });
});

describe('smoke-deploy describeFetchError', () => {
  it('returns the message of a plain Error without a cause', () => {
    expect(describeFetchError(new Error('boom'))).toBe('boom');
  });

  it('appends the cause code when the cause has one', () => {
    const e = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' } });
    expect(describeFetchError(e)).toBe('fetch failed (ECONNREFUSED)');
  });

  it('falls back to the cause message when the cause has no code', () => {
    const e = new TypeError('fetch failed', { cause: new Error("Hostname/IP does not match certificate's altnames") });
    expect(describeFetchError(e)).toBe("fetch failed (Hostname/IP does not match certificate's altnames)");
  });

  it('reports an AbortError (and TimeoutError) as a timeout', () => {
    const a = new Error('This operation was aborted'); a.name = 'AbortError';
    const t = new Error('The operation timed out'); t.name = 'TimeoutError';
    expect(describeFetchError(a)).toBe('request timed out');
    expect(describeFetchError(t)).toBe('request timed out');
  });

  it('handles a non-Error value', () => {
    expect(describeFetchError('plain string failure')).toBe('plain string failure');
  });

  it('keeps one line and caps the length at 200 characters', () => {
    const r = describeFetchError(new Error('a\nb' + 'x'.repeat(300)));
    expect(r).not.toMatch(/\n/);
    expect(r.length).toBe(200);
  });
});
