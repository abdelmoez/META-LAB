/**
 * shortcuts/ShortcutProvider.jsx — 108.md §23. THE keyboard adapter. One window
 * listener for the whole application; every decision it makes is delegated to the
 * pure router (research-engine/interaction/shortcutRouter.js) and the pure
 * editable predicate (research-engine/interaction/editableTarget.js).
 *
 * 108.md §23 is explicit: "Do not keep adding unrelated global
 * window.addEventListener('keydown', …) handlers scattered throughout
 * components." This provider is the replacement. A feature declares a binding —
 * id, tier, match, when, run — and never touches the DOM.
 *
 * ── WHAT THE ADAPTER DOES, IN ORDER ──────────────────────────────────────────
 *   1. `e.defaultPrevented` → return. A nearer handler (a React onKeyDown on the
 *      manuscript editor, a modal's capture-phase Escape) already claimed the
 *      event; the router must never double-handle it. This is what makes tiers
 *      1-2 work for the handlers that have NOT been migrated yet.
 *   2. `e.isComposing` (or keyCode 229) → return. An IME composition keystroke is
 *      not a shortcut; acting on one corrupts CJK/accent input.
 *   3. Build the context: scope + modal state from injected callbacks, editable
 *      state from isEditableTarget(e.target), plus whatever the shell adds
 *      (canUndo/canRedo/hasSelection).
 *   4. Route. No winner → return, and the BROWSER KEEPS ITS DEFAULT. This is
 *      108.md §1's core requirement ("do not globally block Ctrl/Cmd+I") and
 *      §26's "no history → native/no-op behaviour" expressed as one early return.
 *   5. `e.repeat` and the winner does not opt in via `allowRepeat` → return.
 *      Holding Ctrl+Z must not fire 30 undos. Skipping is the default because
 *      almost nothing in this app is safely repeatable.
 *   6. Run the binding. `preventDefault()` fires ONLY when run() reports it
 *      handled the event — never before, never unconditionally.
 *
 * ── ASYNC RUNS ───────────────────────────────────────────────────────────────
 * preventDefault must be synchronous, so `run` must decide synchronously.
 * A binding whose effect is async (undo is a server round-trip) returns a Promise,
 * which is truthy and therefore counts as HANDLED. That is correct only if the
 * binding refuses in `when(ctx)` when it has nothing to do — e.g. the undo binding
 * must gate on `ctx.canUndo`, so that with an empty history it never claims
 * Ctrl+Z and the browser's own undo is left alone.
 *
 * ── PHASE ────────────────────────────────────────────────────────────────────
 * window + BUBBLE, deliberately. Capture would preempt the manuscript editor's
 * native Ctrl+Z and every input in the app. Bubble means the router runs after
 * React's own onKeyDown handlers (React 18 attaches at #root) and after
 * document-level listeners — which is why step 1 exists, and why the one
 * document-bubble incumbent (SearchBuilderTab's Ctrl/Cmd+Z) must MIGRATE into
 * this registry rather than coexist: document-bubble runs before window-bubble
 * and would shadow the router.
 *
 * SSR-safe: no window access at module scope; the listener lives in an effect, so
 * renderToStaticMarkup renders the children and nothing else.
 *
 * NOT MOUNTED YET — Wave 2 mounts it and migrates the first bindings.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef,
} from 'react';
import {
  createRegistry, registerBinding, routeKeydown, TIER,
} from '../../research-engine/interaction/shortcutRouter.js';
import { isEditableTarget } from '../../research-engine/interaction/editableTarget.js';

export { TIER };

const ShortcutContext = createContext(null);

/**
 * shouldRouteEvent — the two unconditional bail-outs, as a pure predicate so the
 * rules are unit-tested rather than buried in a listener.
 * (e.repeat is NOT checked here: it depends on which binding won.)
 */
export function shouldRouteEvent(e) {
  if (!e || typeof e !== 'object') return false;
  if (e.defaultPrevented === true) return false;
  if (e.isComposing === true) return false;
  if (e.keyCode === 229) return false;          // legacy IME composition signal
  return true;
}

/**
 * buildShortcutContext — assemble the ctx the pure router and every `when()`
 * predicate read. Pure; the caller supplies the already-probed facts.
 *
 * `target` always comes from the event and cannot be overridden by `extra`;
 * everything else can, so a shell can inject canUndo/canRedo/hasSelection, or set
 * `suspended: true` while the Profile screen is capturing a new key binding.
 */
export function buildShortcutContext({ target, scope, modalOpen, editable, extra } = {}) {
  const base = {
    scope: String(scope == null ? '' : scope),
    modalOpen: !!modalOpen,
    editableTarget: !!editable,
    hasSelection: false,
    canUndo: false,
    canRedo: false,
    suspended: false,
  };
  const ex = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : null;
  return { ...base, ...(ex || {}), target: target || null };
}

/**
 * @param {object} props
 * @param {() => string} [props.getScope]        current page/engine scope key
 * @param {() => boolean} [props.isModalOpen]    is any dialog open (tier 1 gate)
 * @param {(t:any)=>boolean} [props.isEditable]  override the editable predicate
 * @param {() => object} [props.getContext]      extra ctx fields (canUndo, …)
 * @param {(info:object)=>void} [props.onRouted] diagnostics hook
 * @param {object} [props.registry]              injectable registry (tests)
 */
export function ShortcutProvider({
  children, getScope, isModalOpen, isEditable, getContext, onRouted, registry,
}) {
  const regRef = useRef(null);
  if (regRef.current === null) regRef.current = registry || createRegistry();

  // Live props behind a render-assigned ref so the listener binds exactly once.
  const live = useRef({});
  live.current = { getScope, isModalOpen, isEditable, getContext, onRouted };

  const register = useCallback((binding) => registerBinding(regRef.current, binding), []);

  const buildContext = useCallback((target) => {
    const { getScope: gs, isModalOpen: im, isEditable: ie, getContext: gc } = live.current;
    let extra = null;
    try {
      extra = typeof gc === 'function' ? gc() : null;
    } catch {
      extra = null;                                  // a broken shell must not eat keys
    }
    const editableFn = typeof ie === 'function' ? ie : isEditableTarget;
    return buildShortcutContext({
      target,
      scope: typeof gs === 'function' ? gs() : '',
      modalOpen: typeof im === 'function' ? im() : false,
      editable: editableFn(target),
      extra,
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKey = (e) => {
      if (!shouldRouteEvent(e)) return;
      const ctx = buildContext(e.target || null);
      const routed = routeKeydown(regRef.current, e, ctx);
      if (!routed || !routed.binding) return;
      const b = routed.binding;
      if (e.repeat && !b.allowRepeat) return;
      let handled = false;
      try {
        handled = b.run ? !!b.run(e, ctx) : false;
      } catch {
        handled = false;                              // a throwing binding never claims the key
      }
      if (handled) e.preventDefault();
      const report = live.current.onRouted;
      if (typeof report === 'function') {
        try {
          report({ id: b.id, tier: b.tier, reason: routed.reason, handled });
        } catch { /* diagnostics are never load-bearing */ }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [buildContext]);

  const value = useMemo(() => ({ register, buildContext }), [register, buildContext]);
  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

const noop = () => {};
const NO_SHORTCUTS = Object.freeze({
  register: () => noop,
  buildContext: () => buildShortcutContext({}),
});

/**
 * useShortcuts() → { register(binding) → unregister, buildContext(target) }
 * Safe outside the provider (returns no-ops), so a feature can adopt the router
 * before every shell mounts it.
 */
export function useShortcuts() {
  return useContext(ShortcutContext) || NO_SHORTCUTS;
}

/**
 * useShortcut(binding, deps) — register one binding for the lifetime of the
 * component. The declaration is read through a ref, so `match`/`when`/`run` may
 * be freshly-created closures on every render without churning the registry; only
 * id/tier/allowRepeat (and any explicit deps) re-register.
 */
export function useShortcut(binding, deps = []) {
  const { register } = useShortcuts();
  const ref = useRef(binding);
  ref.current = binding;
  const id = binding && binding.id;
  const tier = binding && binding.tier;
  const allowRepeat = !!(binding && binding.allowRepeat);
  useEffect(() => {
    if (!id) return undefined;
    return register({
      id,
      tier,
      allowRepeat,
      match: (e) => {
        const m = ref.current && ref.current.match;
        return typeof m === 'function' ? !!m(e) : false;
      },
      when: (ctx) => {
        const w = ref.current && ref.current.when;
        return typeof w === 'function' ? !!w(ctx) : true;
      },
      run: (e, ctx) => {
        const r = ref.current && ref.current.run;
        return typeof r === 'function' ? r(e, ctx) : false;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, id, tier, allowRepeat, ...deps]);
}

export default ShortcutProvider;
