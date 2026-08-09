/**
 * editableTarget.test.js — 108.md §7 / §23. The ONE editable-surface predicate.
 * Also pins the no-drift contract: searchBuilder/undoStack.js re-exports this
 * implementation, so the 97.md shouldHandleGlobalUndo behaviour is preserved
 * exactly (tests/unit/searchUndoStack.test.js asserts the same matrix through the
 * old import path).
 */
import { describe, it, expect } from 'vitest';
import {
  isEditableTarget, shouldHandleGlobalUndo, EDITABLE_TAGS, EDITABLE_ROLES,
} from '../../../src/research-engine/interaction/editableTarget.js';
import { shouldHandleGlobalUndo as viaUndoStack } from '../../../src/research-engine/searchBuilder/undoStack.js';

describe('isEditableTarget — typing surfaces', () => {
  it('form controls are editable, case-insensitively', () => {
    for (const tag of EDITABLE_TAGS) {
      expect(isEditableTarget({ tagName: tag })).toBe(true);
      expect(isEditableTarget({ tagName: tag.toLowerCase() })).toBe(true);
    }
  });

  it('contentEditable regions are editable', () => {
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'SECTION', isContentEditable: true })).toBe(true);
    // Only the literal `true` counts — a truthy string from a stale attribute read
    // must not silently disable every shortcut on the page.
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: 'true' })).toBe(false);
  });

  it('ARIA text widgets are editable — the manuscript editor case', () => {
    for (const role of EDITABLE_ROLES) {
      expect(isEditableTarget({ tagName: 'DIV', role })).toBe(true);
      expect(isEditableTarget({ tagName: 'DIV', role: role.toUpperCase() })).toBe(true);
    }
    // RichSectionEditor renders exactly this: a contentEditable div with
    // role="textbox" aria-multiline. Ctrl+Z there belongs to the browser (§7).
    expect(isEditableTarget({ tagName: 'DIV', role: 'textbox', isContentEditable: true })).toBe(true);
  });
});

describe('isEditableTarget — non-typing surfaces', () => {
  it('chips, buttons, rows and the page body are not editable', () => {
    expect(isEditableTarget({ tagName: 'BODY' })).toBe(false);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget({ tagName: 'SPAN' })).toBe(false);
    expect(isEditableTarget({ tagName: 'DIV', role: 'listitem' })).toBe(false);
    expect(isEditableTarget({ tagName: 'DIV', role: 'menuitem' })).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUTX' })).toBe(false);
  });

  it('is null-safe and window-safe', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget({})).toBe(false);
    expect(isEditableTarget('INPUT')).toBe(false);   // a string is not a target
    expect(isEditableTarget(123)).toBe(false);
    // `window` as e.target (keydown with nothing focused in some engines).
    expect(isEditableTarget({ document: {}, location: {} })).toBe(false);
  });
});

describe('shouldHandleGlobalUndo — the 97.md name, one implementation', () => {
  it('is the exact inverse of isEditableTarget', () => {
    const targets = [
      null, undefined, {}, { tagName: 'BODY' }, { tagName: 'BUTTON' },
      { tagName: 'INPUT' }, { tagName: 'textarea' }, { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'DIV', role: 'textbox' }, { tagName: 'DIV', role: 'searchbox' },
      { tagName: 'DIV', role: 'combobox' }, { tagName: 'DIV', role: 'listitem' },
    ];
    for (const t of targets) {
      expect(shouldHandleGlobalUndo(t)).toBe(!isEditableTarget(t));
    }
  });

  it('undoStack.js re-exports THIS function (no second copy can drift)', () => {
    expect(viaUndoStack).toBe(shouldHandleGlobalUndo);
  });
});
