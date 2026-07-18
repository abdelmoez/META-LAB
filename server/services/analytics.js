/**
 * server/services/analytics.js — 93.md §5.3/§5.4 (MUST #17): product analytics
 * over the EXISTING UsageEvent foundation (server/utils/usage.js). This is a
 * thin wrapper, NOT a second event system — every event lands as a UsageEvent
 * row via recordUsage; this module only adds:
 *
 *   1. redactMeta()       — key-whitelisted, length-capped meta. Analytics rows
 *                           must NEVER carry content (titles/abstracts/manuscript
 *                           text/emails/free text) — only ids, counts and enums.
 *   2. recordEvent()      — validated, redacted, disable-switchable write.
 *   3. recordFirstEvent() — at-most-once-per-user write, ATOMIC via the
 *                           deterministic primary key `first:<TYPE>:<userId>`
 *                           (UsageEvent.id is a String PK, so a concurrent
 *                           double-fire loses the PK insert race in the DB —
 *                           no findFirst+create race window).
 *   4. Optional PostHog forward — OFF by default; only active when BOTH
 *                           POSTHOG_API_KEY and POSTHOG_HOST are set. Batched
 *                           (5s flush), hard-capped queue (drop + count when
 *                           full), zero retries, total failure isolation: a
 *                           dead/slow PostHog can never throw into, slow down
 *                           or fail a request — local UsageEvent rows are
 *                           written regardless of forwarding health.
 *
 * DISABLE SWITCH (93.md): ANALYTICS_DISABLED=1 (or "true") short-circuits both
 * recording and forwarding. Ops/operational telemetry that calls
 * utils/usage.js recordUsage directly (exports, invites, emails, APP_ACTIVE)
 * is deliberately NOT gated by this switch — it powers the admin ops console,
 * not product analytics.
 *
 * CONTRACT: nothing in this module ever throws or rejects. All exports resolve
 * to plain values; call sites fire-and-forget (tests may await for determinism).
 */
import { recordUsage } from '../utils/usage.js';

/* ── Config (read at call time so tests/ops can toggle env without reload) ── */

function analyticsDisabled() {
  const v = process.env.ANALYTICS_DISABLED;
  return v === '1' || v === 'true';
}

function posthogConfig() {
  const key = process.env.POSTHOG_API_KEY || '';
  const host = (process.env.POSTHOG_HOST || '').trim().replace(/\/+$/, '');
  return key && host ? { key, host } : null;
}

/* ── Meta redaction ─────────────────────────────────────────────────────── */

// The ONLY keys an analytics meta may carry. Everything else is dropped —
// whitelisting (not blacklisting) is what guarantees content can never leak
// into UsageEvent.meta or PostHog through a careless call site.
export const META_KEY_WHITELIST = Object.freeze([
  'projectId',       // opaque id — never a title
  'screenProjectId',
  'count',
  'source',          // short enum-ish origin tag (e.g. 'register', 'ris', 'contact')
  'durationMs',
  'format',
  'severity',        // contact-form triage severity (closed enum upstream)
  'stage',           // screening stage enum ('title_abstract' | 'full_text')
]);

const META_MAX_STRING = 120;

/**
 * redactMeta — whitelist keys + truncate strings. Returns a SMALL plain object
 * or null (never throws). Values: finite numbers and booleans pass through;
 * strings are trimmed to 120 chars; objects/arrays/functions/symbols/NaN are
 * dropped entirely (nested structures are where content smuggles in).
 */
export function redactMeta(meta) {
  try {
    if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const out = {};
    for (const key of META_KEY_WHITELIST) {
      if (!Object.prototype.hasOwnProperty.call(meta, key)) continue;
      const v = meta[key];
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
      else if (typeof v === 'boolean') out[key] = v;
      else if (typeof v === 'string' && v !== '') out[key] = v.slice(0, META_MAX_STRING);
      // everything else (objects, arrays, null, NaN, functions, symbols) dropped
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

/* ── PostHog forwarder (opt-in, batched, capped, no retries) ────────────── */

const POSTHOG_QUEUE_MAX = 500;
const POSTHOG_FLUSH_MS = 5000;
const POSTHOG_TIMEOUT_MS = 4000;

let phQueue = [];
let phDropped = 0; // events dropped (queue full or send failed) — observable, never fatal
let phTimer = null;

/** Enqueue one event for the batched forward. Silent no-op unless configured. */
function forwardToPosthog(event, distinctId, properties) {
  try {
    if (analyticsDisabled() || !distinctId || !posthogConfig()) return;
    if (phQueue.length >= POSTHOG_QUEUE_MAX) { phDropped++; return; }
    phQueue.push({
      event: String(event),
      // distinct_id is the INTERNAL user id (opaque uuid) — never an email/name.
      distinct_id: String(distinctId),
      properties: { ...(properties || {}) },
      timestamp: new Date().toISOString(),
    });
    if (!phTimer) {
      phTimer = setTimeout(() => { flushPosthog().catch(() => {}); }, POSTHOG_FLUSH_MS);
      // unref so a pending flush can never hold the process open on shutdown —
      // analytics is best-effort; up to one 5s window of events may be lost.
      if (typeof phTimer.unref === 'function') phTimer.unref();
    }
  } catch { /* forwarding is a side-effect, never a failure mode */ }
}

/**
 * flushPosthog — send the queued batch once (NO retries: a failed batch is
 * counted as dropped and forgotten — 93.md failure isolation). Exported for
 * tests and for an optional shutdown flush. Never rejects.
 * @returns {Promise<{attempted:number, dropped:number}>}
 */
export async function flushPosthog() {
  try {
    if (phTimer) { clearTimeout(phTimer); phTimer = null; }
    const cfg = posthogConfig();
    const batch = phQueue.splice(0, phQueue.length);
    if (!cfg || batch.length === 0) return { attempted: 0, dropped: phDropped };
    const controller = new AbortController();
    const kill = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS);
    if (typeof kill.unref === 'function') kill.unref();
    try {
      // PostHog batch capture — https://<host>/capture/ accepts {api_key, batch:[...]}.
      await fetch(`${cfg.host}/capture/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: cfg.key, batch }),
        signal: controller.signal,
      });
    } catch {
      phDropped += batch.length; // send failed → count + forget, never retry
    } finally {
      clearTimeout(kill);
    }
    return { attempted: batch.length, dropped: phDropped };
  } catch { return { attempted: 0, dropped: phDropped }; }
}

/** Test/ops observability for the forwarder — cheap snapshot, never throws. */
export function posthogQueueStats() {
  return { queued: phQueue.length, dropped: phDropped, enabled: !!posthogConfig() && !analyticsDisabled() };
}

/* ── Event recording ────────────────────────────────────────────────────── */

/**
 * recordEvent — write one analytics UsageEvent row (redacted meta) and, when
 * PostHog is configured, enqueue the forward. Fire-and-forget at call sites.
 *
 * @param {string} type one of USAGE.* (server/utils/usage.js)
 * @param {{
 *   userId?: string|null,
 *   projectId?: string|null,        // alias for metaLabProjectId (93.md brief shape)
 *   metaLabProjectId?: string|null,
 *   screenProjectId?: string|null,
 *   format?: string|null,
 *   meta?: object|null,             // redacted via redactMeta — NEVER content
 * }} [opts]
 * @returns {Promise<boolean>} true iff the local row was created; NEVER rejects
 */
export function recordEvent(type, opts = {}) {
  try {
    if (!type || analyticsDisabled()) return Promise.resolve(false);
    const { userId, projectId, metaLabProjectId, screenProjectId, format, meta } = opts || {};
    const safeMeta = redactMeta(meta);
    const written = recordUsage({
      type,
      userId: userId || null,
      metaLabProjectId: metaLabProjectId || projectId || null,
      screenProjectId: screenProjectId || null,
      format: format || null,
      meta: safeMeta,
    });
    forwardToPosthog(type, userId, safeMeta || undefined);
    return written;
  } catch { return Promise.resolve(false); }
}

/**
 * recordFirstEvent — write an event AT MOST ONCE per (type, user), atomically.
 *
 * Mechanism: UsageEvent.id is a String PRIMARY KEY, so inserting with the
 * deterministic id `first:<TYPE>:<userId>` makes the database itself enforce
 * once-only — the second (or concurrent) insert fails the PK uniqueness check
 * inside recordUsage and resolves false. No check-then-create race window.
 * PostHog is only forwarded when the row was genuinely created (first time).
 *
 * @param {string} type one of USAGE.* first-only constants
 * @param {string} userId REQUIRED — no-op without a user to scope "first" to
 * @param {object} [opts] same optional fields as recordEvent (minus userId)
 * @returns {Promise<boolean>} true iff this call recorded the first; NEVER rejects
 */
export async function recordFirstEvent(type, userId, opts = {}) {
  try {
    if (!type || !userId || analyticsDisabled()) return false;
    const { projectId, metaLabProjectId, screenProjectId, format, meta } = opts || {};
    const safeMeta = redactMeta(meta);
    const created = await recordUsage({
      type,
      id: `first:${type}:${userId}`,
      userId,
      metaLabProjectId: metaLabProjectId || projectId || null,
      screenProjectId: screenProjectId || null,
      format: format || null,
      meta: safeMeta,
    });
    if (created) forwardToPosthog(type, userId, safeMeta || undefined);
    return created;
  } catch { return false; }
}
