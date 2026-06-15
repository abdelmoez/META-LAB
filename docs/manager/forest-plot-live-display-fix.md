# Forest Plot — Live Display Fix (prompt19 Task 10)

[FROM: QA, Ops & Visualization Engineer (Lead)] [TO: Team] [TOPIC: Theme-aware, responsive live forest plot without degrading exports]

## The problem
`ForestPlot` (`meta-lab-3-patched.jsx` ~L1260) was a SINGLE component serving two masters:
1. the **live** on-screen plot in `ForestTab`, and
2. the **"Dark (screen)" PNG export**, which serializes the live SVG by id (`liveSvgToString("forestplot-svg")`).

Because the export needed an absolute-dark artifact, the component hardcoded dark hex (`#eaecf6` text, `#0e1420` background) and a **fixed pixel width** (`W≈620`) inside `overflowX:auto`. Result: the live embed was always dark (even in day mode), narrower than the surrounding layout, and looked cramped/overlapping. The separate white **"Light (publication)"** export was always fine.

## The fix
Split live vs. export by RENDER, not by rewriting the export:

1. `ForestPlot` gains `live` + `theme` props.
   - `live && theme==='day'` → light palette (`#0f172a` text on `#ffffff`), light grid/border.
   - `live` (night) → existing dark palette.
   - `live` SVG: `width="100%"` + `viewBox` + `preserveAspectRatio="xMidYMid meet"` + `height:auto` + `maxWidth: W*1.5` → scales to the container width, proportional (no text overlap — the internal column layout is unchanged, just scaled), capped so it never gets absurd on ultrawide screens.
   - `!live` (export source) → unchanged: absolute dark hex, fixed `W×H`, no theme.
2. `ForestTab` (`useTheme()`):
   - renders the visible themed responsive plot as `svg#forestplot-live`, and
   - keeps a **hidden** `svg#forestplot-svg` (the original dark render) in an off-screen `div` purely as the "Dark (screen)" export source.

## Why exports are safe
- "Dark (screen)" PNG still serializes `svg#forestplot-svg` — which is the untouched dark, fixed-size render. Bytes-identical to before.
- "Light (publication)" figure is a separate builder — never touched.
- Decimal precision (`prec`) is passed to both renders unchanged.

## QA (manual)
1. Day theme → live plot is light (white bg, dark text). ✓
2. Night theme → live plot is dark. ✓
3. Live plot fills the column width and scales responsively. ✓
4. No text overlap (layout scaled proportionally). ✓
5. Long study names + many studies render cleanly. ✓
6. "Dark (screen)" export still downloads the dark figure. ✓
7. "Light (publication)" export unchanged. ✓
8. Build green. ✓

## Files
- `meta-lab-3-patched.jsx`: `ForestPlot` (live/theme palette + responsive svg), `ForestTab` (themed live + hidden dark export source), `useTheme` import.
