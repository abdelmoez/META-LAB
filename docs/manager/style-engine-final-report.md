# Global Style Engine — Final Report (prompt37)

**Version:** 3.19.0 · **Scope:** one admin-chosen brand color re-themes the whole
platform (light + dark), token-based, accessible, persistent, audited.

## 1. Architecture (what made this safe)

The app already centralizes the brand in four CSS variables
(`--t-acc / --t-acc2 / --t-acc-text / --t-acc-bg`) consumed by every surface via
inline styles. So this is an **override layer**, not a color find-replace. See
`style-engine-current-audit.md`.

## 2. Theme / token system

Reused `tokens.js`. The four brand tokens are overridden per mode via **inline
custom properties on `<html>`** (win over stylesheets, no flash, mode-specific).
See `style-theme-token-plan.md`.

## 3. Palette generation

`src/frontend/theme/themeEngine.js` (pure). `generateThemeFromHex` derives related
shades — not flat copies — with separate light/dark logic and contrast-picked
foregrounds. `diagnosePalette` runs 5 WCAG checks. See `style-palette-generator.md`.

## 4. Presets (12)

Default Indigo · Clinical Blue · Academic Navy · Royal Indigo · Teal Research ·
Emerald Evidence · Cyan Modern · Scholar Violet · Rose · Burgundy · Gold Scholar ·
Graphite. Every preset is unit-asserted accessible.

## 5. Custom HEX

Native color picker + hex field; 3/6-digit normalize; live preview; invalid →
inline error; full palette auto-generated; preset-matching hex re-labels.

## 6. Accessibility safeguards

Five WCAG checks. Button-text-on-brand is treated as normal text — it **fails**
below AA 4.5 (no soft band); in practice `getReadableForeground` maximizes
contrast so it is always ≥~4.58. Accent-used-as-text on the page bg / soft chip
(day+night) targets 4.5 with a savable `[3.0, 4.5)` "low contrast" **warn** band
and **fails** below 3.0 ("poor contrast", red, blocks the green OK badge).
Warnings switch Save to "Save anyway"; focus rings always use `var(--t-acc)`;
`prefers-reduced-motion` respected app-wide (pre-existing). Server rejects any
non-hex value (422); the runtime apply path also re-validates each leaf as hex.

## 7. Ops Appearance tab

Admin-only `style` section: live light+dark preview, preset grid, custom color,
diagnostics, Save / Reset / Revert-preview. See `ops-style-console.md`.

## 8. Storage

`SiteSetting` key `themeSettings = { brandColor, preset, palette|null, updatedAt }`.
No schema change (additive JSON value). Default = indigo, `palette:null`.

## 9. ThemeProvider

Loads `themeSettings` from `/api/settings/public` (applies to logged-out landing
too), applies the matching mode's brand vars, caches the concrete palette to
`localStorage['metalab_brand']`; `index.html` re-applies it pre-paint. Live
preview/commit/reset API for the Ops tab.

## 10. Hardcoded colors replaced

None needed in chrome (already token-driven). Forest-plot scientific colors,
Okabe–Ito series, DB-source tags, and semantic tokens deliberately kept. See
`global-brand-color-migration.md`.

## 11. Areas updated (all via the token override)

landing · dashboard · project pages (extraction/analysis/GRADE/PRISMA/reports) ·
Screening · RoB · Ops (incl. country choropleth high-value = brand) ·
buttons/tabs/badges/active/focus/links/stepper · chat/notifications.

## 12. Day/night

Both fully supported with separate shade logic; mode flip re-applies the matching
brand side; day stays the product default.

## 13. Backend changes

`themeSettings` default + public `GET /api/settings/theme`; admin
`GET/PATCH /api/admin/settings/theme` with strict validation + `APP_THEME_UPDATED`
audit (old→new preset/color); `themeSettings` merged into `/api/settings/public`;
maintenance gate exempts `/api/settings/theme`; `style` added to admin console
sections.

## 14. Frontend changes

`themeEngine.js` (new); `ThemeContext.jsx` brand application + preview API;
`index.html` pre-paint bootstrap; `AdminConsole.jsx` `StyleSection` + nav;
`adminApiClient.js` `theme`.

## 15. Database / migration

None — additive JSON inside an existing `SiteSetting`. `prisma db push`-safe.

## 16. Tests added

`tests/unit/themeEngine.test.js` (23) + `tests/unit/themeValidate.test.js` (10) =
33 new. `tests/integration/api-theme.test.js` (skip-aware: public GET, public-
settings block, PATCH 401/403 authorization; admin-mutation documented).

## 17. Manual QA / live verification

Local server round-trip (admin session): preset save persists ✓ · GET reflects
saved ✓ · invalid hex → 422 ✓ · **CSS-injection in palette leaf → 422 (guard)** ✓ ·
reset → default indigo ✓ · `APP_THEME_UPDATED` audit rows with old→new ✓ ·
unauthenticated PATCH → 401, non-admin → 403 ✓.

## 18. Build / test results

`npm run build` ✓ · unit + screening-unit **1357 passed (72 files, incl. 33 new)** ✓.

### Adversarial review (4 dimensions, verify stage)
A multi-agent review (runtime / security / a11y / integration) confirmed 5 issues,
all fixed before commit:
- **MED** Appearance tab flashed the whole app to indigo on mount under a custom
  brand → seed `hexInput` from the already-applied context brand + gate the
  preview effect on `loading`.
- **MED** Diagnostics treated a sub-4.5 button-text contrast as a soft warn →
  button text now fails below AA 4.5 (target/floor model).
- **LOW** Runtime apply path didn't re-validate the cached palette as hex →
  `paletteToCssVars` now drops non-hex leaves (mirrors the bootstrap).
- **LOW** Landing HeroCanvas didn't repaint on a live brand change →
  `metalab:brand-change` event dispatched + listened.
- **LOW** Inaccurate `getThemeSettings` comment → corrected.

## 19. Version

3.18.0 → **3.19.0** (minor; significant additive feature, no breaking change).

## 20-21. Commit / push

See git log for the prompt37 commit on `main`.

## 22. Known limitations — reviewed & reclassified

A follow-up investigation re-examined every documented limitation against the
actual code. Most were over-cautious: they are deliberate, correct design
choices, not defects. Verdicts:

1. **Multi-series chart palette — NOT a gap (resolved by existing design).**
   The Ops trend chart (`AreaChart`) already uses the brand for its primary series
   (`logins → C.acc`) and distinct, theme-aware categorical hues for the others
   (`C.grn / C.purp / C.teal`) — exactly the recommended pattern. The only places
   that use the fixed Okabe–Ito / CVD-safe set are the **forest/funnel plots**
   (scientific, exported) and **RoB risk levels** (semantic low/some/high), which
   must stay color-blind-safe and meaningful. A brand-harmonized generator would
   have **no appropriate consumer** (it would be dead code). No change made.
2. **First-ever paint for brand-new visitors — inherent (kept).** The SPA is
   served statically by the VPS (the Node server does not serve `index.html`), so
   there is no SSR seam to inject the brand into the first HTML. The localStorage
   cache + pre-paint bootstrap already cover **every returning visitor**; a
   genuinely-first-time visitor briefly sees the default indigo until
   `/api/settings/public` resolves — identical, accepted behavior to the existing
   non-blocking `defaultTheme`. Not fixable from app code without changing the VPS
   serving layer.
3. **Forest-plot data colors — deliberate (kept).** `FC.acc` colors the per-study
   CI lines, point-estimate squares and the pooled diamond — core scientific data.
   Brand-tinting these would alter scientific presentation per brand and risks the
   "ugly/misleading plots" the spec warns against; exports must also stay fixed.
   Plot *UI controls* already follow the brand. No change made.
4. **Desaturated custom inputs** yield a near-gray night accent (L≈0.70) — this is
   correctly surfaced by the contrast diagnostics, so it is self-flagging, not a
   silent failure. Acceptable.

## 23. Recommendations — actioned

- ✅ **Active-brand swatch in the Ops Overview header** — implemented: a pill shows
  the current brand color + preset name and links straight to Ops › Appearance.
- ⏭️ **Per-scope theming (separate landing vs app accent)** — deliberately deferred.
  The original spec set "apply globally" as the default and treated per-scope as
  optional-only; the storage (`themeSettings`) already isolates this, so it remains
  a clean additive follow-up if ever requested.
- ⏭️ **Secondary accent / gradient-end control** — deferred. The gradient end
  (`--t-acc2`) is auto-derived and reads well across all presets; a separate
  control adds UI surface for marginal benefit.
