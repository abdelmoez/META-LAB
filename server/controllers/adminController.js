import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

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

    const [
      totalUsers, todayUsers, weekUsers, monthUsers, suspendedUsers, adminUsers,
      totalProjects, todayProjects, weekProjects, monthProjects,
      totalMessages, unreadMessages,
      failedLogins7d,
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
      prisma.contactMessage.count({ where: { read: false } }),
      prisma.securityEvent.count({ where: { type: 'FAILED_LOGIN', createdAt: { gte: sevenDaysAgo } } }),
      prisma.project.findMany({ select: { data: true } }),
    ]);

    let studies = 0;
    let records = 0;
    for (const project of allProjects) {
      const data = safeParseData(project.data);
      studies += Array.isArray(data.studies) ? data.studies.length : 0;
      records += Array.isArray(data.records) ? data.records.length : 0;
    }

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
      db: dbStatus,
    });
  } catch (err) {
    console.error('[admin] getMetrics error:', err.message);
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

// ── PATCH /api/admin/users/:id/status ────────────────────────────────────────

export async function updateUserStatus(req, res) {
  try {
    const { suspended } = req.body || {};
    if (typeof suspended !== 'boolean') {
      return res.status(400).json({ error: '`suspended` (boolean) is required' });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Cannot suspend admins
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

// ── GET /api/admin/projects ───────────────────────────────────────────────────

export async function getProjects(req, res) {
  try {
    const { page, limit, skip } = parsePage(req.query);
    const { userId } = req.query;

    const where = userId ? { userId } : {};

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
          user: { select: { email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formatted = projects.map(p => {
      const data = safeParseData(p.data);
      return {
        id: p.id,
        userId: p.userId,
        userEmail: p.user?.email || null,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
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
    const { read, archived } = req.query;

    const where = {};
    if (read !== undefined) where.read = read === 'true';
    if (archived !== undefined) where.archived = archived === 'true';

    const [total, messages] = await Promise.all([
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return res.json({ messages, total });
  } catch (err) {
    console.error('[admin] getContactMessages error:', err.message);
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

// ── PATCH /api/admin/projects/:id/archive ────────────────────────────────────

export async function archiveProject(req, res) {
  try {
    const { id } = req.params;
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, name: true, deletedAt: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.deletedAt) return res.status(400).json({ error: 'Project already archived' });
    await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
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
    await prisma.project.update({ where: { id }, data: { deletedAt: null } });
    await logAdminAction(req, 'RESTORE_PROJECT', 'Project', id, { name: project.name });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] restoreProject error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/health ─────────────────────────────────────────────────────

export async function getHealth(req, res) {
  let dbStatus = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'error';
  }

  return res.json({
    status: 'ok',
    db: dbStatus,
    env: process.env.NODE_ENV || 'development',
    version: '2.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
}
