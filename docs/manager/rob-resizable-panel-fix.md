# RoB Resizable Panel Fix — prompt41 Task 4

## Problem
In the RoB split layout the user could make the assessment panel **larger** but not
**smaller** (the PDF could not grow past ~72%).

## Root cause
The clamp in `RobWorkspace.jsx` was `SPLIT_MIN_PDF = 0.45`, `SPLIT_MAX_PDF = 0.72`.
`clampSplit()` (applied on drag + keyboard nudge) capped the PDF fraction at 72%, so
the assessment could only shrink to ~28% — and the user wanted it smaller (PDF
bigger). The grid itself uses `minmax(0, 1fr)` for the assessment column, so nothing
structural blocked shrinking — only the clamp did.

## Fix
Widen the bounds to **0.20–0.82** (default unchanged at 0.70):
- `SPLIT_MIN_PDF = 0.20` → assessment can GROW to 80% (PDF down to 20%).
- `SPLIT_MAX_PDF = 0.82` → assessment can SHRINK to ~18% (PDF up to 82%).
Both directions now work; neither pane becomes unusable. The divider is draggable
both ways, keyboard-nudgeable (←/→), double-click resets to 70/30, the ratio persists
in `localStorage` (`metalab.rob.splitRatio`) across refresh, and the smooth
rAF/CSS-variable drag (no per-frame React render) is unchanged. The `aria-valuemin/max`
on the separator now report 20/82.

## Tests
`tests/unit/rob-workspace-ui.test.jsx` updated: `clampSplit(0.95) → 0.82`,
`clampSplit(0.10) → 0.20`, and the separator exposes `aria-valuemin="20"` /
`aria-valuemax="82"`.
