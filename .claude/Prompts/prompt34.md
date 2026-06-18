CLAUDE OPUS — RoB ASSESSMENT WORKSPACE REDESIGN, PDF VIEWER FIT, COLLAPSIBLE WORKFLOW MENU, PROJECT CONTROL SETTINGS, AND GRADE INTEGRATION

Claude, I want you to implement another serious product-quality update.

This is mainly about the Risk of Bias engine, the PDF viewer, the global project workflow layout, project settings, and automatic RoB → GRADE integration.

Do not treat this as a small UI patch.
Inspect the current implementation first.
Understand the layout, current RoB engine workflow, PDF viewer behavior, project settings, Screening settings, and GRADE structure.
Then implement the best professional version.

Use Opus as the lead architect.
Use Sonnet for straightforward UI changes, tests, docs, and cleanup if useful.

Do not ask me small questions.
Use your judgment.
If you think there is a better solution than my exact suggestion, explain it in the final report and implement the better product decision.

====================================================
HIGH-LEVEL GOAL
====================================================

I want the Risk of Bias assessment workspace to feel like a serious engine/workspace, not just a normal form page.

When the user enters a specific study’s Risk of Bias assessment, the page should feel focused, professional, spacious, and purpose-built.

The user should see:
- article identity clearly
- PDF properly fitted
- Risk of Bias assessment clearly
- final/next action visible without scrolling
- a clean way to go to the next workflow step
- no wasted space
- no unnecessary tabs
- no cramped sections

Also, the main app workflow menu should be collapsible across all workflow tabs, not only Screening.

====================================================
TASK 1 — PDF VIEWER SHOULD FIT WIDTH OF VIEWER
====================================================

Problem:
The PDF viewer should show the PDF file with its width fitting the viewer width.

Expected:
The PDF should fit the PDF viewer container width by default.

Requirements:
1. PDF pages should scale to the width of the viewer container.
2. Avoid horizontal overflow if possible.
3. Preserve readability.
4. Support zoom controls if already implemented.
5. Default zoom should be “fit width.”
6. If the user manually changes zoom, respect that.
7. When the viewer container resizes, the PDF should re-fit or recalculate.
8. Works in:
   - RoB assessment PDF viewer
   - Screening PDF viewer if shared component
   - any other shared PDF viewer if reused
9. Do not break Open in New Tab / Replace / Remove behavior.
10. PDF loading state and errors should remain clear.

Implementation guidance:
- Inspect existing PDF viewer library/component.
- If using react-pdf, calculate page width based on container width.
- Use ResizeObserver or equivalent to update width.
- Avoid hardcoded page width.
- Ensure high-DPI screens still look good.
- If multiple pages exist, all pages should fit the same viewer width.

QA:
1. Open RoB assessment with PDF.
2. Confirm PDF width fits viewer width.
3. Resize browser.
4. Confirm PDF adjusts.
5. Test narrow screen.
6. Test wide screen.
7. Test PDF with multiple pages.
8. Test no-PDF state.

====================================================
TASK 2 — RoB ASSESSMENT PAGE SHOULD FIT FULL DISPLAY WITHOUT SCROLLING TO NEXT BUTTON
====================================================

Problem:
When doing a Risk of Bias assessment for a study, the user has to scroll down to reach the next button / go to Meta-Analysis.

I do not want that.

Expected:
The RoB assessment workspace should fit the full display height so that:
- PDF viewer
- assessment panel
- important actions/buttons
- next workflow action

are all visible without requiring page-level scrolling.

The page can have internal scroll areas, but the main action button should stay visible.

Requirements:
1. The RoB study assessment page should use available viewport height.
2. The PDF area can scroll internally if PDF is long.
3. The assessment questions/domains can scroll internally if needed.
4. The bottom action area should be sticky or fixed inside the assessment panel.
5. User should not need to scroll the entire page to find:
   - Save
   - Complete assessment
   - Next study
   - Continue to Meta-Analysis / Continue to GRADE / Continue workflow
6. Avoid double-scroll confusion.
7. Keep the layout clean on laptop screens.
8. Works in day and night themes.
9. Works with long article titles.

Suggested layout:
- Top: RoB study header with back button and article metadata.
- Middle: two-panel workspace.
  - Left: PDF viewer.
  - Right: Risk of Bias assessment panel.
- Right panel:
  - assessment content scrolls internally
  - bottom action bar remains visible.
- Main page body should ideally not scroll except on very small screens.

QA:
1. Open RoB assessment on normal laptop height.
2. Confirm next/action button is visible without page scroll.
3. Assessment panel scrolls internally if needed.
4. PDF panel scrolls internally if needed.
5. No important controls are hidden.
6. Works after refresh/deep link.

====================================================
TASK 3 — PDF TOOLBAR SHOULD BE HIDEABLE / SHOWABLE
====================================================

Problem:
The PDF toolbar/bar takes space:

“Full-text PDF Hide preview Open in new tab Replace Remove”

I want the user to be able to hide and show this bar.

Expected:
Add a small control to collapse/expand the PDF toolbar.

Requirements:
1. PDF toolbar can be hidden.
2. PDF toolbar can be shown again.
3. When hidden, PDF viewer gains more space.
4. The control to show it again must remain visible.
5. The state can be:
   - per session
   - per user preference
   - or per project preference
   Use your judgment.
6. Do not remove Open in new tab / Replace / Remove functionality.
7. Do not make the UI confusing.
8. Tooltip should explain the control.
9. Works in RoB and anywhere else shared PDF viewer is used, if appropriate.

Possible labels:
- Hide PDF tools
- Show PDF tools
- compact icon button

Preferred:
Use a small icon button in the PDF panel header.

QA:
- Hide toolbar.
- PDF gains space.
- Show toolbar.
- Buttons work.
- Refresh behavior matches chosen persistence rule.

====================================================
TASK 4 — REMOVE ARTICLE INFORMATION TAB IN RoB ASSESSMENT
====================================================

Previously we added or discussed an Article Information tab beside the PDF.

Now I want to remove it from the RoB assessment page.

Reason:
All necessary article information should be visible above the workspace.

Expected:
Remove the Article Information tab from the RoB assessment workspace.

Instead:
Show the necessary article information in a persistent top article header above both:
- PDF viewer
- Risk of Bias assessment panel

Article header should include:
- title
- authors
- journal
- year
- DOI/PMID if available
- important links if available
- maybe short metadata chips

Do not overload it.
Long title should wrap or truncate cleanly.
Links should be accessible but not cluttered.

QA:
- No Article Information tab appears in RoB study assessment.
- Article information is visible above both panels.
- Information does not disappear when interacting with PDF/assessment.
- Long titles do not break layout.

====================================================
TASK 5 — ARTICLE HEADER SHOULD SPAN ABOVE BOTH PDF AND RoB ASSESSMENT
====================================================

Problem:
The title/authors/journal bar should not only be above the PDF side.

Expected:
The article metadata header should be above the entire RoB study workspace, spanning both:
- PDF viewer
- Risk-of-bias assessment

Suggested structure:

Back to Risk of Bias

Article Header:
Title
Authors
Journal · Year · DOI · Links

Workspace:
[ PDF Viewer ] [ Risk-of-Bias Assessment ]

Requirements:
1. Header spans across both columns.
2. Back button sits above the workspace and clearly exits the study.
3. Header does not overlap controls.
4. Header remains visually connected to the study.
5. Works with long title/authors.
6. Avoid excessive vertical height.

QA:
- Header clearly applies to both PDF and assessment.
- Right panel no longer feels disconnected.
- Back button location makes sense.

====================================================
TASK 6 — GIVE MORE SPACE TO RISK OF BIAS ASSESSMENT SECTION
====================================================

Problem:
The Risk of Bias assessment section needs a little more space.

Expected:
Adjust the two-column layout so the assessment panel has enough width to feel comfortable.

Requirements:
1. Right assessment panel should be wider than before.
2. PDF panel should still have enough space.
3. Layout should use available screen width efficiently.
4. No huge empty right-side area.
5. On wide screens:
   - assessment panel can be around 38–45% of workspace width
   - PDF can be around 55–62%
   - or use clamp-based sizing
6. On medium screens:
   - keep two columns if usable
7. On small screens:
   - stack panels or use a sensible responsive layout
8. Keep 5–10% workspace breathing room where appropriate, but do not waste too much space in RoB assessment.

Possible CSS:
- grid-template-columns: minmax(0, 1.25fr) minmax(420px, 0.9fr)
- or left/right split with clamp()
Use judgment based on current layout.

QA:
- RoB assessment has more room.
- PDF still readable.
- No unused huge empty space.
- Layout responsive.

====================================================
TASK 7 — MAKE RoB ASSESSMENT FEEL LIKE A SERIOUS ENGINE
====================================================

When the user enters the Risk of Bias assessment part, I want it to feel like an engine or serious workspace.

Do not make it flashy.
Make it professional, focused, and powerful.

Suggested improvements:
1. Study-level workspace header.
2. Assessment progress indicator:
   - domains completed / total
   - final judgment status
3. Clear domain cards:
   - Domain
   - signaling questions
   - judgment
   - rationale/notes
4. Sticky action footer:
   - Save draft
   - Mark complete
   - Next study
   - Continue to GRADE / Meta-Analysis when appropriate
5. Status chips:
   - Draft
   - In progress
   - Complete
   - Needs consensus
   - Conflict
6. If multiple reviewers are involved:
   - show reviewer status cleanly
7. Clear “Assessment engine” feel:
   - not a random form
   - organized panels
   - progress and next action
8. Empty/no-PDF states should be professional.
9. Avoid clutter.

Claude, use your judgment here.
If you see a better serious workspace layout, implement it.

====================================================
TASK 8 — ALL MAIN WORKFLOW TABS SHOULD ALLOW HIDING THE WHOLE MENU
====================================================

Currently, Screening has a way to hide/collapse the workflow menu to get more room.

I want this ability across all main app workflow tabs.

Applicable pages:
- Project Overview
- PICO / Protocol
- Screening
- Data Extraction
- Risk of Bias
- Analysis
- PRISMA
- GRADE
- Report & Export
- Project Control

Expected:
User can hide/collapse the main workflow menu from any major project page.

Requirements:
1. Add a universal collapse/expand behavior to the main workflow menu.
2. It should work consistently across project pages.
3. State should persist:
   - per user preference
   - or per session
   Use your judgment; per user is better if current preference system exists.
4. When collapsed, workspace gains more space.
5. There should always be a visible way to reopen the menu.
6. Do not break mobile layout.
7. Do not hide essential Back to Projects / project context.
8. Works in day/night themes.
9. Does not overlap top-right buttons/presence/chat/notifications.
10. Avoid implementing separate collapse systems for each tab; use shared app shell logic.

QA:
- Collapse menu in Overview.
- Navigate to Screening; menu stays collapsed if persisted.
- Expand menu.
- Navigate to RoB; state remains.
- Refresh page.
- Behavior matches persistence rule.
- Works on smaller screens.

====================================================
TASK 9 — ADD PROJECT CONTROL SETTINGS FOR SCREENING BEHAVIOR
====================================================

Add the following settings to Project Control.

These settings should be in the appropriate Project Control / Project Settings area.

Settings:

1. Blind mode
Description:
“Hide author / journal info from reviewers during screening.”

2. Restrict chat
Description:
“When on, only members with the Chat permission can post.”

3. Required reviewers
Description:
“Independent title & abstract decisions needed before a record can advance to Final Review. The research standard is 2; only the owner or a leader can change it.”

Requirements:
1. These settings should be editable in Project Control.
2. They should be visible in a clear Screening/Collaboration settings section.
3. The descriptions should be exactly or very close to the wording above.
4. Owner can change them.
5. Leader can change them if permission allows.
6. Reviewer/viewer cannot change them.
7. Backend enforces the setting.
8. Settings should persist.
9. Settings should affect actual behavior.

Behavior:
Blind mode:
- In Screening, hide author/journal info from reviewers during screening.
- Owner/leader may still be able to see depending current policy; use existing blind mode behavior if present.
- If blind mode already exists in Screening Settings, unify it with Project Control, do not duplicate.

Restrict chat:
- If off: project members who can access chat can post according to current basic rules.
- If on: only members with explicit Chat permission can post.
- Users without Chat permission can still read or not read depending existing permission model; use current design, but posting must be restricted.
- UI should show disabled input and message:
  “You do not have permission to post in this chat.”

Required reviewers:
- Use existing requiredScreeningReviewers if already implemented.
- Default should be 2.
- Controls Title & Abstract quorum.
- Controls advancement to Final Review.
- UI should update anywhere reviewer requirement is shown.

Important:
If these settings already exist in Screening Settings, Project Control should become the main place, and Screening Settings can link to Project Control or show synchronized values.

Do not create two conflicting sources of truth.

QA:
- Change Blind mode in Project Control.
- Screening reflects it.
- Change Restrict chat.
- Chat posting respects it.
- Change Required reviewers to 3.
- Screening quorum updates to 3.
- Unauthorized role cannot change settings.
- Settings persist after refresh.

====================================================
TASK 10 — RoB RESULTS SHOULD AUTO-INTEGRATE INTO GRADE CERTAINTY OF EVIDENCE
====================================================

After finishing Risk of Bias, the RoB results should automatically integrate into GRADE Certainty of Evidence.

Specifically:
The Risk of Bias area/domain in GRADE should be populated or updated based on the completed RoB assessments.

Expected:
When RoB assessments are completed:
1. GRADE module receives RoB information.
2. GRADE Risk of Bias domain reflects RoB results.
3. If RoB changes, GRADE RoB domain updates or becomes stale/needs review.
4. The user should not have to manually re-enter RoB findings in GRADE.
5. GRADE should make clear whether RoB input is:
   - auto-derived
   - manually edited
   - stale because RoB changed
   - not available because RoB incomplete

Important:
GRADE should not blindly downgrade without transparency if rules are not fully defined.
Use a clear, auditable mapping.

Suggested mapping:
- Mostly low risk across included studies → no serious concern
- Some concerns / unclear risk → serious or needs review
- High risk in important studies/domains → serious or very serious
- Mixed results → needs reviewer judgment
- Incomplete RoB → not ready / pending

Use existing GRADE structure if present.

Implementation options:
1. Auto-populate a recommendation/suggestion in GRADE Risk of Bias area.
2. Mark it as “Suggested from RoB assessments.”
3. Allow user to accept/edit.
4. If user edits manually, preserve manual override but show RoB updates.
5. If RoB changes after manual override, mark GRADE RoB as stale/needs review.

Recommended approach:
Use “auto-suggestion + auditable acceptance,” not silent forced final judgment.

Data model may need:
- gradeRiskOfBiasSource:
  - auto_rob
  - manual
  - manual_override
- gradeRiskOfBiasLastSyncedAt
- gradeRiskOfBiasStale
- linkedRoBAssessmentVersion/hash if available

Requirements:
1. Define a clean sync service:
   - syncRoBToGrade()
2. Trigger sync when:
   - RoB assessment completed
   - RoB assessment updated
   - RoB assessment reopened/reverted
   - GRADE page opened and stale check needed
3. Show clear UI in GRADE:
   - “Risk of Bias suggestion generated from completed RoB assessments.”
   - “RoB changed since this GRADE judgment was last reviewed.”
4. Do not overwrite manual GRADE judgment without warning.
5. Add audit log if available.

QA:
- Complete RoB assessment.
- Open GRADE.
- Risk of Bias area shows RoB-derived suggestion.
- Change RoB.
- GRADE marks RoB domain stale or updates suggestion.
- Manual override remains protected.
- Incomplete RoB shows pending/not ready.
- Reports/exports reflect final accepted GRADE judgment.

====================================================
TASK 11 — CLEANUP OLD OR DUPLICATE SETTINGS
====================================================

While implementing:
- If Blind mode exists in Screening Settings, unify it with Project Control.
- If Required reviewers exists somewhere else, make one source of truth.
- If chat restriction already exists, reuse it.
- Do not duplicate settings in multiple stores.
- Remove confusing duplicate UI.
- Keep labels consistent.

Search for:
- blindMode
- requiredScreeningReviewers
- restrictChat
- chatPermission
- Screening Settings
- Project Control settings
- GRADE Risk of Bias
- RoB completion

====================================================
DOCUMENTATION TO CREATE / UPDATE
====================================================

Create/update:

docs/manager/rob-assessment-workspace-redesign.md
docs/manager/pdf-viewer-fit-width.md
docs/manager/global-workflow-menu-collapse.md
docs/manager/project-control-screening-settings.md
docs/manager/rob-to-grade-integration.md
docs/manager/rob-workspace-final-report.md

Docs should include:
1. Current RoB assessment layout issues.
2. New RoB assessment workspace design.
3. PDF viewer fit-width implementation.
4. PDF toolbar collapse behavior.
5. Why Article Information tab was removed.
6. Article header behavior.
7. RoB layout width logic.
8. Global workflow menu collapse behavior.
9. Project Control settings and source of truth.
10. Blind mode behavior.
11. Restrict chat behavior.
12. Required reviewers behavior.
13. RoB → GRADE integration logic.
14. Stale/manual override behavior.
15. QA results.
16. Known limitations.

====================================================
TESTING REQUIREMENTS
====================================================

Automated tests where feasible:

PDF viewer:
1. PDF viewer defaults to fit width.
2. Viewer responds to container resize.
3. Toolbar hide/show state works.

RoB workspace:
1. Article Information tab is not rendered.
2. Article header appears above both panels.
3. Back button appears above both containers.
4. Assessment action footer remains visible.
5. RoB panel width is increased/balanced.
6. No page-level scroll needed for action button at common viewport height.

Workflow menu:
1. Collapse state works across pages.
2. Collapse state persists if intended.
3. Workspace gains room when collapsed.

Project Control settings:
1. Blind mode setting persists.
2. Blind mode affects Screening.
3. Restrict chat setting persists.
4. Chat posting blocked without permission when enabled.
5. Required reviewers setting persists.
6. Required reviewers affects Screening quorum.
7. Unauthorized roles cannot change settings.

RoB to GRADE:
1. Completing RoB creates/updates GRADE Risk of Bias suggestion.
2. Updating RoB marks GRADE stale or updates suggestion.
3. Manual GRADE override is not silently overwritten.
4. Incomplete RoB does not create misleading final GRADE judgment.

Manual QA:
1. Open RoB assessment with PDF.
2. Confirm PDF fits viewer width.
3. Hide PDF toolbar.
4. Show PDF toolbar.
5. Confirm Article Information tab is gone.
6. Confirm article title/authors/journal are above both PDF and assessment.
7. Confirm back button is above both containers.
8. Confirm action/next button visible without page scroll.
9. Confirm RoB assessment section has more space.
10. Collapse workflow menu on Overview.
11. Navigate to Screening/Data Extraction/RoB and confirm collapse works.
12. Change Blind mode from Project Control.
13. Confirm Screening respects it.
14. Turn Restrict chat on.
15. Confirm users without Chat permission cannot post.
16. Change Required reviewers.
17. Confirm Screening quorum updates.
18. Complete RoB assessment.
19. Open GRADE and confirm Risk of Bias area receives RoB-derived suggestion.
20. Modify RoB and confirm GRADE stale/update behavior.
21. Run build/tests.

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After successful implementation and testing:

1. Decide version bump.
This is likely a minor version because it includes RoB workspace redesign, global menu collapse, project settings, and RoB → GRADE integration.

2. Update version metadata.

3. Run tests.

4. Run build.

5. Commit.

Suggested commit message:
feat: redesign RoB assessment workspace and sync RoB to GRADE

Alternative:
feat: improve RoB engine, PDF viewer, and project workflow controls

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- .env
- raw database files
- junk files
- broken generated artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. PDF viewer fit-width implementation.
2. RoB page no-scroll/action visibility fix.
3. PDF toolbar hide/show behavior.
4. Article Information tab removal.
5. Article header spanning both panels.
6. RoB assessment layout/width changes.
7. “Serious engine/workspace” improvements.
8. Global workflow menu collapse implementation.
9. Project Control settings added.
10. Blind mode behavior.
11. Restrict chat behavior.
12. Required reviewers behavior.
13. RoB → GRADE integration.
14. GRADE stale/manual override behavior.
15. Backend changes.
16. Frontend changes.
17. Database/migration changes if any.
18. Tests added.
19. Manual QA results.
20. Build/test results.
21. Version bump and new version.
22. Commit hash.
23. Push status.
24. Known limitations.
25. Recommended next steps.

Claude, I want your best judgment here.

Make the RoB assessment feel like a real engine.
Make the PDF fit cleanly.
Keep the main action buttons visible.
Give the assessment panel enough room.
Make the global workflow menu collapsible everywhere.
Move the important Screening/collaboration settings into Project Control.
And make completed RoB assessments feed intelligently into GRADE certainty of evidence.