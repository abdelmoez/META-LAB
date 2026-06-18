/**
 * robAdminController.js — prompt32 Task 12.
 * Ops Console controls for the Risk of Bias engine. The master kill-switch stays
 * the `rob_engine_v2` feature flag (Ops › Feature Flags); this controller manages
 * the RoB ENGINE POLICY (a single `robSettings` SiteSetting key, additive — no
 * migration) plus read-only engine metrics. Admin-only (mounted under requireAdmin).
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';

// Safe defaults. The engine works fine with none of these set (everything ON /
// permissive) so existing projects are never broken by a missing row.
export const ROB_DEFAULTS = {
  // A. Feature/UI panels
  showPdfPanel: true,
  showArticleInfoTab: true,
  defaultLeftTab: 'pdf',          // 'pdf' | 'article'
  compactAssessmentCards: false,
  // B. Tools / templates
  tools: { rob2: true, robinsI: false, quadas2: false, nos: false, custom: false },
  defaultTool: 'RoB2',
  // C. Workflow
  defaultRequiredReviewers: 1,
  allowLeaderChangeReviewers: true,
  requireConsensusBeforeComplete: false,
  allowConflictResolutionByLeader: true,
  allowOwnerOverride: true,
  requireNotesForHighOrUnclear: false,
  requireDomainJustifications: false,
  requireFinalJudgment: true,
  // D. Export
  includeInReport: true,
  includeSummaryFigure: true,
  includeDomainTable: true,
  includeReviewerNotes: true,
  allowCsvXlsxPdfExport: true,
  // E. Audit / safety
  logChanges: true,
  requireReasonWhenChangingCompleted: true,
  lockCompletedAssessments: false,
  allowReopenCompleted: true,
};

const BOOL_KEYS = [
  'showPdfPanel', 'showArticleInfoTab', 'compactAssessmentCards',
  'allowLeaderChangeReviewers', 'requireConsensusBeforeComplete', 'allowConflictResolutionByLeader',
  'allowOwnerOverride', 'requireNotesForHighOrUnclear', 'requireDomainJustifications', 'requireFinalJudgment',
  'includeInReport', 'includeSummaryFigure', 'includeDomainTable', 'includeReviewerNotes', 'allowCsvXlsxPdfExport',
  'logChanges', 'requireReasonWhenChangingCompleted', 'lockCompletedAssessments', 'allowReopenCompleted',
];

export function coerceRobSettings(body) {
  const out = { ...ROB_DEFAULTS };
  if (!body || typeof body !== 'object') return out;
  for (const k of BOOL_KEYS) if (typeof body[k] === 'boolean') out[k] = body[k];
  if (body.defaultLeftTab === 'pdf' || body.defaultLeftTab === 'article') out.defaultLeftTab = body.defaultLeftTab;
  if (typeof body.defaultTool === 'string') out.defaultTool = body.defaultTool.slice(0, 40);
  const n = Number(body.defaultRequiredReviewers);
  if (Number.isFinite(n)) out.defaultRequiredReviewers = Math.max(1, Math.min(5, Math.round(n)));
  if (body.tools && typeof body.tools === 'object') {
    out.tools = { ...ROB_DEFAULTS.tools };
    for (const t of Object.keys(ROB_DEFAULTS.tools)) if (typeof body.tools[t] === 'boolean') out.tools[t] = body.tools[t];
  }
  return out;
}

export async function readRobSettings() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'robSettings' } });
    if (!row) return { ...ROB_DEFAULTS };
    return { ...ROB_DEFAULTS, ...JSON.parse(row.value || '{}') };
  } catch {
    return { ...ROB_DEFAULTS };
  }
}

// ── GET /api/admin/rob/settings ────────────────────────────────────────────────
export async function getRobSettings(req, res) {
  try {
    const settings = await readRobSettings();
    let flagEnabled = false;
    try {
      const f = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
      flagEnabled = f ? JSON.parse(f.value || '{}').rob_engine_v2 === true : false;
    } catch { /* default false */ }
    return res.json({ settings, engineEnabled: flagEnabled });
  } catch (err) {
    console.error('[robAdmin] getRobSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── PUT /api/admin/rob/settings ────────────────────────────────────────────────
export async function updateRobSettings(req, res) {
  try {
    const settings = coerceRobSettings(req.body);
    await prisma.siteSetting.upsert({
      where: { key: 'robSettings' },
      update: { value: JSON.stringify(settings), updatedBy: req.user.id },
      create: { key: 'robSettings', value: JSON.stringify(settings), updatedBy: req.user.id },
    });
    await logAdminAction(req, 'UPDATE_SETTING', 'SiteSetting', 'robSettings', { keys: Object.keys(req.body || {}) });
    return res.json({ ok: true, settings });
  } catch (err) {
    console.error('[robAdmin] updateRobSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── GET /api/admin/rob/metrics ─────────────────────────────────────────────────
// Read-only engine metrics. Tolerates an empty/absent RoB dataset (returns zeros).
export async function getRobMetrics(req, res) {
  try {
    const live = { deletedAt: null };
    const [assessments, projectsUsing, byStatus, overalls, perStudy] = await Promise.all([
      prisma.robAssessment.count({ where: live }),
      prisma.robAssessment.findMany({ where: live, distinct: ['projectId'], select: { projectId: true } }),
      prisma.robAssessment.groupBy({ by: ['status'], where: live, _count: { _all: true } }),
      prisma.robOverall.findMany({ select: { finalOverall: true, proposedOverall: true } }),
      prisma.robAssessment.groupBy({ by: ['projectId', 'studyId'], where: live, _count: { _all: true } }),
    ]);

    const statusCounts = {};
    for (const s of byStatus) statusCounts[s.status] = s._count._all;
    const completed = (statusCounts.complete || 0) + (statusCounts.consensus || 0);
    const pending = statusCounts.draft || 0;

    const overall = { low: 0, some: 0, high: 0 };
    for (const o of overalls) {
      const j = o.finalOverall || o.proposedOverall || '';
      if (j === 'low') overall.low++;
      else if (j === 'some') overall.some++;
      else if (j === 'high') overall.high++;
    }
    // A study assessed by >1 reviewer is a potential reviewer conflict point.
    const reviewerConflicts = perStudy.filter(g => g._count._all > 1).length;

    return res.json({
      projectsUsingRoB: projectsUsing.length,
      totalAssessments: assessments,
      completedAssessments: completed,
      pendingAssessments: pending,
      overall,
      reviewerConflicts,
    });
  } catch (err) {
    // RoB tables may be empty or the engine disabled — never 500 the Ops tab.
    console.error('[robAdmin] getRobMetrics error:', err.message);
    return res.json({
      projectsUsingRoB: 0, totalAssessments: 0, completedAssessments: 0,
      pendingAssessments: 0, overall: { low: 0, some: 0, high: 0 }, reviewerConflicts: 0,
    });
  }
}
