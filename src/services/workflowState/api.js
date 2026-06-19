/**
 * workflowState/api.js — client for server-backed per-module workflow state
 * (prompt38). Thin wrapper over the /api/workspaces/:projectId endpoints.
 *
 * patchModule throws on a 409 conflict with `err.status === 409` and
 * `err.body = { error:'STATE_CONFLICT', currentState, currentRevision, ... }`
 * so the hook can refetch + surface the conflict instead of last-write-wins.
 */
const BASE = '/api/workspaces';

async function req(url, opts = {}) {
  const res = await fetch(url, { credentials: 'include', ...opts });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const json = (b) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

export const workflowStateApi = {
  /** { projectId, modules: { key: { revision, updatedAt, updatedBy } } } */
  summary: (projectId) => req(`${BASE}/${projectId}/state`),
  /** { moduleKey, state, revision, updatedAt, updatedBy } */
  getModule: (projectId, moduleKey) => req(`${BASE}/${projectId}/modules/${moduleKey}/state`),
  /** → { state, revision, updatedAt, updatedBy } | throws 409 STATE_CONFLICT */
  patchModule: (projectId, moduleKey, patch, baseRevision) =>
    req(`${BASE}/${projectId}/modules/${moduleKey}/state`, {
      method: 'PATCH',
      ...json({ patch, baseRevision }),
    }),
};

/**
 * Read the public feature-flag snapshot to gate the server-backed workflow-state
 * UI client-side (mirrors robFlagEnabled). Default OFF on any error.
 */
export async function workflowStateFlagEnabled() {
  try {
    const res = await fetch('/api/settings/public', { credentials: 'include' });
    if (!res.ok) return false;
    const data = await res.json();
    return !!(data && data.featureFlags && data.featureFlags.serverBackedWorkflowState === true);
  } catch {
    return false;
  }
}
