/**
 * features/extraction/engine/useExtractionSplit.js — 76.md §8.
 *
 * The draggable PDF↔form split for the Pecan Extraction Engine workspace, ported from
 * the proven RobWorkspace split (keyboard-accessible, CSS-var-driven so a drag never
 * re-renders React, per-user persisted). Own storage key so it does not clash with RoB.
 * Default 55% PDF / 45% form (the form needs room for arm/value grids).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SPLIT_MIN_PDF = 0.22;
const SPLIT_MAX_PDF = 0.80;
const SPLIT_DEFAULT = 0.55;
const SPLIT_STORAGE_KEY = 'metalab.extraction.splitRatio';
const SPLIT_DIVIDER_PX = 16;

export function clampSplit(v) { return Math.min(SPLIT_MAX_PDF, Math.max(SPLIT_MIN_PDF, v)); }
function readSplitRatio() {
  try { const v = parseFloat(localStorage.getItem(SPLIT_STORAGE_KEY)); return (v >= SPLIT_MIN_PDF && v <= SPLIT_MAX_PDF) ? v : SPLIT_DEFAULT; } catch { return SPLIT_DEFAULT; }
}

/**
 * useExtractionSplit(rowRef, cssVar) — returns { ratio, dragging, onPointerDown, reset,
 * nudge } and writes `cssVar` (default '--pex-pdf-pct') on rowRef during drag.
 */
export function useExtractionSplit(rowRef, cssVar = '--pex-pdf-pct') {
  const [ratio, setRatio] = useState(readSplitRatio);
  const [dragging, setDragging] = useState(false);
  const rafRef = useRef(0);
  const teardownRef = useRef(null);
  const applyVar = useCallback((v) => { const el = rowRef.current; if (el) el.style.setProperty(cssVar, `${(v * 100).toFixed(3)}%`); }, [rowRef, cssVar]);
  useEffect(() => { applyVar(ratio); }, [ratio, applyVar]);
  const persist = (v) => { try { localStorage.setItem(SPLIT_STORAGE_KEY, String(v)); } catch { /* best-effort */ } };

  const onPointerDown = useCallback((e) => {
    const el = rowRef.current; if (!el) return;
    e.preventDefault();
    try { e.currentTarget && e.currentTarget.focus && e.currentTarget.focus(); } catch { /* ignore */ }
    const rect = el.getBoundingClientRect();
    let last = ratio;
    setDragging(true);
    const move = (ev) => {
      last = clampSplit((ev.clientX - rect.left - SPLIT_DIVIDER_PX / 2) / Math.max(1, rect.width));
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => applyVar(last));
    };
    const end = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      teardownRef.current = null;
      setDragging(false);
      setRatio(last); persist(last);
    };
    teardownRef.current = () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [ratio, applyVar, rowRef]);

  useEffect(() => () => { if (teardownRef.current) teardownRef.current(); }, []);

  const reset = useCallback(() => { setRatio(SPLIT_DEFAULT); persist(SPLIT_DEFAULT); }, []);
  const nudge = useCallback((delta) => { setRatio((r) => { const v = clampSplit(r + delta); persist(v); return v; }); }, []);
  return { ratio, dragging, onPointerDown, reset, nudge, min: SPLIT_MIN_PDF, max: SPLIT_MAX_PDF };
}

export default useExtractionSplit;
