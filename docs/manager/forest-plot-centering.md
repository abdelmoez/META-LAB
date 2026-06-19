# Forest Plot Centering — prompt39 Task 4

## Problem
The forest plot graph was left-aligned in its container instead of centered.

## Root cause
The live plot SVG (inside `ForestPlot`, `meta-lab-3-patched.jsx`) is a **block**
element styled `width:100%` with `maxWidth: round(W*1.5)` (its natural width ×1.5).
On a container wider than that cap, the block stops at `maxWidth` but — with no
horizontal margin — stays pinned to the **left** edge. (`preserveAspectRatio
="xMidYMid meet"` only centers content *within* the SVG box, not the capped box
within its wider container.)

## Fix
Add `margin: "0 auto"` to the **live** SVG's style:
```jsx
...(live ? { width:"100%", height:"auto", maxWidth: Math.round(W*1.5),
            margin:"0 auto", border:`1px solid …` } : {})
```
A capped-width block with `margin-inline auto` centers horizontally. This is a proper
wrapper/centering fix (no hack), and it stays:
- **Responsive** — on narrow containers `width:100%` shrinks to fit (no overflow);
  on wide containers it caps and centers.
- **Theme-safe** — the day/night branch (`dayLive`) and colors are untouched.
- **Export-safe** — the change is gated to `live` only; the hidden export render
  (`live=false`, `svgId="forestplot-svg"`) and its serialization are unaffected, so
  PNG/SVG exports and decimal precision are unchanged.

## QA
Open Forest Plot → graph is horizontally centered → resize the window → stays
centered and responsive → export still produces the correct artifact → axis /
"favours" labels unaffected.
