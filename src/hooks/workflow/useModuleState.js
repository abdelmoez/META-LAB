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
 * Robustness (prompt38 review): a single in-flight send is serialized (no
 * overlapping flushes → no spurious self-409); pending fields are only cleared
 * AFTER a successful response (overlap/failure never drops edits); the server
 * echo is re-merged with still-pending edits (no dropped keystrokes mid-round-
 * trip); a 409's rejected fields are kept + surfaced for recovery; and a pending
 * debounced patch is flushed on unmount (no loss on tab switch / nav).
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
  const inFlightRef = useRef(false);
  const aliveRef = useRef(true);
  const flushRef = useRef(() => {});
  const pidRef = useRef(projectId); pidRef.current = projectId;
  const mkRef = useRef(moduleKey); mkRef.current = moduleKey;

  // Flush any pending (debounced, unsent) patch on unmount — fire-and-forget so a
  // tab switch / programmatic nav never loses the last edit.
  useEffect(() => () => {
    aliveRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (Object.keys(pendingRef.current).length && pidRef.current) {
      workflowStateApi.patchModule(pidRef.current, mkRef.current, { ...pendingRef.current }, revRef.current).catch(() => {});
      pendingRef.current = {};
    }
  }, []);

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
    // Serialize: if a send is already in flight, re-arm and let pending accumulate.
    if (inFlightRef.current) { timerRef.current = setTimeout(() => flushRef.current(), debounceMs); return; }
    const keys = Object.keys(pendingRef.current);
    if (keys.length === 0) return;
    const snapshot = { ...pendingRef.current }; // do NOT clear pending until success
    inFlightRef.current = true;
    if (aliveRef.current) setStatus('saving');
    let ok = false;
    try {
      const d = await workflowStateApi.patchModule(projectId, moduleKey, snapshot, revRef.current);
      // Clear only the snapshotted keys that were NOT re-typed during the round-trip.
      for (const k of keys) if (pendingRef.current[k] === snapshot[k]) delete pendingRef.current[k];
      revRef.current = d.revision || 0;
      // Re-apply still-pending edits on top of the server echo (no dropped keystrokes).
      stateRef.current = { ...(d.state || {}), ...pendingRef.current };
      ok = true;
      if (aliveRef.current) {
        setRevision(revRef.current);
        setState(stateRef.current);
        setConflict(null);
        const more = Object.keys(pendingRef.current).length > 0;
        setStatus(more ? 'saving' : 'saved');
        if (!more) setTimeout(() => { if (aliveRef.current) setStatus((s) => (s === 'saved' ? 'idle' : s)); }, 1500);
      }
    } catch (e) {
      if (e.status === 409 && e.body) {
        // Adopt the fresh base revision (so a retry can succeed) but KEEP the
        // rejected fields in pending — they are not lost — and surface them.
        revRef.current = e.body.currentRevision || 0;
        stateRef.current = { ...(e.body.currentState || {}), ...pendingRef.current };
        if (aliveRef.current) {
          setRevision(revRef.current);
          setState(stateRef.current);
          setConflict({
            currentState: e.body.currentState || {},
            currentRevision: e.body.currentRevision || 0,
            updatedBy: e.body.updatedBy || null,
            updatedAt: e.body.updatedAt || null,
            yourEdit: snapshot,
          });
          setStatus('conflict');
        }
      } else if (aliveRef.current) {
        setStatus('error'); // pending kept → a later edit/flush retries
      }
    } finally {
      inFlightRef.current = false;
      // Only auto-continue after a clean save; on conflict/error wait for the user.
      if (ok && Object.keys(pendingRef.current).length > 0 && aliveRef.current) {
        timerRef.current = setTimeout(() => flushRef.current(), debounceMs);
      }
    }
  }, [projectId, moduleKey, debounceMs]);
  flushRef.current = flush;

  // Optimistic local update + debounced server patch.
  const update = useCallback((patch) => {
    if (!patch || typeof patch !== 'object') return;
    pendingRef.current = { ...pendingRef.current, ...patch };
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), debounceMs);
  }, [debounceMs]);

  // Accept the server's version after a conflict (the rejected edit stays in
  // `pending` and re-sends on the next edit/flush; the user may also re-type).
  const dismissConflict = useCallback(() => { setConflict(null); setStatus('idle'); }, []);

  return { state, revision, status, conflict, update, flush, dismissConflict, setState };
}
