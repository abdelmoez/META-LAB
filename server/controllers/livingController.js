/**
 * livingController.js — HTTP layer for living reviews (66.md P6, flag
 * `livingReview`, default OFF → all routes 404).
 *
 * Access model: project members can VIEW the dashboard/queue/snapshots; managing
 * saved searches, running updates, creating snapshots and acknowledging alerts
 * need adjudication-level rights (owner/leader/canManageExtraction) — the same
 * resolver the extraction module uses.
 */
import { prisma } from '../db/client.js';
import { resolveExtractionAccess } from '../extraction/access.js';
import {
  livingReviewEnabled, getLivingSettings, shapeSearch,
  createSavedSearch, updateSavedSearch, runSavedSearch, reconcileSearch,
  buildSnapshotSummary, createSnapshot, getUpdateQueue,
} from '../living/livingService.js';
import { pecanSearchEnabled } from '../pecanSearch/runService.js';
import { diffSnapshots } from '../../src/research-engine/living/snapshotDiff.js';
// 67.md — product-tier enforcement (admins/mods bypass inside the service).
import { requireEntitlement, requireLimit, sendTierLimit } from '../services/entitlementService.js';

function safeParse(s, fallback) {
  try { const v = JSON.parse(s ?? ''); return v ?? fallback; } catch { return fallback; }
}

/** Shared gate: flag → access. Returns access or null (response already sent). */
async function gate(req, res) {
  if (!(await livingReviewEnabled())) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await resolveExtractionAccess(req.params.mlpid, req.user);
  if (!access) { res.status(404).json({ error: 'Project not found' }); return null; }
  return access;
}
const canManage = (access) => access.canAdjudicate;

/** GET /:mlpid/overview — the Living Review dashboard payload. */
export async function getLivingOverview(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const mlpid = access.project.id;
    let searches = await prisma.livingSavedSearch.findMany({ where: { metaLabProjectId: mlpid }, orderBy: { createdAt: 'asc' } });
    // Opportunistic reconcile of any search with a non-terminal last run, so the
    // dashboard is fresh without waiting for the next scheduler tick.
    for (let i = 0; i < searches.length; i++) {
      if (searches[i].lastRunId && ['queued', 'running'].includes(searches[i].lastRunState || '')) {
        try { searches[i] = await reconcileSearch(searches[i]); } catch { /* keep stale row */ }
      }
    }
    const [snapshots, alerts, queue, settings, pecanOn] = await Promise.all([
      prisma.reviewSnapshot.findMany({
        where: { metaLabProjectId: mlpid }, orderBy: { createdAt: 'desc' }, take: 20,
        select: { id: true, kind: true, label: true, runId: true, appVersion: true, createdAt: true, createdByName: true },
      }),
      prisma.evidenceShiftAlert.findMany({
        where: { metaLabProjectId: mlpid, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 10,
      }),
      getUpdateQueue(mlpid, { limit: 50 }),
      getLivingSettings(),
      pecanSearchEnabled(),
    ]);
    res.json({
      searches: searches.map(shapeSearch),
      snapshots,
      alerts: alerts.map(a => ({
        id: a.id, severity: a.severity, status: a.status, createdAt: a.createdAt,
        snapshotId: a.snapshotId, prevSnapshotId: a.prevSnapshotId,
        shifts: safeParse(a.shifts, []),
      })),
      queue,
      settings: {
        schedulerEnabled: settings.schedulerEnabled,
        allowedCadences: settings.allowedCadences,
        maxSavedSearchesPerProject: settings.maxSavedSearchesPerProject,
      },
      pecanSearchEnabled: pecanOn,
      canManage: canManage(access),
    });
  } catch (e) { console.error('living getLivingOverview', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/searches — create a saved search (stores the exact query snapshot). */
export async function postSearch(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Managing saved searches is not permitted' });
    // 67.md — tier gates: the feature itself, the saved-search quota, and the
    // scheduler (a non-manual cadence) are separate entitlements.
    try {
      await requireEntitlement(req.user, 'livingReview.enabled');
      const count = await prisma.livingSavedSearch.count({ where: { metaLabProjectId: access.project.id } });
      await requireLimit(req.user, 'livingReview.maxSavedSearches', count + 1);
      if (req.body?.cadence && req.body.cadence !== 'manual') {
        await requireEntitlement(req.user, 'livingReview.scheduler');
      }
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const search = await createSavedSearch(access.project.id, req.body || {}, req.user);
    res.json({ ok: true, search });
  } catch (e) {
    console.error('living postSearch', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to create saved search' });
  }
}

/** PUT /:mlpid/searches/:sid — edit cadence/enabled/name/query snapshot. */
export async function putSearch(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Managing saved searches is not permitted' });
    try {
      if (req.body?.cadence && req.body.cadence !== 'manual') {
        await requireEntitlement(req.user, 'livingReview.scheduler');
      }
    } catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const search = await updateSavedSearch(access.project.id, req.params.sid, req.body || {});
    res.json({ ok: true, search });
  } catch (e) {
    console.error('living putSearch', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to update saved search' });
  }
}

/** DELETE /:mlpid/searches/:sid */
export async function deleteSearch(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Managing saved searches is not permitted' });
    const row = await prisma.livingSavedSearch.findFirst({ where: { id: req.params.sid, metaLabProjectId: access.project.id } });
    if (!row) return res.status(404).json({ error: 'Saved search not found' });
    await prisma.livingSavedSearch.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (e) { console.error('living deleteSearch', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/searches/:sid/run — manual "Run now". */
export async function postRunNow(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Running searches is not permitted' });
    try { await requireEntitlement(req.user, 'livingReview.enabled'); }
    catch (e) { if (sendTierLimit(res, e)) return; throw e; }
    const row = await prisma.livingSavedSearch.findFirst({ where: { id: req.params.sid, metaLabProjectId: access.project.id } });
    if (!row) return res.status(404).json({ error: 'Saved search not found' });
    const run = await runSavedSearch(row, { actorId: req.user.id, reason: 'manual' });
    res.status(202).json({ ok: true, runId: run.id, state: run.state });
  } catch (e) {
    console.error('living postRunNow', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to start the search run', code: e.code });
  }
}

/** GET /:mlpid/queue — new-since-last-run screening queue with AI priority. */
export async function getQueue(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    res.json(await getUpdateQueue(access.project.id, { limit: Math.min(500, Number(req.query.limit) || 200) }));
  } catch (e) { console.error('living getQueue', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:mlpid/snapshots — manual snapshot. */
export async function postSnapshot(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Creating snapshots is not permitted' });
    const { snapshot, alert } = await createSnapshot(access.project.id, {
      kind: 'manual',
      label: req.body?.label ? String(req.body.label).slice(0, 200) : null,
      actor: req.user,
    });
    res.json({ ok: true, snapshot: { id: snapshot.id, kind: snapshot.kind, label: snapshot.label, createdAt: snapshot.createdAt }, alert: alert ? { id: alert.id, severity: alert.severity } : null });
  } catch (e) {
    console.error('living postSnapshot', e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to create snapshot' });
  }
}

/** GET /:mlpid/snapshots — list (summaries omitted for weight). */
export async function getSnapshots(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const rows = await prisma.reviewSnapshot.findMany({
      where: { metaLabProjectId: access.project.id }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, kind: true, label: true, runId: true, appVersion: true, createdAt: true, createdByName: true },
    });
    res.json({ snapshots: rows });
  } catch (e) { console.error('living getSnapshots', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /:mlpid/snapshots/:sid — one snapshot with its full summary. */
export async function getSnapshot(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const row = await prisma.reviewSnapshot.findFirst({ where: { id: req.params.sid, metaLabProjectId: access.project.id } });
    if (!row) return res.status(404).json({ error: 'Snapshot not found' });
    res.json({
      id: row.id, kind: row.kind, label: row.label, runId: row.runId,
      appVersion: row.appVersion, createdAt: row.createdAt, createdByName: row.createdByName,
      summary: safeParse(row.summary, {}),
    });
  } catch (e) { console.error('living getSnapshot', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /:mlpid/snapshots/compare?a=&b= — diff two snapshots (a = older). */
export async function getSnapshotCompare(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const [a, b] = await Promise.all([
      prisma.reviewSnapshot.findFirst({ where: { id: String(req.query.a || ''), metaLabProjectId: access.project.id } }),
      prisma.reviewSnapshot.findFirst({ where: { id: String(req.query.b || ''), metaLabProjectId: access.project.id } }),
    ]);
    if (!a || !b) return res.status(404).json({ error: 'Snapshot not found' });
    const diff = diffSnapshots(safeParse(a.summary, {}), safeParse(b.summary, {}));
    res.json({
      a: { id: a.id, label: a.label, createdAt: a.createdAt },
      b: { id: b.id, label: b.label, createdAt: b.createdAt },
      diff,
    });
  } catch (e) { console.error('living getSnapshotCompare', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /:mlpid/preview — live (unsaved) snapshot summary for the dashboard. */
export async function getPreview(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    res.json({ summary: await buildSnapshotSummary(access.project.id) });
  } catch (e) {
    console.error('living getPreview', e);
    res.status(e.status || 500).json({ error: e.message || 'Internal server error' });
  }
}

/** POST /:mlpid/alerts/:aid/ack — acknowledge an evidence-shift alert. */
export async function postAlertAck(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    if (!canManage(access)) return res.status(403).json({ error: 'Acknowledging alerts is not permitted' });
    const row = await prisma.evidenceShiftAlert.findFirst({ where: { id: req.params.aid, metaLabProjectId: access.project.id } });
    if (!row) return res.status(404).json({ error: 'Alert not found' });
    await prisma.evidenceShiftAlert.update({
      where: { id: row.id },
      data: { status: 'acknowledged', acknowledgedById: req.user.id, acknowledgedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (e) { console.error('living postAlertAck', e); res.status(500).json({ error: 'Internal server error' }); }
}
