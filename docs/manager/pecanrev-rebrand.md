# Rebrand → PecanRev (pecanrev.com)

**Version:** v3.31.0 · builds on v3.30.0. **Source:** `.claude/Prompts/47.md`.
Full project-wide rename of the product **META·LAB / META·SIFT → PecanRev** and production domain → **https://pecanrev.com**. Stack is Vite + React + Express + Prisma/SQLite (NOT Next.js), so app-name/domain are handled via the app's real conventions, not `NEXT_PUBLIC_*`. The **Search Builder engine** (`src/features/searchBuilder/`) was left **untouched** (colleague-owned).

Executed as: 6 parallel rebrand agents (disjoint file groups) → integrator sweep of files the partition missed → 3-agent adversarial QA (residual refs, internal-ID safety, auth/domain/SEO) → fixes → build + tests.

## Brand mapping (user-facing copy only)
- Product/app name → **PecanRev** (title, landing, sidebar/wordmark, welcome, emails, exports, onboarding, maintenance, SEO).
- **META·SIFT** (screening sub-brand) → **Screening**.
- "META·LAB project" (the linked review project) → "PecanRev project".
- Permission/notification **area** labels that contrast the two halves → **Workspace** (analysis side) vs **Screening**.

## Internal identifiers — intentionally KEPT (changing them breaks sessions/links/data)
Cookie `metalab_session`; localStorage `metalab_theme`/`metalab_brand`; window globals `__METALAB_DEFAULT_THEME__`/`__METALAB_BRAND__`; route segments `/metalab/`; permission keys `canViewMetaLab`/`canEditMetaLab`/`canViewMetaSift`/`readOnly*`; DB fields `linkedMetaLabProjectId`/`relatedMetaLabProjectId`; functions `getMetaLabMemberAccess`/`emitToMetaLabProject`; React component `MetaLab`; `MetaLabChatLauncher`; package name `meta-lab`; filenames (`meta-lab-3-patched.jsx`). Pure code comments/docstrings referencing the old names were left (developer-facing, out of scope).

## Domain configuration
The production domain is **env-driven**, never hardcoded in logic. `APP_BASE_URL` drives outbound email links (verify / reset / invite) and is the CORS fallback; `CORS_ORIGIN` takes precedence. Local dev keeps `http://localhost:3000` (frontend) / `:3001` (API). Email-link building: `(process.env.APP_BASE_URL || '').replace(/\/+$/,'') || \`${req.protocol}://${req.get('host')}\``. CORS: `CORS_ORIGIN || APP_BASE_URL || 'http://localhost:3000'`. Cookie flags unchanged (`httpOnly, sameSite:strict, secure` in production).

## Files changed
- **Frontend UI:** `index.html` (title + SEO/OG/Twitter/canonical/theme-color/favicon/manifest), `Landing.jsx` (DEFAULTS + sections + footer wordmark), `ProjectLanding.jsx`, `Onboarding.jsx`, `InvitePage.jsx`, `Terms.jsx`, `UserMenu.jsx`, `NotificationsBell.jsx` (chip labels Workspace/Screening), `workspace/Workspace.jsx`, `workspace/tabs/{overviewTabs,reportTabs}.jsx`, `screening/pages/{SiftDashboard,SiftProject}.jsx`, `screening/tabs/{OverviewTab,ProjectControlTab,ScreeningTab}.jsx`, `pages/admin/AdminConsole.jsx` (email preview, logoText, appName default, KPI labels), `components/chat/MetaLabChatLauncher.jsx`, `hooks/useGlobalPresence.js`, `theme/themeEngine.js`, `research-engine/{docs/methods-content.js,docs/methodsText.js,import-export/journalSubmission.js,r-validation/rValidation.js,screening/permissionPresets.js}`.
- **Backend:** `controllers/{settingsController,adminController,authController,onboardingController,projectsController,screeningController,screeningMemberController,screeningReviewController}.js`, `middleware/maintenance.js`, `services/emailService.js`, `screening/settings.js`, `routes/screening.js`, `version.js`, `index.js` (boot log), `scripts/init-settings.js`.
- **Config/docs:** `.env.example`, `server/.env.example` (production examples → pecanrev.com; localhost defaults kept), `README.md` (+ "Production domain" section), `src/frontend/README.md`, `src/research-engine/README.md`, `src/research-engine/screening/README.md`, `src/frontend/screening/README.md`, `package.json` (v3.31.0).
- **New:** `public/favicon.svg`, `public/site.webmanifest`, `public/robots.txt`; `server/scripts/rebrand-pecanrev.js` (DB migration).
- **Test:** `tests/unit/rValidation.test.js` (asserts the rebranded R-script footer).

## DB migration for EXISTING databases
`appName`, `maintenanceMessage`, landing copy, and onboarding intro are seeded into `SiteSetting`/`OnboardingQuestion`. Fresh installs already default to PecanRev (code defaults changed). For a pre-rebrand database, run once:

```
node server/scripts/rebrand-pecanrev.js
```

Idempotent: only UPDATEs existing rows (`appSettings`, `landingContent` incl. any stored `seoTitle`/`seoDescription`, `onboardingSettings`, the seeded `main_use_case` question), replacing `META·LAB→PecanRev` / `META·SIFT→Screening`; re-runs are no-ops; never creates/deletes. (Verified live on the dev DB.) Note: the screening module's own `maintenanceMessage` SiteSetting (if an admin saved an old value) is not migrated by this script — re-set it in Ops if needed; fresh defaults are PecanRev/Screening.

## Tests / checks run
`npm run build` ✅ · `npm run test:ci` ✅ (1543 unit + screening-unit). Migration script run twice (update → idempotent no-op) ✅. `graphify update .` ✅. Final residual sweep: zero user-facing old-brand strings remain in shipped code; remaining `META·` occurrences are code comments, kept identifiers, the migration's own search literals, and dev smoke-script labels.

## OPERATOR — set OUTSIDE the repo
**Hosting env (`server/.env`):**
- `APP_BASE_URL=https://pecanrev.com` (required — email links + CORS fallback)
- `CORS_ORIGIN=https://pecanrev.com` (set if frontend origin differs from APP_BASE_URL)
- `NODE_ENV=production` (required — enables Secure cookies + strict rate limiting)
- `JWT_SECRET=<64-byte random hex>` (required)
- `DATABASE_URL=postgresql://…` (prod), `ADMIN_EMAIL_1/2`, `ADMIN_SEED_PASSWORD`, `TRUST_PROXY` (match your proxy)
- Email (to actually send verify/reset/invite): `SMTP_HOST`, `EMAIL_FROM="PecanRev <no-reply@pecanrev.com>"` (both required to enable sending), `SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`.
- Root `.env`: `APP_BASE_URL=https://pecanrev.com`.

**External steps:**
- **DNS + TLS:** point `pecanrev.com` (and `www`) at the host; HTTPS is mandatory (Secure cookies + https APP_BASE_URL).
- **Email sender-domain auth for pecanrev.com:** verify the domain with your provider and publish **SPF + DKIM + DMARC** DNS records so mail from `no-reply@pecanrev.com` passes auth.
- **Reverse proxy:** forward `X-Forwarded-For`/`X-Forwarded-Proto`; align `TRUST_PROXY`.
- **Run the DB migration** once against prod (above) if it predates the rebrand.
- **OAuth: none required** — the app uses email/password + JWT cookie auth only (no third-party OAuth / Supabase / social providers), so there are no callback URLs or consent-screen domains to update.

## Remaining (intentional) / next steps
- Code comments/docstrings still mention META·LAB/META·SIFT historically (developer-facing; not user-visible) — left to avoid churn/risk.
- `dist/` is rebuilt; deploy serves `public/` assets (favicon/manifest/robots) from root (Vite default `publicDir`).
- A future option: thread `appSettings.appName` into the few remaining hardcoded frontend wordmarks so the brand is 100% Ops-configurable (currently hardcoded to "PecanRev").
