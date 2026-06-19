# Palette Generator (prompt37, Phase 3)

`src/frontend/theme/themeEngine.js` — pure (no React/DOM/network), unit-tested,
dependency-free. Reuses `contrast.js` for WCAG math.

## Input → output

`generateThemeFromHex(hex)` →
```
{
  brandColor: "#rrggbb",
  day:   { acc, acc2, accText, accBg },   // the 4 overridable tokens
  night: { acc, acc2, accText, accBg },
  meta:  { hue, primary, primaryHover, primaryForeground, soft, muted,
           border, ring, darkPrimary, darkSoft }   // richer shades, preview-only
}
```

## Shade logic

**Day** (accent at its chosen lightness):
- `acc` = the brand.
- `acc2` = `mixWithBlack(brand, 0.16)` — a deeper pressed/hover sibling.
- `accText` = `getReadableForeground(acc)` — white or near-black (`#0b1020`),
  whichever has higher WCAG contrast on the brand.
- `accBg` = `mixWithWhite(brand, 0.90)` — a soft near-white tint (≈ *-50 family).

**Night** (brighter accents read better on dark surfaces, mirroring the stock
indigo-400 night accent):
- Convert brand to HSL; ease saturation (`×0.92`, cap 0.92).
- `acc` = same hue/sat at **L=0.70**; `acc2` = same at **L=0.60** (deeper).
- `accText` = `getReadableForeground(nightAcc)` (light accent → dark text).
- `accBg` = `mix('#151d33', brand, 0.18)` — a calm dark surface with a hint of
  brand (not a harsh invert; neutrals stay stable).

## Helpers

`normalizeHex` (3/6-digit, with/without `#`, any case) · `isValidHex` ·
`mix / mixWithWhite / mixWithBlack` (linear sRGB) · `rgbToHsl / hslToRgb / hslToHex`
· `getReadableForeground` · `validateContrast(fg,bg)` →
`{ ratio, passesAA, passesAALarge }`.

## Accessibility diagnostics

`diagnosePalette(palette)` runs 5 checks and returns `{ checks, warnings, ok,
hasWarnings }`:
1. Button text on brand — day (AA 4.5)
2. Button text on brand — night (AA 4.5)
3. Accent text/link on page bg — day (large/UI 3.0)
4. Accent text/link on page bg — night (large/UI 3.0)
5. Accent on its own soft chip — day (3.0)

Level per check: `good` (meets its floor) / `warn` (≥3.0 but below floor) / `fail`
(<3.0, "unusable"). `ok` is true when nothing is `fail` — warnings are
allowed-with-confirm; only a `fail` is flagged as poor/unreadable. We never block
saving outright (the admin may confirm), but the Save button switches to
"Save anyway" when warnings exist.

## Presets

`PRESETS` = 12 professional, evidence-platform-appropriate accents (Default
Indigo, Clinical Blue, Academic Navy, Royal Indigo, Teal Research, Emerald
Evidence, Cyan Modern, Scholar Violet, Rose, Burgundy, Gold Scholar, Graphite).
Each value is the DAY primary; the engine derives the rest. Hexes are chosen so
the accent keeps ≥3:1 on white (readable active tabs/links) and lightens cleanly
for dark mode — a unit test asserts this for every preset.

`buildThemeRecord({presetId|hex})` and `defaultThemeRecord()` produce the stored
record shape (`{brandColor, preset, palette}`).

## Delivery helpers

`paletteToCssVars(palette, theme)` → `{ '--t-acc': …, '--t-acc2': …,
'--t-acc-text': …, '--t-acc-bg': … }` (applied as inline props). 
`buildBrandOverrideCss(palette)` → an equivalent stylesheet block (used by tests /
as a documented fallback).
