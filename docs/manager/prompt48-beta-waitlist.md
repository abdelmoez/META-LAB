# Prompt 48 — Beta Waitlist (public landing page + isolated DB + Ops management)

**Status:** DONE. Build green; 1753 unit/CI tests green (+47 new); 7 live integration
tests green. Behind feature flag `betaWaitlist` (default **OFF** → existing landing
page is unchanged).

---

## 1. Architecture implemented

A self-contained Beta Waitlist subsystem with a **strict persistence boundary**:

```
PUBLIC                         SERVER                               ISOLATED DB
BetaWaitlistPage (lazy)  ──►  POST /api/waitlist        ──►  waitlistService ──► waitlistRepository ──► [BETA_WAITLIST_DATABASE_URL]
  WaitlistFlow (4 steps)      POST /api/waitlist/resend       (validate→dedupe→     (dedicated lazy,        BetaWaitlistApplicant
  fields.jsx (a11y)           (rate-limited, no auth)          email→record)         fail-safe client)      BetaWaitlistStatusEvent

OPS (admin only)              GET/PATCH/POST/DELETE
AdminConsole ▸ Beta Waitlist  /api/admin/beta-waitlist/*  ──►  waitlistService ──► same isolated DB
  WaitlistSection + Drawer    (requireAdmin + audit)
```

- **One source of truth for the domain:** `src/shared/betaWaitlist.js` (option lists,
  email normalization, `validateApplication()` whitelist validator, status model) is
  imported by the React form, the Ops console, AND the Express service — client +
  server never drift. The server runs `validateApplication()` as the authoritative
  check.
- **Clean module separation** (no giant files / no one-route-file): db client,
  config, repository, service, metrics, csv, rate-limit, email template, public
  controller, ops controller, public form components, ops section.

## 2. New routes and APIs

Public (no auth, rate-limited via `waitlistLimiter`):
- `POST /api/waitlist` — submit application (honeypot, idempotent dedupe).
- `POST /api/waitlist/resend` — resend confirmation (anti-enumeration, rate-limited).

Ops (all `requireAdmin`, audited):
- `GET /api/admin/beta-waitlist/metrics`
- `GET /api/admin/beta-waitlist/applicants` (search/filter/sort/paginate)
- `GET /api/admin/beta-waitlist/applicants/:id`
- `PATCH /api/admin/beta-waitlist/applicants/:id/status`
- `PATCH /api/admin/beta-waitlist/applicants/:id/notes`
- `POST /api/admin/beta-waitlist/applicants/:id/resend`
- `DELETE /api/admin/beta-waitlist/applicants/:id`
- `GET /api/admin/beta-waitlist/export` (CSV)

Frontend routes: `/` is wrapped in `BetaWaitlistGate`; `/beta-waitlist` is a
noindex preview.

## 3. Dedicated waitlist database structure

`server/prisma/waitlist/schema.prisma` (provider sqlite, `env("BETA_WAITLIST_DATABASE_URL")`,
generator output `../generated/waitlist-client`):

- `BetaWaitlistApplicant` — id (uuid), email, **normalizedEmail @unique**, first/last
  name, institutionName (+ optional institutionRorId), role (+ customRole), countryCode,
  countryName, researchExperienceLevel, annualReviewVolume, workingStyle, teamSize,
  areasOfInterest (JSON), primaryUse, referralSource (+ referralOther), message,
  consent + consentVersion + consentAt, status, submissionSource, confirmationEmail
  status/sentAt/error/attempts + lastConfirmationAttemptAt, internalNotes,
  invitedAt/acceptedAt/removedAt, createdAt, updatedAt. Indexes on status, createdAt,
  countryCode, role, confirmationEmailStatus.
- `BetaWaitlistStatusEvent` — append-only status history (fromStatus, toStatus,
  changedBy [opaque admin id — **no cross-DB FK**], note, createdAt).

Status model: `WAITLISTED | UNDER_REVIEW | INVITED | ACCEPTED | DECLINED | REMOVED`.

## 4. Database isolation proof

- Separate SQLite file (`dev.db` vs `beta-waitlist.db`) + dedicated env var.
- Separate **generated Prisma client** (`prisma/generated/waitlist-client`) — a
  different package than `@prisma/client`. Application code uses `server/db/client.js`;
  only waitlist code uses `server/waitlist/waitlistClient.js`.
- **No waitlist module imports the main client or `@prisma/client`** — enforced by a
  source-level unit test (`tests/unit/waitlist-isolation.test.js`).
- **No cross-DB foreign keys** (`changedBy` is an opaque string).
- **Fail-safe:** if `BETA_WAITLIST_DATABASE_URL` is unset, every entry point returns a
  typed failure and the submit endpoint returns 503 — it NEVER falls back to the user
  DB. Verified by integration test "does NOT create a user account or allow login".

## 5. Feature-toggle behavior

`betaWaitlist` flag (in the `featureFlags` SiteSetting; default OFF). Toggle from
**Ops ▸ Flags ▸ "Beta Waitlist Landing Page"** (admin only; persistent; no redeploy).
- ON: unauthenticated `/` → Beta Waitlist page. Authenticated users + login/register
  routes are unaffected (never trapped).
- OFF: `/` → existing PecanRev `Landing.jsx` (untouched — preserved).
- Preview at `/beta-waitlist` (renders regardless of flag, noindex).

## 6. Public waitlist flow

Step 1 Email → Step 2 About you (first/last name, institution, role[+custom], country,
primary use; optional experience, annual volume, working style[+team size], interests
multi-select, referral[+other], message) → Step 3 Review + **consent (not pre-checked)** +
privacy link → Step 4 honest confirmation. No invented queue position/date/access claim;
a delayed email never reads as a failed submission.

## 7. Confirmation email behavior

`renderBetaWaitlistConfirmationEmail()` (reuses the existing PecanRev email infra +
configured sender). HTML + plain-text; greets by name (HTML-escaped); explains PecanRev;
**explicitly states it is a waitlist confirmation — not an account or beta invitation**;
no password/login/onboarding link. Delivery tracked as pending/sent/failed/skipped;
failures store a SAFE redacted reason (never SMTP errors). Email failure never deletes
the record; Ops surfaces failed status + a resend action.

## 8. Ops Console functionality

Admin-only "Beta Waitlist" tab: real-data metric cards (total / today / 7d / 30d / emails
sent / failures), by-status counts, top roles/institutions/countries/interests, 30-day
trend; applicant table with search + status/role/country/email-status/**date** filters,
sortable columns, pagination; detail drawer (all fields, consent, metadata, status
history, internal notes editor); actions: change status (+note), edit notes, resend,
export filtered CSV, remove (confirm-gated). Empty data → clean empty state. All mutations
audit-logged (`AdminAuditLog`).

## 9. Security protections

Server-side authz (`requireAdmin`, DB-verified); mass-assignment prevented (whitelist
validator; status/notes/timestamps server-owned); CSV formula-injection neutralization +
quoting; XSS-escaped email; honeypot + rate limits (per-IP submit/resend + per-email +
60s persisted cooldown); anti-enumeration resend; redacted DB target + safe errors in
logs; no PII in logs/metadata/URLs; list endpoint returns summary fields only (no message/
notes).

## 10. Accessibility work

Real `<label htmlFor>` on every field; required marker not color-only (aria-hidden `*` +
visually-hidden "(required)" + `aria-required`); `role="alert"` field errors wired via
`aria-describedby`/`aria-invalid`; `aria-live` status region announcing step changes +
submission result; focus-first-invalid-field; semantic stepper (`aria-current`); native
selects; status badges carry text (no color-alone); `prefers-reduced-motion` respected;
44px+ touch targets on the public form. Ops: table rows keyboard-activable (Enter/Space)
with a visible focus ring; detail drawer moves focus in, traps Tab, restores focus out,
and closes on Esc.

## 11. Tests added

Unit (`tests/unit/`, run by `npm run test:ci`, 47 tests): validation/normalization/mass-
assignment, CSV escaping + formula injection, metrics aggregation, rate-limit + cooldown,
**source-level DB isolation**, email template. Integration (`tests/integration/
api-waitlist.test.js`, 7 tests, live-server skip-if-down): submit/dedupe/invalid,
no-user-created, honeypot, resend, unauthenticated 401, normal-user 403, full admin
lifecycle (metrics/list/search/detail/status/export/delete).

## 12. Exact commands executed

```
cd server && npx prisma generate --schema=prisma/waitlist/schema.prisma
cd server && npx prisma db push  --schema=prisma/waitlist/schema.prisma
npm run build
npm run test:ci
npx vitest run tests/unit/waitlist-*.test.js
ADMIN_EMAIL_1=… ADMIN_SEED_PASSWORD=… npx vitest run tests/integration/api-waitlist.test.js   # live server
```

## 13. Test and build results

`vite build` ✓ (new chunks `BetaWaitlistPage`, shared `betaWaitlist`). `test:ci` → **1753
passed** (106 files). Waitlist unit → **47 passed**. Live integration → **7 passed**.

## 14. Environment variables required

- `BETA_WAITLIST_DATABASE_URL` (required for the feature; e.g. `file:./beta-waitlist.db`
  in dev). If the flag is ON but this is unset, submissions fail safe (503).
- `WAITLIST_SUPPORT_EMAIL` (optional; shown in the confirmation email).
- Reuses existing: `SMTP_*`, `EMAIL_FROM`, `APP_BASE_URL`.

## 15. Migration & deployment instructions

Local/staging/prod (from `server/`):
```
npx prisma generate --schema=prisma/waitlist/schema.prisma
npx prisma db push  --schema=prisma/waitlist/schema.prisma
```
Add the second `db push` to the VPS deploy script after the main one. The generated
client and the `*.db` files are gitignored (regenerated per environment, same convention
as the main client). **Backups:** back up the `beta-waitlist.db` file (or the dedicated
DB instance) separately from the main DB. **Rollback:** the feature flag is the kill
switch — turn `betaWaitlist` OFF in Ops to instantly restore the standard landing page;
the schema/tables are additive and isolated, so removing them never affects the user DB.

## 16. Files created

Shared: `src/shared/betaWaitlist.js`.
Server: `server/prisma/waitlist/schema.prisma`, `server/waitlist/{config,waitlistClient,
waitlistRepository,waitlistService,metrics,csv,rateLimit}.js`,
`server/controllers/{waitlistController,waitlistAdminController}.js`,
`server/routes/waitlist.js`.
Frontend: `src/frontend/pages/waitlist/{BetaWaitlistPage,WaitlistFlow}.jsx`,
`src/frontend/pages/waitlist/{fields.jsx,waitlistApi.js}`,
`src/frontend/components/BetaWaitlistGate.jsx`.
Tests: `tests/unit/waitlist-{validation,csv,metrics,ratelimit,isolation,email-template}.test.js`,
`tests/integration/api-waitlist.test.js`. Docs: this file.

## 17. Files modified

`server/services/emailService.js` (+ template), `server/index.js` (mount + limiter +
startup check), `server/routes/admin.js` (ops routes), `server/controllers/
adminController.js` (console section), `server/controllers/settingsController.js` (flag),
`server/.env.example`, `.gitignore`, `src/App.jsx` (gate + preview route),
`src/frontend/pages/admin/AdminConsole.jsx` (nav + FLAG_META + WaitlistSection/Drawer),
`src/frontend/pages/admin/adminApiClient.js` (betaWaitlist namespace + qs helper).

## 18. Remaining limitations

- DB isolation is proven structurally (import boundary) + behaviorally (no-user-created
  integration test). Onboarding-table isolation follows transitively (no user ⇒ no
  onboarding record) and is asserted via the login-failure proxy, not a direct row count.
- No Playwright end-to-end suite (Playwright is a devDependency but browsers aren't
  installed here); the 7 live integration tests cover most §16 scenarios. The admin
  integration block requires `ADMIN_EMAIL_1`/`ADMIN_SEED_PASSWORD` to run.
- Schema applied via `prisma db push` (repo convention) — no versioned migration folder.
- SQLite in dev/this deployment. For a Postgres deployment, point
  `BETA_WAITLIST_DATABASE_URL` at a separate database/instance and switch the waitlist
  schema provider.

## 19. Legal / privacy text requiring human review

The consent copy ("PecanRev may store the information above and contact me by email about
beta access and related updates") and the confirmation email wording are drafted to be
accurate and non-deceptive (no pre-checked consent, no access guarantee). The form links
to the existing `/terms#privacy`. **A human should confirm** the Privacy Policy covers
waitlist-applicant data (a distinct, pre-account data category) before enabling the flag
in production.

## 20. Final desktop & mobile states (description)

Desktop (≥1080px): two-column hero — left = "PecanRev Beta · Early access" badge,
headline "Help us cultivate the future of evidence synthesis." (accent on the phrase),
subtitle, three qualitative trust points; right = elevated card containing the 3-step
stepper and the current step. No fabricated metrics (the Stitch "2,841 Teams registered"
card was removed). Mobile (≤640px): the columns stack (hero above the card), padding via
`clamp()`, controls are full-width and 46px tall; the Ops table scrolls horizontally and
the detail drawer is full-width. Day + night themes both supported via design tokens.
