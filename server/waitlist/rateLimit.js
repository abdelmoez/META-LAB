/**
 * waitlist/rateLimit.js — small, pure, in-memory rate-limit primitives for the
 * waitlist (prompt48). Pure → unit-testable; `now` is injectable.
 *
 *   - createRateLimiter({ windowMs, max }) → sliding-window per-key limiter, used
 *     for confirmation-email RESEND bursts (per normalized email + per IP).
 *   - resendCooldownRemaining(lastAttemptAt, now, cooldownMs) → cooldown derived
 *     from the PERSISTED last-attempt timestamp so the limit survives restarts and
 *     is enforced even across process boundaries.
 *
 * The public SUBMIT endpoint additionally sits behind an express-rate-limit
 * middleware (server/index.js) — these primitives are the finer-grained guards.
 */

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> number[] (timestamps within window)

  function prune(arr, now) {
    let i = 0;
    while (i < arr.length && now - arr[i] >= windowMs) i += 1;
    return i > 0 ? arr.slice(i) : arr;
  }

  return {
    /** Record + test an attempt. Returns { allowed, remaining, retryAfterMs }. */
    check(key, now = Date.now()) {
      const arr = prune(hits.get(key) || [], now);
      if (arr.length >= max) {
        hits.set(key, arr);
        const retryAfterMs = Math.max(0, windowMs - (now - arr[0]));
        return { allowed: false, remaining: 0, retryAfterMs };
      }
      arr.push(now);
      hits.set(key, arr);
      return { allowed: true, remaining: Math.max(0, max - arr.length), retryAfterMs: 0 };
    },
    /** Peek without recording. */
    peek(key, now = Date.now()) {
      const arr = prune(hits.get(key) || [], now);
      return { allowed: arr.length < max, remaining: Math.max(0, max - arr.length) };
    },
    reset(key) {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    },
    _size() { return hits.size; },
  };
}

/**
 * Milliseconds remaining before a confirmation email may be resent, derived from
 * the persisted last-attempt timestamp. 0 ⇒ allowed now.
 * @param {Date|string|number|null} lastAttemptAt
 * @param {number} now
 * @param {number} cooldownMs
 */
export function resendCooldownRemaining(lastAttemptAt, now = Date.now(), cooldownMs = 60_000) {
  if (lastAttemptAt == null) return 0;
  const t = lastAttemptAt instanceof Date ? lastAttemptAt.getTime() : new Date(lastAttemptAt).getTime();
  if (Number.isNaN(t)) return 0;
  const remaining = cooldownMs - (now - t);
  return remaining > 0 ? remaining : 0;
}
