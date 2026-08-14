/**
 * pdfAnnotationViewers.js — 116.md §74/§86 (r3). The PURE registration + routing core
 * shared by every mounted PDF annotation viewer in the tab.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
 * Two of the registries the annotation layer plugs into hold exactly ONE slot per
 * key, and the viewer is mounted on five surfaces — three of which can mount it
 * more than once at a time:
 *
 *   1. `HistoryProvider.registerExecutor(kind, fn)` is a `Map.set` keyed by the
 *      entry KIND (`pdf.annotation`), so the LAST registration wins. React flushes
 *      child effects before parent effects, so `RobPdfPanel` — which calls
 *      `usePdfAnnotations` for its study-document branch AND renders the screening
 *      `<PdfViewer>` (which calls it again) — used to overwrite the ACTIVE child's
 *      executor with its own INERT one. Ctrl+Z then reached an executor whose
 *      `activeRef` was false and every annotation undo in the RoB workspace refused
 *      with "Open the PDF again to undo this highlight." while the PDF was open.
 *      `ConflictsTab` has the same shape with N cards.
 *
 *   2. `shortcutRouter.registerBinding` REPLACES by binding id, so two viewers using
 *      the module-level id `pdf.annotation.undo` left only the later one registered.
 *      Its `when()` reads its OWN pane, so it declined for keystrokes aimed at the
 *      other pane and Ctrl+Z fell through to the TIER.GLOBAL chord — which reads the
 *      STAGE scope and pops a SCREENING decision. That is precisely what §86 forbids.
 *      (The id is made per-instance in pdfAnnotationShortcut.js; this module only
 *      mints the identity.)
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * An undo/redo op belongs to a DOCUMENT, not to a component. Every recorded op
 * therefore carries `docHash` (the §73 identity of the PDF it was made on) and the
 * `viewerId` of the instance that recorded it, and `dispatch` hands the op to:
 *
 *      the recording instance, if it is still attached, ACTIVE and still showing
 *      that document; else any other ACTIVE instance showing the SAME document
 *      (most recently attached first); else nobody — a polite refusal.
 *
 * That makes the routing independent of who won the single executor slot, which
 * fixes (1) and (2) together, and it is also the §74 guard: an op recorded on
 * document H1 can NEVER be replayed onto document H2, so an undo-of-delete can no
 * longer resurrect a foreign document's highlight over the page on screen. A
 * refusal is honest and reversible — returning to that PDF makes the entry live
 * again, which is why the `pdf` history scope is deliberately NOT cleared on a
 * document change.
 *
 * Pure and Node-testable: no React, no DOM, no timers. The module-level singleton at
 * the bottom is the one shared instance the hook uses; tests build their own with
 * `createViewerRegistry()` so they never touch it.
 */

/** The refusal shape HistoryProvider understands (`detail` is shown verbatim). */
export const NO_OWNER_DETAIL = 'That highlight is on a different PDF — open it again to undo.';

const refused = (detail) => ({ ok: false, reason: 'refused', detail });

let idSeq = 0;
/** A per-tab unique viewer id. Used for the executor routing AND the binding ids. */
export function newViewerId() {
  idSeq += 1;
  return `pdfann-${idSeq}`;
}

/**
 * annotationShortcutIds(viewerId, active) — the shortcut-registry half of the same
 * rule (§86 r3). PER-PANE ids, because `registerBinding` replaces by id and two open
 * panes sharing one id leave only the later pane bound — which then declines for the
 * other pane's keystrokes and lets Ctrl+Z fall through to the project-wide chord.
 *
 * An INERT viewer gets EMPTY ids, and both `registerBinding` and `useShortcut` treat
 * an empty id as "register nothing": a viewer with no annotation props stays out of
 * the registry (and out of the Ops shortcut inventory) entirely.
 */
export function annotationShortcutIds(viewerId, active) {
  const on = !!active && typeof viewerId === 'string' && !!viewerId;
  return {
    undo: on ? `pdf.annotation.undo:${viewerId}` : '',
    redo: on ? `pdf.annotation.redo:${viewerId}` : '',
  };
}

/**
 * createViewerRegistry() → the registry object.
 *
 * An entry is `{ id, isActive(), docHash(), run(op) }`. The two getters are read
 * LIVE at dispatch time rather than mirrored into the registry, so a viewer that
 * changed document (or went inert) between the keystroke and the dispatch is judged
 * on what it is showing NOW — the same "re-validate against current state" rule the
 * executors themselves follow (108.md §15).
 */
export function createViewerRegistry() {
  /** id → entry, in ATTACH order (Map preserves insertion order). */
  const entries = new Map();
  const listeners = new Set();

  const notify = () => {
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* a listener must never break another's re-registration */ }
    }
  };

  const liveDocHash = (e) => {
    try { return String(e.docHash() || ''); } catch { return ''; }
  };
  const liveActive = (e) => {
    try { return !!e.isActive(); } catch { return false; }
  };

  /**
   * attach(entry) → detach().
   *
   * ATTACHING does NOT notify: a new viewer claims the executor slot from its own
   * effect, and every viewer's executor is the same dispatcher, so nobody else has
   * anything to redo. DETACHING does, because the leaving viewer may be the one whose
   * registration held the slot and a survivor has to re-claim it. `refresh()` covers
   * the third case — a viewer going inert, which unregisters for the same reason.
   * Keeping attach quiet is what stops a surface that mounts a viewer per row (the
   * Conflicts tab) from re-rendering every other viewer once per mount.
   */
  function attach(entry) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) return () => {};
    if (typeof entry.run !== 'function') return () => {};
    const e = {
      id: entry.id,
      isActive: typeof entry.isActive === 'function' ? entry.isActive : () => false,
      docHash: typeof entry.docHash === 'function' ? entry.docHash : () => '',
      run: entry.run,
    };
    entries.set(e.id, e);
    let live = true;
    return function detach() {
      if (!live) return;
      live = false;
      if (entries.get(e.id) === e) entries.delete(e.id);
      notify();
    };
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** "Something about who can run an op changed" — see the note on `attach`. */
  function refresh() { notify(); }

  /**
   * ownerFor({ viewerId, docHash }) → entry | null. See "THE RULE" above.
   * An op with no docHash names no document and is therefore un-routable — it is
   * refused rather than guessed at (§74: never invent a document identity).
   */
  function ownerFor({ viewerId = '', docHash = '' } = {}) {
    const hash = String(docHash || '');
    if (!hash) return null;
    const own = viewerId ? entries.get(viewerId) : null;
    if (own && liveActive(own) && liveDocHash(own) === hash) return own;
    let fallback = null;
    for (const e of entries.values()) {
      if (liveActive(e) && liveDocHash(e) === hash) fallback = e;   // last attached wins
    }
    return fallback;
  }

  /** Run one op on its owner, or refuse. Never throws for a routing failure. */
  function dispatch(op) {
    if (!op || typeof op !== 'object') return false;
    const owner = ownerFor({ viewerId: op.viewerId, docHash: op.docHash });
    if (!owner) return refused(NO_OWNER_DETAIL);
    return owner.run(op);
  }

  return {
    attach,
    subscribe,
    refresh,
    ownerFor,
    dispatch,
    /** Diagnostics + unit tests only. */
    ids: () => [...entries.keys()],
    activeIds: () => [...entries.values()].filter(liveActive).map((e) => e.id),
    size: () => entries.size,
  };
}

/** The one registry every mounted viewer in this tab shares. */
export const pdfAnnotationViewers = createViewerRegistry();

export default {
  createViewerRegistry, pdfAnnotationViewers, newViewerId, annotationShortcutIds, NO_OWNER_DETAIL,
};
