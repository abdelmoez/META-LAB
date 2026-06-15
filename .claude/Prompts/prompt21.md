CLAUDE OPUS — FINAL REVIEW WORKFLOW, SCREENING STEPPER, COPY CLEANUP, AND PROJECT-WIDE STATE SYNC

Claude, I want you to fix and improve the Screening workflow again, but this time I want the workflow to feel more polished, stepwise, and clear.

Use Opus as the lead architect. Assign straightforward implementation, styling, and tests to Sonnet if useful.

Do not ask me small questions.
Inspect the current code first.
Understand the current Screening implementation.
Find what already exists.
Then implement safely.

====================================================
MAIN IDEA
====================================================

The app should feel like one unified Review Project.

META·SIFT should remain only an internal/backend name for the Screening engine.

User-facing language should be:

Screening

Not:
- META·SIFT
- linked META·LAB
- linked META·SIFT
- META·LAB Data Extraction handoff
- separate app language

The user should feel they are inside one project workflow.

====================================================
TASK 1 — CHANGE “FULL TEXT” TO “FINAL REVIEW”
====================================================

In the Screening workspace, rename:

Full Text

to:

Final Review

This should apply to user-facing navigation, labels, headings, empty states, buttons, and documentation.

Do not use “Full Text” as the main tab label anymore unless it is in developer/internal comments or migration compatibility.

Preferred Screening submenu:

1. Overview
2. Import
3. Duplicates
4. Title & Abstract
5. Conflicts
6. Final Review
7. Settings
8. Export

If old routes use `/full-text`, keep compatibility if needed, but user-facing route/label should preferably become:

/projects/:workspaceId/screening/final-review

If changing routes is risky:
- keep old route internally
- redirect `/full-text` to `/final-review`
- make the UI show Final Review

====================================================
TASK 2 — FINAL REVIEW SHOULD HAVE TWO INTERNAL TABS
====================================================

Inside Final Review, create two tabs:

1. Not Sent to Data Extraction
2. Sent to Data Extraction

Each tab should show the number of studies inside it.

Example:
- Not Sent to Data Extraction (12)
- Sent to Data Extraction (8)

Meaning:

Not Sent to Data Extraction:
- records that reached Final Review
- records that are accepted/eligible or pending final action
- records not yet sent to Data Extraction

Sent to Data Extraction:
- records already accepted and sent to Data Extraction
- records currently contributing to downstream extraction/analysis/PRISMA as applicable

Use better wording if you think it is clearer, but keep the logic.

Possible labels:
- Pending Extraction
- Sent to Extraction

But do not confuse the user. Pick the most user-friendly names.

====================================================
TASK 3 — ALLOW REVERSING SENT FINAL REVIEW DECISIONS
====================================================

In the “Sent to Data Extraction” tab, the user should be able to edit/revert the decision.

Expected behavior:
If a study was accepted and sent to Data Extraction, there should be a safe way to revert it back to the undecided/pending Final Review state.

The action should do all of this automatically:

1. Remove or mark inactive the Data Extraction entry for that study.
2. Update Final Review status.
3. Move the record back to the correct pending/undecided tab.
4. Update PRISMA flow.
5. Update Data Extraction counts.
6. Update any analysis readiness status.
7. Update meta-analysis if that study was being used.
8. Update project overview Screening stats.
9. Add audit log.
10. Notify or warn if this affects analysis/results.

Important:
Do not silently destroy extracted data if avoidable.

Preferred safe behavior:
- If extraction data exists, do not hard-delete immediately.
- Mark extraction record as inactive/removed due to reverted final review.
- Or move it to an archived extraction state.
- Clearly show that it was removed from active extraction.
- If the user re-sends it later, either restore prior extraction data or ask whether to restore/reset, depending on what is safest.

Ask yourself:
What is the safest scientific/reproducibility behavior?

Expected UX:
When user clicks “Revert from Data Extraction” or “Return to Final Review”:
- show confirmation modal
- explain downstream effects:
  - PRISMA will update
  - Data Extraction will update
  - Analysis readiness may change
  - Meta-analysis using this study may need rerun
- confirm action
- show success toast

Backend must enforce this.
Do not rely only on frontend.

====================================================
TASK 4 — REMOVE CONFUSING OLD COPY
====================================================

I still see this sentence in Final Review:

“Accept a record to hand it off to META·LAB Data Extraction, or reject it with a reason.”

This no longer makes sense because the app is now unified in the frontend.

Replace it with something like:

“Make the final inclusion decision before studies enter Data Extraction.”

or:

“Accept studies for Data Extraction, or exclude them with a documented reason.”

Do not mention:
- META·LAB Data Extraction
- handoff to META·LAB
- linked project
- separate app

Use unified project wording.

====================================================
TASK 5 — FIX SCREENING SETTINGS COPY
====================================================

In Screening Settings, there is currently wording like:

“Project Control
Manage status, blind mode, chat, the META·LAB link, and members — all in one place.”

This is confusing now because the frontend is one unified app.

Change it to something like:

“Project Control
Manage project status, members, permissions, chat, and Screening settings in one place.”

or better if you find better copy.

Remove:
- META·LAB link
- linked project language
- separate module language

Project Control should feel like one place for the whole project.

====================================================
TASK 6 — ADD STEPWISE WORKFLOW STEPPER BELOW TOP MENU
====================================================

I want the top menu area to show a stepwise workflow figure so the user knows:

1. where they are
2. what steps exist
3. which steps are completed
4. which step is active now
5. which steps are still pending

This should be below the top menu but visually part of the navigation area.

I want it to feel like a clear stepper/progress navigation.

Possible Screening workflow steps:
1. Import
2. Duplicates
3. Title & Abstract
4. Conflicts
5. Final Review
6. Data Extraction

Or:
1. Import
2. Duplicates
3. Screening
4. Conflicts
5. Final Review
6. Extraction Ready

You decide the best labels.

The stepper should show:
- completed steps
- active/current step
- inactive/pending steps
- optionally loading state

Examples:
- Import completed if records have been imported.
- Duplicates completed if duplicates are resolved or no duplicates exist.
- Title & Abstract active/completed based on screening progress.
- Conflicts completed if no unresolved conflicts.
- Final Review completed if final decisions are done.
- Data Extraction completed/ready if accepted studies have been sent.

Keep this simple and accurate.
Do not overcomplicate the logic if the app does not yet have every status available.

====================================================
TASK 7 — INTEGRATE OR ADAPT A STEPPER COMPONENT
====================================================

I am giving you a Stepper component idea/spec.

Use it if it fits the project.

But do not blindly copy code if it conflicts with the project architecture.

First inspect:
- Is the app using TypeScript?
- Is the app using Tailwind?
- Is the app using shadcn-style /components/ui?
- Is there already a stepper component?
- Is there already a Button component?
- Is `cn` already available?
- Are lucide-react icons already installed?
- Is class-variance-authority already installed?
- Is radix-ui already installed?

If the project already has equivalent components, reuse/adapt them instead of duplicating.

If there is no stepper component, create one in the correct component location.

Preferred path if compatible:
- /components/ui/stepper.tsx

If this project does not use `/components/ui`, use the existing design-system folder and explain why.

The stepper should support:
- horizontal layout
- active step
- completed step
- inactive step
- loading state if useful
- accessible tab/step behavior if clickable
- keyboard navigation if possible
- Tailwind styling
- theme compatibility
- app accent color
- day/night mode
- responsive behavior

Do not install unnecessary dependencies if the app already has what is needed.

Potential dependencies:
- lucide-react
- class-variance-authority
- radix-ui or @radix-ui/react-slot depending current project
- tailwind utilities already present

If the exact pasted component requires dependencies that conflict with the app, adapt it.

Important:
Do not break the existing Button component.
Do not add a duplicate Button system if one already exists.
Use the app’s existing Button if possible.

====================================================
TASK 8 — STEPPER UX PLACEMENT
====================================================

Place the stepper below the main project top menu and above the Screening subpage content.

Suggested layout:

Project Header / Main Workflow Menu
Screening subnav or Screening title
Stepper progress bar
Current Screening subpage content

But if a cleaner layout exists, use your judgment.

The stepper should not make the screen cluttered.
It should make the workflow clearer.

Possible layout:
- compact horizontal stepper on desktop
- scrollable horizontal stepper on smaller screens
- collapsed/stacked version on mobile if needed

Each step can be clickable if it maps to a route:
- Import → /screening/import
- Duplicates → /screening/duplicates
- Title & Abstract → /screening/title-abstract
- Conflicts → /screening/conflicts
- Final Review → /screening/final-review
- Data Extraction → /data-extraction

If clicking Data Extraction jumps outside Screening, make that clear.
Or keep it as a status-only final step.

Use your product judgment.

====================================================
TASK 9 — STATUS LOGIC FOR STEPPER
====================================================

Implement practical step completion logic.

Suggested:

Import:
- completed if importedRecordsCount > 0

Duplicates:
- completed if importedRecordsCount > 0 and unresolvedDuplicatesCount === 0
- inactive if no records imported

Title & Abstract:
- active if records imported and title/abstract screening not complete
- completed if all required title/abstract decisions are complete

Conflicts:
- completed if unresolvedConflictsCount === 0
- active if unresolvedConflictsCount > 0

Final Review:
- active if records are eligible for final review and final review not complete
- completed if all final review records are accepted/excluded

Data Extraction:
- completed if accepted/sent studies exist in Data Extraction
- active/ready if final included studies are ready to extract
- inactive if nothing accepted yet

If the app does not have exact fields, derive the best available values and document limitations.

Do not invent fake progress.

====================================================
TASK 10 — MAKE FINAL REVIEW STATE UPDATE PROJECT-WIDE
====================================================

The Final Review decision state must be the source of truth for downstream status.

When a study is accepted/sent:
- it should appear in Data Extraction
- PRISMA updates
- Screening stats update
- Project overview updates
- analysis readiness updates

When reverted:
- it should no longer count as actively sent
- Data Extraction should update
- PRISMA updates
- Screening stats update
- analysis readiness updates
- meta-analysis using it should become stale, invalidated, or rerun if the app supports that

Add or update events:
- FINAL_REVIEW_ACCEPTED
- FINAL_REVIEW_EXCLUDED
- FINAL_REVIEW_SENT_TO_EXTRACTION
- FINAL_REVIEW_REVERTED_FROM_EXTRACTION
- DATA_EXTRACTION_ENTRY_DEACTIVATED
- PRISMA_UPDATED_FROM_FINAL_REVIEW

Use whatever naming fits existing audit/event architecture.

====================================================
TASK 11 — UPDATE COUNTS EVERYWHERE
====================================================

Final Review tabs should show counts.

Project Overview Screening card should update counts.

PRISMA should update.

Data Extraction should update.

Screening stepper should update.

No stale counts after revert.

Check both:
- frontend state
- backend persisted state

If there is a cache/query layer, invalidate/refetch the right queries.

====================================================
TASK 12 — TESTING REQUIREMENTS
====================================================

Automated tests where feasible:

1. Full Text label no longer appears as user-facing tab.
2. Final Review tab renders.
3. Final Review route works.
4. Final Review has:
   - Not Sent to Data Extraction tab
   - Sent to Data Extraction tab
5. Counts display correctly.
6. Accepting a record sends it to Data Extraction.
7. Reverting a sent record removes/deactivates it from active Data Extraction.
8. Reverting updates PRISMA counts.
9. Reverting updates project overview counts.
10. Reverting updates analysis readiness.
11. Old confusing META·LAB handoff copy is removed.
12. Screening Settings copy no longer says META·LAB link.
13. Stepper renders.
14. Stepper active step changes with route.
15. Stepper completed states reflect project data.
16. Stepper is theme-compatible.
17. No user-facing META·SIFT remains in normal UI.

Manual QA:

1. Open Review Project.
2. Click Screening.
3. Confirm stepper appears below the top menu.
4. Navigate Screening sub-tabs.
5. Confirm Full Text is now Final Review.
6. Open Final Review.
7. Confirm two tabs:
   - Not Sent to Data Extraction
   - Sent to Data Extraction
8. Confirm counts appear in each tab.
9. Accept/send a study to Data Extraction.
10. Confirm it moves to Sent tab.
11. Confirm it appears in Data Extraction.
12. Confirm PRISMA updates.
13. Confirm project overview Screening stats update.
14. Revert the decision from Sent tab.
15. Confirm it returns to pending/undecided Final Review.
16. Confirm Data Extraction updates.
17. Confirm PRISMA updates again.
18. Confirm analysis readiness updates.
19. Confirm no confusing META·LAB handoff copy.
20. Confirm Screening Settings copy is clean.
21. Test day/night theme.
22. Test long project title.
23. Run build/tests.

====================================================
TASK 13 — DOCUMENTATION
====================================================

Create/update:

docs/manager/final-review-workflow-plan.md
docs/manager/screening-stepper-integration.md
docs/manager/final-review-state-sync.md
docs/manager/final-review-final-report.md

Documentation should explain:
- why Full Text was renamed to Final Review
- what the two Final Review tabs mean
- how sent/reverted studies affect downstream modules
- how Data Extraction records are handled safely
- how PRISMA is updated
- how stepper completion states are calculated
- where the stepper component lives
- dependencies added or avoided
- any limitations

====================================================
VERSION, COMMIT, AND PUSH
====================================================

After successful implementation and testing:

1. Decide version bump.
This is probably a minor version because it changes workflow and UX.

2. Update version metadata.

3. Run tests.

4. Run build.

5. Commit.

Suggested commit message:
feat: add final review workflow and screening stepper

Alternative:
feat: improve screening progression and final review state sync

6. Push to current branch if safe.

If push fails:
- commit locally
- report exact reason.

Do not commit:
- secrets
- .env
- raw local DB files
- junk files
- broken generated artifacts

====================================================
FINAL REPORT
====================================================

When finished, report:

1. Where Full Text was renamed to Final Review.
2. Final Review tab structure.
3. How counts are calculated.
4. How accepted/sent studies move to Data Extraction.
5. How revert works.
6. How PRISMA updates.
7. How Data Extraction updates.
8. How meta-analysis/analysis readiness updates.
9. What old confusing copy was removed.
10. What Screening Settings copy changed.
11. Stepper component implementation.
12. Stepper placement.
13. Stepper completion logic.
14. Dependencies added or avoided.
15. Backend changes.
16. Frontend changes.
17. Database changes if any.
18. Tests added.
19. Manual QA results.
20. Build/test results.
21. Version bump and new version.
22. Commit hash.
23. Push status.
24. Known limitations.
25. Recommended next steps.

Claude, I want this to feel clean and professional.

Do not just rename labels.
Make Final Review actually work as the final decision point before Data Extraction.
Make the revert behavior scientifically safe.
Make the whole project update automatically.
Make the stepper help the user understand the Screening workflow.
Keep META·SIFT internal only.
Make the frontend feel like one unified app.