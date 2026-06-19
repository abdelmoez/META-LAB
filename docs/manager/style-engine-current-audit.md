# Style / Theme Architecture Audit (prompt37, Phase 1)

_Audit performed before implementing the global brand-color engine. Conclusion:
the platform is already a clean CSS-variable token system — a single accent
color drives almost everything — so global re-theming needs an **override layer**,
not a find-and-replace migration._

## 1. Tailwind / CSS framework

- The **app does NOT use Tailwind.** Tailwind only lives under `template/` (the
  Nextly design source the user placed; not part of the build). The running app
  styles with **inline-style objects** referencing CSS custom properties.
- No CSS-in-JS library, no CSS modules, no `globals.css`. The only stylesheet is
  the small block injected by `<ThemeProvider/>` + per-component `<style>` tags.

## 2. The token system (single source of truth)

`src/frontend/theme/tokens.js`:
- `THEMES.day` / `THEMES.night` — flat objects of **hex** values.
- `buildThemeCss()` emits them as CSS variables on `<html>`, switched by
  `data-theme="day|night"`: `:root[data-theme="day"] { --t-acc: #4f46e5; … }`.
- Components import `C` (e.g. `C.acc` === `"var(--t-acc)"`) and use it in inline
  styles, so a variable change repaints with **no React re-render**.
- `alpha(color, a)` → `color-mix(in srgb, var(--t-acc) X%, transparent)` for
  theme-aware translucency (hex+alpha concatenation does NOT work on vars).

### The brand/accent tokens
| token | day | night | role |
|-------|-----|-------|------|
| `--t-acc` | `#4f46e5` (indigo-600) | `#818cf8` (indigo-400) | primary brand |
| `--t-acc2` | `#4338ca` | `#6366f1` | hover / pressed sibling |
| `--t-acc-text` | `#ffffff` | `#0b1020` | text on brand fills |
| `--t-acc-bg` | `#eef2ff` | `#1e2547` | soft brand-tinted surface |

These four tokens **are** the brand. Everything else (`grn/red/yel/teal/gold/purp`
+ their `*Bg`) is semantic and must stay meaningful.

## 3. Theme provider / dark mode

- `src/frontend/theme/ThemeContext.jsx` — holds `theme`, persists to localStorage
  + best-effort `PUT /api/profile`, and fetches `/api/settings/public` for the
  site-wide first-visit default (`appSettings.defaultTheme`).
- `index.html` sets `data-theme` pre-paint from localStorage (no flash).
- `src/frontend/theme/contrast.js` — pure WCAG 2.1 utilities (`hexToRgb`,
  `relLuminance`, `contrastRatio`, `meetsAA`, `AA_NORMAL/AA_LARGE`) already exist.

## 4. Current accent setting

There was **no** admin-controllable accent. Accent was the hardcoded indigo in
`tokens.js`. Day/night was the only adjustable axis.

## 5. Ops settings system

- `SiteSetting { key, value(JSON), updatedAt, updatedBy }`; `appSettings`,
  `landingContent`, `featureFlags`, `onboardingSettings`, `robSettings` are keys.
- `GET /api/settings/public` (no auth) merges defaults + returns the public keys.
- `PUT /api/admin/settings` / per-key endpoints (admin only, `requireAdmin`).
- `logAdminAction(req, action, type, id, details)` → `AdminAuditLog`.
- Ops console (`AdminConsole.jsx`): `NAV_SECTIONS` + a `sections` map; the server
  `getConsole` returns the allowed section ids (source of truth).

## 6. Where the brand color is "hardcoded"

Exhaustive grep across `src/**` + the root workspace monolith for indigo/violet
family hexes and the words purple/violet/indigo:

| Location | Finding | Action |
|----------|---------|--------|
| `tokens.js` | defines the base `--t-acc*` (legit) | **keep** — this is the source |
| `meta-lab-3-patched.jsx` L1139 `const C={…}` | the live workspace's local palette is **fully `var(--t-*)`** | already brand-driven, no change |
| `meta-lab-3-patched.jsx` L1328-29 forest-plot `DARK/LIGHT.acc` | scientific/export SVG colors, intentionally absolute | **keep** (exports must not change) |
| `meta-lab-3-patched.jsx` L1090/1105 DB source tags (`#8b5cf6` Embase, `#6366f1` PsycINFO) | per-database categorical colors | **keep** (semantic, not brand) |
| `Landing.jsx` L197 HeroCanvas | reads live `--t-acc`, hex only a fallback | already brand-driven |
| `TagBadge.jsx` / `projectLanding.helpers.js` | role/tag `purple` variant uses `C.purp` (distinct from brand `blue`=`C.acc`) | **keep** (semantic tag palette) |
| Ops country map (`AdminConsole.jsx` L2219+) | choropleth fill = `alpha(C.acc, …)`, borders `C.muted` | already brand-driven |

**Net: there is essentially nothing to migrate.** Every user-facing brand surface
already consumes `--t-acc*`. The only literal indigo hexes are the forest-plot
scientific colors and a canvas fallback — both correctly left alone.

## 7. Surfaces inventory (all token-driven → auto re-theme)

landing · auth/onboarding · dashboard (`ProjectLanding`) · project workspace
(monolith: overview, data extraction, analysis, GRADE, PRISMA, reports) · RoB
(`rob/*`, `ProjectRobPanel`) · Screening (`screening/*` re-exports the same `C`) ·
Ops console (tabs/buttons/active = `C.acc`; map = `alpha(C.acc)`) · chat ·
notifications · stepper/progress · members.

## 8. shadcn-like tokens?

No shadcn. The `--t-acc / --t-acc2 / --t-acc-text / --t-acc-bg` quartet already
maps conceptually to `primary / primary(hover) / primary-foreground / accent-soft`.
We **extend this**, not introduce a parallel system.

## 9. Limitations found

1. No global accent control (the gap this work fills).
2. Brand was a compile-time constant; no persistence / no admin UI / no audit.
3. Pre-paint bootstrap only handled day/night, not a custom brand.

→ See `style-theme-token-plan.md` for the chosen design.
