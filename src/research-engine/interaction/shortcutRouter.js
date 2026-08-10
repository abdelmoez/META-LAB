/**
 * shortcutRouter.js — 108.md §§23-24. The pure priority core of PecanRev's
 * keyboard layer: a registry of declarative bindings plus one function that says
 * which binding (if any) owns a given keydown. THIS FILE NEVER TOUCHES THE DOM.
 * The single window listener, the editable/modal probes and preventDefault() all
 * live in the adapter (src/frontend/shortcuts/ShortcutProvider.jsx); everything
 * that decides anything lives here, where it is unit-testable without jsdom.
 *
 * WHY: before 108 the app had 29 separate `addEventListener('keydown', …)` sites
 * and precedence was an accident of DOM phase + React effect-mount order. 108.md
 * §23 forbids adding a 30th.
 *
 * ── THE TIER MODEL (108.md §24) ──────────────────────────────────────────────
 *   1 MODAL      A dialog is open and owns the keyboard. Its bindings beat
 *                everything below, which is how "Escape closes the dialog, not
 *                Focus Mode" becomes a declaration instead of a stopPropagation
 *                race.
 *   2 EDITOR     The focused editor's own chords (the manuscript editor's
 *                Ctrl/Cmd+B / +I, a syntax field's completion keys). Bindings at
 *                this tier are registered BY the focused surface. Native browser
 *                text editing is not a binding at all — it is what happens when
 *                every registered binding declines, which is why tier 3-5
 *                bindings must gate themselves on `!ctx.editableTarget`
 *                (108.md §7: never globally preventDefault Ctrl/Cmd+Z).
 *   3 COMPONENT  A specific widget with a selection or a focused element — e.g.
 *                Ctrl/Cmd+I over a selection inside the abstract.
 *   4 ENGINE     The current page/engine — screening navigation, RoB scoring,
 *                the extraction workspace.
 *   5 GLOBAL     App-wide — project undo/redo, Focus Mode.
 *   (6 BROWSER)  Not representable: it is the absence of a winner. When
 *                routeKeydown returns null nothing calls preventDefault and the
 *                browser keeps its default, which is the entire point of
 *                108.md §1 "do not globally block Ctrl/Cmd+I".
 *
 * Lower tier wins. Within a tier, EARLIER REGISTRATION wins — React runs child
 * effects before parent effects, so the more specific (deeper) component
 * registers first and beats its container. That is the same "nearest handler
 * wins" intuition the DOM gives, made explicit.
 *
 * ── COEXISTENCE CONTRACT (what this round does NOT route) ────────────────────
 * The router is being introduced incrementally; unrouted listeners still exist and
 * the contract between them is:
 *   a) The DOM adapter SKIPS any event with `defaultPrevented` already set. A
 *      nearer React onKeyDown (the manuscript editor's italic, a popover's
 *      Escape) therefore always beats the router, matching tier 1-2 without those
 *      handlers having to register.
 *   b) FOCUS MODE (Ctrl/Cmd+Shift+F and its Escape exit, frontend/focus/
 *      FocusModeContext.jsx) stays on its own window listener above the router.
 *      It is tier 5, it already checks `!e.defaultPrevented`, and it must stay
 *      mounted above the router for surfaces the router does not cover.
 *   c) The ESCAPE-CLOSERS (modals, drawers, popovers, tooltips, the chip-drag
 *      session) stay put this round. They are layered by DOM phase today and the
 *      99.md convention "consume Escape only when it actually closed something"
 *      is the protocol; migrating them is the follow-up that buys correct Escape
 *      layering.
 *   d) Profile.jsx's shortcut-capture mode eats every key while recording a new
 *      binding. It sets `ctx.suspended` so the router stands down entirely
 *      instead of competing with it.
 * Anything NOT in that list that wants a chord must register here.
 *
 * Purity note: `createRegistry`/`registerBinding` maintain a small mutable
 * registry object (registration is inherently a side effect with a lifetime), but
 * `routeKeydown` is a pure function of (registry, event-like, context) and never
 * mutates or observes anything else.
 */

/** Priority tiers — 1 wins. Exported so bindings never hard-code a number. */
export const TIER = Object.freeze({
  MODAL: 1,
  EDITOR: 2,
  COMPONENT: 3,
  ENGINE: 4,
  GLOBAL: 5,
});

const TIER_NAME = Object.freeze({
  1: 'modal', 2: 'editor', 3: 'component', 4: 'engine', 5: 'global',
});

/** Reasons routeKeydown can report on the winning binding. */
export const ROUTE_REASON = TIER_NAME;

const noop = () => {};

/** A fresh registry. One per ShortcutProvider (i.e. one per app in practice). */
export function createRegistry() {
  return { seq: 0, bindings: [] };
}

function validTier(tier) {
  return tier === TIER.MODAL || tier === TIER.EDITOR || tier === TIER.COMPONENT
    || tier === TIER.ENGINE || tier === TIER.GLOBAL;
}

/**
 * registerBinding(reg, binding) → unregister()
 *
 * @param {object} reg — from createRegistry()
 * @param {object} binding
 * @param {string}   binding.id       stable, unique; re-registering an id REPLACES
 *                                    the previous binding (a component remounting
 *                                    must never end up registered twice).
 * @param {number}   binding.tier     one of TIER.*
 * @param {(e:object)=>boolean} binding.match  key/modifier test. Given an
 *                                    event-LIKE object ({key, ctrlKey, metaKey,
 *                                    shiftKey, altKey, …}) — never a DOM lookup.
 * @param {(ctx:object)=>boolean} [binding.when]  context gate (scope, modal,
 *                                    editable, selection, canUndo…). Default: yes.
 *                                    THIS is where a binding declines so the
 *                                    browser keeps its default.
 * @param {(e:object, ctx:object)=>boolean} [binding.run]  the effect. The adapter
 *                                    calls it and preventDefaults ONLY on a
 *                                    truthy return (108.md §1).
 * @param {boolean} [binding.allowRepeat=false]  fire on auto-repeat keydowns.
 *
 * An invalid binding is ignored (a no-op unregister comes back) rather than
 * thrown: a bad declaration must not crash the surface that declared it.
 */
export function registerBinding(reg, binding) {
  if (!reg || !Array.isArray(reg.bindings)) return noop;
  const b = binding && typeof binding === 'object' ? binding : null;
  if (!b) return noop;
  if (typeof b.id !== 'string' || !b.id) return noop;
  if (!validTier(b.tier)) return noop;
  if (typeof b.match !== 'function') return noop;

  const entry = {
    id: b.id,
    tier: b.tier,
    match: b.match,
    when: typeof b.when === 'function' ? b.when : null,
    run: typeof b.run === 'function' ? b.run : null,
    allowRepeat: b.allowRepeat === true,
    // 109.md §15 (decision 10) — OPTIONAL, purely descriptive metadata for the
    // read-only Ops shortcut inventory. It is never consulted by `routeKeydown`:
    // a binding with no descriptor routes exactly as before, and a WRONG descriptor
    // can only mislabel an inventory row, never mis-route a key. Declaring it at the
    // registration site is what makes the inventory truthful — a hand-written list
    // in Ops would drift the moment a binding moved.
    chord: typeof b.chord === 'string' ? b.chord : '',
    label: typeof b.label === 'string' ? b.label : '',
    scopeLabel: typeof b.scopeLabel === 'string' ? b.scopeLabel : '',
    seq: reg.seq++,
  };
  reg.bindings = [...reg.bindings.filter((x) => x.id !== entry.id), entry];

  let live = true;
  return function unregister() {
    if (!live) return;
    live = false;
    reg.bindings = reg.bindings.filter((x) => x !== entry);
  };
}

/** How many bindings are currently registered (tests / diagnostics). */
export function bindingCount(reg) {
  return reg && Array.isArray(reg.bindings) ? reg.bindings.length : 0;
}

/**
 * shortcutInventory(reg) — 109.md §15. Every currently-registered binding, in the
 * precedence order `routeKeydown` actually uses, as PLAIN DATA (no functions), so
 * Ops can render an inventory that is derived rather than maintained.
 *
 * It reports what is registered RIGHT NOW in one shell. Bindings owned by an
 * unmounted page are absent by construction — which is honest: a shortcut whose
 * page is not open genuinely does nothing.
 *
 * @returns {Array<{id, tier, tierName, chord, label, scopeLabel, allowRepeat}>}
 */
export function shortcutInventory(reg) {
  if (!reg || !Array.isArray(reg.bindings)) return [];
  return [...reg.bindings].sort(byPriority).map((b) => ({
    id: b.id,
    tier: b.tier,
    tierName: TIER_NAME[b.tier] || 'unknown',
    chord: b.chord || '',
    label: b.label || '',
    scopeLabel: b.scopeLabel || '',
    allowRepeat: !!b.allowRepeat,
  }));
}

/** Ids in priority order — the precedence a developer can print while debugging. */
export function bindingIds(reg) {
  if (!reg || !Array.isArray(reg.bindings)) return [];
  return [...reg.bindings].sort(byPriority).map((b) => b.id);
}

function byPriority(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;   // lower tier wins
  return a.seq - b.seq;                            // earlier registration wins
}

/**
 * routeKeydown(reg, eLike, ctx) → { binding, reason } | null
 *
 * Picks the highest-priority binding whose `match(eLike)` AND `when(ctx)` both
 * pass. Returns null when nothing claims the event — the caller must then leave
 * the browser alone.
 *
 * `ctx` is supplied entirely by the caller; the router does no probing. The
 * fields the shipped bindings read (see ShortcutProvider.buildShortcutContext):
 *   { scope, modalOpen, editableTarget, target, hasSelection?, canUndo, canRedo,
 *     suspended? }
 * The router itself only understands `ctx.suspended` — the global stand-down
 * switch for the Profile shortcut-capture screen.
 *
 * A `match`/`when` that throws is treated as "does not apply": a broken predicate
 * must not swallow every keystroke in the app.
 */
export function routeKeydown(reg, eLike, ctx) {
  if (!reg || !Array.isArray(reg.bindings) || !reg.bindings.length) return null;
  if (!eLike || typeof eLike !== 'object') return null;
  const context = ctx && typeof ctx === 'object' ? ctx : {};
  if (context.suspended === true) return null;

  const ordered = [...reg.bindings].sort(byPriority);
  for (const b of ordered) {
    let hit = false;
    try {
      hit = !!b.match(eLike);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    if (b.when) {
      let allowed = false;
      try {
        allowed = !!b.when(context);
      } catch {
        allowed = false;
      }
      if (!allowed) continue;
    }
    return { binding: b, reason: TIER_NAME[b.tier] || 'unknown' };
  }
  return null;
}
