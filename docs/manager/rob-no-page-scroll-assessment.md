# RoB assessment — no page-level scroll (prompt42 Task 7)

**Goal:** the open Risk-of-Bias assessment workspace fits in one focused display area — only the PDF
panel and the assessment panel scroll **internally**; the page itself never scrolls to reach buttons.

## Root cause

`RobWorkspace` already had a sound internal model (`useFillViewportHeight` + two `overflow-y:auto`
panels + a sticky `WorkspaceFooter`). The leak was in the **embedding shell**, not the workspace:

- Monolith `meta-lab-3-patched.jsx`, the body container (≈L8960) used
  `overflowY: inScreening ? 'hidden' : 'auto'` + `padding: '28px … 56px'` for every non-screening tab.
  For the RoB tab that meant the page itself scrolled, and the 28/56px padding pushed the
  fill-height-measured workspace past the viewport.

## Fix

1. **Lifted workspace state.** `RoBTab` already tracked `inWorkspace` (to hide its intro header); it now
   also forwards it via a new `onWorkspaceChange` prop. The monolith holds `robInWorkspace` and computes
   `robFullbleed = tab==='rob' && robInWorkspace` and `noPageScroll = inScreening || robFullbleed`.
2. **Body container** uses `overflowY: noPageScroll ? 'hidden' : 'auto'` and `padding: 0` when
   full-bleed — exactly the Screening recipe. The RoB **overview list** (workspace closed) keeps its
   normal padding + page scroll.
3. **Bounded-height flex chain** so the workspace fills cleanly: the `tab-content` wrapper and the
   `RoBTab` wrapper become `height:100%; display:flex; flex-direction:column; min-height:0` while the
   workspace is open.
4. **Accurate fill height.** The shell removes its padding one render *after* the workspace mounts, which
   shifts `rect.top`. `useFillViewportHeight` now re-measures on the next animation frames + short
   timeouts (not only on window resize), so there's no stale-height gap. The `overflow:hidden` parent is
   a hard guarantee against page scroll regardless.
5. **Standalone route too.** `RobPage.jsx`'s `Frame` becomes a `100vh` flex column (fixed header +
   `flex:1; min-height:0` content) and goes `overflow:hidden` when its `ProjectRobPanel` reports an open
   workspace (`onWorkspaceChange`). The picker / not-enabled states still scroll normally.

## Interactions preserved

- **Resizable split** (`useResizableSplit`) operates on width %, orthogonal to height — unaffected.
- **Menu collapse/expand** only changes horizontal margin — height (and the no-scroll guarantee) is
  unaffected.
- **Continuous PDF viewer** scrolls inside the PDF panel (flush mode, `height:100%`).
- **Narrow / stacked (<900px)** layout intentionally keeps page scroll (so a stacked PDF + assessment
  stays reachable) — the no-scroll guarantee is a desktop/laptop guarantee by design.

## QA covered

Open RoB assessment on a laptop → body doesn't scroll · PDF panel scrolls internally · assessment panel
scrolls internally · Finalise/Continue footer always visible · resize panels → still no page scroll ·
collapse the menu → still no page scroll.
