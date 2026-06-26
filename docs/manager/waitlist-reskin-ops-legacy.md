# Waitlist re-skin · Ops legacy-only · Waitlist "not working" diagnosis

Three requests, one change-set.

## 1. Waitlist page re-skinned to `Design/waitlist`

The public Beta Waitlist page now matches the reference mock (`Design/waitlist/code.html`):
centered hero, vivid **indigo** accent (`#493ee5`), squiggle-underlined "evidence
synthesis", the reference's inline email-capture pill, and a floating
"teams registered" queue card.

- The required **questionnaire is preserved**. The reference is a single email field;
  the 4-step flow (email → about → work → review) is kept *behind* the email pill, so
  the first impression matches the example exactly while we still collect the required
  country + consent + 7 questionnaire answers (54.md / WhatToCollectFromUsers.docx).
  The hero + queue card show only on the first (email) step; once the visitor engages,
  the questionnaire card takes over.
- The indigo accent lives in a page-local palette (`src/frontend/pages/waitlist/waitlistTheme.js`),
  **not** the global Stitch brand token — the rest of the app is unaffected.
- The queue card shows the **real** signup count (or hides when unavailable). No
  fabricated "2,841" — honesty rules intact.

New public endpoint: `GET /api/waitlist/count` → `{ count: <int|null> }`. Own lenient
rate-limiter (240/15min prod) so a normal page load never spends the strict submit
budget; any failure returns `{ count: null }` and the card simply hides.

Files: `BetaWaitlistPage.jsx`, `WaitlistFlow.jsx`, `waitlistTheme.js` (new),
`waitlistApi.js`, `fields.jsx` (export reuse); server `waitlistController.js`,
`waitlistService.js`, `waitlistRepository.js`, `index.js`.

## 2. Ops Console is legacy-only (Stitch removed)

`/ops` now always renders the **legacy** `AdminConsole`, even for an admin whose global
preference is the Stitch design.

- `src/App.jsx` — `/ops` no longer pairs a `stitch=` page; it renders
  `<ForceLegacyDesign><AdminConsole/></ForceLegacyDesign>`.
- `src/frontend/design/ForceLegacyDesign.jsx` (new) — pins `data-ui-design="legacy"`
  while mounted (a `MutationObserver` re-asserts it, since the Stitch stylesheet
  re-maps even the legacy `--t-*` tokens). Restores the admin's real design on unmount.
- `StitchOpsConsole.jsx` deleted; its lazy import and SSR smoke test removed.

## 3. "Waitlist not working" — diagnosis (deployed environment)

**The current code is correct.** Verified end-to-end against a freshly-started server:
`POST /api/waitlist` → 201 + email sent (Brevo); Ops `/console`, `/beta-waitlist/*`,
`/engine-versions`, `/metrics` → all 200. So the errors on the live site are an
**under-migrated / under-configured deployment**, not a code bug.

Two independent symptoms on `pecanrev.com`:

| Symptom | Cause | Fix |
|---|---|---|
| Ops "Internal server error" on open | MAIN prod DB never got `prisma db push` after 54.md added the engine-registry tables → `/api/admin/engine-versions` threw | Run main `prisma db push` (below). Code now **degrades gracefully** — a missing table returns the in-code catalog at v0.1 instead of 500-ing. |
| Register → no email, nothing in Ops | `BETA_WAITLIST_DATABASE_URL` and/or SMTP not set on prod (submit → 503 fail-safe; admin tab → `configured:false`) | Set the env vars + push the waitlist schema (below) |

### Deployment remedy (run on the production host)

```bash
# 1) Ensure these are set (server/.env or the process environment):
#    BETA_WAITLIST_DATABASE_URL="file:./beta-waitlist.db"   # or a Postgres URL
#    SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM   # so confirmation emails send
#    (and the betaWaitlist feature flag ON, if you want the public page swapped in on /)

cd server
# 2) MAIN database — creates EngineRegistry / EngineVersionHistory / ProcessedEngineChange (54.md)
npx prisma db push
# 3) WAITLIST database — creates the BetaWaitlist* tables
npx prisma db push --schema=prisma/waitlist/schema.prisma

# 4) (optional) seed engine versions at v0.1 — cosmetic; the tab works empty too
cd .. && npm run engine-registry:seed

# 5) Restart the service so it picks up env + schema.
```

After this, the Ops console opens cleanly, registrations persist + email, and they
appear under Ops → Beta Waitlist.

## Verification

- `npm run build` ✓
- Unit suite: 2861 passed, 9 skipped (2 failures are pre-existing live-`:3001`
  integration reachability guards, unrelated).
- Live HTTP (fresh server): submit 201 + email sent; `/api/waitlist/count` real count
  (9 → 10 after a submit); engine-versions/metrics/applicants 200.
