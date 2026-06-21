# Marketing Screenshot Plan & Feasibility

_Goal: a reliable, repeatable way to capture polished screenshots of the unified
**Review Project** workflow from the actual app, with safe demo data._

## Feasibility: YES (on a machine where the app runs)

The app is a standard React (Vite) SPA + Express/Prisma(SQLite) backend, fully
browser-drivable. A Playwright script can log in, open a seeded demo project, deep-link
each workflow tab via `?tab=`/`?screen=`, and screenshot it. Everything needed is in this
repo (see deliverables). **Capture must run where the backend boots** — see Blockers.

## Available screenshot approach

- **Tool:** Playwright (added as a devDependency; no browser-automation tool previously
  existed). Uses bundled Chromium, or falls back to system Chrome (`channel: 'chrome'`).
- **Script:** `scripts/capture-marketing-screenshots.mjs` → `npm run marketing:screenshots`.
  - Viewport **1440×1000 @2x** (retina/crisp) + a few **1600×1000** hero shots.
  - `colorScheme: 'light'`.
  - Auth via `POST /api/auth/login` on the context request (cookies shared with pages).
  - `waitUntil: 'domcontentloaded'` + a visible-heading wait per tab, then a settle delay
    (the app holds a long-lived SSE stream, so `networkidle` would never fire — important).
  - Output: `marketing/screenshots/<YYYY-MM-DD>/NN-name.png`.

## Demo data source

No demo/sample project existed (only CSV/RIS import fixtures). So an **additive** seed was
created: `scripts/seed-marketing-demo.mjs` → `npm run marketing:seed`.

- Builds one demo Review Project **"GLP-1 Receptor Agonists for Weight Loss in Adults With
  Obesity"** via the real model factories (`mkProject`/`mkStudy` in
  `src/research-engine/project-model/defaults.js`) + `store.save()`.
- Populates: PICO (incl. Time Frame = "Last 10 years"), search strategy, PRISMA counts,
  13 screening citations, and 8 extracted RCTs with consistent **MD** weight-loss effect
  sizes (drives a clean forest plot + pooled estimate + heterogeneity).
- Seeds the linked **screening workspace** (`ScreenProject` + records + 2-reviewer
  decisions + a duplicate group + 2 conflicts + Owner/Reviewer/Leader/Viewer members).
- Enables the `searchEngine` + `serverBackedWorkflowState` feature flags **additively**
  (required so tab 4 renders the new Search Builder, not the legacy form).
- **Safe:** idempotent (removes only its own demo data and recreates), never resets the DB,
  fake `.example` emails, no patient data/secrets. Remove via `npm run marketing:seed:remove`.

## Authentication approach

- Login: `POST /api/auth/login { email, password }` → httpOnly cookie **`metalab_session`**
  (SameSite=Strict; `secure` only in production). No CSRF token.
- Demo credentials (seeded): `demo.curator@pecanrev.example` / `PecanRevDemo2026!` — an
  **admin** so it also reaches the Ops Console. A second fake reviewer makes screening
  decisions/conflicts realistic.
- Server env required to boot: **`JWT_SECRET`** (throws if missing), **`DATABASE_URL`**
  (e.g. `file:./dev.db`). Optional admin seeding via `ADMIN_EMAIL_1/2` + `ADMIN_SEED_PASSWORD`.

## Required routes (verified)

| # | Screen | Route |
|---|--------|-------|
| 1 | Dashboard | `/app` |
| 2 | Overview | `/app/project/:id?tab=overview` |
| 3 | Protocol / PICO | `?tab=pico` |
| 4 | Search Builder | `?tab=search` |
| 5 | Screening Overview | `?tab=screening&screen=overview` |
| 6 | Screening Import | `?tab=screening&screen=import` |
| 7 | Duplicates | `?tab=screening&screen=duplicates` |
| 8 | Title & Abstract | `?tab=screening&screen=screening` |
| 9 | Conflicts | `?tab=screening&screen=conflicts` |
| 10 | Final Review | `?tab=screening&screen=second-review` |
| 11 | Data Extraction | `?tab=extraction` |
| 12 | Risk of Bias | `?tab=rob` |
| 13 | GRADE | `?tab=grade` |
| 14 | Analysis / Forest | `?tab=forest` |
| 15 | PRISMA | `?tab=prisma` |
| 16 | Report & Export | `?tab=report` |
| 17 | Project Control | `?tab=control` |
| 18 | Ops Console | `/ops` |

Source of truth: `src/App.jsx` (routes), `src/frontend/pages/AppWorkspace.jsx` (`?tab=`/`?screen=`),
`src/frontend/workspace/projectHelpers.js` (`TABS`), `src/frontend/screening/pages/SiftProject.jsx`
(screening sub-tabs), `src/frontend/pages/admin/AdminConsole.jsx` (Ops). No `data-testid`s
exist, so the script waits on distinctive heading text.

## Blockers

- **This sandbox cannot boot the backend** to actually generate the PNGs: `@prisma/client`
  is not installed (and not declared in `package.json` deps); `import('@prisma/client')` →
  `ERR_MODULE_NOT_FOUND`, and `prisma generate` fails (Prisma CLI 7.x vs the schema). The
  backend (and the seed, which writes via Prisma) therefore can't run here. On the user's
  working dev machine (where `npm run dev` already works) there is no such blocker.
- **Theme:** the script requests light mode via `colorScheme`. If the app's theme is driven
  by a stored setting rather than `prefers-color-scheme`, set the brand to light in the Ops
  Console → Appearance before capturing.
- **Ops Console Users tab** lists real accounts — the script captures the Overview only;
  redact emails before publishing any user-list screenshot.
- **RoB/GRADE depth:** the seed does not fabricate full per-domain RoB assessments (complex,
  separate tables); the RoB tab shows the study list ready to assess. Complete one assessment
  in-app if a fully-populated RoB/GRADE shot is needed.

## Recommended screenshot list

The 18 in the table above (the `01…18` filenames), plus `hero-02/04/14` at 1600×1000 for
landing-page heroes. Strongest marketing shots: **Search Builder (04)**, **Forest plot
(14)**, **PRISMA (15)**, **Protocol/PICO (03)**, **Dashboard (01)**.

## How to run (summary)

```bash
npm install && npx playwright install chromium
npm run dev                      # terminal A
npm run marketing:seed           # terminal B
npm run marketing:screenshots    # → marketing/screenshots/<date>/
```

## Assumptions

- Light mode is the marketing default.
- "GLP-1…" demo project (per the brief) is the canonical demo.
- Screenshots are regenerated on demand (PNGs git-ignored); scripts + this plan are tracked.
