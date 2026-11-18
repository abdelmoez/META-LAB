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
