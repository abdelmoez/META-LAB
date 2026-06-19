/**
 * features/protocol/useProtocolState.js — the Protocol module's server-backed
 * state hook (prompt38). Layers protocol mapping + legacy migration on top of the
 * generic useModuleState:
 *
 *   - loads the `protocol` module state from the server (revision-tracked),
 *   - one-time legacy migration: if the server module is empty (revision 0) and
 *     the legacy project blob carries protocol content, seed the module from the
 *     blob (a first PATCH → revision 1) so old projects move over transparently,
 *   - exposes `value` (defaults merged) + the conflict-safe `update`/`flush`.
 */
import { useEffect, useRef } from 'react';
import { useModuleState } from '../../hooks/workflow/useModuleState.js';
import { pickProtocol, isBlankProtocol, PROTOCOL_DEFAULTS } from './protocolState.js';

export function useProtocolState(projectId, { project, enabled = true } = {}) {
  const mod = useModuleState(projectId, 'protocol', { enabled });
  const seededRef = useRef(false);

  useEffect(() => {
    if (!enabled || seededRef.current) return;
    // Wait until the initial load has settled to a stable status.
    if (mod.status === 'loading' || mod.status === 'saving') return;
    if (mod.revision !== 0) { seededRef.current = true; return; } // already server-backed
    // Empty server module → migrate from the legacy blob if it has content.
    const fromBlob = pickProtocol(project);
    seededRef.current = true;
    if (!isBlankProtocol(fromBlob)) mod.update(fromBlob);
  }, [mod.status, mod.revision, enabled, project]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = { ...PROTOCOL_DEFAULTS, ...(mod.state || {}) };
  return { ...mod, value };
}
