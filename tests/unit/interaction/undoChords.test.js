/**
 * undoChords.test.js — 108.md §2, §7, §24, §26. The exact modifier matrix for
 * Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z, and the shared context gate that keeps native
 * text editing (and an open dialog) in charge of the keyboard.
 */
import { describe, it, expect } from 'vitest';
import {
  isUndoChord, isRedoChord, historyShortcutAllowed, SEARCH_SCOPE_REDO,
} from '../../../src/research-engine/interaction/undoChords.js';
import { isEditableDomTarget } from '../../../src/frontend/shortcuts/domTarget.js';
import { MODAL_SELECTOR, SCREENING_MODAL_ATTR, STITCH_MODAL_ATTR, isAnyModalOpen }
  from '../../../src/research-engine/interaction/modalSignal.js';
import { SCREENING_MODAL_ATTR as SCREENING_ATTR_SOURCE }
  from '../../../src/frontend/screening/ui/components.jsx';

const ev = (over = {}) => ({
  key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over,
});

describe('isUndoChord — Ctrl/Cmd+Z', () => {
  it('accepts the Windows/Linux and macOS forms, in either letter case', () => {
    expect(isUndoChord(ev({ ctrlKey: true }))).toBe(true);
    expect(isUndoChord(ev({ metaKey: true }))).toBe(true);
    expect(isUndoChord(ev({ ctrlKey: true, key: 'Z' }))).toBe(true);
  });

  it('rejects the bare key and every unmodified sibling', () => {
    expect(isUndoChord(ev())).toBe(false);
    expect(isUndoChord(ev({ ctrlKey: true, key: 'y' }))).toBe(false);
    expect(isUndoChord(ev({ ctrlKey: true, key: 'a' }))).toBe(false);
  });

  it('rejects Shift — that chord is redo, not a tolerated variant', () => {
    expect(isUndoChord(ev({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoChord(ev({ metaKey: true, shiftKey: true }))).toBe(false);
  });

  it('rejects Alt (Alt+Ctrl+Z belongs to the OS/browser)', () => {
    expect(isUndoChord(ev({ ctrlKey: true, altKey: true }))).toBe(false);
  });

  it('is null-safe', () => {
    expect(isUndoChord(null)).toBe(false);
    expect(isUndoChord(undefined)).toBe(false);
    expect(isUndoChord('z')).toBe(false);
    expect(isUndoChord({})).toBe(false);
  });
});

describe('isRedoChord — Ctrl/Cmd+Shift+Z, plus the legacy Ctrl+Y', () => {
  it('accepts the required chord on both platforms', () => {
    expect(isRedoChord(ev({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isRedoChord(ev({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isRedoChord(ev({ metaKey: true, shiftKey: true, key: 'Z' }))).toBe(true);
  });

  it('accepts Ctrl+Y as the additional Windows redo (108.md §2)', () => {
    expect(isRedoChord(ev({ ctrlKey: true, key: 'y' }))).toBe(true);
    expect(isRedoChord(ev({ ctrlKey: true, key: 'Y' }))).toBe(true);
  });

  it('does NOT claim Cmd+Y (macOS Safari History) or Ctrl+Shift+Y', () => {
    expect(isRedoChord(ev({ metaKey: true, key: 'y' }))).toBe(false);
    expect(isRedoChord(ev({ ctrlKey: true, shiftKey: true, key: 'y' }))).toBe(false);
  });

  it('rejects the plain undo chord and anything with Alt', () => {
    expect(isRedoChord(ev({ ctrlKey: true }))).toBe(false);
    expect(isRedoChord(ev({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isRedoChord(ev({ shiftKey: true }))).toBe(false);
  });

  it('never overlaps with isUndoChord — one event can only be one action', () => {
    const modifiers = [false, true];
    for (const ctrlKey of modifiers) {
      for (const metaKey of modifiers) {
        for (const shiftKey of modifiers) {
          for (const altKey of modifiers) {
            for (const key of ['z', 'Z', 'y', 'Y', 'a']) {
              const e = { key, ctrlKey, metaKey, shiftKey, altKey };
              expect(isUndoChord(e) && isRedoChord(e)).toBe(false);
            }
          }
        }
      }
    }
  });
});

describe('historyShortcutAllowed — 108.md §7 native editing + §24 tier 1', () => {
  const ctx = (over = {}) => ({ editableTarget: false, modalOpen: false, ...over });

  it('allows the chord on a neutral page surface', () => {
    expect(historyShortcutAllowed(ctx())).toBe(true);
  });

  it('refuses while the caret is in a typing surface', () => {
    expect(historyShortcutAllowed(ctx({ editableTarget: true }))).toBe(false);
  });

  it('refuses while a dialog owns the keyboard', () => {
    expect(historyShortcutAllowed(ctx({ modalOpen: true }))).toBe(false);
  });

  it('is null-safe (a missing context never claims a key)', () => {
    expect(historyShortcutAllowed(null)).toBe(false);
    expect(historyShortcutAllowed('nope')).toBe(false);
  });

  it('does not decide availability — each binding adds its own canUndo term', () => {
    // The gate is deliberately blind to canUndo/canRedo: with an empty history the
    // BINDING must decline, or an async run() would preventDefault a no-op Ctrl+Z.
    expect(historyShortcutAllowed(ctx({ canUndo: false }))).toBe(true);
  });
});

describe('the editable predicate the gate is fed from (108.md §7)', () => {
  it('recognises every typing surface, including the manuscript editor', () => {
    expect(isEditableDomTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableDomTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableDomTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableDomTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableDomTarget({ tagName: 'DIV', role: 'textbox' })).toBe(true);
  });

  it('reads the role from getAttribute when ARIA reflection is unavailable', () => {
    // This is the equivalence that makes migrating SearchBuilderTab's listener into
    // the router behaviour-preserving: it used getAttribute('role'), and older
    // engines do not expose Element.role at all.
    const legacyEl = { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'searchbox' : null) };
    expect(isEditableDomTarget(legacyEl)).toBe(true);
    const throwing = { tagName: 'DIV', getAttribute: () => { throw new Error('detached'); } };
    expect(isEditableDomTarget(throwing)).toBe(false);
  });

  it('leaves chips, buttons and the page body undoable', () => {
    expect(isEditableDomTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableDomTarget({ tagName: 'BODY' })).toBe(false);
    expect(isEditableDomTarget({ tagName: 'SPAN', role: 'listitem' })).toBe(false);
    expect(isEditableDomTarget(null)).toBe(false);
  });
});

describe('modalSignal — one probe for both dialog families (108.md §24)', () => {
  it('keeps the screening attribute in lockstep with its owning module', () => {
    expect(SCREENING_MODAL_ATTR).toBe(SCREENING_ATTR_SOURCE);
  });

  it('matches a screening dialog and a Stitch dialog with one selector', () => {
    expect(MODAL_SELECTOR).toContain(`[${SCREENING_MODAL_ATTR}]`);
    expect(MODAL_SELECTOR).toContain(`[${STITCH_MODAL_ATTR}]`);
  });

  it('answers false without a document (SSR) and honours an injected one', () => {
    expect(isAnyModalOpen(null)).toBe(false);
    expect(isAnyModalOpen({ querySelector: () => null })).toBe(false);
    expect(isAnyModalOpen({ querySelector: () => ({}) })).toBe(true);
    expect(isAnyModalOpen({ querySelector: () => { throw new Error('x'); } })).toBe(false);
  });
});

describe('search-scope redo is documented as unavailable this round', () => {
  it('is a constant, not a silent omission', () => {
    expect(SEARCH_SCOPE_REDO).toBe(false);
  });
});
