/**
 * screeningAdminController.js
 * Admin-only endpoints for META·SIFT Beta management.
 * All handlers require admin role (enforced at router mount).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SETTINGS_KEY = 'metaSiftSettings';

const DEFAULT_SETTINGS = {
  enabled: true,
  badgeText: 'BETA',
  allowNewProjects: true,
  allowImport: true,
  allowExport: true,
  allowDuplicateDetection: true,
  allowConflictResolution: true,
  maxRecordsPerProject: 10000,
  maintenanceMessage: 'META·SIFT Beta is currently undergoing maintenance. Please try again later.',
};

async function getSettings() {
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// GET /api/admin/screening/settings
export async function getScreeningSettings(req, res) {
  try {
    res.json(await getSettings());
  } catch (err) {
    console.error('[admin/screening] getSettings:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /api/admin/screening/settings
export async function updateScreeningSettings(req, res) {
  try {
    const current = await getSettings();
    const updated = { ...current, ...req.body };
    await prisma.siteSetting.upsert({
      where:  { key: SETTINGS_KEY },
      update: { value: JSON.stringify(updated), updatedBy: req.user?.id },
      create: { key: SETTINGS_KEY, value: JSON.stringify(updated), updatedBy: req.user?.id },
    });
    res.json(updated);
  } catch (err) {
    console.error('[admin/screening] updateSettings:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/admin/screening/metrics
export async function getScreeningMetrics(req, res) {
  try {
    const [
      totalProjects,
      totalRecords,
      totalDecisions,
      includedCount,
      excludedCount,
      maybeCount,
      totalConflicts,
      totalDuplicateGroups,
      projectsThisWeek,
      projectsThisMonth,
    ] = await Promise.all([
      prisma.screenProject.count(),
      prisma.screenRecord.count(),
      prisma.screenDecision.count(),
      prisma.screenDecision.count({ where: { decision: 'include' } }),
      prisma.screenDecision.count({ where: { decision: 'exclude' } }),
      prisma.screenDecision.count({ where: { decision: 'maybe' } }),
      prisma.screenConflict.count({ where: { resolvedAt: null } }),
      prisma.screenDuplicateGroup.count(),
      prisma.screenProject.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      prisma.screenProject.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    res.json({
      totalProjects,
      totalRecords,
      totalDecisions,
      screened: includedCount + excludedCount + maybeCount,
      included: includedCount,
      excluded: excludedCount,
      maybe: maybeCount,
      undecided: Math.max(0, totalRecords - includedCount - excludedCount - maybeCount),
      totalConflicts,
      totalDuplicateGroups,
      projectsThisWeek,
      projectsThisMonth,
    });
  } catch (err) {
    console.error('[admin/screening] getMetrics:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/admin/screening/projects
export async function listScreeningProjects(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit || '25', 10)));

    const [projects, total] = await Promise.all([
      prisma.screenProject.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { records: true, decisions: true } },
        },
      }),
      prisma.screenProject.count(),
    ]);

    res.json({
      projects: projects.map(p => ({
        id:          p.id,
        title:       p.title,
        stage:       p.stage,
        blindMode:   p.blindMode,
        owner:       p.owner,
        recordCount: p._count.records,
        decisionCount: p._count.decisions,
        createdAt:   p.createdAt,
        updatedAt:   p.updatedAt,
      })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[admin/screening] listProjects:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/admin/screening/projects/:id
export async function getScreeningProject(req, res) {
  try {
    const project = await prisma.screenProject.findUnique({
      where: { id: req.params.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { records: true, decisions: true, conflicts: true } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (err) {
    console.error('[admin/screening] getProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /api/admin/screening/projects/:id/status
export async function updateScreeningProjectStatus(req, res) {
  try {
    const { stage } = req.body || {};
    const allowed = ['active', 'archived', 'disabled'];
    if (!stage || !allowed.includes(stage)) {
      return res.status(400).json({ error: `stage must be one of: ${allowed.join(', ')}` });
    }
    const project = await prisma.screenProject.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const updated = await prisma.screenProject.update({
      where: { id: req.params.id },
      data: { stage },
    });
    res.json(updated);
  } catch (err) {
    console.error('[admin/screening] updateStatus:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
