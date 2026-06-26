/**
 * waitlistApi.js — client for the PUBLIC Beta Waitlist endpoints (prompt48).
 * Unauthenticated; credentials included only so it behaves consistently with the
 * rest of the app (the endpoints themselves require no session).
 */

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data && data.code;
    err.fieldErrors = (data && data.errors) || null;
    throw err;
  }
  return data;
}

/** Submit a completed waitlist application. Resolves to { ok, duplicate, status, ... }. */
export const submitWaitlist = (payload) => postJson('/api/waitlist', payload);

/** Request a re-send of the confirmation email. Always resolves generically. */
export const resendWaitlist = (email) => postJson('/api/waitlist/resend', { email });

/**
 * Public total signup count for the landing "teams registered" card. Never throws
 * and never fabricates: returns an integer, or `null` when the count is
 * unavailable (DB not configured, rate-limited, offline) so the card simply hides.
 */
export async function fetchWaitlistCount() {
  try {
    const res = await fetch('/api/waitlist/count', { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}

/**
 * Read public feature flags (no auth). Used by the homepage gate to decide whether
 * to show the Beta Waitlist page. Never throws — returns {} on any failure.
 */
export async function fetchFeatureFlags() {
  try {
    const res = await fetch('/api/settings/public', { credentials: 'include' });
    if (!res.ok) return {};
    const data = await res.json();
    return (data && data.featureFlags) || {};
  } catch {
    return {};
  }
}
