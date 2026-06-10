#!/usr/bin/env node
/**
 * scripts/generate-version.js (prompt5 Task 7)
 *
 * Writes server/version.json with the current git commit + commit date + build
 * timestamp, read at deploy/build time. server/version.js prefers this file when
 * a live .git directory is unavailable (e.g. a production container), so the app
 * still reports the real version even without git.
 *
 * Run via `npm run version:gen` (wire into your CI/build step before bundling).
 * Falls back gracefully: if git is unavailable, commit/commitDate are null and
 * version.js will use its own fallbacks.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch { return null; }
}

let version = '0.0.0';
try { version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version || version; } catch { /* keep */ }

const commit = process.env.GIT_COMMIT || git('rev-parse --short HEAD');
const commitDate = process.env.GIT_COMMIT_DATE || git('log -1 --format=%cI');
const buildDate = process.env.BUILD_DATE || new Date().toISOString();

const payload = { version, commit, commitDate, buildDate };
const outPath = path.join(root, 'server', 'version.json');
writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(`[version] wrote ${outPath}:`, payload);
