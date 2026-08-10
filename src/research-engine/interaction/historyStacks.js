/**
 * historyStacks.js — 108.md §§9-11, §13, §16. The pure, scope-keyed undo/redo
 * model behind PecanRev's project-wide history. Modelled on the Search Builder's
 * searchBuilder/undoStack.js (cap 20, inverse patches not snapshots, pure
 * functions returning new state) and generalised so every engine shares ONE
 * implementation instead of inventing its own (108.md §3 "centralized enough that
 * every engine does not invent its own incompatible implementation").
 *
 * SHAPE
 *   history = { [scope]: { undo: Entry[], redo: Entry[], pending: Pending|null } }
 *   Entry   = { id, kind, scope, label, projectId, entityKey?, undoOp, redoOp,
 *               at?, meta? }
 *   Pending = { entry, direction }   // taken off a stack, execution in flight
 *
 * `undoOp` / `redoOp` are OPAQUE DOMAIN DESCRIPTORS — this module never inspects
 * or interprets them. That is the whole point of 108.md §§9-10: a screening
 * decision entry carries { recordId, stage, decision, … }, an extraction entry
 * carries { studyId, field, value, provenance }, and NEITHER carries a snapshot of
 * a page's React state. The executor registered for `kind` is the only code that
 * understands an op, and it re-validates the current state before applying it
 * (108.md §§14-15) — see frontend/history/HistoryContext.jsx.
 *
 * WHY A PENDING SLOT AND NOT A STRAIGHT POP-AND-PUSH: undo is a real, async,
 * server-backed mutation (108.md §8). Between "take the entry" and "the write
 * succeeded" the entry must belong to NEITHER stack, or a second Ctrl+Z issued
 * while the first is still in flight would undo the same action twice. takeUndo /
 * takeRedo move the entry into `pending` and REFUSE while it is occupied; the
 * caller then finishes with completeUndo/completeRedo (success) or restoreFailed
 * (persistence failed — 108.md §8.6, the "failed Undo persistence" test of §26).
 *
 * ONE-WAY ENTRIES: `redoOp: null` marks an action that can be undone but not
 * redone (the Search Builder scope — its 17 entry kinds record inverse patches
 * only, never forward patches). completeUndo drops such an entry instead of
 * pushing it onto the redo stack, so the UI never offers a redo that cannot run.
 *
 * LIFETIME (108.md §16). The stacks live in memory, per (project, scope):
 *   - navigating between pages KEEPS every scope's stack (the provider holds one
 *     history object above the router; scope only selects which stack Ctrl+Z
 *     reads), so leaving Screening for Extraction and coming back continues where
 *     it left off — 108.md §16 bullet 2;
 *   - switching projects clears everything (clearAll) — entries name a projectId
 *     and are meaningless against another project;
 *   - a refresh, a new tab, or signing out clears everything (nothing is
 *     persisted). The PROJECT STATE persists — the history of how it got there
 *     does not, which is the documented trade in 108.md §16;
 *   - adopting a remote document / an autosave 409 clears the affected scopes
 *     (clearScopes) — undoing across someone else's write would resurrect stale
 *     state (the collaboration rule inherited from undoStack.js).
 *
 * All functions are pure: they never mutate their inputs, and they return the
 * SAME history object when nothing changed (referential stability keeps React
 * from re-rendering on no-ops — the repo's byte-stability rule applied to state).
 * Ids and timestamps are NEVER generated here: callers seed them outside the
 * state updater (StrictMode double-invokes updaters).
 */

/** Per-scope cap. Matches undoStack.js's UNDO_STACK_CAP — one number, one story. */
export const HISTORY_CAP = 20;

/**
 * 109.md §16 — `interaction.historyCap` makes that number an Ops setting.
 *
 * It is deliberately module state and NOT a per-call argument. The cap is a global
 * install setting (`scope:'global'` in the catalogue), and it must apply identically
 * to EVERY push site: `recordAction`, the redo push in `completeUndo` and the
 * restore push in `restoreFailed`. Threading it through only the recording paths
 * would let a raised cap fill the undo stack with 100 entries and then silently
 * discard 80 of them the moment they moved to the redo stack.
 *
 * `setHistoryCap` is called once from the interaction provider when the public
 * settings snapshot lands; until then — and in every unit test that does not call it
 * — the value is the shipped 20, so nothing changes at defaults. The stack functions
 * remain pure with respect to their arguments: same inputs + same configured cap →
 * same output, and no function here reads a clock, an id source or the DOM.
 */
const CAP_MIN = 5;
const CAP_MAX = 100;
let configuredCap = HISTORY_CAP;

/** The cap currently in force. */
export function historyCap() { return configuredCap; }

/** Clamp + apply an Ops-configured cap. A non-finite value restores the default. */
export function setHistoryCap(n) {
  if (n == null || n === '') { configuredCap = HISTORY_CAP; return configuredCap; }
  const v = Number(n);
  if (!Number.isFinite(v)) { configuredCap = HISTORY_CAP; return configuredCap; }
  configuredCap = Math.min(CAP_MAX, Math.max(CAP_MIN, Math.round(v)));
  return configuredCap;
}

/** Test/HMR hook — back to the shipped default. */
export function resetHistoryCap() { configuredCap = HISTORY_CAP; }

/** Why takeUndo/takeRedo did not hand back an entry. */
export const TAKE_REASON = Object.freeze({
  OK: 'ok',
  EMPTY: 'empty',   // nothing on that stack — 108.md §26 "no history → no-op"
  BUSY: 'busy',     // an undo/redo is already in flight for this scope
  NO_SCOPE: 'no-scope',
});

const EMPTY_SCOPE = Object.freeze({ undo: [], redo: [], pending: null });

const asArr = (v) => (Array.isArray(v) ? v : []);
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** A fresh, empty history. */
export function emptyHistory() {
  return {};
}

/** The (frozen, shared) state of a scope that has no entries. Never mutated. */
function scopeState(hist, scope) {
  const h = asObj(hist);
  const s = h && scope ? h[scope] : null;
  if (!s) return EMPTY_SCOPE;
  return {
    undo: asArr(s.undo),
    redo: asArr(s.redo),
    pending: asObj(s.pending),
  };
}

/** Replace one scope, dropping it entirely when it has become empty. */
function withScope(hist, scope, next) {
  const h = asObj(hist) || {};
  const isEmpty = !next || (!next.undo.length && !next.redo.length && !next.pending);
  if (isEmpty) {
    if (!(scope in h)) return h;                       // no-op → same reference
    const copy = { ...h };
    delete copy[scope];
    return copy;
  }
  return { ...h, [scope]: next };
}

/** Push onto a stack, trimming the OLDEST entries beyond the cap (undoStack.js). */
function pushCapped(stack, entry) {
  const cap = configuredCap;
  const next = [...asArr(stack), entry];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * isValidEntry — the shape gate for every recorded action.
 *
 * Deliberately strict about identity (id/kind/scope/projectId) because a
 * malformed entry is a programming error that would otherwise surface much later
 * as an un-runnable undo; deliberately permissive about `undoOp`/`redoOp`
 * contents because this module is not allowed to understand them.
 */
export function isValidEntry(entry) {
  const e = asObj(entry);
  if (!e) return false;
  for (const k of ['id', 'kind', 'scope', 'projectId']) {
    if (typeof e[k] !== 'string' || !e[k]) return false;
  }
  if (e.label != null && typeof e.label !== 'string') return false;
  if (e.entityKey != null && typeof e.entityKey !== 'string') return false;
  if (!asObj(e.undoOp)) return false;                  // undo is mandatory
  if (e.redoOp != null && !asObj(e.redoOp)) return false; // redo is optional (one-way)
  if (e.meta != null && !asObj(e.meta)) return false;
  return true;
}

/**
 * recordAction(hist, entry) → hist
 *
 * 108.md §11: a new user action goes on the undo stack AND clears that scope's
 * redo branch (A→B→C, undo, then D ⇒ C is no longer redoable). Only the ENTRY'S
 * OWN scope is touched — a Screening action must not invalidate the redo branch a
 * user left behind in Extraction (108.md §3).
 *
 * A malformed entry is ignored (same history back) rather than thrown: a bad
 * record must never take down the surface the user is working in.
 */
export function recordAction(hist, entry) {
  if (!isValidEntry(entry)) return asObj(hist) || {};
  const scope = entry.scope;
  const s = scopeState(hist, scope);
  return withScope(hist, scope, {
    undo: pushCapped(s.undo, entry),
    redo: [],
    pending: s.pending,
  });
}

/**
 * coalesceOrRecord(hist, entry, canMerge, mergeOps) → hist
 *
 * 108.md §13 "group related changes intelligently". When `canMerge(top, entry)`
 * accepts the scope's current top-of-undo, the two become ONE entry instead of
 * two: by default it keeps the top's `undoOp` (the FIRST prev value — where undo
 * must land) and takes the new entry's `redoOp` (the LAST next value — where redo
 * must land), so typing "Patients with confirmed molecular diagnosis" into a field
 * is one Ctrl+Z, not 42.
 *
 * THE `mergeOps` HOOK (108 review, [critical] "coalesced entries keep the FIRST
 * keystroke's undoOp.expect"). The default halves are right for a PAYLOAD (the
 * value to write) but wrong for a PRECONDITION carried inside the same op: an
 * extraction `undoOp.expect` asserts what the row holds NOW, so it must track the
 * LAST keystroke, while `redoOp.expect` asserts what undo restored, so it must
 * track the FIRST. This module is domain-blind and may not know that, so the
 * DOMAIN supplies the rule:
 *
 *     coalesceOrRecord(hist, entry, canMergeExtractionEdit, (top, entry) => ({
 *       undoOp: { ...top.undoOp,   expect: entry.undoOp.expect },
 *       redoOp: { ...entry.redoOp, expect: top.redoOp.expect },
 *     }))
 *
 * Contract: `mergeOps(top, entry)` returns `{ undoOp, redoOp }`. A missing
 * (`undefined`) or unusable half falls back to the default for that half;
 * `redoOp: null` explicitly makes the merged entry one-way. A throwing or
 * non-object return, or a result that would produce an invalid entry, degrades to
 * the default merge — a bad hook must never lose the user's history.
 *
 * `label`, `at` and `meta` come from the newer entry (the merged action is
 * described by its latest state); `meta.coalesced` counts how many user events the
 * entry represents. The merged entry keeps the ORIGINAL id, so a UI holding a
 * reference to it stays valid.
 *
 * Merging is still a new user action: it clears the scope's redo branch (§11).
 */
export function coalesceOrRecord(hist, entry, canMerge, mergeOps) {
  if (!isValidEntry(entry)) return asObj(hist) || {};
  if (typeof canMerge !== 'function') return recordAction(hist, entry);
  const s = scopeState(hist, entry.scope);
  const top = s.undo.length ? s.undo[s.undo.length - 1] : null;
  if (!top) return recordAction(hist, entry);
  let ok = false;
  try {
    ok = !!canMerge(top, entry);
  } catch {
    ok = false;                                        // a throwing matcher never merges
  }
  if (!ok) return recordAction(hist, entry);
  const fallback = {
    undoOp: top.undoOp,
    redoOp: entry.redoOp != null ? entry.redoOp : null,
  };
  const rest = {
    ...top,
    label: entry.label != null ? entry.label : top.label,
    at: entry.at !== undefined ? entry.at : top.at,
    meta: {
      ...(asObj(top.meta) || {}),
      ...(asObj(entry.meta) || {}),
      coalesced: (Number(asObj(top.meta)?.coalesced) || 1) + 1,
    },
  };
  let merged = { ...rest, ...fallback };
  if (typeof mergeOps === 'function') {
    let custom = null;
    try {
      custom = asObj(mergeOps(top, entry));
    } catch {
      custom = null;                                   // a throwing hook merges the default way
    }
    if (custom) {
      const undoOp = asObj(custom.undoOp) || fallback.undoOp;
      let redoOp = fallback.redoOp;
      if (custom.redoOp === null) redoOp = null;
      else if (custom.redoOp !== undefined) redoOp = asObj(custom.redoOp) || fallback.redoOp;
      const candidate = { ...rest, undoOp, redoOp };
      if (isValidEntry(candidate)) merged = candidate;
    }
  }
  return withScope(hist, entry.scope, {
    undo: [...s.undo.slice(0, -1), merged],
    redo: [],
    pending: s.pending,
  });
}

/** Top of the scope's undo stack (what Ctrl+Z would run), or null. */
export function peekUndo(hist, scope) {
  const s = scopeState(hist, scope);
  return s.undo.length ? s.undo[s.undo.length - 1] : null;
}

/** Top of the scope's redo stack (what Ctrl+Shift+Z would run), or null. */
export function peekRedo(hist, scope) {
  const s = scopeState(hist, scope);
  return s.redo.length ? s.redo[s.redo.length - 1] : null;
}

function take(hist, scope, direction) {
  if (typeof scope !== 'string' || !scope) {
    return { hist: asObj(hist) || {}, entry: null, reason: TAKE_REASON.NO_SCOPE };
  }
  const s = scopeState(hist, scope);
  if (s.pending) return { hist: asObj(hist) || {}, entry: null, reason: TAKE_REASON.BUSY };
  const from = direction === 'undo' ? s.undo : s.redo;
  if (!from.length) return { hist: asObj(hist) || {}, entry: null, reason: TAKE_REASON.EMPTY };
  const entry = from[from.length - 1];
  const rest = from.slice(0, -1);
  return {
    hist: withScope(hist, scope, {
      undo: direction === 'undo' ? rest : s.undo,
      redo: direction === 'undo' ? s.redo : rest,
      pending: { entry, direction },
    }),
    entry,
    reason: TAKE_REASON.OK,
  };
}

/**
 * takeUndo(hist, scope) → { hist, entry, reason }
 * Moves the top undo entry into the scope's in-flight slot. It is on NEITHER
 * stack until completeUndo (→ redo stack) or restoreFailed (→ back on undo).
 * Refuses with reason 'busy' while another undo/redo is executing in this scope —
 * that refusal IS the per-scope serialization required by 108.md §14.
 */
export function takeUndo(hist, scope) {
  return take(hist, scope, 'undo');
}

/** takeRedo(hist, scope) → { hist, entry, reason }. Mirror of takeUndo. */
export function takeRedo(hist, scope) {
  return take(hist, scope, 'redo');
}

/**
 * ownsPending — does this scope's in-flight slot still hold exactly this entry?
 *
 * 108 review, [major] "completeUndo/restoreFailed re-create a cleared scope": the
 * answer is NO when clearScope / clearScopes / clearAll ran between takeUndo and
 * the executor resolving. `scopeState` hands back the frozen EMPTY_SCOPE for a
 * scope key that no longer exists, so completing blindly would make `withScope`
 * RE-CREATE the scope — resurrecting an entry that belongs to a project the user
 * has already left. The entry is dropped instead: the clear invalidated it.
 */
function ownsPending(s, entry) {
  return !!(s.pending && entry && s.pending.entry && s.pending.entry.id === entry.id);
}

/**
 * isPendingEntry(hist, scope, entryId) → boolean
 * The same question, asked from outside (HistoryProvider.run re-checks it after
 * its await so a cleared scope also suppresses the feedback note).
 */
export function isPendingEntry(hist, scope, entryId) {
  if (typeof entryId !== 'string' || !entryId) return false;
  const s = scopeState(hist, scope);
  return !!(s.pending && s.pending.entry && s.pending.entry.id === entryId);
}

/**
 * scopeOfUndoTop(hist, entryId) → scope | ''
 * Which scope has this entry as the top of its undo stack? '' when the entry is
 * gone or has been buried by a newer action — the test behind the entry-targeted
 * `undoEntry(id)` (a snackbar's Undo button must reverse the action its text
 * names, or nothing at all).
 */
export function scopeOfUndoTop(hist, entryId) {
  const h = asObj(hist);
  if (!h || typeof entryId !== 'string' || !entryId) return '';
  for (const scope of Object.keys(h)) {
    const top = peekUndo(h, scope);
    if (top && top.id === entryId) return scope;
  }
  return '';
}

function complete(hist, scope, entry, direction) {
  const s = scopeState(hist, scope);
  if (!ownsPending(s, entry)) return asObj(hist) || {};   // cleared mid-flight → drop
  if (!isValidEntry(entry)) {
    return withScope(hist, scope, { undo: s.undo, redo: s.redo, pending: null });
  }
  if (direction === 'undo') {
    // 108.md §11: an undone action becomes redoable — unless it is one-way
    // (redoOp === null), in which case it simply leaves the history.
    return withScope(hist, scope, {
      undo: s.undo,
      redo: entry.redoOp ? pushCapped(s.redo, entry) : s.redo,
      pending: null,
    });
  }
  return withScope(hist, scope, {
    undo: pushCapped(s.undo, entry),
    redo: s.redo,
    pending: null,
  });
}

/** The undo executed and persisted: the entry becomes redoable (108.md §11). */
export function completeUndo(hist, scope, entry) {
  return complete(hist, scope, entry, 'undo');
}

/** The redo executed and persisted: the entry becomes undoable again (§11). */
export function completeRedo(hist, scope, entry) {
  return complete(hist, scope, entry, 'redo');
}

/**
 * restoreFailed(hist, scope, entry, direction) → hist
 *
 * 108.md §8.6 "fail safely if persistence fails" / §26 "failed Undo persistence".
 * The executor refused (a collaborator changed the target — §15) or the write
 * failed (an autosave 409 — see the blob CAS in server/store.js). The entry goes
 * back on the stack it came from, at the top, so the user can retry; it is NEVER
 * silently dropped, because a dropped entry looks to the user like a successful
 * undo that did nothing.
 *
 * TWO EXCEPTIONS, both of which would otherwise JAM the scope forever:
 *   • the scope was cleared while the operation was in flight (see ownsPending) —
 *     the entry is dropped, never resurrected into a scope the clear invalidated;
 *   • an entry whose precondition can never become true again would sit at the top
 *     refusing every Ctrl+Z and burying every older valid entry behind it. That one
 *     is a POLICY, not a stack rule, so it lives in HistoryProvider (which counts
 *     consecutive refusals) and lands here as `dropPending`.
 */
export function restoreFailed(hist, scope, entry, direction) {
  const s = scopeState(hist, scope);
  if (!ownsPending(s, entry)) return asObj(hist) || {};   // cleared mid-flight → drop
  if (!isValidEntry(entry)) {
    return withScope(hist, scope, { undo: s.undo, redo: s.redo, pending: null });
  }
  if (direction === 'undo') {
    return withScope(hist, scope, { undo: pushCapped(s.undo, entry), redo: s.redo, pending: null });
  }
  return withScope(hist, scope, { undo: s.undo, redo: pushCapped(s.redo, entry), pending: null });
}

/**
 * dropPending(hist, scope, entry) → hist
 *
 * Free the in-flight slot WITHOUT putting the entry back on either stack. The
 * escape hatch for a poisoned entry (the provider's refusal-drop policy): the
 * entry is abandoned so the older, still-valid entries underneath become reachable
 * again. The user is told — a silent drop is the failure mode restoreFailed exists
 * to avoid. A no-op (same history) when this scope is not holding this entry.
 */
export function dropPending(hist, scope, entry) {
  const s = scopeState(hist, scope);
  if (!ownsPending(s, entry)) return asObj(hist) || {};
  return withScope(hist, scope, { undo: s.undo, redo: s.redo, pending: null });
}

/** Drop one scope's stacks (project page reset, engine-local conflict). */
export function clearScope(hist, scope) {
  const h = asObj(hist) || {};
  if (!scope || !(scope in h)) return h;
  const copy = { ...h };
  delete copy[scope];
  return copy;
}

/**
 * clearScopes(hist, predicate) → hist
 * Drop every scope for which predicate(scope, scopeState) is true. Used for the
 * blob-conflict case: an autosave 409 invalidates every blob-backed scope
 * (extraction / analysis / manuscript) while leaving the relational screening
 * scope — whose writes never touch the blob — intact.
 */
export function clearScopes(hist, predicate) {
  const h = asObj(hist) || {};
  if (typeof predicate !== 'function') return h;
  const keys = Object.keys(h).filter((k) => {
    try {
      return !!predicate(k, h[k]);
    } catch {
      return false;
    }
  });
  if (!keys.length) return h;
  const copy = { ...h };
  for (const k of keys) delete copy[k];
  return copy;
}

/** Drop everything (project switch, sign-out). */
export function clearAll(hist) {
  const h = asObj(hist) || {};
  return Object.keys(h).length ? {} : h;
}

/**
 * counts(hist, scope) → { undo, redo, pending, canUndo, canRedo }
 * The shape the UI binds to: 108.md §22 wants the Undo/Redo controls disabled
 * from the CURRENT page's availability, and an in-flight operation disables both.
 */
export function counts(hist, scope) {
  const s = scopeState(hist, scope);
  const pending = !!s.pending;
  return {
    undo: s.undo.length,
    redo: s.redo.length,
    pending,
    canUndo: !pending && s.undo.length > 0,
    canRedo: !pending && s.redo.length > 0,
  };
}
