/**
 * useChipDrag.js — 97.md Phases 6/11 (plan §12, Decision D1). The ONE hand-rolled
 * pointer-events drag hook shared by the term-chip row, the question-token tray
 * and the group navigator. No dnd library; pointer events mean touch works by
 * construction. Esc cancels an in-flight drag.
 *
 * All GEOMETRY/decision logic lives in the pure dndModel.js helpers (unit-tested);
 * this hook only owns the event plumbing and state. Drag is NEVER the only way to
 * do anything — every consumer keeps its keyboard/menu alternative (Phase 21).
 *
 * API:
 *   const drag = useChipDrag({ getGeometry, onDrop, onCancel, disabled });
 *   <button {...drag.handleFor(id, meta)} …/>   // meta rides to onDrop
 *   drag.state → { active, dragId, meta, target, armed, pointer } (null when idle)
 *
 * onDrop(dragInfo, target) fires only for a valid target; a merge target fires
 * only once ARMED (hover threshold — accidental merges stay hard).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  shouldStartDrag, resolveDropTarget, trackMergeHover, mergeArmed,
} from './dndModel.js';

/* 98.md review (M19) — body-level user-select suppression is shared by ALL hook
   instances (question tray + chips + pills coexist): a module-scoped refcount
   prevents a second concurrent drag from capturing the first drag's 'none' as
   its "previous" value and re-pinning it forever. */
let suppressCount = 0;
let savedUserSelect = '';
function suppressSelection() {
  try {
    if (++suppressCount === 1) {
      savedUserSelect = document.body.style.userSelect || '';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    }
  } catch { /* SSR */ }
}
function restoreSelection() {
  try {
    if (suppressCount > 0 && --suppressCount === 0) {
      document.body.style.userSelect = savedUserSelect;
      document.body.style.webkitUserSelect = savedUserSelect;
    }
  } catch { /* SSR */ }
}

export default function useChipDrag({ getGeometry, onDrop, onCancel, disabled, mergeOnly } = {}) {
  const [state, setState] = useState(null); // { active, dragId, meta, target, armed, pointer }
  const sessionRef = useRef(null);          // mutable per-gesture bookkeeping
  const justDraggedRef = useRef(false);     // suppress the click that follows a drag's pointerup
  const cbRef = useRef({}); cbRef.current = { getGeometry, onDrop, onCancel, disabled, mergeOnly };

  const endSession = useCallback((fire) => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setState(null);
    if (s && s.active) {
      // The browser still fires a click after pointerup on the source element —
      // consumers guard their onClick with wasDragClick().
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 0);
    }
    if (!s) return;
    try {
      window.removeEventListener('pointermove', s.onMove);
      window.removeEventListener('pointerup', s.onUp);
      window.removeEventListener('pointercancel', s.onPointerCancel);
      window.removeEventListener('keydown', s.onKey, true);
    } catch { /* listeners best-effort */ }
    // 98.md §15 — restore text selection suppressed for the drag's duration
    // (refcounted; only sessions that actually ACTIVATED suppressed).
    if (s.active) restoreSelection();
    if (fire && s.active && s.target) {
      const isMerge = s.target.kind === 'merge';
      if (!isMerge || mergeArmed(s.hover, Date.now())) {
        const cb = cbRef.current.onDrop;
        if (typeof cb === 'function') cb({ dragId: s.dragId, meta: s.meta }, s.target);
        return;
      }
    }
    if (!fire || !s.target) {
      const cb = cbRef.current.onCancel;
      if (s.active && typeof cb === 'function') cb({ dragId: s.dragId, meta: s.meta });
    }
  }, []);

  // Unmount safety: never leave window listeners behind.
  useEffect(() => () => endSession(false), [endSession]);

  const handleFor = useCallback((id, meta) => ({
    onPointerDown: (e) => {
      if (cbRef.current.disabled) return;
      if (e.button != null && e.button !== 0) return; // primary button / touch only
      if (sessionRef.current) return;
      const start = { x: e.clientX, y: e.clientY };
      const s = {
        dragId: id, meta, start, active: false, target: null, hover: null, geometry: null,
        pointerId: e.pointerId,
        onMove: null, onUp: null, onKey: null, onPointerCancel: null,
      };
      s.onMove = (ev) => {
        // 98.md §15 — a second finger (iPad) must never drive someone else's drag.
        if (s.pointerId != null && ev.pointerId != null && ev.pointerId !== s.pointerId) return;
        const p = { x: ev.clientX, y: ev.clientY };
        if (!s.active) {
          if (!shouldStartDrag(s.start, p)) return;
          s.active = true;
          const getGeo = cbRef.current.getGeometry;
          s.geometry = typeof getGeo === 'function' ? getGeo({ dragId: s.dragId, meta: s.meta }) : null;
          // 98.md §15 — Safari starts a page text selection mid-drag regardless of
          // preventDefault on pointermove; suppress selection at the body for the
          // drag's duration (refcounted module-wide; restored in endSession).
          suppressSelection();
          try { ev.preventDefault(); } catch { /* passive listener */ }
        }
        const target = s.geometry
          ? resolveDropTarget(s.geometry, p, { dragId: s.dragId, mergeOnly: cbRef.current.mergeOnly === true })
          : null;
        s.hover = trackMergeHover(s.hover, target, Date.now());
        s.target = target;
        setState({
          active: true, dragId: s.dragId, meta: s.meta, target,
          armed: target && target.kind === 'merge' ? mergeArmed(s.hover, Date.now()) : false,
          pointer: p,
        });
      };
      s.onUp = (ev) => {
        if (s.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== s.pointerId) return;
        endSession(true);
      };
      // 98.md §15 — iOS Safari fires pointercancel (not pointerup) when the browser
      // claims the gesture (scroll/zoom); without this the session leaked its window
      // listeners and stayed visually active until an unrelated pointerup.
      s.onPointerCancel = (ev) => {
        if (s.pointerId != null && ev && ev.pointerId != null && ev.pointerId !== s.pointerId) return;
        endSession(false);
      };
      s.onKey = (ev) => {
        if (ev.key === 'Escape') { ev.stopPropagation(); endSession(false); }
      };
      sessionRef.current = s;
      try {
        window.addEventListener('pointermove', s.onMove);
        window.addEventListener('pointerup', s.onUp);
        window.addEventListener('pointercancel', s.onPointerCancel);
        window.addEventListener('keydown', s.onKey, true);
      } catch { sessionRef.current = null; }
    },
    // Chips scroll containers on touch unless the gesture is claimed for drag.
    style: { touchAction: 'none' },
  }), [endSession]);

  /** True right after a drag gesture ended — lets onClick handlers on the same
   *  element ignore the click the browser fires after the drag's pointerup. */
  const wasDragClick = useCallback(() => justDraggedRef.current, []);

  return { state, handleFor, cancel: () => endSession(false), wasDragClick };
}
