/**
 * screeningAiController.js — member-facing HTTP layer for the AI screening engine
 * (feature flag: `aiScreening`). Mounted inside the screening router, so every
 * route already has `requireAuth`. Each handler additionally enforces:
 *   1. the `aiScreening` feature flag (404 when off — existence-hiding),
 *   2. project access via getProjectAccess (404 when no access),
 *   3. a capability check appropriate to the action.
 *
 * Governance: running scoring is leader-gated by default (reviewers only when the
 * admin enables allowReviewersToRun); changing project AI policy requires
 * settings management. The AI never finalises decisions — there is no such route.
 */
import { getProjectAccess } from '../screening/access.js';
import { emitToProjectMembers } from '../realtime/bus.js';
import { prisma } from '../db/client.js';
import {
  aiFlagEnabled, getGlobalAiSettings, getProjectAiSettings,
  getScoresMap, getRecordExplanation, getStatus, getValidation, recordFeedback,
  rollbackToRun, listModelVersions,
  createValidationSample, getValidationSampleStatus,
} from '../services/screeningAiService.js';
import { getJobStatus, enqueueManualRun, enqueueCitationEnrichment } from '../services/screeningAiJobs.js';
import { getCitationStatus } from '../services/citationEnrichmentService.js';
// 67.md — product-tier enforcement (admins/mods bypass inside the service).
import { requireEntitlement, sendTierLimit } from '../services/entitlementService.js';

/** Shared gate: flag → access. Returns access or null (response already sent). */
async function gate(req, res) {
  if (!(await aiFlagEnabled(req.user))) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await getProjectAccess(req.params.pid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}

function canRunAi(access, global) {
  return access.isLeader || (global.allowReviewersToRun && access.canScreen);
}

const STAGES = new Set(['title_abstract', 'full_text']);
function stageOf(req) {
  const s = String(req.query.stage || req.body?.stage || 'title_abstract');
  return STAGES.has(s) ? s : 'title_abstract';
}

/** GET /projects/:pid/ai/status */
export async function getAiStatus(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const stage = stageOf(req);
    const status = await getStatus(req.params.pid, stage);
    const global = await getGlobalAiSettings();
    res.json({ ...status, canRun: canRunAi(access, global), canConfigure: access.isLeader || access.canManageSettings, stage });
  } catch (e) {
    console.error('getAiStatus', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/ai/run — start a scoring run.
 *
 * 62.md: scoring is CPU-heavy and used to run inline (`await runScoring`), blocking the
 * single Node event loop for the whole run (≈tens of seconds at 5k records) and 504-ing
 * on large projects. It now ENQUEUES a durable job and returns 202 + jobId immediately;
 * the in-process worker runs the compute in a worker_thread, writes progress to the job
 * row, and emits `ai.updated` on completion. The client polls GET …/ai/job-status.
 */
export async function postAiRun(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const global = await getGlobalAiSettings();
    if (!global.enabled) return res.status(403).json({ error: 'AI screening is disabled by the administrator' });
    if (!canRunAi(access, global)) return res.status(403).json({ error: 'You do not have permission to run AI scoring' });
    // 67.md — product tier AND project permission must both pass.
    try { await requireEntitlement(req.user, 'screening.aiScoring'); }
    catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const stage = stageOf(req);
    const job = await enqueueManualRun(req.params.pid, { stage, actor: req.user });
    res.status(202).json({ ok: true, jobId: job.id, status: job.status, stage });
  } catch (e) {
    console.error('postAiRun', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to start scoring' });
  }
}

/** GET /projects/:pid/ai/job-status — live rescoring state (se2.md §6) */
export async function getAiJobStatus(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    res.json(await getJobStatus(req.params.pid, stageOf(req)));
  } catch (e) {
    console.error('getAiJobStatus', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/ai/scores */
export async function getAiScores(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const stage = stageOf(req);
    const global = await getGlobalAiSettings();
    const project = await prisma.screenProject.findUnique({ where: { id: req.params.pid } });
    const aiProject = getProjectAiSettings(project, global);
    const enabled = global.enabled && aiProject.enabled;

    // 58.md §8 — AI scores are statistically meaningful only after enough human
    // decisions, so they are HIDDEN until the project has >= threshold (default 50)
    // screened records. The gate is SERVER-SIDE: below threshold we withhold the
    // scores entirely (not just hide them client-side). An ADMIN may bypass for
    // testing with ?showBelowThreshold=1 — request-level, never persisted, and
    // surfaced as overrideApplied so the UI can flag it.
    const threshold = Math.max(1, Number(aiProject.minScreenedDecisions ?? global.minScreenedDecisions ?? 50) || 50);
    const decided = await prisma.screenDecision.findMany({
      where: { projectId: req.params.pid, stage: 'title_abstract', decision: { not: 'undecided' } },
      select: { recordId: true }, distinct: ['recordId'],
    });
    const screenedCount = decided.length;
    const isAdmin = req.user?.role === 'admin';
    const overrideRequested = isAdmin && (req.query.showBelowThreshold === '1' || req.query.showBelowThreshold === 'true');
    const belowThreshold = screenedCount < threshold;
    // 86.md P2.93 — enforce blindFromAi SERVER-SIDE. It was reported in the payload
    // but not applied here, so a blinded reviewer could fetch the full score map
    // directly (defeating the point of blinding the AI from human screeners).
    // Leaders are exempt (mirrors listRecords/blindMode); admins keep their testing
    // override. Withhold the scores, don't just flag them.
    const blindWithheld = enabled && aiProject.blindFromAi && !access.isLeader && !overrideRequested;
    const scoresHidden = (enabled && belowThreshold && !overrideRequested) || blindWithheld;

    const scores = scoresHidden ? {} : await getScoresMap(req.params.pid, stage);
    res.json({
      scores, stage, blindFromAi: aiProject.blindFromAi, blindWithheld, policy: aiProject.policy, enabled,
      threshold, screenedCount, belowThreshold, scoresHidden,
      overrideApplied: overrideRequested && belowThreshold,
      canOverride: isAdmin, // UI shows the admin testing-override control only when true
    });
  } catch (e) {
    console.error('getAiScores', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/records/:rid/ai/explanation */
export async function getAiExplanation(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const stage = stageOf(req);
    // 86.md P2.93 — a per-record AI explanation reveals the AI's signal for that
    // record, so it must honour blindFromAi for non-leaders exactly like the score map.
    const global = await getGlobalAiSettings();
    const project = await prisma.screenProject.findUnique({ where: { id: req.params.pid } });
    const aiProject = getProjectAiSettings(project, global);
    if (global.enabled && aiProject.enabled && aiProject.blindFromAi && !access.isLeader) {
      return res.status(404).json({ error: 'No AI score yet for this record' });
    }
    const expl = await getRecordExplanation(req.params.pid, req.params.rid, stage);
    if (!expl) return res.status(404).json({ error: 'No AI score yet for this record' });
    res.json(expl);
  } catch (e) {
    console.error('getAiExplanation', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/records/:rid/ai/feedback */
export async function postAiFeedback(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.canScreen && !access.isLeader) return res.status(403).json({ error: 'Screening is not permitted' });
    const stage = stageOf(req);
    const fb = await recordFeedback({ projectId: req.params.pid, recordId: req.params.rid, stage, actor: req.user, body: req.body || {} });
    res.json({ ok: true, id: fb.id });
  } catch (e) {
    console.error('postAiFeedback', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/ai/validation (leader-only — project-level quality) */
export async function getAiValidation(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.isLeader) return res.status(403).json({ error: 'Validation metrics are leader-only' });
    try { await requireEntitlement(req.user, 'screening.validationMetrics'); }
    catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const stage = stageOf(req);
    const val = await getValidation(req.params.pid, stage);
    if (!val) return res.status(404).json({ error: 'No completed AI run yet' });
    res.json(val);
  } catch (e) {
    console.error('getAiValidation', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /projects/:pid/ai/versions — model version history (leader-only; se2.md §11). */
export async function getAiModelVersions(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.isLeader && !access.canManageSettings) return res.status(403).json({ error: 'Model history is not permitted' });
    const versions = await listModelVersions(req.params.pid, stageOf(req));
    res.json({ versions });
  } catch (e) {
    console.error('getAiModelVersions', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** POST /projects/:pid/ai/rollback — revert to a prior model version (leader/settings). */
export async function postAiRollback(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.isLeader && !access.canManageSettings) return res.status(403).json({ error: 'Rolling back models is not permitted' });
    const global = await getGlobalAiSettings();
    if (!global.enabled) return res.status(403).json({ error: 'AI screening is disabled by the administrator' });
    const runId = String(req.body?.runId || '');
    if (!runId) return res.status(400).json({ error: 'runId is required' });
    const out = await rollbackToRun({ projectId: req.params.pid, runId, actor: req.user, stage: stageOf(req) });
    emitToProjectMembers(req.params.pid, { type: 'ai.updated' });
    res.json({ ok: true, run: { id: out.run.id, mode: out.run.mode, nScored: out.scoredCount, rolledBackFrom: out.rolledBackFrom } });
  } catch (e) {
    console.error('postAiRollback', e);
    res.status(e.status || 500).json({ error: e.message || 'Rollback failed' });
  }
}

/** GET /projects/:pid/ai/citation-status — enrichment coverage (66.md P4.3). */
export async function getAiCitationStatus(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    res.json(await getCitationStatus(req.params.pid));
  } catch (e) {
    console.error('getAiCitationStatus', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/ai/citation-enrichment — start a citation-metadata fetch
 * job (202). Leader-gated like scoring runs; only public identifiers (DOI/PMID)
 * are sent to the provider.
 */
export async function postAiCitationEnrichment(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const global = await getGlobalAiSettings();
    if (!global.enabled) return res.status(403).json({ error: 'AI screening is disabled by the administrator' });
    if (!canRunAi(access, global)) return res.status(403).json({ error: 'You do not have permission to run citation enrichment' });
    try { await requireEntitlement(req.user, 'screening.aiScoring'); }
    catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const job = await enqueueCitationEnrichment(req.params.pid, { stage: stageOf(req), actor: req.user });
    res.status(202).json({ ok: true, jobId: job.id, status: job.status });
  } catch (e) {
    console.error('postAiCitationEnrichment', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to start citation enrichment' });
  }
}

/** GET /projects/:pid/ai/validation-sample — latest seed sample + progress (P4.6). */
export async function getAiValidationSample(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    res.json(await getValidationSampleStatus(req.params.pid, stageOf(req)));
  } catch (e) {
    console.error('getAiValidationSample', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /projects/:pid/ai/validation-sample — generate a seeded random validation
 * sample (leader/settings only; sampling method + seed are persisted).
 */
export async function postAiValidationSample(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.isLeader && !access.canManageSettings) return res.status(403).json({ error: 'Creating validation samples is leader-only' });
    const out = await createValidationSample({
      projectId: req.params.pid,
      stage: stageOf(req),
      size: req.body?.size,
      seed: req.body?.seed,
      actor: req.user,
    });
    res.json(out);
  } catch (e) {
    console.error('postAiValidationSample', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to create validation sample' });
  }
}

/** PUT /projects/:pid/ai/settings (leader / canManageSettings) */
export async function putAiSettings(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!access.isLeader && !access.canManageSettings) return res.status(403).json({ error: 'Managing AI settings is not permitted' });
    const body = req.body || {};
    const project = await prisma.screenProject.findUnique({ where: { id: req.params.pid } });
    const current = getProjectAiSettings(project, await getGlobalAiSettings());
    const next = { ...current };
    if (typeof body.enabled === 'boolean') next.enabled = body.enabled;
    if (typeof body.blindFromAi === 'boolean') next.blindFromAi = body.blindFromAi;
    if (['assist', 'prioritize', 'auto_after_human'].includes(body.policy)) next.policy = body.policy;
    if (typeof body.includeThreshold === 'number') next.includeThreshold = Math.min(1, Math.max(0, body.includeThreshold));
    if (typeof body.excludeThreshold === 'number') next.excludeThreshold = Math.min(1, Math.max(0, body.excludeThreshold));

    await prisma.screenProject.update({ where: { id: req.params.pid }, data: { aiSettings: JSON.stringify(next) } });
    const { writeAudit } = await import('../screening/access.js');
    writeAudit(req.params.pid, req.user, 'AI_SETTINGS_UPDATED', { entityType: 'ScreenProject', entityId: req.params.pid, details: next });
    emitToProjectMembers(req.params.pid, { type: 'ai.updated' });
    res.json({ ok: true, settings: next });
  } catch (e) {
    console.error('putAiSettings', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}
