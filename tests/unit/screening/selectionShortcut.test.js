/**
 * selectionShortcut.test.js — 107.md §3. Cmd/Ctrl+I / Cmd/Ctrl+E over an abstract
 * selection. Pure functions with a fake event + a fake context, so the whole guard
 * chain is testable without jsdom (house style: no jsdom, no RTL).
 */
import { describe, it, expect } from 'vitest';
import {
  matchesShortcut, shouldHandleSelectionShortcut, SHORTCUT_REJECT,
} from '../../../src/research-engine/screening/selectionShortcut.js';

const ev = (over = {}) => ({ key: 'e', metaKey: false, ctrlKey: false, altKey: false, ...over });
const ctx = (over = {}) => ({
  selectedText: 'drug-resistant epilepsy',
  selectionInsideAbstract: true,
  editableContext: false,
  modalOpen: false,
  ...over,
});

describe('matchesShortcut — modifier matrix', () => {
  it('Cmd+E / Ctrl+E → exclusion', () => {
    expect(matchesShortcut(ev({ key: 'e', metaKey: true }))).toBe('exclude');   // macOS / Safari
    expect(matchesShortcut(ev({ key: 'e', ctrlKey: true }))).toBe('exclude');   // Windows / Linux
    expect(matchesShortcut(ev({ key: 'E', metaKey: true }))).toBe('exclude');   // caps / shift
  });

  it('Cmd+I / Ctrl+I → inclusion', () => {
    expect(matchesShortcut(ev({ key: 'i', metaKey: true }))).toBe('include');
    expect(matchesShortcut(ev({ key: 'i', ctrlKey: true }))).toBe('include');
    expect(matchesShortcut(ev({ key: 'I', ctrlKey: true }))).toBe('include');
  });

  it('Safari reports Cmd as metaKey — that alone is enough', () => {
    expect(matchesShortcut({ key: 'i', metaKey: true })).toBe('include');
  });

  it('both modifiers together still resolve (Ctrl+Cmd on a mac keyboard)', () => {
    expect(matchesShortcut(ev({ key: 'e', metaKey: true, ctrlKey: true }))).toBe('exclude');
  });

  it('rejects Alt, bare letters, other letters and junk', () => {
    expect(matchesShortcut(ev({ key: 'e', metaKey: true, altKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'i', ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'e' }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'i' }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'k', metaKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'Enter', ctrlKey: true }))).toBeNull();
    expect(matchesShortcut(null)).toBeNull();
    expect(matchesShortcut({})).toBeNull();
  });
});

describe('shouldHandleSelectionShortcut — happy path', () => {
  it('handles Ctrl+E and normalizes the phrase', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'e', ctrlKey: true }), ctx({ selectedText: '  drug-resistant\n epilepsy,  ' }));
    expect(r).toEqual({ handled: true, list: 'exclude', phrase: 'drug-resistant epilepsy', reason: 'ok' });
  });

  it('handles Cmd+I', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', metaKey: true }), ctx());
    expect(r.handled).toBe(true);
    expect(r.list).toBe('include');
  });
});

describe('shouldHandleSelectionShortcut — guards', () => {
  it('ignores a keypress that is not the shortcut (so preventDefault never runs)', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'e' }), ctx());
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.NO_SHORTCUT);
  });

  it('ignores a selection that is not inside the abstract', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'e', ctrlKey: true }), ctx({ selectionInsideAbstract: false }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.OUTSIDE_ABSTRACT);
  });

  it('ignores an empty / whitespace / punctuation-only selection', () => {
    for (const sel of ['', '   ', '\n\n', '.,;']) {
      const r = shouldHandleSelectionShortcut(ev({ key: 'i', metaKey: true }), ctx({ selectedText: sel }));
      expect(r.handled).toBe(false);
      expect(r.reason).toBe(SHORTCUT_REJECT.EMPTY_SELECTION);
    }
  });

  it('ignores the shortcut in an editable context (input / textarea / select / contenteditable)', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'e', ctrlKey: true }), ctx({ editableContext: true }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.EDITABLE_CONTEXT);
  });

  it('ignores the shortcut while a modal / dialog is open', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', metaKey: true }), ctx({ modalOpen: true }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.MODAL_OPEN);
  });

  it('a modal wins over every other guard (checked first)', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', metaKey: true }), ctx({
      modalOpen: true, editableContext: true, selectionInsideAbstract: false, selectedText: '',
    }));
    expect(r.reason).toBe(SHORTCUT_REJECT.MODAL_OPEN);
  });

  it('never reports a list when it does not handle the press', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'e', ctrlKey: true }), ctx({ editableContext: true }));
    expect(r.list).toBeNull();
    expect(r.phrase).toBe('');
  });
});
