# Design Token Plan (prompt37, Phase 2)

## Principle

Reuse the existing `--t-*` token system. The brand is exactly four tokens; a
chosen color generates **related shades** for them (per day + night) and we
override the four — nothing is flattened to one flat color, and semantic colors
stay untouched.

## Tokens (no new token names introduced for chrome)

We override, per theme, the existing quartet:

| token | meaning | derived from brand `B` |
|-------|---------|------------------------|
| `--t-acc` | primary | day: `B`; night: lightened `B` (L≈0.70) |
| `--t-acc2` | hover/pressed | day: `B` mixed 16% black; night: deeper sibling (L≈0.60) |
| `--t-acc-text` | foreground on brand | accessible white/near-black by contrast |
| `--t-acc-bg` | soft tint (chips, active tab, map low) | day: `B` mixed 90% white; night: dark base + 18% `B` |

Mapping to common design-system names: `--t-acc`→primary, `--t-acc2`→primary
hover, `--t-acc-text`→primary-foreground, `--t-acc-bg`→accent/muted-soft. Focus
ring (`box-shadow … color-mix(var(--t-acc) …)`) and links/active-tabs already use
`--t-acc`, so they re-theme for free.

## What stays semantic (never generated)

`--t-grn/grn2` (success), `--t-red` (destructive), `--t-yel` (warning),
`--t-teal/gold/purp` (categorical tags/roles), all neutrals (`bg/surf/card/
card2/brd/brd2/txt/txt2/muted/dim`), the Okabe–Ito plot series, and screening
decision colors. Neutrals are **not** brand-tinted (keeps surfaces calm).

## Delivery mechanism — inline custom properties on `<html>`

The brand override is applied as **inline custom properties** on
`document.documentElement`, keyed to the active mode:
- Inline props win over stylesheet rules with no specificity/order games.
- They can be set pre-React by the `index.html` bootstrap → **no brand flash**.
- They are mode-specific, so on day↔night flip we re-apply the matching side.

`ThemeProvider` keeps `{brandColor, preset, palette}` and re-applies the matching
side on `brand`/`preview`/`theme` change; a preset/custom selection previews live;
Save commits + caches; navigation away reverts an unsaved preview.

## Storage

A new `SiteSetting` key **`themeSettings`** = `{ brandColor, preset, palette|null,
updatedAt }`. Returned by `/api/settings/public` and a dedicated public
`/api/settings/theme`. `palette` is `null` for the default indigo (frontend uses
the stylesheet base), or the full generated `{day,night}` for a custom brand.

## Theme requirements coverage

light ✓ · dark ✓ (separate shade logic, not a bad invert) · presets ✓ · custom
HEX ✓ · accessibility contrast diagnostics ✓ · smooth live update (no reload) ✓ ·
semantic colors preserved ✓ · pre-paint (no flash for returning visitors) ✓ ·
fallback to default indigo if settings fail ✓.
