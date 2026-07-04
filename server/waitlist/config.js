/**
 * waitlist/config.js — configuration + validation for the strictly-separate Beta
 * Waitlist database (prompt48; provider-aware since 73.md Part 11).
 *
 * The waitlist uses its OWN connection string, BETA_WAITLIST_DATABASE_URL — never
 * DATABASE_URL. If the waitlist feature is enabled but this is not configured, the
 * application must FAIL SAFE (refuse to write) and NEVER fall back to the main
 * user database. These helpers are the single place that reads the env vars.
 *
 * 73.md Part 11: BETA_WAITLIST_DATABASE_URL stays canonical, but when it is unset
 * and POSTGRES_WAITLIST_DATABASE_URL is set (a deployment that migrated the
 * waitlist to Postgres and only exported the Postgres var), that value is used —
 * still a DEDICATED waitlist connection string, never the main DB.
 */

function env(key) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : '';
}

// Log the fallback resolution once per process (waitlistDbUrl() runs on every
// waitlist request — a per-call line would flood the log). Never logs the URL.
let loggedPostgresFallback = false;

/**
 * The dedicated waitlist DB connection string (trimmed) or '' when unset.
 * Canonical: BETA_WAITLIST_DATABASE_URL. Fallback: POSTGRES_WAITLIST_DATABASE_URL.
 */
export function waitlistDbUrl() {
  const canonical = env('BETA_WAITLIST_DATABASE_URL');
  if (canonical) return canonical;
  const pg = env('POSTGRES_WAITLIST_DATABASE_URL');
  if (pg) {
    if (!loggedPostgresFallback) {
      loggedPostgresFallback = true;
      console.log('[waitlist] BETA_WAITLIST_DATABASE_URL unset — using POSTGRES_WAITLIST_DATABASE_URL for the waitlist DB');
    }
    return pg;
  }
  return '';
}

/** Which env var the waitlist URL resolves from ('' when neither is set). */
export function waitlistDbUrlSource() {
  if (env('BETA_WAITLIST_DATABASE_URL')) return 'BETA_WAITLIST_DATABASE_URL';
  if (env('POSTGRES_WAITLIST_DATABASE_URL')) return 'POSTGRES_WAITLIST_DATABASE_URL';
  return '';
}

/** True only when a dedicated waitlist DB connection string is present. */
export function isWaitlistDbConfigured() {
  return Boolean(waitlistDbUrl());
}

/**
 * Provider implied by the URL scheme: 'sqlite' for file:, 'postgres' for
 * postgres:// | postgresql://, 'unknown' otherwise (including unset). Drives
 * which generated client waitlistClient.js imports and which schema the
 * ensure-waitlist-db script pushes.
 */
export function waitlistDbProvider(url = waitlistDbUrl()) {
  if (!url) return 'unknown';
  if (url.startsWith('file:')) return 'sqlite';
  if (/^postgres(ql)?:\/\//i.test(url)) return 'postgres';
  return 'unknown';
}

/**
 * A SECRET-FREE, log-safe description of the waitlist DB target. For a local
 * SQLite file we expose only the scheme + file name (not the absolute path); for
 * anything else only the scheme. Never returns credentials.
 */
export function redactedDbTarget() {
  const url = waitlistDbUrl();
  if (!url) return 'unset';
  if (url.startsWith('file:')) {
    const file = url.slice('file:'.length).replace(/^\.\//, '');
    const base = file.split(/[\\/]/).pop() || 'sqlite';
    return `file:…/${base}`;
  }
  const scheme = url.split('://')[0] || 'unknown';
  return `${scheme}://…`;
}

/** A non-sensitive config snapshot for the Ops console. */
export function waitlistConfigStatus() {
  return {
    dbConfigured: isWaitlistDbConfigured(),
    target: redactedDbTarget(),
    provider: waitlistDbProvider(),
  };
}
