CLAUDE MAX / OPUS WORKFLOW — NUMERIC PRECISION, ACTIVE USER METRICS, AND DATA EXTRACTION ARTICLE ORDERING

Claude, I want you to treat this as a validation and usability correction task.

Important update:
Fable is no longer available.
Use Opus as the highest-level reasoning model/agent now.

Workflow:
- Opus is the lead architect, reasoning model, statistical validation lead, and final decision-maker.
- Opus should assign straightforward implementation tasks to Sonnet.
- Sonnet should handle direct code edits, UI work, tests, documentation updates, and repetitive implementation.
- Opus should handle numerical/statistical validation, edge cases, architecture decisions, QA acceptance, version bump judgment, commit, and push.

Do not ask me small questions.
Inspect the app first, decide the safest approach, implement, test, document, version, commit, and push if possible.

Do not break existing calculations.
Do not change the actual underlying mathematical results unless you find a real calculation bug.
This task is mainly about **display precision/output formatting**, not changing the core meta-analysis math.

====================================================
TASK 1 — FIX META·LAB NUMERIC OUTPUT PRECISION
====================================================

After validation against R metafor, I found that META·LAB outputs only 2 digits after the decimal point and rounds the numbers.

Example validation table:

Dataset (measure) | Model | META·LAB (95% CI) | metafor (95% CI) | Difference
Gu (RR) | random | 0.62 (0.34, 1.11) | 0.616 (0.342, 1.110) | 0.004
Gu (RR) | fixed | 0.79 (0.60, 1.06) | 0.794 (0.597, 1.058) | -0.004
Li (SMD) | random | 0.61 (0.18, 1.05) | 0.614 (0.176, 1.051) | -0.004
Li (SMD) | fixed | 0.50 (0.32, 0.68) | 0.496 (0.317, 0.676) | 0.004
Liu (MD) | random | 14.50 (9.15, 19.86) | 14.50 (9.15, 19.86) | 0.00
Liu (MD) | fixed | 16.92 (15.81, 18.03) | 16.92 (15.81, 18.03) | 0.00
Zhou (OR) | random | 0.50 (0.36, 0.69) | 0.501 (0.361, 0.694) | -0.001
Zhou (OR) | fixed | 0.50 (0.36, 0.69) | 0.501 (0.361, 0.694) | -0.001
Zhang (OR) | random | 1.02 (0.50, 2.05) | 1.015 (0.503, 2.049) | 0.005
Zhang (OR) | fixed | 0.88 (0.66, 1.18) | 0.879 (0.656, 1.178) | 0.001
Samuel (HR) | random | 0.98 (0.79, 1.21) | 0.977 (0.794, 1.204) | 0.003
Samuel (HR) | fixed | 0.98 (0.79, 1.21) | 0.977 (0.794, 1.204) | 0.003

Problem:
META·LAB is rounding to 2 decimals in many displayed outputs.
This makes validation against metafor look less precise and may hide small but important differences.

Expected:
1. Default output should show 3 digits after the decimal point.
2. User/researcher should have an option to show more decimals if needed.
3. This should apply consistently across relevant META·LAB outputs.
4. This should not alter the underlying stored/calculated values.
5. This should only affect display/export precision unless an export explicitly asks for raw/full precision.

Default:
- Use 3 decimal places by default for effect estimates and confidence intervals.
- Example:
  - 0.616 (0.342, 1.110)
  - 0.794 (0.597, 1.058)
  - 1.015 (0.503, 2.049)

User option:
Add a precision setting:
- default: 3 decimals
- options: 2, 3, 4, 5, 6 decimals
- optional “full precision” for CSV/JSON/export if feasible

Where the setting should live:
Choose the best UX after inspecting the app. Likely locations:
1. Analysis settings panel
2. Project settings
3. Export dialog
4. User preferences
5. Ops default setting

Preferred behavior:
- Project-level precision setting for analysis/report display.
- Export dialog can override precision for a specific export.
- If no project setting exists, default to 3 decimals.
- Do not force every user globally unless a global default is useful.

Apply precision formatting to:
- pooled effect estimates
- 95% CI lower/upper
- prediction interval if shown
- forest plot labels
- forest plot table values
- funnel plot labels/tooltips if applicable
- heterogeneity outputs where relevant:
  - tau²
  - I²
  - Q
  - p-values
- Egger test outputs:
  - intercept
  - t
  - p
- trim-and-fill outputs
- leave-one-out outputs
- subgroup outputs
- sensitivity analysis outputs
- data extraction calculated effect-size display
- report/export tables
- downloadable figure labels if applicable

Important distinction:
Not every number should use the same precision blindly.

Recommended:
- Effect estimates and CI: default 3 decimals.
- p-values:
  - 3 decimals by default
  - if p < 0.001, show “<0.001” unless full precision selected
- I²:
  - maybe 1 decimal or project precision, use your judgment
- counts:
  - no decimals
- percentages:
  - 1 decimal or project precision, use your judgment
- weights:
  - 1 or 2 decimals may be fine unless user chooses more
- raw data counts:
  - no decimals
- MD with naturally larger values:
  - still default 3 decimals unless user chooses fewer, but avoid ugly unnecessary precision if value is exact; use your judgment.

I want you to think carefully here:
There should be a professional precision formatting system, not random toFixed(2) scattered everywhere.

Implementation guidance:
1. Search for all usages of:
   - toFixed(2)
   - toPrecision
   - Math.round
   - formatNumber
   - formatEffect
   - CI formatting
   - p-value formatting
2. Create or improve a centralized formatting utility.
3. Avoid many scattered hardcoded decimals.
4. Keep raw numeric values stored at full precision.
5. Use display formatting only at the UI/export layer.
6. Update both:
   - src/research-engine/statistics/meta-analysis.js if needed for returned display fields
   - UI files/components
   - meta-lab-3-patched.jsx if the UI has an identical copy
7. Avoid changing math functions unless they are currently rounding internally. If math functions round internally, fix them to return full precision numbers.

Validation:
Use the validation examples above and confirm META·LAB displays:
- Gu RR random approximately 0.616 (0.342, 1.110)
- Gu RR fixed approximately 0.794 (0.597, 1.058)
- Li SMD random approximately 0.614 (0.176, 1.051)
- Li SMD fixed approximately 0.496 (0.317, 0.676)
- Zhou OR random/fixed approximately 0.501 (0.361, 0.694)
- Zhang OR random approximately 1.015 (0.503, 2.049)
- Samuel HR random/fixed approximately 0.977 (0.794, 1.204)

If the underlying calculation gives 14.50 and metafor shows 14.50:
- It can display 14.500 if project precision is 3, or you may choose smart trailing-zero behavior.
- I want your opinion here.
- For validation tables, fixed decimals are useful.
- For publication display, smart formatting can be nicer.
- Decide the best UX, but allow strict fixed decimals for validation/export.

Add UI option:
- “Decimal places”
- 2 / 3 / 4 / 5 / 6
- optional toggle:
  - “Keep trailing zeros”
  - useful for validation tables and journal-style output

====================================================
TASK 2 — UNIQUE LOGIN METRIC SHOULD BECOME ACTIVE USER METRIC
====================================================

Current issue:
Unique logins count only users who actually logged in.
But if a user is already logged in and comes back to the website today, they should also be counted.

Better metric:
Unique active users, not just unique logins.

Expected:
Ops console should count any user who is active on the website during the period, including:
1. user logs in
2. user already has active session and opens the website today
3. user loads the app
4. user performs authenticated activity
5. user opens a project
6. user screens/imports/exports/saves/sends messages/etc.

Metrics:
- unique active users in past 24 hours
- past week
- past month
- past quarter
- past year

Important:
This should count unique users, not events.
If the same user visits 20 times today, count as 1 active user for today.

Backend requirements:
1. Track activity events or update lastActiveAt.
2. Prefer an ActivityEvent/UsageEvent table if already present.
3. Event type could be:
   - USER_ACTIVE
   - SESSION_ACTIVE
   - APP_OPENED
   - AUTHENTICATED_REQUEST
4. Do not write to database on every tiny request if it causes spam.
5. Use throttling/debouncing:
   - update activity at most once every 5–15 minutes per user
   - choose a sensible value
6. Count distinct userId in each period.
7. Login events can remain as a separate metric:
   - unique logins
   - unique active users
8. Rename UI carefully:
   - “Unique active users” is more accurate than “Unique logins”
9. Existing login metrics should not be destroyed unless replaced intentionally.

Frontend:
1. When authenticated app loads, call an activity/heartbeat endpoint or rely on /auth/me update.
2. If user returns with existing session, count them active.
3. Do not spam server.
4. Ops overview should show unique active users for:
   - 24h
   - week
   - month
   - quarter
   - year

QA:
1. User logs in → counted active.
2. User logs out/in again same day → still counted once.
3. User with existing session opens app tomorrow → counted active tomorrow.
4. Same user repeated activity → still unique count 1.
5. Two users active → count 2.
6. Ops metric updates.

====================================================
TASK 3 — DATA EXTRACTION ARTICLE ORDERING
====================================================

Current request:
In Data Extraction, the user should be able to change the order of articles/studies if they want.

Expected:
The list of articles in Data Extraction should support user-controlled ordering.

Use cases:
- put studies in publication year order
- put important studies first
- match order used in manuscript table
- group by outcome
- group by study design
- custom ordering for export/report

Requirements:
1. Add ordering controls to Data Extraction study/article list.
2. Support at least:
   - manual custom order
   - title A–Z
   - year ascending
   - year descending
   - author A–Z
   - recently added
   - recently modified
3. Manual custom order should persist in the project if feasible.
4. Drag-and-drop ordering is ideal if practical.
5. If drag-and-drop is risky, add move up/down controls first.
6. The selected order should affect:
   - visible Data Extraction list
   - exported extraction table if user chooses current/custom order
   - report tables if applicable
7. Do not change underlying study IDs.
8. Do not break extraction data.
9. If multiple users are editing, handle order changes safely.
10. Audit manual reorder if audit system exists.

Backend:
1. Add order/index field if missing:
   - extractionOrder
   - displayOrder
   - sortIndex
2. Save custom order per project.
3. Add endpoint to update order:
   - PATCH /api/projects/:projectId/extraction/order
   or existing appropriate route.
4. Validate user has permission to edit data extraction.
5. Viewer/read-only cannot reorder if reorder affects saved project state.
6. If viewer changes local sort only, it should not persist.

Frontend:
1. Add sort dropdown.
2. Add manual reorder mode.
3. Add drag handle or move up/down buttons.
4. Show “Custom order saved” or save state.
5. Allow reset to default order if useful.
6. Preserve current filters/search if possible.

QA:
1. Sort by title.
2. Sort by year ascending/descending.
3. Manually reorder studies.
4. Refresh page.
5. Confirm custom order persists.
6. Export table and confirm selected/custom order is used.
7. Viewer cannot persist reorder.
8. Data extraction values remain attached to correct study.

====================================================
TASK 4 — METHODS/DOCS UPDATE
====================================================

Update docs and Methods/Equations if needed:

1. Numeric precision:
   - explain display precision setting
   - clarify calculations use full precision internally
   - clarify rounding is display/export only

2. Ops metrics:
   - define unique active users
   - distinguish from unique logins if both are shown

3. Data extraction ordering:
   - document custom order behavior if user-facing docs exist

====================================================
TESTING REQUIREMENTS
====================================================

Opus should validate numeric formatting and statistical display behavior.
Sonnet should implement and write tests.
Opus should approve final QA.

Unit tests:
1. formatting utility returns 3 decimals by default.
2. formatting utility supports 2–6 decimals.
3. optional trailing zeros behavior works.
4. p-value formatting works.
5. raw numeric values are not mutated/rounded.
6. active user metric counts unique users.
7. repeated activity by same user counts once.
8. data extraction ordering persists.

Integration tests:
1. Run meta-analysis and display 3 decimals.
2. Change precision to 4 decimals and confirm display updates.
3. Export with selected precision.
4. Active user counted when app opened with existing session.
5. Manual reorder persists after reload.
6. Export respects selected/custom order.

Manual QA:
1. Use validation table datasets if available.
2. Confirm displayed META·LAB values match metafor precision to 3 decimals.
3. Confirm default is 3 decimals.
4. Confirm researcher can choose more decimals.
5. Confirm unique active users metric works for logged-in returning users.
6. Confirm Data Extraction ordering works and does not detach data from studies.

Do not mark complete if:
- values are still forced to 2 decimals
- underlying calculations are rounded internally
- project reload loses precision setting
- active users only counts login events
- data extraction reorder corrupts study data
- build/tests fail

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.

Rules:
- Patch:
  third number
  for small fixes
- Minor:
  second number
  for meaningful feature/system addition
- Major:
  first number
  for major overhaul

This task includes a validation-facing precision fix, ops metric improvement, and data extraction ordering. Use your judgment.

2. Update version metadata.
3. Run tests.
4. Run build.
5. Commit.

Suggested commit message:
fix: improve numeric precision and active user metrics

or if Data Extraction ordering is substantial:
feat: add analysis precision controls and extraction ordering

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- .env with credentials
- local database files
- junk files

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Where 2-decimal rounding was found.
2. How numeric precision is now handled.
3. Whether calculations were rounded internally or only display was rounded.
4. Default decimal setting.
5. How researchers can choose more decimals.
6. Validation against the metafor examples.
7. How unique active users are counted.
8. How activity tracking avoids DB spam.
9. How Data Extraction ordering works.
10. Backend changes.
11. Frontend changes.
12. Database changes/migrations.
13. Tests added.
14. Manual QA results.
15. Build/test results.
16. Version bump and new version.
17. Commit hash.
18. Push status.
19. Known limitations.
20. Recommended next improvements.

Do not return until implemented, tested, versioned, committed, and pushed if possible.