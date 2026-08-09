/**
 * shortcuts/domTarget.js — the DOM half of the canonical editable-surface check.
 *
 * `research-engine/interaction/editableTarget.js` is deliberately DOM-free: it reads
 * `tagName`, `isContentEditable` and `role` off whatever it is handed. That is what
 * makes it unit-testable, but it means the ROLE it reads is the reflected
 * `Element.role` property — ARIA reflection, which only shipped in Chrome/Edge 119,
 * Safari 17 and Firefox 119. On anything older `el.role` is `undefined` and a
 * `<div role="textbox">` — the manuscript editor — would stop looking editable, so
 * Ctrl+Z would be stolen from native text undo (108.md §7).
 *
 * The outgoing SearchBuilderTab listener read the role with `getAttribute('role')`
 * and this module preserves that EXACTLY, so migrating that listener into the
 * router is behaviour-preserving rather than merely similar. `Element.role` is
 * still preferred when present (it also reflects a role set imperatively).
 *
 * Pure and null-safe; takes an event target, not a document.
 */
import { isEditableTarget } from '../../research-engine/interaction/editableTarget.js';

/** The target's ARIA role, from the reflected property or the attribute. */
export function readTargetRole(target) {
  const t = target && typeof target === 'object' ? target : null;
  if (!t) return null;
  const reflected = t.role;
  if (typeof reflected === 'string' && reflected) return reflected;
  if (typeof t.getAttribute !== 'function') return null;
  try {
    return t.getAttribute('role');
  } catch {
    return null;                        // detached node / cross-origin proxy
  }
}

/**
 * isEditableDomTarget(target) → boolean. The predicate the ShortcutProvider is
 * mounted with; delegates every rule to the canonical module.
 */
export function isEditableDomTarget(target) {
  const t = target && typeof target === 'object' ? target : null;
  if (!t) return false;
  return isEditableTarget({
    tagName: t.tagName,
    isContentEditable: !!t.isContentEditable,
    role: readTargetRole(t),
  });
}

export default { readTargetRole, isEditableDomTarget };
