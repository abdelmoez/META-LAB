/**
 * engine-registry/version.js — pure version math for the internal "engine version"
 * system. PecanRev tracks a per-engine STRUCTURAL version {major, minor} (both
 * non-negative integers, NEVER a float) rendered as "v{major}.{minor}".
 *
 * Dependency-free, no DB / React / Node-only APIs. Imported by the bump CLI and
 * the DB service.
 */

/** The two recognised change types. A 'minor' bumps minor; a 'major' bumps major + resets minor. */
export const CHANGE_TYPES = ['minor', 'major'];

/** True iff `t` is one of the recognised change types. */
export function isValidChangeType(t) {
  return t === 'minor' || t === 'major';
}

/** Internal: a value is a "version int" iff it's a non-negative integer (Number). */
function isVersionInt(n) {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/**
 * Bump a version by change type.
 *   'minor' → { major, minor: minor + 1 }
 *   'major' → { major: major + 1, minor: 0 }
 * Throws on an invalid change type or non-negative-integer components.
 */
export function bumpVersion(version, type) {
  if (!version || typeof version !== 'object') {
    throw new Error('bumpVersion: version must be a { major, minor } object');
  }
  const { major, minor } = version;
  if (!isVersionInt(major) || !isVersionInt(minor)) {
    throw new Error('bumpVersion: major/minor must be non-negative integers');
  }
  if (!isValidChangeType(type)) {
    throw new Error('invalid change type: ' + String(type));
  }
  if (type === 'minor') {
    return { major, minor: minor + 1 };
  }
  // type === 'major'
  return { major: major + 1, minor: 0 };
}

/**
 * Format a version as "v{major}.{minor}". Accepts a {major, minor} object;
 * guards null/undefined/garbage → 'v0.0'.
 */
export function formatVersion(v) {
  if (!v || typeof v !== 'object') return 'v0.0';
  const major = isVersionInt(v.major) ? v.major : 0;
  const minor = isVersionInt(v.minor) ? v.minor : 0;
  return 'v' + major + '.' + minor;
}

/**
 * Parse "v1.2" or "1.2" → { major: 1, minor: 2 }. Returns null on anything that
 * is not exactly two non-negative integers separated by a dot (optional leading
 * 'v'/'V').
 */
export function parseVersion(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^[vV]?(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/**
 * Compare two versions by major then minor.
 * Returns -1 if a < b, 0 if equal, 1 if a > b. Missing components treated as 0.
 */
export function compareVersion(a, b) {
  const am = a && isVersionInt(a.major) ? a.major : 0;
  const an = a && isVersionInt(a.minor) ? a.minor : 0;
  const bm = b && isVersionInt(b.major) ? b.major : 0;
  const bn = b && isVersionInt(b.minor) ? b.minor : 0;
  if (am !== bm) return am < bm ? -1 : 1;
  if (an !== bn) return an < bn ? -1 : 1;
  return 0;
}
