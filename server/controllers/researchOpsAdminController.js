/**
 * researchOpsAdminController.js — Ops/admin controls for the 66.md P5/P6 modules:
 * extraction-AI policy (`extractionAiSettings`) and living-review policy
 * (`livingReviewSettings`). Admin-only (mounted behind requireAdmin); every
 * mutation is audited. Mirrors the screeningAiAdminController pattern.
 */
import { prisma } from '../db/client.js';
import { logAdminAction } from '../utils/audit.js';
import { EXTRACTION_AI_DEFAULTS, getExtractionAiSettings } from '../extraction/access.js';
import { LIVING_DEFAULTS, LIVING_SETTINGS_KEY, getLivingSettings } from '../living/livingService.js';
import { FT_DEFAULTS, FT_SETTINGS_KEY, getFullTextSettings, coerceFullTextSettings } from '../fullText/fullTextService.js';

const EXTRACTION_SETTINGS_KEY = 'extractionAiSettings';
const ALLOWED_XAI_PROVIDERS = new Set(['heuristic', 'external']);

/** Whitelist-coerce an extraction-AI settings patch. Exported for unit tests. */
export function coerceExtractionAiSettings(patch, current) {
  const out = { ...current };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
  if (ALLOWED_XAI_PROVIDERS.has(p.provider)) out.provider = p.provider;
  if (typeof p.dualExtractionDefault === 'boolean') out.dualExtractionDefault = p.dualExtractionDefault;
  if (typeof p.tableParsingEnabled === 'boolean') out.tableParsingEnabled = p.tableParsingEnabled;
  out.requireHumanValidation = true; // hard product rule — never configurable
  return out;
}

/** Whitelist-coerce a living-review settings patch. Exported for unit tests. */
export function coerceLivingReviewSettings(patch, current) {
  const out = { ...current, evidenceShift: { ...(current.evidenceShift || {}) } };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (typeof p.schedulerEnabled === 'boolean') out.schedulerEnabled = p.schedulerEnabled;
  if (Number.isFinite(p.maxSavedSearchesPerProject)) out.maxSavedSearchesPerProject = Math.min(50, Math.max(1, Math.round(p.maxSavedSearchesPerProject)));
  if (Number.isFinite(p.snapshotRetention)) out.snapshotRetention = Math.min(1000, Math.max(5, Math.round(p.snapshotRetention)));
  if (Array.isArray(p.allowedCadences)) {
    const legal = p.allowedCadences.filter(c => ['manual', 'daily', 'weekly', 'monthly'].includes(c));
    if (legal.length) out.allowedCadences = legal;
  }
  const es = p.evidenceShift;
  if (es && typeof es === 'object') {
    if (Number.isFinite(es.relEffectChange)) out.evidenceShift.relEffectChange = Math.min(2, Math.max(0.05, es.relEffectChange));
    if (Number.isFinite(es.i2Change)) out.evidenceShift.i2Change = Math.min(80, Math.max(5, es.i2Change));
    if (Number.isFinite(es.minK)) out.evidenceShift.minK = Math.min(10, Math.max(2, Math.round(es.minK)));
  }
  return out;
}

async function saveSetting(key, value, userId) {
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value), updatedBy: userId || null },
    update: { value: JSON.stringify(value), updatedBy: userId || null },
  });
}

/** GET /api/admin/extraction-ai/settings */
export async function getExtractionAiAdminSettings(req, res) {
  try {
    res.json(await getExtractionAiSettings());
  } catch (e) { console.error('getExtractionAiAdminSettings', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /api/admin/extraction-ai/settings */
export async function updateExtractionAiAdminSettings(req, res) {
  try {
    const current = await getExtractionAiSettings();
    const next = coerceExtractionAiSettings(req.body || {}, current);
    await saveSetting(EXTRACTION_SETTINGS_KEY, next, req.user?.id);
    await logAdminAction(req, 'UPDATE_EXTRACTION_AI', 'SiteSetting', EXTRACTION_SETTINGS_KEY, { next });
    res.json(next);
  } catch (e) { console.error('updateExtractionAiAdminSettings', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /api/admin/living-review/settings */
export async function getLivingReviewAdminSettings(req, res) {
  try {
    res.json(await getLivingSettings());
  } catch (e) { console.error('getLivingReviewAdminSettings', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /api/admin/living-review/settings */
export async function updateLivingReviewAdminSettings(req, res) {
  try {
    const current = await getLivingSettings();
    const next = coerceLivingReviewSettings(req.body || {}, current);
    await saveSetting(LIVING_SETTINGS_KEY, next, req.user?.id);
    await logAdminAction(req, 'UPDATE_LIVING_REVIEW', 'SiteSetting', LIVING_SETTINGS_KEY, { next });
    res.json(next);
  } catch (e) { console.error('updateLivingReviewAdminSettings', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /api/admin/full-text/settings */
export async function getFullTextAdminSettings(req, res) {
  try {
    res.json(await getFullTextSettings());
  } catch (e) { console.error('getFullTextAdminSettings', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /api/admin/full-text/settings */
export async function updateFullTextAdminSettings(req, res) {
  try {
    const current = await getFullTextSettings();
    const next = coerceFullTextSettings(req.body || {}, current);
    await saveSetting(FT_SETTINGS_KEY, next, req.user?.id);
    await logAdminAction(req, 'UPDATE_FULL_TEXT', 'SiteSetting', FT_SETTINGS_KEY, { next });
    res.json(next);
  } catch (e) { console.error('updateFullTextAdminSettings', e); res.status(500).json({ error: 'Internal server error' }); }
}

// Re-exported so tests can assert the defaults shape without importing services.
export { EXTRACTION_AI_DEFAULTS, LIVING_DEFAULTS, FT_DEFAULTS };
