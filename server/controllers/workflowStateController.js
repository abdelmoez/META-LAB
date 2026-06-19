/**
 * workflowStateController.js — HTTP layer for server-backed per-module workflow
 * state (prompt38). Flag-gated (404 when off), project-access authorized, with
 * revision-based optimistic concurrency (409 STATE_CONFLICT).
 *
 * Routes (mounted at /api/workspaces, requireAuth at the mount):
 *   GET   /:projectId/state                          → module summaries + revisions
 *   GET   /:projectId/modules/:moduleKey/state        → one module's state
 *   PATCH /:projectId/modules/:moduleKey/state        → { patch, baseRevision }
 *
 * `:projectId` is the META·LAB Project id (the "review workspace"). Access is the
 * same as the project: owner or linked-workspace member; write requires canEdit.
 */
import {
  workflowStateEnabled, resolveProjectAccess, isValidModuleKey,
  getModuleState, getStateSummary, patchModuleState, MODULE_AUDIT_ACTION,
  recordWorkflowAudit, getWorkflowAudit,
} from '../services/workflowState.js';

/**
 * Shared gate: feature flag + project view access. Writes the response itself on
 * failure and returns null; returns the access object on success.
 */
async function gate(req, res) {
  if (!(await workflowStateEnabled())) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const access = await resolveProjectAccess(req.params.projectId, req.user.id);
  if (!access || !access.canView) {
    res.status(404).json({ error: 'Project not found' }); // existence hidden
    return null;
  }
  return access;
}

export async function getWorkspaceState(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    return res.json(await getStateSummary(req.params.projectId));
  } catch (err) {
    console.error('[workflowState] getWorkspaceState error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getWorkspaceModuleState(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const { moduleKey } = req.params;
    if (!isValidModuleKey(moduleKey)) return res.status(400).json({ error: 'Unknown module' });
    return res.json(await getModuleState(req.params.projectId, moduleKey));
  } catch (err) {
    console.error('[workflowState] getWorkspaceModuleState error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getWorkspaceAudit(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const entries = await getWorkflowAudit(req.params.projectId, { limit: req.query.limit });
    return res.json({ entries });
  } catch (err) {
    console.error('[workflowState] getWorkspaceAudit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function patchWorkspaceModuleState(req, res) {
  try {
    const access = await gate(req, res);
    if (!access) return;
    const { moduleKey } = req.params;
    if (!isValidModuleKey(moduleKey)) return res.status(400).json({ error: 'Unknown module' });
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Read-only access — you do not have permission to edit this module' });
    }

    const { patch, baseRevision } = req.body || {};
    if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ error: 'patch must be an object' });
    }
    // Reject non-number primitives (true/[]/"  ") that could otherwise coerce
    // and weaken the conflict check — baseRevision must be a real integer or absent.
    if (baseRevision != null && (typeof baseRevision !== 'number' || !Number.isInteger(baseRevision))) {
      return res.status(400).json({ error: 'baseRevision must be an integer' });
    }

    const out = await patchModuleState({
      projectId: req.params.projectId, moduleKey, patch, baseRevision, user: req.user,
    });

    if (out.conflict) {
      console.warn(`[workflowState] WORKFLOW_STATE_CONFLICT project=${req.params.projectId} module=${moduleKey} user=${req.user.id} base=${baseRevision} current=${out.current.revision}`);
      await recordWorkflowAudit({
        projectId: req.params.projectId, moduleKey, action: 'WORKFLOW_STATE_CONFLICT',
        revision: out.current.revision, user: req.user,
        details: { baseRevision: baseRevision ?? null, currentRevision: out.current.revision },
      });
      return res.status(409).json({
        error: 'STATE_CONFLICT',
        currentState: out.current.state,
        currentRevision: out.current.revision,
        updatedBy: out.current.updatedBy,
        updatedAt: out.current.updatedAt,
      });
    }

    await recordWorkflowAudit({
      projectId: req.params.projectId, moduleKey,
      action: MODULE_AUDIT_ACTION[moduleKey] || 'MODULE_UPDATED',
      revision: out.result.revision, user: req.user,
      details: { changedKeys: Object.keys(patch) },
    });
    return res.json({
      state: out.result.state,
      revision: out.result.revision,
      updatedAt: out.result.updatedAt,
      updatedBy: out.result.updatedBy,
    });
  } catch (err) {
    console.error('[workflowState] patchWorkspaceModuleState error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
