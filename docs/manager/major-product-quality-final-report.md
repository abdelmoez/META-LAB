# Major product-quality update — final report (prompt32, v3.15.0)

A 12-part workflow & UX stabilisation update. Root causes were investigated (9-agent mapping workflow) and fixed; the integrated change was adversarially reviewed (5-agent review workflow). Build green; 1263 unit tests green.

## 1–3. Country detection — root cause, solution, privacy
- **Root cause:** the app is a VPS behind nginx (no Cloudflare/Vercel edge → no country header) and `geoip-lite` was never installed (only a best-effort dynamic import). So every public registration fell through to "Unknown"; older rows showed the legacy literal "Local".
- **Solution:** added `geoip-lite` as an `optionalDependency` (offline, no API key, country-level only); kept header-first order; made the Ops no-code bucket always "Unknown"; added `registrationCountryDetectedAt`; one-time warn-log on the no-source path; extended the repair script to relabel legacy "Local" → "Unknown"; documented `TRUST_PROXY` + nginx forwarding. **Live-verified:** `X-Forwarded-For: 8.8.8.8 → US`, UAE IPs → AE, `cf-ipcountry` header → AE, private IP → graceful.
- **Privacy:** country level only; raw IP never stored (optional salted hash); never exposed to the frontend; only `hit.country` read from geoip.

## 4–7. RoB workspace + back button + spacing
- Left side now has **Study PDF** (default) + **Article Information** tabs with a **persistent article header** (title/authors/journal/DOI) above the tabs; Article Info mirrors Final Review and degrades gracefully for manual studies.
- **Back-to-RoB** button moved to a top-level header above both columns.
- Two-column grid `minmax(0,1fr) clamp(380px,32vw,560px)` + responsive `padding-inline: clamp(24px,6vw,96px)`; PDF fills its column (new `previewHeight` prop, default 520 so Screening is untouched).
- Global workspace gutter → `28px clamp(20px,5vw,88px) 56px` (one shared wrapper; Screening stays full-bleed).
- Backend: `getMetaLabStudyRecord` additively returns the article `record` (no schema change).

## 8. Onboarding login-check + skip/answer logic + Ops controls
- New `OnboardingQuestion` + `UserOnboardingResponse` tables; `GET /api/onboarding/pending`, `POST /responses`, `POST /skip`. Pending = active questions minus this user's answered/skipped → **new questions reach existing users on next login**; required questions can't be skipped; legacy `onboardingCompletedAt` + 5 columns preserved (canonical answers mirror onto them). Frontend gate fires on every authenticated bootstrap (excludes /invite,/verify-email,/terms,/reset; invite precedence kept).
- Ops **Onboarding** section (admin-only): behaviour toggle + intro copy + full question CRUD (create/edit/activate/required/allowSkip/reorder/reset/delete) with answered/skipped/pending counts.
- **Live-verified:** answer/skip lifecycle; new question reappears for a completed user; required survives skip-all.

## 9. Forest plot precision export fix
- Threaded the export dialog's `choice.precision` into all three forest export `run` callbacks + the report; routed weights/I²/het through the precision helpers so live == export. Internal values stay full precision; I²/weights honour `full` only (convention preserved).

## 10. Outcomes by name
- Confirmed Analysis/Forest already group by outcome NAME (not primary/secondary). Added an "Outcome (A–Z)" extraction grouping and measure-disambiguated labels (name @ timepoint · MEASURE, only on name collision). Pooling key unchanged → safe for existing projects, no migration.

## 11. Owner delete from Project Control
- Owner-only Danger Zone in the monolith ControlTab: Archive/Unarchive + typed-name-confirmed Delete via `api.projects.confirmDelete` (owner-scoped + audit + cascades linked screening/RoB). Backend enforces owner-only independently.

## 12. Role simplification
- User-facing roles collapsed to **Owner/Leader/Reviewer/Viewer**; advanced permission matrix retained behind "Advanced permissions"; confusing "Participates in Whole project…" copy removed. `PERMISSION_PRESETS`/`ASSIGNABLE_PRESETS` kept; added `USER_ROLES`/`ROLE_TO_PRESET`/`PRESET_TO_ROLE`. Review caught + fixed a HIGH bug (Viewer mapped to a no-chat preset) and a MEDIUM (legacy presets now display their mapped role, not "Custom").

## 13. Ops RoB engine controls
- `rob_engine_v2` stays the master kill-switch. New admin **Risk of Bias** section + `robSettings` (additive SiteSetting): panels/UI, tools, workflow, export, audit toggles + engine metrics (zeros-safe). RoB UI consumes panel/tab/default-tab flags from public settings. Review caught + fixed a MEDIUM (defaultTool canonical-id casing).

## Backend / Frontend / DB changes
- **DB (additive only, db-push-safe):** `OnboardingQuestion`, `UserOnboardingResponse`, `User.registrationCountryDetectedAt`, `User.onboardingResponses`. No `@unique` on existing tables.
- **Backend:** new `onboardingController`, `robAdminController`, `routes/onboarding.js`; admin routes; `getConsole` (+rob,+onboarding); `settingsController` public exposure; `screeningController` record enrichment; `geo.js`/`countryStats.js`/`authController.js` country fixes; `repair-country-codes.js`.
- **Frontend:** Onboarding flow + gate (Onboarding/App/AuthContext/authClient); Ops sections (AdminConsole/adminApiClient); RoB workspace (RobWorkspace/RobPdfPanel/PdfViewer/robApi); roles (MembersTab/permissionPresets); monolith (padding, forest precision, outcomes labels, owner delete).

## Tests / QA / build
- New unit tests: geo (offline DB), countryStats (Unknown bucket), onboarding (pending/validate/coerce), robSettings (coerce/clamp), extractionOrder (outcome_az). **1263 unit tests green** (was 1079). `vite build` green (the `"}" not valid inside JSX` line is the pre-existing AnalysisTab warning; build exits 0). Live HTTP smoke tests verified country + onboarding end-to-end.

## Version / commit / push
- Version bumped **3.14.0 → 3.15.0**. Commit hash + push status recorded in the commit/PR.

## Known limitations / recommended next steps
- RoB Ops workflow/export/audit toggles are persisted + surfaced but not all are enforced engine-side yet (panel/tab/default-tool ARE wired). Follow-up: enforce consensus/lock/required-rationale in the RoB engine.
- Outcomes: a full canonical outcome registry (rename/merge, outcome-level isPrimary, measure in the pooling key) remains an optional follow-up.
- Onboarding `audience` targeting column is reserved (everyone sees active questions today).
- Low-severity polish from the review (tab ARIA roving-tabindex, snake_case enum display in Article Info, a few dead-code remnants) addressed in the follow-up pass.
- After deploy, validate a real registration's `registrationIpCountrySource` to confirm nginx forwards the client IP; run `node scripts/repair-country-codes.js --apply` once to clean legacy stored names.
