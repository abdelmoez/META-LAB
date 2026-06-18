# Forest plot export precision fix (prompt32 Task 8)

## Current state (before)
- `src/research-engine/format/precision.js` provides pure formatters (`fmtES`, `fmtCI`, `fmtNum`, `fmtPct`, `fmtI2`, `fmtWeight`) that round only at the display edge (never the stored value). Default 3 dp.
- `ExportDialog.jsx` builds `choice.precision = { decimals, trailingZeros, full }` from the user's per-export decimal selector and always passes it in `choice` (machine formats forced to `full`).
- The monolith has TWO forest renderers: `ForestPlot()` (live SVG) and `buildPubForestSVG()` (export string-SVG), plus a report path (`buildReportHTML`).

## Issue
The exported/extracted figure showed 3 decimals even when the user picked 2, due to two breaks:
1. **`choice.precision` was dropped on the floor.** The three forest export `run(choice)` callbacks (`ResearchExport`, `ForestTab`, and the report) rebuilt the figure from a render-time closure `prec = project.analysisPrecision`, ignoring the dialog selection entirely.
2. **Hardcoded formatting for non-effect fields.** Export weights used `(s._wFixedPct||0).toFixed(1)`; the I² label interpolated `${result.I2}` raw — and the live vs export het lines diverged.

## Decision
Thread the dialog-chosen precision end-to-end and route every numeric label through the precision helpers so the live plot and the export render identically. Keep internal values at full precision (display-only change). I²/weights keep their 1-dp convention and only honour `full` (do not track the effect-decimal selector — matches the metafor-comparison convention + existing `precision.test.js`).

## Implementation (`meta-lab-3-patched.jsx`)
- `ResearchExport` forest `run`: `const ep = choice.precision || prec;` → `buildPubForestSVG(result, {...pubOpts, prec: ep, ...})` for both SVG and PNG.
- `ForestTab` forest `run`: same `ep` threading for SVG + PNG.
- Report: `buildReportHTML(precOverride)` parameterised (`const prec = precOverride || p.analysisPrecision`); the report export `run` passes `choice.precision`.
- `buildPubForestSVG` weights: `.toFixed(1)` → `fmtWeight(..., prec)` (now matches the live `ForestPlot`).
- Het line I²: wrapped `${result.I2}` in `fmtI2(result.I2, prec)` in `buildPubForestSVG`, and routed the LIVE `ForestPlot` het line (I²/τ²/Q/Qp/p) through `fmtI2`/`fmtNum(..., prec)` so live == export.
- `ExportDialog.jsx` unchanged — it already produced `choice.precision`; only the monolith consumers were non-compliant.

## Test results
- The decimal selector now drives the exported figure/report; verified the dialog always emits `choice.precision` and the monolith passes `precision={project.analysisPrecision}` so the selector defaults correctly.
- Existing `precision.test.js` formatter tests preserved (I²/weights still default 1 dp unless `full`).
- Build (vite) green.

## Risks / limitations
- The live preview in the ExportDialog flow reflects the project's `analysisPrecision` (the default); the per-export selector applies at export time — intended.
- I²/weights intentionally do not follow the effect-decimal selector (only `full`); changing that would break the metafor-comparison convention and existing tests.
- Machine formats (CSV/JSON) remain full/raw precision — display precision is never applied to data columns.
