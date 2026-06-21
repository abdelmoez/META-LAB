/**
 * waitlist/config.js — configuration + validation for the strictly-separate Beta
 * Waitlist database (prompt48).
 *
 * The waitlist uses its OWN connection string, BETA_WAITLIST_DATABASE_URL — never
 * DATABASE_URL. If the waitlist feature is enabled but this is not configured, the
 * application must FAIL SAFE (refuse to write) and NEVER fall back to the main
 * user database. These helpers are the single place that reads the env var.
 */

function env(key) {
  const v = process.env[key];
  return v && String(v).trim() ? String(v).trim() : '';
}

/** The dedicated waitlist DB connection string (trimmed) or '' when unset. */
export function waitlistDbUrl() {
  return env('BETA_WAITLIST_DATABASE_URL');
}

/** True only when the dedicated waitlist DB connection string is present. */
export function isWaitlistDbConfigured() {
  return Boolean(waitlistDbUrl());
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
  };
}
