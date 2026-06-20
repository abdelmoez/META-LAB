# PDF viewer — initial fit-width sharpness fix (prompt42 Task 5)

**File:** `src/frontend/components/AppPdfViewer.jsx`

## Symptom

On first open the PDF appeared **small**, and zooming in "snapped" to fit the container but looked
**fuzzy**.

## Root cause

It was a **timing + CSS-scaling** bug, not a math bug. The old single-canvas render:

1. Could fire its first paint while the container width (`wrapW`) was still stale/too small (measured
   before layout settled in a flex/just-mounted container), producing a low-resolution first frame; and
2. The canvas carried `maxWidth: 100%`, so once the container settled, that first low-res canvas was
   **CSS-stretched** to fill — i.e. upscaled bitmap = fuzzy. Zooming forced a fresh (correct-scale)
   render, which is why zooming "fixed" it.

## Fix

- **Skeleton until the width is really known:** the page column renders only once `wrapW > 0` (a
  spinner shows until then), so the first canvas is never painted at a tiny/zero width.
- **Correct HiDPI render per page:** backing store at `viewport(scale) × devicePixelRatio` (DPR capped
  at 2 for weak machines) via pdf.js's `transform: [dpr,0,0,dpr,0,0]`, CSS size at `viewport(scale)` —
  so the bitmap always matches the device pixels. The proven prompt41 math is reused per page.
- **No CSS upscaling:** the per-page canvas fills its wrapper at the exact render size (`width/height:
  100%` of a correctly-sized wrapper); the old `maxWidth: 100%` stretch is gone.
- **Re-fit on resize:** a `ResizeObserver` on the scroll container re-measures the width (coalesced to
  one update per animation frame to avoid resize/render thrash) and every mounted page re-renders at the
  new fit scale. This makes it sharp after **RoB panel drag**, **menu collapse/expand**, and **window
  resize**.

## QA covered

Open → fits width immediately and is sharp · resize the RoB panel → re-fits sharp · collapse the left
menu → re-fits · zoom in/out → stays sharp (each zoom is a fresh full-resolution render, never a CSS
stretch).
