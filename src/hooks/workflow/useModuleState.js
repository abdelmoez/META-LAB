/**
 * useModuleState — generic React hook for a server-backed workflow module
 * (prompt38). Loads the module's state, applies optimistic local updates, and
 * autosaves a SHALLOW per-field patch (debounced) with revision-based conflict
 * detection. On a 409 it refetches the server's current state and exposes a
 * `conflict` object instead of silently overwriting.
 *
 *   const { state, status, conflict, update, flush, dismissConflict } =
 *     useModuleState(projectId, 'protocol', { enabled });
 *
 * status: 'loading' | 'idle' | 'saving' | 'saved' | 'conflict' | 'error'
 *
 * This hook owns ONLY the server round-trip + debounce. Feature hooks (e.g.
 * useProtocolState) layer mapping + legacy migration on top.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { workflowStateApi } from '../../services/workflowState/api.js';

const DEBOUNCE_MS = 700;

export function useModuleState(projectId, moduleKey, { enabled = true, debounceMs = DEBOUNCE_MS } = {}) {
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('idle');
  const [conflict, setConflict] = useState(null);

  // Refs so the debounced flush always reads the latest without re-subscribing.
  const stateRef = useRef({});
  const revRef = useRef(0);
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Load on mount / when the target changes.
  useEffect(() => {
    if (!enabled || !projectId) return undefined;
    let alive = true;
    setStatus('loading');
    workflowStateApi.getModule(projectId, moduleKey)
      .then((d) => {
        if (!alive) return;
        stateRef.current = d.state || {};
        revRef.current = d.revision || 0;
        setState(stateRef.current);
        setRevision(revRef.current);
        setStatus('idle');
      })
      .catch(() => { if (alive) setStatus('error'); });
    return () => { alive = false; };
  }, [projectId, moduleKey, enabled]);

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (!patch || Object.keys(patch).length === 0) return;
    setStatus('saving');
    try {
      const d = await workflowStateApi.patchModule(projectId, moduleKey, patch, revRef.current);
      if (!aliveRef.current) return;
      stateRef.current = d.state || {};
      revRef.current = d.revision || 0;
      setState(stateRef.current);
      setRevision(revRef.current);
      setConflict(null);
      setStatus('saved');
      setTimeout(() => { if (aliveRef.current) setStatus((s) => (s === 'saved' ? 'idle' : s)); }, 1500);
    } catch (e) {
      if (!aliveRef.current) return;
      if (e.status === 409 && e.body) {
        // Refetch the server's current state; surface the conflict (no overwrite).
        stateRef.current = e.body.currentState || {};
        revRef.current = e.body.currentRevision || 0;
        setState(stateRef.current);
        setRevision(revRef.current);
        setConflict({
          currentState: e.body.currentState || {},
          currentRevision: e.body.currentRevision || 0,
          updatedBy: e.body.updatedBy || null,
          updatedAt: e.body.updatedAt || null,
        });
        setStatus('conflict');
      } else {
        setStatus('error');
      }
    }
  }, [projectId, moduleKey]);

  // Optimistic local update + debounced server patch.
  const update = useCallback((patch) => {
    if (!patch || typeof patch !== 'object') return;
    pendingRef.current = { ...pendingRef.current, ...patch };
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, debounceMs);
  }, [flush, debounceMs]);

  // Accept the server's version after a conflict (caller may re-apply its edits).
  const dismissConflict = useCallback(() => { setConflict(null); setStatus('idle'); }, []);

  return { state, revision, status, conflict, update, flush, dismissConflict, setState };
}
