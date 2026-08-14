/**
 * workbenchLayout.js — 116.md §20/§126 (validation).
 *
 * The Title & Abstract workbench's column allocation, expressed ONCE as a pure
 * function so it can be unit-tested in Node (project convention: no jsdom).
 *
 * The defect this closes was measured, not theorised. The workbench is a flex row of
 * a fixed 300px record list, a `flex: 1` centre (article + abstract + PDF) with NO
 * floor, and a fixed 320px filters sidebar. Because both side columns refused to
 * shrink and the centre had no minimum, every pixel of shortfall came out of the
 * centre. At 1280×720 with the workspace rail pinned the workbench receives 752px, so
 * the centre collapsed to 132px, the embedded PDF viewer to 74px, and pdf.js
 * fit-width landed at 0.095× — a page no one can read. §20 asks for the workspace to
 * be usable at smaller laptop resolutions and zoom; §126 asks PDF interaction to feel
 * immediate. A 74px viewer defeats both.
 *
 * The rule, stated once:
 *   · the centre column gets a FLOOR, but only as much of it as the container can
 *     actually give — a floor is never allowed to overflow (and therefore clip) the
 *     row, in ANY state, including one the reviewer forced;
 *   · the record list MAY shrink between `leftWidth` and `leftMinWidth`. It is the
 *     primary navigation for screening, so it is never hidden automatically;
 *   · the filters sidebar — a secondary, *already collapsible* surface with a visible
 *     "Show Filters & keywords panel" rail button — auto-collapses to that 38px rail
 *     when the container cannot seat all three columns at a readable centre;
 *   · an EXPLICIT reviewer choice about the filters sidebar always outranks the width
 *     rule, in both directions, and is persisted;
 *   · an UNMEASURED container (server render, the frame before ResizeObserver fires)
 *     resolves to the shipped wide layout, so SSR output and the wide/default case
 *     are byte-for-byte what they were.
 */

/** Every width the workbench allocates, in CSS px (all boxes are border-box). */
export const WORKBENCH_COLUMNS = Object.freeze({
  /** Record list, at rest. */
  leftWidth: 300,
  /** Record list, squeezed. Still fits a title line + the decision indicators. */
  leftMinWidth: 240,
  /** The collapsed rail either side column degrades to (CollapsedRail). */
  railWidth: 38,
  /** Filters & keywords sidebar, at rest (it does not shrink — it collapses). */
  rightWidth: 320,
  /**
   * The centre's floor. 420px leaves the PDF panel ~362px, i.e. a pdf.js fit-width
   * scale of ~0.56× on a US-Letter page — the low end of "readable", and 6× the
   * 0.095× this defect produced.
   */
  midMinWidth: 420,
});

/** The per-user side-panel preference, as stored under `metalab.screeningUI.<uid>`. */
export const DEFAULT_PANEL_PREFS = Object.freeze({
  leftCollapsed: false, rightCollapsed: false, rightChosen: false,
});

/**
 * Parse a stored preference blob. `rightChosen` is the "the reviewer has decided about
 * the filters sidebar themselves" flag that outranks the automatic collapse. A pre-116
 * blob has no such key, so it is INFERRED: a stored `rightCollapsed: true` could only
 * have come from a deliberate collapse and stays a choice; a stored `false` is just the
 * shipped default and is not, so those users get the width rule.
 */
export function readPanelPrefs(stored) {
  if (!stored || typeof stored !== 'object') return DEFAULT_PANEL_PREFS;
  return {
    leftCollapsed: !!stored.leftCollapsed,
    rightCollapsed: !!stored.rightCollapsed,
    rightChosen: typeof stored.rightChosen === 'boolean' ? stored.rightChosen : !!stored.rightCollapsed,
  };
}

/**
 * The narrowest container that can still seat the filters sidebar without starving
 * the centre. Below this the sidebar auto-collapses to its rail.
 */
export function rightPanelMinWidth({ leftCollapsed = false } = {}) {
  const { leftMinWidth, railWidth, rightWidth, midMinWidth } = WORKBENCH_COLUMNS;
  return (leftCollapsed ? railWidth : leftMinWidth) + rightWidth + midMinWidth;
}

/**
 * resolveWorkbenchLayout({ width, leftCollapsed, rightPreference })
 *
 * @param {number}  width           measured container width in px; 0/NaN ⇒ unmeasured
 * @param {boolean} leftCollapsed   the reviewer collapsed the record list to its rail
 * @param {boolean|null} rightPreference
 *        `true`/`false` = the reviewer has explicitly closed/opened the filters
 *        sidebar and that choice wins; `null` = no explicit choice, width decides.
 * @returns {{
 *   measured: boolean,
 *   rightCollapsed: boolean,
 *   rightAutoCollapsed: boolean,
 *   leftMinWidth: number|null,
 *   midMinWidth: number|null,
 * }}  `null` on a width means "emit no such CSS property" — the shipped rigid layout.
 */
export function resolveWorkbenchLayout({ width, leftCollapsed = false, rightPreference = null } = {}) {
  const { leftMinWidth, railWidth, rightWidth, midMinWidth } = WORKBENCH_COLUMNS;

  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
  const measured = w > 0;
  const explicit = rightPreference === true || rightPreference === false;
  const autoCollapse = measured && w < rightPanelMinWidth({ leftCollapsed });
  const rightCollapsed = explicit ? rightPreference : autoCollapse;

  const leftFloor = leftCollapsed ? railWidth : leftMinWidth;
  const rightUsed = rightCollapsed ? railWidth : rightWidth;
  // The floor is clamped to what is actually left over, so it can never push the row
  // wider than its container — not even when the reviewer forces the sidebar open on
  // a narrow window. Worst case it degrades to "no floor", i.e. today's behaviour.
  const midFloor = measured ? Math.max(0, Math.min(midMinWidth, w - leftFloor - rightUsed)) : 0;

  return {
    measured,
    rightCollapsed,
    // True only when the WIDTH closed the panel, so the rail can say why.
    rightAutoCollapsed: rightCollapsed && !explicit,
    // The record list only becomes shrinkable once we know how much room there is.
    leftMinWidth: measured && !leftCollapsed ? leftMinWidth : null,
    midMinWidth: midFloor > 0 ? midFloor : null,
  };
}

export default resolveWorkbenchLayout;
