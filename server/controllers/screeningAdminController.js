/**
 * screeningAdminController.js
 * Admin-only endpoints for META·SIFT Beta management.
 * All handlers require admin role (enforced at router mount via requireAuth + requireAdmin).
 *
 * Defaults + settings key are sourced from the single source of truth in
 * server/screening/settings.js — do NOT re-declare them here.
 */
import { prisma } from '../db/client.js';
import { META_SIFT_DEFAULTS, SETTINGS_KEY } from '../screening/settings.js';

/* ─── settings helpers ─────────────────────────────────────────────────── */

async function getSettings() {
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return { ...META_SIFT_DEFAULTS };
  try {
    return { ...META_SIFT_DEFAULTS, ...JSON.parse(row.value || '{}') };
  } catch {
    return { ...META_SIFT_DEFAULTS };
  }
}

/** Coerce/validate an incoming settings patch against the known schema. */
function coerceSettings(patch = {}) {
  const out = {};

  const boolKeys = [
    'enabled', 'allowNewProjects', 'allowImport', 'allowExport',
    'allowPdfUpload', 'allowDuplicateDetection', 'allowConflictResolution',
    'allowChat', 'allowSecondReview', 'requireTwoReviewers', 'defaultBlindMode',
  ];
  for (const k of boolKeys) {
    if (k in patch) out[k] = !!patch[k];
  }

  if ('badgeText' in patch) out.badgeText = String(patch.badgeText ?? '').slice(0, 32);
  if ('maintenanceMessage' in patch) out.maintenanceMessage = String(patch.maintenanceMessage ?? '').slice(0, 2000);

  // Numeric, clamped/validated fields.
  const intIn = (v, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  if ('minIncludeQuorum' in patch) {
    out.minIncludeQuorum = Math.max(1, intIn(patch.minIncludeQuorum, META_SIFT_DEFAULTS.minIncludeQuorum));
  }
  if ('maxPdfSizeMb' in patch) {
    const n = intIn(patch.maxPdfSizeMb, META_SIFT_DEFAULTS.maxPdfSizeMb);
    out.maxPdfSizeMb = Math.min(200, Math.max(1, n));
  }
  if ('maxRecordsPerProject' in patch) {
    const n = intIn(patch.maxRecordsPerProject, META_SIFT_DEFAULTS.maxRecordsPerProject);
    out.maxRecordsPerProject = Math.max(1, n);
  }

  return out;
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
    const patch = coerceSettings(req.body || {});
    const updated = { ...current, ...patch };
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

/* ─── metrics ──────────────────────────────────────────────────────────── */

// GET /api/admin/screening/metrics
export async function getScreeningMetrics(req, res) {
  try {
    const [
      totalProjects,
      activeProjects,
      archivedProjects,
      disabledProjects,
      doneProjects,
      inProgressProjects,
      totalRecords,
      totalDecisions,
      includedCount,
      excludedCount,
      maybeCount,
      totalConflicts,
      resolvedConflicts,
      totalDuplicateGroups,
      resolvedDuplicateGroups,
      totalMembers,
      activeMembers,
      totalPdfs,
      eligibleSecondReview,
      acceptedToExtraction,
      handoffSent,
      rejectedSecond,
      totalChatMessages,
      projectsThisWeek,
      projectsThisMonth,
    ] = await Promise.all([
      prisma.screenProject.count(),
      prisma.screenProject.count({ where: { archived: false, disabled: false } }),
      prisma.screenProject.count({ where: { archived: true } }),
      prisma.screenProject.count({ where: { disabled: true } }),
      prisma.screenProject.count({ where: { progressStatus: 'done' } }),
      prisma.screenProject.count({ where: { progressStatus: 'in_progress' } }),
      prisma.screenRecord.count(),
      prisma.screenDecision.count(),
      prisma.screenDecision.count({ where: { decision: 'include' } }),
      prisma.screenDecision.count({ where: { decision: 'exclude' } }),
      prisma.screenDecision.count({ where: { decision: 'maybe' } }),
      prisma.screenConflict.count({ where: { resolvedAt: null } }),
      prisma.screenConflict.count({ where: { resolvedAt: { not: null } } }),
      prisma.screenDuplicateGroup.count(),
      prisma.screenDuplicateGroup.count({ where: { resolvedAt: { not: null } } }),
      prisma.screenProjectMember.count(),
      prisma.screenProjectMember.count({ where: { status: 'active' } }),
      prisma.screenPdfAttachment.count(),
      prisma.screenRecord.count({ where: { currentStage: 'full_text' } }),
      prisma.screenRecord.count({ where: { finalStatus: 'accepted' } }),
      prisma.screenRecord.count({ where: { handoffStatus: 'sent' } }),
      prisma.screenRecord.count({ where: { finalStatus: 'rejected' } }),
      prisma.screenChatMessage.count({ where: { deletedAt: null } }),
      prisma.screenProject.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      prisma.screenProject.count({
        where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      }),
    ]);

    // "screened" = records that have at least one non-undecided decision.
    let screenedRecords;
    try {
      const groups = await prisma.screenDecision.groupBy({
        by: ['recordId'],
        where: { decision: { not: 'undecided' } },
      });
      screenedRecords = groups.length;
    } catch {
      screenedRecords = includedCount + excludedCount + maybeCount;
    }

    // sentToExtraction: handoffStatus='sent' OR finalStatus='accepted'
    const sentToExtraction = await prisma.screenRecord.count({
      where: { OR: [{ handoffStatus: 'sent' }, { finalStatus: 'accepted' }] },
    });

    res.json({
      // project lifecycle
      totalProjects,
      activeProjects,
      archivedProjects,
      disabledProjects,
      doneProjects,
      inProgressProjects,
      // records + decisions
      totalRecords,
      totalDecisions,
      screened: screenedRecords,
      included: includedCount,
      excluded: excludedCount,
      maybe: maybeCount,
      undecided: Math.max(0, totalRecords - screenedRecords),
      // conflicts + duplicates
      totalConflicts,
      totalDisputes: totalConflicts,        // unresolved conflicts (alias)
      resolvedConflicts,
      totalDuplicateGroups,
      resolvedDuplicateGroups,
      // members
      totalMembers,
      activeMembers,
      // pdfs
      totalPdfs,
      // two-stage workflow + handoff
      eligibleSecondReview,
      acceptedToExtraction,
      handoffSent,
      sentToExtraction,
      rejectedSecond,
      // chat
      totalChatMessages,
      // growth
      projectsThisWeek,
      projectsThisMonth,
    });
  } catch (err) {
    console.error('[admin/screening] getMetrics:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── projects ─────────────────────────────────────────────────────────── */

/** Resolve linked META·LAB project titles for a set of linkedMetaLabProjectId values. */
async function resolveLinkedTitles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const rows = await prisma.project.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  const map = {};
  for (const r of rows) map[r.id] = r.name;
  return map;
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
          _count: { select: { records: true, members: true } },
        },
      }),
      prisma.screenProject.count(),
    ]);

    const linkedTitles = await resolveLinkedTitles(projects.map(p => p.linkedMetaLabProjectId));

    // Per-project counts that aren't available via _count (filtered relations
    // or relations not directly hung off ScreenProject, e.g. decisions/pdfs).
    const rows = await Promise.all(projects.map(async (p) => {
      const [decisionCount, secondReviewCount, acceptedCount, handoffSentCount, pdfCount] = await Promise.all([
        prisma.screenDecision.count({ where: { projectId: p.id } }),
        prisma.screenRecord.count({ where: { projectId: p.id, currentStage: 'full_text' } }),
        prisma.screenRecord.count({ where: { projectId: p.id, finalStatus: 'accepted' } }),
        prisma.screenRecord.count({ where: { projectId: p.id, handoffStatus: 'sent' } }),
        prisma.screenPdfAttachment.count({ where: { projectId: p.id } }),
      ]);
      return {
        id:             p.id,
        title:          p.title,
        stage:          p.stage,
        archived:       p.archived,
        disabled:       p.disabled,
        progressStatus: p.progressStatus,
        blindMode:      p.blindMode,
        owner:          p.owner,
        linkedMetaLabProjectId:    p.linkedMetaLabProjectId || null,
        linkedMetaLabProjectTitle: p.linkedMetaLabProjectId ? (linkedTitles[p.linkedMetaLabProjectId] || null) : null,
        recordCount:    p._count.records,
        decisionCount,
        memberCount:    p._count.members,
        secondReviewCount,
        acceptedCount,
        handoffSentCount,
        pdfCount,
        createdAt:      p.createdAt,
        updatedAt:      p.updatedAt,
      };
    }));

    res.json({
      projects: rows,
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
        _count: { select: { records: true, conflicts: true, members: true } },
      },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    let linkedMetaLabProjectTitle = null;
    if (project.linkedMetaLabProjectId) {
      const linked = await prisma.project.findUnique({
        where: { id: project.linkedMetaLabProjectId },
        select: { name: true },
      });
      linkedMetaLabProjectTitle = linked?.name || null;
    }

    const [decisionCount, secondReviewCount, acceptedCount, handoffSentCount, pdfCount] = await Promise.all([
      prisma.screenDecision.count({ where: { projectId: project.id } }),
      prisma.screenRecord.count({ where: { projectId: project.id, currentStage: 'full_text' } }),
      prisma.screenRecord.count({ where: { projectId: project.id, finalStatus: 'accepted' } }),
      prisma.screenRecord.count({ where: { projectId: project.id, handoffStatus: 'sent' } }),
      prisma.screenPdfAttachment.count({ where: { projectId: project.id } }),
    ]);

    res.json({
      ...project,
      linkedMetaLabProjectTitle,
      decisionCount,
      secondReviewCount,
      acceptedCount,
      handoffSentCount,
      pdfCount,
    });
  } catch (err) {
    console.error('[admin/screening] getProject:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /api/admin/screening/projects/:id/status
// Backward-compatible: accepts { stage: 'active'|'archived'|'disabled' } OR
// independent { disabled?, archived? } booleans.
export async function updateScreeningProjectStatus(req, res) {
  try {
    const body = req.body || {};
    const project = await prisma.screenProject.findUnique({ where: { id: req.params.id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const data = {};
    const hasFlag = ('disabled' in body) || ('archived' in body);

    if ('stage' in body) {
      const allowed = ['active', 'archived', 'disabled'];
      if (!allowed.includes(body.stage)) {
        return res.status(400).json({ error: `stage must be one of: ${allowed.join(', ')}` });
      }
      data.stage = body.stage;
      data.archived = body.stage === 'archived';
      data.disabled = body.stage === 'disabled';
    } else if (hasFlag) {
      if ('disabled' in body) data.disabled = !!body.disabled;
      if ('archived' in body) data.archived = !!body.archived;
    } else {
      return res.status(400).json({ error: 'Provide stage or disabled/archived' });
    }

    const updated = await prisma.screenProject.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    console.error('[admin/screening] updateStatus:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── members ──────────────────────────────────────────────────────────── */

// GET /api/admin/screening/projects/:id/members
export async function getScreeningProjectMembers(req, res) {
  try {
    const project = await prisma.screenProject.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const members = await prisma.screenProjectMember.findMany({
      where: { projectId: project.id },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    const rows = await Promise.all(members.map(async (m) => {
      // Count this member's non-undecided decisions in the project.
      let screenedCount = 0;
      if (m.userId) {
        screenedCount = await prisma.screenDecision.count({
          where: { projectId: project.id, reviewerId: m.userId, decision: { not: 'undecided' } },
        });
      }
      return {
        id:                  m.id,
        name:                m.name,
        email:               m.email,
        role:                m.role,
        status:              m.status,
        canScreen:           m.canScreen,
        canChat:             m.canChat,
        canResolveConflicts: m.canResolveConflicts,
        joinedAt:            m.joinedAt,
        screenedCount,
      };
    }));

    res.json({ projectId: project.id, title: project.title, members: rows });
  } catch (err) {
    console.error('[admin/screening] getMembers:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── handoffs ─────────────────────────────────────────────────────────── */

// GET /api/admin/screening/handoffs
export async function getHandoffLogs(req, res) {
  try {
    const records = await prisma.screenRecord.findMany({
      where: { handoffStatus: { not: '' } },
      orderBy: [{ handoffAt: 'desc' }, { acceptedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        projectId: true,
        title: true,
        handoffStatus: true,
        handoffAt: true,
        handoffError: true,
        finalStatus: true,
        acceptedAt: true,
      },
    });

    // Resolve project titles + linked META·LAB project ids.
    const projectIds = [...new Set(records.map(r => r.projectId))];
    const projects = projectIds.length
      ? await prisma.screenProject.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, title: true, linkedMetaLabProjectId: true },
        })
      : [];
    const pmap = {};
    for (const p of projects) pmap[p.id] = p;

    const handoffs = records.map(r => ({
      id:            r.id,
      projectId:     r.projectId,
      projectTitle:  pmap[r.projectId]?.title || null,
      linkedMetaLabProjectId: pmap[r.projectId]?.linkedMetaLabProjectId || null,
      recordTitle:   r.title,
      handoffStatus: r.handoffStatus,
      handoffAt:     r.handoffAt,
      handoffError:  r.handoffError || '',
      finalStatus:   r.finalStatus,
      acceptedAt:    r.acceptedAt,
    }));

    const [sent, failed, alreadyExists, pending] = await Promise.all([
      prisma.screenRecord.count({ where: { handoffStatus: 'sent' } }),
      prisma.screenRecord.count({ where: { handoffStatus: 'failed' } }),
      prisma.screenRecord.count({ where: { handoffStatus: 'already_exists' } }),
      prisma.screenRecord.count({ where: { handoffStatus: 'pending' } }),
    ]);

    res.json({
      handoffs,
      counts: { sent, failed, already_exists: alreadyExists, pending },
    });
  } catch (err) {
    console.error('[admin/screening] getHandoffs:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/* ─── audit log ────────────────────────────────────────────────────────── */

// GET /api/admin/screening/audit?projectId=...
export async function getScreeningAuditLog(req, res) {
  try {
    const where = {};
    if (req.query.projectId) where.projectId = String(req.query.projectId);

    const entries = await prisma.screenAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const projectIds = [...new Set(entries.map(e => e.projectId))];
    const projects = projectIds.length
      ? await prisma.screenProject.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, title: true },
        })
      : [];
    const pmap = {};
    for (const p of projects) pmap[p.id] = p.title;

    const rows = entries.map(e => ({
      id:           e.id,
      projectId:    e.projectId,
      projectTitle: pmap[e.projectId] || null,
      actorId:      e.actorId,
      actorName:    e.actorName,
      action:       e.action,
      entityType:   e.entityType,
      entityId:     e.entityId,
      details:      e.details,
      createdAt:    e.createdAt,
    }));

    res.json({ entries: rows, total: rows.length });
  } catch (err) {
    console.error('[admin/screening] getAuditLog:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
