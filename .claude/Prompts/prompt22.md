CLAUDE OPUS — MAP COUNTRY BUG, MEMBERS ORDERING, SCREENING COPY FIX, STEPPER ALIGNMENT, AND FINAL REVIEW → DATA EXTRACTION FLOW

Claude, I want you to fix a set of focused workflow and UI bugs after the Screening/Stepper update.

Do not ask me small questions.
Inspect the current implementation first.
Find the root cause.
Fix safely.
Run tests/build.
Version, commit, and push if safe.

====================================================
TASK 1 — FIX OPS WORLD MAP COUNTRY MAPPING BUG
====================================================

Problem:
In the Ops Console users map, United Arab Emirates is being shown incorrectly.

A registered user is from UAE, but the map colors Ukraine instead.

When hovering over Ukraine, the tooltip says UAE.

USA appears to work correctly.

This means the country data is being mapped to the wrong country geometry.

Expected:
- UAE should color the United Arab Emirates on the map.
- Ukraine should not be colored unless there is actually a registered user from Ukraine.
- Tooltip for UAE should appear on UAE.
- Tooltip for Ukraine should say Ukraine only if hovered and should show zero/no users unless Ukraine has users.

Investigate:
1. Country code returned by backend for UAE.
2. Whether backend returns:
   - UAE
   - AE
   - ARE
   - United Arab Emirates
3. What the map GeoJSON/TopoJSON uses:
   - ISO_A2
   - ISO_A3
   - id
   - name
   - numeric code
4. Whether the frontend is matching by array index by mistake.
5. Whether the frontend is matching UAE to Ukraine because of incorrect code normalization.
6. Whether there is a country-code lookup table bug.
7. Whether `UA` Ukraine and `AE` UAE are being confused.
8. Whether `UAE` is incorrectly handled as `UA`.

Fix requirements:
1. Use stable ISO country mapping.
2. Prefer ISO-3166 alpha-2 or alpha-3 consistently.
3. Normalize backend and frontend mapping.
4. UAE:
   - alpha-2: AE
   - alpha-3: ARE
5. Ukraine:
   - alpha-2: UA
   - alpha-3: UKR
6. Do not derive country codes by truncating country names or abbreviations.
7. Add explicit test fixture for UAE and Ukraine.
8. Confirm USA still works.
9. Confirm Unknown/Local users do not color any country.

QA:
- User from UAE colors UAE only.
- Hover UAE shows United Arab Emirates / UAE count.
- Ukraine is not colored unless Ukraine has users.
- USA still maps correctly.
- Unknown users appear in table/summary only, not on map.

====================================================
TASK 2 — MEMBERS LIST ORDERING
====================================================

Problem:
In the members list, roles are mixed together.

Expected:
Members should always be ordered like this:

1. Owner at the top
2. Leaders after owner
3. Members after leaders
4. Viewers/read-only users after members if this role exists

Add a small visual separation between groups.

Requirements:
1. Owner must always stay at the top.
2. Leaders must come after owner.
3. Members must come after leaders.
4. Keep each group sorted sensibly:
   - maybe by name
   - or by date added
   - choose what fits current UI
5. Add subtle separators or section labels:
   - Owner
   - Leaders
   - Members
   - Viewers if applicable
6. Do not make the design heavy or cluttered.
7. Preserve role badges and permissions.
8. Preserve member actions/edit buttons.
9. Owner should remain visually protected from demotion/removal by leaders/members.

QA:
- Owner always appears first.
- Leaders appear before members.
- Members appear after leaders.
- Separators are visible but subtle.
- Actions still work.
- Long names/emails do not break layout.

====================================================
TASK 3 — FIX SCREENING OVERVIEW COPY
====================================================

Problem:
In Screening Overview, this copy appears:

“Manage members in the Members tab.”

But members are now under Settings.

Expected:
Change the copy to:

“Manage members in the Settings tab.”

Or better:

“Manage members, roles, permissions, and Screening settings from Settings.”

Use the wording that best fits the UI.

Requirements:
1. Remove references to a Members tab if no separate Members tab exists.
2. Ensure all copy reflects the current workflow.
3. Search for similar outdated copy and update it.
4. Do not mention META·SIFT or linked project language.

QA:
- Screening Overview no longer says Members tab.
- Settings page contains or links to member management.
- Copy is consistent.

====================================================
TASK 4 — ALIGN STEPPER DIRECTLY UNDER SCREENING SUBMENU
====================================================

Problem:
The stepwise workflow below the Screening submenu should feel like it belongs directly to the submenu item above it.

Right now it does not feel visually connected enough.

Expected:
The stepwise workflow should be directly below the menu above it.

The step label should sit directly under the matching submenu item.

Example:

Import
Step 1

Duplicates
Step 2

Title & Abstract
Step 3

Conflicts
Step 4

Final Review
Step 5

The user should feel that each step indicator belongs to its corresponding submenu item.

Important:
The stepwise workflow is a guide only.
It should NOT be clickable.

Requirements:
1. Stepper should sit immediately below the Screening submenu.
2. Each step should align under its matching submenu item.
3. Stepper should show the step number directly under the menu label.
4. Stepper should not conflict with the submenu.
5. Stepper should preserve the same overall design/flow.
6. Stepper should visually guide the user, not act as a second navigation bar.
7. Disable click behavior on stepper items.
8. Remove pointer cursor from stepper items.
9. Remove tab/button semantics if they imply navigation.
10. Use accessible read-only progress semantics instead:
   - aria-current for current step if appropriate
   - progress/list semantics if better
11. The submenu remains the only clickable navigation.
12. Active/completed states still update based on route/project progress.
13. Responsive layout should not overlap on smaller screens.
14. If horizontal alignment is impossible on small screens, use a clean scrollable or stacked fallback.

Suggested design:
- Main submenu row: clickable tabs.
- Directly below it: small step row.
- Each step is vertically aligned with the matching tab.
- Keep spacing compact.
- Use small text:
  - Step 1
  - Step 2
  - Step 3
- Completed steps can show a check icon or accent ring.
- Active step can use app accent color.
- Pending steps muted.

Do not make it large or distracting.

QA:
- Import has Step 1 directly below it.
- Duplicates has Step 2 directly below it.
- Title & Abstract has Step 3 directly below it.
- Conflicts has Step 4 directly below it.
- Final Review has Step 5 directly below it.
- Stepper cannot be clicked.
- Submenu still works.
- Active/completed state works.
- No overlap on desktop.
- No overlap with long labels.
- Responsive behavior is acceptable.

====================================================
TASK 5 — FINAL REVIEW SHOULD DIRECT USER TO DATA EXTRACTION
====================================================

Problem:
The last step of Screening is Final Review.

After Final Review, the user should have a clear button to go to the next main project step:

Data Extraction

Expected:
In Final Review, add a clear next-step button when appropriate.

Button text could be:

“Continue to Data Extraction”

or:

“Go to Data Extraction”

Preferred:
“Continue to Data Extraction”

Placement:
- In Final Review header or bottom action area.
- Also optionally in the empty/success state when studies have been sent.
- It should feel like the same flow as the other main META·LAB workflow steps.

Behavior:
1. Clicking button takes user to Data Extraction for the same Review Project.
2. It must use the correct workspace/project ID.
3. It must not open the wrong project.
4. It should not mention META·LAB handoff.
5. If no studies are accepted/sent yet, the button can be disabled or accompanied by a warning.
6. If studies are already sent, button is active.
7. If there are pending Final Review decisions, still allow navigation but show a subtle note if needed:
   - “You can continue extraction for sent studies while remaining final-review decisions are pending.”
8. Use your judgment for best UX.

Suggested logic:
- If sentToExtractionCount > 0:
  show active “Continue to Data Extraction”
- If sentToExtractionCount === 0:
  show disabled button or helper:
  “Accept studies in Final Review before continuing to Data Extraction.”

Also consider adding the button in Screening Overview if Final Review is complete:
- “Continue to Data Extraction”

QA:
- Button appears in Final Review.
- Button goes to correct Data Extraction page.
- Button uses correct workspace/project ID.
- Button does not say META·LAB handoff.
- Button works after refresh.
- Button works with old projects.
- No wrong project navigation.

====================================================
GENERAL CLEANUP
====================================================

While fixing this, search for and remove user-facing outdated language:
- META·SIFT
- linked META·LAB
- linked META·SIFT
- linked project
- Members tab if members are now under Settings
- Full Text if the user-facing label is now Final Review

Do not change internal backend names if risky.
Internal engine naming can remain.

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:
1. UAE maps to AE/ARE and not Ukraine.
2. Ukraine maps to UA/UKR and not UAE.
3. USA still maps correctly.
4. Members list orders owner → leaders → members.
5. Screening Overview copy references Settings, not Members tab.
6. Stepper is non-clickable.
7. Stepper active state follows route.
8. Final Review shows Continue to Data Extraction button.
9. Continue button routes to correct Data Extraction page.

Manual QA:
1. Open Ops Users map.
2. Confirm UAE is colored correctly.
3. Hover UAE and confirm tooltip.
4. Confirm Ukraine is not incorrectly colored.
5. Open members list.
6. Confirm owner is top.
7. Confirm leaders are next.
8. Confirm members are below.
9. Confirm visual separation.
10. Open Screening Overview.
11. Confirm copy says Settings, not Members tab.
12. Open Screening submenu.
13. Confirm Step 1 is under Import.
14. Confirm Step 2 is under Duplicates.
15. Confirm Step 3 is under Title & Abstract.
16. Confirm Step 4 is under Conflicts.
17. Confirm Step 5 is under Final Review.
18. Try clicking the stepper and confirm it does not navigate.
19. Click submenu items and confirm they navigate normally.
20. Open Final Review.
21. Confirm Continue to Data Extraction button appears.
22. Click it and confirm correct Data Extraction page opens.
23. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After implementation and testing:

1. Decide version bump.
This is likely a patch version unless the implementation becomes larger.

2. Update version metadata.

3. Run tests.

4. Run build.

5. Commit.

Suggested commit message:
fix: correct screening stepper and ops country map

Alternative:
fix: polish screening flow and member ordering

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- .env
- raw local DB files
- junk files
- broken artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Root cause of UAE showing as Ukraine.
2. Country mapping fix.
3. Confirmation UAE/Ukraine/USA mapping works.
4. Members ordering logic.
5. Screening Overview copy change.
6. Stepper alignment changes.
7. Confirmation stepper is not clickable.
8. Final Review → Data Extraction button behavior.
9. Backend changes.
10. Frontend changes.
11. Tests added.
12. Manual QA results.
13. Build/test results.
14. Version bump and new version.
15. Commit hash.
16. Push status.
17. Known limitations.

Claude, fix the root cause, not only the UI symptom.
Make the map accurate.
Make the members list logical.
Make the Screening workflow guide clear but not clickable.
Make Final Review naturally lead to Data Extraction.