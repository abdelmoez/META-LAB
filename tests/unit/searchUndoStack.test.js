/**
 * searchUndoStack.test.js — 85.md A1. The pure inverse-patch undo stack over
 * { concepts, ignored }: restoring a removal ALSO removes the ignored entry it
 * created (critique #7 — no contradictory state), a restored concept returns to
 * its original index, re-added terms never duplicate, and the stack clears on
 * remote adoption / version restore.
 */
import { describe, it, expect } from 'vitest';
import {
  UNDO_STACK_CAP, recordRemoveTerm, recordRemoveConcept, recordDisable, recordBulkAccept,
  undoLast, clear,
} from '../../src/research-engine/searchBuilder/undoStack.js';
import { setTermDisabled, serializeSearchState, syncSearchBuilderFromPico } from '../../src/research-engine/searchBuilder/searchState.js';
import { norm } from '../../src/research-engine/searchBuilder/conceptExtraction.js';

const term = (id, text, extra = {}) => ({ id, text, type: 'freetext', field: 'tiab', source: 'pico_auto', ...extra });
const concept = (id, label, terms, extra = {}) => ({ id, label, op: 'AND', field: label, source: 'pico_auto', terms, ...extra });

const baseState = () => ({
  concepts: [
    concept('c1', 'Population', [term('t1', 'obesity'), term('t2', 'overweight')], { picoField: 'P' }),
    concept('c2', 'Intervention / Exposure', [term('t3', 'metformin')], { picoField: 'I' }),
  ],
  ignored: [],
});

describe('recordRemoveTerm / undoLast', () => {
  it('restores the term at its original index AND removes the ignored entry the removal added', () => {
    const state = baseState();
    const removed = state.concepts[0].terms[0]; // 'obesity' at index 0
    const entry = { text: 'obesity', field: 'Population', label: 'Population' };
    let stack = recordRemoveTerm([], { concept: state.concepts[0], term: removed, ignoredEntryAdded: entry });
    const after = {
      concepts: state.concepts.map((c) => (c.id === 'c1' ? { ...c, terms: c.terms.filter((t) => t.id !== 't1') } : c)),
      ignored: [entry],
    };
    const out = undoLast(stack, after);
    expect(out.stack).toEqual([]);
    expect(out.state.concepts[0].terms.map((t) => t.id)).toEqual(['t1', 't2']); // original index 0
    expect(out.state.ignored).toEqual([]); // the contradictory ignored entry is gone
    expect(out.description).toBe('Restored "obesity"');
  });

  it('the restored term survives the next PICO re-sync (no silent re-drop)', () => {
    // Full round-trip: sync → remove auto term (+ ignored) → undo → re-sync.
    const synced = syncSearchBuilderFromPico({ P: 'obesity' }, [], []);
    const pop = synced.find((c) => c.picoField === 'P');
    const target = pop.terms.find((t) => norm(t.text) === 'obesity');
    const withIds = synced.map((c, i) => ({ ...c, id: c.id || `g${i}` }));
    const popC = withIds.find((c) => c.picoField === 'P');
    const entry = { text: target.text, field: 'Population', label: 'Population' };
    const stack = recordRemoveTerm([], { concept: popC, term: target, ignoredEntryAdded: entry });
    const after = {
      concepts: withIds.map((c) => (c.picoField === 'P' ? { ...c, terms: c.terms.filter((t) => norm(t.text) !== 'obesity') } : c)),
      ignored: [entry],
    };
    const un = undoLast(stack, after);
    const resynced = syncSearchBuilderFromPico({ P: 'obesity' }, un.state.concepts, un.state.ignored.map((e) => e.text));
    expect(resynced.find((c) => c.picoField === 'P').terms.some((t) => norm(t.text) === 'obesity')).toBe(true);
  });

  it('undo after the term was re-added manually → NO duplicate, but the ignored cleanup still runs', () => {
    const state = baseState();
    const removed = state.concepts[0].terms[0];
    const entry = { text: 'obesity', field: 'Population', label: 'Population' };
    const stack = recordRemoveTerm([], { concept: state.concepts[0], term: removed, ignoredEntryAdded: entry });
    const reAdded = {
      concepts: state.concepts.map((c) => (c.id === 'c1'
        ? { ...c, terms: [...c.terms.filter((t) => t.id !== 't1'), { id: 't9', text: 'Obesity', type: 'freetext', field: 'tiab', source: 'user_added' }] }
        : c)),
      ignored: [entry],
    };
    const out = undoLast(stack, reAdded);
    const texts = out.state.concepts[0].terms.map((t) => norm(t.text));
    expect(texts.filter((t) => t === 'obesity')).toHaveLength(1); // no duplicate
    expect(out.state.ignored).toEqual([]); // cleanup still happened
  });

  it('degrades to a no-op restore when the concept vanished (collaborator deleted it)', () => {
    const state = baseState();
    const stack = recordRemoveTerm([], { concept: state.concepts[0], term: state.concepts[0].terms[0], ignoredEntryAdded: { text: 'obesity' } });
    const withoutConcept = { concepts: [state.concepts[1]], ignored: [{ text: 'obesity', field: '', label: '' }] };
    const out = undoLast(stack, withoutConcept);
    expect(out.state.concepts).toHaveLength(1); // nothing resurrected
    expect(out.state.ignored).toEqual([]);      // but the ignored entry is still cleaned
  });
});

describe('recordRemoveConcept / undoLast', () => {
  it('restores the concept at its ORIGINAL index and clears its ignored entries', () => {
    const state = baseState();
    const removed = state.concepts[0];
    const entries = removed.terms.map((t) => ({ text: t.text, field: 'Population', label: 'Population' }));
    const stack = recordRemoveConcept([], { concept: removed, index: 0, ignoredEntriesAdded: entries });
    const after = { concepts: [state.concepts[1]], ignored: entries };
    const out = undoLast(stack, after);
    expect(out.state.concepts.map((c) => c.id)).toEqual(['c1', 'c2']); // back at index 0
    expect(out.state.ignored).toEqual([]);
    expect(out.description).toBe('Restored concept "Population"');
  });
  it('does not duplicate a concept that already came back (same id present)', () => {
    const state = baseState();
    const stack = recordRemoveConcept([], { concept: state.concepts[0], index: 0, ignoredEntriesAdded: [] });
    const out = undoLast(stack, state); // concept never actually left
    expect(out.state.concepts).toHaveLength(2);
  });
});

describe('recordDisable / undoLast', () => {
  it('re-enables by DELETING the key — state returns byte-identical to the original', () => {
    const state = baseState();
    const c = state.concepts[0];
    const t = c.terms[0];
    const stack = recordDisable([], { concept: c, term: t });
    const disabled = { ...state, concepts: setTermDisabled(state.concepts, 'c1', 't1', true) };
    const out = undoLast(stack, disabled);
    expect(serializeSearchState({ concepts: out.state.concepts, overrides: {}, ignored: [] }))
      .toBe(serializeSearchState({ concepts: state.concepts, overrides: {}, ignored: [] }));
    expect(out.description).toBe('Re-enabled "obesity"');
  });

  it('undo does NOT stamp the `kept` sync marker (that belongs to the deliberate Enable toggle)', () => {
    const state = baseState();
    const stack = recordDisable([], { concept: state.concepts[0], term: state.concepts[0].terms[0] });
    const disabled = { ...state, concepts: setTermDisabled(state.concepts, 'c1', 't1', true) };
    const out = undoLast(stack, disabled);
    expect('kept' in out.state.concepts[0].terms[0]).toBe(false);
    // …whereas the toggle path stamps it on this same pico_auto term.
    expect(setTermDisabled(disabled.concepts, 'c1', 't1', false)[0].terms[0].kept).toBe(true);
  });
});

describe('recordBulkAccept / undoLast', () => {
  it('removes exactly the terms the bulk accept created', () => {
    const state = baseState();
    const withAccepted = {
      ...state,
      concepts: state.concepts.map((c) => (c.id === 'c1'
        ? { ...c, terms: [...c.terms, term('n1', 'adiposity', { source: 'synonym' }), term('n2', 'corpulence', { source: 'synonym' })] }
        : c)),
    };
    const stack = recordBulkAccept([], { concept: withAccepted.concepts[0], termIds: ['n1', 'n2'] });
    const out = undoLast(stack, withAccepted);
    expect(out.state.concepts[0].terms.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(out.description).toBe('Removed 2 accepted terms');
  });
  it('records nothing for an empty id list', () => {
    expect(recordBulkAccept([], { concept: { id: 'c1' }, termIds: [] })).toEqual([]);
  });
});

describe('stack mechanics', () => {
  it('LIFO: the most recent action undoes first', () => {
    const state = baseState();
    let stack = recordDisable([], { concept: state.concepts[0], term: state.concepts[0].terms[0] });
    stack = recordDisable(stack, { concept: state.concepts[0], term: state.concepts[0].terms[1] });
    let s = { ...state, concepts: setTermDisabled(setTermDisabled(state.concepts, 'c1', 't1', true), 'c1', 't2', true) };
    const first = undoLast(stack, s);
    expect(first.description).toBe('Re-enabled "overweight"'); // last action first
    const second = undoLast(first.stack, first.state);
    expect(second.description).toBe('Re-enabled "obesity"');
    expect(undoLast(second.stack, second.state)).toBeNull(); // empty → null
  });

  it('caps at 20 entries, dropping the OLDEST', () => {
    const state = baseState();
    let stack = [];
    for (let i = 0; i < 25; i++) {
      stack = recordDisable(stack, { concept: state.concepts[0], term: { id: `x${i}`, text: `term ${i}` } });
    }
    expect(stack).toHaveLength(UNDO_STACK_CAP);
    expect(stack[0].termId).toBe('x5'); // 0..4 dropped
    expect(stack[UNDO_STACK_CAP - 1].termId).toBe('x24');
  });

  it('clear() empties the stack (the applyRemote / version-restore contract)', () => {
    const state = baseState();
    const stack = recordDisable([], { concept: state.concepts[0], term: state.concepts[0].terms[0] });
    expect(clear(stack)).toEqual([]);
    expect(clear(null)).toEqual([]);
  });

  it('never mutates its inputs', () => {
    const state = baseState();
    const snapshot = JSON.stringify(state);
    const stack = recordRemoveTerm([], { concept: state.concepts[0], term: state.concepts[0].terms[0], ignoredEntryAdded: { text: 'obesity' } });
    undoLast(stack, state);
    expect(JSON.stringify(state)).toBe(snapshot);
    expect(stack).toHaveLength(1); // undoLast returned a new stack; input intact
  });
});

/* ══════════════ 96.md D13 — group operations: reorder / merge / split ══════════ */

import {
  recordReorderConcept, recordReorderTerm, recordMergeConcepts, recordSplitConcept,
} from '../../src/research-engine/searchBuilder/undoStack.js';
import {
  reorderConcept, reorderTerm, mergeConcepts, splitConcept,
} from '../../src/research-engine/searchBuilder/searchState.js';

const g = (id, label, terms = []) => ({ id, label, source: 'user_added', op: 'AND', terms });
const t = (id, text) => ({ id, text, type: 'freetext', field: 'tiab', source: 'user_added' });

describe('96.md — recordReorderConcept + inverse', () => {
  it('undo moves the concept back to its ORIGINAL index', () => {
    const list = [g('a', 'A'), g('b', 'B'), g('c', 'C')];
    const moved = reorderConcept(list, 'b', +1); // a, c, b
    const stack = recordReorderConcept([], { conceptId: 'b', fromIndex: 1, toIndex: 2, label: 'B' });
    const r = undoLast(stack, { concepts: moved, ignored: [] });
    expect(r.state.concepts.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.stack).toEqual([]);
    expect(r.description).toContain('B');
  });
  it('degrades to a calm no-op when the concept vanished (collaborator deleted it)', () => {
    const stack = recordReorderConcept([], { conceptId: 'zz', fromIndex: 0, toIndex: 1 });
    const r = undoLast(stack, { concepts: [g('a', 'A')], ignored: [] });
    expect(r.state.concepts.map((x) => x.id)).toEqual(['a']);
  });
  it('refuses to record junk (no id / same index)', () => {
    expect(recordReorderConcept([], {})).toEqual([]);
    expect(recordReorderConcept([], { conceptId: 'a', fromIndex: 1, toIndex: 1 })).toEqual([]);
  });
});

describe('96.md QA M3 — recordReorderTerm + inverse (within-group order)', () => {
  const withTerms = () => [g('a', 'A', [t('t1', 'one'), t('t2', 'two'), t('t3', 'three')]), g('b', 'B')];
  it('undo restores the EXACT pre-move term order (byte-identical inverse)', () => {
    const list = withTerms();
    const moved = reorderTerm(list, 'a', 't2', +1); // one, three, two
    const stack = recordReorderTerm([], { conceptId: 'a', termId: 't2', fromIndex: 1, toIndex: 2, text: 'two' });
    const r = undoLast(stack, { concepts: moved, ignored: [] });
    expect(r.state.concepts[0].terms.map((x) => x.id)).toEqual(['t1', 't2', 't3']);
    expect(serializeSearchState({ concepts: r.state.concepts })).toBe(serializeSearchState({ concepts: list }));
    expect(r.stack).toEqual([]);
    expect(r.description).toContain('two');
  });
  it('degrades to a calm no-op when the concept or term vanished meanwhile', () => {
    const stack1 = recordReorderTerm([], { conceptId: 'zz', termId: 't1', fromIndex: 0, toIndex: 1, text: 'x' });
    const r1 = undoLast(stack1, { concepts: withTerms(), ignored: [] });
    expect(r1.state.concepts[0].terms.map((x) => x.id)).toEqual(['t1', 't2', 't3']);
    const stack2 = recordReorderTerm([], { conceptId: 'a', termId: 'gone', fromIndex: 0, toIndex: 1, text: 'x' });
    const r2 = undoLast(stack2, { concepts: withTerms(), ignored: [] });
    expect(r2.state.concepts[0].terms.map((x) => x.id)).toEqual(['t1', 't2', 't3']);
  });
  it('refuses to record junk (missing ids / same index)', () => {
    expect(recordReorderTerm([], {})).toEqual([]);
    expect(recordReorderTerm([], { conceptId: 'a', termId: 't1', fromIndex: 1, toIndex: 1 })).toEqual([]);
  });
});

describe('96.md — recordMergeConcepts + inverse', () => {
  it('undo strips exactly the moved terms and re-inserts the ORIGINAL source concept', () => {
    const from = g('x', 'Imaging', [t('x1', 'sonography'), t('x2', 'ultrasonic waves')]);
    const into = g('y', 'Ultrasound', [t('y1', 'ultrasound')]);
    const res = mergeConcepts([from, into], 'x', 'y');
    const stack = recordMergeConcepts([], res.undo);
    const r = undoLast(stack, { concepts: res.concepts, ignored: [] });
    expect(r.state.concepts.map((x) => x.id)).toEqual(['x', 'y']);
    expect(r.state.concepts[0]).toBe(from); // the original object returns intact
    expect(r.state.concepts[1].terms.map((x) => x.id)).toEqual(['y1']); // moved terms gone
    expect(r.description).toContain('Imaging');
  });
  it('never duplicates the source when it somehow still exists', () => {
    const from = g('x', 'Imaging', [t('x1', 'sonography')]);
    const stack = recordMergeConcepts([], { fromConcept: from, fromIndex: 0, intoId: 'y', movedTermIds: [] });
    const r = undoLast(stack, { concepts: [from, g('y', 'Ultrasound')], ignored: [] });
    expect(r.state.concepts.filter((c) => c.id === 'x')).toHaveLength(1);
  });
});

describe('96.md — recordSplitConcept + inverse', () => {
  const src = g('s', 'Drugs', [t('d1', 'dapagliflozin'), t('d2', 'empagliflozin'), t('d3', 'metformin')]);
  const doSplit = () => {
    const res = splitConcept([src], 's', ['d1', 'd2'], 'SGLT2 inhibitors');
    const withId = res.concepts.map((c, i) => (i === res.newIndex ? { ...c, id: 'new1' } : c));
    return withId;
  };
  it('undo moves the split-off terms back and removes the (now empty) new group', () => {
    const concepts = doSplit();
    const stack = recordSplitConcept([], { fromConceptId: 's', newConceptId: 'new1', termIds: ['d1', 'd2'], label: 'SGLT2 inhibitors' });
    const r = undoLast(stack, { concepts, ignored: [] });
    expect(r.state.concepts.map((c) => c.id)).toEqual(['s']);
    expect(r.state.concepts[0].terms.map((x) => x.id)).toEqual(['d3', 'd1', 'd2']);
    expect(r.description).toContain('SGLT2 inhibitors');
  });
  it('keeps the new group when it gained OTHER terms after the split (their work survives)', () => {
    const concepts = doSplit().map((c) => (c.id === 'new1' ? { ...c, terms: [...c.terms, t('extra', 'canagliflozin')] } : c));
    const stack = recordSplitConcept([], { fromConceptId: 's', newConceptId: 'new1', termIds: ['d1', 'd2'], label: 'SGLT2 inhibitors' });
    const r = undoLast(stack, { concepts, ignored: [] });
    expect(r.state.concepts.map((c) => c.id)).toEqual(['s', 'new1']);
    expect(r.state.concepts[1].terms.map((x) => x.id)).toEqual(['extra']);
  });
  it('degrades to a no-op when either side vanished', () => {
    const stack = recordSplitConcept([], { fromConceptId: 's', newConceptId: 'gone', termIds: ['d1'] });
    const r = undoLast(stack, { concepts: [src], ignored: [] });
    expect(r.state.concepts).toEqual([src]);
  });
  it('refuses to record junk (missing ids / empty selection)', () => {
    expect(recordSplitConcept([], {})).toEqual([]);
    expect(recordSplitConcept([], { fromConceptId: 'a', newConceptId: 'b', termIds: [] })).toEqual([]);
  });
});
