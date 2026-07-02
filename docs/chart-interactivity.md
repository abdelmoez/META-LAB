# Chart Interactivity (68.md P8)

> **Implementation status.** The interactive public-page chart is implemented at
> `src/features/publicSynthesis/InteractiveForest.jsx`, rendered by
> `PublicSynthesisPage.jsx` on the public routes `/public/synthesis/:token` and
> `/embed/synthesis/:token` (see `src/App.jsx`). It consumes the server-side
> forest data in the public payload (`payload.ma`, per-study rows). The
> authenticated workspace keeps its separate static SVG-string figure-export
> builder (`src/frontend/workspace/charts/svgBuilders.js`) — deliberately
> untouched by P8.

## Data the public payload provides

`deriveMa` (`server/publicSynthesis/publicSynthesisService.js`) puts everything a
forest chart needs into `payload.ma`, one entry per pooled
`(outcome, timepoint, esType)` group:

```
{
  outcome, timepoint, esType, method,
  k,                      // number of studies
  es, lo, hi, pval, i2,   // pooled random-effects result
  studies: [ { label, es, lo, hi, weight } ]   // per-study rows (label = author+year)
}
```

The pooled result and per-study effect sizes are computed by the **canonical
`runMeta` engine**, the same engine the authenticated workspace uses, so a public
forest plot is numerically identical to the in-app one. Labels are author+year
only — no notes, no reviewer data (see `docs/public-synthesis.md`).

## Intended interactive approach (design intent)

The spec calls for a **custom-drawn SVG** forest plot (no chart library) with:
- **Hover** to reveal a study's exact effect size and CI,
- **Click** to select / focus a row,
- **Back-transformed display for ratio measures**: pooling of ratio effect
  measures (OR, RR, HR) is done on the log scale, so the axis and printed values
  must be exponentiated back (`exp`) for display, while the geometry (positions,
  CI whiskers) is laid out in log space. Difference measures (MD, SMD) are drawn
  and displayed on their natural linear scale.

The `esType` field on each `ma` entry is what a renderer would switch on to decide
whether to back-transform. (The existing static builder in `svgBuilders.js` already
performs this log-scale layout / linear-scale layout split for exported figures and
is the natural reference for the interactive version.)

## Why no chart library

Confirmed against `package.json`: the project has **no charting dependency**
(no recharts, chart.js, d3, victory, nivo, plotly, apexcharts, or echarts). Charts
are hand-built SVG strings. The rationale, consistent with the rest of the app:

- **Bundle size** — a charting library is large; the public embed page in
  particular should stay lean so it loads fast inside a third-party iframe.
- **Determinism** — hand-built SVG produces byte-stable output, which matters for
  the figure-export path (journal presets, PNG rasterization at fixed DPI) and for
  reproducible published artifacts.
- **Full control** — custom SVG allows the exact log-vs-linear axis handling that
  ratio effect measures require, plus theme-token coloring that is inlined to
  literal colors on export.

## Print behavior

The existing SVG export path (`liveSvgToString` in `svgBuilders.js`) serializes a
live on-screen SVG into a standalone string, **inlining every computed
fill/stroke** so `var(--t-*)` theme tokens resolve to literal colors (custom
properties do not rasterize through a canvas `<img>`). This is what makes the
figure print/export cleanly. An interactive public forest plot, when built, should
follow the same serialize-and-inline approach for its print/export path rather than
relying on live CSS variables.

## Summary of what's real vs. planned

| Piece | Status |
|---|---|
| Forest **data** in the public payload (`payload.ma` + per-study rows) | Implemented (server) |
| Canonical `runMeta` pooling behind it | Implemented |
| Static SVG forest builder for workspace figure export | Implemented (`svgBuilders.js`) |
| "No chart library" architecture | True (verified against `package.json`) |
| `InteractiveForest` component (hover/click, public page) | Implemented (`src/features/publicSynthesis/InteractiveForest.jsx`) |
| Public-page / `/embed/synthesis` SPA renderer | Implemented (`PublicSynthesisPage.jsx`; routes in `src/App.jsx`) |
