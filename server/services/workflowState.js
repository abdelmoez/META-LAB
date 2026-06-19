/**
 * workflowState.js — server-backed per-module workflow state (prompt38).
 *
 * The structural replacement for whole-project blob autosave. Each migrated
 * workflow module (protocol, project_control, …) gets its own row in
 * WorkflowModuleState keyed by (projectId, moduleKey), carrying its stateJson
 * and an optimistic-concurrency `revision`. A PATCH applies a SHALLOW top-level
 * merge (so unrelated keys are never clobbered) using a compare-and-swap on the
 * revision — a stale write is rejected as a 409 conflict instead of last-write-
 * wins. Access is authorized by the SAME META·LAB project access as the project
 * (owner, or linked-workspace member with canEdit). Gated behind the
 * `serverBackedWorkflowState` feature flag (default OFF → endpoints 404).
 *
 * PURE-ish: only DB + project-access helpers; no Express. The concurrency core
 * (mergePatch, conflict decision) is exported for unit testing.
 */
import { prisma } from '../db/client.js';
import { getById } from '../store.js';
import { getMetaLabMemberAccess } from '../screening/metalabAccess.js';

// Whitelist of writable module keys (Phase 13 #8 — no arbitrary moduleKey writes).
// Add a key here as each module is migrated off the whole-project blob.
export const MODULE_KEYS = ['protocol', 'project_control', 'analysis_config', 'prisma', 'report'];
export const isValidModuleKey = (k) => MODULE_KEYS.includes(k);

// Audit action name per module (Phase 4). Used for structured logging; a
// dedicated history table is a documented follow-up.
export const MODULE_AUDIT_ACTION = {
  protocol: 'PROTOCOL_UPDATED',
  project_control: 'PROJECT_CONTROL_UPDATED',
  analysis_config: 'ANALYSIS_CONFIG_UPDATED',
  prisma: 'PRISMA_UPDATED',
  report: 'REPORT_UPDATED',
};

const FLAG_KEY = 'serverBackedWorkflowState';

/** Feature-flag gate — default OFF (mirrors robController.robEnabled). */
export async function workflowStateEnabled() {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'featureFlags' } });
    if (!row) return false;
    return JSON.parse(row.value || '{}')[FLAG_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Resolve the caller's access to a META·LAB project (owner OR linked-workspace
 * member). Returns null when the user has no view access (→ 404, existence
 * hidden). Reuses the exact same resolvers as the project edit path.
 */
export async function resolveProjectAccess(projectId, userId) {
  const owned = await getById(projectId, userId);
  if (owned) return { canView: true, canEdit: true, readOnly: false, isOwner: true, role: 'owner' };
  const acc = await getMetaLabMemberAccess(projectId, userId);
  if (!acc) return null;
  return { canView: !!acc.canView, canEdit: !!acc.canEdit, readOnly: !!acc.readOnly, isOwner: false, role: acc.role };
}

/* ─── Pure concurrency core (unit-tested) ─────────────────────────────── */

export function safeParse(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** Shallow top-level merge — a patch replaces only the keys it names. */
export function mergePatch(current, patch) {
  return { ...(current || {}), ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) };
}

/**
 * Decide whether a write is a stale-revision conflict.
 * baseRevision null/undefined → caller opts out of the check (always applies).
 * A non-null baseRevision is compared STRICTLY (the controller guarantees it is an
 * integer), so a bogus type can never coincidentally pass the conflict check.
 */
export function isStale(baseRevision, currentRevision) {
  return baseRevision != null && baseRevision !== currentRevision;
}

/* ─── State shape helpers ─────────────────────────────────────────────── */

function rowToState(row) {
  return {
    moduleKey: row.moduleKey,
    state: safeParse(row.stateJson),
    revision: row.revision,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedById ? { id: row.updatedById, name: row.updatedByName || '' } : null,
  };
}

const emptyState = (moduleKey) => ({ moduleKey, state: {}, revision: 0, updatedAt: null, updatedBy: null });

/* ─── Reads ───────────────────────────────────────────────────────────── */

export async function getModuleState(projectId, moduleKey) {
  const row = await prisma.workflowModuleState.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey } },
  });
  return row ? rowToState(row) : emptyState(moduleKey);
}

/** Per-project summary: { projectId, modules: { key: {revision, updatedAt, updatedBy} } }. */
export async function getStateSummary(projectId) {
  const rows = await prisma.workflowModuleState.findMany({ where: { projectId } });
  const modules = {};
  for (const r of rows) {
    modules[r.moduleKey] = {
      revision: r.revision,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedById ? { id: r.updatedById, name: r.updatedByName || '' } : null,
    };
  }
  return { projectId, modules };
}

/* ─── Write (optimistic concurrency, compare-and-swap on revision) ───────── */

/**
 * @returns {Promise<{ok:true,result}|{conflict:true,current}>}
 */
export async function patchModuleState({ projectId, moduleKey, patch, baseRevision, user }) {
  const existing = await prisma.workflowModuleState.findUnique({
    where: { projectId_moduleKey: { projectId, moduleKey } },
  });
  const currentRev = existing ? existing.revision : 0;

  if (isStale(baseRevision, currentRev)) {
    return { conflict: true, current: existing ? rowToState(existing) : emptyState(moduleKey) };
  }

  const nextState = mergePatch(existing ? safeParse(existing.stateJson) : {}, patch);
  const stateJson = JSON.stringify(nextState);
  const updatedByName = (user && user.name) || '';

  if (!existing) {
    try {
      const row = await prisma.workflowModuleState.create({
        data: { projectId, moduleKey, stateJson, revision: 1, updatedById: user.id, updatedByName },
      });
      return { ok: true, result: rowToState(row) };
    } catch (e) {
      // ONLY a unique-constraint race (P2002) is a concurrent-create conflict;
      // rethrow every other error so the controller answers a real 500 instead of
      // a phantom revision-0 "conflict" that the client would retry forever.
      if (!e || e.code !== 'P2002') throw e;
      const fresh = await prisma.workflowModuleState.findUnique({ where: { projectId_moduleKey: { projectId, moduleKey } } });
      if (!fresh) throw e; // impossible-state guard: a P2002 with no row → real error
      return { conflict: true, current: rowToState(fresh) };
    }
  }

  // CAS: only write if the row is STILL at currentRev (blocks a lost-update race).
  const res = await prisma.workflowModuleState.updateMany({
    where: { projectId, moduleKey, revision: currentRev },
    data: { stateJson, revision: currentRev + 1, updatedById: user.id, updatedByName },
  });
  if (res.count !== 1) {
    const fresh = await prisma.workflowModuleState.findUnique({ where: { projectId_moduleKey: { projectId, moduleKey } } });
    return { conflict: true, current: fresh ? rowToState(fresh) : emptyState(moduleKey) };
  }
  const row = await prisma.workflowModuleState.findUnique({ where: { projectId_moduleKey: { projectId, moduleKey } } });
  return { ok: true, result: rowToState(row) };
}
