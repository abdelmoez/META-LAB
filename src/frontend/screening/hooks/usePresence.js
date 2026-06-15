/**
 * usePresence.js — client side of project presence + field locking (prompt23
 * Tasks 5/13/14/15). ONE instance per open project (owned by SiftProject) is
 * enough: it heartbeats the user's current location, exposes who else is here and
 * which fields are locked, and refetches on realtime pokes.
 *
 * Everything is best-effort and fail-safe: if the presence endpoints error (or
 * the feature is off), the app behaves exactly as before — no presence shown, no
 * locks enforced. Hard tab/browser closes are covered by the server-side TTL.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRealtime } from '../../hooks/useRealtime.js';
import { screeningApi } from '../api-client/screeningApi.js';

const HEARTBEAT_MS = 30000;

export function useProjectPresence(pid, location, { enabled = true, heartbeat = true } = {}) {
  // `heartbeat:false` = LISTEN-ONLY (prompt24 Task 2/9). The universal project
  // header keeps a live presence LIST on every page — including the Screening
  // stage — but on Screening the embedded SiftProject owns the (fine-grained)
  // heartbeat, so the header must not also beat or it would overwrite the precise
  // "Screening · Title & Abstract" location with the coarse "Screening" one.
  const [users, setUsers] = useState([]);
  const [locks, setLocks] = useState([]);
  const locationRef = useRef(location);
  locationRef.current = location;

  const apply = useCallback((snap) => {
    if (!snap) return;
    if (Array.isArray(snap.users)) setUsers(snap.users);
    if (Array.isArray(snap.locks)) setLocks(snap.locks);
  }, []);

  const refetch = useCallback(async () => {
    if (!pid || !enabled) return;
    try { apply(await screeningApi.getPresence(pid)); } catch { /* non-fatal */ }
  }, [pid, enabled, apply]);

  const beat = useCallback(async () => {
    if (!pid || !enabled) return;
    try { apply(await screeningApi.presenceHeartbeat(pid, { location: locationRef.current })); }
    catch { /* non-fatal — degrade silently */ }
  }, [pid, enabled, apply]);

  // Heartbeat on mount + interval; announce leave on unmount / tab hide.
  // Listen-only mode skips all writes but still loads the snapshot once (realtime
  // pokes keep it fresh afterwards).
  useEffect(() => {
    if (!pid || !enabled) return undefined;
    if (!heartbeat) { refetch(); return undefined; }
    beat();
    const t = setInterval(beat, HEARTBEAT_MS);
    const onVis = () => {
      if (document.visibilityState === 'hidden') screeningApi.presenceLeave(pid).catch(() => {});
      else beat();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      screeningApi.presenceLeave(pid).catch(() => {});
    };
  }, [pid, enabled, heartbeat, beat, refetch]);

  // Location change → immediate heartbeat so teammates see the move quickly
  // (no-op in listen-only mode).
  const firstLoc = useRef(true);
  useEffect(() => {
    if (firstLoc.current) { firstLoc.current = false; return; }
    if (heartbeat) beat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Realtime: refetch the snapshot when someone joins/leaves or a lock changes.
  useRealtime({
    'presence.changed': (ev) => { if (!ev || ev.projectId === pid || ev.projectId === undefined) refetch(); },
    'lock.changed':     (ev) => { if (!ev || ev.projectId === pid || ev.projectId === undefined) refetch(); },
  });

  return { users, locks, refetch };
}

/**
 * Field-lock controls for one editable field, derived from the shared presence
 * `locks` (so the badge updates in realtime) plus acquire/release actions.
 *   lockedByOther — { userId, name } when ANOTHER user holds the field, else null
 * acquire() is FAIL-OPEN: a lock-system error never blocks the user from editing.
 */
export function useFieldLock({ pid, field, myUserId, locks, enabled = true }) {
  const mineRef = useRef(false);
  const held = (locks || []).find(l => l.field === field) || null;
  const lockedByOther = held && held.userId !== myUserId ? held : null;

  const acquire = useCallback(async () => {
    if (!pid || !field || !enabled) return true;
    try {
      const r = await screeningApi.acquireLock(pid, { field });
      mineRef.current = !!r?.ok;
      return !!r?.ok;
    } catch {
      return true; // fail-open
    }
  }, [pid, field, enabled]);

  const release = useCallback(async () => {
    if (!pid || !field || !mineRef.current) return;
    mineRef.current = false;
    try { await screeningApi.releaseLock(pid, { field }); } catch { /* non-fatal */ }
  }, [pid, field]);

  return { lockedByOther, acquire, release };
}
