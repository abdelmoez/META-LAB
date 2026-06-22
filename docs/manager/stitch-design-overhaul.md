# Stitch Parallel Design Overhaul (design.md)

A second, fully parallel **Stitch / "Vivid Enterprise"** presentation layer was added on
top of the existing PecanRev application. Legacy remains the default and is byte-for-byte
untouched in behavior; the new UI is an **admin-only**, server-backed preview that can be
switched on/off without losing the route or project, and that fails safe to legacy.

This document is the structured final report design.md requires.

---

## 1. Architecture implemented

```
Shared domain logic + APIs + permissions   (unchanged: server controllers, hooks, helpers)
        │
        ├── Legacy presentation layer   (src/frontend/pages/**, workspace/**, screening/**, rob/**)  ← DEFAULT, untouched
        └── Stitch presentation layer   (src/frontend/stitch/**)                                       ← admin preview
                ↑ selected per-route by <DesignRoute legacy={…} stitch={…}/>
```

- **Design-mode core (pure, tested):** `src/frontend/design/designMode.js` — `resolveDesignMode`,
  validation, `?ui=` override parsing, localStorage persistence, root-attribute application.
  Single rule: **non-admins / signed-out always resolve to `legacy`**, invalid values fail safe.
- **Provider/hook:** `src/frontend/design/DesignModeContext.jsx` (`DesignModeProvider`, `useDesignMode`)
  — resolves from `{ user, savedMode, ?ui= }`, applies `<html data-ui-design>`, persists to
  localStorage + `PUT /api/profile`.
- **Per-route selector:** `src/frontend/design/DesignRoute.jsx` — picks legacy vs stitch, wraps
  stitch in `Suspense` + error boundary. Stitch pages are lazily imported, so non-admin/legacy
  users never download the Stitch bundle.
- **Design system:** `src/frontend/stitch/theme/` (tokens + scoped CSS) and
  `src/frontend/stitch/primitives/` (component family).
- **Shell:** `src/frontend/stitch/shell/` (primary rail, context rail, top header, account menu).
- **Pages:** `src/frontend/stitch/pages/`.

## 2. Design-mode switching behavior

- Compact **Classic / Stitch** segmented control. Two mounts: a floating overlay portaled to
  `<body>` in legacy mode (so the legacy header is never edited) and an inline control in the
  Stitch top header. Switching only flips a preference → React re-renders the **same route**
  through the other shell; the URL, project, and query params are preserved.
- Survives refresh (localStorage + server) and deep links (the bootstrap sets `data-ui-design`
  before first paint → no flash).

## 3. Admin authorization behavior

- Switch renders only when `user.role === 'admin'` (mods are staff for Ops but are **not** design
  admins — design.md §5/§OPS). Enforced on the client (`isDesignAdmin`) AND the server: `PUT
  /api/profile` returns **403** if a non-admin tries to persist `uiDesignMode: 'stitch'`
  (DB-verified role). `legacy` is always allowed (safe default / reset).

## 4. Persistence method

- New nullable `User.uiDesignMode` column (both SQLite + Postgres schemas; additive, `db push`-safe).
  Returned by `GET /api/auth/me` + `GET/PUT /api/profile`. Mirrors the existing `themePreference`
  pattern: localStorage for instant/no-flash, server for cross-device.

## 5. Emergency fallback method

- `?ui=legacy` query override always wins and is persisted (so it sticks across refresh).
- `StitchErrorBoundary` wraps every Stitch route: any render crash shows a calm recovery panel
  whose **"Return to Legacy UI"** action persists legacy + hard-navigates with `?ui=legacy` —
  independent of the (possibly broken) header switch. A presentation crash never touches data.

## 6. Legacy-protection measures

- No legacy file was rewritten/renamed/restyled. Only additive edits: `App.jsx` (provider + floating
  switch + DesignRoute wiring), `index.html` (one font family + a pre-paint attribute), and the
  server profile/auth controllers + schema (additive column).
- All Stitch CSS is rooted at `html[data-ui-design="stitch"]` (unit-tested: zero unscoped selectors)
  and is injected only while the Stitch shell is mounted. The legacy `--t-*` tokens are re-mapped
  only under the Stitch root so embedded shared widgets harmonize — legacy rendering is unchanged.

## 7. New design-system structure

- Tokens: `stitch/theme/stitchTokens.js` (DESIGN.md values; light + dark; `S` accessor; `salpha`).
- Primitives: `stitch/primitives/{core,controls,overlay}.jsx` + `index.js` — Card, Button,
  IconButton, Badge, StatusDot, Avatar(+Group), PageHeader, SectionHeader, MetricCard, ProgressBar,
  ProgressRing, Spinner, Skeleton, Empty/Loading/Error states, Field, Input, Textarea, Select,
  SearchInput, Switch, Checkbox, Tabs, Table, Pagination, Modal, Drawer, Tooltip, Toast.
- Icons reuse the app's existing line-icon set (`components/icons.jsx`) — no Material Symbols CDN.
- Font: Manrope added to the single existing Google Fonts `<link>` (CSP already allows it).

## 8. Routes completed (Stitch native presentation)

| Route | Legacy page | Stitch page | Status |
|-------|-------------|-------------|--------|
| `/app` (Command Center) | ProjectLanding | StitchDashboard | ✅ native, real data — visually verified |
| `/app/project/:id` (Project Overview) | AppWorkspace | StitchProjectOverview | ✅ native, real data (phase status, team, metrics) |
| `/profile` | Profile | StitchProfile | ✅ native, real data — visually verified |
| `/ops` | AdminConsole | StitchOpsConsole | ✅ native (Overview/Health/Flags live; other tabs hand off) — visually verified |
| all other routes | (legacy) | — | **legacy fallback** in Stitch mode (safe + documented; see §17) |

In Stitch mode, every route still renders and works: routes with a native Stitch
page use it; everything else falls back to the legacy page (the safe default). No
route 404s or shows fake data.

## 9. Shared logic extracted / reused

No business logic was forked. Stitch pages import the SAME modules the legacy UI uses:
`api` client, `screeningApi`, `projectLanding.helpers` (statusOf/relTime/progressOf/…),
`workspace/projectHelpers` (stepStatus/PHASES/readinessCheck/projectPerms/linkedSiftId —
the real phase-status engine), `pages/admin/adminApiClient` (adminApi/fetchVersion),
`shared/editableUserFields` (option lists), `useAuth`, `useTheme`. The only NEW backend
surface is the additive `User.uiDesignMode` column + its read/write in existing
auth/profile controllers.

## 10. Components created

- Design core: `designMode.js`, `DesignModeContext.jsx`, `DesignRoute.jsx`,
  `StitchErrorBoundary.jsx`, `AdminDesignSwitch.jsx`.
- Tokens: `stitch/theme/stitchTokens.js`, `StitchStyle.jsx`.
- Primitives (`stitch/primitives/`): Card, Panel, Divider, Button, IconButton, Badge,
  StatusDot, Avatar, AvatarGroup, PageHeader, SectionHeader, MetricCard, ProgressBar,
  ProgressRing, Spinner, Skeleton, Empty/Loading/Error states, Field, Input, Textarea,
  Select, SearchInput, Switch, Checkbox, Tabs, Table, Pagination, Modal, Drawer, Tooltip,
  Toast(+provider/hook).
- Shell (`stitch/shell/`): StitchPrimaryRail, StitchContextRail, StitchTopHeader,
  StitchAccountMenu, StitchAppShell.
- Pages (`stitch/pages/`): StitchDashboard, StitchProjectOverview, StitchProfile,
  StitchOpsConsole.

## 11. Tests added

- `tests/unit/designMode.test.js` (18) — pure resolution/gating/persistence/fallback.
- `tests/unit/stitchTokens.test.js` (8) — token values + **zero unscoped CSS selectors**.
- `tests/unit/stitchPrimitives.test.jsx` (11) — SSR + a11y contracts.
- `tests/unit/designModeUi.test.jsx` (6) — switch gating + DesignRoute selection.
- `tests/unit/stitchDashboard.test.jsx` (1) + `tests/unit/stitchPagesWave1.test.jsx` (2) — page SSR smoke.
- `tests/integration/api-design-mode.test.js` (5) — **live** server-side admin gating.

## 12. Test results

- Unit: **1786 passed** (118 files) — includes the 46 new design-mode/Stitch tests.
- Screening unit: **177 passed** (7 files).
- Integration (live server): `api-design-mode` **5 passed** (admin stitch round-trip,
  non-admin 403, legacy allowed, invalid 400, getMe field).
- Production build: **green**. Stitch ships as separate lazy chunks (StitchAppShell
  ~35 kB + per-page 12–20 kB); the legacy bundle is unchanged for non-admins.

## 13. Visual comparisons performed

Playwright (`scripts/stitch-visual-check.mjs`) drove the real built app: logged in as the
seeded admin, captured **legacy → Stitch → legacy** at 1440×900 and 390×844. Confirmed:
deep-purple 72px rail, 280px context rail, white/tonal cards, the header `Classic | Stitch`
switch, real data on every surface, and that **legacy renders unchanged after switching
back**. Screenshots in `Design/_stitch_shots/` (not committed). The admin's saved theme is
night, so shots show the (coherent) dark adaptation; the canonical light identity renders in
day mode.

## 14. Responsive checks

Desktop (1440) shows both rails; <1280 collapses the context rail; <1024 moves navigation
into an off-canvas drawer (hamburger in the header). Mobile (390) verified — no horizontal
overflow, primary actions reachable. Bento/profile grids collapse to one column under 900.

## 15. Accessibility checks

Semantic landmarks (`nav`/`aside`/`main`/`header`), headings, labelled icon buttons,
`role=radiogroup/radio` switch, `role=switch/checkbox/tablist/dialog/progressbar`, focus
trap + Escape + focus-restore in Modal/Drawer, visible focus rings, ARIA-live toasts,
`prefers-reduced-motion` honored, no clickable-`div` controls. (Automated axe sweep not run —
listed as a follow-up in §17.)

## 16. Performance findings

Stitch bundle is lazy + code-split — non-admin/legacy users download none of it. The
`--t-*` harmonization is pure CSS (no JS). Tables are not yet virtualized (the native Stitch
pages render bounded lists; large grids remain in the legacy workspace). No duplicate API
calls — legacy and Stitch never mount together (DesignRoute renders exactly one).

## 17. Known limitations (honest)

1. **Coverage is the foundation + 4 flagship pages.** Native Stitch presentations exist for
   `/app`, `/app/project/:id`, `/profile`, `/ops`. The deep workflow tools — PICO, Search
   Builder, Title/Abstract Screening, full-text PDF, Risk of Bias, Data Extraction, Analysis,
   Reporting — are **not yet native Stitch**; in Stitch mode they render the legacy page
   (safe fallback). The Project Overview hands off to the classic workspace via the
   `?ui=legacy` escape for those phases (a real, working link — never a dead button). This is
   a deliberate, documented stopping point on a permanent architecture, not a half-migration:
   the design system + shell are in place so each remaining screen is an additive page on the
   same foundation.
2. **Pre-auth screens stay legacy by design.** The switch is admin-only and post-login, so
   login/register/landing/invite/onboarding have no admin context to ever show Stitch.
3. **Project Overview** was build- and SSR-verified but not screenshotted (needs an open
   project in the seed); the other three flagship pages were screenshotted.
4. **Automated a11y (axe) and cross-browser visual-regression** were not run — manual a11y
   review + Playwright Chromium screenshots only.
5. The Stitch identity uses a fixed deep-purple brand (the DESIGN.md identity); the admin
   brand-color engine still themes embedded legacy widgets via `--t-*` but not the Stitch
   primitives' `--stitch-*` tokens (intentional, to preserve the Stitch identity).

## 18. Exact manual verification steps

1. `cd server && node node_modules/prisma/build/index.js db push --schema prisma/schema.prisma`
   (applies the additive `uiDesignMode` column; already done on dev.db).
2. `npm run build` then `node server/index.js` (or `npm run dev` for Vite at :3000).
3. Sign in as an **admin**. Top-right shows a `Classic | Stitch` pill (a non-admin sees nothing).
4. Click **Stitch** → the same `/app` route re-renders as the Stitch Command Center (real
   projects/metrics). Navigate `/profile` and `/ops` → Stitch presentations with real data.
5. Refresh → Stitch persists. Open a deep link (e.g. `/ops`) directly → still Stitch.
6. Click **Classic** (or append `?ui=legacy`) → legacy returns, visually identical to before.
7. As a **non-admin**, confirm no switch appears and `PUT /api/profile {uiDesignMode:'stitch'}`
   returns **403**.
8. Emergency: append `?ui=legacy` to any URL to force legacy; or trigger the Stitch error
   boundary's **Return to Legacy UI** button.
