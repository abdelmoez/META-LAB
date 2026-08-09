/**
 * historyStacks.test.js — 108.md §§9-11, §13, §16. The pure scope-keyed undo/redo
 * model. No jsdom, no React: the whole point of the module is that every rule is
 * testable as a function of (history, entry).
 */
import { describe, it, expect } from 'vitest';
import {
  HISTORY_CAP, TAKE_REASON, emptyHistory, isValidEntry, recordAction,
  coalesceOrRecord, peekUndo, peekRedo, takeUndo, takeRedo, completeUndo,
  completeRedo, restoreFailed, dropPending, isPendingEntry, scopeOfUndoTop,
  clearScope, clearScopes, clearAll, counts,
} from '../../../src/research-engine/interaction/historyStacks.js';

const entry = (over = {}) => ({
  id: 'e1',
  kind: 'screening.decision',
  scope: 'screening',
  label: 'Screening decision',
  projectId: 'p1',
  undoOp: { decision: '' },
  redoOp: { decision: 'include' },
  at: 1000,
  ...over,
});

/** Perform a full successful undo of the scope's top entry. */
function doUndo(hist, scope) {
  const t = takeUndo(hist, scope);
  expect(t.entry).toBeTruthy();
  return completeUndo(t.hist, scope, t.entry);
}

/** Perform a full successful redo of the scope's top redo entry. */
function doRedo(hist, scope) {
  const t = takeRedo(hist, scope);
  expect(t.entry).toBeTruthy();
  return completeRedo(t.hist, scope, t.entry);
}

describe('isValidEntry — the shape gate', () => {
  it('accepts a complete entry, with and without the optional fields', () => {
    expect(isValidEntry(entry())).toBe(true);
    expect(isValidEntry(entry({ at: undefined, meta: undefined, entityKey: 'rec-7' }))).toBe(true);
    expect(isValidEntry(entry({ redoOp: null }))).toBe(true);   // one-way entry
  });

  it('rejects malformed entries', () => {
    expect(isValidEntry(null)).toBe(false);
    expect(isValidEntry('nope')).toBe(false);
    expect(isValidEntry([])).toBe(false);
    expect(isValidEntry(entry({ id: '' }))).toBe(false);
    expect(isValidEntry(entry({ id: 7 }))).toBe(false);
    expect(isValidEntry(entry({ kind: '' }))).toBe(false);
    expect(isValidEntry(entry({ scope: '' }))).toBe(false);
    expect(isValidEntry(entry({ projectId: '' }))).toBe(false);
    expect(isValidEntry(entry({ undoOp: null }))).toBe(false);  // undo is mandatory
    expect(isValidEntry(entry({ undoOp: 'patch' }))).toBe(false);
    expect(isValidEntry(entry({ redoOp: 'patch' }))).toBe(false);
    expect(isValidEntry(entry({ label: 12 }))).toBe(false);
    expect(isValidEntry(entry({ meta: 'x' }))).toBe(false);
  });
});

describe('recordAction', () => {
  it('records onto the entry’s own scope and reports availability', () => {
    const h = recordAction(emptyHistory(), entry());
    expect(counts(h, 'screening')).toEqual({
      undo: 1, redo: 0, pending: false, canUndo: true, canRedo: false,
    });
    expect(peekUndo(h, 'screening').id).toBe('e1');
    expect(peekRedo(h, 'screening')).toBeNull();
  });

  it('ignores a malformed entry and returns the SAME history (no re-render)', () => {
    const h = recordAction(emptyHistory(), entry());
    expect(recordAction(h, null)).toBe(h);
    expect(recordAction(h, entry({ undoOp: null }))).toBe(h);
    expect(recordAction(h, { id: 'x' })).toBe(h);
  });

  it('never mutates the history it was given', () => {
    const h0 = recordAction(emptyHistory(), entry());
    const before = JSON.stringify(h0);
    recordAction(h0, entry({ id: 'e2' }));
    expect(JSON.stringify(h0)).toBe(before);
  });

  it('trims the OLDEST entries beyond the cap', () => {
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_CAP + 5; i += 1) h = recordAction(h, entry({ id: `e${i}` }));
    expect(counts(h, 'screening').undo).toBe(HISTORY_CAP);
    expect(peekUndo(h, 'screening').id).toBe(`e${HISTORY_CAP + 4}`);
    // e0…e4 fell off the bottom.
    expect(JSON.stringify(h)).not.toContain('"e0"');
    expect(JSON.stringify(h)).toContain('"e5"');
  });
});

describe('108.md §11 — stack rules and the redo branch', () => {
  it('undo moves the entry to redo, redo moves it back', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = doUndo(h, 'screening');
    expect(counts(h, 'screening')).toMatchObject({ undo: 0, redo: 1, canUndo: false, canRedo: true });
    expect(peekRedo(h, 'screening').id).toBe('A');
    h = doRedo(h, 'screening');
    expect(counts(h, 'screening')).toMatchObject({ undo: 1, redo: 0, canUndo: true, canRedo: false });
    expect(peekUndo(h, 'screening').id).toBe('A');
  });

  it('A → B → C, undo, then D clears the incompatible redo branch', () => {
    let h = emptyHistory();
    for (const id of ['A', 'B', 'C']) h = recordAction(h, entry({ id }));
    h = doUndo(h, 'screening');                       // undo C
    expect(peekUndo(h, 'screening').id).toBe('B');
    expect(peekRedo(h, 'screening').id).toBe('C');
    h = recordAction(h, entry({ id: 'D' }));          // a NEW action
    expect(counts(h, 'screening')).toMatchObject({ undo: 3, redo: 0, canRedo: false });
    expect(peekUndo(h, 'screening').id).toBe('D');    // history is A → B → D
  });

  it('a new action in ANOTHER scope leaves this scope’s redo branch alone', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = doUndo(h, 'screening');
    h = recordAction(h, entry({ id: 'X', scope: 'extraction', kind: 'extraction.field' }));
    expect(counts(h, 'screening')).toMatchObject({ redo: 1, canRedo: true });
    expect(counts(h, 'extraction')).toMatchObject({ undo: 1, canUndo: true });
  });

  it('a one-way entry (redoOp null) is undone but never becomes redoable', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'S', scope: 'search', kind: 'search.patch', redoOp: null }));
    h = doUndo(h, 'search');
    expect(counts(h, 'search')).toEqual({
      undo: 0, redo: 0, pending: false, canUndo: false, canRedo: false,
    });
  });
});

describe('108.md §3 — scope isolation', () => {
  it('each page/engine has its own independent stack', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'k1', scope: 'search', kind: 'search.patch' }));
    h = recordAction(h, entry({ id: 'd1', scope: 'screening' }));
    h = recordAction(h, entry({ id: 'x1', scope: 'extraction', kind: 'extraction.field' }));
    // "Returns to Screening, presses Ctrl+Z" → the SCREENING action, not extraction.
    expect(peekUndo(h, 'screening').id).toBe('d1');
    expect(peekUndo(h, 'extraction').id).toBe('x1');
    expect(peekUndo(h, 'search').id).toBe('k1');
    expect(counts(h, 'analysis')).toMatchObject({ undo: 0, canUndo: false });
  });

  it('an unknown scope reads as empty rather than throwing', () => {
    const h = recordAction(emptyHistory(), entry());
    expect(peekUndo(h, 'nope')).toBeNull();
    expect(peekRedo(h, undefined)).toBeNull();
    expect(counts(h, '')).toMatchObject({ undo: 0, redo: 0 });
  });
});

describe('108.md §13 — coalesceOrRecord', () => {
  const field = (over = {}) => entry({
    id: 'f1',
    kind: 'extraction.field',
    scope: 'extraction',
    entityKey: 'study-1:events',
    label: 'Extraction change',
    undoOp: { value: '' },
    redoOp: { value: 'a' },
    ...over,
  });
  const sameField = (a, b) => a.kind === b.kind && a.entityKey === b.entityKey;

  it('merges into the top entry: first prev, last next, one Ctrl+Z', () => {
    let h = coalesceOrRecord(emptyHistory(), field(), sameField);
    h = coalesceOrRecord(h, field({ id: 'f2', undoOp: { value: 'a' }, redoOp: { value: 'ab' }, at: 2000 }), sameField);
    h = coalesceOrRecord(h, field({ id: 'f3', undoOp: { value: 'ab' }, redoOp: { value: 'abc' }, at: 3000 }), sameField);
    expect(counts(h, 'extraction').undo).toBe(1);
    const top = peekUndo(h, 'extraction');
    expect(top.id).toBe('f1');                      // the ORIGINAL id survives
    expect(top.undoOp).toEqual({ value: '' });      // undo lands on the FIRST prev
    expect(top.redoOp).toEqual({ value: 'abc' });   // redo lands on the LAST next
    expect(top.at).toBe(3000);
    expect(top.meta.coalesced).toBe(3);
  });

  it('records a separate entry when the matcher declines', () => {
    let h = coalesceOrRecord(emptyHistory(), field(), sameField);
    h = coalesceOrRecord(h, field({ id: 'f9', entityKey: 'study-1:total' }), sameField);
    expect(counts(h, 'extraction').undo).toBe(2);
    expect(peekUndo(h, 'extraction').id).toBe('f9');
  });

  it('falls back to recordAction with no matcher, an empty stack, or a throwing matcher', () => {
    expect(counts(coalesceOrRecord(emptyHistory(), field(), null), 'extraction').undo).toBe(1);
    expect(counts(coalesceOrRecord(emptyHistory(), field(), sameField), 'extraction').undo).toBe(1);
    let h = coalesceOrRecord(emptyHistory(), field(), sameField);
    h = coalesceOrRecord(h, field({ id: 'f2' }), () => { throw new Error('boom'); });
    expect(counts(h, 'extraction').undo).toBe(2);
  });

  it('a merge still clears the redo branch (§11 applies to coalesced actions too)', () => {
    let h = coalesceOrRecord(emptyHistory(), field(), sameField);
    h = doUndo(h, 'extraction');
    h = recordAction(h, field({ id: 'f2' }));            // rebuild a top to merge into
    h = doUndo(h, 'extraction');
    expect(counts(h, 'extraction').redo).toBe(1);
    h = recordAction(h, field({ id: 'f3' }));
    h = coalesceOrRecord(h, field({ id: 'f4', redoOp: { value: 'z' } }), sameField);
    expect(counts(h, 'extraction').redo).toBe(0);
  });

  it('ignores a malformed entry and returns the SAME history', () => {
    const h = coalesceOrRecord(emptyHistory(), field(), sameField);
    expect(coalesceOrRecord(h, { id: 'bad' }, sameField)).toBe(h);
  });
});

describe('108 review — the mergeOps hook keeps a coalesced PRECONDITION honest', () => {
  // The extraction shape: undoOp.expect asserts what the row holds NOW (so it must
  // track the LAST keystroke) while redoOp.expect asserts what undo restored (so it
  // must track the FIRST) — the mirror image of the fields halves.
  const typed = (id, prev, next, at) => entry({
    id,
    kind: 'extraction.field',
    scope: 'extraction',
    entityKey: 's1:denominatorCustom',
    label: 'Extraction change',
    undoOp: { fields: { denominatorCustom: prev }, expect: { denominatorCustom: next } },
    redoOp: { fields: { denominatorCustom: next }, expect: { denominatorCustom: prev } },
    at,
  });
  const sameField = (a, b) => a.kind === b.kind && a.entityKey === b.entityKey;
  // The EXACT hook the extraction surface supplies.
  const mergeOps = (top, next) => ({
    undoOp: { ...top.undoOp, expect: next.undoOp.expect },
    redoOp: { ...next.redoOp, expect: top.redoOp.expect },
  });

  const typeWord = (word, hook) => {
    let h = emptyHistory();
    for (let i = 0; i < word.length; i += 1) {
      h = coalesceOrRecord(h, typed(`k${i}`, word.slice(0, i), word.slice(0, i + 1), 1000 + i), sameField, hook);
    }
    return h;
  };

  it('produces {...top.undoOp, expect:last} / {...entry.redoOp, expect:first}', () => {
    const h = typeWord('Pati', mergeOps);
    expect(counts(h, 'extraction').undo).toBe(1);
    const top = peekUndo(h, 'extraction');
    expect(top.id).toBe('k0');                                   // the original id survives
    expect(top.meta.coalesced).toBe(4);
    // Payloads: unchanged semantics — undo lands on the FIRST prev, redo on the LAST next.
    expect(top.undoOp.fields).toEqual({ denominatorCustom: '' });
    expect(top.redoOp.fields).toEqual({ denominatorCustom: 'Pati' });
    // Preconditions: the halves the hook exists for.
    expect(top.undoOp.expect).toEqual({ denominatorCustom: 'Pati' });   // what the row holds now
    expect(top.redoOp.expect).toEqual({ denominatorCustom: '' });       // what undo restored
  });

  it('WITHOUT the hook the merged expects are stale (the bug this pins shut)', () => {
    const top = peekUndo(typeWord('Pati', undefined), 'extraction');
    expect(top.undoOp.expect).toEqual({ denominatorCustom: 'P' });      // first keystroke
    expect(top.redoOp.expect).toEqual({ denominatorCustom: 'Pat' });    // second-to-last
  });

  it('leaves every other merged field exactly as the default merge does', () => {
    const withHook = peekUndo(typeWord('ab', mergeOps), 'extraction');
    const plain = peekUndo(typeWord('ab', undefined), 'extraction');
    expect(withHook.at).toBe(plain.at);
    expect(withHook.label).toBe(plain.label);
    expect(withHook.entityKey).toBe(plain.entityKey);
    expect(withHook.meta).toEqual(plain.meta);
  });

  it('falls back to the default merge for a throwing / junk / partial hook', () => {
    const plain = peekUndo(typeWord('ab', undefined), 'extraction');
    for (const bad of [() => { throw new Error('boom'); }, () => null, () => 'nope', () => ({})]) {
      expect(peekUndo(typeWord('ab', bad), 'extraction').undoOp).toEqual(plain.undoOp);
      expect(peekUndo(typeWord('ab', bad), 'extraction').redoOp).toEqual(plain.redoOp);
    }
    // A hook that supplies only one half keeps the default for the other.
    const halfway = peekUndo(typeWord('ab', (t, n) => ({ undoOp: { ...t.undoOp, expect: n.undoOp.expect } })), 'extraction');
    expect(halfway.undoOp.expect).toEqual({ denominatorCustom: 'ab' });
    expect(halfway.redoOp).toEqual(plain.redoOp);
  });

  it('an explicit redoOp:null makes the merged entry one-way; junk does not', () => {
    const oneWay = peekUndo(typeWord('ab', (t, n) => ({ undoOp: n.undoOp, redoOp: null })), 'extraction');
    expect(oneWay.redoOp).toBeNull();
    const junkRedo = peekUndo(typeWord('ab', () => ({ redoOp: 'patch' })), 'extraction');
    expect(junkRedo.redoOp).toEqual({ fields: { denominatorCustom: 'ab' }, expect: { denominatorCustom: 'a' } });
  });

  it('is never consulted when the matcher declines (no merge, no hook)', () => {
    let calls = 0;
    let h = coalesceOrRecord(emptyHistory(), typed('k0', '', 'a', 1), sameField, () => { calls += 1; return {}; });
    h = coalesceOrRecord(h, typed('k1', '', 'z', 2), () => false, () => { calls += 1; return {}; });
    expect(counts(h, 'extraction').undo).toBe(2);
    expect(calls).toBe(0);
  });
});

describe('take / complete / restoreFailed — the in-flight slot', () => {
  it('a taken entry sits on NEITHER stack until it completes', () => {
    const h0 = recordAction(emptyHistory(), entry({ id: 'A' }));
    const t = takeUndo(h0, 'screening');
    expect(t.reason).toBe(TAKE_REASON.OK);
    expect(t.entry.id).toBe('A');
    expect(counts(t.hist, 'screening')).toEqual({
      undo: 0, redo: 0, pending: true, canUndo: false, canRedo: false,
    });
  });

  it('refuses a second take while one is in flight (108.md §14 serialization)', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = recordAction(h, entry({ id: 'B' }));
    const first = takeUndo(h, 'screening');
    const second = takeUndo(first.hist, 'screening');
    expect(second.entry).toBeNull();
    expect(second.reason).toBe(TAKE_REASON.BUSY);
    expect(second.hist).toBe(first.hist);              // untouched
    const alsoRedo = takeRedo(first.hist, 'screening');
    expect(alsoRedo.reason).toBe(TAKE_REASON.BUSY);
  });

  it('an in-flight undo in one scope does not block another scope', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = recordAction(h, entry({ id: 'X', scope: 'extraction', kind: 'extraction.field' }));
    const first = takeUndo(h, 'screening');
    expect(takeUndo(first.hist, 'extraction').reason).toBe(TAKE_REASON.OK);
  });

  it('reports empty / no-scope without changing anything', () => {
    const h = emptyHistory();
    expect(takeUndo(h, 'screening')).toEqual({ hist: h, entry: null, reason: TAKE_REASON.EMPTY });
    expect(takeRedo(h, 'screening').reason).toBe(TAKE_REASON.EMPTY);
    expect(takeUndo(h, '').reason).toBe(TAKE_REASON.NO_SCOPE);
    expect(takeUndo(h, null).reason).toBe(TAKE_REASON.NO_SCOPE);
  });

  it('restoreFailed puts a failed undo back on the undo stack, ready to retry', () => {
    const h0 = recordAction(emptyHistory(), entry({ id: 'A' }));
    const t = takeUndo(h0, 'screening');
    const h1 = restoreFailed(t.hist, 'screening', t.entry, 'undo');
    expect(counts(h1, 'screening')).toEqual({
      undo: 1, redo: 0, pending: false, canUndo: true, canRedo: false,
    });
    expect(peekUndo(h1, 'screening').id).toBe('A');
  });

  it('restoreFailed puts a failed redo back on the redo stack', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = doUndo(h, 'screening');
    const t = takeRedo(h, 'screening');
    const back = restoreFailed(t.hist, 'screening', t.entry, 'redo');
    expect(counts(back, 'screening')).toMatchObject({ undo: 0, redo: 1, pending: false, canRedo: true });
  });

  it('a failed undo can be retried and then succeed', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    const first = takeUndo(h, 'screening');
    h = restoreFailed(first.hist, 'screening', first.entry, 'undo');
    const second = takeUndo(h, 'screening');
    expect(second.reason).toBe(TAKE_REASON.OK);
    h = completeUndo(second.hist, 'screening', second.entry);
    expect(counts(h, 'screening')).toMatchObject({ undo: 0, redo: 1, pending: false });
  });

  it('a full undo → redo → undo cycle is stable', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    for (let i = 0; i < 3; i += 1) {
      h = doUndo(h, 'screening');
      expect(counts(h, 'screening')).toMatchObject({ undo: 0, redo: 1 });
      h = doRedo(h, 'screening');
      expect(counts(h, 'screening')).toMatchObject({ undo: 1, redo: 0 });
    }
    expect(peekUndo(h, 'screening').id).toBe('A');
  });
});

describe('108 review — a scope cleared mid-flight is never resurrected', () => {
  // takeUndo → (the executor is a real network round trip) → the project changes /
  // an autosave 409 lands → the executor resolves. Completing must DROP the entry:
  // pushing it would re-create a scope belonging to a project the user has left,
  // and its redoOp would then run against the WRONG project's data.
  const inFlight = () => {
    const h0 = recordAction(emptyHistory(), entry({ id: 'A' }));
    const t = takeUndo(h0, 'screening');
    expect(t.entry.id).toBe('A');
    return t;
  };

  it('completeUndo after clearScope leaves the scope absent', () => {
    const t = inFlight();
    const cleared = clearScope(t.hist, 'screening');
    const after = completeUndo(cleared, 'screening', t.entry);
    expect(after).toBe(cleared);                       // unchanged, same reference
    expect('screening' in after).toBe(false);
    expect(counts(after, 'screening')).toMatchObject({ undo: 0, redo: 0, canRedo: false });
  });

  it('completeRedo after clearAll leaves the history empty', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = doUndo(h, 'screening');                        // A is now redoable
    const t = takeRedo(h, 'screening');
    const cleared = clearAll(t.hist);
    const after = completeRedo(cleared, 'screening', t.entry);
    expect(Object.keys(after)).toHaveLength(0);
  });

  it('restoreFailed after clearScopes drops the entry instead of re-creating the scope', () => {
    const t = inFlight();
    const cleared = clearScopes(t.hist, (s) => s === 'screening');
    for (const dir of ['undo', 'redo']) {
      const after = restoreFailed(cleared, 'screening', t.entry, dir);
      expect(after).toBe(cleared);
      expect('screening' in after).toBe(false);
    }
  });

  it('an entry the pending slot does not own is dropped, other scopes untouched', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = recordAction(h, entry({ id: 'X', scope: 'extraction', kind: 'extraction.field' }));
    const t = takeUndo(h, 'screening');
    // A stale completion for a DIFFERENT entry must not push anything.
    const after = completeUndo(t.hist, 'screening', entry({ id: 'ghost' }));
    expect(after).toBe(t.hist);
    expect(counts(after, 'screening')).toMatchObject({ pending: true, undo: 0, redo: 0 });
    expect(counts(after, 'extraction').undo).toBe(1);
  });

  it('the normal (un-cleared) completion path is unchanged', () => {
    const t = inFlight();
    expect(counts(completeUndo(t.hist, 'screening', t.entry), 'screening'))
      .toMatchObject({ undo: 0, redo: 1, pending: false });
    expect(counts(restoreFailed(t.hist, 'screening', t.entry, 'undo'), 'screening'))
      .toMatchObject({ undo: 1, redo: 0, pending: false });
  });
});

describe('108 review — dropPending / isPendingEntry / scopeOfUndoTop', () => {
  it('dropPending frees the slot WITHOUT pushing the entry back', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = recordAction(h, entry({ id: 'B' }));
    const t = takeUndo(h, 'screening');                // B is in flight
    const after = dropPending(t.hist, 'screening', t.entry);
    expect(counts(after, 'screening')).toEqual({
      undo: 1, redo: 0, pending: false, canUndo: true, canRedo: false,
    });
    // …and the older, still-valid entry underneath becomes reachable again.
    expect(peekUndo(after, 'screening').id).toBe('A');
  });

  it('dropPending is a no-op (same reference) when the slot is empty or foreign', () => {
    const h = recordAction(emptyHistory(), entry({ id: 'A' }));
    expect(dropPending(h, 'screening', entry({ id: 'A' }))).toBe(h);
    const t = takeUndo(h, 'screening');
    expect(dropPending(t.hist, 'screening', entry({ id: 'ghost' }))).toBe(t.hist);
    expect(dropPending(t.hist, 'nope', t.entry)).toBe(t.hist);
  });

  it('isPendingEntry answers the in-flight ownership question', () => {
    const h = recordAction(emptyHistory(), entry({ id: 'A' }));
    expect(isPendingEntry(h, 'screening', 'A')).toBe(false);
    const t = takeUndo(h, 'screening');
    expect(isPendingEntry(t.hist, 'screening', 'A')).toBe(true);
    expect(isPendingEntry(t.hist, 'screening', 'B')).toBe(false);
    expect(isPendingEntry(t.hist, 'screening', '')).toBe(false);
    expect(isPendingEntry(t.hist, 'screening', null)).toBe(false);
    expect(isPendingEntry(clearAll(t.hist), 'screening', 'A')).toBe(false);
  });

  it('scopeOfUndoTop finds the scope only while the entry is still on top', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A' }));
    h = recordAction(h, entry({ id: 'X', scope: 'extraction', kind: 'extraction.field' }));
    expect(scopeOfUndoTop(h, 'A')).toBe('screening');
    expect(scopeOfUndoTop(h, 'X')).toBe('extraction');
    // A newer action in the same scope buries A → no longer directly undoable.
    h = recordAction(h, entry({ id: 'B' }));
    expect(scopeOfUndoTop(h, 'A')).toBe('');
    expect(scopeOfUndoTop(h, 'nope')).toBe('');
    expect(scopeOfUndoTop(h, '')).toBe('');
    expect(scopeOfUndoTop(null, 'A')).toBe('');
    // An entry that has been undone is on the REDO stack, not the undo stack.
    expect(scopeOfUndoTop(doUndo(h, 'screening'), 'B')).toBe('');
  });
});

describe('clearing — 108.md §16 lifetime', () => {
  const seeded = () => {
    let h = recordAction(emptyHistory(), entry({ id: 'd1', scope: 'screening' }));
    h = recordAction(h, entry({ id: 'x1', scope: 'extraction', kind: 'extraction.field' }));
    h = recordAction(h, entry({ id: 'a1', scope: 'analysis', kind: 'analysis.config' }));
    return h;
  };

  it('clearScope drops one page and leaves the rest', () => {
    const h = clearScope(seeded(), 'extraction');
    expect(counts(h, 'extraction').undo).toBe(0);
    expect(counts(h, 'screening').undo).toBe(1);
  });

  it('clearScope on an unknown scope returns the SAME history', () => {
    const h = seeded();
    expect(clearScope(h, 'nope')).toBe(h);
    expect(clearScope(h, '')).toBe(h);
  });

  it('clearScopes drops the blob-backed scopes on an autosave conflict', () => {
    const blobScopes = new Set(['extraction', 'analysis', 'manuscript']);
    const h = clearScopes(seeded(), (scope) => blobScopes.has(scope));
    expect(counts(h, 'extraction').undo).toBe(0);
    expect(counts(h, 'analysis').undo).toBe(0);
    expect(counts(h, 'screening').undo).toBe(1);   // relational, unaffected by a blob 409
  });

  it('clearScopes is a no-op (same reference) with no predicate or no match', () => {
    const h = seeded();
    expect(clearScopes(h, null)).toBe(h);
    expect(clearScopes(h, () => false)).toBe(h);
    expect(clearScopes(h, () => { throw new Error('x'); })).toBe(h);
  });

  it('clearAll empties everything, and is a no-op on an empty history', () => {
    const h = clearAll(seeded());
    expect(Object.keys(h)).toHaveLength(0);
    const e = emptyHistory();
    expect(clearAll(e)).toBe(e);
  });

  it('a scope with nothing left is dropped from the history object entirely', () => {
    let h = recordAction(emptyHistory(), entry({ id: 'A', redoOp: null }));
    h = doUndo(h, 'screening');
    expect(Object.keys(h)).toHaveLength(0);
  });
});
