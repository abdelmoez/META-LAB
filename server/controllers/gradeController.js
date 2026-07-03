/**
 * gradeController.js — P12. HTTP surface for the per-outcome GRADE certainty layer.
 *
 * Every handler:
 *   1. gates on the `gradeCertainty` feature flag (404 when OFF — existence-hidden),
 *   2. resolves project access (owner OR linked-workspace member); no access → 404,
 *   3. enforces permission (reads need canView; writes need canEdit; lock/unlock need
 *      owner/leader), and
 *   4. delegates to gradeService, translating typed service errors to HTTP:
 *        GRADE_ENGINE_UNAVAILABLE → 503, GRADE_LOCKED / GRADE_NOT_SAVED → 409.
 *
 * The pure engine is built by a parallel workstream and may not be present yet; the
 * 503 path keeps these routes honest (reachable, but clearly "engine not wired") until
 * it ships. Auth is applied at the router mount, so unauthenticated calls 401 first.
 */
import { getById, getByIdUnscoped } from '../store.js';
import { getMetaLabMemberAccess } from '../screening/metalabAccess.js';
import { getEffectiveFeatureFlags } from './settingsController.js';
import * as gradeService from '../services/gradeService.js';

async function gradeEnabled() {
  try { const f = await getEffectiveFeatureFlags(); return f.gradeCertainty === true; }
  catch { return false; }
}

/**
 * Resolve a user's access to a META·LAB project for GRADE. Owner → full; a linked-
 * workspace member gets the workspace's canView/canEdit (leader/owner roles get edit).
 * Returns { project, canView, canEdit, isOwner, role } or null (→ 404, existence-hidden).
 */
async function resolveGradeAccess(projectId, userId) {
  const owned = await getById(projectId, userId);
  if (owned) return { project: owned, canView: true, canEdit: true, isOwner: true, role: 'owner' };
  const m = await getMetaLabMemberAccess(projectId, userId);
  if (m) {
    const project = await getByIdUnscoped(projectId);
    if (project) return { project, canView: !!m.canView, canEdit: !!m.canEdit, isOwner: false, role: m.role };
  }
  return null;
}

/** Map a typed service error to an HTTP response; returns true if it handled one. */
function sendServiceError(res, err) {
  if (!err || !err.code) return false;
  if (err.code === 'GRADE_ENGINE_UNAVAILABLE') {
    res.status(503).json({ error: 'GRADE engine is not available yet.', code: 'GRADE_ENGINE_UNAVAILABLE' });
    return true;
  }
  if (err.code === 'GRADE_LOCKED') { res.status(409).json({ error: err.message, code: 'GRADE_LOCKED' }); return true; }
  if (err.code === 'GRADE_NOT_SAVED') { res.status(409).json({ error: err.message, code: 'GRADE_NOT_SAVED' }); return true; }
  return false;
}

const modelOf = (req) => (req.query?.model === 'fixed' ? 'fixed' : 'random');

// GET /api/grade/projects/:pid/outcomes
export async function getOutcomes(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: 'Not found' });
    const result = await gradeService.listOutcomes(access.project, { model: modelOf(req) });
    return res.json(result);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] getOutcomes error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/grade/projects/:pid/outcomes/:key
export async function getOutcome(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: 'Not found' });
    const outcome = await gradeService.getOutcome(access.project, req.params.key, { model: modelOf(req) });
    if (!outcome) return res.status(404).json({ error: 'Outcome not found' });
    return res.json({ outcome });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] getOutcome error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PUT /api/grade/projects/:pid/outcomes/:key  { domains, notes?, startLevel? }
export async function putOutcome(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit) return res.status(403).json({ error: 'You have read-only access to this project.' });
    const outcome = await gradeService.saveOutcome(access.project, req.params.key, req.body || {}, req.user, { model: modelOf(req) });
    return res.json({ outcome });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] putOutcome error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/grade/projects/:pid/outcomes/:key/lock
export async function lockOutcome(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit || !(access.isOwner || access.role === 'leader')) {
      return res.status(403).json({ error: 'Only a project leader or owner can lock a GRADE assessment.' });
    }
    const outcome = await gradeService.lockOutcome(access.project, req.params.key, req.user);
    return res.json({ outcome });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] lockOutcome error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /api/grade/projects/:pid/outcomes/:key/unlock
export async function unlockOutcome(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access) return res.status(404).json({ error: 'Not found' });
    if (!access.canEdit || !(access.isOwner || access.role === 'leader')) {
      return res.status(403).json({ error: 'Only a project leader or owner can unlock a GRADE assessment.' });
    }
    const outcome = await gradeService.unlockOutcome(access.project, req.params.key, req.user);
    return res.json({ outcome });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] unlockOutcome error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/grade/projects/:pid/audit
export async function getAudit(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: 'Not found' });
    const entries = await gradeService.getAudit(req.params.pid);
    return res.json({ entries });
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] getAudit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/grade/projects/:pid/sof?format=json|csv|html
export async function getSof(req, res) {
  try {
    if (!(await gradeEnabled())) return res.status(404).json({ error: 'Not found' });
    const access = await resolveGradeAccess(req.params.pid, req.user.id);
    if (!access || !access.canView) return res.status(404).json({ error: 'Not found' });
    const format = ['csv', 'html', 'json'].includes(req.query?.format) ? req.query.format : 'json';
    const out = await gradeService.buildSof(access.project, { format, model: modelOf(req) });
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(out.content);
    }
    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(out.content);
    }
    return res.json(out);
  } catch (err) {
    if (sendServiceError(res, err)) return;
    console.error('[grade] getSof error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
