/**
 * users/fmt.js — 95.md — small pure formatters for the Ops user-management UI.
 *
 * Kept local to the users/ package so the extracted components never reach back
 * into AdminConsole.jsx internals. fmtDate/fmtDateTime/fmtAgo mirror the console
 * helpers byte-for-byte so the redesign reads identically to the rest of Ops.
 */

export function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
export function fmtDateTime(d) { return d ? new Date(d).toLocaleString() : '—'; }

export function fmtAgo(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}

// "Active now" threshold — a lastActive newer than this reads as online even
// when the presence heartbeat is not available (matches the 5-min copy in 95.md).
const ACTIVE_NOW_MS = 5 * 60 * 1000;

/**
 * "Last active" label (95.md Phase 2): 'Active now' when online or < 5 min,
 * a relative age otherwise, and 'Never' when the account never logged in.
 * @param {string|Date|null} lastActive
 * @param {boolean} [isOnline] live presence heartbeat (optional)
 */
export function lastActiveLabel(lastActive, isOnline) {
  if (isOnline) return 'Active now';
  if (!lastActive) return 'Never';
  if (Date.now() - new Date(lastActive).getTime() < ACTIVE_NOW_MS) return 'Active now';
  return fmtAgo(lastActive);
}

/** Up to two initials from a name, falling back to the email's first letter. */
export function initialsFor(name, email) {
  const n = (name || '').trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (a + b).toUpperCase() || '?';
  }
  const e = (email || '').trim();
  return e ? e[0].toUpperCase() : '?';
}
