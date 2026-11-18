/**
 * smoke-version-check.mjs — the /api/version rules used by the post-deploy
 * smoke test (scripts/smoke-deploy.mjs). Pure and side-effect free so it is
 * unit-tested directly (tests/unit/smokeDeploy.test.js); kept in its own module
 * (no `#!` line, no top-level run) so importing it never executes the smoke.
 *
 * The public /api/version body is { name, version } only: the commit hash is
 * returned to authenticated callers only (prompt 52 — build metadata is
 * fingerprinting), so the unauthenticated smoke normally sees no commit.
 */

/**
 * checkVersion
 *   - a non-empty `version` is always required;
 *   - expectVersion set → `version` must equal it exactly;
 *   - a `commit` present in the body + expectCommit set → prefix match required
 *     (short and full SHAs both accepted);
 *   - no `commit` in the body (the designed unauthenticated response) → the
 *     commit comparison is skipped, and the detail says so.
 * @param {any} body parsed /api/version JSON (may be null)
 * @param {{ expectCommit?: string, expectVersion?: string }} [expect]
 * @returns {{ ok: boolean, detail: string }}
 */
export function checkVersion(body, { expectCommit = '', expectVersion = '' } = {}) {
  const version = typeof body?.version === 'string' ? body.version.trim() : '';
  const commit = typeof body?.commit === 'string' ? body.commit.trim() : '';
  const problems = [];
  if (!version) problems.push('no version in body');
  else if (expectVersion && version !== expectVersion) problems.push(`expected v${expectVersion}`);
  let commitNote;
  if (!commit) {
    commitNote = expectCommit ? 'commit hidden from unauthenticated callers — commit check skipped' : 'commit not exposed';
  } else {
    if (expectCommit && !(expectCommit.startsWith(commit) || commit.startsWith(expectCommit))) {
      problems.push(`commit ${commit} does not match expected ${expectCommit}`);
    }
    commitNote = `@ ${commit}`;
  }
  const head = `v${version || '?'}${expectVersion && version === expectVersion ? ' (matches expected)' : ''}`;
  return { ok: problems.length === 0, detail: [head, commitNote, ...problems].join(' — ') };
}

/**
 * describeFetchError
 *   - an abort/timeout (AbortError / TimeoutError) → 'request timed out';
 *   - otherwise the error message (or String(e)), plus the underlying reason in
 *     parentheses when `e.cause` carries one (`cause.code`, else `cause.message`),
 *     e.g. "fetch failed (ECONNREFUSED)". Single line, at most 200 characters.
 * @param {any} e the value caught from a failed request
 * @returns {string}
 */
export function describeFetchError(e) {
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'request timed out';
  let out = e?.message || String(e);
  if (e?.cause) {
    const c = e.cause;
    const why = typeof c.code === 'string' && c.code ? c.code : (typeof c.message === 'string' && c.message ? c.message : '');
    if (why) out += ` (${why})`;
  }
  return out.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 200);
}
