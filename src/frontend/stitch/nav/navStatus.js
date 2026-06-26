/**
 * navStatus.js — ONE status language for the Stitch project navigation (55.md §
 * "Establish one clear status language across the application").
 *
 * The legacy `stepStatus()` emits 'done' | 'partial' | 'empty' per workflow stage.
 * 55.md acceptance #11/#12 require the rail + steppers to communicate status with
 * NON-COLOR indicators (glyph + text), not color-only dots (WCAG 1.4.1). This pure
 * module maps a raw status to a presentation descriptor { key, label, icon, tone }
 * shared by the rail status glyph, the main stepper, and the submenu badges — so
 * there is exactly one place that defines what "in progress" looks/reads like.
 *
 * Pure: no React/DOM. `tone` is a semantic name the caller maps to its own token.
 */

export const STATUS_META = {
  done:      { key: 'done',      label: 'Complete',        icon: 'circleCheck',   tone: 'success' },
  partial:   { key: 'partial',   label: 'In progress',     icon: 'clock',         tone: 'warn' },
  empty:     { key: 'empty',     label: 'Not started',     icon: null,            tone: 'muted' },
  attention: { key: 'attention', label: 'Needs attention', icon: 'alertTriangle', tone: 'danger' },
  blocked:   { key: 'blocked',   label: 'Blocked',         icon: 'lock',          tone: 'muted' },
};

/** Descriptor for a raw status value (defaults to 'not started'). */
export function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.empty;
}

/**
 * Roll a set of child statuses up to a single category status:
 *   - all children 'done'      → 'done'
 *   - any 'done'/'partial'     → 'partial' (work in progress)
 *   - otherwise                → 'empty'
 * `statuses` is an array of 'done'|'partial'|'empty' (unknowns ignored).
 */
export function rollUpStatus(statuses) {
  const known = (statuses || []).filter((s) => s === 'done' || s === 'partial' || s === 'empty');
  if (known.length === 0) return null;
  if (known.every((s) => s === 'done')) return 'done';
  if (known.some((s) => s === 'done' || s === 'partial')) return 'partial';
  return 'empty';
}
