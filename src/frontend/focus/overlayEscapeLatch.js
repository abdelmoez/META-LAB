/**
 * overlayEscapeLatch.js — 117.md §44, the one fact that keeps the new Escape
 * contract from eating dialogs.
 *
 * 117.md §44 reverses 114-r2 §2: when OUR browser fullscreen ends without us
 * asking, PecanRev now returns to the normal application layout instead of
 * degrading to focused-but-windowed. That is the right default — the researcher
 * pressed Escape, the browser left fullscreen, and a chrome-less window that
 * still hides the navigation is exactly the "inconsistent state" the prompt
 * complains about.
 *
 * It is the WRONG answer for one case, and only one: an Escape aimed at an app
 * overlay. Escape inside fullscreen is not interceptable — the browser exits no
 * matter what the page does with the event — so closing a modal or the focus nav
 * drawer produces a fullscreenchange indistinguishable from a deliberate exit.
 * Ejecting the whole workspace because a dialog was dismissed is a worse bug
 * than the one §44 fixes.
 *
 * So the overlays that CONSUME an Escape leave a mark here, and the provider
 * reads it when the exit arrives: marked recently ⇒ keep the 114-r2 degrade
 * (windowed focus, layout intact); otherwise ⇒ leave Focus Mode entirely.
 *
 * WHY A MODULE-LEVEL MARKER AND NOT REACT STATE. The consumer (the focus
 * provider's fullscreenchange listener) and the producers (`useFocusTrap` in the
 * Stitch primitives, the focus nav drawer in the shell) live in unrelated trees
 * and communicate through a browser event that carries no payload. A ref or a
 * context value cannot cross that gap; a timestamp in a module can. This is the
 * same reasoning modalSignal.js uses for its DOM attribute, one level smaller.
 *
 * `now` is injectable on both calls so the window is testable without timers —
 * this repo runs no jsdom and no fake clock in the unit suite.
 */

/**
 * How long an overlay's Escape keeps ownership of the fullscreen exit it caused.
 *
 * Long enough to cover the gap between the keydown and the fullscreenchange the
 * browser queues after it (a task or two — microseconds in practice, but the
 * event loop can be busy); short enough that a LATER, unrelated Escape is never
 * mistaken for the same press. Half a second is far beyond any plausible
 * dispatch delay and far below any plausible second press.
 */
export const OVERLAY_ESCAPE_GRACE_MS = 500;

let lastEscapeAt = 0;

const stamp = (now) => (typeof now === 'number' && Number.isFinite(now) ? now : Date.now());

/** An overlay just consumed an Escape. Called from the overlay's own handler. */
export function markOverlayEscape(now) {
  lastEscapeAt = stamp(now);
  return lastEscapeAt;
}

/**
 * Did an overlay consume an Escape within the grace window?
 *
 * A clock that moved backwards (system time change) reads as "not recent" rather
 * than as a permanent latch — the fail-safe direction is the §44 default.
 */
export function overlayEscapeRecent(now) {
  if (!lastEscapeAt) return false;
  const delta = stamp(now) - lastEscapeAt;
  return delta >= 0 && delta <= OVERLAY_ESCAPE_GRACE_MS;
}

/** Drop the mark. Used by tests, and after the exit it was meant to explain. */
export function clearOverlayEscape() {
  lastEscapeAt = 0;
}

export default { OVERLAY_ESCAPE_GRACE_MS, markOverlayEscape, overlayEscapeRecent, clearOverlayEscape };
