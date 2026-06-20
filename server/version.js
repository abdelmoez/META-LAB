/**
 * server/version.js
 * Version metadata module for META·LAB (prompt5 Task 7).
 *
 * Exposes getVersion() → { name, version, commit, commitDate, buildDate, full }.
 * All dynamic values resolve ONCE at module load and are cached so the public
 * GET /api/version route is cheap (no fs/git work per request).
 *
 * Resolution order (most authoritative first) so the value CHANGES with each
 * commit and degrades gracefully when git is unavailable (e.g. production):
 *   version    ← root package.json "version".
 *   commit     ← env GIT_COMMIT → generated version.json → `git rev-parse --short HEAD` → 'dev'.
 *   commitDate ← env GIT_COMMIT_DATE → generated version.json → `git log -1 --format=%cI` → null.
 *   buildDate  ← env BUILD_DATE → generated version.json → commitDate → module-load ISO string.
 *
 * `npm run version:gen` writes server/version.json at build time so deployments
 * without a .git directory still report the real commit/date (Task 7 item 4).
 */
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function tryReadJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function tryGit(args) {
  try {
    return execSync(`git ${args}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch { return null; }
}

// ── version: read root package.json once ─────────────────────────────────────
let version = '0.0.0';
{
  const pkg = tryReadJson(path.join(__dirname, '..', 'package.json'));
  if (pkg && typeof pkg.version === 'string') version = pkg.version;
}

// ── build-time generated fallback (written by scripts/generate-version.js) ───
const generated = tryReadJson(path.join(__dirname, 'version.json')) || {};

// ── commit: env → generated → git → 'dev' ────────────────────────────────────
const commit =
  process.env.GIT_COMMIT ||
  generated.commit ||
  tryGit('rev-parse --short HEAD') ||
  'dev';

// ── commitDate: env → generated → git → null ─────────────────────────────────
const commitDate =
  process.env.GIT_COMMIT_DATE ||
  generated.commitDate ||
  tryGit('log -1 --format=%cI') ||
  null;

// ── buildDate: env → generated → commitDate → module-load time ───────────────
const buildDate =
  process.env.BUILD_DATE ||
  generated.buildDate ||
  commitDate ||
  new Date().toISOString();

// Human-readable one-liner: "vX.Y.Z · <shortCommit> · <YYYY-MM-DD>"
const datePart = buildDate ? String(buildDate).slice(0, 10) : '';
const full = `v${version}${commit && commit !== 'dev' ? ' · ' + commit : ''}${datePart ? ' · ' + datePart : ''}`;

const META = Object.freeze({
  name: 'PecanRev',
  version,
  commit,
  commitDate,
  buildDate,
  full,
});

/**
 * @returns {{ name: string, version: string, commit: string, commitDate: string|null, buildDate: string, full: string }}
 */
export function getVersion() {
  return META;
}
