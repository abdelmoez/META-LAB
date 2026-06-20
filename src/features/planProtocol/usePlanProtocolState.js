/**
 * features/planProtocol/usePlanProtocolState.js — the Plan & Protocol module's
 * server-backed state hook (prompt46 #1). Mirrors useProtocolState: layers
 * plan-protocol mapping + one-time legacy-blob migration on top of the generic
 * useModuleState (moduleKey 'planProtocol'):
 *
 *   - loads the `planProtocol` module state from the server (revision-tracked),
 *   - one-time legacy migration: if the server module is empty (revision 0) and
 *     the legacy `project.prospero` blob carries content, seed the module from the
 *     blob (a first PATCH → revision 1) so old projects move over transparently,
 *   - exposes `value` (defaults merged) + the conflict-safe `update`/`flush`.
 */
import { useEffect, useRef } from 'react';
import { useModuleState } from '../../hooks/workflow/useModuleState.js';
import { pickPlanProtocol, isBlankPlanProtocol, PLAN_PROTOCOL_DEFAULTS } from './planProtocolState.js';

export function usePlanProtocolState(projectId, { project, enabled = true } = {}) {
  const mod = useModuleState(projectId, 'planProtocol', { enabled });
  const seededRef = useRef(false);

  useEffect(() => {
    if (!enabled || seededRef.current) return;
    // Wait until the initial load has settled to a stable status.
    if (mod.status === 'loading' || mod.status === 'saving') return;
    if (mod.revision !== 0) { seededRef.current = true; return; } // already server-backed
    // Empty server module → migrate from the legacy blob if it has content.
    const fromBlob = pickPlanProtocol(project);
    seededRef.current = true;
    if (!isBlankPlanProtocol(fromBlob)) mod.update(fromBlob);
  }, [mod.status, mod.revision, enabled, project]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = { ...PLAN_PROTOCOL_DEFAULTS, ...(mod.state || {}) };
  return { ...mod, value };
}
