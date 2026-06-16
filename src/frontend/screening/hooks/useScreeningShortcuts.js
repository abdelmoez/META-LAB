/**
 * useScreeningShortcuts.js — attaches a single window keydown listener for
 * user-configurable screening keyboard shortcuts.
 *
 * Guards (shortcuts do NOT fire when):
 *   - `enabled` is false
 *   - a modifier key (Ctrl / Meta / Alt) is held
 *   - the event target / activeElement is INPUT, TEXTAREA, SELECT, or contenteditable
 *   - the focus is inside an element with class `sift-in`
 */
import { useEffect, useRef } from 'react';

/**
 * @param {object} opts
 * @param {boolean}  opts.enabled    — master on/off switch
 * @param {object}   opts.keys       — map of action → key string
 * @param {Function} opts.onNext
 * @param {Function} opts.onPrev
 * @param {Function} opts.onInclude
 * @param {Function} opts.onExclude
 * @param {Function} opts.onMaybe
 * @param {Function} opts.onUndo
 */
export function useScreeningShortcuts({ enabled, keys, onNext, onPrev, onInclude, onExclude, onMaybe, onUndo }) {
  // Store the latest handlers in refs so the listener never re-binds on each render.
  const ref = useRef({});
  ref.current = { enabled, keys, onNext, onPrev, onInclude, onExclude, onMaybe, onUndo };

  useEffect(() => {
    function onKey(e) {
      const { enabled, keys, onNext, onPrev, onInclude, onExclude, onMaybe, onUndo } = ref.current;
      if (!enabled) return;

      // Modifier guard
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Active-element guard
      const el = document.activeElement;
      if (el) {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (el.isContentEditable) return;
        // Guard against any ancestor (or self) carrying the .sift-in class
        if (el.closest && el.closest('.sift-in')) return;
      }

      const pressed = e.key; // exact for arrows; compare lowercase for letters
      const pressedLower = pressed.toLowerCase();

      // Check each action — arrow keys use exact match, letters use lowercase
      if (pressed === keys.next)               { e.preventDefault(); onNext?.(); }
      else if (pressed === keys.previous)      { e.preventDefault(); onPrev?.(); }
      else if (pressedLower === keys.include.toLowerCase()) { e.preventDefault(); onInclude?.(); }
      else if (pressedLower === keys.exclude.toLowerCase()) { e.preventDefault(); onExclude?.(); }
      else if (pressedLower === keys.maybe.toLowerCase())   { e.preventDefault(); onMaybe?.(); }
      else if (pressedLower === keys.undo.toLowerCase())    { e.preventDefault(); onUndo?.(); }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Intentionally empty dep array — listener is stable, reads via ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
