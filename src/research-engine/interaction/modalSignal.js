/**
 * modalSignal.js — 108.md §24 tier 1. The ONE answer to "is a dialog on screen?"
 * that the shortcut router's context is built from.
 *
 * WHY A DOM ATTRIBUTE AND NOT A REGISTRY OBJECT. React state cannot answer "is ANY
 * modal open?" from an unrelated window listener, and PecanRev's dialogs live in
 * three unconnected trees (the screening design system, the Stitch primitives, and
 * portals mounted straight onto document.body). 107.md already solved this for
 * screening with a stamped attribute + `document.querySelector`; 108.md widens it
 * by stamping the SAME pattern from the Stitch focus trap, so one selector sees
 * both families.
 *
 * WHY THE SCREENING ATTRIBUTE IS RE-DECLARED HERE. `SCREENING_MODAL_ATTR` is
 * exported by `frontend/screening/ui/components.jsx` — a design-system module that
 * must not be imported into the Stitch shell (or vice versa: the two design systems
 * deliberately do not cross). This module is the neutral ground: research-engine,
 * no tokens, no JSX. The string is pinned against the screening export by
 * tests/unit/interaction/modalSignal.test.js so the two can never drift.
 *
 * COVERAGE, HONESTLY. Stamped today: every screening `Modal` and every Stitch
 * `StitchModal`/`StitchDrawer` (both go through `useFocusTrap`). NOT stamped:
 * `components/Modal.jsx` (legacy generic), `ProjectLanding`'s card menu,
 * `RobWorkspace`'s OverrideModal, the admin drawers. Those remain invisible to the
 * router this round — a documented limitation, not an oversight: each needs its own
 * one-line stamp, and none of them coexists with a history-bearing engine.
 */

/** 107.md §3 — stamped by frontend/screening/ui/components.jsx `Modal`. */
export const SCREENING_MODAL_ATTR = 'data-screening-modal';

/** 108.md §24 — stamped by the Stitch `useFocusTrap` (StitchModal + StitchDrawer). */
export const STITCH_MODAL_ATTR = 'data-stitch-modal';

/** Every attribute that means "a dialog owns the keyboard". */
export const MODAL_ATTRS = Object.freeze([SCREENING_MODAL_ATTR, STITCH_MODAL_ATTR]);

/** One selector for all of them. */
export const MODAL_SELECTOR = MODAL_ATTRS.map((a) => `[${a}]`).join(',');

/**
 * isAnyModalOpen(doc?) → boolean. `doc` is injectable so the predicate is testable
 * without a DOM; it defaults to the ambient document and is SSR-safe (false).
 */
export function isAnyModalOpen(doc) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!d || typeof d.querySelector !== 'function') return false;
  try {
    return !!d.querySelector(MODAL_SELECTOR);
  } catch {
    return false;                       // a hostile/partial document never eats keys
  }
}

export default {
  SCREENING_MODAL_ATTR, STITCH_MODAL_ATTR, MODAL_ATTRS, MODAL_SELECTOR, isAnyModalOpen,
};
