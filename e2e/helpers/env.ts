/**
 * env.ts — environment resolution + safety guard for the Playwright E2E suite.
 *
 * SAFETY: the suite seeds users/projects and toggles settings, so it MUST never run
 * against production. We hard-require the base URL to be a localhost / 127.0.0.1 /
 * *.local target unless E2E_ALLOW_REMOTE=1 is explicitly set. `assertSafeTarget()`
 * is called from global-setup and throws loudly otherwise.
 *
 * Admin credentials for the programmatic API login come from server/.env
 * (ADMIN_EMAIL_1 + ADMIN_SEED_PASSWORD — the same dev seed the server itself uses).
 * They are read here via dotenv so no extra env wiring is needed locally; CI can
 * override with E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

/** Minimal .env loader (no dotenv dependency) — sets only keys not already in env. */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(path.join(REPO_ROOT, '.env.test'));
loadEnvFile(path.join(REPO_ROOT, 'server', '.env'));

export const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const API_URL = (process.env.E2E_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export const ADMIN_EMAIL = (process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL_1 || 'admin@example.com').trim().toLowerCase();
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_SEED_PASSWORD || '';

/** A localhost-only target check. Throws if the URL looks remote (unless explicitly allowed). */
export function assertSafeTarget(): void {
  if (process.env.E2E_ALLOW_REMOTE === '1') return;
  const safe = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;
  for (const url of [BASE_URL, API_URL]) {
    if (!safe.test(url)) {
      throw new Error(
        `[e2e] Refusing to run: "${url}" is not a local target. ` +
        'The E2E suite seeds/mutates data and must only run against local/dev. ' +
        'Set E2E_ALLOW_REMOTE=1 to override (you almost certainly should not).',
      );
    }
  }
}

/** Where authenticated storage states are written by global-setup. */
export const AUTH_DIR = path.join(HERE, '..', '.auth');
export const adminStatePath = path.join(AUTH_DIR, 'admin.json');
