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
