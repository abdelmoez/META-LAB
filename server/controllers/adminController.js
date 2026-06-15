import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { hashPassword } from '../auth/password.js';
import { isEmailConfigured, sendEmail, renderReplyEmail, renderPasswordResetEmail, emailStatus } from '../services/emailService.js';
import { createResetToken } from '../services/passwordResetService.js';
import { getVersion } from '../version.js';
import { bustMaintenanceCache } from '../middleware/maintenance.js';
import { USAGE, recordUsage } from '../utils/usage.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Generate a strong, human-typeable temporary password.
 * Mixed case + digits + symbols, ~16 chars. Returned ONCE to the admin/mod; never stored.
 */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+';
  const all = upper + lower + digits + symbols;
  const pick = set => set[Math.floor(Math.random() * set.length)];
  // Guarantee at least one of each class, then fill to length 16.
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed chars are not always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

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
      allProjects,
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
      prisma.project.findMany({ select: { data: true } }),
    ]);
    const unreadMessages = Math.max(0, activeMessages - myReadActive);

    let studies = 0;
    let records = 0;
    for (const project of allProjects) {
      const data = safeParseData(project.data);
      studies += Array.isArray(data.studies) ? data.studies.length : 0;
      records += Array.isArray(data.records) ? data.records.length : 0;
    }

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

    return res.json({
      users: {
        total: totalUsers,
        today: todayUsers,
        thisWeek: weekUsers,
        thisMonth: monthUsers,
        suspended: suspendedUsers,
        admins: adminUsers,
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
    const { search, role, suspended } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { email: { contains: search } },
        { name: { contains: search } },
      ];
    }
    if (role) where.role = role;
    if (suspended !== undefined) where.suspended = suspended === 'true';

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
          createdAt: true,
          lastActive: true,
          _count: { select: { projects: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formatted = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      suspended: u.suspended,
      createdAt: u.createdAt,
      lastActive: u.lastActive,
      projectCount: u._count.projects,
    }));

    return res.json({ users: formatted, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[admin] getUsers error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/countries ──────────────────────────────────────────────
// Aggregate, COUNTRY-LEVEL-ONLY distribution of live users for the Ops Users map
// (prompt19 Task 12). Groups every user by registrationCountryCode; null/'' codes
// collapse into a single "Unknown" bucket (named from registrationCountryName when
// present — e.g. "Local" — else "Unknown"). No raw IPs, no city/coords are ever
// read or returned. Sorted by userCount desc. (admin only)

export async function getUserCountries(req, res) {
  try {
    const users = await prisma.user.findMany({
      select: {
        registrationCountryCode: true,
        registrationCountryName: true,
        createdAt: true,
      },
    });

    const totalUsers = users.length;
    const UNKNOWN = '__unknown__'; // sentinel key for the null/'' bucket
    const buckets = new Map(); // key → { countryCode, countryName, userCount, latestRegistrationAt }

    for (const u of users) {
      const rawCode = (u.registrationCountryCode || '').trim().toUpperCase();
      const isKnown = rawCode.length === 2;
      const key = isKnown ? rawCode : UNKNOWN;

      let b = buckets.get(key);
      if (!b) {
        b = {
          countryCode: isKnown ? rawCode : '',
          // Known: prefer stored name, else derive from code. Unknown: the stored
          // name (e.g. "Local") when any user in the bucket has one, else "Unknown".
          countryName: isKnown
            ? (u.registrationCountryName || rawCode)
            : (u.registrationCountryName || 'Unknown'),
          userCount: 0,
          latestRegistrationAt: null,
        };
        buckets.set(key, b);
      }
      b.userCount += 1;
      // Keep a sensible Unknown-bucket label: "Local" beats a bare "Unknown".
      if (!isKnown && u.registrationCountryName && b.countryName === 'Unknown') {
        b.countryName = u.registrationCountryName;
      }
      if (u.createdAt && (!b.latestRegistrationAt || u.createdAt > b.latestRegistrationAt)) {
        b.latestRegistrationAt = u.createdAt;
      }
    }

    const countries = Array.from(buckets.values())
      .map(b => ({
        countryCode: b.countryCode,
        countryName: b.countryName,
        userCount: b.userCount,
        percentage: totalUsers > 0 ? Math.round((b.userCount / totalUsers) * 1000) / 10 : 0,
        latestRegistrationAt: b.latestRegistrationAt,
      }))
      .sort((a, b) => b.userCount - a.userCount || a.countryName.localeCompare(b.countryName));

    const unknownBucket = buckets.get(UNKNOWN);
    const unknown = unknownBucket ? unknownBucket.userCount : 0;
    const totalKnown = totalUsers - unknown;
    const countriesRepresented = countries.filter(c => c.countryCode).length;

    return res.json({
      countries,
      summary: { totalUsers, totalKnown, unknown, countriesRepresented },
    });
  } catch (err) {
    console.error('[admin] getUserCountries error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/users/:id ──────────────────────────────────────────────────

export async function getUserById(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        suspended: true,
        createdAt: true,
        lastActive: true,
        updatedAt: true,
        _count: { select: { projects: true } },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      ...user,
      projectCount: user._count.projects,
      _count: undefined,
    });
  } catch (err) {
    console.error('[admin] getUserById error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/users/:id ────────────────────────────────────────────────
// Edit a user's name and/or email. (admin + mod)

export async function updateUser(req, res) {
  try {
    const body = req.body || {};
    const data = {};

    if (body.name !== undefined) {
      if (body.name !== null && typeof body.name !== 'string') {
        return res.status(400).json({ error: '`name` must be a string or null' });
      }
      const trimmed = typeof body.name === 'string' ? body.name.trim() : '';
      data.name = trimmed || null;
    }

    if (body.email !== undefined) {
      if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email.trim())) {
        return res.status(400).json({ error: 'A valid `email` is required' });
      }
      data.email = body.email.trim().toLowerCase();
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Provide `name` and/or `email` to update' });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Defense-in-depth (route also mounts requireTargetEditable): mods may
    // only mutate ordinary users — never admin/mod accounts.
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    // Enforce unique email (case-insensitive via the lowercased value above)
    if (data.email && data.email !== target.email) {
      const clash = await prisma.user.findUnique({ where: { email: data.email } });
      if (clash && clash.id !== target.id) {
        return res.status(409).json({ error: 'That email is already in use' });
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, email: true, name: true, role: true, suspended: true, createdAt: true, lastActive: true },
    });

    await logAdminAction(req, 'EDIT_USER', 'User', target.id, {
      before: { name: target.name, email: target.email },
      after: { name: updated.name, email: updated.email },
    });

    return res.json({ user: updated });
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

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { suspended },
      select: { id: true, email: true, name: true, role: true, suspended: true, createdAt: true, lastActive: true },
    });

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

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, email: true, name: true, role: true, suspended: true, createdAt: true, lastActive: true },
    });

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
// Generates a strong temp password, hashes it, returns the plaintext ONCE.
// (admin + mod). Production-preferred flow is a token-based email reset — see
// server/docs/email-setup.md.

export async function resetUserPassword(req, res) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Defense-in-depth (route also mounts requireTargetEditable): mods may
    // only mutate ordinary users — a mod resetting an admin/mod password and
    // receiving the plaintext would be a full account takeover.
    if (req.user.role === 'mod' && target.role !== 'user') {
      return res.status(403).json({ error: 'Moderators cannot modify administrator or moderator accounts' });
    }

    const tempPassword = generateTempPassword();
    const hashed = await hashPassword(tempPassword);

    await prisma.user.update({
      where: { id: req.params.id },
      data: { password: hashed },
    });

    await logAdminAction(req, 'RESET_PASSWORD', 'User', target.id, { email: target.email });

    // Return the plaintext temp password exactly once. NEVER store or return hashes.
    return res.json({ tempPassword });
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
        subject: 'Reset your META·LAB password',
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

export async function getProjects(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { userId, search, status } = req.query;

    const where = {};
    if (userId) where.userId = userId;
    if (search) where.name = { contains: search };
    if (status === 'active') where.deletedAt = null;
    else if (status === 'archived') where.deletedAt = { not: null };

    const [total, projects] = await Promise.all([
      prisma.project.count({ where }),
      prisma.project.findMany({
        where,
        select: {
          id: true,
          userId: true,
          name: true,
          data: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          deletedSource: true,
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
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
          select: { id: true, title: true, linkedMetaLabProjectId: true },
        })
      : [];
    const siftByMetaLabId = {};
    for (const sp of linkedSifts) {
      // First match wins — multiple ScreenProjects linking one META·LAB project
      // is not a supported state; display the first deterministically.
      if (!siftByMetaLabId[sp.linkedMetaLabProjectId]) siftByMetaLabId[sp.linkedMetaLabProjectId] = sp;
    }

    const formatted = projects.map(p => {
      const data = safeParseData(p.data);
      const sift = siftByMetaLabId[p.id] || null;
      return {
        id: p.id,
        userId: p.userId,
        userEmail: p.user?.email || null,
        // owner object mirrors the SIFT admin rows' shape ({id,name,email}).
        owner: { id: p.userId, name: p.user?.name || null, email: p.user?.email || null },
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
        // prompt9 (additive): lets ops distinguish admin archive (null/'admin')
        // from an owner soft delete ('owner') — both show status 'archived'.
        deletedSource: p.deletedSource || null,
        deleted: p.deletedSource === 'owner',
        status: p.deletedAt ? 'archived' : 'active',
        linkedMetaSift: sift ? { id: sift.id, title: sift.title } : null,
        workspaceId: sift ? sift.id : null,
        studyCount: Array.isArray(data.studies) ? data.studies.length : 0,
        recordCount: Array.isArray(data.records) ? data.records.length : 0,
      };
    });

    return res.json({ projects: formatted, total });
  } catch (err) {
    console.error('[admin] getProjects error:', err.message);
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
    if (!row) return res.json({});
    try {
      return res.json(JSON.parse(row.value));
    } catch {
      return res.json(row.value);
    }
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

// ── GET /api/admin/audit-log ──────────────────────────────────────────────────

export async function getAuditLog(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { adminId } = req.query;

    const where = adminId ? { adminId } : {};

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
    const { type } = req.query;

    const where = type ? { type } : {};

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
        { name: { contains: search } },
        { email: { contains: search } },
        { subject: { contains: search } },
        { message: { contains: search } },
      ];
    }

    // Per-staff inbox boxes (prompt5 Task 9): unread/read are computed against THIS
    // user's read receipts, not the legacy global `read` flag.
    if (box === 'unread' || box === 'read') {
      const myReads = await prisma.contactMessageRead.findMany({ where: { userId: me }, select: { messageId: true } });
      const readIds = myReads.map(r => r.messageId);
      where.archived = false;
      where.id = box === 'unread' ? { notIn: readIds } : { in: readIds };
    } else if (box === 'archived') {
      where.archived = true;
    }

    const orderBy = sort === 'oldest' ? { createdAt: 'asc' } : { createdAt: 'desc' };

    const [total, messages] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: { reads: { where: { userId: me }, select: { id: true } } },
      }),
    ]);

    // Annotate each message with this user's read state (per-staff).
    const shaped = messages.map(({ reads, ...m }) => ({ ...m, readByMe: (reads?.length || 0) > 0 }));

    return res.json({ messages: shaped, total });
  } catch (err) {
    console.error('[admin] getContactMessages error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/contact-messages/unread-count ──────────────────────────────
// Per-staff unread badge count (prompt5 Task 9). Unread = non-archived messages
// with NO read receipt for the calling staff member. Persists across logout/login.

export async function getUnreadMessageCount(req, res) {
  try {
    const me = req.user.id;
    const [activeTotal, myReadActive] = await Promise.all([
      prisma.contactMessage.count({ where: { archived: false } }),
      prisma.contactMessageRead.count({ where: { userId: me, message: { archived: false } } }),
    ]);
    const unread = Math.max(0, activeTotal - myReadActive);
    return res.json({ unread });
  } catch (err) {
    console.error('[admin] getUnreadMessageCount error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── POST /api/admin/contact-messages/:id/mark-read ────────────────────────────
// Mark a message read for THIS staff member (idempotent upsert of a read receipt).
// Body { read: false } removes the receipt (mark-as-unread for this user).

export async function markMessageRead(req, res) {
  try {
    const me = req.user.id;
    const wantRead = req.body?.read !== false; // default true
    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    if (wantRead) {
      // Per-staff only — do NOT touch the global `read` flag (that would drop the
      // unread count for other staff). Read state lives entirely in receipts.
      await prisma.contactMessageRead.upsert({
        where: { messageId_userId: { messageId: msg.id, userId: me } },
        update: { readAt: new Date() },
        create: { messageId: msg.id, userId: me },
      });
    } else {
      await prisma.contactMessageRead.deleteMany({ where: { messageId: msg.id, userId: me } });
    }

    // Return the caller's fresh unread count so the badge can update immediately.
    const [activeTotal, myReadActive] = await Promise.all([
      prisma.contactMessage.count({ where: { archived: false } }),
      prisma.contactMessageRead.count({ where: { userId: me, message: { archived: false } } }),
    ]);
    return res.json({ ok: true, read: wantRead, unread: Math.max(0, activeTotal - myReadActive) });
  } catch (err) {
    console.error('[admin] markMessageRead error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PATCH /api/admin/contact-messages/:id ────────────────────────────────────

export async function updateContactMessage(req, res) {
  try {
    const { read, archived } = req.body || {};
    const data = {};
    if (typeof read === 'boolean') data.read = read;
    if (typeof archived === 'boolean') data.archived = archived;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Provide `read` or `archived` (boolean)' });
    }

    const msg = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const updated = await prisma.contactMessage.update({
      where: { id: req.params.id },
      data,
    });

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

    const { html, text } = renderReplyEmail({
      appName: 'META·LAB',
      toName: msg.name || '',
      bodyText: body,
      originalSubject: msg.subject || '',
    });

    // sendEmail never throws — { sent:false, reason } when not configured / on failure.
    // (It also records the EMAIL_SENT/EMAIL_FAILED usage metric itself, prompt9.)
    const result = await sendEmail({ to: msg.email, subject: finalSubject, html, text, context: 'contact_reply' });
    const sent = result.sent === true;

    const reply = await prisma.contactReply.create({
      data: {
        messageId: msg.id,
        repliedById: req.user.id,
        repliedByName: req.user.email || '',
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
    ? ['overview', 'users', 'projects', 'sift', 'content', 'settings', 'flags', 'messages', 'security', 'health']
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
