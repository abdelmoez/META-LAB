/**
 * adminUserMgmtController.js — 95.md — the NEW admin user-management surface:
 * summary metrics, per-user activity timeline, internal notes, standalone
 * session revocation, admin resend-verification, batched bulk actions and the
 * filtered CSV export. Kept out of the (already large) adminController; the
 * list/detail handlers stay there and share the same query engine
 * (services/adminUserQuery.js) so filters mean the same thing everywhere.
 *
 * Security posture (95.md Phases 6/9/12):
 *   - every route is mounted behind requireAuth + requireAdmin/requireAdminOrMod
 *     (+ requireTargetEditable for per-target mod actions) in routes/admin.js;
 *   - handlers keep the house defense-in-depth re-checks;
 *   - every mutation writes AdminAuditLog (with the new reason/requestId/
 *     bulkOperationId correlation columns); secrets/tokens are never logged;
 *   - bulk actions are server-side single-request, capped, deduped, guarded
 *     per-target, bounded-concurrency (adminBulkInvite pattern) and idempotent
 *     per action semantics.
 */
import crypto from 'crypto';
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { invalidateAuthState } from '../middleware/auth.js';
import { forceCloseStreams } from '../realtime/bus.js';
import { parseUsersListQuery } from '../schemas/adminUserSchemas.js';
import { buildUsersWhere, buildUsersOrderBy } from '../services/adminUserQuery.js';
import { getUserTimelineEvents } from '../services/userTimeline.js';
import { recordTierAssignment } from '../services/entitlementService.js';
import { createVerificationToken } from '../services/emailVerificationService.js';
import { sendEmail, renderEmailVerificationEmail, isEmailConfigured } from '../services/emailService.js';
import { startOfWindow } from '../utils/userGrowth.js';
import { deriveStatus, BULK_USER_ACTIONS } from '../../src/shared/adminUsers.js';

/** Bounded-concurrency map (adminBulkInvite precedent — bulk work must never
 * stampede SQLite or the SMTP relay). */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const FILTER_KEYS = ['search', 'role', 'status', 'verified', 'onboarded', 'noInstitution', 'suspended', 'authMethod', 'regMethod', 'tier', 'createdWithin', 'lastActiveWithin'];

// ── GET /api/admin/users/metrics ───────────────────────────────────────────────
/**
 * 95.md Phase 8 — compact summary strip. Counts run against the SAME where the
 * list uses (each axis composed via AND so filter semantics can't drift), and
 * `filtered` tells the UI whether the numbers describe everyone or the current
 * selection. ~10 indexed count queries — cheap, admin-only, rate-limited.
 */
export async function getUserSummaryMetrics(req, res) {
  try {
    const filters = parseUsersListQuery(req.query);
    const where = await buildUsersWhere(filters);
    const withBase = (extra) => ({ AND: [where, extra] });
    const weekStart = startOfWindow('week', new Date());

    const [total, active, suspended, pendingVerification, neverLoggedIn, newThisWeek,
      googleRegistered, emailRegistered, bothLoginMethods, googleConnected] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.count({ where: withBase({ suspended: false, emailVerifiedAt: { not: null } }) }),
      prisma.user.count({ where: withBase({ suspended: true }) }),
      prisma.user.count({ where: withBase({ suspended: false, emailVerifiedAt: null }) }),
      prisma.user.count({ where: withBase({ lastActive: null }) }),
      prisma.user.count({ where: withBase({ createdAt: { gte: weekStart } }) }),
      prisma.user.count({ where: withBase({ registrationMethod: 'google' }) }),
      prisma.user.count({ where: withBase({ registrationMethod: 'email' }) }),
      prisma.user.count({ where: withBase({ password: { not: null }, authAccounts: { some: {} } }) }),
      prisma.user.count({ where: withBase({ authAccounts: { some: { provider: 'google' } } }) }),
    ]);

    return res.json({
      filtered: FILTER_KEYS.some((k) => filters[k] !== undefined),
      metrics: { total, active, suspended, pendingVerification, neverLoggedIn, newThisWeek, googleRegistered, emailRegistered, bothLoginMethods, googleConnected },
    });
  } catch (err) {
    console.error('[admin] user metrics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/:id/timeline ──────────────────────────────────────────
export async function getUserTimeline(req, res) {
  try {
    const events = await getUserTimelineEvents(req.params.id);
    if (!events) return res.status(404).json({ error: 'User not found' });
    return res.json({ events });
  } catch (err) {
    console.error('[admin] user timeline error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Internal notes (95.md Phase 5) ─────────────────────────────────────────────
// Visible ONLY through these admin routes; never exposed to the user. Mods may
// view + create; editing/deleting requires being the author or an admin.
export async function listUserNotes(req, res) {
  try {
    const notes = await prisma.userAdminNote.findMany({
      where: { userId: req.params.id, deletedAt: null },
      select: { id: true, body: true, authorId: true, authorName: true, createdAt: true, editedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ notes });
  } catch (err) {
    console.error('[admin] list notes error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function createUserNote(req, res) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    const author = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const note = await prisma.userAdminNote.create({
      data: {
        userId: target.id,
        authorId: req.user.id,
        authorName: author?.name || author?.email || 'Ops',
        body: req.body.body,
      },
      select: { id: true, body: true, authorId: true, authorName: true, createdAt: true, editedAt: true },
    });
    // Audited WITHOUT the note body (the body is Ops-internal; the audit trail
    // records that a note exists and who wrote it — Phase 12).
    logAdminAction(req, 'USER_NOTE_CREATED', 'User', target.id, { noteId: note.id });
    return res.status(201).json({ note });
  } catch (err) {
    console.error('[admin] create note error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function loadEditableNote(req, res) {
  const note = await prisma.userAdminNote.findUnique({ where: { id: req.params.noteId } });
  if (!note || note.deletedAt || note.userId !== req.params.id) {
    res.status(404).json({ error: 'Note not found' });
    return null;
  }
  // Clearly-defined permission (95.md Phase 5): author or any admin.
  if (note.authorId !== req.user.id && req.user.role !== 'admin') {
    res.status(403).json({ error: 'Only the author or an administrator can modify this note' });
    return null;
  }
  return note;
}

export async function updateUserNote(req, res) {
  try {
    const note = await loadEditableNote(req, res);
    if (!note) return;
    const updated = await prisma.userAdminNote.update({
      where: { id: note.id },
      data: { body: req.body.body, editedAt: new Date() },
      select: { id: true, body: true, authorId: true, authorName: true, createdAt: true, editedAt: true },
    });
    logAdminAction(req, 'USER_NOTE_EDITED', 'User', note.userId, { noteId: note.id });
    return res.json({ note: updated });
  } catch (err) {
    console.error('[admin] update note error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteUserNote(req, res) {
  try {
    const note = await loadEditableNote(req, res);
    if (!note) return;
    // Soft delete — hidden from the panel, retained for the audit trail.
    await prisma.userAdminNote.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
    logAdminAction(req, 'USER_NOTE_DELETED', 'User', note.userId, { noteId: note.id });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] delete note error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/users/:id/revoke-sessions ──────────────────────────────────
/**
 * 95.md Phase 6 — standalone session revocation: the three proven primitives
 * from updateUserStatus (epoch bump → every issued JWT fails its next check;
 * cache invalidation → instant; SSE close → live tabs drop) without changing
 * account status.
 */
export async function revokeUserSessions(req, res) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, email: true } });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }
    await prisma.user.update({ where: { id: target.id }, data: { sessionEpoch: { increment: 1 } } });
    invalidateAuthState(target.id);
    try { forceCloseStreams(target.id); } catch { /* best-effort */ }
    await logAdminAction(req, 'REVOKE_SESSIONS', 'User', target.id, { email: target.email }, { reason: req.body?.reason });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] revoke sessions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/users/:id/resend-verification ──────────────────────────────
/** Mirrors the password-reset ceremony: email best-effort, copyable link
 * fallback when SMTP is unconfigured/failed. 409 when already verified. */
export async function resendVerificationAdmin(req, res) {
  try {
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, role: true, email: true, name: true, emailVerifiedAt: true },
    });
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }
    if (target.emailVerifiedAt) {
      return res.status(409).json({ error: 'This email address is already verified.', code: 'ALREADY_VERIFIED' });
    }

    const { token, expiresAt } = await createVerificationToken(target.id);
    const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/verify-email?token=${token}`;
    let sent = false;
    if (isEmailConfigured()) {
      const { html, text } = renderEmailVerificationEmail({ toName: target.name || '', link, expiresAt });
      const result = await sendEmail({ to: target.email, subject: 'Verify your PecanRev email', html, text, context: 'email_verification' });
      sent = !!result.sent;
    }
    // Token itself is NEVER logged (Phase 12); the link is returned to the
    // operator only when it could not be emailed (password-reset parity).
    await logAdminAction(req, 'RESEND_VERIFICATION', 'User', target.id, { email: target.email, sent });
    return res.json({ ok: true, sent, ...(sent ? {} : { link }) });
  } catch (err) {
    console.error('[admin] resend verification error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/users/bulk (ADMIN ONLY) ────────────────────────────────────
/**
 * 95.md Phase 7 — one server-side request per bulk run (never a client fan-out
 * that burns the admin rate-limit pool). Guard order per target: exists →
 * not-self → not-admin → action-specific idempotency skip. Every applied
 * target gets its own AdminAuditLog row; one BULK_USER_ACTION summary row ties
 * them together via bulkOperationId.
 */
export async function bulkUserAction(req, res) {
  try {
    const { action, tierId, reason } = req.body;
    const ids = [...new Set(req.body.ids)];
    if (!BULK_USER_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'Unknown bulk action' });
    }

    // assign_tier validates the tier ONCE up front — a bad tier fails the whole
    // request instead of skipping every row.
    if (action === 'assign_tier') {
      if (!tierId) return res.status(400).json({ error: 'tierId is required for assign_tier', code: 'TIER_NOT_FOUND' });
      const tier = await prisma.productTier.findUnique({ where: { id: tierId } });
      if (!tier || tier.archivedAt) {
        return res.status(400).json({ error: 'The selected tier does not exist or is archived.', code: 'TIER_NOT_FOUND' });
      }
    }

    const targets = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, name: true, role: true, suspended: true, emailVerifiedAt: true },
    });
    const byId = new Map(targets.map((t) => [t.id, t]));
    const bulkOperationId = crypto.randomUUID();

    const results = await mapPool(ids, 5, async (id) => {
      const t = byId.get(id);
      if (!t) return { id, ok: false, code: 'NOT_FOUND' };
      if (id === req.user.id && (action === 'suspend' || action === 'revoke_sessions')) {
        return { id, ok: false, code: 'SKIP_SELF' };
      }
      // Conservative by design: bulk never touches admin accounts (individual,
      // confirmed, single-target endpoints exist for those).
      if (t.role === 'admin') return { id, ok: false, code: 'SKIP_ADMIN' };

      try {
        switch (action) {
          case 'suspend': {
            if (t.suspended) return { id, ok: false, code: 'SKIP_ALREADY_SUSPENDED' };
            await prisma.user.update({
              where: { id },
              data: { suspended: true, suspendedAt: new Date(), sessionEpoch: { increment: 1 } },
            });
            invalidateAuthState(id);
            try { forceCloseStreams(id); } catch { /* best-effort */ }
            await logAdminAction(req, 'SUSPEND_USER', 'User', id, { email: t.email, suspended: true, bulk: true }, { reason, bulkOperationId });
            return { id, ok: true };
          }
          case 'restore': {
            if (!t.suspended) return { id, ok: false, code: 'SKIP_NOT_SUSPENDED' };
            // Sessions stay revoked (epoch keeps its bump) — restore re-enables
            // login, it does not resurrect old cookies (existing policy).
            await prisma.user.update({ where: { id }, data: { suspended: false, suspendedAt: null } });
            invalidateAuthState(id);
            await logAdminAction(req, 'SUSPEND_USER', 'User', id, { email: t.email, suspended: false, bulk: true }, { reason, bulkOperationId });
            return { id, ok: true };
          }
          case 'revoke_sessions': {
            await prisma.user.update({ where: { id }, data: { sessionEpoch: { increment: 1 } } });
            invalidateAuthState(id);
            try { forceCloseStreams(id); } catch { /* best-effort */ }
            await logAdminAction(req, 'REVOKE_SESSIONS', 'User', id, { email: t.email, bulk: true }, { reason, bulkOperationId });
            return { id, ok: true };
          }
          case 'resend_verification': {
            if (t.emailVerifiedAt) return { id, ok: false, code: 'ALREADY_VERIFIED' };
            if (!isEmailConfigured()) return { id, ok: false, code: 'FAILED' }; // no link fallback in bulk — links are per-operator artifacts
            const { token, expiresAt } = await createVerificationToken(id);
            const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
            const { html, text } = renderEmailVerificationEmail({ toName: t.name || '', link: `${base}/verify-email?token=${token}`, expiresAt });
            const sent = await sendEmail({ to: t.email, subject: 'Verify your PecanRev email', html, text, context: 'email_verification' });
            await logAdminAction(req, 'RESEND_VERIFICATION', 'User', id, { email: t.email, sent: !!sent.sent, bulk: true }, { reason, bulkOperationId });
            return sent.sent ? { id, ok: true } : { id, ok: false, code: 'FAILED' };
          }
          case 'assign_tier': {
            await recordTierAssignment({
              userId: id,
              tierId,
              userTierId: tierId,
              changeType: 'admin_bulk',
              reason: reason || 'Bulk tier assignment',
              assignedByName: req.user.email,
            });
            // Review fix (95 r2) — single-target tier changes invalidate the 15s
            // auth/entitlement cache so the new tier applies instantly; bulk
            // must not drift from that semantic.
            invalidateAuthState(id);
            await logAdminAction(req, 'UPDATE_USER_TIER', 'User', id, { to: tierId, bulk: true }, { reason, bulkOperationId });
            return { id, ok: true };
          }
          default:
            return { id, ok: false, code: 'FAILED' };
        }
      } catch (e) {
        console.error(`[admin] bulk ${action} failed for ${id}:`, e?.message || e);
        return { id, ok: false, code: 'FAILED' };
      }
    });

    const summary = {
      requested: ids.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && r.code === 'FAILED').length,
      skipped: results.filter((r) => !r.ok && r.code !== 'FAILED').length,
    };
    await logAdminAction(req, 'BULK_USER_ACTION', 'User', null, { action, ...summary }, { reason, bulkOperationId });
    return res.json({ bulkOperationId, summary, results });
  } catch (err) {
    console.error('[admin] bulk action error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/export.csv (ADMIN ONLY) ───────────────────────────────
const EXPORT_CAP = 5000;
const csv = (v) => {
  let s = v == null ? '' : String(v);
  // Review fix (95 r2) — CSV/formula-injection guard: user-controlled fields
  // (name, institution) must never open as live formulas in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export async function exportUsersCsv(req, res) {
  try {
    const filters = parseUsersListQuery(req.query);
    const where = await buildUsersWhere(filters);
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, userNumber: true, name: true, email: true, role: true, tierId: true,
        suspended: true, emailVerifiedAt: true, registrationMethod: true, password: true,
        createdAt: true, lastActive: true, institutionOriginal: true, country: true,
        _count: { select: { projects: true } },
        authAccounts: { select: { provider: true } },
      },
      orderBy: buildUsersOrderBy(filters.sort, filters.order),
      take: EXPORT_CAP,
    });

    await logAdminAction(req, 'EXPORT_USERS', 'User', null, {
      count: users.length,
      capped: users.length === EXPORT_CAP,
      filters: Object.fromEntries(FILTER_KEYS.filter((k) => filters[k] !== undefined).map((k) => [k, filters[k]])),
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pecanrev-users-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write('userNumber,name,email,role,tier,status,registrationMethod,loginMethods,verified,joined,lastActive,projects,institution,country\n');
    for (const u of users) {
      const methods = [u.password != null ? 'email' : null, ...u.authAccounts.map((a) => a.provider)].filter(Boolean).join('+');
      res.write([
        csv(u.userNumber), csv(u.name), csv(u.email), csv(u.role), csv(u.tierId || 'default'),
        csv(deriveStatus(u)), csv(u.registrationMethod || ''), csv(methods || 'none'),
        csv(u.emailVerifiedAt ? 'yes' : 'no'), csv(u.createdAt?.toISOString?.() || u.createdAt),
        csv(u.lastActive?.toISOString?.() || ''), csv(u._count.projects),
        csv(u.institutionOriginal || ''), csv(u.country || ''),
      ].join(',') + '\n');
    }
    return res.end();
  } catch (err) {
    console.error('[admin] export users error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
