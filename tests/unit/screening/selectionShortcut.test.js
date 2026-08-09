/**
 * selectionShortcut.test.js — 107.md §3 + 108.md §1. Cmd/Ctrl+I / Cmd/Ctrl+E over an
 * abstract selection. Pure functions with a fake event + a fake context, so the whole
 * guard chain is testable without jsdom (house style: no jsdom, no RTL).
 *
 * 108.md §1 additions: the Shift'd (browser-reserved) chords are never claimed;
 * repeat / IME / already-claimed events are skipped; and `canProcess` is part of the
 * chain, so "PecanRev cannot act on this" means the browser keeps its default.
 */
import { describe, it, expect } from 'vitest';
import {
  matchesShortcut, keyEventRejection, shouldHandleSelectionShortcut, SHORTCUT_REJECT,
} from '../../../src/research-engine/screening/selectionShortcut.js';

const ev = (over = {}) => ({ key: 'e', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
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
    expect(matchesShortcut(ev({ key: 'E', metaKey: true }))).toBe('exclude');   // caps lock
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

// 108.md §1 — the regression that made Ctrl+Shift+I add a keyword AND open DevTools.
describe('matchesShortcut — Shift is never our chord (108.md §1)', () => {
  it('rejects every Shift+modifier+I / +E combination', () => {
    // `key` is the SHIFTED character the browser reports for these presses.
    expect(matchesShortcut(ev({ key: 'I', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'I', metaKey: true, shiftKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'E', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'E', metaKey: true, shiftKey: true }))).toBeNull();
    // …and the lower-case variants some engines report.
    expect(matchesShortcut(ev({ key: 'i', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchesShortcut(ev({ key: 'e', metaKey: true, shiftKey: true }))).toBeNull();
    // Ctrl+Cmd+Shift+I too — Shift disqualifies regardless of the other modifiers.
    expect(matchesShortcut(ev({ key: 'I', ctrlKey: true, metaKey: true, shiftKey: true }))).toBeNull();
  });

  it('a Shift’d chord over a perfectly valid selection is NOT handled', () => {
    for (const key of ['I', 'E']) {
      for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
        const r = shouldHandleSelectionShortcut(ev({ key, shiftKey: true, ...mod }), ctx());
        expect(r.handled).toBe(false);
        expect(r.reason).toBe(SHORTCUT_REJECT.NO_SHORTCUT);
        expect(r.list).toBeNull();
        expect(r.phrase).toBe('');
      }
    }
  });

  it('Shift alone (no Ctrl/Cmd) is still nothing', () => {
    expect(matchesShortcut(ev({ key: 'I', shiftKey: true }))).toBeNull();
  });
});

describe('keyEventRejection — event-state guards (108.md §1)', () => {
  it('a clean event is actionable', () => {
    expect(keyEventRejection(ev({ key: 'i', ctrlKey: true }))).toBeNull();
    expect(keyEventRejection({})).toBeNull();
  });

  it('an event a nearer handler already cancelled is not ours', () => {
    expect(keyEventRejection({ defaultPrevented: true })).toBe(SHORTCUT_REJECT.ALREADY_HANDLED);
  });

  it('auto-repeat ticks are skipped', () => {
    expect(keyEventRejection({ repeat: true })).toBe(SHORTCUT_REJECT.KEY_REPEAT);
  });

  it('IME composition is skipped (isComposing and the keyCode 229 sentinel)', () => {
    expect(keyEventRejection({ isComposing: true })).toBe(SHORTCUT_REJECT.IME_COMPOSING);
    expect(keyEventRejection({ keyCode: 229 })).toBe(SHORTCUT_REJECT.IME_COMPOSING);
    expect(keyEventRejection({ keyCode: 73 })).toBeNull();   // plain "I"
  });

  it('junk input is rejected rather than treated as actionable', () => {
    expect(keyEventRejection(null)).toBe(SHORTCUT_REJECT.NO_SHORTCUT);
    expect(keyEventRejection('nope')).toBe(SHORTCUT_REJECT.NO_SHORTCUT);
  });

  it('defaultPrevented wins over repeat wins over composing (stable codes)', () => {
    expect(keyEventRejection({ defaultPrevented: true, repeat: true, isComposing: true }))
      .toBe(SHORTCUT_REJECT.ALREADY_HANDLED);
    expect(keyEventRejection({ repeat: true, isComposing: true })).toBe(SHORTCUT_REJECT.KEY_REPEAT);
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

  it('a modal wins over every other CONTEXT guard (checked first)', () => {
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

describe('shouldHandleSelectionShortcut — event-state guards in the chain (108.md §1)', () => {
  it('a repeated chord over a valid selection is not handled', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, repeat: true }), ctx());
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.KEY_REPEAT);
  });

  it('a chord a nearer handler already claimed is not handled', () => {
    // e.g. the manuscript editor's Ctrl/Cmd+I italic, which cancels at React-root
    // bubble time — before this window-bubble listener ever runs.
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', metaKey: true, defaultPrevented: true }), ctx());
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.ALREADY_HANDLED);
  });

  it('a chord mid-IME-composition is not handled (either signal)', () => {
    const a = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, isComposing: true }), ctx());
    const b = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, keyCode: 229 }), ctx());
    expect(a.reason).toBe(SHORTCUT_REJECT.IME_COMPOSING);
    expect(b.reason).toBe(SHORTCUT_REJECT.IME_COMPOSING);
  });

  it('event state is checked before the context guards', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, repeat: true }), ctx({
      modalOpen: true, editableContext: true,
    }));
    expect(r.reason).toBe(SHORTCUT_REJECT.KEY_REPEAT);
  });

  it('…but after the chord check, so a Shift’d repeat is still just "not our chord"', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'I', ctrlKey: true, shiftKey: true, repeat: true }), ctx());
    expect(r.reason).toBe(SHORTCUT_REJECT.NO_SHORTCUT);
  });
});

describe('shouldHandleSelectionShortcut — canProcess (108.md §1 condition 5)', () => {
  it('canProcess:false ⇒ NOT handled, so the caller never calls preventDefault', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess: false }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.NOT_PERMITTED);
    expect(r.list).toBeNull();
    expect(r.phrase).toBe('');
  });

  it('a predicate is supported and is what decides', () => {
    const no = shouldHandleSelectionShortcut(ev({ key: 'e', metaKey: true }), ctx({ canProcess: () => false }));
    expect(no.reason).toBe(SHORTCUT_REJECT.NOT_PERMITTED);
    const yes = shouldHandleSelectionShortcut(ev({ key: 'e', metaKey: true }), ctx({ canProcess: () => true }));
    expect(yes.handled).toBe(true);
    expect(yes.list).toBe('exclude');
  });

  it('canProcess:true and an absent canProcess both behave exactly as before', () => {
    const explicit = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess: true }));
    const absent = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx());
    expect(explicit).toEqual(absent);
    expect(absent).toEqual({ handled: true, list: 'include', phrase: 'drug-resistant epilepsy', reason: 'ok' });
    // Explicit null/undefined are "not wired", not "denied".
    expect(shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess: null })).handled).toBe(true);
    expect(shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess: undefined })).handled).toBe(true);
  });

  it('a throwing predicate fails CLOSED (browser keeps its default)', () => {
    const r = shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({
      canProcess: () => { throw new Error('boom'); },
    }));
    expect(r.handled).toBe(false);
    expect(r.reason).toBe(SHORTCUT_REJECT.NOT_PERMITTED);
  });

  it('is evaluated LAST — cheaper rejections keep their own reason codes', () => {
    const cases = [
      [ctx({ canProcess: false, modalOpen: true }), SHORTCUT_REJECT.MODAL_OPEN],
      [ctx({ canProcess: false, editableContext: true }), SHORTCUT_REJECT.EDITABLE_CONTEXT],
      [ctx({ canProcess: false, selectionInsideAbstract: false }), SHORTCUT_REJECT.OUTSIDE_ABSTRACT],
      [ctx({ canProcess: false, selectedText: '   ' }), SHORTCUT_REJECT.EMPTY_SELECTION],
    ];
    for (const [c, reason] of cases) {
      expect(shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), c).reason).toBe(reason);
    }
  });

  it('the predicate is not even consulted when an earlier guard rejects', () => {
    let calls = 0;
    const canProcess = () => { calls += 1; return true; };
    shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess, modalOpen: true }));
    shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, repeat: true }), ctx({ canProcess }));
    shouldHandleSelectionShortcut(ev({ key: 'x', ctrlKey: true }), ctx({ canProcess }));
    expect(calls).toBe(0);
    shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess }));
    expect(calls).toBe(1);
  });

  it('every reject path yields the same inert shape (nothing to act on)', () => {
    const rejects = [
      shouldHandleSelectionShortcut(ev({ key: 'I', ctrlKey: true, shiftKey: true }), ctx()),
      shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, repeat: true }), ctx()),
      shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, defaultPrevented: true }), ctx()),
      shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true, isComposing: true }), ctx()),
      shouldHandleSelectionShortcut(ev({ key: 'i', ctrlKey: true }), ctx({ canProcess: false })),
    ];
    for (const r of rejects) {
      expect(r.handled).toBe(false);
      expect(r.list).toBeNull();
      expect(r.phrase).toBe('');
      expect(typeof r.reason).toBe('string');
    }
  });
});
