/**
 * historyProvider.test.jsx — 108.md §§8, §14-17. The React face of the history
 * system.
 *
 * SSR static markup (project convention; no jsdom, no React Testing Library).
 * Effects do not run under renderToStaticMarkup, so the provider is asserted on
 * (a) the contract it exposes through context and (b) the PURE helpers the
 * asynchronous path is built out of — stampEntry, normalizeExecutorResult and
 * historyNote. The stack transitions those helpers feed are covered end-to-end in
 * tests/unit/interaction/historyStacks.test.js.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup as r } from 'react-dom/server';
import {
  HistoryProvider, useProjectHistory, stampEntry, normalizeExecutorResult,
  historyNote, shouldClearForProject, HISTORY_FAIL, REFUSAL_DROP_LIMIT,
  SUPERSEDED_MESSAGE, executorSignature, hasExecutorKind, historyAvailability,
  delegateSignature, normalizeScopeDelegate,
} from '../../../src/frontend/history/HistoryContext.jsx';
import {
  emptyHistory, recordAction, takeUndo,
} from '../../../src/research-engine/interaction/historyStacks.js';

let captured = null;
function Capture() {
  captured = useProjectHistory();
  return h('span', {
    'data-testid': 'probe',
    'data-scope': captured.scope,
    'data-can-undo': String(captured.canUndo),
    'data-can-redo': String(captured.canRedo),
  });
}

const DECISION = 'screening.decision';
const decision = (over = {}) => ({
  kind: DECISION, label: 'Screening decision',
  undoOp: { decision: '' }, redoOp: { decision: 'include' },
  ...over,
});

/**
 * Mount the provider and hand back its live context plus every feedback note it
 * emitted. Effects never run under renderToStaticMarkup, so the asynchronous half
 * of the provider is exercised by CALLING the context — the callbacks read the
 * synchronous `histRef`, which is exactly the path a rapid Ctrl+Z Ctrl+Z takes.
 */
function mount(props = {}) {
  const notes = [];
  let n = 0;
  r(h(HistoryProvider, {
    projectId: 'p1',
    scope: 'screening',
    onFeedback: (note) => notes.push(note),
    idFn: () => `x${(n += 1)}`,
    now: () => 1000,
    ...props,
  }, h(Capture)));
  return { ctx: captured, notes };
}

describe('HistoryProvider — rendering + context shape', () => {
  it('renders its children and adds no markup of its own', () => {
    const html = r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' },
      h('main', { 'data-testid': 'page' }, 'workbench')));
    expect(html).toBe('<main data-testid="page">workbench</main>');
  });

  it('exposes the current scope and an empty, unavailable history', () => {
    const html = r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' }, h(Capture)));
    expect(html).toContain('data-scope="screening"');
    expect(html).toContain('data-can-undo="false"');
    expect(captured).toMatchObject({
      scope: 'screening', projectId: 'p1',
      canUndo: false, canRedo: false, pending: false,
      undoCount: 0, redoCount: 0, nextUndo: null, nextRedo: null,
    });
    for (const fn of ['record', 'coalesce', 'undo', 'redo', 'undoEntry', 'registerExecutor', 'clearScope', 'clearScopes', 'clearAll']) {
      expect(typeof captured[fn]).toBe('function');
    }
  });

  it('normalises a missing/numeric scope rather than crashing', () => {
    r(h(HistoryProvider, { projectId: 7 }, h(Capture)));
    expect(captured.scope).toBe('');
    expect(captured.canUndo).toBe(false);
  });

  it('registerExecutor hands back an unregister function', () => {
    r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' }, h(Capture)));
    const off = captured.registerExecutor('screening.decision', async () => true);
    expect(typeof off).toBe('function');
    off();
    expect(captured.registerExecutor('', () => {})).toBeInstanceOf(Function);
    expect(captured.registerExecutor('kind', 'not-a-fn')).toBeInstanceOf(Function);
  });
});

describe('useProjectHistory outside a provider', () => {
  it('returns an inert shape instead of throwing (engines can adopt it early)', async () => {
    const html = r(h(Capture));
    expect(html).toContain('data-can-undo="false"');
    expect(captured.canUndo).toBe(false);
    expect(captured.record({ kind: 'x' })).toBeNull();
    expect(await captured.undo()).toEqual({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null });
    expect(await captured.redo()).toEqual({ ok: false, reason: HISTORY_FAIL.NO_ENTRY, entry: null });
    expect(await captured.undoEntry('anything')).toEqual({ ok: false, reason: HISTORY_FAIL.SUPERSEDED, entry: null });
    expect(() => captured.clearAll()).not.toThrow();
  });
});

describe('108 review §22 — availability is EXECUTOR-aware', () => {
  const seeded = () => recordAction(emptyHistory(), {
    id: 'A', kind: DECISION, scope: 'screening', projectId: 'p1',
    label: 'Screening decision', undoOp: { decision: '' }, redoOp: { decision: 'include' },
  });

  it('executorSignature / hasExecutorKind describe the mounted handlers', () => {
    expect(executorSignature([])).toBe('|');
    expect(executorSignature(['b', 'a'])).toBe('|a|b|');
    expect(executorSignature(new Map([['k', () => {}]]).keys())).toBe('|k|');
    expect(executorSignature(['ok', '', null, 7])).toBe('|ok|');
    expect(hasExecutorKind('|a|b|', 'a')).toBe(true);
    expect(hasExecutorKind('|a|b|', 'c')).toBe(false);
    expect(hasExecutorKind('|', 'a')).toBe(false);
    // A prefix must not count as a match (screening.decision ≠ screening).
    expect(hasExecutorKind('|screening.decision|', 'screening')).toBe(false);
    expect(hasExecutorKind('|a|', '')).toBe(false);
  });

  it('historyAvailability turns a stack with no mounted executor UNAVAILABLE', () => {
    const hist = seeded();
    const off = historyAvailability(hist, 'screening', '|');
    expect(off).toMatchObject({ undo: 1, canUndo: false, canRedo: false });
    expect(off.nextUndo.id).toBe('A');                 // still there, just not runnable here
    const on = historyAvailability(hist, 'screening', executorSignature([DECISION]));
    expect(on).toMatchObject({ undo: 1, canUndo: true });
    // …and an unrelated page's executor does not unlock it.
    expect(historyAvailability(hist, 'screening', '|extraction.field|').canUndo).toBe(false);
  });

  it('an in-flight operation still disables both directions', () => {
    const t = takeUndo(seeded(), 'screening');
    expect(historyAvailability(t.hist, 'screening', executorSignature([DECISION])))
      .toMatchObject({ pending: true, canUndo: false, canRedo: false });
  });

  it('the provider renders the header control disabled when the page is unmounted', () => {
    const withoutExec = r(h(HistoryProvider, {
      projectId: 'p1', scope: 'screening', initialHistory: seeded(),
    }, h(Capture)));
    expect(withoutExec).toContain('data-can-undo="false"');
    expect(captured.undoCount).toBe(1);                // the stack is NOT empty
    expect(captured.nextUndo.id).toBe('A');

    const withExec = r(h(HistoryProvider, {
      projectId: 'p1', scope: 'screening', initialHistory: seeded(),
      initialExecutors: { [DECISION]: async () => true },
    }, h(Capture)));
    expect(withExec).toContain('data-can-undo="true"');
    expect(withExec).toContain('data-can-redo="false"');
  });

  it('undo() refuses gracefully WITHOUT taking the entry, and works after the page returns', async () => {
    const { ctx, notes } = mount();
    const e = ctx.record(decision());
    const blocked = await ctx.undo();
    expect(blocked).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_EXECUTOR });
    expect(blocked.entry.id).toBe(e.id);
    expect(notes.at(-1)).toMatchObject({
      tone: 'warn', message: 'Return to the page where the change was made to undo it',
    });

    const ran = [];
    ctx.registerExecutor(DECISION, async (op, meta) => { ran.push([op, meta.direction]); return true; });
    expect(await ctx.undo()).toMatchObject({ ok: true, reason: '' });
    expect(ran).toEqual([[{ decision: '' }, 'undo']]);
    expect(notes.at(-1).message).toBe('Screening decision undone');
  });

  it('registering and unregistering flips availability both ways', async () => {
    const { ctx } = mount();
    ctx.record(decision());
    const off = ctx.registerExecutor(DECISION, async () => true);
    expect(await ctx.undo()).toMatchObject({ ok: true });         // executor mounted
    expect(await ctx.redo()).toMatchObject({ ok: true });         // redo path too
    off();                                                        // the page unmounts
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_EXECUTOR });
  });
});

describe('108 review §25 — a scope may DELEGATE its undo to the page that owns it', () => {
  it('delegateSignature mirrors the two booleans, from a Map or a snapshot', () => {
    expect(delegateSignature(null)).toBe('|');
    expect(delegateSignature(new Map())).toBe('|');
    expect(delegateSignature(new Map([['search', { canUndo: true, canRedo: false }]]))).toBe('|search:10|');
    expect(delegateSignature({ search: { canUndo: true, canRedo: false } })).toBe('|search:10|');
    // Order-independent, so a re-register in a different order does not re-render.
    expect(delegateSignature({ b: { canUndo: true }, a: { canRedo: true } }))
      .toBe(delegateSignature({ a: { canRedo: true }, b: { canUndo: true } }));
    expect(delegateSignature({ search: { canUndo: false, canRedo: false } })).toBe('|search:00|');
  });

  it('normalizeScopeDelegate rejects a declaration that cannot actually do anything', () => {
    expect(normalizeScopeDelegate(null)).toBeNull();
    expect(normalizeScopeDelegate({ canUndo: true })).toBeNull();          // no function
    expect(normalizeScopeDelegate([])).toBeNull();
    // A flag without its function is downgraded, never trusted.
    expect(normalizeScopeDelegate({ canUndo: true, canRedo: true, undo: () => {} }))
      .toMatchObject({ canUndo: true, canRedo: false });
  });

  it('historyAvailability ORs the delegate in — but never over an in-flight operation', () => {
    const empty = emptyHistory();
    expect(historyAvailability(empty, 'search', '|').canUndo).toBe(false);
    expect(historyAvailability(empty, 'search', '|', { canUndo: true }).canUndo).toBe(true);
    expect(historyAvailability(empty, 'search', '|', { canUndo: true }).canRedo).toBe(false);
    const busy = takeUndo(recordAction(empty, {
      id: 'A', kind: DECISION, scope: 'search', projectId: 'p1',
      label: 'x', undoOp: { decision: '' }, redoOp: null,
    }), 'search');
    expect(historyAvailability(busy.hist, 'search', '|', { canUndo: true }))
      .toMatchObject({ pending: true, canUndo: false });
  });

  it('the provider runs the delegate, silently (the page owns its own feedback)', async () => {
    const { ctx, notes } = mount({ scope: 'search' });
    const ran = [];
    ctx.registerScopeDelegate('search', { canUndo: true, undo: () => { ran.push('undo'); } });
    expect(await ctx.undo()).toMatchObject({ ok: true, delegated: true, entry: null });
    expect(ran).toEqual(['undo']);
    expect(notes).toHaveLength(0);
    // No redo declared → the shared Redo stays an honest no-op, not a crash.
    expect(await ctx.redo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_ENTRY });
  });

  it('a delegate NEVER jumps ahead of a real entry in the same scope', async () => {
    const { ctx } = mount({ scope: 'search' });
    const ran = [];
    ctx.registerExecutor(DECISION, async () => { ran.push('executor'); return true; });
    ctx.registerScopeDelegate('search', { canUndo: true, undo: () => { ran.push('delegate'); } });
    ctx.record({ ...decision(), scope: 'search' });
    expect(await ctx.undo()).toMatchObject({ ok: true });
    expect(ran).toEqual(['executor']);              // the provider's own entry won
    expect(await ctx.undo()).toMatchObject({ ok: true, delegated: true });
    expect(ran).toEqual(['executor', 'delegate']);  // …only then the delegate
  });

  it('a declining delegate leaves the chord alone; unregistering restores silence', async () => {
    const { ctx } = mount({ scope: 'search' });
    const off = ctx.registerScopeDelegate('search', { canUndo: false, undo: () => { throw new Error('nope'); } });
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_ENTRY });
    off();
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_ENTRY });
    expect(ctx.registerScopeDelegate('', { undo: () => {} })).toBeInstanceOf(Function);
    expect(ctx.registerScopeDelegate('search', null)).toBeInstanceOf(Function);
  });

  it('a throwing delegate is reported as a failed write, not swallowed', async () => {
    const { ctx, notes } = mount({ scope: 'search' });
    ctx.registerScopeDelegate('search', { canUndo: true, undo: () => { throw new Error('boom'); } });
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.FAILED, detail: 'boom' });
    expect(notes.at(-1)).toMatchObject({ tone: 'error', message: 'Could not undo — the change was not saved' });
  });

  it('only the CURRENT scope’s delegate feeds the header (another page’s does not)', () => {
    r(h(HistoryProvider, {
      projectId: 'p1', scope: 'screening',
      initialDelegates: { search: { canUndo: true, undo: () => {} } },
    }, h(Capture)));
    expect(captured.canUndo).toBe(false);
    r(h(HistoryProvider, {
      projectId: 'p1', scope: 'search',
      initialDelegates: { search: { canUndo: true, undo: () => {} } },
    }, h(Capture)));
    expect(captured.canUndo).toBe(true);
  });
});

describe('108 review §22 — undoBlocked/redoBlocked separate "empty" from "not here"', () => {
  const seeded = () => recordAction(emptyHistory(), {
    id: 'A', kind: DECISION, scope: 'screening', projectId: 'p1',
    label: 'Screening decision', undoOp: { decision: '' }, redoOp: { decision: 'include' },
  });

  it('is false on an empty scope and true on a stack with no mounted executor', () => {
    r(h(HistoryProvider, { projectId: 'p1', scope: 'screening' }, h(Capture)));
    expect(captured).toMatchObject({ undoBlocked: false, redoBlocked: false });
    r(h(HistoryProvider, { projectId: 'p1', scope: 'screening', initialHistory: seeded() }, h(Capture)));
    expect(captured).toMatchObject({ canUndo: false, undoBlocked: true, redoBlocked: false });
    r(h(HistoryProvider, {
      projectId: 'p1', scope: 'screening', initialHistory: seeded(),
      initialExecutors: { [DECISION]: async () => true },
    }, h(Capture)));
    expect(captured).toMatchObject({ canUndo: true, undoBlocked: false });
  });
});

describe('108 review — undoEntry(id): the snackbar reverses the action it names', () => {
  it('runs the entry while it is the scope’s top, and refuses once it is buried', async () => {
    const { ctx, notes } = mount();
    ctx.registerExecutor(DECISION, async () => true);
    const a = ctx.record(decision({ label: 'Keyword deleted' }));
    const b = ctx.record(decision({ label: 'Keyword deleted' }));

    // Note A is still on screen 8 s later, but B is on top now.
    const stale = await ctx.undoEntry(a.id);
    expect(stale).toEqual({ ok: false, reason: HISTORY_FAIL.SUPERSEDED, detail: '', entry: null });
    expect(notes.at(-1)).toMatchObject({ tone: 'warn', message: SUPERSEDED_MESSAGE });
    expect(SUPERSEDED_MESSAGE).toBe('That action can no longer be undone directly — press Ctrl+Z to step back.');

    // …and the stack was NOT disturbed: B is still exactly where it was.
    const okB = await ctx.undoEntry(b.id);
    expect(okB).toMatchObject({ ok: true });
    expect(okB.entry.id).toBe(b.id);
    // With B gone, A is the top again and its note's button works.
    expect(await ctx.undoEntry(a.id)).toMatchObject({ ok: true, entry: { id: a.id } });
    // Consumed: a second press is a no-op refusal, not a double-undo.
    expect(await ctx.undoEntry(a.id)).toMatchObject({ ok: false, reason: HISTORY_FAIL.SUPERSEDED });
  });

  it('finds the entry’s OWN scope, not the page the user is looking at now', async () => {
    const { ctx } = mount();
    ctx.registerExecutor('extraction.field', async () => true);
    const x = ctx.record({ ...decision(), kind: 'extraction.field', scope: 'extraction' });
    expect(ctx.scope).toBe('screening');
    expect(await ctx.undoEntry(x.id)).toMatchObject({ ok: true, entry: { id: x.id } });
  });

  it('refuses junk ids without touching anything', async () => {
    const { ctx } = mount();
    ctx.registerExecutor(DECISION, async () => true);
    const a = ctx.record(decision());
    for (const bad of ['', null, undefined, 7, 'nope']) {
      expect(await ctx.undoEntry(bad)).toMatchObject({ ok: false, reason: HISTORY_FAIL.SUPERSEDED });
    }
    expect(await ctx.undoEntry(a.id)).toMatchObject({ ok: true });
  });

  it('a refusal from the executor is reported as a refusal, not as superseded', async () => {
    const { ctx } = mount();
    ctx.registerExecutor(DECISION, async () => ({ ok: false, reason: HISTORY_FAIL.REFUSED }));
    const a = ctx.record(decision());
    expect(await ctx.undoEntry(a.id)).toMatchObject({ ok: false, reason: HISTORY_FAIL.REFUSED });
  });
});

describe('108 review — a refusal explains ITSELF when the executor knows better', () => {
  const LOCKED = 'This article is completed/locked — reopen it to undo.';

  it('surfaces the executor’s detail as the note, and keeps the result’s reason', async () => {
    const { ctx, notes } = mount({ scope: 'extraction' });
    ctx.registerExecutor('extraction.field', async () => ({
      ok: false, reason: HISTORY_FAIL.REFUSED, detail: LOCKED,
    }));
    ctx.record({ kind: 'extraction.field', label: 'Extraction change', undoOp: { v: '' }, redoOp: { v: 'a' } });
    const res = await ctx.undo();
    expect(res).toMatchObject({ ok: false, reason: HISTORY_FAIL.REFUSED, detail: LOCKED });
    expect(notes.at(-1)).toMatchObject({ tone: 'warn', message: LOCKED, scope: 'extraction' });
  });

  it('falls back to the generic collaborator line when the executor says nothing', async () => {
    const { ctx, notes } = mount({ scope: 'extraction' });
    ctx.registerExecutor('extraction.field', async () => false);
    ctx.record({ kind: 'extraction.field', label: 'Extraction change', undoOp: { v: '' }, redoOp: { v: 'a' } });
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.REFUSED);
    expect(notes.at(-1).message).toBe('Could not undo — changed by a collaborator');
  });

  it('still drops the entry after the limit, and the DROP note keeps its own copy', async () => {
    const { ctx, notes } = mount({ scope: 'extraction' });
    ctx.registerExecutor('extraction.field', async () => ({
      ok: false, reason: HISTORY_FAIL.REFUSED, detail: LOCKED,
    }));
    ctx.record({ kind: 'extraction.field', label: 'Extraction change', undoOp: { v: '' }, redoOp: { v: 'a' } });
    expect(notes).toHaveLength(0);
    await ctx.undo();
    expect(notes.at(-1).message).toBe(LOCKED);
    const dropped = await ctx.undo();
    expect(dropped).toMatchObject({ reason: HISTORY_FAIL.DROPPED, dropped: true });
    expect(notes.at(-1).message)
      .toBe('Could not undo — “Extraction change” no longer matches the current data and was removed from history');
  });
});

describe('108 review — an entry that keeps refusing is dropped, not left jamming the scope', () => {
  it(`drops after ${REFUSAL_DROP_LIMIT} consecutive refusals and frees the entries behind it`, async () => {
    const { ctx, notes } = mount();
    ctx.registerExecutor(DECISION, async () => ({ ok: false, reason: HISTORY_FAIL.REFUSED }));
    const a = ctx.record(decision({ label: 'Older change' }));
    const b = ctx.record(decision({ label: 'Extraction change' }));

    const first = await ctx.undo();
    expect(first).toMatchObject({ ok: false, reason: HISTORY_FAIL.REFUSED });
    expect(first.entry.id).toBe(b.id);
    expect(notes.at(-1).message).toBe('Could not undo — changed by a collaborator');

    const second = await ctx.undo();
    expect(second).toMatchObject({ ok: false, reason: HISTORY_FAIL.DROPPED, dropped: true });
    expect(second.entry.id).toBe(b.id);
    expect(notes.at(-1)).toMatchObject({
      tone: 'warn',
      message: 'Could not undo — “Extraction change” no longer matches the current data and was removed from history',
    });

    // The poisoned entry is gone, so the older VALID entry is reachable again.
    const third = await ctx.undo();
    expect(third.entry.id).toBe(a.id);
  });

  it('only CONSECUTIVE refusals count — a failed write resets the counter', async () => {
    const { ctx } = mount();
    let mode = 'refuse';
    ctx.registerExecutor(DECISION, async () => {
      if (mode === 'throw') throw new Error('offline');
      return { ok: false, reason: HISTORY_FAIL.REFUSED };
    });
    ctx.record(decision());
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.REFUSED);
    mode = 'throw';
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.FAILED);
    mode = 'refuse';
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.REFUSED);   // counter restarted
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.DROPPED);
  });

  it('a success clears the counter, so a later refusal is not a second strike', async () => {
    const { ctx } = mount();
    let refuse = false;
    ctx.registerExecutor(DECISION, async () => (refuse ? { ok: false, reason: HISTORY_FAIL.REFUSED } : true));
    ctx.record(decision());
    refuse = true;
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.REFUSED);
    refuse = false;
    expect((await ctx.undo()).ok).toBe(true);                        // undone
    expect((await ctx.redo()).ok).toBe(true);                        // and back
    refuse = true;
    expect((await ctx.undo()).reason).toBe(HISTORY_FAIL.REFUSED);    // strike one again
  });
});

describe('108 review — a scope cleared mid-flight never comes back', () => {
  const src = readFileSync(new URL('../../../src/frontend/history/HistoryContext.jsx', import.meta.url), 'utf8');

  it('a successful undo whose scope was cleared drops the entry and stays silent', async () => {
    const { ctx, notes } = mount();
    ctx.registerExecutor(DECISION, async () => { ctx.clearScope('screening'); return true; });
    ctx.record(decision());
    const res = await ctx.undo();
    expect(res).toMatchObject({ ok: true, dropped: true });
    expect(notes).toHaveLength(0);                     // the note would name a page that is gone
    // Nothing was resurrected: no redo entry, no undo entry.
    expect(await ctx.redo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_ENTRY });
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_ENTRY });
  });

  it('a REFUSED undo whose scope was cleared is dropped too (no restore)', async () => {
    const { ctx, notes } = mount();
    ctx.registerExecutor(DECISION, async () => { ctx.clearAll(); return { ok: false, reason: HISTORY_FAIL.REFUSED }; });
    ctx.record(decision());
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.REFUSED, dropped: true });
    expect(notes).toHaveLength(0);
    expect(await ctx.undo()).toMatchObject({ ok: false, reason: HISTORY_FAIL.NO_ENTRY });
  });

  it('the project-change path runs the same clearAll (effects do not run under SSR)', () => {
    expect(src).toContain('if (!shouldClearForProject(projectSeen.current, projectId)) return;');
    expect(src).toContain('applyHist(clearAllPure(histRef.current));');
    expect(src).toContain('refusalsRef.current.clear();');
  });
});

describe('108 review — coalesce() hands back the entry that is actually on the stack', () => {
  const field = (over = {}) => ({
    kind: 'extraction.field', scope: 'extraction', entityKey: 's1:events',
    label: 'Extraction change', undoOp: { v: '' }, redoOp: { v: 'a' }, ...over,
  });
  const sameField = (a, b) => a.entityKey === b.entityKey;

  it('returns the SURVIVING (merged) entry, so its id stays undoable', async () => {
    const { ctx } = mount();
    ctx.registerExecutor('extraction.field', async () => true);
    const first = ctx.coalesce(field(), sameField);
    const merged = ctx.coalesce(field({ undoOp: { v: 'a' }, redoOp: { v: 'ab' } }), sameField);
    expect(merged.id).toBe(first.id);
    expect(merged.meta.coalesced).toBe(2);
    expect(await ctx.undoEntry(merged.id)).toMatchObject({ ok: true });
  });

  it('threads the mergeOps hook through to the stack', () => {
    const { ctx } = mount();
    ctx.coalesce(field({ undoOp: { v: '', expect: 'a' }, redoOp: { v: 'a', expect: '' } }), sameField);
    const merged = ctx.coalesce(
      field({ undoOp: { v: 'a', expect: 'ab' }, redoOp: { v: 'ab', expect: 'a' } }),
      sameField,
      (top, next) => ({
        undoOp: { ...top.undoOp, expect: next.undoOp.expect },
        redoOp: { ...next.redoOp, expect: top.redoOp.expect },
      }),
    );
    expect(merged.undoOp).toEqual({ v: '', expect: 'ab' });
    expect(merged.redoOp).toEqual({ v: 'ab', expect: '' });
  });

  it('still records normally (and returns the new entry) when nothing merges', () => {
    const { ctx } = mount();
    const a = ctx.coalesce(field(), sameField);
    const b = ctx.coalesce(field({ entityKey: 's1:total' }), sameField);
    expect(b.id).not.toBe(a.id);
    expect(ctx.coalesce({ kind: '' }, sameField)).toBeNull();
  });
});

describe('stampEntry — ids and timestamps are seeded OUTSIDE the updater', () => {
  const base = {
    kind: 'screening.decision', label: 'Screening decision',
    undoOp: { decision: '' }, redoOp: { decision: 'include' },
  };

  it('fills id, at, scope and projectId from the injected sources', () => {
    let n = 0;
    const e = stampEntry(base, {
      idFn: () => `id-${++n}`, now: () => 1234,
      scope: 'screening', projectId: 'p1',
    });
    expect(e).toMatchObject({ id: 'id-1', at: 1234, scope: 'screening', projectId: 'p1', label: 'Screening decision' });
  });

  it('never overwrites values the caller supplied', () => {
    const e = stampEntry({ ...base, id: 'mine', at: 9, scope: 'extraction', projectId: 'p9' }, {
      idFn: () => 'generated', now: () => 1234, scope: 'screening', projectId: 'p1',
    });
    expect(e).toMatchObject({ id: 'mine', at: 9, scope: 'extraction', projectId: 'p9' });
  });

  it('coerces non-string ids/scopes and normalises a missing redoOp to null', () => {
    const e = stampEntry({ ...base, redoOp: undefined }, { scope: 12, projectId: 34, idFn: () => 'i', now: () => 0 });
    expect(e.scope).toBe('12');
    expect(e.projectId).toBe('34');
    expect(e.redoOp).toBeNull();
    expect(e.label).toBe('Screening decision');
  });

  it('defaults the label to an empty string and returns null for junk', () => {
    expect(stampEntry({ kind: 'k', undoOp: {} }, { idFn: () => 'i', now: () => 0 }).label).toBe('');
    expect(stampEntry(null)).toBeNull();
    expect(stampEntry('nope')).toBeNull();
    expect(stampEntry([])).toBeNull();
  });

  it('produces a distinct id per call (two records are two entries)', () => {
    const e1 = stampEntry(base, { scope: 's', projectId: 'p' });
    const e2 = stampEntry(base, { scope: 's', projectId: 'p' });
    expect(e1.id).not.toBe(e2.id);
  });
});

describe('normalizeExecutorResult — the executor return contract', () => {
  it('treats undefined / true / a value as success', () => {
    for (const v of [undefined, null, true, 1, 'ok', {}, { ok: true }, { changed: true }]) {
      expect(normalizeExecutorResult(v).ok).toBe(true);
    }
  });

  it('treats false as a refusal', () => {
    expect(normalizeExecutorResult(false)).toEqual({ ok: false, reason: HISTORY_FAIL.REFUSED, detail: '' });
  });

  it('carries an explicit reason and detail through', () => {
    expect(normalizeExecutorResult({ ok: false, reason: HISTORY_FAIL.FAILED, detail: 'HTTP 409' }))
      .toEqual({ ok: false, reason: HISTORY_FAIL.FAILED, detail: 'HTTP 409' });
    expect(normalizeExecutorResult({ ok: false }).reason).toBe(HISTORY_FAIL.REFUSED);
  });
});

describe('historyNote — 108.md §17 feedback copy', () => {
  const entry = { label: 'Screening decision', scope: 'screening', kind: 'screening.decision' };

  it('confirms a successful undo and redo', () => {
    expect(historyNote(entry, 'undo', { ok: true })).toEqual({
      scope: 'screening', kind: 'screening.decision', direction: 'undo',
      tone: 'info', message: 'Screening decision undone',
    });
    expect(historyNote({ ...entry, label: 'Extraction change' }, 'redo', { ok: true }).message)
      .toBe('Extraction change redone');
  });

  it('explains a collaborator conflict and a failed write', () => {
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.REFUSED }))
      .toMatchObject({ tone: 'warn', message: 'Could not undo — changed by a collaborator' });
    expect(historyNote(entry, 'redo', { ok: false, reason: HISTORY_FAIL.FAILED }))
      .toMatchObject({ tone: 'error', message: 'Could not redo — the change was not saved' });
  });

  it('lets a refusing executor say WHY, in its own words', () => {
    const locked = 'This article is completed/locked — reopen it to undo.';
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.REFUSED, detail: locked }))
      .toMatchObject({ tone: 'warn', message: locked });
    expect(historyNote(entry, 'redo', { ok: false, reason: HISTORY_FAIL.REFUSED, detail: locked }).message)
      .toBe(locked);
    // Blank / whitespace / non-string detail is no explanation at all.
    for (const d of ['', '   ', 7, null, undefined]) {
      expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.REFUSED, detail: d }).message)
        .toBe('Could not undo — changed by a collaborator');
    }
    // Only a REFUSAL speaks for itself; a failed write keeps its own copy.
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.FAILED, detail: 'HTTP 409' }).message)
      .toBe('Could not undo — the change was not saved');
  });

  it('POINTS AT THE PAGE when the executor is unmounted rather than crying error', () => {
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.NO_EXECUTOR }))
      .toMatchObject({ tone: 'warn', message: 'Return to the page where the change was made to undo it' });
    expect(historyNote(entry, 'redo', { ok: false, reason: HISTORY_FAIL.NO_EXECUTOR }).message)
      .toBe('Return to the page where the change was made to redo it');
  });

  it('explains a superseded snackbar button and a dropped entry', () => {
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.SUPERSEDED }))
      .toMatchObject({ tone: 'warn', message: SUPERSEDED_MESSAGE });
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.DROPPED }))
      .toMatchObject({
        tone: 'warn',
        message: 'Could not undo — “Screening decision” no longer matches the current data and was removed from history',
      });
  });

  it('stays SILENT for a no-op and for a blocked in-flight press (§26)', () => {
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.NO_ENTRY })).toBeNull();
    expect(historyNote(entry, 'undo', { ok: false, reason: HISTORY_FAIL.BUSY })).toBeNull();
    expect(historyNote(null, 'undo', { ok: false, reason: 'whatever' })).toBeNull();
  });

  it('falls back to a generic label and to undo for an unknown direction', () => {
    expect(historyNote({}, 'sideways', { ok: true }).message).toBe('Change undone');
  });
});

describe('shouldClearForProject — 108.md §16', () => {
  it('clears only when the project actually changes', () => {
    expect(shouldClearForProject('p1', 'p1')).toBe(false);
    expect(shouldClearForProject(7, '7')).toBe(false);
    expect(shouldClearForProject(undefined, null)).toBe(false);
    expect(shouldClearForProject('p1', 'p2')).toBe(true);
    expect(shouldClearForProject(undefined, 'p1')).toBe(true);
  });
});
