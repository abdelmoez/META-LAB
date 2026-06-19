# Global Brand-Color Migration (prompt37, Phase 6)

## Summary: almost nothing needed migrating

Because the app is already a CSS-variable token system where the brand is
`--t-acc / --t-acc2 / --t-acc-text / --t-acc-bg`, overriding those four tokens
re-themes **every** surface that consumes them — which is all user-facing chrome.
No `bg-purple-600`-style class migration was required (the app has no Tailwind).

## Surfaces re-themed automatically (consume `C.acc*` / `var(--t-acc*)`)

- **Landing** (`Landing.jsx`) incl. the HeroCanvas (reads live `--t-acc`).
- **Auth / onboarding** (`Login`, `Register`, `Onboarding`, `ResetPassword`, …).
- **Dashboard** (`ProjectLanding.jsx`) — cards, active states, badges.
- **Project workspace monolith** (`meta-lab-3-patched.jsx`) — its local `C` is
  100% `var(--t-*)`: buttons (`btnS` gradient `var(--t-acc)`→`var(--t-acc2)`),
  tabs, inputs, headers across Overview / Data Extraction / Analysis / GRADE /
  PRISMA / Reports.
- **Screening** (`screening/**`) — `ui/theme.js` re-exports the same token `C`.
- **RoB / GRADE** (`rob/**`, `ProjectRobPanel`).
- **Ops console** — tabs/buttons/active = `C.acc`; **country map** fill =
  `alpha(C.acc, …)`, low-value = `alpha(C.acc, 0.18)`, neutral/borders = `C.muted`
  (re-themes live; brand becomes the high-value choropleth color per Phase 7).
- **Chat, notifications, stepper/progress, members.**

## Deliberately NOT changed (correct as-is)

- **Forest-plot scientific colors** (`meta-lab-3-patched.jsx` L1328-29 `DARK/LIGHT`)
  — absolute hex so downloaded SVG/PDF artifacts never shift. Per the tokens.js
  rule "never bake `var(--t-*)` into exports."
- **Okabe–Ito categorical plot series** + **screening decision colors** (CVD-safe,
  exported) — semantic, theme-independent.
- **Semantic tokens** `--t-grn/red/yel/teal/gold/purp` (+ `*Bg`) — success /
  warning / destructive / categorical tag+role colors stay meaningful.
- **DB-source tag colors** (Embase `#8b5cf6`, PsycINFO `#6366f1`, …) — per-database
  identity, not brand.

## New code (the override layer)

| File | Change |
|------|--------|
| `src/frontend/theme/themeEngine.js` | **new** — pure palette generator + presets + diagnostics |
| `src/frontend/theme/ThemeContext.jsx` | apply brand via inline vars; preview/commit/reset; cache |
| `index.html` | pre-paint brand bootstrap (no flash) |
| `server/utils/themeValidate.js` | **new** — strict hex validator (injection guard) |
| `server/controllers/settingsController.js` | `themeSettings` default + public GET |
| `server/controllers/adminController.js` | admin GET/PATCH + `APP_THEME_UPDATED` audit + `style` console section |
| `server/routes/{settings,admin}.js` | route wiring |
| `server/middleware/maintenance.js` | exempt `/api/settings/theme` |
| `src/frontend/pages/admin/AdminConsole.jsx` | `StyleSection` + nav entry |
| `src/frontend/pages/admin/adminApiClient.js` | `theme.get/save` |
