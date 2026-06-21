/**
 * screeningAiAdminController.js — Ops/admin controls for the AI screening engine.
 * Admin-only (mounted behind requireAdmin). Reads/writes the `aiScreeningSettings`
 * SiteSetting and surfaces run logs + errors. Every mutation is audited.
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { AI_SETTINGS_KEY, AI_GLOBAL_DEFAULTS, getRawGlobalAiSettings } from '../services/screeningAiService.js';

const ALLOWED_PROVIDERS = new Set(['lexical', 'hashing', 'hosted']);
const ALLOWED_POLICIES = new Set(['assist', 'prioritize', 'auto_after_human']);

/**
 * Coerce a settings patch to the known schema (defends against junk + injection).
 * Only whitelisted keys are accepted; unknown keys are dropped; numeric fields are
 * clamped to safe bounds. Exported for unit testing. se2.md §4/§6.
 */
export function coerceAiScreeningSettings(patch, current) {
  const out = { ...current };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (ALLOWED_PROVIDERS.has(p.embeddingProvider)) out.embeddingProvider = p.embeddingProvider;
  if (Number.isFinite(p.maxRecordsPerRun)) out.maxRecordsPerRun = Math.min(100000, Math.max(10, Math.round(p.maxRecordsPerRun)));
  if (typeof p.requireHumanFinalDecision === 'boolean') out.requireHumanFinalDecision = p.requireHumanFinalDecision;
  if (typeof p.allowReviewersToRun === 'boolean') out.allowReviewersToRun = p.allowReviewersToRun;
  if (Number.isFinite(p.includeThreshold)) out.includeThreshold = Math.min(1, Math.max(0, p.includeThreshold));
  if (Number.isFinite(p.excludeThreshold)) out.excludeThreshold = Math.min(1, Math.max(0, p.excludeThreshold));
  if (ALLOWED_POLICIES.has(p.defaultPolicy)) out.defaultPolicy = p.defaultPolicy;
  // se2.md §6 live updating + §4 emergency kill switch. Increment 1 added these to the
  // settings shape (AI_GLOBAL_DEFAULTS) but the admin endpoint never whitelisted them,
  // so the kill switch / live-update toggles silently failed to persist — fixed here.
  if (typeof p.liveUpdateEnabled === 'boolean') out.liveUpdateEnabled = p.liveUpdateEnabled;
  if (Number.isFinite(p.retrainDebounceMs)) out.retrainDebounceMs = Math.min(60000, Math.max(500, Math.round(p.retrainDebounceMs)));
  if (typeof p.killSwitch === 'boolean') out.killSwitch = p.killSwitch;
  return out;
}

/**
 * Build a per-key before→after diff for the audit log ("what changed"). Only keys whose
 * value actually changed are included. Pure; exported for unit testing.
 */
export function diffAiScreeningSettings(current, next) {
  const changes = {};
  for (const k of Object.keys(next)) {
    if (current[k] !== next[k]) changes[k] = { from: current[k] ?? null, to: next[k] ?? null };
  }
  return changes;
}

/** GET /api/admin/ai-screening/settings — returns the RAW stored values (the admin edits
 *  `enabled` and `killSwitch` independently; the runtime override is applied only by the
 *  engine, never persisted). */
export async function getAiScreeningSettings(req, res) {
  try {
    const settings = await getRawGlobalAiSettings();
    res.json({ settings, defaults: AI_GLOBAL_DEFAULTS });
  } catch (e) {
    console.error('getAiScreeningSettings', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/** PUT /api/admin/ai-screening/settings */
export async function updateAiScreeningSettings(req, res) {
  try {
    const current = await getRawGlobalAiSettings();
    const next = coerceAiScreeningSettings(req.body || {}, current);
    await prisma.siteSetting.upsert({
      where: { key: AI_SETTINGS_KEY },
      create: { key: AI_SETTINGS_KEY, value: JSON.stringify(next), updatedBy: req.user?.id || null },
      update: { value: JSON.stringify(next), updatedBy: req.user?.id || null },
    });
    // Audit "who / what / when": adminId, ip and timestamp are captured by logAdminAction;
    // the before→after value map is the "what". Policy fields are scalar booleans/numbers
    // (no article text) so recording their values is safe.
    const changes = diffAiScreeningSettings(current, next);
    await logAdminAction(req, 'UPDATE_AI_SCREENING', 'SiteSetting', AI_SETTINGS_KEY, {
      changed: Object.keys(changes),
      changes,
    });
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
