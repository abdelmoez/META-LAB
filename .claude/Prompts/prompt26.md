I want you to improve the registration flow for my META·LAB / META·SIFT app.

Goal:
Make registration short, clean, and low-friction, while still collecting the most important information. Also implement email verification support, but keep it turned OFF by default for now because the email system/SMTP is not fully configured yet. It should be possible to turn email verification ON later from the Ops/Admin settings.

This is a careful auth + frontend + ops settings task. Do not break existing login, registration, permissions, projects, META·LAB/META·SIFT linking, saved data, or backend workflows.

Context:
META·LAB / META·SIFT is a research platform for all researchers, not only healthcare users. The registration flow should feel broad, academic, modern, and simple.

Required registration fields:
1. Full name
2. Email address
3. Password
4. Confirm password
5. Terms & Privacy Policy agreement checkbox

Do NOT ask for too much during registration. Do not add phone number, address, specialty, degree, ORCID, institution, profile photo, billing info, or long research-interest forms to the registration page.

After registration, add an optional/skippable onboarding/profile setup step if feasible:
- Primary role
- Institution / organization
- Research field
- Main use case
- Country / region

This onboarding should be optional and skippable. Do not block users from entering the app because of it.

Suggested options:

Primary role:
- Student
- Researcher
- Faculty / PI
- Librarian / information specialist
- Statistician / methodologist
- Industry researcher
- Independent researcher
- Other

Research field:
- Health sciences
- Psychology
- Education
- Social sciences
- Economics / policy
- Engineering
- Computer science
- Environmental science
- Business / management
- Humanities
- Other

Main use case:
- Systematic review
- Meta-analysis
- Scoping review
- Literature review
- Evidence map
- Guideline / policy review
- Thesis / dissertation
- Research team collaboration
- Other

Registration UX:
- Keep the page visually simple and clean.
- Day-mode-first design.
- Use the current Nextly-inspired design direction.
- Large clean headings.
- Minimal text.
- Clear form labels.
- Helpful validation messages.
- Clear primary button: “Create account”
- Secondary link: “Already have an account? Sign in”
- Do not clutter the page.

Recommended registration form copy:
Headline:
“Create your research workspace”

Subtext:
“Start screening, extracting, analyzing, and exporting evidence from one clean workspace.”

Fields:
- Full name
- Email address
- Password
- Confirm password
- Terms checkbox:
  “I agree to the Terms and Privacy Policy.”

Email verification requirements:
Implement email verification support, but keep it OFF by default.

Add an Ops/Admin setting such as:
- requireEmailVerification: false

The setting should be manageable from the Ops/Admin settings page.

Behavior when requireEmailVerification is false:
- Users can register and sign in normally.
- No email verification should block access.
- If email sending is not configured, registration should still work.
- Do not show scary errors about email verification.

Behavior when requireEmailVerification is true:
- New users should be created as unverified.
- Generate a secure verification token.
- Store only a hashed token, not the raw token.
- Token should expire.
- Verification link should mark the user as verified.
- User should not be allowed full app access until verified, unless existing app logic already has a better limited-access state.
- Resend verification email should be available.
- If SMTP/email is not configured, do not crash. Show a clear admin-facing warning in Ops that email verification requires email configuration.

Important:
Since the email system is not configured yet, the default must be OFF:
requireEmailVerification = false

Ops/Admin settings should show:
- Email verification: Off/On
- Current email configured status
- Warning if trying to enable verification without SMTP configured:
  “Email verification requires SMTP/email configuration. Users may be unable to verify accounts until email is configured.”

Email system safety:
- Do not hardcode credentials.
- Do not expose SMTP secrets in the frontend.
- Use existing email utility if one exists.
- If no email utility exists, create a minimal safe abstraction.
- Email sending should not throw uncaught errors into route handlers.
- If email is not configured, registration must not 500.
- Use environment variables only:
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASS
  EMAIL_FROM
  APP_BASE_URL

Email verification data model:
Inspect the current user/auth schema first. If schema changes are needed, make only additive, safe changes.

Possible fields:
- emailVerifiedAt nullable DateTime
- emailVerificationTokenHash nullable String
- emailVerificationExpiresAt nullable DateTime

Or use an existing token/settings system if already present.

Do not run destructive migrations.
Do not reset the database.
Do not delete existing users.
Do not break existing accounts.
Do not expose raw tokens.

Security requirements:
- Hash verification tokens before storing.
- Tokens must be single-use.
- Tokens must expire.
- Use crypto-safe random token generation.
- Normalize email addresses consistently.
- Prevent duplicate email registration.
- Validate password confirmation.
- Preserve password hashing behavior.
- Do not weaken auth security.

Routes/pages to inspect and update:
- Current registration page/component
- Login page/component
- Auth routes/controllers
- User model/schema
- Ops/Admin settings page
- Existing app settings/feature flags system
- Existing email utility, if present
- Existing password reset or invite token system, if present

Implementation steps:
1. Inspect current auth/register/login implementation.
2. Inspect user schema and settings schema.
3. Inspect Ops/Admin settings implementation.
4. Inspect existing email utilities.
5. Create a short plan before editing.
6. Update registration form to required minimal fields.
7. Add validation for full name, email, password, confirm password, and terms checkbox.
8. Add optional/skippable onboarding/profile setup if feasible without disrupting the app.
9. Add email verification data fields only if needed, using safe additive migration.
10. Add requireEmailVerification setting, default false.
11. Add Ops/Admin toggle for email verification.
12. Add email configured status/warning in Ops.
13. Implement verification token generation and verification route/page.
14. Implement resend verification flow.
15. Ensure verification is enforced only when requireEmailVerification is true.
16. Ensure registration/login still works normally when requireEmailVerification is false.
17. Ensure no crash occurs if SMTP is missing.
18. Run build/tests/lint if available.
19. Report changed files and behavior.

Acceptance criteria:
- Registration only requires full name, email, password, confirm password, and Terms/Privacy agreement.
- Registration does not feel long or discouraging.
- Optional onboarding is skippable.
- Email verification support exists.
- Email verification is OFF by default.
- Ops/Admin can turn email verification ON later.
- App clearly warns admins if email verification is enabled without email configured.
- Users can register and sign in normally while email verification is OFF.
- No backend workflow is broken.
- No database reset or destructive migration occurred.
- Existing users still work.
- Auth remains secure.
- Build/tests pass if available.

Final report:
After implementation, report:
- What you inspected
- What you changed
- Registration fields now required
- Optional onboarding fields added, if any
- Email verification default status
- Where the Ops/Admin toggle is located
- What happens when email is not configured
- Schema changes, if any
- Build/test/lint results
- Any follow-up needed before turning email verification ON in production


Most important principle:
Keep registration short. Let users enter the app quickly. Collect richer research profile details only after account creation, and make those details optional.



Additional requirement: User profile data must be visible and useful in the Ops/Admin console.

Any information collected from users during registration or optional onboarding should be available in the Ops/Admin console under the Users area.

This includes:
- Full name
- Email
- Email verification status
- Account creation date
- Last active date if already tracked
- Primary role
- Institution / organization
- Research field
- Main use case
- Country / region
- Optional onboarding completion status
- Any other profile/onboarding fields added in this task

Ops/Admin Users page requirements:
- Add these fields to the user table where appropriate.
- Do not make the table overcrowded.
- Use a clean table with useful columns and expandable user detail rows or a user detail drawer/modal for less important information.
- Keep the main table focused on the most useful fields:
  - Name
  - Email
  - Role
  - Institution
  - Research field
  - Country/region
  - Email verified
  - Created date
  - Last active
- Put secondary information in a user details view.

Add filters/search in Ops Users:
- Search by name
- Search by email
- Filter by primary role
- Filter by institution
- Filter by research field
- Filter by main use case
- Filter by country/region
- Filter by email verified/unverified
- Filter by onboarding completed/not completed

Add simple analytics/graphs in Ops Users:
Show profile insights without making the console confusing.

Recommended charts:
1. Users by research field
   - bar chart or donut chart

2. Users by primary role
   - bar chart or donut chart

3. Users by country/region
   - table or map only if already supported; otherwise simple ranked table

4. Users by institution
   - ranked table of top institutions

5. Onboarding completion
   - simple percentage/card

6. Email verification status
   - verified vs unverified card/chart

Do not overbuild this.
Do not create a complex BI dashboard.
Make the Ops Users page useful, readable, and admin-friendly.

Important:
- Do not expose private sensitive information unnecessarily.
- Do not show passwords, tokens, token hashes, SMTP secrets, reset tokens, verification tokens, or any secret values.
- Do not expose raw email verification tokens.
- Keep the UI clean and safe.

Institution normalization and matching requirement:
When a user enters an institution/organization name, implement a system to avoid duplicate institutions caused by spelling differences, capitalization differences, punctuation differences, abbreviations, or small typos.

Goal:
If one user enters:
- “Harvard University”
and another enters:
- “harvard university”
- “Harvard Univ.”
- “Harvard”
- “Harvard  University”
- “HARVARD UNIVERSITY”

the app should not treat these as totally separate institutions without attempting to match them.

Implement an institution matching/normalization system.

Preferred approach:
1. Store the original user-entered institution name.
2. Also compute and store a normalized institution key.
3. Match against existing institutions using normalization and fuzzy matching.
4. If there is a strong match, link the user to the existing institution.
5. If there is no strong match, create a new institution record or institution entry.
6. If match confidence is uncertain, surface it in Ops for admin review instead of silently merging.

Institution normalization should handle:
- lowercase conversion
- trimming spaces
- collapsing multiple spaces
- removing punctuation where appropriate
- removing common suffix variations where safe:
  - university
  - univ
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
- normalizing common abbreviations:
  - univ → university
  - hosp → hospital
  - ctr → center
  - med → medical
- ignoring capitalization differences
- ignoring extra punctuation
- ignoring repeated whitespace

Fuzzy matching:
Use a safe fuzzy matching approach already available in the app if one exists. If there is already a fuzzy duplicate service for META·SIFT records, inspect whether its similarity utilities can be reused without coupling unrelated domains too tightly.

If no suitable utility exists, create a small reusable institution matching utility.

Possible methods:
- normalized exact match
- token similarity
- Levenshtein distance
- Jaro-Winkler if already available
- simple confidence score from 0 to 1

Suggested confidence behavior:
- 0.95–1.00: auto-match
- 0.80–0.94: possible match, send to Ops review
- below 0.80: create as new institution

Do not silently merge uncertain matches.
Do not destroy original user-entered names.
Do not overwrite user-entered institution text without permission.
Do not create a matching system that is impossible to audit.

Institution data model:
Inspect the current schema first.

If safe and appropriate, add an Institution model/table such as:
- id
- canonicalName
- normalizedKey
- aliases
- createdAt
- updatedAt

And link users to:
- institutionId
- institutionNameOriginal

If adding a new table is too risky for this task, implement the logic in a safe additive way using existing profile fields plus a normalized field, but document the limitation and recommend a follow-up Institution model.

Ops institution management:
Add an Ops/Admin section or subsection under Users for institution management.

It should show:
- canonical institution name
- number of users linked
- aliases/original names seen
- possible duplicate institutions
- fuzzy match confidence
- option for admin to merge institutions if safe
- option to rename canonical institution
- option to reject suggested match

Do not make institution merging destructive.
If merging is implemented:
- preserve aliases
- preserve original submitted names
- update linked users safely
- add audit log if audit logging exists
- allow clear reporting of what changed

Institution analytics in Ops:
Show:
- top institutions by user count
- number of unique normalized institutions
- possible duplicates needing review
- new institutions added recently

Registration/onboarding behavior:
When a user enters an institution during optional onboarding:
- save the original text
- normalize it
- check for existing institution match
- link to existing institution if high confidence
- otherwise create new or mark for review depending on confidence
- do not block onboarding if institution matching fails
- do not crash registration if matching fails

UX:
For users, keep it simple.
Do not make the user choose from a complicated institution system during registration.
If feasible, offer autocomplete suggestions based on existing institutions, but do not require it.
The user should still be able to type their institution freely.

Ops UX:
For admins, make the institution system powerful but understandable.
Use:
- tables for detailed institution/user data
- simple charts/cards for summaries
- badges for match confidence
- clear “Needs review” status for uncertain matches

Testing:
Add tests if the project has a test setup.

Test institution normalization examples:
- “Harvard University” equals “harvard university”
- “Harvard Univ.” strongly matches “Harvard University”
- “King Saud University” matches “king saud univ”
- extra spaces should not create a new institution
- punctuation differences should not create a new institution
- uncertain matches should not auto-merge
- original institution text should be preserved

Acceptance criteria:
- User registration remains short.
- Optional onboarding remains skippable.
- All collected user profile fields are visible in Ops/Admin under Users.
- Ops Users table is useful but not overcrowded.
- Ops has filters/search for profile fields.
- Ops has simple charts/tables summarizing user profile data.
- Institution names are normalized.
- Similar institution names are matched when confidence is high.
- Uncertain institution matches are sent to admin review instead of being silently merged.
- Original user-entered institution names are preserved.
- Institution duplicates can be reviewed in Ops.
- No secrets/tokens are exposed.
- Registration does not fail if email is not configured.
- Email verification remains OFF by default unless enabled in Ops.
- Backend/database changes are additive and safe only.
- Existing users and projects are not broken.