# Screening subpage content centering (prompt33 Task 3)

## Problem
Standard Screening subpages (Overview, Duplicates, Final Review, Export) rendered inside a blanket `maxWidth: 1680` container. On typical laptop/desktop widths that is nearly edge-to-edge, so card content read as left-aligned / off-center, and the width was inconsistent with the rest of the app.

## Fix
Added a shared, reusable wrapper `ScreeningContentShell` in `src/frontend/screening/ui/components.jsx`:
```
width: 100% · max-width: 1280 · margin-inline: auto · padding: 24px clamp(24px, 4vw, 64px) 56px
```
`src/frontend/screening/pages/SiftProject.jsx` now wraps the standard subpages in `<ScreeningContentShell>` in BOTH render modes (embedded in the META·LAB workspace, and standalone `/sift-beta/projects/:pid`), replacing the two one-off `maxWidth:1680` divs. This applies to Overview, Duplicates, Final Review (second-review), Export, and Conflicts.

**Title & Abstract keeps its bespoke full-bleed layout** (`isFullBleed = active.key === 'screening'`) because it needs the full workspace for its list + article + decisions columns. The Import sub-view keeps its narrow `maxWidth:800` form. No one-off margin hacks were added; everything routes through the single shell.

## Why these values
- `max-width: 1280` centers the content at a comfortable reading width without being too narrow; Duplicates still has ample width for record comparison and Final Review shows its tabs/counts clearly.
- `padding-inline: clamp(24px, 4vw, 64px)` gives a responsive gutter (never glued to the edge, never wasteful on ultra-wide) with no horizontal overflow (`box-sizing: border-box`).

## QA
- Overview / Duplicates / Final Review / Export are centered and consistent at laptop, wide-monitor, and smaller widths; day + night themes (the shell uses no colors, so it's theme-agnostic).
- Title & Abstract still uses the full workspace layout. No horizontal scrollbar appears.

## Known limitations
- The shell is a fixed 1280 max-width; a future per-page override is available via its `maxWidth` prop if a subpage ever needs more room (none does today).
