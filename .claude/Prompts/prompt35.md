I want you to implement an institution autocomplete and canonical institution matching system in my META·LAB / META·SIFT app.

Very important workflow instruction:
After you complete the implementation and verify it, you must:

1. Run build/lint/tests if available.
2. Commit the completed work.
3. Push to main.
4. Then review your own final report for limitations, risks, TODOs, and recommendations.
5. Address and solve as many of those limitations/recommendations as safely possible.
6. Run build/lint/tests again.
7. Commit the follow-up fixes.
8. Push to main again.

Do not skip commit and push unless there is a real blocking error. If commit or push fails, report the exact reason.

====================================================
GOAL
====================================================

When users enter their institution/organization during registration onboarding or profile setup, I want the app to show matching institution suggestions as they type.

This should prevent the same institution from being saved multiple different ways, such as:

- Harvard University
- harvard university
- Harvard Univ.
- HARVARD UNIVERSITY
- Harvard

The app should connect users to a canonical institution record whenever possible.

The system should be useful for:
- cleaner user profiles
- better Ops/Admin analytics
- institution-level statistics
- avoiding duplicate institution names
- future organization/team features

This app is for all researchers, not just healthcare researchers, so the institution system should support universities, research centers, companies, institutes, hospitals, policy organizations, government research bodies, and independent research organizations.

====================================================
SAFETY RULES
====================================================

Do not break:
- authentication
- registration
- onboarding
- login
- email verification
- user profile saving
- project creation
- project permissions
- Ops/Admin console
- existing user data
- existing projects
- META·LAB/META·SIFT linking
- screening
- Risk of Bias
- data extraction
- meta-analysis
- PRISMA
- exports

Do not:
- reset or wipe the database
- run destructive migrations
- commit secrets
- commit `.env`
- expose API keys
- expose private tokens
- expose password hashes
- expose verification/reset tokens
- make registration fail if institution search fails
- force users to select an institution if their institution is not found
- silently merge uncertain institution matches

Use safe additive changes only.

====================================================
BEFORE CODING
====================================================

First inspect:

1. Current registration flow.
2. Current optional onboarding/profile setup page.
3. Current user/profile schema.
4. Existing institution/organization fields, if any.
5. Ops/Admin Users page.
6. Existing analytics for users/institutions.
7. Existing API route patterns.
8. Existing database/Prisma schema and migration setup.
9. Existing fuzzy matching utilities, especially if there is already duplicate detection logic in META·SIFT.
10. Existing input/autocomplete components.
11. Existing design system/components.
12. Existing tests.
13. Existing scripts/package.json.

Make a short implementation plan before editing.

====================================================
MAIN FEATURE — INSTITUTION AUTOCOMPLETE
====================================================

Implement an institution autocomplete field wherever users enter their institution/organization.

At minimum, use it in:
- Optional onboarding/profile setup
- User profile/settings page if institution can be edited there
- Registration-related profile completion page if applicable

Do not make the main registration form longer. Keep registration short. Institution should remain part of optional onboarding/profile setup unless the current app already asks for it elsewhere.

User experience:
- User starts typing institution name.
- After 2–3 characters, show suggestions.
- Use debounce, around 250–350 ms.
- Suggestions should show:
  - institution name
  - city if available
  - country if available
  - source if helpful
- User can select an institution.
- User can also continue with typed custom institution if not found.
- Do not block onboarding if institution lookup fails.
- Show clean loading, empty, and error states.

Example:

User types:
“King Saud Uni”

Suggestions:
- King Saud University — Riyadh, Saudi Arabia
- King Saud bin Abdulaziz University for Health Sciences — Riyadh, Saudi Arabia

If no result:
“Can’t find your institution? Continue with typed name.”

====================================================
CANONICAL INSTITUTION SOURCE
====================================================

Use ROR — Research Organization Registry — as the preferred canonical source if internet access/API usage is available.

Use ROR because it provides:
- canonical organization names
- persistent ROR IDs
- country
- location
- aliases
- external IDs where available

If ROR API is available:
- Search ROR through the backend, not directly from frontend.
- Do not expose unnecessary external details.
- Cache selected institutions locally.

If OpenAlex autocomplete is useful and easy to add safely:
- Use OpenAlex only as a secondary/fallback source.
- Do not make OpenAlex required for the first implementation.
- Prefer ROR as the canonical institution identity.

If external API access is not available in the current environment:
- Build the backend and frontend architecture so that the external search provider can be plugged in later.
- Implement local institution search and manual institution saving now.
- Document what remains needed to enable ROR.

====================================================
BACKEND API
====================================================

Add a backend endpoint such as:

GET /api/institutions/search?q=...

Requirements:
- Admin authentication is not required for normal institution search, but the endpoint should be safe and rate-limited if rate limiting exists.
- It should not expose secrets.
- It should validate query length.
- It should return an empty result for very short queries.
- It should search local cached institutions first.
- Then query ROR if configured/available.
- Return normalized suggestion objects.

Suggested response shape:

{
  "results": [
    {
      "id": "local-id-if-existing",
      "canonicalName": "Harvard University",
      "rorId": "https://ror.org/03vek6s52",
      "city": "Cambridge",
      "countryName": "United States",
      "countryCode": "US",
      "aliases": ["Harvard"],
      "source": "ror",
      "confidence": 1
    }
  ]
}

Add another endpoint if needed for saving/selecting institution:

POST /api/users/me/institution

or reuse existing profile update endpoint.

When user selects a canonical institution:
- Save institutionId on the user/profile.
- Preserve the original typed text.
- Save canonical institution details if not already in local DB.

When user enters custom institution:
- Save original text.
- Normalize it.
- Try fuzzy matching against existing institutions.
- If high confidence match exists, link to it.
- If uncertain, create or mark as needs review.
- Do not silently merge uncertain matches.

====================================================
DATA MODEL
====================================================

Inspect the current schema first.

If safe, add an Institution model/table.

Suggested model:

Institution:
- id
- canonicalName
- normalizedName
- rorId nullable unique
- openAlexId nullable
- countryName nullable
- countryCode nullable
- city nullable
- website nullable
- aliases JSON/text nullable
- source
- needsReview boolean default false
- createdAt
- updatedAt

User/Profile additions if needed:
- institutionId nullable
- institutionNameOriginal nullable
- institutionMatchConfidence nullable
- institutionNeedsReview boolean default false

If the app already has profile fields, use existing conventions.

Important:
- Store the original user-entered institution name.
- Store the canonical institution relationship separately.
- Do not overwrite the user’s original typed text.
- Do not remove existing institution strings from existing users without migration safety.

Migration:
- Add safe additive migration only.
- Do not reset database.
- Do not delete existing user data.
- Existing users should continue working.

Optional safe migration/backfill:
- Existing users with institution text can have institutionNameOriginal populated.
- Do not aggressively merge existing institutions without admin review.
- If implemented, mark uncertain existing institution matches as needs review.

====================================================
NORMALIZATION AND FUZZY MATCHING
====================================================

Create a reusable institution normalization/matching utility.

Normalization should handle:
- lowercase
- trim spaces
- collapse repeated whitespace
- remove punctuation where safe
- ignore capitalization
- normalize common abbreviations:
  - univ → university
  - inst → institute
  - hosp → hospital
  - ctr → center
  - med → medical
  - dept → department
- handle common suffix/noise terms carefully:
  - university
  - college
  - institute
  - institution
  - hospital
  - center
  - centre
  - research center
  - medical center
  - school
  - faculty
  - department

Important:
Be careful removing suffixes. Do not over-normalize so aggressively that different institutions become the same.

Fuzzy matching should use:
- exact normalized match
- alias match
- token similarity
- Levenshtein or Jaro-Winkler if already available
- existing duplicate matching utilities if appropriate

Suggested confidence thresholds:
- 0.95–1.00: auto-match
- 0.80–0.94: possible match, needs Ops/Admin review
- below 0.80: create new institution entry or save custom text as unmatched

Never silently merge uncertain matches.

Test examples:
- “Harvard University” should match “harvard university”
- “Harvard Univ.” should strongly match “Harvard University”
- “King Saud University” should match “king saud univ”
- extra spaces should not create a new institution
- punctuation differences should not create a new institution
- “University of Georgia” and “Georgia State University” should not be merged
- uncertain matches should be marked needs review
- original typed text should be preserved

====================================================
FRONTEND COMPONENT
====================================================

Create or reuse a clean component:

InstitutionAutocomplete

Requirements:
- Matches current app design.
- Day-mode-first.
- Works in dark mode if supported.
- Debounced search.
- Keyboard accessible.
- Shows loading state.
- Shows no-results state.
- Shows error state without blocking user.
- Allows custom typed value.
- Shows selected institution clearly.
- Allows clearing/changing selection.
- Does not make onboarding complicated.
- Works on mobile.

Suggested props:
- value
- selectedInstitution
- onChange
- onSelectInstitution
- placeholder
- disabled
- required false
- allowCustom true

Use this component in:
- onboarding profile setup
- profile/settings page
- any existing user institution field

====================================================
OPS / ADMIN CONSOLE INTEGRATION
====================================================

Add institution data to Ops/Admin under Users.

Ops Users page should show institution info cleanly:
Main user table columns can include:
- Name
- Email
- Role
- Institution
- Research field
- Country/region
- Created date
- Last active

Do not overcrowd the table. Put detailed institution data in a user drawer/modal if needed.

Add an Institutions section or subsection under Users if feasible.

It should show:
- canonical institution name
- number of users linked
- country
- city
- source
- aliases/original submitted names
- needs review status
- possible duplicate matches
- match confidence
- created date

Add useful Ops analytics:
- Top institutions by user count
- New institutions this month
- Institutions needing review
- Users without institution
- Custom/unmatched institutions
- Country distribution by institution if easy

Institution review tools:
If feasible, allow admins to:
- rename canonical institution
- add alias
- merge duplicate institutions
- reject suggested match
- mark institution as reviewed

If merge is implemented:
- Preserve aliases.
- Preserve original submitted names.
- Update linked users safely.
- Add audit log if audit logging exists.
- Do not make destructive merges.
- Ask for confirmation before merge.

If merge tools are too much for this task:
- At least show institutions needing review and possible duplicates.
- Document merge tools as follow-up.

Security:
- Do not expose secrets/tokens.
- Respect existing admin/mod permission boundaries.
- Normal users must not access institution analytics endpoints.

====================================================
REGISTRATION / ONBOARDING BEHAVIOR
====================================================

Keep registration short.

Do not add institution as a mandatory registration field unless it already exists as part of the current flow.

Institution should be in optional onboarding/profile setup:
- User can select from autocomplete.
- User can type custom institution.
- User can skip onboarding.
- App should save institution if provided.
- App should not fail if ROR/OpenAlex is unavailable.

If email verification is enabled:
- Registration → email verification → onboarding.
If email verification is disabled:
- Registration → onboarding.

Do not break this flow.

====================================================
TERMS / PRIVACY AND OPS IMPACT CHECKS
====================================================

If legal review and Ops impact scripts already exist, run them.

Because this feature changes profile data and uses external institution lookup, update Terms/Privacy placeholder if needed.

Privacy language should mention:
- optional institution/organization profile data
- use of institution data for profile, collaboration, analytics, and admin reporting
- possible use of third-party public institution registries like ROR/OpenAlex for institution lookup, if implemented
- no passwords/tokens are shared with institution lookup providers

Do not overstate legal certainty.

If Ops impact script exists, run it and make sure institution data is visible in Ops.

====================================================
TESTING
====================================================

If tests exist, add tests for:

Backend:
- institution normalization
- exact normalized matching
- fuzzy matching thresholds
- uncertain match marked needs review
- original typed name preserved
- institution search endpoint validates query
- local search works
- external provider failure does not break response
- user profile saves selected institution
- custom institution saves safely

Frontend:
- InstitutionAutocomplete renders
- typing triggers debounced search
- selecting a suggestion works
- custom institution works
- no-results state works
- error state does not block saving
- onboarding/profile page saves institution

Ops:
- institutions appear in admin users section
- institutions needing review show correctly
- normal users cannot access admin institution analytics

Run:
- lint if available
- typecheck if available
- tests if available
- build if available
- legal review script if available
- ops impact script if available

====================================================
ACCEPTANCE CRITERIA
====================================================

The task is complete when:

- Users can type their institution and see matching suggestions.
- ROR is used as the preferred canonical source if available.
- Institution search happens through the backend, not directly from frontend.
- Selected institutions are saved canonically.
- Original typed institution text is preserved.
- Similar spellings/capitalization do not create unnecessary duplicates.
- Uncertain matches are not silently merged.
- Users can still enter a custom institution.
- Registration remains short.
- Onboarding remains skippable.
- Institution data appears in Ops/Admin Users.
- Ops can identify top institutions and institutions needing review.
- No secrets or tokens are exposed.
- External institution lookup failure does not break onboarding or registration.
- Existing users and projects are not broken.
- Build/lint/tests pass if available.

====================================================
FINAL REPORT FORMAT
====================================================

After first implementation, report:

1. What you inspected.
2. What institution/profile fields already existed.
3. What schema changes were made, if any.
4. What backend endpoints were added or changed.
5. How ROR/OpenAlex/local search is handled.
6. How institution normalization works.
7. How fuzzy matching works.
8. How confidence thresholds work.
9. How original user-entered institution names are preserved.
10. How uncertain matches are handled.
11. What frontend components were added.
12. Where InstitutionAutocomplete was implemented.
13. What changed in onboarding/profile settings.
14. What changed in Ops/Admin.
15. What analytics/review tools were added.
16. What Terms/Privacy updates were needed, if any.
17. Tests/build/lint results.
18. Limitations.
19. Recommendations.

Then:
- Address the limitations and recommendations that can be safely solved immediately.
- Run build/lint/tests/scripts again.
- Commit and push to main again.
- Provide a final second report.

Git requirements:

First commit:
- Commit message suggestion:
  “Add institution autocomplete and canonical matching”
- Push to main.

Second commit after solving safe follow-up limitations/recommendations:
- Commit message suggestion:
  “Address follow-up QA fixes for institution matching and ops integration”
- Push to main.

Most important instruction:
Implement institution autocomplete as a clean, scalable, cross-disciplinary system using a canonical institution source such as ROR when available, preserve original user input, prevent duplicate institution records through normalization and fuzzy matching, surface uncertain matches in Ops for review, and keep onboarding simple and skippable.