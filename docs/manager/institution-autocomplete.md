# Institution autocomplete & canonical matching (prompt35, v3.17.0)

Lets users find and link a **canonical institution/organization** while typing —
preventing duplicate institution records (Harvard University / harvard university /
Harvard Univ. / Harvard) — across all disciplines (universities, hospitals,
companies, institutes, government & policy bodies, independent research orgs).

## What already existed (prompt26/32) — reused, not rebuilt
- **Matching engine** `src/research-engine/institutions/institutionMatch.js`:
  `normalizeInstitution`, `institutionKey`, `institutionSimilarity`,
  `classifyInstitutionMatch`, `matchInstitution`, `groupInstitutions`, with
  confidence bands **≥0.95 auto · 0.80–0.94 review · <0.80 new**.
- `User.institutionOriginal` (exact typed text) + `User.institutionNormalized`
  (matching key); onboarding stored them; Ops already had institution analytics +
  **merge / rename / reject-duplicate** + possible-duplicate review
  (`adminController` + `server/utils/institutionStore.js`).

## What this change adds
### Backend
- **`GET /api/institutions/search?q=`** (`server/controllers/institutionController.js`,
  `server/routes/institutions.js`) — requireAuth, dedicated rate limiter
  (`institutionLimiter`, 120/15min prod), validates query length (≥2), searches the
  **local DB first** then **ROR**, merges by normalized name (ROR canonical id
  preferred), returns normalized suggestions. Never throws to the client.
- **ROR client** `server/services/rorClient.js` — queries the public ROR **v2** API
  (`https://api.ror.org/v2/organizations`, no key), short timeout (AbortController),
  in-memory TTL cache, **graceful empty-array fallback** on any failure / when
  disabled. Only the typed query is sent — no secrets/tokens/emails.
- **Institution service** `server/services/institutionService.js` —
  `buildInstitutionPatch` (pure: selection → User canonical columns, always
  preserving typed text), `resolveInstitutionInput` (custom typed name → fuzzy match
  existing: ≥0.95 auto-link, 0.80–0.94 keep-custom + **needsReview** (never merged),
  <0.80 new), `localInstitutionSuggestions` (DB-backed suggestions for search).
- **Save paths**: the onboarding engine gained an `institution` question type
  (`onboardingController.js` — `coerceInstitutionAnswer`, validateAnswer case,
  `saveInstitutionResponse`); the profile endpoint (`profileController.js`) accepts
  `{ institution, country }` and returns the canonical fields.

### Data model (additive, `prisma db push`-safe — no table reset)
New nullable `User` columns: `institutionRorId`, `institutionCanonicalName`,
`institutionCity`, `institutionCountryName`, `institutionCountryCode`,
`institutionSource` (`ror|local|custom`), `institutionMatchConfidence` (Float),
`institutionNeedsReview` (Boolean default false). The originally typed text in
`institutionOriginal` is never overwritten. No new table (kept the existing
JSON-grouping + override/rejected-pair Ops model).

### Frontend
- **`src/frontend/components/InstitutionAutocomplete.jsx`** — debounced (300 ms,
  latest-request guard), keyboard-accessible combobox/listbox, ROR/“In use” source
  badges, city·country lines, **custom typed name always allowed**, loading / no-
  results / error states that never block, clear/change, day-first themed, mobile.
- Wired into **onboarding** (`Onboarding.jsx`, the new `institution` question;
  optional + skippable) and the **profile page** (`Profile.jsx` → new
  “Institution & organization” section) via `api.institutions.search`.

### Ops/Admin
- Canonical fields surfaced read-only in the Ops user detail
  (`USER_DETAIL_SELECT` + `READONLY_USER_FIELDS`); `GET /api/admin/institutions`
  gained a `summary` (withInstitution / withoutInstitution / canonicalLinked /
  rorLinked / customUnmatched / needsReview). Existing top-institutions analytics +
  merge/rename/reject/possible-duplicates are unchanged and still apply.

### Terms/Privacy
`Terms.jsx` privacy section now states institution data use (profile, collaboration,
analytics, admin reporting) and the third-party public-registry lookup (ROR /
OpenAlex) — clarifying that only the typed query is sent and no passwords/tokens are
shared, and the typed name is preserved.

## Behavior / flow
Registration stays short (name/email/password/terms). Institution is collected in
**optional, skippable onboarding** and editable in the profile. Email-verification →
onboarding flow is unchanged. A ROR/local pick links the canonical identity; a
custom name is kept verbatim and only auto-linked when ≥0.95-confident, otherwise
flagged `needsReview` for Ops (never silently merged).

## Configuration
- `ROR_ENABLED` (default `true`; set `false` to disable ROR and use local-only).
- `ROR_API_BASE` (default `https://api.ror.org/v2/organizations`), `ROR_TIMEOUT_MS`
  (default 3500). No API key required (ROR is open data).

## Follow-up fixes (second commit)
- Local-search candidate scan is now memoized with a 30 s TTL (+ a 5000-row cap)
  and invalidated on any institution save, so rapid typeahead doesn't re-scan the
  user table per keystroke (perf/scale) while a just-saved institution still
  suggests immediately.
- Added SSR render tests for `InstitutionAutocomplete`.

## Tests
- `tests/unit/institutions/institutionService.test.js` (7) — `buildInstitutionPatch`
  + `mapRorOrganization`; `tests/unit/institution-autocomplete.test.jsx` (3) —
  component render + canonical-link indicator. Existing `institutionMatch.test.js`
  (12) still green.
- Verified live: server boots; `/api/institutions/search` is auth-gated (401
  unauth, 200 authed) and returns merged local + ROR results; profile save
  round-trips the canonical fields (typed text preserved). 1296 unit/screening
  tests green; vite build green.

## Known limitations / follow-ups
- **OpenAlex** secondary source is not yet wired (architecture supports adding it in
  `rorClient`/the controller merge). ROR is the canonical source today.
- No dedicated relational `Institution` table — canonical detail is denormalized on
  the User row + the existing JSON grouping; a relational table would enable
  institution-level pages and faster “users linked” rollups.
- Ops UI surfacing of the new `summary` counts / per-user `needsReview` filter is
  backend-ready; the AdminConsole widgets for them are a follow-up.
- The seeded `institution` onboarding question will re-interrupt existing users on
  next login (by design — skippable).
- ROR results are not yet persisted to a local cache table beyond the in-memory TTL
  cache; selected institutions are cached on the user row.
