/**
 * focus/FocusModeContext.jsx — 104.md Part 1.
 *
 * Focus Mode is ONE piece of application state, not a per-page toggle.
 *
 * The whole point of 104.md is that the interface gets out of the way while the
 * researcher works, and STAYS out of the way as they move through the workflow.
 * That only works if the flag lives above the router: a page-local `useState`
 * would reset on every navigation, turning a working mode into the "page-specific
 * gimmick" the prompt explicitly rejects.
 *
 * Persistence is deliberately `sessionStorage`, not `localStorage` and not the
 * server profile:
 *   - it survives navigation and a mid-session refresh (so a reload during deep
 *     work doesn't dump the user back into full chrome),
 *   - it does NOT survive closing the tab, so nobody is silently trapped in a
 *     chrome-less app days later wondering where their navigation went.
 * That is the honest reading of "persist while navigating during the same
 * session … not necessarily forever between separate sessions".
 *
 * The provider renders NOTHING. Chrome components subscribe and hide themselves;
 * the workspace body is untouched, which is what keeps the transition free of
 * remounts (§"do not recreate expensive components unnecessarily").
 */
import {
  createContext, useContext, useState, useCallback, useEffect, useMemo, useRef,
} from 'react';

const KEY = 'pecanrev.focusMode';

const FocusModeContext = createContext(null);

/**
 * "Does Focus Mode apply on this surface?" — provided by the shell, SYNCHRONOUSLY.
 *
 * This is deliberately separate from the state context and deliberately not an
 * effect-driven registration: whether the control should render is a property of
 * the tree being rendered, so it must be known during that render. Deriving it
 * from a mount effect instead would mean a first paint with no control (a visible
 * flicker) and would make the control invisible to server-rendered tests.
 */
const FocusSurfaceContext = createContext(false);

export function FocusSurface({ enabled, children }) {
  return <FocusSurfaceContext.Provider value={!!enabled}>{children}</FocusSurfaceContext.Provider>;
}

/** True when the enclosing shell declared itself focusable. */
export function useFocusAvailable() {
  return useContext(FocusSurfaceContext);
}

function readStored() {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    // Private-mode / blocked storage must never break the app: default to OFF.
    return false;
  }
}

function writeStored(on) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (on) sessionStorage.setItem(KEY, '1');
    else sessionStorage.removeItem(KEY);
  } catch { /* storage is a convenience here, never a requirement */ }
}

/**
 * True when the event target is a text-entry surface. Copied in spirit from
 * screening/hooks/useScreeningShortcuts.js — a shortcut that fires while someone
 * is typing in the manuscript editor is a bug, not a feature.
 */
export function isTypingTarget(el) {
  if (!el || typeof el !== 'object') return false;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Does this keyboard event mean "toggle Focus Mode"?
 *
 * Ctrl/Cmd+Shift+F. Chosen because it is not a browser default on any major
 * platform (plain Ctrl+F is Find and is left alone; Cmd+Ctrl+F is macOS native
 * fullscreen and is left alone), and because Shift makes it hard to hit by
 * accident mid-sentence. Exported so the test suite and the tooltip label can
 * agree with the handler rather than each restating the combination.
 */
export function isFocusToggleEvent(e) {
  if (!e || !e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (e.altKey) return false;
  const k = (e.key || '').toLowerCase();
  return k === 'f';
}

/** Platform-appropriate label for the shortcut, for tooltips and aria text. */
export function focusShortcutLabel() {
  const mac = typeof navigator !== 'undefined'
    && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  return mac ? '⌘⇧F' : 'Ctrl+Shift+F';
}

export function FocusModeProvider({ children, initial = null }) {
  const [focus, setFocusState] = useState(() => (initial == null ? readStored() : !!initial));
  // Ref-count of mounted focusable surfaces. Used ONLY to decide whether the
  // keyboard shortcut should claim its combination — a DOM-time question, so an
  // effect is the right tool. Whether the BUTTON renders is answered synchronously
  // by FocusSurfaceContext instead.
  const availCount = useRef(0);

  const setFocus = useCallback((on) => {
    setFocusState((prev) => {
      const next = typeof on === 'function' ? !!on(prev) : !!on;
      if (next !== prev) writeStored(next);
      return next;
    });
  }, []);

  const toggleFocus = useCallback(() => setFocus((p) => !p), [setFocus]);
  const exitFocus = useCallback(() => setFocus(false), [setFocus]);

  /** A focusable shell registers on mount so the shortcut knows it has a target. */
  const registerSurface = useCallback(() => {
    availCount.current += 1;
    return () => { availCount.current = Math.max(0, availCount.current - 1); };
  }, []);

  // Global shortcut + Escape. One listener for the whole app, mounted once.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (isFocusToggleEvent(e)) {
        // Only claim the combination where the feature exists, so on a page with
        // no shell the browser keeps whatever it would normally do.
        if (!availCount.current) return;
        e.preventDefault();
        toggleFocus();
        return;
      }
      // Escape leaves Focus Mode — but only when nothing nearer wants it. A modal,
      // popover or tooltip that handles Escape calls stopPropagation/preventDefault
      // (see components/Modal.jsx, stitch/primitives/overlay.jsx), and a listener on
      // `window` in the BUBBLE phase runs last, so by the time we see the event the
      // closer overlay has already dealt with it. Typing targets are excluded so a
      // researcher pressing Escape to dismiss an autocomplete keeps their layout.
      if (e.key === 'Escape' && !e.defaultPrevented) {
        if (isTypingTarget(e.target)) return;
        setFocusState((prev) => {
          if (!prev) return prev;
          writeStored(false);
          return false;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFocus]);

  // A body-level attribute lets CSS respond (e.g. reclaiming the shell's padding)
  // without threading the flag through every stylesheet.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.documentElement) return undefined;
    const el = document.documentElement;
    if (focus) el.setAttribute('data-focus-mode', 'on');
    else el.removeAttribute('data-focus-mode');
    return () => el.removeAttribute('data-focus-mode');
  }, [focus]);

  const value = useMemo(() => ({
    focus, setFocus, toggleFocus, exitFocus, registerSurface,
  }), [focus, setFocus, toggleFocus, exitFocus, registerSurface]);

  return <FocusModeContext.Provider value={value}>{children}</FocusModeContext.Provider>;
}

/**
 * Focus Mode state. Safe outside the provider (tests, storybook-ish renders,
 * legacy trees): returns a permanently-off, no-op shape rather than throwing, so
 * adding a `useFocusMode()` call to a shared component can never crash a surface
 * that hasn't been wrapped yet.
 */
export function useFocusMode() {
  const ctx = useContext(FocusModeContext);
  if (ctx) return ctx;
  return OFF;
}

const noop = () => {};
const OFF = {
  focus: false,
  setFocus: noop,
  toggleFocus: noop,
  exitFocus: noop,
  registerSurface: () => noop,
};

/**
 * Declare that the calling shell supports Focus Mode, for as long as it is
 * mounted. Returns the same context object so a shell needs one hook, not two.
 */
export function useFocusSurface(enabled = true) {
  const ctx = useFocusMode();
  const { registerSurface } = ctx;
  useEffect(() => {
    if (!enabled) return undefined;
    return registerSurface();
  }, [enabled, registerSurface]);
  return ctx;
}

export default FocusModeProvider;
