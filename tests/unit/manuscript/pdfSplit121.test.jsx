/**
 * 121.md §2 — "Correct the PDF Viewer and Split-View Experience".
 *
 * pdfSplit119.test.jsx keeps pinning the 119 §4 contract that still stands (the
 * separator's ARIA and keyboard surface, the flush-before-layout rule, the keep-alive
 * pool, the no-remount tree). This file adds ONLY what 121 §2 changes:
 *
 *   A. opening the PDF viewer no longer takes the screen — the Focus LAYOUT is kept
 *      (dropping it would push a 1440px laptop under SPLIT_STACK_BELOW and degrade the
 *      split to one stacked pane, a 119 §4 regression), the fullscreen REQUEST is not;
 *   B. the pane fills its region because its height is now MEASURED, not guessed —
 *      `calc(100vh - 150px)` matched no chrome configuration this app has;
 *   C. the divider says out loud that it can be dragged.
 *
 * House style: SSR markup for what renders, pure source pins for the structural
 * guarantees no rendered assertion can reach.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readSource } from '../../helpers/readSource.js';
import { SplitResizeDivider } from '../../../src/features/manuscript/PdfSplitPane.jsx';
import { SPLIT_MIN, SPLIT_MAX, SPLIT_STACK_BELOW } from '../../../src/features/manuscript/manuscriptSplit.js';

const split = {
  ratio: 0.5, dragging: false,
  onPointerDown: () => {}, reset: () => {}, nudge: () => {}, setPreset: () => {},
};

const ws = readSource('src/features/manuscript/ManuscriptWorkspace.jsx');
const pane = readSource('src/features/manuscript/PdfSplitPane.jsx');
const host = readSource('src/frontend/stitch/pages/StitchProjectWorkspace.jsx');

/* ══════════ A — no auto-fullscreen, and the layout entry stays ══════════ */

describe('121.md §2A — opening the PDF viewer must not automatically enter fullscreen', () => {
  it('the split asks Focus Mode for its LAYOUT only', () => {
    expect(ws).toContain('api.setFocus(true, { fullscreen: false });');
    // Nothing here requests the Fullscreen API, directly or through the bridge.
    expect(ws).not.toContain('requestFullscreen');
    expect(ws).not.toContain('enterFullscreen');
  });

  it('…but does NOT drop the Focus layout, which the split still depends on', () => {
    /* Without the rails hidden, a 1440px laptop's row measures well under
       SPLIT_STACK_BELOW and the two-column split degrades to one stacked pane —
       exactly the 119 §4 behaviour scenario 9 pins. The layout entry is the feature;
       only the fullscreen request was the bug. */
    expect(SPLIT_STACK_BELOW).toBe(1024);
    expect(ws).toContain('useFocusMode');
    expect(ws).toContain('focusOwned');
    expect(ws).toMatch(/} else if \(focusOwned\.current\) \{/);
  });

  it('r2 — ownership cannot survive a Focus exit the split did not perform', () => {
    /* `focusOwned` was raised on the open transition and lowered only by the split's
       own close branch. A researcher who left Focus Mode themselves and later re-
       entered it DELIBERATELY (that time with real fullscreen, which the gesture
       grants) was still recorded as "the split turned this on", so closing the pane —
       or leaving the stage with it open — dropped them out of the fullscreen they had
       just chosen. Focus being OFF while the pane is open is proof the split no longer
       owns it. */
    expect(ws).toContain('if (splitOpen && !focus.focus) focusOwned.current = false;');
    /* …and it is declared BEFORE the open/close effect, because effects run in
       declaration order: the open transition must still be able to CLAIM ownership in
       the same commit in which this one observes the pre-open, focus-off state. */
    expect(ws.indexOf('if (splitOpen && !focus.focus) focusOwned.current = false;'))
      .toBeLessThan(ws.indexOf('api.setFocus(true, { fullscreen: false });'));
  });

  it('the LEGACY shell no longer flips global focus state it cannot render', () => {
    /* FocusModeProvider wraps every route, so `setFocus` in a shell with no
       FocusSurface really did change global state (and request fullscreen) while the
       legacy chrome stayed fully visible. The stale comment that believed otherwise
       is gone with it. */
    expect(ws).toContain('const focusAvailable = useFocusAvailable();');
    expect(ws).toContain('if (focusAvailableRef.current && !api.focus && api.setFocus) {');
    // …and the stale comment that believed otherwise is corrected, not left lying.
    expect(ws).not.toContain('what the legacy shell and the SSR contract tests get');
  });
});

/* ══════════ B — the fill ══════════ */

describe('121.md §2B — the pane fills its region because the height is measured', () => {
  it('the 100vh guess is gone from the bounded layout', () => {
    /* 150px matched neither the normal chrome (57 header + 24 main pad + 20 card pad
       + the sticky toolbar) nor the focused one (40 focus bar + 16 + 20 + 4 +
       toolbar), so in fullscreen the pane left a dead strip below itself and could
       not react to any resize trigger — nothing measured the real available height. */
    expect(pane).toContain('...(bounded ? {');
    expect(pane).toContain("position: 'static', alignSelf: 'stretch', height: '100%', minHeight: 0,");
    // The old block is KEPT for the layouts that still page-scroll (the stacked
    // narrow layout, and any host with no full-bleed seam) — it is not a guess there,
    // it is the 119 §4 behaviour, unchanged.
    expect(pane).toContain("height: height || 'calc(100vh - 150px)',");
  });

  it('the workspace becomes a bounded COLUMN, so flex does the arithmetic', () => {
    expect(ws).toContain('const SPLIT_SHELL_BOUNDED = {');
    expect(ws).toContain("flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',");
    // the row takes what is left …
    expect(ws).toContain("flex: '1 1 0%', minHeight: 0,");
    expect(ws).toContain("gridTemplateRows: 'minmax(0, 1fr)',");
    expect(ws).toContain("alignItems: 'stretch',");
    // … the editor half becomes its own scroller …
    expect(ws).toContain("...(splitFills ? { height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' } : null),");
    // … and the pane is simply 100% of it.
    expect(ws).toContain('bounded={splitFills}');
  });

  it('the frame is removed through the app’s OWN full-bleed seam, keyed on the STATE', () => {
    /* The 1560 shell cap, the rounded card's 20px frame + border and the content
       padding all come off in one move — the same seam an open RoB assessment and an
       open Extraction article already use. Keyed on (stage === 'manuscript' && the
       pane state), never on the stage, so Overview / Tables / References / PRISMA keep
       their reading column. */
    expect(ws).toContain("const splitFills = splitOpen && splitLayout === 'split' && typeof onWorkspaceChange === 'function';");
    expect(ws).toContain('onWorkspaceChange(splitFills);');
    expect(ws).toContain('return () => onWorkspaceChange(false);');
    expect(host).toContain("(stage === 'manuscript' && manuscriptInWorkspace)");
    expect(host).toContain('onWorkspaceChange={setManuscriptInWorkspace}');
    // …and the host derives the height from REAL chrome, which is what makes the
    // bounded column honest (57px utility header, or the 40px focus bar).
    expect(host).toContain('const topChromeH = focusMode ? FOCUS_BAR_H : 57;');
    expect(host).toContain('height: `calc(100vh - ${topChromeH}px)`');
  });

  it('a host WITHOUT the seam keeps the layout it has always had', () => {
    // The legacy shell passes no `onWorkspaceChange`, so it never gets a bounded
    // column it has no bounded height for — `splitFills` is false by construction.
    expect(ws).toContain("typeof onWorkspaceChange === 'function'");
    expect(ws).toContain('style={splitFills ? SPLIT_SHELL_BOUNDED : splitOpen ? SPLIT_SHELL_STYLE : SHELL_STYLE}');
  });

  it('the keep-alive pool is untouched — hidden viewers keep a real box', () => {
    /* 120.md §8 Journey I: page, zoom, rotation, search and scroll survive because
       the pooled viewers are hidden with `visibility`, never `display`, and the pane
       is hidden rather than unmounted. A height fix may not trade that away. */
    expect(pane).toContain("visibility: 'hidden', pointerEvents: 'none',");
    expect(pane).toContain("position: 'relative', flex: 1, minHeight: 0, display: 'flex'");
    expect(ws).toContain('{splitMounted && (');
  });
});

/* ══════════ C — the divider ══════════ */

describe('121.md §2C — a divider that says it can be dragged', () => {
  const html = renderToStaticMarkup(<SplitResizeDivider split={split} />);

  it('keeps the ENTIRE 119 §4 accessible-separator contract, byte for byte', () => {
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-testid="stitch-manuscript-split-divider"');
    expect(html).toContain('aria-label="Resize the manuscript and PDF panes"');
    expect(html).toContain(`aria-valuemin="${Math.round(SPLIT_MIN * 100)}"`);
    expect(html).toContain(`aria-valuemax="${Math.round(SPLIT_MAX * 100)}"`);
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuetext="Manuscript 50%, PDF 50%"');
    expect(pane).toContain("e.key === 'ArrowLeft'");
    expect(pane).toContain("e.key === 'ArrowRight'");
    expect(pane).toContain("e.key === 'Home'");
    expect(pane).toContain('onDoubleClick={split.reset}');
  });

  it('§2 — a visible separator LINE and a central grip carrying the two-direction cue', () => {
    expect(html).toContain('data-testid="stitch-manuscript-split-divider-line"');
    expect(html).toContain('data-testid="stitch-manuscript-split-divider-grip"');
    expect(html).toContain('‹›');
    // Decoration, not content: a screen reader already has aria-valuetext.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('cursor:col-resize');
  });

  it('§2 — the tooltip is the DESIGNED one, with the copy the prompt names', () => {
    /* A native `title` cannot be styled, never appears on keyboard focus, and is
       clipped nowhere but is also announced nowhere useful. The shared Tooltip (the
       one ManuscriptToolbar uses — NOT a Stitch-only primitive, because this file
       renders in both shells) shows on hover AND focus and portals out of the row. */
    expect(pane).toContain('<Tooltip content="Drag to resize editor and PDF"');
    expect(pane).toContain("import Tooltip from '../../frontend/components/Tooltip.jsx';");
    expect(html).not.toContain('title="Drag to resize panes');
  });

  it('r2 — …and the bubble is DISMISSED when the drag starts, not merely blocked', () => {
    /* `disabled` gated `show()` only, so the hover that precedes every drag left an
       open bubble on screen: pointer capture defers the mouseleave that would hide it
       until the drag ends, and "a bubble that follows the pointer through the whole
       drag is noise, not help" was the stated intent, unachieved. The divider's
       declaration is right; the primitive now honours it the moment it is made. */
    expect(pane).toContain('disabled={split.dragging}');
    const tip = readSource('src/frontend/components/Tooltip.jsx');
    expect(tip).toContain('useEffect(() => { if (disabled) hide(); }, [disabled, hide]);');
  });

  it('§2 — prefers-reduced-motion is finally WIRED, not just declared', () => {
    // The `reduced` prop has existed since 119 §4 and nothing ever passed it.
    expect(ws).toContain('<SplitResizeDivider split={split} reduced={reducedMotion} />');
    expect(ws).toContain('const reducedMotion = useReducedMotion();');
    const calm = renderToStaticMarkup(<SplitResizeDivider split={split} reduced />);
    expect(calm).toContain('transition:none');
    expect(html).toContain('transition:all 0.15s ease');
  });

  it('the drag path itself is untouched — no React render, no storage spam', () => {
    /* 119 §4's whole design: the drag writes a CSS custom property through rAF so the
       editor subtree and the mounted viewers never re-render, and ONLY pointer-up
       commits and persists. A visual redesign may not move any of it. */
    expect(pane).toContain('rafRef.current = requestAnimationFrame(() => applyVar(last));');
    expect(pane).toContain('setDragging(false);\n      commit(last);');
    expect(pane).toContain('const reset = useCallback(() => commit(SPLIT_DEFAULT), [commit]);');
    expect(pane).not.toContain('m.flush');
  });
});
