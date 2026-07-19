/**
 * server/utils/usage.js — best-effort product-usage event recording (prompt9).
 *
 * Powers the ops-console usage metrics (invites pending/accepted, exports by
 * format, emails sent/failed, deletes/leaves, notification clicks).
 *
 * CONTRACT: recordUsage is fire-and-forget and NEVER throws — a metrics
 * failure must never fail or slow the request being measured. UsageEvent has
 * no FKs by design (SecurityEvent/Notification precedent): rows survive the
 * deletion of the users/projects they describe.
 */
import { prisma } from '../db/client.js';

// Typed event constants — use these, never raw strings, at call sites.
export const USAGE = {
  EXPORT: 'EXPORT',
  EMAIL_SENT: 'EMAIL_SENT',
  EMAIL_FAILED: 'EMAIL_FAILED',
  MEMBER_LEFT: 'MEMBER_LEFT',
  PROJECT_DELETED: 'PROJECT_DELETED',
  INVITE_CREATED: 'INVITE_CREATED',
  INVITE_ACCEPTED: 'INVITE_ACCEPTED',
  INVITE_REVOKED: 'INVITE_REVOKED',
  NOTIFICATION_CLICKED: 'NOTIFICATION_CLICKED',
  // prompt11 — user-facing archive/unarchive (reversible hide) of a META·LAB
  // project and a META·SIFT review workspace, owner-only.
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
  PROJECT_UNARCHIVED: 'PROJECT_UNARCHIVED',
  WORKSPACE_ARCHIVED: 'WORKSPACE_ARCHIVED',
  WORKSPACE_UNARCHIVED: 'WORKSPACE_UNARCHIVED',
  // prompt11 — owner-only handoff of a workspace (and its linked META·LAB
  // project) to another active member.
  OWNERSHIP_TRANSFERRED: 'OWNERSHIP_TRANSFERRED',
  // prompt14 — token-based password reset email outcomes. Generic EMAIL_SENT/
  // EMAIL_FAILED are still recorded by sendEmail (with meta.context); these add a
  // reset-specific signal for the ops email metrics without parsing meta.
  PASSWORD_RESET_EMAIL_SENT: 'PASSWORD_RESET_EMAIL_SENT',
  PASSWORD_RESET_EMAIL_FAILED: 'PASSWORD_RESET_EMAIL_FAILED',
  // prompt15 follow-up — one row per active user per throttle window (≤1/user/5min,
  // gated by the same requireAuth lastActive throttle). Powers the ops "active users"
  // per-day series/sparkline (lastActive alone only holds the latest timestamp, so it
  // cannot reconstruct historical per-day active counts; these events can).
  APP_ACTIVE: 'APP_ACTIVE',
  // 93.md §5.3/§5.4 — signup + activation funnel events. Recorded through
  // server/services/analytics.js (recordEvent / recordFirstEvent), which owns
  // meta redaction, the ANALYTICS_DISABLED switch and optional PostHog forwarding.
  // FIRST_* events are written AT MOST ONCE PER USER, enforced by the database:
  // recordFirstEvent inserts with the deterministic primary key
  // `first:<TYPE>:<userId>` so a concurrent double-fire loses the PK race
  // instead of duplicating. See docs/manager/analytics-events.md for the catalog.
  ACCOUNT_CREATED: 'ACCOUNT_CREATED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED', // first-only (verification flow: prompt26)
  FIRST_LOGIN: 'FIRST_LOGIN',
  PROJECT_CREATED: 'PROJECT_CREATED',
  FIRST_PROJECT_CREATED: 'FIRST_PROJECT_CREATED',
  IMPORT_COMPLETED: 'IMPORT_COMPLETED',
  FIRST_IMPORT_COMPLETED: 'FIRST_IMPORT_COMPLETED',
  // Only the user's FIRST screening decision is a usage event — recording every
  // decision would bloat UsageEvent (decisions live in ScreenDecision already).
  SCREENING_DECISION_FIRST: 'SCREENING_DECISION_FIRST',
  FIRST_ANALYSIS_RUN: 'FIRST_ANALYSIS_RUN',
  // DERIVED-ONLY (93.md): no call site writes FIRST_EXPORT rows. Every export
  // path already records an EXPORT row, so "first export" is derived at query
  // time as the user's earliest EXPORT event (min createdAt per userId). The
  // constant exists so activation queries/docs share one spelling.
  FIRST_EXPORT: 'FIRST_EXPORT',
  FEEDBACK_SUBMITTED: 'FEEDBACK_SUBMITTED',
  // NOTE (93.md): WAITLIST_SIGNUP is intentionally ABSENT — waitlist signups are
  // already recorded as BetaWaitlistStatusEvent (null → WAITLISTED, "Joined
  // waitlist") in the strictly isolated waitlist DB. Do not duplicate here.
  // 94.md §2.10 — Google auth funnel. Privacy-safe: meta never carries codes,
  // tokens, state/nonce values or provider responses — only coarse outcome labels
  // (e.g. meta.reason = 'not_invited'). Recorded fire-and-forget via analytics.js.
  GOOGLE_AUTH_STARTED: 'GOOGLE_AUTH_STARTED',
  GOOGLE_AUTH_COMPLETED: 'GOOGLE_AUTH_COMPLETED',
  GOOGLE_AUTH_FAILED: 'GOOGLE_AUTH_FAILED',
  GOOGLE_ACCOUNT_LINKED: 'GOOGLE_ACCOUNT_LINKED',
  GOOGLE_ACCOUNT_UNLINKED: 'GOOGLE_ACCOUNT_UNLINKED',
};

/**
 * recordUsage — write one UsageEvent row, best-effort.
 * Fire-and-forget: not awaited by callers, swallows every error.
 *
 * 93.md — additive extension for the analytics service: an optional caller-
 * supplied `id` (used for the deterministic `first:<TYPE>:<userId>` once-only
 * PK) and a never-rejecting return promise that resolves `true` only when the
 * row was actually created (false on any failure, INCLUDING a PK collision —
 * which is how recordFirstEvent detects "already recorded"). Existing callers
 * ignore the return value, so behaviour is unchanged for them.
 *
 * @param {{
 *   type: string,                 // one of USAGE.* (required; no-op when missing)
 *   id?: string|null,             // optional deterministic primary key (93.md first-only events)
 *   userId?: string|null,
 *   screenProjectId?: string|null,
 *   metaLabProjectId?: string|null,
 *   format?: string|null,         // export format (csv|json|ris|png|svg|...)
 *   meta?: object|string|null,    // JSON-serialisable context (objects are stringified)
 * }} event
 * @returns {Promise<boolean>} resolves true iff a row was created; NEVER rejects
 */
export function recordUsage({ type, id, userId, screenProjectId, metaLabProjectId, format, meta } = {}) {
  if (!type) return Promise.resolve(false);
  try {
    let metaStr = null;
    if (meta != null) {
      try {
        metaStr = typeof meta === 'string' ? meta : JSON.stringify(meta);
      } catch { metaStr = null; }
    }
    return prisma.usageEvent.create({
      data: {
        ...(id ? { id: String(id).slice(0, 200) } : {}),
        type: String(type),
        userId: userId || null,
        screenProjectId: screenProjectId || null,
        metaLabProjectId: metaLabProjectId || null,
        format: format || null,
        meta: metaStr ? metaStr.slice(0, 4000) : null,
      },
    }).then(() => true).catch(() => false);
  } catch { /* usage metrics are a side-effect, never a failure mode */ }
  return Promise.resolve(false);
}
