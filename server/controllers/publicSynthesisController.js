/**
 * publicSynthesisController.js — AUTHENTICATED authoring layer for public
 * synthesis pages (68.md P8, flag `publicSynthesis`, default OFF → 404).
 *
 * Access model (mirrors livingController): any project member may VIEW status +
 * preview + dashboard; publishing / unpublishing / regenerating the token /
 * saving settings + dashboard need adjudication-level rights (owner/leader/
 * canManageExtraction) — resolveExtractionAccess.canAdjudicate.
 *
 * The public, unauthenticated read side lives in routes/publicView.js and never
 * touches this controller.
 */
import { resolveExtractionAccess } from '../extraction/access.js';
import {
  publicSynthesisEnabled,
  getStatus, updateSettings, publish, unpublish, regenerateToken,
  buildPublicPayload, normalizeSettings,
  getDashboard, putDashboard,
} from '../publicSynthesis/publicSynthesisService.js';

/** Shared gate: flag → access. Returns access or null (response already sent). */
async function gate(req, res) {
  if (!(await publicSynthesisEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveExtractionAccess(req.params.mlpid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}
const canManage = (access) => access.canAdjudicate;

/** GET /:mlpid/status — settings + token + version list (view access). */
export async function getStatusHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const status = await getStatus(access.project.id);
    res.json({ ...status, canManage: canManage(access) });
  } catch (e) { console.error('publicSynthesis getStatus', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /:mlpid/settings — persist section toggles / branding / download (manage). */
export async function putSettingsHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Editing the public page is not permitted' });
    const body = req.body || {};
    const status = await updateSettings(access.project.id, body.settings ?? body, {
      embedEnabled: typeof body.embedEnabled === 'boolean' ? body.embedEnabled : undefined,
    });
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('publicSynthesis putSettings', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to save settings' });
  }
}

/** POST /:mlpid/publish — snapshot + enable (manage). */
export async function publishHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Publishing is not permitted' });
    const settings = (req.body && req.body.settings) || req.body || {};
    const status = await publish(access.project.id, { settings, actor: req.user });
    res.json({ ok: true, ...status });
  } catch (e) {
    console.error('publicSynthesis publish', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to publish' });
  }
}

/** POST /:mlpid/unpublish — disable public access, keep token (manage). */
export async function unpublishHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Unpublishing is not permitted' });
    const status = await unpublish(access.project.id);
    res.json({ ok: true, ...status });
  } catch (e) { console.error('publicSynthesis unpublish', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/regenerate-token — invalidate the old public link (manage). */
export async function regenerateTokenHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Regenerating the link is not permitted' });
    const status = await regenerateToken(access.project.id);
    res.json({ ok: true, ...status });
  } catch (e) { console.error('publicSynthesis regenerateToken', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /:mlpid/preview — build the sanitized payload WITHOUT persisting (view). */
export async function previewHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const row = await getStatus(access.project.id);
    const payload = await buildPublicPayload(access.project.id, normalizeSettings(row.settings));
    res.json({ payload });
  } catch (e) {
    console.error('publicSynthesis preview', e);
    res.status(e.status || 500).json({ error: e.message || 'Internal server error' });
  }
}

/** GET /:mlpid/dashboard — the current composer layout (view). */
export async function getDashboardHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    res.json(await getDashboard(access.project.id));
  } catch (e) { console.error('publicSynthesis getDashboard', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** PUT /:mlpid/dashboard — save the composer layout, card types whitelisted (manage). */
export async function putDashboardHandler(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Editing the dashboard is not permitted' });
    const body = req.body || {};
    res.json({ ok: true, ...(await putDashboard(access.project.id, { name: body.name, cards: body.cards, actor: req.user })) });
  } catch (e) {
    console.error('publicSynthesis putDashboard', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to save dashboard' });
  }
}
