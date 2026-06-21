/**
 * screeningAiAdminController.js — Ops/admin controls for the AI screening engine.
 * Admin-only (mounted behind requireAdmin). Reads/writes the `aiScreeningSettings`
 * SiteSetting and surfaces run logs + errors. Every mutation is audited.
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { AI_SETTINGS_KEY, AI_GLOBAL_DEFAULTS, getGlobalAiSettings } from '../services/screeningAiService.js';

const ALLOWED_PROVIDERS = new Set(['lexical', 'hashing', 'hosted']);
const ALLOWED_POLICIES = new Set(['assist', 'prioritize', 'auto_after_human']);

/** Coerce a settings patch to the known schema (defends against junk + injection). */
function coerce(patch, current) {
  const out = { ...current };
  if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
  if (ALLOWED_PROVIDERS.has(patch.embeddingProvider)) out.embeddingProvider = patch.embeddingProvider;
  if (Number.isFinite(patch.maxRecordsPerRun)) out.maxRecordsPerRun = Math.min(100000, Math.max(10, Math.round(patch.maxRecordsPerRun)));
  if (typeof patch.requireHumanFinalDecision === 'boolean') out.requireHumanFinalDecision = patch.requireHumanFinalDecision;
  if (typeof patch.allowReviewersToRun === 'boolean') out.allowReviewersToRun = patch.allowReviewersToRun;
  if (Number.isFinite(patch.includeThreshold)) out.includeThreshold = Math.min(1, Math.max(0, patch.includeThreshold));
  if (Number.isFinite(patch.excludeThreshold)) out.excludeThreshold = Math.min(1, Math.max(0, patch.excludeThreshold));
  if (ALLOWED_POLICIES.has(patch.defaultPolicy)) out.defaultPolicy = patch.defaultPolicy;
  return out;
}

/** GET /api/admin/ai-screening/settings */
export async function getAiScreeningSettings(req, res) {
  try {
    const settings = await getGlobalAiSettings();
    res.json({ settings, defaults: AI_GLOBAL_DEFAULTS });
  } catch (e) {
    console.error('getAiScreeningSettings', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/admin/ai-screening/settings */
export async function updateAiScreeningSettings(req, res) {
  try {
    const current = await getGlobalAiSettings();
    const next = coerce(req.body || {}, current);
    await prisma.siteSetting.upsert({
      where: { key: AI_SETTINGS_KEY },
      create: { key: AI_SETTINGS_KEY, value: JSON.stringify(next), updatedBy: req.user?.id || null },
      update: { value: JSON.stringify(next), updatedBy: req.user?.id || null },
    });
    const changed = Object.keys(next).filter(k => next[k] !== current[k]);
    await logAdminAction(req, 'UPDATE_AI_SCREENING', 'SiteSetting', AI_SETTINGS_KEY, { changed });
    res.json({ ok: true, settings: next });
  } catch (e) {
    console.error('updateAiScreeningSettings', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** GET /api/admin/ai-screening/runs — recent run logs (status, mode, errors, metrics). */
export async function getAiRunLogs(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const where = {};
    if (req.query.status) where.status = String(req.query.status);
    const runs = await prisma.screenAiRun.findMany({
      where, orderBy: { createdAt: 'desc' }, take: limit,
      select: {
        id: true, projectId: true, status: true, mode: true, stage: true,
        nScored: true, nFeatures: true, failureReason: true, triggeredByName: true,
        labelCountsJson: true, metricsJson: true, completedAt: true, createdAt: true,
      },
    });
    const errorCount = await prisma.screenAiRun.count({ where: { status: 'failed' } });
    res.json({
      runs: runs.map(r => ({
        ...r,
        labelCounts: safeParse(r.labelCountsJson),
        metrics: safeParse(r.metricsJson),
        labelCountsJson: undefined, metricsJson: undefined,
      })),
      errorCount,
    });
  } catch (e) {
    console.error('getAiRunLogs', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function safeParse(s) { try { return JSON.parse(s ?? '{}'); } catch { return {}; } }
