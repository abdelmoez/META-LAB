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
    if (!heartbeat) {
      // Listen-only: another component (e.g. the embedded Screening engine) owns
      // the heartbeat for this room. The server only pokes OTHER members on a
      // heartbeat, so to see the live list — including OURSELVES — we refetch now,
      // again shortly after (to catch our own heartbeat landing post-mount), then
      // poll as a safety net on top of the realtime pokes. Without this the header
      // shows "no one online" on the Screening tab even though we're present.
      refetch();
      const catchUp = setTimeout(refetch, 1200);
      const poll = setInterval(refetch, 15000);
      return () => { clearTimeout(catchUp); clearInterval(poll); };
    }
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
  const acquiringRef = useRef(false);        // an acquire() round-trip is in flight
  const pendingReleaseRef = useRef(false);   // release() was requested mid-acquire
  const held = (locks || []).find(l => l.field === field) || null;
  const lockedByOther = held && held.userId !== myUserId ? held : null;

  const release = useCallback(async () => {
    if (!pid || !field) return;
    // If an acquire is still in flight, we don't yet know if we hold the lock — defer:
    // the resolving acquire will release as soon as it learns it succeeded. This closes
    // the focus→blur-before-acquire race that used to ORPHAN a server lock for the session.
    if (acquiringRef.current) { pendingReleaseRef.current = true; return; }
    if (!mineRef.current) return;
    mineRef.current = false;
    try { await screeningApi.releaseLock(pid, { field }); } catch { /* non-fatal */ }
  }, [pid, field]);

  const acquire = useCallback(async () => {
    if (!pid || !field || !enabled) return true;
    acquiringRef.current = true;
    pendingReleaseRef.current = false;
    try {
      const r = await screeningApi.acquireLock(pid, { field });
      mineRef.current = !!r?.ok;
      return !!r?.ok;
    } catch {
      mineRef.current = false; // fail-open for editing, but we hold no server lock
      return true;
    } finally {
      acquiringRef.current = false;
      // A blur/idle happened during the round-trip → release the lock we just learned we hold.
      if (pendingReleaseRef.current) { pendingReleaseRef.current = false; release(); }
    }
  }, [pid, field, enabled, release]);

  return { lockedByOther, acquire, release };
}

// How long a field stays locked after the LAST keystroke before it auto-releases.
// prompt44 item 5 — "the lock should only remain while the user is actively typing":
// short enough to feel live, long enough to bridge normal typing pauses.
const FIELD_IDLE_MS = 5000;

/**
 * useFieldEditing — the active-typing lifecycle on top of useFieldLock (prompt44
 * item 5). Returns input handlers that make a field behave like chat-style live
 * editing for the server-backed workflow state:
 *
 *   - onFocus    → claim the field immediately (teammates instantly see "X is editing")
 *                   and arm the idle timer;
 *   - onActivity → call on every keystroke: re-claim if a prior idle released it, and
 *                   re-arm the idle timer (so the lock is held WHILE typing). The
 *                   30s presence heartbeat refreshes the server lock during long typing,
 *                   so we never spam the server per keystroke;
 *   - onBlur     → release immediately;
 *   - idle       → after FIELD_IDLE_MS with no keystroke the lock auto-releases even if
 *                   the field keeps focus, so a parked cursor never traps the field;
 *   - unmount    → release (tab close / hard disconnect is also covered by the server TTL).
 *
 * Everything is fail-open: a lock error never blocks the user from typing.
 */
export function useFieldEditing({ pid, field, myUserId, locks, enabled = true, idleMs = FIELD_IDLE_MS }) {
  const { lockedByOther, acquire, release } = useFieldLock({ pid, field, myUserId, locks, enabled });
  const idleRef = useRef(null);
  const heldRef = useRef(false);

  const clearIdle = useCallback(() => {
    if (idleRef.current) { clearTimeout(idleRef.current); idleRef.current = null; }
  }, []);
  const releaseNow = useCallback(() => {
    clearIdle();
    if (heldRef.current) { heldRef.current = false; release(); }
  }, [clearIdle, release]);
  // Claim (if not already mine) + (re)arm the idle auto-release. Used for both focus
  // and keystrokes — claiming is idempotent server-side.
  const touch = useCallback(() => {
    if (!enabled || !pid || !field) return;
    if (!heldRef.current) { heldRef.current = true; acquire(); }
    clearIdle();
    idleRef.current = setTimeout(() => { releaseNow(); }, idleMs);
  }, [enabled, pid, field, acquire, clearIdle, releaseNow, idleMs]);

  useEffect(() => releaseNow, [releaseNow]); // release on unmount

  return { lockedByOther, onFocus: touch, onActivity: touch, onBlur: releaseNow, releaseNow };
}
