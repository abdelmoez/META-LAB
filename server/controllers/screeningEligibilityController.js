/**
 * screeningEligibilityController.js — member-facing HTTP layer for P10 criteria-based
 * eligibility screening (feature flag: `eligibilityScreening`). Mounted inside the
 * screening router, so every route already has `requireAuth` + the maintenance guard.
 * Each handler additionally enforces:
 *   1. the `eligibilityScreening` feature flag (404 when off — existence-hiding),
 *   2. project access via getProjectAccess (404 when no access),
 *   3. a capability check appropriate to the action.
 *
 * Governance: defining criteria / policy is owner-leader-gated; running bulk evaluation is
 * leader-gated; adjudication needs screening permission; validation metrics are leader-only.
 * The engine never finalises a human decision — governed auto-apply lives in the service and
 * can never overwrite a human ScreenDecision.
 */
import { getProjectAccess } from '../screening/access.js';
import { prisma } from '../db/client.js';
import {
  eligibilityFlagEnabled, readEffectiveSettings, updateProjectSettings,
  listCriteria, replaceCriteria, currentCriteriaVersion,
  evaluateInline, enqueueEvaluation, getJobStatus,
  listAssessments, getAssessment, getSummary,
  adjudicate, undoAutoApply, getValidation, validationToCsv,
} from '../services/screeningEligibilityService.js';

const STAGES = new Set(['title_abstract', 'full_text']);
function stageOf(req) {
  const s = String(req.query.stage || req.body?.stage || 'title_abstract');
  return STAGES.has(s) ? s : 'title_abstract';
}

/** Shared gate for /projects/:pid routes: flag → access. */
async function gate(req, res) {
  if (!(await eligibilityFlagEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await getProjectAccess(req.params.pid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}

/** Shared gate for /records/:rid routes: flag → record → access. */
async function recordGate(req, res) {
  if (!(await eligibilityFlagEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const record = await prisma.screenRecord.findUnique({ where: { id: req.params.rid } });
  if (!record) { res.status(404).json({ error: 'Record not found' }); return null; }
  const access = await getProjectAccess(record.projectId, req.user);
  if (!access) { res.status(404).json({ error: 'Record not found' }); return null; }
  return { access, record };
}

function canManage(access) { return access.isLeader || access.canManageSettings; }

/** GET /projects/:pid/eligibility */
export async function getEligibility(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const [{ criteria, criteriaVersion }, { global, project }, summary] = await Promise.all([
      listCriteria(req.params.pid),
      readEffectiveSettings(req.params.pid),
      getSummary(req.params.pid),
    ]);
    res.json({
      criteria, criteriaVersion, summary,
      settings: {
        project,
        global: {
          enabled: global.enabled, killSwitch: global.killSwitch, defaultPolicy: global.defaultPolicy,
          includeConfidence: global.includeConfidence, excludeConfidence: global.excludeConfidence,
        },
        canManage: canManage(access),
      },
    });
  } catch (e) {
    console.error('getEligibility', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /projects/:pid/eligibility/criteria (owner/leader) */
export async function putCriteria(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Managing eligibility criteria is not permitted' });
    const out = await replaceCriteria({ projectId: req.params.pid, criteria: req.body?.criteria, actor: req.user });
    res.json({ ok: true, ...out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('putCriteria', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/eligibility/evaluate (leader) — body { scope:'all'|'undecided'|{recordIds},
 * autoApply? }. A small scope runs inline (200 with assessments); a large one enqueues a durable
 * job and returns 202 { jobId }.
 */
export async function postEvaluate(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Running eligibility evaluation is not permitted' });
    const stage = stageOf(req);
    const body = req.body || {};
    let scope = body.scope ?? 'undecided';
    if (scope && typeof scope === 'object' && !Array.isArray(scope.recordIds)) scope = 'undecided';
    if (Array.isArray(body.recordIds)) scope = { recordIds: body.recordIds };
    const autoApply = body.autoApply !== false; // default true (still gated by policy)

    // Resolve how many records the scope touches to decide inline vs. queued.
    const { global } = await readEffectiveSettings(req.params.pid);
    const inlineMax = Number.isFinite(global.inlineMaxRecords) ? global.inlineMaxRecords : 25;
    const count = await scopeCount(req.params.pid, scope, stage);

    if (count <= inlineMax) {
      const out = await evaluateInline({ projectId: req.params.pid, scope, stage, actor: req.user });
      return res.json({ ok: true, mode: 'inline', stage, ...out });
    }
    const job = await enqueueEvaluation({ projectId: req.params.pid, scope, stage, autoApply, actor: req.user });
    return res.status(202).json({ ok: true, mode: 'queued', jobId: job.id, status: job.status, stage });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    console.error('postEvaluate', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** Count records a scope touches (cheap — ids only). */
async function scopeCount(projectId, scope, stage) {
  if (scope && typeof scope === 'object' && Array.isArray(scope.recordIds)) {
    const rows = await prisma.screenRecord.findMany({ where: { projectId, id: { in: scope.recordIds.map(String) } }, select: { id: true } });
    return rows.length;
  }
  if (scope === 'undecided') {
    const [all, settled] = await Promise.all([
      prisma.screenRecord.count({ where: { projectId } }),
      prisma.screenDecision.findMany({
        where: { projectId, stage, decision: { in: ['include', 'exclude'] }, reviewerId: { not: 'eligibility-engine' } },
        select: { recordId: true }, distinct: ['recordId'],
      }),
    ]);
    return Math.max(0, all - settled.length);
  }
  return prisma.screenRecord.count({ where: { projectId } });
}

/** GET /projects/:pid/eligibility/job-status */
export async function getEligibilityJobStatus(req, res) {
  const access = await gate(req, res); if (!access) return;
  try { res.json(await getJobStatus(req.params.pid, stageOf(req))); }
  catch (e) { console.error('getEligibilityJobStatus', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /projects/:pid/eligibility/assessments (paginated) */
export async function getAssessments(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const take = Number(req.query.take) || 50;
    const skip = Number(req.query.skip) || 0;
    res.json(await listAssessments(req.params.pid, { skip, take }));
  } catch (e) {
    console.error('getAssessments', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /records/:rid/eligibility */
export async function getRecordEligibility(req, res) {
  const g = await recordGate(req, res); if (!g) return;
  try {
    const assessment = await getAssessment(g.record.projectId, g.record.id);
    if (!assessment) return res.status(404).json({ error: 'No eligibility assessment for this record yet' });
    res.json({ assessment });
  } catch (e) {
    console.error('getRecordEligibility', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /records/:rid/eligibility/adjudicate (screening permission) */
export async function putAdjudicate(req, res) {
  const g = await recordGate(req, res); if (!g) return;
  try {
    if (!g.access.canScreen && !g.access.isLeader) return res.status(403).json({ error: 'You do not have permission to screen in this project' });
    const decision = String(req.body?.decision || '');
    const out = await adjudicate({
      projectId: g.record.projectId, recordId: g.record.id, decision,
      reason: req.body?.reason || '', actor: req.user, stage: stageOf(req), force: req.body?.force === true,
    });
    res.json({ ok: true, assessment: out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code, details: e.details });
    console.error('putAdjudicate', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /records/:rid/eligibility/undo (owner/leader) — reverse a governed auto-apply. */
export async function putUndoAutoApply(req, res) {
  const g = await recordGate(req, res); if (!g) return;
  try {
    if (!canManage(g.access)) return res.status(403).json({ error: 'Undoing auto-applied decisions is not permitted' });
    const out = await undoAutoApply({ projectId: g.record.projectId, recordId: g.record.id, actor: req.user, stage: stageOf(req) });
    res.json({ ok: true, assessment: out });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('putUndoAutoApply', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/eligibility/validation (leader-only) + ?format=csv */
export async function getEligibilityValidation(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.isLeader) return res.status(403).json({ error: 'Validation metrics are leader-only' });
    const validation = await getValidation(req.params.pid, stageOf(req));
    if (!validation) return res.status(404).json({ error: 'Validation is unavailable (no completed evaluation yet)' });
    if (String(req.query.format || '').toLowerCase() === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="eligibility-validation-${req.params.pid}.csv"`);
      return res.send(validationToCsv(validation));
    }
    res.json(validation);
  } catch (e) {
    console.error('getEligibilityValidation', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /projects/:pid/eligibility/settings (owner/leader) — per-project auto-apply policy. */
export async function putEligibilitySettings(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Managing eligibility settings is not permitted' });
    const next = await updateProjectSettings({ projectId: req.params.pid, patch: req.body || {}, actor: req.user });
    res.json({ ok: true, settings: next });
  } catch (e) {
    console.error('putEligibilitySettings', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
