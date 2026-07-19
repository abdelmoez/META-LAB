import { prisma } from '../db/client.js';
// 93.md — provider-aware search: SQLite LIKE is case-insensitive, Postgres LIKE
// is not. insensitiveContains() adds mode:'insensitive' only on Postgres so
// admin search boxes behave identically on both providers.
import { insensitiveContains } from '../db/searchMode.js';
import { logAdminAction } from '../utils/audit.js';
import { validateThemePatch, defaultThemeSettings } from '../utils/themeValidate.js';
import { bustThemeCache } from '../middleware/spaTheme.js';
import { hashPassword } from '../auth/password.js';
import { isEmailConfigured, sendEmail, renderReplyEmail, renderPasswordResetEmail, emailStatus } from '../services/emailService.js';
import { createResetToken } from '../services/passwordResetService.js';
import { getVersion } from '../version.js';
import { bustMaintenanceCache } from '../middleware/maintenance.js';
import { defaultFeatureFlags } from './settingsController.js';
import { USAGE, recordUsage } from '../utils/usage.js';
import { forceCloseStreams } from '../realtime/bus.js';
import { invalidateAuthState } from '../middleware/auth.js';
import { buildUserUpdate } from '../../src/shared/editableUserFields.js';
import {
  AUDIT_ACTIONS, SECURITY_TYPES,
  auditActionWhereForSeverity, securityTypeWhereForSeverity,
} from '../../src/shared/auditFormat.js';
import { buildCountryDistribution } from '../utils/countryStats.js';
import * as Presence from '../realtime/presence.js';
import {
  groupInstitutions,
  institutionSimilarity,
  institutionKey,
  INST_REVIEW_THRESHOLD,
} from '../../src/research-engine/index.js';
import {
  pairId,
  getCanonicalOverrides,
  setCanonicalOverrides,
  getRejectedPairSet,
  getRejectedPairs,
  setRejectedPairs,
} from '../utils/institutionStore.js';
// 95.md — shared user-list query engine + pure derivations (also used by the
// metrics/export endpoints in adminUserMgmtController and by the Ops UI).
import { parseUsersListQuery } from '../schemas/adminUserSchemas.js';
import { buildUsersWhere, buildUsersOrderBy, enrichUsersPage } from '../services/adminUserQuery.js';
import { deriveStatus } from '../../src/shared/adminUsers.js';
import {
  WINDOW_UNITS,
  startOfWindow,
  filterInRange,
  windowSummary,
  groupByYear,
  groupByMonth,
  groupByQuarter,
  groupByDay,
  groupByTrailingMonths,
  tally,
  topOf,
} from '../utils/userGrowth.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Safe, single source of the columns the Ops console may READ for a user. It
// deliberately EXCLUDES every secret (password hash, registrationIpHash, reset/
// invite/session tokens) — those are never selected and so can never leak.
const USER_DETAIL_SELECT = {
  id: true, email: true, name: true, role: true, suspended: true,
  createdAt: true, updatedAt: true, lastActive: true, themePreference: true,
  registrationCountryCode: true, registrationCountryName: true,
  registrationIpCountrySource: true,
  // prompt26 — verification + onboarding profile (NONE are sensitive; the token
  // hash/expiry are deliberately NOT selected so no secret reaches the client).
  emailVerifiedAt: true, onboardingCompletedAt: true,
  primaryRole: true, researchField: true, mainUseCase: true,
  institutionOriginal: true, institutionNormalized: true, country: true,
  // prompt35 — canonical institution linkage (display-only in Ops; never secret).
  institutionCanonicalName: true, institutionRorId: true, institutionCountryName: true,
  institutionSource: true, institutionNeedsReview: true,
  // 67.md — product tier (display + filter in the users table; null → site default).
  tierId: true, tierAssignedAt: true,
  _count: { select: { projects: true } },
};
function formatUserDetail(u) {
  if (!u) return u;
  const { _count, ...rest } = u;
  return { ...rest, projectCount: _count ? _count.projects : (u.projectCount ?? 0) };
}

// prompt49 — the plaintext temporary-password generator was REMOVED. Admin password
// resets now issue a secure, single-use, hashed-at-rest reset token + email link
// (see resetUserPassword / sendPasswordReset). No plaintext password is ever
// generated, returned, or emailed.

function startOf(unit) {
  const now = new Date();
  if (unit === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay()); // Sunday
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (unit === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return now;
}

function parsePage(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function safeParseData(dataStr) {
  try {
    return JSON.parse(dataStr || '{}');
  } catch {
    return {};
  }
}

// 86.md P2.56 — cache the (expensive) all-project blob scan that totals studies +
// records for the Ops Overview. A full-table fetch + JSON.parse of every blob on
// every poll is a scale hotspot; a 60s TTL keeps the Overview live enough while
// bounding the cost. Invalidated implicitly by TTL (these totals move slowly).
let _blobAggCache = null; // { at:number, studies:number, records:number }
const BLOB_AGG_TTL_MS = 60_000;
async function getProjectBlobAggregate(now = Date.now()) {
  if (_blobAggCache && (now - _blobAggCache.at) < BLOB_AGG_TTL_MS) {
    return { studies: _blobAggCache.studies, records: _blobAggCache.records };
  }
  const rows = await prisma.project.findMany({ where: { deletedAt: null }, select: { data: true } });
  let studies = 0, records = 0;
  for (const project of rows) {
    const data = safeParseData(project.data);
    studies += Array.isArray(data.studies) ? data.studies.length : 0;
    records += Array.isArray(data.records) ? data.records.length : 0;
  }
  _blobAggCache = { at: now, studies, records };
  return { studies, records };
}

// ── GET /api/admin/metrics ────────────────────────────────────────────────────

export async function getMetrics(req, res) {
  try {
    const now = new Date();
    const todayStart = startOf('day');
    const weekStart = startOf('week');
    const monthStart = startOf('month');
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Unique-login windows (prompt6 Task 9): ROLLING windows (now − 24h/7d/30d/90d/365d)
    // per the brief's "past X" wording — deliberately not calendar startOf() buckets.
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = sevenDaysAgo;
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const quarterAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    // One groupBy per window = one query each returning a row per DISTINCT userId
    // (cheap at this scale; avoids raw-SQL coupling to SQLite date storage).
    const uniqueLogins = since =>
      prisma.loginEvent.groupBy({ by: ['userId'], where: { success: true, createdAt: { gte: since } } });

    const [
      totalUsers, todayUsers, weekUsers, monthUsers, suspendedUsers, adminUsers,
      totalProjects, todayProjects, weekProjects, monthProjects,
      totalMessages, activeMessages, myReadActive,
      failedLogins7d,
      loginsDay, loginsWeek, loginsMonth, loginsQuarter, loginsYear,
      activeUsersDay, activeUsersWeek, activeUsersMonth, activeUsersQuarter, activeUsersYear,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { suspended: true } }),
      prisma.user.count({ where: { role: 'admin' } }),
      prisma.project.count(),
      prisma.project.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.project.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.project.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.contactMessage.count(),
      prisma.contactMessage.count({ where: { archived: false } }),
      // PER-STAFF unread (prompt5 review fix): the Overview metric is now per-caller,
      // so one admin opening a message no longer drops another admin's unread count.
      prisma.contactMessageRead.count({ where: { userId: req.user.id, message: { archived: false } } }),
      prisma.securityEvent.count({ where: { type: 'FAILED_LOGIN', createdAt: { gte: sevenDaysAgo } } }),
      uniqueLogins(dayAgo),
      uniqueLogins(weekAgo),
      uniqueLogins(monthAgo),
      uniqueLogins(quarterAgo),
      uniqueLogins(yearAgo),
      // Unique ACTIVE USERS per rolling window (prompt15 Task 2).
      // Uses User.lastActive — set by requireAuth's throttled touchLastActive() on
      // every authenticated request (opens app, saves, exports, opens project, etc.)
      // AND by login(). No new schema column needed; no new DB spam (5-min throttle).
      // Cheap count() — one per window, much cheaper than loginEvent groupBy.
      prisma.user.count({ where: { lastActive: { gte: dayAgo } } }),
      prisma.user.count({ where: { lastActive: { gte: weekAgo } } }),
      prisma.user.count({ where: { lastActive: { gte: monthAgo } } }),
      prisma.user.count({ where: { lastActive: { gte: quarterAgo } } }),
      prisma.user.count({ where: { lastActive: { gte: yearAgo } } }),
    ]);
    const unreadMessages = Math.max(0, activeMessages - myReadActive);

    // 86.md P2.56 — total studies/records across ALL projects requires parsing every
    // project's JSON blob (there is no SQL count of an array inside a TEXT column).
    // The Overview polls frequently but these totals change slowly, so the scan is
    // cached (60s TTL) — bounding it to at most once/minute regardless of poll rate.
    const { studies, records } = await getProjectBlobAggregate();

    // ── prompt9 ops metrics (additive keys ONLY — never rename) ─────────────
    // invites: pending excludes expired rows; expired = still-pending past the
    // window; accepted = inviteAcceptedAt stamped. notificationsStats from the
    // Notification columns; lifecycle/export/email counters from UsageEvent;
    // linking counts only LIVE rows (deletedAt null). All cheap counts.
    const [
      pendingInvites, acceptedInvites, expiredInvites,
      notifSent, notifClicked, notifDismissed,
      projectsDeleted, siftProjectsDeleted, membersLeft,
      exportGroups, emailsSent, emailsFailed,
      linkedWorkspaces, unlinkedSiftProjects, liveMetaLabProjects, liveLinkRows,
    ] = await Promise.all([
      prisma.screenProjectMember.count({
        where: { status: 'pending', OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gte: now } }] },
      }),
      prisma.screenProjectMember.count({ where: { inviteAcceptedAt: { not: null } } }),
      prisma.screenProjectMember.count({ where: { status: 'pending', inviteExpiresAt: { lt: now } } }),
      prisma.notification.count(),
      prisma.notification.count({ where: { clickedAt: { not: null } } }),
      prisma.notification.count({ where: { dismissedAt: { not: null } } }),
      prisma.project.count({ where: { deletedSource: 'owner' } }),
      prisma.screenProject.count({ where: { deletedSource: 'owner' } }),
      prisma.usageEvent.count({ where: { type: USAGE.MEMBER_LEFT } }),
      prisma.usageEvent.groupBy({ by: ['format'], where: { type: USAGE.EXPORT }, _count: { _all: true } }),
      prisma.usageEvent.count({ where: { type: USAGE.EMAIL_SENT } }),
      prisma.usageEvent.count({ where: { type: USAGE.EMAIL_FAILED } }),
      prisma.screenProject.count({ where: { deletedAt: null, linkedMetaLabProjectId: { not: null } } }),
      prisma.screenProject.count({ where: { deletedAt: null, linkedMetaLabProjectId: null } }),
      prisma.project.count({ where: { deletedAt: null } }),
      prisma.screenProject.findMany({
        where: { deletedAt: null, linkedMetaLabProjectId: { not: null } },
        select: { linkedMetaLabProjectId: true },
        distinct: ['linkedMetaLabProjectId'],
      }),
    ]);

    // prompt14 — richer email metrics for the ops Email System card. Cheap
    // counts + two findFirsts. Invite/contact_reply splits come from the EMAIL_*
    // usage meta.context tag; password-reset has its own typed events;
    // contact-reply draft/sent/failed are authoritative from the ContactReply table.
    const [
      lastSent, lastFailed,
      prSent, prFailed,
      inviteEmailSent, inviteEmailFailed,
      crSent, crDraft, crFailed,
    ] = await Promise.all([
      prisma.usageEvent.findFirst({ where: { type: USAGE.EMAIL_SENT }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.usageEvent.findFirst({ where: { type: USAGE.EMAIL_FAILED }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      prisma.usageEvent.count({ where: { type: USAGE.PASSWORD_RESET_EMAIL_SENT } }),
      prisma.usageEvent.count({ where: { type: USAGE.PASSWORD_RESET_EMAIL_FAILED } }),
      prisma.usageEvent.count({ where: { type: USAGE.EMAIL_SENT, meta: { contains: '"context":"invite"' } } }),
      prisma.usageEvent.count({ where: { type: USAGE.EMAIL_FAILED, meta: { contains: '"context":"invite"' } } }),
      prisma.contactReply.count({ where: { status: 'sent' } }),
      prisma.contactReply.count({ where: { status: 'draft' } }),
      prisma.contactReply.count({ where: { status: 'failed' } }),
    ]);

    const exportsByFormat = {};
    for (const g of exportGroups) {
      const key = g.format || 'unknown';
      exportsByFormat[key] = (exportsByFormat[key] || 0) + (g._count?._all || 0);
    }

    // Live META·LAB projects with no live ScreenProject pointing at them.
    const liveLinkedIds = liveLinkRows.map(r => r.linkedMetaLabProjectId).filter(Boolean);
    const linkedLiveMetaLab = liveLinkedIds.length
      ? await prisma.project.count({ where: { deletedAt: null, id: { in: liveLinkedIds } } })
      : 0;
    const unlinkedMetaLabProjects = Math.max(0, liveMetaLabProjects - linkedLiveMetaLab);

    // Quick DB health check
    let dbStatus = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    // prompt25 Task 1 — ONLINE NOW: distinct users with a live presence heartbeat
    // (within ACTIVE_MS ≈ 75s) across all project rooms. This is the real-time
    // signal; User.lastActive (throttled to 5min) drives the 24h "active" figure.
    const onlineNow = Presence.globalOnlineCount(now.getTime());

    return res.json({
      users: {
        total: totalUsers,
        today: todayUsers,
        thisWeek: weekUsers,
        thisMonth: monthUsers,
        suspended: suspendedUsers,
        admins: adminUsers,
        // prompt25 Task 1 — live online/offline counts for the Ops Overview.
        online: onlineNow,
        offline: Math.max(0, totalUsers - onlineNow),
      },
      projects: {
        total: totalProjects,
        today: todayProjects,
        thisWeek: weekProjects,
        thisMonth: monthProjects,
      },
      studies,
      records,
      contactMessages: { total: totalMessages, unread: unreadMessages },
      securityEvents: { failedLogins7d },
      // Unique successful logins per rolling window (prompt6 Task 9) — each
      // groupBy above returns one row per DISTINCT userId in the window.
      logins: {
        day: loginsDay.length,
        week: loginsWeek.length,
        month: loginsMonth.length,
        quarter: loginsQuarter.length,
        year: loginsYear.length,
      },
      // Unique ACTIVE USERS per rolling window (prompt15 Task 2).
      // Distinct from logins: counts ANY user whose lastActive >= cutoff,
      // including returning users who never logged out (existing session),
      // opened the app, opened/saved a project, ran or exported an analysis,
      // or hit any other authenticated endpoint — not only fresh sign-in events.
      activeUsers: {
        day: activeUsersDay,
        week: activeUsersWeek,
        month: activeUsersMonth,
        quarter: activeUsersQuarter,
        year: activeUsersYear,
      },
      // ── prompt9 additions (additive — frontend reads these exact names) ──
      invites: { pending: pendingInvites, accepted: acceptedInvites, expired: expiredInvites },
      notificationsStats: { sent: notifSent, clicked: notifClicked, dismissed: notifDismissed },
      lifecycle: { projectsDeleted, siftProjectsDeleted, membersLeft },
      exportsByFormat,
      // prompt14 — config snapshot is SECRET-FREE (booleans + provider label only).
      email: emailStatus(),
      emailStats: {
        sent: emailsSent,
        failed: emailsFailed,
        lastSentAt: lastSent?.createdAt || null,
        lastFailedAt: lastFailed?.createdAt || null,
        invites: { sent: inviteEmailSent, failed: inviteEmailFailed },
        passwordResets: { sent: prSent, failed: prFailed },
        contactReplies: { sent: crSent, draft: crDraft, failed: crFailed },
      },
      linking: { linkedWorkspaces, unlinkedSiftProjects, unlinkedMetaLabProjects },
      db: dbStatus,
    });
  } catch (err) {
    console.error('[admin] getMetrics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/metrics/timeseries ────────────────────────────────────────
// Per-day activity buckets for the ops console sparklines (prompt8).
// ?days= optional (default 14, clamped to [7, 90], non-numeric → default).
// Buckets are LOCAL calendar days (server time); the response is ascending,
// zero-filled, exactly N entries, last entry = today. Read-only — no audit log
// write (same policy as GET /metrics).

const TIMESERIES_DEFAULT_DAYS = 14;
const TIMESERIES_MIN_DAYS = 7;
const TIMESERIES_MAX_DAYS = 90;

/** Local-time YYYY-MM-DD key (NOT toISOString — that would bucket by UTC). */
function localDayKey(value) {
  const d = new Date(value);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export async function getMetricsTimeseries(req, res) {
  try {
    const raw = parseInt(req.query.days, 10);
    const days = Number.isFinite(raw)
      ? Math.min(TIMESERIES_MAX_DAYS, Math.max(TIMESERIES_MIN_DAYS, raw))
      : TIMESERIES_DEFAULT_DAYS;

    // Window starts at local midnight (days - 1) days ago so the LAST bucket
    // is today. Date(y, m, d - n) rolls over month/year boundaries correctly.
    const todayStart = startOf('day');
    const windowStart = new Date(
      todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() - (days - 1),
    );

    // Pre-build zero-filled ascending buckets so empty days still appear.
    const order = [];
    const buckets = new Map();
    for (let i = 0; i < days; i++) {
      const key = localDayKey(new Date(
        windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + i,
      ));
      order.push(key);
      buckets.set(key, {
        date: key,
        logins: 0,
        uniqueLogins: 0,
        activeUsers: 0,
        newUsers: 0,
        newProjects: 0,
        screeningDecisions: 0,
        doneTransitions: 0,
        contactMessages: 0,
        failedLogins: 0,
      });
    }

    // Fetch only createdAt (+userId for logins) within the window and bucket
    // in JS — volumes are small (SQLite dev scale) and this avoids raw-SQL
    // coupling to SQLite date storage (same rationale as getMetrics).
    const inWindow = { createdAt: { gte: windowStart } };
    const [
      loginRows, userRows, projectRows, decisionRows, doneRows, messageRows, failedRows, activeRows,
    ] = await Promise.all([
      prisma.loginEvent.findMany({ where: { success: true, ...inWindow }, select: { createdAt: true, userId: true } }),
      prisma.user.findMany({ where: inWindow, select: { createdAt: true } }),
      prisma.project.findMany({ where: inWindow, select: { createdAt: true } }),
      prisma.screenDecision.findMany({ where: inWindow, select: { createdAt: true } }),
      prisma.screenProjectStatusEvent.findMany({ where: { status: 'done', ...inWindow }, select: { createdAt: true } }),
      prisma.contactMessage.findMany({ where: inWindow, select: { createdAt: true } }),
      prisma.securityEvent.findMany({ where: { type: 'FAILED_LOGIN', ...inWindow }, select: { createdAt: true } }),
      // prompt15 follow-up — APP_ACTIVE usage events for the per-day active-user series.
      prisma.usageEvent.findMany({ where: { type: USAGE.APP_ACTIVE, ...inWindow }, select: { createdAt: true, userId: true } }),
    ]);

    const bump = (rows, field) => {
      for (const row of rows) {
        const bucket = buckets.get(localDayKey(row.createdAt));
        if (bucket) bucket[field] += 1; // rows later than "now" can't exist; guard is for safety
      }
    };
    bump(userRows, 'newUsers');
    bump(projectRows, 'newProjects');
    bump(decisionRows, 'screeningDecisions');
    bump(doneRows, 'doneTransitions');
    bump(messageRows, 'contactMessages');
    bump(failedRows, 'failedLogins');

    // logins = total successful logins per day; uniqueLogins = distinct userIds per day.
    const uniquePerDay = new Map();
    for (const row of loginRows) {
      const key = localDayKey(row.createdAt);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      bucket.logins += 1;
      let set = uniquePerDay.get(key);
      if (!set) { set = new Set(); uniquePerDay.set(key, set); }
      set.add(row.userId);
    }
    for (const [key, set] of uniquePerDay) buckets.get(key).uniqueLogins = set.size;

    // activeUsers = distinct userIds with an APP_ACTIVE event per day (any authenticated
    // action, not only logins). Same distinct-per-day shape as uniqueLogins.
    const activePerDay = new Map();
    for (const row of activeRows) {
      const key = localDayKey(row.createdAt);
      if (!buckets.has(key)) continue;
      let set = activePerDay.get(key);
      if (!set) { set = new Set(); activePerDay.set(key, set); }
      set.add(row.userId);
    }
    for (const [key, set] of activePerDay) buckets.get(key).activeUsers = set.size;

    return res.json({ days: order.map(key => buckets.get(key)) });
  } catch (err) {
    console.error('[admin] getMetricsTimeseries error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users ──────────────────────────────────────────────────────

export async function getUsers(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    // 95.md Phase 3/9 — zod-validated filter object + the ONE shared
    // where/orderBy builder (also used by metrics + CSV export, so a filter can
    // never mean different things on different endpoints). All legacy params
    // (suspended/verified/onboarded/noInstitution/createdWithin/newest/oldest)
    // still work — the schema carries them.
    const filters = parseUsersListQuery(req.query);
    const where = await buildUsersWhere(filters);
    const orderBy = buildUsersOrderBy(filters.sort, filters.order);

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          suspended: true,
          suspendedAt: true,
          createdAt: true,
          lastActive: true,
          emailVerifiedAt: true,
          onboardingCompletedAt: true,
          institutionOriginal: true,
          researchField: true,
          country: true,
          registrationCountryName: true,
          userNumber: true,
          tierId: true,
          registrationMethod: true,
          // password is selected ONLY to derive the hasPassword boolean below —
          // the hash itself never leaves this handler (95.md Phase 9 discipline).
          password: true,
          _count: { select: { projects: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    // 95.md Phase 2/10 — page-batched enrichment (ONE query per relation for
    // the whole page, replacing the old client-side per-row N+1): Sign-in
    // badges from AuthAccount + invitation-source linkage.
    const { providersByUser, invitedSet } = await enrichUsersPage(users);

    // prompt25 Task 1 — live online flag from the global presence snapshot.
    const online = Presence.globalOnlineSnapshot();
    // Review fix (95 r2) — the detail route target-gates mods away from
    // admin/mod accounts (requireTargetEditable); the LIST must not hand a mod
    // the same auth-posture intelligence (SSO-only? last login?) for staff rows.
    // Staff rows stay listed (support triage needs them) but their auth axes are
    // withheld from moderators.
    const viewerIsMod = req.user.role === 'mod';
    const formatted = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      suspended: u.suspended,
      suspendedAt: u.suspendedAt,
      createdAt: u.createdAt,
      lastActive: u.lastActive,
      projectCount: u._count.projects,
      isOnline: online.has(u.id),
      // prompt27 — non-secret profile columns for the directory table (verified
      // badge, institution, research field, country) without a per-row fetch.
      emailVerified: !!u.emailVerifiedAt,
      emailVerifiedAt: u.emailVerifiedAt,
      onboardingCompleted: !!u.onboardingCompletedAt,
      institution: u.institutionOriginal || null,
      researchField: u.researchField || null,
      country: u.country || u.registrationCountryName || null,
      // 95.md Phase 2/10 — auth-method + status axes for the redesigned table.
      userNumber: u.userNumber,
      tierId: u.tierId,
      status: deriveStatus(u),
      neverLoggedIn: u.lastActive == null,
      ...(viewerIsMod && u.role !== 'user'
        ? { registrationMethod: null, hasPassword: null, authProviders: [], invitedViaInvitation: false }
        : {
            registrationMethod: u.registrationMethod,
            hasPassword: u.password != null,
            authProviders: providersByUser.get(u.id) || [],
            invitedViaInvitation: invitedSet.has(u.id),
          }),
    }));

    return res.json({ users: formatted, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[admin] getUsers error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/countries ──────────────────────────────────────────────
// Aggregate, COUNTRY-LEVEL-ONLY distribution of live users for the Ops Users map
// (prompt19 Task 12). Groups every user by registrationCountryCode; null/''/junk
// codes collapse into a single "Unknown" bucket. The displayed country NAME is
// DERIVED FROM THE ISO CODE (prompt22 Task 1) so the map tooltip can never
// disagree with the geometry it colours. No raw IPs, no city/coords are ever read
// or returned. Sorted by userCount desc. (admin only)

export async function getUserCountries(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        registrationCountryCode: true,
        registrationCountryName: true,
        createdAt: true,
      },
    });

    // Pure, unit-tested aggregation (server/utils/countryStats.js).
    const dist = buildCountryDistribution(users);

    // prompt25 Task 2 — overlay live ONLINE counts per country. Compute the
    // online distribution over ONLY the currently-online users, then merge its
    // per-code userCount onto the full distribution as onlineCount (offline =
    // total − online). Country mapping is unchanged (still ISO-derived → no
    // UAE/Ukraine regression).
    const onlineIds = Presence.globalOnlineSnapshot();
    const onlineUsers = users.filter(u => onlineIds.has(u.id));
    const onlineByCode = {};
    for (const c of buildCountryDistribution(onlineUsers).countries) onlineByCode[c.countryCode] = c.userCount;
    let onlineTotal = 0;
    dist.countries = dist.countries.map(c => {
      const onlineCount = onlineByCode[c.countryCode] || 0;
      onlineTotal += onlineCount;
      return { ...c, onlineCount, offlineCount: Math.max(0, c.userCount - onlineCount) };
    });
    dist.summary = { ...dist.summary, online: onlineTotal, offline: Math.max(0, dist.summary.totalUsers - onlineTotal) };

    return res.json(dist);
  } catch (err) {
    console.error('[admin] getUserCountries error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/activity-summary (prompt25 Task 1) ──────────────────
// Live online/offline counts for the Ops Users tab header. "Online" = a distinct
// user with a presence heartbeat within ~75s across any project room. Admin only.
export async function getUserActivitySummary(req, res) {
  try {
    const totalUsers = await prisma.user.count();
    const online = Presence.globalOnlineCount();
    const offline = Math.max(0, totalUsers - online);
    return res.json({
      totalUsers,
      online,
      offline,
      percentOnline: totalUsers ? Math.round((online / totalUsers) * 1000) / 10 : 0,
    });
  } catch (err) {
    console.error('[admin] getUserActivitySummary error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/:id/activity (prompt25 Task 1) ──────────────────────
// Per-user live activity for the clicked-user detail: online flag, current
// project + section (from presence), and last-active. No raw IP. Admin or mod
// (mod cannot target admin/mod users — enforced by requireTargetEditable).
export async function getUserActivity(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, lastActive: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const snap = Presence.globalOnlineSnapshot().get(user.id) || null;
    let currentProjectId = null, currentProjectTitle = null, currentLocation = null;
    if (snap) {
      currentLocation = snap.location || null;   // e.g. "Screening > Title & Abstract"
      currentProjectId = snap.projectId || null; // ScreenProject id (presence room key)
      if (currentProjectId) {
        const sp = await prisma.screenProject
          .findUnique({ where: { id: currentProjectId }, select: { title: true } })
          .catch(() => null);
        currentProjectTitle = sp?.title || null;
      }
    }
    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      lastActive: user.lastActive,
      onlineNow: !!snap,
      currentProjectId,
      currentProjectTitle,
      currentLocation,
    });
  } catch (err) {
    console.error('[admin] getUserActivity error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────

export async function getUserById(req, res) {
  try {
    // 95.md Phase 5 — the detail select adds password ONLY to derive the
    // hasPassword boolean; the hash is stripped before the response is built
    // (USER_DETAIL_SELECT itself stays secret-free by construction).
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { ...USER_DETAIL_SELECT, password: true, passwordChangedAt: true, registrationMethod: true, userNumber: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });
    const hasPassword = user.password != null;
    delete user.password;

    // 94.md §2.9 — admins can SEE that an external provider is connected, but
    // never provider tokens, subject ids, or other sensitive provider metadata.
    // 95.md Phase 5 additions (each best-effort): invitation-source linkage +
    // failed-login count (last 30 days, from the userId-indexed LoginEvent).
    const [authProviders, invitation, failedLogins30d] = await Promise.all([
      prisma.authAccount.findMany({
        where: { userId: user.id },
        select: { provider: true, lastLoginAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }).catch(() => []),
      prisma.waitlistInvitation.findFirst({
        where: { acceptedUserId: user.id },
        select: { id: true },
      }).catch(() => null),
      prisma.loginEvent.count({
        where: { userId: user.id, success: false, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600e3) } },
      }).catch(() => 0),
    ]);

    // Top-level shape (the PATCH handlers use a { user } envelope) — includes the
    // admin-editable profile fields (theme, registration country) so the Ops
    // edit form can populate them. Secrets are never in USER_DETAIL_SELECT.
    return res.json({
      ...formatUserDetail(user),
      authProviders,
      hasPassword,
      invitedViaInvitation: !!invitation,
      failedLogins30d,
      status: deriveStatus(user),
    });
  } catch (err) {
    console.error('[admin] getUserById error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────
// Edit a user's admin-safe profile fields (name, email, theme, registration
// country). The exact set + validation lives in the shared editableUserFields
// schema — add a safe field there and it becomes editable here automatically.
// Role and account status keep their dedicated, confirmation-gated endpoints
// (/role, /status) with their own protections, so they are NOT handled here.
// Password is NEVER editable; the reset-email flow is unchanged. (admin + mod —
// mods get the editableByMod subset; requireTargetEditable already blocks mods
// from touching admin/mod targets.)

export async function updateUser(req, res) {
  try {
    // Schema-driven, allowlist-only patch. Unknown / sensitive / dedicated keys
    // (password, tokens, role, suspended, …) are silently ignored — they can
    // never reach `data`. Mods only get the fields flagged editableByMod.
    const { data, changed, error } = buildUserUpdate(req.body || {}, req.user.role);
    if (error) return res.status(400).json({ error });
    if (!changed.length) {
      return res.status(400).json({ error: 'Provide at least one editable field to update' });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Defense-in-depth (route also mounts requireTargetEditable): mods may only
    // mutate ordinary users — never admin/mod accounts.
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    // Enforce unique email (case-insensitive via the lowercased value from the schema).
    const emailChanged = !!(data.email && data.email !== target.email);
    if (emailChanged) {
      const clash = await prisma.user.findUnique({ where: { email: data.email } });
      if (clash && clash.id !== target.id) {
        return res.status(409).json({ error: 'That email is already in use' });
      }
      // 95.md Phase 10 (data accuracy) — an admin-entered address was never
      // proven: the verified flag must not survive the change, or the Ops
      // console (and the login verification gate) would show a verified state
      // nobody ever established for the NEW mailbox. Review fix (95 r2): any
      // OUTSTANDING verification token must die with it — a link emailed to the
      // OLD mailbox would otherwise verify the NEW address.
      data.emailVerifiedAt = null;
      data.emailVerificationTokenHash = null;
      data.emailVerificationExpiresAt = null;
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { id: req.params.id },
        data,
        select: USER_DETAIL_SELECT,
      });
    } catch (e) {
      // TOCTOU on the email-uniqueness pre-check: a concurrent claim between the
      // check and the update surfaces as P2002 — a 409, never a 500.
      if (emailChanged && e?.code === 'P2002') {
        return res.status(409).json({ error: 'That email is already in use' });
      }
      throw e;
    }

    // Audit the change by field KEY + before/after. Every editable field is
    // non-sensitive by construction (the schema never lists secrets), so the
    // values are safe to record for an admin trail.
    const before = {}, after = {};
    for (const k of changed) { before[k] = target[k] ?? null; after[k] = updated[k] ?? null; }
    await logAdminAction(req, 'USER_UPDATED_BY_ADMIN', 'User', target.id, {
      changed, before, after,
      ...(emailChanged ? { emailVerificationReset: true } : {}),
    });

    return res.json({ user: formatUserDetail(updated) });
  } catch (err) {
    console.error('[admin] updateUser error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/users/:id/status ────────────────────────────────────────
// Body accepts { suspended: boolean } OR { status: 'active'|'suspended'|'disabled' }.
// 'disabled' maps to suspended=true. Cannot suspend an admin. (admin + mod)

export async function updateUserStatus(req, res) {
  try {
    const body = req.body || {};
    let suspended;

    if (typeof body.suspended === 'boolean') {
      suspended = body.suspended;
    } else if (typeof body.status === 'string') {
      const s = body.status.trim().toLowerCase();
      if (s === 'active') suspended = false;
      else if (s === 'suspended' || s === 'disabled') suspended = true;
      else return res.status(400).json({ error: "`status` must be 'active', 'suspended', or 'disabled'" });
    } else {
      return res.status(400).json({ error: 'Provide `suspended` (boolean) or `status` (string)' });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Defense-in-depth (route also mounts requireTargetEditable): mods may
    // only mutate ordinary users — never admin/mod accounts.
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    // Cannot suspend admins (actor-agnostic — applies to admins too)
    if (target.role === 'admin' && suspended) {
      return res.status(400).json({ error: 'Cannot suspend admin users' });
    }

    // prompt49 — session revocation. Suspending BUMPS sessionEpoch so every
    // already-issued token across all devices is invalidated on its next request
    // (requireAuth compares the token's epoch to the DB). Unsuspending does NOT
    // restore old sessions: the epoch stays bumped, so a suspended-then-restored
    // user must sign in again. We also force-close their open SSE streams and drop
    // the cached auth state so revocation is effectively immediate.
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: suspended
        ? { suspended: true, suspendedAt: new Date(), sessionEpoch: { increment: 1 } }
        : { suspended: false },
      select: { id: true, email: true, name: true, role: true, suspended: true, createdAt: true, lastActive: true },
    });

    invalidateAuthState(target.id);
    if (suspended) {
      try { forceCloseStreams(target.id); } catch { /* best-effort */ }
    }

    await logAdminAction(req, suspended ? 'SUSPEND_USER' : 'UNSUSPEND_USER', 'User', target.id, {
      email: target.email,
      suspended,
    });

    return res.json({ user: updated });
  } catch (err) {
    console.error('[admin] updateUserStatus error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/users/:id/role ───────────────────────────────────────────
// ADMIN ONLY. Body { role: 'user'|'mod'|'admin' }. Cannot demote the last admin.

const VALID_ROLES = ['user', 'mod', 'admin'];

export async function updateUserRole(req, res) {
  try {
    const { role } = req.body || {};
    if (typeof role !== 'string' || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: "`role` must be one of 'user', 'mod', 'admin'" });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Last-admin protection: block demoting the only remaining admin.
    if (target.role === 'admin' && role !== 'admin') {
      const adminCount = await prisma.user.count({ where: { role: 'admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }

    if (target.role === role) {
      return res.json({
        user: {
          id: target.id, email: target.email, name: target.name,
          role: target.role, suspended: target.suspended,
          createdAt: target.createdAt, lastActive: target.lastActive,
        },
      });
    }

    // 86.md P2.2/P2.34 — a role change must REVOKE the target's existing sessions.
    // req.user.role is the JWT claim, and three bypasses trust it (featureAccess
    // isFlagAdmin, entitlementService isSystemBypassUser, the maintenance staff
    // bypass), so without this a demoted admin/mod kept those privileges for up to
    // the 7-day token lifetime. Bumping sessionEpoch invalidates the old token's
    // `se` claim; invalidateAuthState clears the 15s in-memory auth cache instantly.
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role, sessionEpoch: { increment: 1 } },
      select: { id: true, email: true, name: true, role: true, suspended: true, createdAt: true, lastActive: true },
    });
    invalidateAuthState(target.id);

    await logAdminAction(req, 'ASSIGN_ROLE', 'User', target.id, {
      email: target.email,
      before: target.role,
      after: role,
    });

    return res.json({ user: updated });
  } catch (err) {
    console.error('[admin] updateUserRole error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/users/:id/reset-password ──────────────────────────────────
// prompt49 — SECURE token-based reset (admin + mod). Previously this generated a
// plaintext temporary password and returned it in the response body (visible in
// logs/network/history). That plaintext path is REMOVED: this now issues a single-
// use, hashed-at-rest, expiring reset TOKEN and emails the user a reset link
// (identical ceremony to /send-password-reset). No password is set here and no
// secret is ever returned — the user chooses their own password, which then bumps
// their sessionEpoch (revoking other sessions) when they complete the reset.

export async function resetUserPassword(req, res) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Defense-in-depth (route also mounts requireTargetEditable): mods may
    // only mutate ordinary users — never admin/mod accounts.
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    const { token, expiresAt } = await createResetToken(target.id, {
      requestedByUserId: req.user.id,
      ip: req.ip || '',
    });
    const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset?token=${token}`;

    const emailConfigured = isEmailConfigured();
    let sent = false;
    if (emailConfigured) {
      const { html, text } = renderPasswordResetEmail({
        toName: target.name || '',
        link,
        expiresAt,
        initiatedByOperator: true,
      });
      const result = await sendEmail({ to: target.email, subject: 'Reset your PecanRev password', html, text, context: 'password_reset' });
      sent = result.sent === true;
      recordUsage({ type: sent ? USAGE.PASSWORD_RESET_EMAIL_SENT : USAGE.PASSWORD_RESET_EMAIL_FAILED, userId: target.id, meta: { byOperator: req.user.id } });
    }

    await logAdminAction(req, 'RESET_PASSWORD', 'User', target.id, { email: target.email, method: 'token_link', sent, emailConfigured });

    // The raw token/link is returned to the authorized operator ONLY when the
    // email could not be sent (so they can deliver it) — never the password,
    // never a token alongside a successful send, never in logs.
    return res.json({ sent, emailConfigured, expiresAt, ...(sent ? {} : { link }) });
  } catch (err) {
    console.error('[admin] resetUserPassword error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/users/:id/send-password-reset ──────────────────────────────
// Production-preferred reset (prompt14 Task 4): mints a single-use, time-limited
// token (hash-only at rest) and emails the user a self-service reset link — the
// operator never handles a plaintext credential. (admin + mod)
// requireTargetEditable already 403s a mod acting on an admin/mod target; the
// in-handler check is defense-in-depth. When email is unconfigured (or the send
// fails) the authorized operator gets a copyable link in the response instead —
// mirroring the invite-link fallback. The raw token is NEVER logged.
export async function sendPasswordReset(req, res) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    const { token, expiresAt } = await createResetToken(target.id, {
      requestedByUserId: req.user.id,
      ip: req.ip || '',
    });
    const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset?token=${token}`;

    const emailConfigured = isEmailConfigured();
    let sent = false;
    if (emailConfigured) {
      const { html, text } = renderPasswordResetEmail({
        toName: target.name || '',
        link,
        expiresAt,
        initiatedByOperator: true,
      });
      const result = await sendEmail({
        to: target.email,
        subject: 'Reset your PecanRev password',
        html,
        text,
        context: 'password_reset',
      });
      sent = result.sent === true;
      // Record only real outcomes: SENT on success, FAILED only on an actual
      // send error (not the not-configured fallback, which is expected, not a fault).
      if (sent) recordUsage({ type: USAGE.PASSWORD_RESET_EMAIL_SENT, userId: target.id, meta: { byOperator: req.user.id } });
      else recordUsage({ type: USAGE.PASSWORD_RESET_EMAIL_FAILED, userId: target.id, meta: { byOperator: req.user.id, reason: result.reason || null } });
    }

    await logAdminAction(req, 'SEND_PASSWORD_RESET', 'User', target.id, { email: target.email, sent, emailConfigured });

    // Copyable link is returned ONLY to the authorized operator when the email
    // didn't actually go out (unconfigured / send failure) — never alongside a
    // successful send, and never the raw token in logs.
    return res.json({
      sent,
      emailConfigured,
      expiresAt,
      ...(sent ? {} : { link }),
    });
  } catch (err) {
    console.error('[admin] sendPasswordReset error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/:id/projects ────────────────────────────────────────

export async function getUserProjects(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, name: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [total, projects] = await Promise.all([
      prisma.project.count({ where: { userId: req.params.id } }),
      prisma.project.findMany({
        where: { userId: req.params.id },
        select: {
          id: true,
          name: true,
          data: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          lastSavedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formatted = projects.map(p => {
      const data = safeParseData(p.data);
      return {
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
        lastSavedAt: p.lastSavedAt,
        studyCount: Array.isArray(data.studies) ? data.studies.length : 0,
        recordCount: Array.isArray(data.records) ? data.records.length : 0,
        metaRuns: Array.isArray(data.metaResults) ? data.metaResults.length : 0,
        status: p.deletedAt ? 'archived' : 'active',
      };
    });

    return res.json({ projects: formatted, total, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[admin] getUserProjects error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/projects ───────────────────────────────────────────────────

// prompt50 WS1 — server-side sortable columns. ONLY authoritative DB columns are
// sortable so the order is correct ACROSS pages (blob-derived counts like
// studies/members live in JSON/related tables and cannot be DB-sorted without
// denormalised counters — those remain client-side within the current page).
const PROJECT_SORT_COLUMNS = { lastActivity: 'lastActivityAt', created: 'createdAt', updated: 'updatedAt', name: 'name' };

export async function getProjects(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { userId, search, status, linked } = req.query;

    const where = {};
    if (userId) where.userId = userId;
    if (search) where.name = insensitiveContains(search);
    if (status === 'active') where.deletedAt = null;
    else if (status === 'archived') where.deletedAt = { not: null };

    // Linked-screening filter (prompt50 WS1). Resolve the set of META·LAB project
    // ids that have a live linked ScreenProject, then constrain by it.
    if (linked === 'yes' || linked === 'no') {
      const linkedRows = await prisma.screenProject.findMany({
        where: { linkedMetaLabProjectId: { not: null }, deletedAt: null },
        select: { linkedMetaLabProjectId: true },
      });
      const ids = [...new Set(linkedRows.map(r => r.linkedMetaLabProjectId))];
      where.id = linked === 'yes' ? { in: ids } : { notIn: ids };
    }

    // prompt50 WS1 — server-side sort BEFORE pagination, with a deterministic
    // tiebreak so the order is stable across refreshes and pages.
    const sortKey = PROJECT_SORT_COLUMNS[req.query.sort] || 'lastActivityAt';
    const dir = req.query.dir === 'asc' ? 'asc' : (req.query.dir === 'desc' ? 'desc' : (sortKey === 'name' ? 'asc' : 'desc'));
    // Deterministic tiebreak in the SAME direction as the primary key, so the
    // order is fully reproducible and dir simply reverses it.
    const orderBy = sortKey === 'createdAt'
      ? [{ createdAt: dir }, { id: dir }]
      : [{ [sortKey]: dir }, { createdAt: dir }, { id: dir }];

    const [total, projects] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        select: {
          id: true, userId: true, name: true, data: true,
          createdAt: true, updatedAt: true, lastActivityAt: true,
          deletedAt: true, deletedSource: true,
          user: { select: { name: true, email: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
    ]);

    // Linked META·SIFT reverse lookup (prompt6 Task 11). The Review Workspace
    // IS the ScreenProject row, so workspaceId aliases the ScreenProject id.
    const projectIds = projects.map(p => p.id);
    const linkedSifts = projectIds.length
      ? await prisma.screenProject.findMany({
          where: { linkedMetaLabProjectId: { in: projectIds } },
          select: { id: true, title: true, linkedMetaLabProjectId: true, progressStatus: true, stage: true },
        })
      : [];
    const siftByMetaLabId = {};
    for (const sp of linkedSifts) {
      if (!siftByMetaLabId[sp.linkedMetaLabProjectId]) siftByMetaLabId[sp.linkedMetaLabProjectId] = sp;
    }

    // prompt50 WS1 — batched member + open-conflict counts for THIS page's linked
    // screening projects (no N+1; one groupBy each, scoped to the page).
    const siftIds = linkedSifts.map(s => s.id);
    const [memberGroups, conflictGroups] = siftIds.length
      ? await Promise.all([
          prisma.screenProjectMember.groupBy({ by: ['projectId'], where: { projectId: { in: siftIds }, status: 'active' }, _count: { _all: true } }),
          prisma.screenConflict.groupBy({ by: ['projectId'], where: { projectId: { in: siftIds }, resolvedAt: null }, _count: { _all: true } }),
        ])
      : [[], []];
    const membersBySift = Object.fromEntries(memberGroups.map(g => [g.projectId, g._count._all]));
    const conflictsBySift = Object.fromEntries(conflictGroups.map(g => [g.projectId, g._count._all]));

    const formatted = projects.map(p => {
      const data = safeParseData(p.data);
      const sift = siftByMetaLabId[p.id] || null;
      return {
        id: p.id,
        userId: p.userId,
        userEmail: p.user?.email || null,
        owner: { id: p.userId, name: p.user?.name || null, email: p.user?.email || null },
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        // prompt50 WS5 — authoritative "Last Modified" timestamp (meaningful activity).
        lastActivityAt: p.lastActivityAt || p.updatedAt || p.createdAt,
        deletedAt: p.deletedAt,
        deletedSource: p.deletedSource || null,
        deleted: p.deletedSource === 'owner',
        status: p.deletedAt ? 'archived' : 'active',
        linkedMetaSift: sift ? { id: sift.id, title: sift.title, progressStatus: sift.progressStatus ?? null, stage: sift.stage ?? null } : null,
        workspaceId: sift ? sift.id : null,
        studyCount: Array.isArray(data.studies) ? data.studies.length : 0,
        recordCount: Array.isArray(data.records) ? data.records.length : 0,
        // prompt50 WS1 — additive ops fields for the richer directory.
        memberCount: sift ? (membersBySift[sift.id] || 0) : 0,
        conflictsOpen: sift ? (conflictsBySift[sift.id] || 0) : 0,
      };
    });

    return res.json({ projects: formatted, total, sort: req.query.sort || 'lastActivity', dir });
  } catch (err) {
    console.error('[admin] getProjects error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/projects/:id/detail ────────────────────────────────────────
// Rich, REAL project analytics for the Ops Projects detail drawer (prompt49 item
// 9). Computed with bounded count/groupBy/aggregate queries (no N+1, no loading
// every record) so it scales. No fabricated data — every number is a live count.
// Admin only.
export async function getProjectDetail(req, res) {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true, userId: true, name: true, data: true, createdAt: true, updatedAt: true,
        deletedAt: true, deletedSource: true, archived: true, lastSavedAt: true,
        user: { select: { name: true, email: true } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const data = safeParseData(project.data);
    const studyCount = Array.isArray(data.studies) ? data.studies.length : 0;
    const recordCount = Array.isArray(data.records) ? data.records.length : 0;
    const pico = (data.pico && typeof data.pico === 'object') ? data.pico : (data.protocol?.pico || null);
    const hasPico = !!(pico && typeof pico === 'object' && Object.values(pico).some((v) => v && String(v).trim()));
    const hasSearch = !!(data.search && typeof data.search === 'object' && Object.keys(data.search).length > 0);

    const [robCount, sift] = await Promise.all([
      prisma.robAssessment.count({ where: { projectId: id, deletedAt: null } }),
      prisma.screenProject.findFirst({
        where: { linkedMetaLabProjectId: id },
        select: { id: true, title: true, stage: true, progressStatus: true, blindMode: true, requiredScreeningReviewers: true, createdAt: true, updatedAt: true },
      }),
    ]);

    let screening = null;
    if (sift) {
      const [recTotal, byStage, byDecision, byFinal, conflictsOpen, conflictsTotal, dupGroups, members, pdfAgg, aiRun] = await Promise.all([
        prisma.screenRecord.count({ where: { projectId: sift.id } }),
        prisma.screenRecord.groupBy({ by: ['currentStage'], where: { projectId: sift.id }, _count: { _all: true } }),
        prisma.screenDecision.groupBy({ by: ['decision'], where: { projectId: sift.id }, _count: { _all: true } }),
        prisma.screenRecord.groupBy({ by: ['finalStatus'], where: { projectId: sift.id }, _count: { _all: true } }),
        prisma.screenConflict.count({ where: { projectId: sift.id, resolvedAt: null } }),
        prisma.screenConflict.count({ where: { projectId: sift.id } }),
        prisma.screenDuplicateGroup.count({ where: { projectId: sift.id } }),
        prisma.screenProjectMember.count({ where: { projectId: sift.id, status: 'active' } }),
        prisma.screenPdfAttachment.aggregate({ where: { projectId: sift.id }, _count: { _all: true }, _sum: { fileSize: true } }),
        prisma.screenAiRun.findFirst({ where: { projectId: sift.id }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, stage: true, status: true, nScored: true, engineVersion: true, isActive: true } }),
      ]);
      const tally = (rows, key) => Object.fromEntries(rows.map((r) => [r[key] || '(none)', r._count._all]));
      screening = {
        id: sift.id, title: sift.title, stage: sift.stage, progressStatus: sift.progressStatus,
        blindMode: sift.blindMode, requiredReviewers: sift.requiredScreeningReviewers,
        records: recTotal,
        byStage: tally(byStage, 'currentStage'),
        byDecision: tally(byDecision, 'decision'),
        byFinal: tally(byFinal, 'finalStatus'),
        conflictsOpen, conflictsTotal, duplicateGroups: dupGroups, members,
        pdfCount: pdfAgg._count._all || 0, pdfBytes: pdfAgg._sum.fileSize || 0,
        ai: aiRun || null,
      };
    }

    return res.json({
      project: {
        id: project.id, name: project.name,
        owner: { id: project.userId, name: project.user?.name || null, email: project.user?.email || null },
        createdAt: project.createdAt, updatedAt: project.updatedAt, lastSavedAt: project.lastSavedAt,
        status: project.deletedAt ? 'archived' : 'active', deletedSource: project.deletedSource || null,
      },
      workflow: { studyCount, recordCount, hasPico, hasSearch, robAssessments: robCount },
      screening,
    });
  } catch (err) {
    console.error('[admin] getProjectDetail error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/projects/overview ─────────────────────────────────────────
// prompt50 WS1 — platform-wide PROJECT summary metrics for the Ops Projects
// Overview (the cards above the directory). Every number is a live, authoritative
// count/aggregate; nothing is fabricated. Built from cheap count/groupBy queries
// + ONE small-column findMany (id/createdAt/lastActivityAt/deletedAt — NEVER the
// data blob) so it scales with project volume. Admin only.
export async function getProjectsOverview(req, res) {
  try {
    const now = new Date();
    // Small-column read (no blobs) → windows + activity/stall metrics.
    const projects = await prisma.project.findMany({
      select: { id: true, userId: true, createdAt: true, lastActivityAt: true, updatedAt: true, deletedAt: true, deletedSource: true },
    });
    const live = projects.filter(p => !p.deletedAt);
    const activityOf = p => p.lastActivityAt || p.updatedAt || p.createdAt;

    // Creation windows (today/week/month/quarter/year + all-time, each w/ delta).
    const created = windowSummary(projects.map(p => ({ createdAt: p.createdAt })), now);

    const thirtyAgo = new Date(now.getTime() - 30 * 864e5);
    const ninetyAgo = new Date(now.getTime() - 90 * 864e5);
    const modifiedThisMonth = live.filter(p => new Date(activityOf(p)) >= startOfWindow('month', now)).length;
    const inactive30 = live.filter(p => new Date(activityOf(p)) < thirtyAgo).length;
    const inactive90 = live.filter(p => new Date(activityOf(p)) < ninetyAgo).length;

    // Linked screening + per-stage distribution + member averages + open conflicts.
    const [sifts, memberGroups, conflictGroups, robGroups] = await Promise.all([
      prisma.screenProject.findMany({
        where: { linkedMetaLabProjectId: { not: null }, deletedAt: null },
        select: { id: true, linkedMetaLabProjectId: true, stage: true, progressStatus: true },
      }),
      prisma.screenProjectMember.groupBy({ by: ['projectId'], where: { status: 'active' }, _count: { _all: true } }),
      prisma.screenConflict.groupBy({ by: ['projectId'], where: { resolvedAt: null }, _count: { _all: true } }),
      prisma.robAssessment.groupBy({ by: ['projectId'], where: { deletedAt: null }, _count: { _all: true } }),
    ]);
    const liveIds = new Set(live.map(p => p.id));
    const linkedLive = sifts.filter(s => liveIds.has(s.linkedMetaLabProjectId));
    const siftIdToProject = new Map(linkedLive.map(s => [s.id, s.linkedMetaLabProjectId]));

    const byStage = {};
    for (const s of linkedLive) {
      const k = s.progressStatus === 'done' ? 'done' : (s.progressStatus === 'in_progress' ? 'in_progress' : (s.stage || 'title_abstract'));
      byStage[k] = (byStage[k] || 0) + 1;
    }

    // Members per linked screening project → average.
    const memberCounts = memberGroups.filter(g => siftIdToProject.has(g.projectId)).map(g => g._count._all);
    const avgMembers = memberCounts.length ? Math.round((memberCounts.reduce((a, b) => a + b, 0) / memberCounts.length) * 10) / 10 : 0;

    // Distinct LIVE projects with open conflicts (map screen→metalab project id).
    const projectsWithOpenConflicts = new Set(
      conflictGroups.map(g => siftIdToProject.get(g.projectId)).filter(Boolean),
    ).size;
    const projectsWithRoB = new Set(robGroups.map(g => g.projectId).filter(id => liveIds.has(id))).size;

    return res.json({
      generatedAt: now.toISOString(),
      totals: {
        total: projects.length,
        active: live.length,
        archivedAdmin: projects.filter(p => p.deletedAt && p.deletedSource !== 'owner').length,
        deletedByOwner: projects.filter(p => p.deletedSource === 'owner').length,
      },
      created,                                   // { today, week, month, quarter, year, total } each { count, prev, deltaPct }
      activity: { modifiedThisMonth, inactive30, inactive90 },
      screening: {
        withScreening: new Set(linkedLive.map(s => s.linkedMetaLabProjectId)).size,
        withOpenConflicts: projectsWithOpenConflicts,
        withRoB: projectsWithRoB,
        avgMembers,
        byStage,
      },
    });
  } catch (err) {
    console.error('[admin] getProjectsOverview error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/project-growth ────────────────────────────────────────────
// prompt50 WS1 — project CREATION analytics over time (mirrors getUserGrowth's
// shape so the frontend reuses the same growth components). Reads only the tiny
// {createdAt, deletedAt} columns. Admin only. ?year=YYYY selects byMonth/byQuarter.
export async function getProjectGrowth(req, res) {
  try {
    const now = new Date();
    const rows = await prisma.project.findMany({ select: { createdAt: true, deletedAt: true } });

    const windows = windowSummary(rows, now);
    const byYear = groupByYear(rows);
    const availableYears = byYear.map(y => y.year);
    const rawYear = parseInt(req.query.year, 10);
    const selectedYear = Number.isFinite(rawYear) && availableYears.includes(rawYear)
      ? rawYear
      : (availableYears.length ? availableYears[availableYears.length - 1] : now.getFullYear());

    const byMonth = groupByMonth(rows, selectedYear);
    const quarterYears = [...new Set([selectedYear - 1, selectedYear].filter(y => y === selectedYear || availableYears.includes(y)))];
    const byQuarter = groupByQuarter(rows, quarterYears);
    const byDay = groupByDay(rows, 90, now);
    const byMonth12 = groupByTrailingMonths(rows, 12, now);

    const monthRows = filterInRange(rows, startOfWindow('month', now), null);
    const daysElapsed = now.getDate();
    const monthDayBuckets = groupByDay(monthRows, daysElapsed, now);
    let bestDay = null;
    for (const b of monthDayBuckets) if (!bestDay || b.count > bestDay.count) bestDay = b;

    return res.json({
      windows, byYear, availableYears, selectedYear,
      byMonth, byQuarter, byDay, byMonth12,
      stats: {
        newProjectsThisMonth: monthRows.length,
        avgPerDayThisMonth: daysElapsed > 0 ? Math.round((monthRows.length / daysElapsed) * 10) / 10 : 0,
        bestDay: bestDay && bestDay.count > 0 ? bestDay : null,
        activeThisMonth: monthRows.filter(r => !r.deletedAt).length,
      },
    });
  } catch (err) {
    console.error('[admin] getProjectGrowth error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/project-analytics ─────────────────────────────────────────
// prompt50 WS1 — project DISTRIBUTIONS for the Analytics sub-tab, filtered to a
// creation window (?window=today|week|month|quarter|year|all). Cheap small-column
// reads + groupBy; no blobs. Admin only.
export async function getProjectAnalytics(req, res) {
  try {
    const windowUnit = WINDOW_UNITS.includes(req.query.window) ? req.query.window : 'all';
    const all = await prisma.project.findMany({
      select: { id: true, userId: true, createdAt: true, deletedAt: true, deletedSource: true, user: { select: { name: true, email: true } } },
    });
    const projects = windowUnit === 'all' ? all : filterInRange(all, startOfWindow(windowUnit, new Date()), null);
    const idSet = new Set(projects.map(p => p.id));

    const byStatus = tally(projects.map(p => p.deletedAt ? (p.deletedSource === 'owner' ? 'owner-deleted' : 'admin-archived') : 'active'));
    // tally() → [{ label, count }] desc; top 12 owners by project count.
    const byOwner = tally(projects.map(p => p.user?.email || p.userId)).slice(0, 12).map(t => ({ key: t.label, count: t.count }));

    // Linked-screening status + stage distribution within the window.
    const sifts = await prisma.screenProject.findMany({
      where: { linkedMetaLabProjectId: { in: [...idSet] }, deletedAt: null },
      select: { linkedMetaLabProjectId: true, stage: true, progressStatus: true },
    });
    const linkedIds = new Set(sifts.map(s => s.linkedMetaLabProjectId));
    const byScreeningLink = { linked: linkedIds.size, unlinked: projects.length - linkedIds.size };
    const byStage = tally(sifts.map(s => s.progressStatus === 'done' ? 'done' : (s.progressStatus === 'in_progress' ? 'in_progress' : (s.stage || 'title_abstract'))));

    const robGroups = await prisma.robAssessment.groupBy({ by: ['projectId'], where: { deletedAt: null, projectId: { in: [...idSet] } }, _count: { _all: true } });
    const withRoB = robGroups.length;

    return res.json({
      window: windowUnit,
      totalProjects: projects.length,
      byStatus,
      byOwner,
      byScreeningLink,
      byStage,
      completion: {
        withScreening: linkedIds.size,
        withRoB,
        total: projects.length,
      },
    });
  } catch (err) {
    console.error('[admin] getProjectAnalytics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Settings helpers ──────────────────────────────────────────────────────────

const SETTING_KEYS = ['appSettings', 'landingContent', 'featureFlags'];

async function getAllSettings() {
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const result = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

async function upsertSetting(key, value, adminId) {
  await prisma.siteSetting.upsert({
    where: { key },
    update: { value: JSON.stringify(value), updatedBy: adminId },
    create: { key, value: JSON.stringify(value), updatedBy: adminId },
  });
}

// ── GET /api/admin/settings ───────────────────────────────────────────────────

export async function getAdminSettings(req, res) {
  try {
    const settings = await getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[admin] getAdminSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/admin/settings ───────────────────────────────────────────────────

export async function updateAdminSettings(req, res) {
  try {
    const body = req.body || {};
    const updated = [];

    // 93.md round 2 (review fix) — the invitations-paused emergency brake is
    // ONLY changeable via its dedicated PATCH endpoint below. The Ops App
    // Settings form loads a snapshot, is edited for minutes, then PUTs the
    // whole appSettings blob — without this guard a stale snapshot would
    // silently release (or engage) the brake toggled in between.
    if (body.appSettings && typeof body.appSettings === 'object' && !Array.isArray(body.appSettings)) {
      const stored = await getAllSettings();
      const storedPaused = stored?.appSettings?.invitationsPaused === true;
      body.appSettings = { ...body.appSettings, invitationsPaused: storedPaused };
    }

    for (const key of SETTING_KEYS) {
      if (body[key] !== undefined) {
        await upsertSetting(key, body[key], req.user.id);
        updated.push(key);
      }
    }

    if (updated.length === 0) {
      return res.status(400).json({ error: 'No valid settings keys provided' });
    }

    // prompt9 — maintenanceMode/message live in appSettings; bust the gate's
    // 10s cache so toggling maintenance takes effect immediately.
    if (updated.includes('appSettings')) bustMaintenanceCache();

    await logAdminAction(req, 'UPDATE_SETTING', 'SiteSetting', null, { updatedKeys: updated });

    const settings = await getAllSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[admin] updateAdminSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/settings/invitations-paused (93.md round 2) ─────────────
// The ONLY writer of appSettings.invitationsPaused (updateAdminSettings above
// preserves the stored value on whole-blob saves). Read-merge-write + audit
// with old→new so releasing the emergency brake is always a deliberate,
// attributable act.
export async function setInvitationsPaused(req, res) {
  try {
    const paused = req.body?.paused;
    if (typeof paused !== 'boolean') {
      return res.status(400).json({ error: 'paused must be a boolean' });
    }
    const stored = await getAllSettings();
    const app = (stored?.appSettings && typeof stored.appSettings === 'object') ? stored.appSettings : {};
    const before = app.invitationsPaused === true;
    await upsertSetting('appSettings', { ...app, invitationsPaused: paused }, req.user.id);
    bustMaintenanceCache();
    await logAdminAction(req, 'UPDATE_SETTING', 'SiteSetting', null, {
      updatedKeys: ['appSettings.invitationsPaused'], from: before, to: paused,
    });
    return res.json({ paused });
  } catch (err) {
    console.error('[admin] setInvitationsPaused error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/landing-content ───────────────────────────────────────────

export async function getLandingContent(req, res) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'landingContent' } });
    if (!row) return res.json({});
    try {
      return res.json(JSON.parse(row.value));
    } catch {
      return res.json(row.value);
    }
  } catch (err) {
    console.error('[admin] getLandingContent error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/admin/landing-content ───────────────────────────────────────────

export async function updateLandingContent(req, res) {
  try {
    const body = req.body || {};
    await upsertSetting('landingContent', body, req.user.id);
    await logAdminAction(req, 'UPDATE_SETTING', 'SiteSetting', 'landingContent', { updatedKeys: ['landingContent'] });
    const row = await prisma.siteSetting.findUnique({ where: { key: 'landingContent' } });
    return res.json(JSON.parse(row.value));
  } catch (err) {
    console.error('[admin] updateLandingContent error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/feature-flags ─────────────────────────────────────────────

export async function getFeatureFlags(req, res) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    let stored = {};
    if (row) {
      try { stored = JSON.parse(row.value); } catch { stored = {}; }
    }
    // Merge in defaults so the Ops UI always shows every known flag — including
    // any added after the stored row was created (the row is never overwritten
    // on startup). Stored values win; this only backfills missing keys.
    return res.json({ ...defaultFeatureFlags(), ...(stored && typeof stored === 'object' ? stored : {}) });
  } catch (err) {
    console.error('[admin] getFeatureFlags error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/admin/feature-flags ─────────────────────────────────────────────

export async function updateFeatureFlags(req, res) {
  try {
    const body = req.body || {};
    await upsertSetting('featureFlags', body, req.user.id);
    await logAdminAction(req, 'UPDATE_SETTING', 'SiteSetting', 'featureFlags', { updatedKeys: ['featureFlags'] });
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    return res.json(JSON.parse(row.value));
  } catch (err) {
    console.error('[admin] updateFeatureFlags error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/settings/theme ─────────────────────────────────────────────
// prompt37 — the global brand theme. GET mirrors the public endpoint (admin
// convenience); PATCH validates + persists + audits.

export async function getAdminThemeSettings(req, res) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'themeSettings' } });
    let stored = {};
    if (row) { try { stored = JSON.parse(row.value); } catch { stored = {}; } }
    return res.json({ ...defaultThemeSettings(), ...stored });
  } catch (err) {
    console.error('[admin] getAdminThemeSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/settings/theme ───────────────────────────────────────────

export async function updateThemeSettings(req, res) {
  try {
    const result = validateThemePatch(req.body);
    if (!result.ok) return res.status(422).json({ error: result.error });

    // Read the previous record for the audit trail (old → new).
    let before = defaultThemeSettings();
    try {
      const row = await prisma.siteSetting.findUnique({ where: { key: 'themeSettings' } });
      if (row) before = { ...before, ...JSON.parse(row.value) };
    } catch { /* keep default */ }

    const value = { ...result.value, updatedAt: new Date().toISOString() };
    await upsertSetting('themeSettings', value, req.user.id);
    bustThemeCache(); // SPA index.html injection picks up the new brand immediately

    await logAdminAction(req, 'APP_THEME_UPDATED', 'SiteSetting', 'themeSettings', {
      oldPreset: before.preset, oldColor: before.brandColor,
      newPreset: value.preset, newColor: value.brandColor,
    });

    return res.json(value);
  } catch (err) {
    console.error('[admin] updateThemeSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Design (Ops-governed UI) settings ─────────────────────────────────────────
// 65.md — admin read/write for the Ops-governed design, surfaced in Ops ›
// Appearance. `defaultMode` is the interface every non-admin renders;
// `allowLegacyFallback` re-enables ?ui=legacy links + saved preferences for
// non-admins (emergency escape, default OFF); `allowAllUsers` is retained for
// storage back-compat only and no longer gates rendering. Read publicly via
// GET /api/settings/public and consumed by resolveDesignMode() on the frontend.
// The canonical default lives in DEFAULTS.designSettings in
// server/controllers/settingsController.js — this literal mirrors it (kept local
// because that DEFAULTS object is not exported); keep the two in sync.
const DESIGN_SETTINGS_DEFAULT = { allowAllUsers: true, defaultMode: 'stitch', allowLegacyFallback: false };

// ── GET /api/admin/design-settings ────────────────────────────────────────────

export async function getDesignSettings(req, res) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'designSettings' } });
    let stored = {};
    if (row) { try { stored = JSON.parse(row.value); } catch { stored = {}; } }
    // Stored row wins; default backfills any missing field.
    return res.json({ ...DESIGN_SETTINGS_DEFAULT, ...(stored && typeof stored === 'object' ? stored : {}) });
  } catch (err) {
    console.error('[admin] getDesignSettings error:', err.message);
    // Never break the rollout gate — degrade to the shipped default rather than 500.
    return res.json({ ...DESIGN_SETTINGS_DEFAULT });
  }
}

// ── PUT /api/admin/design-settings ────────────────────────────────────────────

export async function updateDesignSettings(req, res) {
  try {
    const body = req.body || {};

    // Strict, partial validation — only the provided fields are checked + merged.
    const patch = {};
    if (body.allowAllUsers !== undefined) {
      if (typeof body.allowAllUsers !== 'boolean') {
        return res.status(400).json({ error: 'allowAllUsers must be a boolean' });
      }
      patch.allowAllUsers = body.allowAllUsers;
    }
    if (body.defaultMode !== undefined) {
      if (body.defaultMode !== 'legacy' && body.defaultMode !== 'stitch') {
        return res.status(400).json({ error: "defaultMode must be 'legacy' or 'stitch'" });
      }
      patch.defaultMode = body.defaultMode;
    }
    if (body.allowLegacyFallback !== undefined) {
      if (typeof body.allowLegacyFallback !== 'boolean') {
        return res.status(400).json({ error: 'allowLegacyFallback must be a boolean' });
      }
      patch.allowLegacyFallback = body.allowLegacyFallback;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid design settings provided' });
    }

    // Merge the patch over the existing stored value (partial update); default underneath.
    let stored = {};
    try {
      const row = await prisma.siteSetting.findUnique({ where: { key: 'designSettings' } });
      if (row) stored = JSON.parse(row.value);
    } catch { /* keep {} */ }

    const before = { ...DESIGN_SETTINGS_DEFAULT, ...(stored && typeof stored === 'object' ? stored : {}) };
    const value = { ...before, ...patch };
    await upsertSetting('designSettings', value, req.user.id);

    await logAdminAction(req, 'DESIGN_SETTINGS_UPDATED', 'SiteSetting', 'designSettings', {
      oldAllowAllUsers: before.allowAllUsers, oldDefaultMode: before.defaultMode, oldAllowLegacyFallback: before.allowLegacyFallback,
      newAllowAllUsers: value.allowAllUsers, newDefaultMode: value.defaultMode, newAllowLegacyFallback: value.allowLegacyFallback,
    });

    return res.json(value);
  } catch (err) {
    console.error('[admin] updateDesignSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/audit-log ──────────────────────────────────────────────────

// Build a validated Prisma createdAt range from from/to query params. Returns
// { range } or { error } (a 400 message) on an unparseable date — so a bad param
// is a clean 400, not a Prisma-thrown 500. (prompt49 item 10 review fix.)
function buildDateRange(from, to) {
  const range = {};
  if (from) { const d = new Date(String(from)); if (isNaN(d.getTime())) return { error: 'Invalid "from" date' }; range.gte = d; }
  if (to) { const d = new Date(String(to)); if (isNaN(d.getTime())) return { error: 'Invalid "to" date' }; range.lte = d; }
  return { range };
}

export async function getAuditLog(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { adminId, action, severity, q, from, to } = req.query;

    const where = {};
    if (adminId) where.adminId = adminId;
    if (action) where.action = String(action);
    // prompt49 item 10 — severity filter maps to a set of action strings (or a
    // NOT-IN set for the INFO catch-all) via the shared catalogue.
    if (severity) {
      const sw = auditActionWhereForSeverity(String(severity));
      if (sw) where.action = where.action ? where.action : sw;
    }
    if (from || to) {
      const dr = buildDateRange(from, to);
      if (dr.error) return res.status(400).json({ error: dr.error });
      where.createdAt = dr.range;
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { action: insensitiveContains(term) },
        { entityType: insensitiveContains(term) },
        { entityId: insensitiveContains(term) },
        { details: insensitiveContains(term) },
        { admin: { email: insensitiveContains(term) } },
        { admin: { name: insensitiveContains(term) } },
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count({ where }),
      prisma.adminAuditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          details: true,
          ip: true,
          createdAt: true,
          admin: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({ logs, total });
  } catch (err) {
    console.error('[admin] getAuditLog error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/security-events ───────────────────────────────────────────

export async function getSecurityEvents(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { type, severity, q, from, to } = req.query;

    const where = {};
    if (type) where.type = String(type);
    if (severity && !type) {
      const sw = securityTypeWhereForSeverity(String(severity));
      if (sw) where.type = sw;
    }
    if (from || to) {
      const dr = buildDateRange(from, to);
      if (dr.error) return res.status(400).json({ error: dr.error });
      where.createdAt = dr.range;
    }
    if (q && String(q).trim()) {
      const term = String(q).trim();
      where.OR = [
        { type: insensitiveContains(term) },
        { email: insensitiveContains(term) },
        { ip: insensitiveContains(term) },
        { details: insensitiveContains(term) },
      ];
    }

    const [total, events] = await Promise.all([
      prisma.securityEvent.count({ where }),
      prisma.securityEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({ events, total });
  } catch (err) {
    console.error('[admin] getSecurityEvents error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/security-summary?window=24h|7d|30d|90d ────────────────────
// Aggregate dashboard for the Security tab (prompt49 item 10). Counts admin
// audit actions + security events over a window and rolls them up by severity
// using the shared catalogue. Read-only; no secrets. Admin only.
export async function getSecuritySummary(req, res) {
  try {
    const windowKey = String(req.query.window || '7d');
    const days = ({ '24h': 1, '7d': 7, '30d': 30, '90d': 90 })[windowKey] || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [auditGroups, secGroups] = await Promise.all([
      prisma.adminAuditLog.groupBy({ by: ['action'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      prisma.securityEvent.groupBy({ by: ['type'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    ]);

    const auditCounts = Object.fromEntries(auditGroups.map((g) => [g.action, g._count._all]));
    const secCounts = Object.fromEntries(secGroups.map((g) => [g.type, g._count._all]));

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const g of auditGroups) severityCounts[AUDIT_ACTIONS[g.action]?.severity || 'info'] += g._count._all;
    for (const g of secGroups) severityCounts[SECURITY_TYPES[g.type]?.severity || 'info'] += g._count._all;

    const totals = {
      failedLogins: secCounts.FAILED_LOGIN || 0,
      adminAccessDenied: secCounts.ADMIN_ACCESS_DENIED || 0,
      rateLimited: secCounts.RATE_LIMITED || 0,
      passwordResetsRequested: secCounts.PASSWORD_RESET_REQUESTED || 0,
      suspensions: auditCounts.SUSPEND_USER || 0,
      roleChanges: auditCounts.ASSIGN_ROLE || 0,
      passwordResetsSent: (auditCounts.SEND_PASSWORD_RESET || 0) + (auditCounts.RESET_PASSWORD || 0),
      settingChanges: auditCounts.UPDATE_SETTING || 0,
      auditEvents: auditGroups.reduce((s, g) => s + g._count._all, 0),
      securityEvents: secGroups.reduce((s, g) => s + g._count._all, 0),
    };

    return res.json({ window: windowKey, since, severityCounts, totals });
  } catch (err) {
    console.error('[admin] getSecuritySummary error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Ops Users analytics + institution management (prompt26 follow-up) ──────────
//
// Read model: every analytics/listing handler reads ALL users' profile fields
// once and aggregates in-memory. Two SiteSetting JSON rows hold the only mutable
// state (see utils/institutionStore.js): canonical-name overrides and the list
// of admin-rejected duplicate pairs. Institution grouping/matching is delegated
// to the pure research-engine (groupInstitutions / institutionSimilarity).

// Profile columns the analytics aggregation needs — a strict subset of the safe
// USER_DETAIL_SELECT (no secret ever selected). createdAt is included so the
// distributions can be filtered to a registration time window (prompt27).
const USER_ANALYTICS_SELECT = {
  createdAt: true,
  primaryRole: true, researchField: true, mainUseCase: true,
  institutionOriginal: true, institutionNormalized: true, country: true,
  registrationCountryName: true,
  emailVerifiedAt: true, onboardingCompletedAt: true,
};

// Profile + createdAt columns the new-user-growth aggregation needs (prompt27).
// Still a strict subset of the safe analytics select — no secret ever read.
const USER_GROWTH_SELECT = {
  createdAt: true,
  primaryRole: true, researchField: true, mainUseCase: true,
  institutionOriginal: true, country: true, registrationCountryName: true,
  onboardingCompletedAt: true, emailVerifiedAt: true,
};

/**
 * Build the institution groups (engine groupInstitutions over non-empty
 * institutionOriginal) with canonical-name overrides applied for display.
 * Returns [{ key, canonicalName, count, variants }].
 */
function buildInstitutionGroups(users, overrides) {
  const originals = users
    .map(u => (u.institutionOriginal || '').trim())
    .filter(Boolean);
  const groups = groupInstitutions(originals);
  return groups.map(g => ({
    ...g,
    canonicalName: (overrides && overrides[g.key]) ? overrides[g.key] : g.canonicalName,
  }));
}

// ── GET /api/admin/user-analytics ─────────────────────────────────────────────
// ?window=today|week|month|quarter|year|all (default 'all', prompt27) — filters
// every distribution to accounts CREATED in that registration window. Default
// 'all' preserves the original prompt26 behaviour (whole-database snapshot).
export async function getUserAnalytics(req, res) {
  try {
    const windowUnit = WINDOW_UNITS.includes(req.query.window) ? req.query.window : 'all';
    const allUsers = await prisma.user.findMany({ select: USER_ANALYTICS_SELECT });
    const users = windowUnit === 'all'
      ? allUsers
      : filterInRange(allUsers, startOfWindow(windowUnit, new Date()), null);
    const totalUsers = users.length;

    const byResearchField = tally(users.map(u => u.researchField));
    const byPrimaryRole = tally(users.map(u => u.primaryRole));
    const byMainUseCase = tally(users.map(u => u.mainUseCase));
    // Prefer the stated profile country; fall back to the inferred registration
    // country name when the user never set one.
    const byCountry = tally(users.map(u => u.country || u.registrationCountryName));

    const overrides = await getCanonicalOverrides();
    const groups = buildInstitutionGroups(users, overrides);
    const topInstitutions = groups.slice(0, 12).map(g => ({
      key: g.key,
      canonicalName: g.canonicalName,
      count: g.count,
    }));

    const onboardingCompleted = users.filter(u => u.onboardingCompletedAt).length;
    const verified = users.filter(u => u.emailVerifiedAt).length;
    const withInstitution = users.filter(u => (u.institutionOriginal || '').trim()).length;

    return res.json({
      window: windowUnit,
      totalUsers,
      byResearchField,
      byPrimaryRole,
      byMainUseCase,
      byCountry,
      topInstitutions,
      onboarding: { completed: onboardingCompleted, total: totalUsers },
      verification: { verified, unverified: totalUsers - verified, total: totalUsers },
      institution: { provided: withInstitution, missing: totalUsers - withInstitution, total: totalUsers },
    });
  } catch (err) {
    console.error('[admin] getUserAnalytics error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/user-growth ────────────────────────────────────────────────
// New-user REGISTRATION analytics over time (prompt27). One read of the safe
// profile columns → headline windows (today/week/month/quarter/year + all-time
// total, each with previous-period delta), historical year/month/quarter/day
// series, this-month profile insights, and site-growth stats. Admin only.
//
// SCALE NOTE: like getUserAnalytics / getUserCountries / getMetricsTimeseries
// this reads all users once and aggregates in JS — fine at the current SQLite
// scale and avoids raw-SQL coupling to SQLite date storage. Only a strict subset
// of non-secret columns is selected (USER_GROWTH_SELECT). If the dataset grows
// large, swap the headline COUNTS for cheap prisma.count({ where:{ createdAt }})
// per window and keep the JS pass only for the chart series (documented).
//
// ?year=YYYY (optional) selects which year drives byMonth/byQuarter — defaults to
// the most recent year that has any registrations.
export async function getUserGrowth(req, res) {
  try {
    const now = new Date();
    const users = await prisma.user.findMany({ select: USER_GROWTH_SELECT });

    const windows = windowSummary(users, now);
    const byYear = groupByYear(users);
    const availableYears = byYear.map(y => y.year);
    const rawYear = parseInt(req.query.year, 10);
    const selectedYear = Number.isFinite(rawYear) && availableYears.includes(rawYear)
      ? rawYear
      : (availableYears.length ? availableYears[availableYears.length - 1] : now.getFullYear());

    const byMonth = groupByMonth(users, selectedYear);
    // Quarters for the selected year and the one before it (when present), so the
    // operator can eyeball quarter-over-quarter across the year boundary.
    const quarterYears = [...new Set(
      [selectedYear - 1, selectedYear].filter(y => y === selectedYear || availableYears.includes(y)),
    )];
    const byQuarter = groupByQuarter(users, quarterYears);
    const byDay = groupByDay(users, 90, now);          // last 90; client slices 7/30/90
    const byMonth12 = groupByTrailingMonths(users, 12, now);

    // This-month profile insights (top single value per field; null when absent).
    const monthUsers = filterInRange(users, startOfWindow('month', now), null);
    const insights = {
      topCountry:       topOf(monthUsers.map(u => u.country || u.registrationCountryName)),
      topInstitution:   topOf(monthUsers.map(u => u.institutionOriginal)),
      topResearchField: topOf(monthUsers.map(u => u.researchField)),
      topPrimaryRole:   topOf(monthUsers.map(u => u.primaryRole)),
      topMainUseCase:   topOf(monthUsers.map(u => u.mainUseCase)),
    };

    // Site-growth stats for the current month.
    const daysElapsed = now.getDate(); // 1..31 — days of the month so far
    const monthDayBuckets = groupByDay(monthUsers, daysElapsed, now);
    let bestDay = null;
    for (const b of monthDayBuckets) if (!bestDay || b.count > bestDay.count) bestDay = b;
    const countriesThisMonth = new Set(
      monthUsers
        .map(u => (u.country || u.registrationCountryName || '').trim().toLowerCase())
        .filter(Boolean),
    ).size;

    // New institutions first seen THIS month (Part E). Normalized with the SAME
    // engine key the institution registry uses, so the count agrees with the
    // Institutions tab. "New" = the institution's earliest linked-user createdAt
    // falls in the current month.
    const monthStartMs = startOfWindow('month', now).getTime();
    const instFirstSeen = new Map(); // normalized key -> earliest createdAt (ms)
    for (const usr of users) {
      const orig = (usr.institutionOriginal || '').trim();
      if (!orig) continue;
      const key = institutionKey(orig);
      if (!key) continue;
      const ms = new Date(usr.createdAt).getTime();
      const prev = instFirstSeen.get(key);
      if (prev == null || ms < prev) instFirstSeen.set(key, ms);
    }
    let newInstitutionsThisMonth = 0;
    for (const ms of instFirstSeen.values()) if (ms >= monthStartMs) newInstitutionsThisMonth += 1;

    const stats = {
      newUsersThisMonth: monthUsers.length,
      avgPerDayThisMonth: daysElapsed > 0 ? Math.round((monthUsers.length / daysElapsed) * 10) / 10 : 0,
      bestDay: bestDay && bestDay.count > 0 ? bestDay : null,
      onboardingCompletedThisMonth: monthUsers.filter(u => u.onboardingCompletedAt).length,
      withInstitutionThisMonth: monthUsers.filter(u => (u.institutionOriginal || '').trim()).length,
      countriesThisMonth,
      newInstitutionsThisMonth,
      totalInstitutions: instFirstSeen.size,
    };

    return res.json({
      timezone: 'server-local',
      weekStart: 'sunday',
      now: now.toISOString(),
      windows,
      byYear,
      availableYears,
      selectedYear,
      byMonth,
      byQuarter,
      byDay,
      byMonth12,
      insights,
      stats,
    });
  } catch (err) {
    console.error('[admin] getUserGrowth error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/institutions ───────────────────────────────────────────────
export async function getInstitutions(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: {
        institutionOriginal: true,
        // prompt35 — canonical linkage + uncertain-match flag for the Ops summary.
        institutionCanonicalName: true, institutionRorId: true,
        institutionSource: true, institutionNeedsReview: true,
      },
    });
    const [overrides, rejected] = await Promise.all([
      getCanonicalOverrides(),
      getRejectedPairSet(),
    ]);

    // prompt35 — institution coverage summary for Ops (top institutions live in the
    // groups below; these surface needs-review + unmatched + missing institutions).
    const summary = {
      totalUsers: users.length,
      withInstitution: users.filter(u => (u.institutionOriginal || '').trim()).length,
      withoutInstitution: users.filter(u => !(u.institutionOriginal || '').trim()).length,
      canonicalLinked: users.filter(u => u.institutionRorId || u.institutionCanonicalName).length,
      rorLinked: users.filter(u => u.institutionRorId).length,
      customUnmatched: users.filter(u => (u.institutionOriginal || '').trim() && u.institutionSource === 'custom' && !u.institutionCanonicalName).length,
      needsReview: users.filter(u => u.institutionNeedsReview).length,
      cachedInstitutions: await prisma.institution.count().catch(() => 0), // prompt36 — canonical cache size
    };

    const groups = buildInstitutionGroups(users, overrides);

    const institutions = groups.map(g => {
      // possibleDuplicates: other groups whose canonical names are similar
      // (>= 0.80), excluding admin-rejected pairs. Compare on canonical (override
      // -aware) names so curated renames are reflected in the suggestions.
      const possibleDuplicates = [];
      for (const other of groups) {
        if (other.key === g.key) continue;
        if (rejected.has(pairId(g.key, other.key))) continue;
        const confidence = institutionSimilarity(g.canonicalName, other.canonicalName);
        if (confidence >= INST_REVIEW_THRESHOLD) {
          possibleDuplicates.push({
            key: other.key,
            canonicalName: other.canonicalName,
            confidence: Math.round(confidence * 100) / 100,
          });
        }
      }
      possibleDuplicates.sort((a, b) => b.confidence - a.confidence);

      return {
        key: g.key,
        canonicalName: g.canonicalName,
        userCount: g.count,
        aliases: g.variants,            // distinct original spellings
        possibleDuplicates,
      };
    });

    return res.json({ institutions, summary });
  } catch (err) {
    console.error('[admin] getInstitutions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/institutions/merge ────────────────────────────────────────
// body { fromKey, toKey } → repoint User.institutionNormalized from fromKey to
// toKey (the user's institutionOriginal is preserved as the surviving alias).
export async function mergeInstitutions(req, res) {
  try {
    const fromKey = String((req.body || {}).fromKey || '').trim();
    const toKey = String((req.body || {}).toKey || '').trim();
    if (!fromKey || !toKey) {
      return res.status(400).json({ error: 'fromKey and toKey are required' });
    }
    if (fromKey === toKey) {
      return res.status(400).json({ error: 'fromKey and toKey must differ' });
    }

    // institutionNormalized stores the grouping key, so repoint by key.
    const result = await prisma.user.updateMany({
      where: { institutionNormalized: fromKey },
      data: { institutionNormalized: toKey },
    });
    const moved = result.count;

    // Carry over any canonical-name override from the absorbed key (only if the
    // surviving key has none of its own), then drop the stale override.
    const overrides = await getCanonicalOverrides();
    if (overrides[fromKey] && !overrides[toKey]) overrides[toKey] = overrides[fromKey];
    if (Object.prototype.hasOwnProperty.call(overrides, fromKey)) delete overrides[fromKey];
    await setCanonicalOverrides(overrides, req.user.id);

    await logAdminAction(req, 'MERGE_INSTITUTION', 'Institution', toKey, { fromKey, toKey, moved });
    return res.json({ ok: true, moved });
  } catch (err) {
    console.error('[admin] mergeInstitutions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/institutions/rename ───────────────────────────────────────
// body { key, name } → set the canonical display name override for a group key.
export async function renameInstitution(req, res) {
  try {
    const key = String((req.body || {}).key || '').trim();
    const name = String((req.body || {}).name || '').trim();
    if (!key) return res.status(400).json({ error: 'key is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });

    const overrides = await getCanonicalOverrides();
    const before = overrides[key] || null;
    overrides[key] = name;
    await setCanonicalOverrides(overrides, req.user.id);

    await logAdminAction(req, 'RENAME_INSTITUTION', 'Institution', key, { key, before, after: name });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] renameInstitution error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/institutions/reject ───────────────────────────────────────
// body { keyA, keyB } → record that this pair is NOT a duplicate so it never
// resurfaces in possibleDuplicates. Idempotent (stored order-independent).
export async function rejectInstitutionDuplicate(req, res) {
  try {
    const keyA = String((req.body || {}).keyA || '').trim();
    const keyB = String((req.body || {}).keyB || '').trim();
    if (!keyA || !keyB) {
      return res.status(400).json({ error: 'keyA and keyB are required' });
    }
    if (keyA === keyB) {
      return res.status(400).json({ error: 'keyA and keyB must differ' });
    }

    const pairs = await getRejectedPairs();
    const id = pairId(keyA, keyB);
    const exists = pairs.some(p => pairId(p[0], p[1]) === id);
    if (!exists) {
      pairs.push([keyA, keyB]);
      await setRejectedPairs(pairs, req.user.id);
    }

    await logAdminAction(req, 'REJECT_INSTITUTION_DUPLICATE', 'Institution', id, { keyA, keyB });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] rejectInstitutionDuplicate error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/contact-messages ──────────────────────────────────────────

export async function getContactMessages(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { read, archived, search, sort, box } = req.query;
    const me = req.user.id;

    const where = {};
    if (read !== undefined) where.read = read === 'true';          // legacy global filter (back-compat)
    if (archived !== undefined) where.archived = archived === 'true';
    if (search) {
      where.OR = [
        { name: insensitiveContains(search) },
        { email: insensitiveContains(search) },
        { subject: insensitiveContains(search) },
        { message: insensitiveContains(search) },
      ];
    }

    // prompt49 — GLOBAL shared read state across all admins+mods. A message is
    // unread when readAt is null (identical for every staff member). Opening it
    // marks it read for EVERYONE; marking it unread clears it for everyone.
    if (box === 'unread') {
      where.archived = false;
      where.readAt = null;
    } else if (box === 'read') {
      where.archived = false;
      where.readAt = { not: null };
    } else if (box === 'archived') {
      where.archived = true;
    }

    const orderBy = sort === 'oldest' ? { createdAt: 'asc' } : { createdAt: 'desc' };

    const [total, messages] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({ where, orderBy, skip, take: limit }),
    ]);

    // readByMe is now the GLOBAL read state (kept for frontend compatibility);
    // readByName tells staff WHO opened it.
    const shaped = messages.map((m) => ({ ...m, readByMe: !!m.readAt }));

    return res.json({ messages: shaped, total });
  } catch (err) {
    console.error('[admin] getContactMessages error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/contact-messages/unread-count ──────────────────────────────
// prompt49 — GLOBAL shared unread badge: non-archived messages with readAt null.
// The same count for every admin/mod (no per-staff divergence).

export async function getUnreadMessageCount(req, res) {
  try {
    const unread = await prisma.contactMessage.count({ where: { archived: false, readAt: null } });
    return res.json({ unread });
  } catch (err) {
    console.error('[admin] getUnreadMessageCount error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/contact-messages/:id/mark-read ────────────────────────────
// prompt49 — GLOBAL shared read state. Opening a message (read:true) sets
// readAt/readByUserId/readByName so it is read for ALL admins+mods; { read:false }
// clears them so it is unread for everyone. Returns the shared unread count.

export async function markMessageRead(req, res) {
  try {
    const me = req.user.id;
    const wantRead = req.body?.read !== false; // default true
    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    if (wantRead) {
      const actor = await prisma.user.findUnique({ where: { id: me }, select: { name: true, email: true } });
      await prisma.contactMessage.update({
        where: { id: msg.id },
        data: { readAt: new Date(), readByUserId: me, readByName: actor?.name || actor?.email || '' },
      });
    } else {
      await prisma.contactMessage.update({
        where: { id: msg.id },
        data: { readAt: null, readByUserId: null, readByName: null },
      });
    }

    const unread = await prisma.contactMessage.count({ where: { archived: false, readAt: null } });
    return res.json({ ok: true, read: wantRead, unread });
  } catch (err) {
    console.error('[admin] markMessageRead error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// prompt49 — one-time idempotent backfill: any message that ANY staff member had
// previously read (a per-staff receipt) becomes globally read (using the earliest
// receipt). Only touches messages whose shared readAt is still null AND that have a
// receipt, so it is safe to run on every boot. Non-blocking from index.js.
export async function backfillSharedMessageReadState() {
  try {
    const pending = await prisma.contactMessage.findMany({
      where: { readAt: null, reads: { some: {} } },
      select: { id: true, reads: { select: { userId: true, readAt: true }, orderBy: { readAt: 'asc' }, take: 1 } },
    });
    let migrated = 0;
    for (const m of pending) {
      const first = m.reads[0];
      if (!first) continue;
      await prisma.contactMessage.update({
        where: { id: m.id },
        data: { readAt: first.readAt, readByUserId: first.userId },
      }).catch(() => {});
      migrated += 1;
    }
    if (migrated > 0) console.log(`[backfill] shared message read state: migrated ${migrated} message(s).`);
  } catch (err) {
    console.error('[backfill] shared message read state failed:', err.message);
  }
}

// ── PATCH /api/admin/contact-messages/:id ────────────────────────────────────
// 93.md §9.3 — extended with the bug-triage fields (severity / triageStatus /
// triageNote), each strictly validated against the closed enums. Triage changes
// stamp triagedAt and are audit-logged; the legacy read/archived toggles keep
// their exact prior behavior (unaudited, boolean-only).

const MESSAGE_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const MESSAGE_TRIAGE_STATUSES = ['new', 'acknowledged', 'needs_info', 'planned', 'in_progress', 'shipped', 'declined', 'duplicate'];

export async function updateContactMessage(req, res) {
  try {
    const { read, archived, severity, triageStatus, triageNote } = req.body || {};
    const data = {};
    if (typeof read === 'boolean') data.read = read;
    if (typeof archived === 'boolean') data.archived = archived;

    // 93.md §9.3 — triage fields. null clears severity/note; enum values only.
    const triageMeta = {};
    if (severity !== undefined) {
      if (severity !== null && !MESSAGE_SEVERITIES.includes(severity)) {
        return res.status(400).json({ error: `severity must be one of ${MESSAGE_SEVERITIES.join('|')} or null` });
      }
      data.severity = severity;
      triageMeta.severity = severity;
    }
    if (triageStatus !== undefined) {
      if (!MESSAGE_TRIAGE_STATUSES.includes(triageStatus)) {
        return res.status(400).json({ error: `triageStatus must be one of ${MESSAGE_TRIAGE_STATUSES.join('|')}` });
      }
      data.triageStatus = triageStatus;
      data.triagedAt = new Date();
      triageMeta.triageStatus = triageStatus;
    }
    if (triageNote !== undefined) {
      if (triageNote !== null && typeof triageNote !== 'string') {
        return res.status(400).json({ error: 'triageNote must be a string or null' });
      }
      data.triageNote = triageNote === null ? null : triageNote.slice(0, 2000);
      triageMeta.triageNote = data.triageNote ? 'set' : 'cleared'; // never copy free text into the audit log
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Provide `read`/`archived` (boolean) or `severity`/`triageStatus`/`triageNote`' });
    }

    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const updated = await prisma.contactMessage.update({
      where: { id: req.params.id },
      data,
    });

    if (Object.keys(triageMeta).length > 0) {
      await logAdminAction(req, 'TRIAGE_MESSAGE', 'ContactMessage', msg.id, { reference: msg.reference || null, ...triageMeta });
    }

    return res.json({ message: updated });
  } catch (err) {
    console.error('[admin] updateContactMessage error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── DELETE /api/admin/contact-messages/:id ───────────────────────────────────

export async function deleteContactMessage(req, res) {
  try {
    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    await prisma.contactMessage.delete({ where: { id: req.params.id } });

    await logAdminAction(req, 'DELETE_MESSAGE', 'ContactMessage', msg.id, {
      email: msg.email,
      subject: msg.subject,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] deleteContactMessage error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/contact-messages/:id/reply ────────────────────────────────
// Render the reply template, attempt to email it, persist a ContactReply, and
// mark the message replied. (admin + mod)
// If email is not configured the reply is saved as a draft and a 200 is returned
// with emailConfigured:false — never a 500.

export async function replyToMessage(req, res) {
  try {
    const { subject, body } = req.body || {};
    if (typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: '`body` is required' });
    }

    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const finalSubject = (typeof subject === 'string' && subject.trim())
      ? subject.trim()
      : `Re: ${msg.subject || '(no subject)'}`;

    // The recipient sees the NAME of the staff member who replied (not the shared
    // no-reply address). req.user may lack `name`, so resolve it from the DB.
    const staff = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const staffName = (staff?.name || '').trim();

    const { html, text } = renderReplyEmail({
      appName: 'PecanRev',
      toName: msg.name || '',
      bodyText: body,
      originalSubject: msg.subject || '',
      fromName: staffName,
    });

    // sendEmail never throws — { sent:false, reason } when not configured / on failure.
    // (It also records the EMAIL_SENT/EMAIL_FAILED usage metric itself, prompt9.)
    const result = await sendEmail({ to: msg.email, subject: finalSubject, html, text, context: 'contact_reply' });
    const sent = result.sent === true;

    const reply = await prisma.contactReply.create({
      data: {
        messageId: msg.id,
        repliedById: req.user.id,
        repliedByName: staffName || staff?.email || '',
        toEmail: msg.email,
        subject: finalSubject,
        body,
        status: sent ? 'sent' : 'draft',
        error: result.error || '',
      },
    });

    await prisma.contactMessage.update({
      where: { id: msg.id },
      data: { replied: true, repliedAt: new Date() },
    });
    // Replying implies the staff member has read it — record a per-staff receipt
    // (the global `read` flag is intentionally left alone for per-staff isolation).
    await prisma.contactMessageRead.upsert({
      where: { messageId_userId: { messageId: msg.id, userId: req.user.id } },
      update: { readAt: new Date() },
      create: { messageId: msg.id, userId: req.user.id },
    });

    await logAdminAction(req, 'REPLY_MESSAGE', 'ContactMessage', msg.id, {
      to: msg.email,
      subject: finalSubject,
      sent,
      reason: result.reason || null,
    });

    return res.json({ reply, emailConfigured: isEmailConfigured(), sent });
  } catch (err) {
    console.error('[admin] replyToMessage error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/emails — compose & send a NEW email to any recipient ───────
// Staff-initiated outbound email; the recipient need NOT have messaged first. Creates a
// 'staff'-origin ContactMessage (so the conversation shows in Messages) + a ContactReply
// for the sent email. The recipient sees the staff member's NAME, not their email. (admin + mod)
export async function composeEmail(req, res) {
  try {
    const { to, subject, body, toName } = req.body || {};
    const email = typeof to === 'string' ? to.trim() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid recipient `to` email is required' });
    if (typeof body !== 'string' || !body.trim()) return res.status(400).json({ error: '`body` is required' });
    const finalSubject = (typeof subject === 'string' && subject.trim()) ? subject.trim() : '(no subject)';

    const staff = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, email: true } });
    const staffName = (staff?.name || '').trim();
    const recipientName = (typeof toName === 'string' ? toName.trim() : '');

    const msg = await prisma.contactMessage.create({
      data: { email, name: recipientName || null, subject: finalSubject, message: body, origin: 'staff', read: true, replied: true, repliedAt: new Date() },
    });

    const { html, text } = renderReplyEmail({ appName: 'PecanRev', toName: recipientName, bodyText: body, fromName: staffName });
    const result = await sendEmail({ to: email, subject: finalSubject, html, text, context: 'staff_compose' });
    const sent = result.sent === true;

    const reply = await prisma.contactReply.create({
      data: { messageId: msg.id, repliedById: req.user.id, repliedByName: staffName || staff?.email || '', toEmail: email, subject: finalSubject, body, status: sent ? 'sent' : 'draft', error: result.error || '' },
    });

    await logAdminAction(req, 'COMPOSE_EMAIL', 'ContactMessage', msg.id, { to: email, subject: finalSubject, sent, reason: result.reason || null });
    return res.json({ ok: true, message: msg, reply, emailConfigured: isEmailConfigured(), sent });
  } catch (err) {
    console.error('[admin] composeEmail error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/contact-messages/:id/replies ───────────────────────────────
// List replies for a message, newest first. (admin + mod)

export async function getMessageReplies(req, res) {
  try {
    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const replies = await prisma.contactReply.findMany({
      where: { messageId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ replies, emailConfigured: isEmailConfigured() });
  } catch (err) {
    console.error('[admin] getMessageReplies error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/projects/:id/archive ────────────────────────────────────

export async function archiveProject(req, res) {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, deletedAt: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.deletedAt) return res.status(400).json({ error: 'Project already archived' });
    // deletedSource:'admin' — keeps admin archive distinguishable from the
    // owner soft delete (prompt9; legacy null also means admin archive).
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date(), deletedSource: 'admin' } });
    await logAdminAction(req, 'ARCHIVE_PROJECT', 'Project', id, { name: project.name });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] archiveProject error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/projects/:id/restore ────────────────────────────────────

export async function restoreProject(req, res) {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, deletedAt: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!project.deletedAt) return res.status(400).json({ error: 'Project is not archived' });
    // Clears deletedSource too — restoring an owner-deleted project must fully
    // revive it (prompt9), not leave a stale 'owner' marker hiding it.
    await prisma.project.update({ where: { id }, data: { deletedAt: null, deletedSource: null } });
    await logAdminAction(req, 'RESTORE_PROJECT', 'Project', id, { name: project.name });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] restoreProject error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/console ────────────────────────────────────────────────────
// Tells the frontend which sections to render for the caller's role.
// Server enforcement (per-route middleware) is the source of truth — this is UX only.
// req.user.role is the DB-verified role set by requireAdminOrMod.

export async function getConsole(req, res) {
  const role = req.user?.role || 'user';
  const sections = role === 'admin'
    ? ['overview', 'users', 'projects', 'sift', 'rob', 'searchProviders', 'waitlist', 'onboarding', 'content', 'settings', 'style', 'flags', 'extractionAi', 'livingReviews', 'tiers', 'messages', 'security', 'health', 'engineVersions']
    : role === 'mod'
      ? ['users', 'messages']
      : [];

  return res.json({
    role,
    sections,
    emailConfigured: isEmailConfigured(),
    // prompt14 — secret-free email config snapshot (booleans + provider label) so
    // the ops Email System card can render status without a second round-trip and
    // without ever exposing SMTP host/user/password values.
    email: emailStatus(),
  });
}

// ── GET /api/admin/health ─────────────────────────────────────────────────────

export async function getHealth(req, res) {
  let dbStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }

  const v = getVersion();
  return res.json({
    status: 'ok',
    db: dbStatus,
    env: process.env.NODE_ENV || 'development',
    version: v.version,
    commit: v.commit,
    buildDate: v.buildDate,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
