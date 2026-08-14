/**
 * pdfAnnotationRouting.test.js — 116.md §74/§86 (r3).
 *
 * THE THING BEING PINNED: the PDF viewer is mounted on five surfaces, and three of
 * them can mount it MORE THAN ONCE AT A TIME —
 *   - RobPdfPanel calls `usePdfAnnotations` for its study-document branch AND renders
 *     the screening <PdfViewer>, which calls it again;
 *   - ConflictsTab mounts one <PdfViewer> per unresolved conflict;
 *   - the extraction workspace and the RoB workspace can be open on the same paper.
 *
 * Both registries the annotation layer plugs into hold ONE slot per key:
 *   - `HistoryProvider.registerExecutor(kind, fn)` — a `Map.set` on the entry KIND
 *     (HistoryContext.jsx: `executorsRef.current.set(kind, fn)`), last write wins;
 *   - `shortcutRouter.registerBinding(reg, b)` — replaces by binding id
 *     (`reg.bindings = [...filter(x => x.id !== entry.id), entry]`).
 *
 * The consequences these tests exist to prevent are, in order of severity:
 *   1. an INERT viewer overwriting the ACTIVE viewer's executor, so every Ctrl+Z in
 *      the RoB workspace refused with "Open the PDF again to undo this highlight."
 *      while the PDF was plainly open;
 *   2. two panes sharing one binding id, so Ctrl+Z aimed at pane A fell through to
 *      the TIER.GLOBAL chord and undid a SCREENING DECISION — §86's one prohibition;
 *   3. an undo op recorded on document H1 replaying onto document H2 and painting a
 *      foreign document's highlight over the page on screen (§74).
 *
 * There is no jsdom in this repo, so the registration logic lives in the pure
 * `pdfAnnotationViewers.js` and is exercised here directly. The kind-keyed executor
 * slot is modelled in ten lines below; the source pin at the bottom keeps the model
 * and HistoryContext.jsx from drifting apart.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  createViewerRegistry, newViewerId, annotationShortcutIds, NO_OWNER_DETAIL,
} from '../../../src/frontend/components/pdfAnnotationViewers.js';
import {
  createRegistry, registerBinding, routeKeydown, TIER,
} from '../../../src/research-engine/interaction/shortcutRouter.js';

const KIND = 'pdf.annotation';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

/** The HistoryProvider executor registry, modelled exactly (see the source pin). */
function makeExecutorSlot() {
  const map = new Map();
  return {
    register(kind, fn) {
      map.set(kind, fn);
      return () => { if (map.get(kind) === fn) map.delete(kind); };
    },
    has(kind) { return map.has(kind); },
    run(kind, op) {
      const fn = map.get(kind);
      return fn ? fn(op) : { ok: false, reason: 'no-executor' };
    },
  };
}

/**
 * One mounted `usePdfAnnotations` instance: it attaches to the shared registry, and
 * its registration effect (re-run whenever the registry membership changes, which is
 * what `registryGen` does in the hook) claims the executor slot ONLY while active.
 */
function mountViewer(registry, slot, { active = false, docHash = '' } = {}) {
  const id = newViewerId();
  const state = { id, active, docHash, ran: [] };
  const detach = registry.attach({
    id,
    isActive: () => state.active,
    docHash: () => state.docHash,
    run: (op) => { state.ran.push(op); return true; },
  });
  let unregister = null;
  const sync = () => {
    // React does not re-run an unmounting component's effects, so neither does this.
    if (state.dead) return;
    if (unregister) { unregister(); unregister = null; }
    if (state.active) unregister = slot.register(KIND, (op) => registry.dispatch(op));
  };
  const unsubscribe = registry.subscribe(sync);
  sync();
  // Mirrors the hook: this viewer's own registration effect re-runs, then the
  // `refresh` effect tells the others that the slot may have been vacated.
  state.setActive = (on) => { state.active = on; sync(); registry.refresh(); };
  state.unmount = () => {
    state.dead = true;
    detach();                                       // the survivors re-claim the slot
    unsubscribe();
    if (unregister) { unregister(); unregister = null; }
  };
  return state;
}

describe('116.md §86 (r3) — one executor slot, several mounted viewers', () => {
  it('an INERT viewer never claims the slot, so the ACTIVE one still runs the undo', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    // The RoB shape: the screening <PdfViewer> (child, ACTIVE) mounts first because
    // React flushes child effects before parent effects; RobPdfPanel's own
    // study-document hook (parent, INERT — no study document on a handed-off study)
    // mounts second and used to overwrite it.
    const child = mountViewer(registry, slot, { active: true, docHash: H1 });
    const parent = mountViewer(registry, slot, { active: false, docHash: '' });

    const out = slot.run(KIND, { type: 'delete', clientId: 'an-1', docHash: H1, viewerId: child.id });
    expect(out).toBe(true);
    expect(child.ran).toHaveLength(1);
    expect(parent.ran).toHaveLength(0);
  });

  it('routes to the viewer showing the document even when another ACTIVE viewer claimed the slot', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    // Two conflict cards, each with its own PDF open on a different record.
    const cardA = mountViewer(registry, slot, { active: true, docHash: H1 });
    const cardB = mountViewer(registry, slot, { active: true, docHash: H2 });

    slot.run(KIND, { type: 'delete', clientId: 'an-a', docHash: H1, viewerId: cardA.id });
    slot.run(KIND, { type: 'delete', clientId: 'an-b', docHash: H2, viewerId: cardB.id });
    expect(cardA.ran.map((o) => o.clientId)).toEqual(['an-a']);
    expect(cardB.ran.map((o) => o.clientId)).toEqual(['an-b']);
  });

  it('a survivor re-claims the slot when the viewer that held it unmounts', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    const cardA = mountViewer(registry, slot, { active: true, docHash: H1 });
    const cardB = mountViewer(registry, slot, { active: true, docHash: H2 });

    cardB.unmount();                       // the reviewer folds card B away
    expect(slot.has(KIND)).toBe(true);     // undo is NOT dead for card A
    expect(slot.run(KIND, { type: 'delete', clientId: 'an-a', docHash: H1, viewerId: cardA.id })).toBe(true);
    expect(cardA.ran).toHaveLength(1);
  });

  it('a survivor re-claims the slot when the viewer that held it goes INERT', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    const cardA = mountViewer(registry, slot, { active: true, docHash: H1 });
    const cardB = mountViewer(registry, slot, { active: true, docHash: H2 });

    cardB.setActive(false);                // the reviewer collapses card B's preview
    expect(slot.has(KIND)).toBe(true);
    expect(slot.run(KIND, { type: 'delete', clientId: 'an-a', docHash: H1, viewerId: cardA.id })).toBe(true);
    expect(cardA.ran).toHaveLength(1);
    expect(cardB.ran).toHaveLength(0);
  });

  it('nothing is registered while every mounted viewer is inert', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    const v = mountViewer(registry, slot, { active: false, docHash: '' });
    expect(slot.has(KIND)).toBe(false);
    // …and the moment the attachment lands and the pane opens, it is.
    v.setActive(true);
    expect(slot.has(KIND)).toBe(true);
  });
});

describe('116.md §74 (r3) — an op can never be replayed onto a different document', () => {
  it('refuses an undo recorded on the PREVIOUS pdf instead of applying it to this one', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    // One viewer, re-resolved from record R1 (H1) to record R2 (H2) — the screening
    // <PdfViewer> is rendered without a `key`, so the hook instance is the same one.
    const viewer = mountViewer(registry, slot, { active: true, docHash: H1 });
    const recordedOnH1 = { type: 'restore', clientId: 'an-r1', id: 'ann-1', docHash: H1, viewerId: viewer.id };
    viewer.docHash = H2;

    const out = slot.run(KIND, recordedOnH1);
    expect(out).toEqual({ ok: false, reason: 'refused', detail: NO_OWNER_DETAIL });
    expect(viewer.ran).toHaveLength(0);   // the restore never reached the API path
  });

  it('the SAME op becomes live again when that document is back on screen', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    const viewer = mountViewer(registry, slot, { active: true, docHash: H2 });
    const op = { type: 'restore', clientId: 'an-r1', id: 'ann-1', docHash: H1, viewerId: viewer.id };
    expect(slot.run(KIND, op)).toMatchObject({ ok: false, reason: 'refused' });
    viewer.docHash = H1;                 // the reviewer navigates back
    expect(slot.run(KIND, op)).toBe(true);
    expect(viewer.ran).toHaveLength(1);
  });

  it('an op naming no document is refused rather than guessed at', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    const viewer = mountViewer(registry, slot, { active: true, docHash: H1 });
    expect(slot.run(KIND, { type: 'delete', clientId: 'x', viewerId: viewer.id }))
      .toMatchObject({ ok: false, reason: 'refused' });
    expect(viewer.ran).toHaveLength(0);
  });

  it('falls back to ANOTHER viewer showing the same document when the recorder is gone', () => {
    const registry = createViewerRegistry();
    const slot = makeExecutorSlot();
    const first = mountViewer(registry, slot, { active: true, docHash: H1 });
    const second = mountViewer(registry, slot, { active: true, docHash: H1 });
    first.unmount();
    expect(slot.run(KIND, { type: 'delete', clientId: 'an-1', docHash: H1, viewerId: first.id })).toBe(true);
    expect(second.ran).toHaveLength(1);
  });
});

describe('116.md §86 (r3) — the Ctrl+Z chord never escapes to the stage undo', () => {
  const isUndo = (e) => e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey;

  it('two open panes keep two bindings, so a keystroke in pane A stays in pane A', () => {
    const reg = createRegistry();
    const fired = [];
    const A = annotationShortcutIds(newViewerId(), true);
    const B = annotationShortcutIds(newViewerId(), true);
    expect(A.undo).not.toBe(B.undo);

    // The pane the user last touched is A; B's own `when()` therefore declines.
    registerBinding(reg, { id: A.undo, tier: TIER.COMPONENT, match: isUndo, when: () => true, run: () => { fired.push('pdf-A'); return true; } });
    registerBinding(reg, { id: B.undo, tier: TIER.COMPONENT, match: isUndo, when: () => false, run: () => { fired.push('pdf-B'); return true; } });
    // The project-wide chord that reads the STAGE scope — a screening decision.
    registerBinding(reg, { id: 'history.undo', tier: TIER.GLOBAL, match: isUndo, when: () => true, run: () => { fired.push('STAGE'); return true; } });

    const hit = routeKeydown(reg, { key: 'z', ctrlKey: true }, {});
    expect(hit).toBeTruthy();
    hit.binding.run({}, {});
    expect(fired).toEqual(['pdf-A']);     // NOT 'STAGE' — §86's one prohibition
  });

  it('pane A keeps its binding after pane B unmounts', () => {
    const reg = createRegistry();
    const fired = [];
    const A = annotationShortcutIds(newViewerId(), true);
    const B = annotationShortcutIds(newViewerId(), true);
    registerBinding(reg, { id: A.undo, tier: TIER.COMPONENT, match: isUndo, when: () => true, run: () => { fired.push('pdf-A'); return true; } });
    const unB = registerBinding(reg, { id: B.undo, tier: TIER.COMPONENT, match: isUndo, when: () => false, run: () => true });
    registerBinding(reg, { id: 'history.undo', tier: TIER.GLOBAL, match: isUndo, when: () => true, run: () => { fired.push('STAGE'); return true; } });
    unB();
    routeKeydown(reg, { key: 'z', ctrlKey: true }, {}).binding.run({}, {});
    expect(fired).toEqual(['pdf-A']);
  });

  it('an INERT viewer registers no binding at all (the inert-by-default contract)', () => {
    expect(annotationShortcutIds(newViewerId(), false)).toEqual({ undo: '', redo: '' });
    const reg = createRegistry();
    const ids = annotationShortcutIds(newViewerId(), false);
    registerBinding(reg, { id: ids.undo, tier: TIER.COMPONENT, match: isUndo, when: () => true, run: () => true });
    expect(routeKeydown(reg, { key: 'z', ctrlKey: true }, {})).toBe(null);
  });
});

/**
 * Source pins. Everything above is behaviour; these three keep the WIRING that makes
 * the behaviour reachable from being quietly undone. Each of them fails against the
 * code as originally shipped, which is what makes them regression guards rather than
 * documentation.
 */
describe('116.md §74/§86 (r3) — the wiring the invariants above depend on', () => {
  const read = (p) => readFileSync(p, 'utf8');

  it('HistoryContext still keeps ONE executor per kind — the model above is faithful', () => {
    const src = read('src/frontend/history/HistoryContext.jsx');
    expect(src).toMatch(/executorsRef\.current\.set\(kind, fn\)/);
    expect(src).toMatch(/if \(executorsRef\.current\.get\(kind\) === fn\)/);
  });

  it('usePdfAnnotations registers the shared dispatcher, and only while ACTIVE', () => {
    const src = read('src/frontend/components/usePdfAnnotations.js');
    expect(src).toMatch(/if \(!active\) return undefined;\s*\n\s*return history\.registerExecutor\(PDF_ANNOTATION_KIND, dispatchOp\);/);
    // …and every recorded op names the document it was made on (§74).
    const recorded = src.match(/(undo|redo)Op: \{[^}]*\}/g) || [];
    expect(recorded.length).toBeGreaterThanOrEqual(8);
    for (const op of recorded) expect(op).toMatch(/\.\.\.at/);
  });

  it('the shortcut binding ids are per-pane, never a module constant', () => {
    const src = read('src/frontend/components/pdfAnnotationShortcut.js');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/id: ['"]pdf\.annotation\.(undo|redo)['"]/);
    expect(code).toMatch(/annotationShortcutIds\(idRef\.current, active\)/);
  });

  it('usePdfSource restates the document identity on EVERY resolve (§73)', () => {
    const src = read('src/features/extraction/unified/usePdfSource.js');
    // `setResolved` replaces the whole record, so any call that sets a URL must also
    // set `docHash` — otherwise a just-uploaded PDF silently loses its annotations.
    const calls = src.match(/setResolved\(\{[^;]*?\}\)/g) || [];
    const withUrl = calls.filter((c) => /url: (?!null)/.test(c));
    expect(withUrl.length).toBeGreaterThanOrEqual(4);
    for (const c of withUrl) expect(c).toMatch(/docHash:/);
  });
});
