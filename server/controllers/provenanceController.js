/**
 * server/controllers/provenanceController.js — 88.md Part IV/VII. The read + light-
 * write API over the append-only ProjectEvent ledger (Project History / Research
 * Provenance). Every handler gates on:
 *   1. the `researchProvenance` feature flag (default OFF → existence-hiding 404; admins pass);
 *   2. META·LAB project access (owner/active member) via getProjectAccess.
 * Listing/summary require membership; reason amendment requires leadership OR being the
 * original actor; soft-invalidation requires leadership. The ledger is never rewritten.
 */
import { featureAccess } from '../services/featureAccess.js';
import { getProjectAccess } from '../screening/access.js';
import {
  listEvents, summary, ensureBaseline, baselineProject, addReason, invalidateEvent,
} from '../provenance/provenanceService.js';

const FLAG = 'researchProvenance';

async function gate(req, res) {
  const gateRes = await featureAccess(FLAG, req.user);
  if (!gateRes.allowed) { res.status(404).json({ error: 'Not found' }); return null; }
  const access = await getProjectAccess(req.params.pid, req.user);
  if (!access) { res.status(404).json({ error: 'Not found' }); return null; }
  return access;
}

function blobOf(access) {
  try { return JSON.parse(access.project.data || '{}'); } catch { return {}; }
}

function actorCtx(req, access) {
  return {
    actorUserId: req.user.id,
    actorName: req.user.email || '',
    actorRole: access.role || 'reviewer',
    sessionId: req.headers['x-session-id'] || null,
  };
}

/** GET /:pid/events — paginated, filtered history. */
export async function getEvents(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    // First load of a legacy project (no events yet) → write an honest baseline.
    await ensureBaseline(access.project.id, blobOf(access), actorCtx(req, access));
    const out = await listEvents(access.project.id, {
      filter: req.query.filter,
      category: req.query.category,
      module: req.query.module,
      eventType: req.query.eventType,
      actorUserId: req.query.actorUserId,
      minSignificance: req.query.minSignificance,
      cursor: req.query.cursor,
      limit: req.query.limit,
      includeInvalidated: access.isLeader && req.query.includeInvalidated === '1',
    });
    res.json({ ...out, canAmend: !!access.active, canInvalidate: !!access.isLeader });
  } catch (e) { console.error('[provenance] getEvents', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** GET /:pid/summary — milestone counts, deviations, derived scientific state. */
export async function getSummary(req, res) {
  const access = await gate(req, res); if (!access) return;
  try {
    const s = await summary(access.project.id, blobOf(access));
    res.json(s);
  } catch (e) { console.error('[provenance] getSummary', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:pid/baseline — (re)assert the honest legacy baseline. Leadership only. */
export async function postBaseline(req, res) {
  const access = await gate(req, res); if (!access) return;
  if (!access.isLeader) { res.status(403).json({ error: 'Only project leaders can create a baseline' }); return; }
  try {
    const out = await baselineProject(access.project.id, blobOf(access), { ...actorCtx(req, access) });
    res.json(out);
  } catch (e) { console.error('[provenance] postBaseline', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:pid/events/:eid/reason — fill a missing reason (leader OR original actor). */
export async function postReason(req, res) {
  const access = await gate(req, res); if (!access) return;
  const reason = (req.body && req.body.reason) || '';
  if (!String(reason).trim()) { res.status(400).json({ error: 'A reason is required' }); return; }
  try {
    // Leaders may annotate any event; members only their own — enforced by fetching
    // the row's actor. addReason additionally refuses to overwrite an existing reason.
    const out = await addReason(req.params.eid, reason, actorCtx(req, access));
    if (!out.updated && out.reason === 'already-has-reason') { res.status(409).json({ error: 'This event already has a reason', code: out.reason }); return; }
    res.json(out);
  } catch (e) { console.error('[provenance] postReason', e); res.status(500).json({ error: 'Internal server error' }); }
}

/** POST /:pid/events/:eid/invalidate — soft-invalidate a defective event. Leadership only. */
export async function postInvalidate(req, res) {
  const access = await gate(req, res); if (!access) return;
  if (!access.isLeader) { res.status(403).json({ error: 'Only project leaders can invalidate an event' }); return; }
  try {
    const out = await invalidateEvent(req.params.eid, { ...actorCtx(req, access), reason: (req.body && req.body.reason) || '' });
    res.json(out);
  } catch (e) { console.error('[provenance] postInvalidate', e); res.status(500).json({ error: 'Internal server error' }); }
}
