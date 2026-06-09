/**
 * server/version.js
 * Version metadata module for META·LAB.
 *
 * Exposes getVersion() → { name, version, commit, buildDate }.
 * All three dynamic values are resolved ONCE at module load and cached so the
 * public GET /api/version route is cheap (no fs/git work per request).
 *
 *   version   ← root package.json "version" (path resolved relative to this
 *               module, not process.cwd(), so it works from repo root or server/).
 *   commit    ← env GIT_COMMIT, else `git rev-parse --short HEAD`, else 'dev'.
 *               Wrapped in try/catch — never throws if git is unavailable.
 *   buildDate ← env BUILD_DATE, else this module's load-time ISO string.
 */
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── version: read root package.json once ─────────────────────────────────────
let version = '0.0.0';
try {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg && typeof pkg.version === 'string') version = pkg.version;
} catch {
  // leave fallback '0.0.0' — must not throw at import time
}

// ── commit: env → git → 'dev' ─────────────────────────────────────────────────
let commit = 'dev';
if (process.env.GIT_COMMIT) {
  commit = process.env.GIT_COMMIT;
} else {
  try {
    commit = execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim() || 'dev';
  } catch {
    commit = 'dev';
  }
}

// ── buildDate: env → module-load time ────────────────────────────────────────
const buildDate = process.env.BUILD_DATE || new Date().toISOString();

const META = Object.freeze({
  name: 'META·LAB',
  version,
  commit,
  buildDate,
});

/**
 * @returns {{ name: string, version: string, commit: string, buildDate: string }}
 */
export function getVersion() {
  return META;
}
