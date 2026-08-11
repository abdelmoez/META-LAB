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
  // Key repeat is NOT a second press. Holding the combination down fires keydown
  // at the OS repeat rate, and a toggle driven by that machine-guns the layout
  // (and, since 114.md, the browser's own fullscreen) dozens of times a second.
  // One physical press, one toggle.
  if (e.repeat) return false;
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

/* ═══════════════ true browser fullscreen — 114.md §1 ═══════════════ */

/**
 * The Fullscreen API, wrapped.
 *
 * 114.md §1 layers REAL fullscreen on top of the existing layout mode: the same
 * chrome disappears from the app, and the browser's own chrome (tabs, address
 * bar, bookmarks) goes with it. Three things make that delicate, and all three
 * live here rather than being smeared through the provider:
 *
 *   - it can FAIL. A permissions policy, an iframe without `allow="fullscreen"`,
 *     a kiosk/enterprise policy, or a call with no user activation all reject.
 *     That is NOT an error state: Focus Mode simply falls back to exactly the
 *     viewport-only behaviour it had before, and the page must never break.
 *     Every path below swallows its failure.
 *   - fullscreen can end WITHOUT us — the browser's own Escape, F11, the OS. If
 *     we don't listen, the UI sits in a false "full screen" state with no chrome
 *     and no way back that matches what the user just did.
 *   - it is not necessarily OURS. A <video> going fullscreen fires the very same
 *     event; that must never toggle a researcher's Focus Mode. Hence `owned`.
 *
 * We always fullscreen `documentElement`, never the shell div: navigating inside
 * Focus Mode remounts shell subtrees, and a fullscreen element that leaves the
 * document ejects fullscreen with it. The root is also why the transition keeps
 * `document.activeElement` (114.md §7 — "focus is not lost"), and why the UA's
 * `:not(:root):fullscreen { background: black }` rule never touches us.
 *
 * It is exported and parameterised on `doc` because this repo runs no jsdom: the
 * whole contract is unit-tested against a hand-rolled document, exactly the way
 * usePageHead's applyHead is (tests/unit/seo/usePageHead.test.js).
 */
export function createFullscreenBridge(doc) {
  // Three facts, deliberately NOT collapsed into one boolean — the r2 review
  // found a real bug for each pair that used to be conflated:
  //
  //   wanted  — INTENT. What the app last asked for, known the instant it asks.
  //             This is the authority: a grant that lands after the user already
  //             toggled off must undo itself rather than strand the browser in
  //             fullscreen with the app's layout back to normal.
  //   pending — a request is in flight and has not been observed to land. Cleared
  //             by the first change event, by the request settling, or by a
  //             fullscreenerror.
  //   owned   — we have OBSERVED our own element in fullscreen. Never assumed at
  //             call time: prefixed WebKit refuses silently (undefined return, no
  //             rejection, no event), and an optimistic `owned = true` there left
  //             a stale claim that a FOREIGN video's exit would then cash in.
  let wanted = false;
  let pending = false;
  let owned = false;

  const root = () => (doc ? doc.documentElement : null);

  const element = () => {
    if (!doc) return null;
    return doc.fullscreenElement || doc.webkitFullscreenElement || null;
  };

  /** Is the thing currently in fullscreen OUR element (the document root)? */
  const oursIsFullscreen = () => {
    const r = root();
    return !!r && element() === r;
  };

  /** Raw exitFullscreen. No bookkeeping — callers decide whether it is theirs. */
  const rawExit = () => {
    const exit = doc && (doc.exitFullscreen || doc.webkitExitFullscreen);
    if (typeof exit !== 'function') return Promise.resolve(false);
    try {
      return Promise.resolve(exit.call(doc)).then(() => true, () => false);
    } catch {
      return Promise.resolve(false);
    }
  };

  /**
   * Reconcile our bookkeeping with what the document actually shows, and answer
   * "did OUR fullscreen just end without us asking?".
   *
   * Called from the change listener AND from the request settling, because the
   * two orders both happen in the wild: a real browser fires fullscreenchange
   * and then resolves the promise, while old WebKit returns undefined and may
   * never fire anything at all.
   */
  const observe = () => {
    if (oursIsFullscreen()) {
      // Only a request of OURS can arm ownership. Somebody else fullscreening
      // the document root is possible and is not ours to end.
      if (pending || wanted) owned = true;
      pending = false;
      // INTENT WINS. The whole pre-grant window is a hole the old code fell
      // through: leave() saw nothing fullscreen, returned without exiting, and
      // the grant that landed a moment later was simply ignored — browser
      // fullscreen with the chrome back and no state saying so. Undo it here.
      if (owned && !wanted) {
        owned = false;
        rawExit();
      }
      return false;
    }
    // Not ours: nothing is fullscreen, or somebody else's element is.
    pending = false;
    if (!owned) return false;
    owned = false;
    return true;
  };

  /** Best-effort enter. Resolves false (never throws, never rejects) on refusal. */
  const enter = () => {
    const r = root();
    const req = r && (r.requestFullscreen || r.webkitRequestFullscreen);
    if (typeof req !== 'function') {
      // Unsupported ⇒ the viewport-only fallback. There is no intent to track:
      // no grant is ever coming, so nothing must be undone later.
      wanted = false;
      pending = false;
      return Promise.resolve(false);
    }
    wanted = true;
    pending = true;
    const refused = () => { pending = false; wanted = false; return false; };
    try {
      // Older WebKit returns undefined rather than a promise — Promise.resolve
      // normalises both shapes.
      return Promise.resolve(req.call(r)).then(() => {
        // The settle is evidence too. observe() arms ownership if the grant is
        // real, and performs the deferred exit if the user has since left.
        observe();
        return owned;
      }, refused);
    } catch {
      return Promise.resolve(refused());
    }
  };

  /** Best-effort leave. Safe to call twice — nothing of ours ⇒ nothing to do. */
  const leave = () => {
    // Drop the intent FIRST and unconditionally: even when there is nothing to
    // exit yet, a grant still in flight now knows to exit itself on arrival.
    wanted = false;
    const wasOurs = owned;
    owned = false;
    // Only exit what we put there. A <video> the researcher opened fullscreen
    // is not ours to close just because they left Focus Mode.
    if (!wasOurs) return Promise.resolve(false);
    if (!element()) return Promise.resolve(false);
    return rawExit();
  };

  /**
   * Subscribe to the fullscreen lifecycle.
   *
   * @param {function} onOursEnded fired once when OUR fullscreen ends without us
   *        asking (browser Escape, F11, the OS, an overlay dismissal).
   * @param {function} [onChange]  fired after EVERY reconciliation — enter, exit,
   *        foreign, or error — so a subscriber can mirror `isOwned()` into state.
   */
  const attach = (onOursEnded, onChange) => {
    if (!doc || typeof doc.addEventListener !== 'function') return () => {};
    const ping = () => { if (typeof onChange === 'function') onChange(); };
    const handler = () => {
      const ended = observe();
      ping();
      if (ended && typeof onOursEnded === 'function') onOursEnded();
    };
    // A request can die without ever producing a change event: a permissions
    // policy, an iframe with no `allow="fullscreen"`, a kiosk lock. Dropping the
    // intent here is what stops a later, unrelated fullscreen being mistaken for
    // the grant we were still waiting on.
    const onError = () => { pending = false; wanted = false; ping(); };
    doc.addEventListener('fullscreenchange', handler);
    doc.addEventListener('webkitfullscreenchange', handler);
    doc.addEventListener('fullscreenerror', onError);
    doc.addEventListener('webkitfullscreenerror', onError);
    return () => {
      doc.removeEventListener('fullscreenchange', handler);
      doc.removeEventListener('webkitfullscreenchange', handler);
      doc.removeEventListener('fullscreenerror', onError);
      doc.removeEventListener('webkitfullscreenerror', onError);
    };
  };

  return {
    enter, leave, attach, element, isOwned: () => owned, isWanted: () => wanted,
  };
}

export function FocusModeProvider({ children, initial = null }) {
  const [focus, setFocusState] = useState(() => (initial == null ? readStored() : !!initial));
  // Focus Mode and browser fullscreen are two different things that usually move
  // together and sometimes do NOT: a refused request, a reload, F11, an Escape
  // aimed at an overlay. Exposing the observed fullscreen state separately is
  // what lets the controls describe the state the user is actually in instead of
  // promising to "leave full screen" from a windowed page (114-r2 §5).
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Ref-count of mounted focusable surfaces. Used ONLY to decide whether the
  // keyboard shortcut should claim its combination — a DOM-time question, so an
  // effect is the right tool. Whether the BUTTON renders is answered synchronously
  // by FocusSurfaceContext instead.
  const availCount = useRef(0);
  // Mirrors `focus` for the imperative paths. setFocus has to know the current
  // value SYNCHRONOUSLY, because the fullscreen request must happen inside the
  // click's user-activation window — a functional setState updater cannot promise
  // that (it may run later, or twice under StrictMode, and must stay pure).
  const focusRef = useRef(focus);
  const fsRef = useRef(null);
  if (fsRef.current === null) {
    fsRef.current = createFullscreenBridge(typeof document === 'undefined' ? null : document);
  }
  // When `focus` last actually changed, so a control that MOUNTS as a result of
  // the change can tell that apart from a first paint (114.md §7 — see
  // FocusToggle). 0 means "never toggled this page-load", which is also the
  // state after a sessionStorage restore: a restore must not move focus.
  const changedAtRef = useRef(0);

  /** Mirror the bridge's observed ownership into render state. Idempotent. */
  const syncFullscreen = useCallback(() => {
    setIsFullscreen(!!(fsRef.current && fsRef.current.isOwned()));
  }, []);

  const setFocus = useCallback((on) => {
    const prev = focusRef.current;
    const next = typeof on === 'function' ? !!on(prev) : !!on;
    // Idempotent by construction: every exit path (button, Esc, exitFocus, the
    // browser's own fullscreenchange) can fire together and only the first lands.
    if (next === prev) return;
    focusRef.current = next;
    changedAtRef.current = Date.now();
    writeStored(next);
    setFocusState(next);
    // Layout first (above), then the browser. Deliberately fire-and-forget: a
    // refusal leaves the researcher in the viewport-only Focus Mode that shipped
    // before 114.md rather than throwing an unhandled rejection at them.
    //
    // NOTE the asymmetry with a RELOAD: `focus` restored from sessionStorage puts
    // the layout back, but no browser will grant fullscreen without a fresh user
    // gesture, so the page comes back focused-but-windowed. That is the documented
    // fallback — the alternative is a hack that fakes a gesture, and there isn't
    // an honest one. The focus bar's "Enter full screen" button (which only
    // appears in exactly that windowed state) is the way back up.
    const settled = next ? fsRef.current.enter() : fsRef.current.leave();
    settled.then(syncFullscreen, syncFullscreen);
  }, [syncFullscreen]);

  const toggleFocus = useCallback(() => setFocus((p) => !p), [setFocus]);
  const exitFocus = useCallback(() => setFocus(false), [setFocus]);

  /**
   * Re-request real fullscreen while already focused — the only honest answer to
   * the windowed-focus states (a reload, a refusal, an external exit), because a
   * fresh user gesture is exactly what the browser was missing. Entering Focus
   * Mode first if it is off keeps one entry point for callers.
   */
  const enterFullscreen = useCallback(() => {
    if (!focusRef.current) { setFocus(true); return; }
    fsRef.current.enter().then(syncFullscreen, syncFullscreen);
  }, [setFocus, syncFullscreen]);

  /** A focusable shell registers on mount so the shortcut knows it has a target. */
  const registerSurface = useCallback(() => {
    availCount.current += 1;
    return () => { availCount.current = Math.max(0, availCount.current - 1); };
  }, []);

  // `focus` only ever changes through setFocus, which writes the ref first — but
  // keeping them married here means no future caller can desynchronise them.
  useEffect(() => { focusRef.current = focus; }, [focus]);

  // Global shortcut + Escape + the browser's own fullscreen exits. One listener
  // set for the whole app, mounted once.
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
        // Goes through exitFocus so ONE exit path releases both the layout and
        // real fullscreen; already-off is a no-op inside setFocus.
        exitFocus();
      }
    };
    window.addEventListener('keydown', onKey);
    // Browser-Escape, F11 and OS-level exits end fullscreen without ever touching
    // our state. 114.md §1 says the UI must not remain in a false full-screen
    // state — and that is ALL it says. It does NOT say the layout must collapse.
    //
    // 114-r2 §2: it must not. Escape inside fullscreen is not interceptable — the
    // browser exits whatever the page does with the event — so a researcher
    // dismissing a modal or an autocomplete produces exactly this event. Tearing
    // the whole focus layout down there ejected them from a mode they never asked
    // to leave. So we degrade to the documented focused-but-windowed state: the
    // false fullscreen claim is dropped (syncFullscreen re-reads the bridge, the
    // exit copy stops promising to leave a full screen we are not in), and no
    // layout state changes. Plain Escape still exits Focus Mode entirely through
    // the window keydown handler above, which is idempotent alongside this one.
    const detachFullscreen = fsRef.current.attach(syncFullscreen, syncFullscreen);
    return () => {
      window.removeEventListener('keydown', onKey);
      detachFullscreen();
    };
  }, [toggleFocus, exitFocus, syncFullscreen]);

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
    focus, isFullscreen, setFocus, toggleFocus, exitFocus, enterFullscreen, registerSurface,
    // Read through the memo rather than held as state: it changes exactly when
    // `focus` does, so the memo already recomputes at the right moment and the
    // provider avoids a second render for a value only an effect ever reads.
    focusChangedAt: changedAtRef.current,
  }), [focus, isFullscreen, setFocus, toggleFocus, exitFocus, enterFullscreen, registerSurface]);

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
  isFullscreen: false,
  focusChangedAt: 0,
  setFocus: noop,
  toggleFocus: noop,
  exitFocus: noop,
  enterFullscreen: noop,
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
