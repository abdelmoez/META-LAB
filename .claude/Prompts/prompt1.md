CLAUDE MAX MODE — FULL TEAM IMPLEMENTATION PROMPT

Goal:
Upgrade META·SIFT Beta and its integration with META·LAB into a serious collaborative screening system.

This is a major product upgrade.
Use the full team efficiently and aggressively.
You are allowed to make strong technical, UI, UX, database, and architecture decisions without asking me for confirmation.

Current ecosystem:
- META·LAB is the main systematic review/meta-analysis app.
- META·SIFT Beta is the separate screening app/module.
- META·SIFT must remain removable/disableable without breaking META·LAB.
- META·SIFT must integrate with META·LAB only through clean APIs and controlled handoff points.

Do NOT rebuild META·LAB from scratch.
Do NOT break existing META·LAB project saving, auth, admin panel, or meta-analysis logic.
Do NOT copy Rayyan branding, UI, wording, or proprietary design.
META·SIFT should be our own product.

Use the existing team, and add one extra agent only if necessary.

Team:
1. Main Claude — Overall Manager / Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. QA Developer
6. Website Manager / Public Website Agent
7. Collaboration & Realtime Agent — ADD THIS AGENT if needed for members, chat, reviewer state, and live collaboration

The new Collaboration & Realtime Agent is responsible only for:
- project members
- reviewer roles
- reviewer permissions
- chat system
- read/opened state per reviewer
- reviewer progress
- collaboration logic
- realtime/live updates if feasible

This agent must NOT change the research engine formulas or public website.

Autonomy instruction:
Do not ask me for small confirmations.
Do not stop after planning.
Plan, implement, test, fix failures, document, then report.
Only stop if blocked by missing credentials, missing files, or a serious security issue.

Skill / Tool Use:
Use all relevant Claude Code skills/tools available for:
- codebase mapping
- architecture planning
- database migrations
- full-stack coding
- React UI/UX
- realtime collaboration
- security review
- testing
- documentation

Document briefly which skills/tools were used and why.

CRITICAL PRODUCT RULE:
META·SIFT must be completely separated from META·LAB.

Good:
- separate routes
- separate folders
- separate database tables/models
- separate services
- separate admin settings
- feature flag to disable META·SIFT
- main META·LAB keeps working if META·SIFT is disabled

Bad:
- main META·LAB depends on META·SIFT to start
- META·SIFT errors crash META·LAB
- screening tables mixed randomly into main project tables
- removing META·SIFT breaks main META·LAB

Database isolation clarification:
I asked for a different database for each project because I do not want project data to become messy.

Implement this as:
- one application database
- strict project-level isolation using projectId
- every META·SIFT table must include screeningProjectId/projectId where appropriate
- every query must filter by project membership/ownership
- every user must only access projects they own or are members of
- do NOT create a separate physical database per project unless there is a very strong reason

Document this in:
docs/manager/project-data-isolation.md

Main Claude responsibilities:
1. Read the current project first.
2. Create an implementation plan.
3. Coordinate all agents.
4. Keep file ownership strict.
5. Integrate only through clean routes/APIs.
6. Verify META·SIFT does not break META·LAB.
7. Run the app.
8. Ensure QA completes a full real project before marking done.
9. Write final report.

Folder ownership:

Backend, Auth & Database Developer owns:
- /server/
- /server/screening/
- /server/routes/screening/
- /server/controllers/screening/
- /server/services/screening/
- /server/docs/

Frontend App Developer owns:
- /src/frontend/app/
- /src/frontend/screening/
- /src/frontend/admin/
- /src/frontend/api-client/

Research Engine Developer owns:
- /src/research-engine/
- /src/research-engine/screening/

QA Developer owns:
- /tests/
- /tests/screening/

Website Manager owns:
- /src/frontend/website/

Collaboration & Realtime Agent owns:
- /server/screening/collaboration/
- /server/screening/chat/
- /src/frontend/screening/collaboration/
- /src/frontend/screening/chat/

Main Claude owns:
- root files
- route integration
- docs/manager/
- package/config integration

Team communication format:
Agents must communicate using:

[FROM: Agent Name]
[TO: Agent Name]
[TOPIC: Short topic]
[MESSAGE]
[FILES I OWN THAT ARE AFFECTED]
[WHAT I NEED FROM YOU]

========================================================
PART 1 — META·SIFT PICO-BASED HIGHLIGHTING
========================================================

META·SIFT must read:
- PICO
- inclusion criteria
- exclusion criteria

Source:
- from linked META·LAB project if linked
- or from META·SIFT project settings if standalone

Feature:
Words/phrases from inclusion criteria should be highlighted in green.
Words/phrases from exclusion criteria should be highlighted in red.

Requirements:
1. Highlight inclusion words/phrases in abstract/body with green styling.
2. Highlight exclusion words/phrases in abstract/body with red styling.
3. Auto-generate suggested keyword lists from:
   - PICO
   - inclusion criteria
   - exclusion criteria
4. Allow project leader to edit/toggle these keyword lists.
5. Allow reviewers to toggle:
   - show inclusion highlights
   - show exclusion highlights
   - show all highlights off
6. Highlighting should update live without reloading.
7. Avoid breaking the abstract text.
8. Handle overlapping inclusion/exclusion terms gracefully.
9. Case-insensitive matching.
10. Phrase matching preferred over single-word chaos.
11. Document the algorithm.

Right column in screening UI should include:
- study type filter
- inclusion keywords
- exclusion keywords
- toggle inclusion highlighting
- toggle exclusion highlighting
- toggle all highlighting off
- editable keyword suggestions if user has permission

========================================================
PART 2 — TWO-REVIEWER DECISION SYSTEM
========================================================

META·SIFT must support at least two distinct reviewers per article.

Rule:
An article cannot move to the next section unless at least two distinct project members agree to include it.

Important distinction:
- Each reviewer can save their own decision.
- The article cannot be promoted to the next stage until quorum is met.
- The “promote/save to next section” action should be disabled/gray until at least two distinct reviewers included it.

Decisions:
Each reviewer can make only ONE active decision per article:
- include
- exclude
- maybe

A reviewer cannot choose include and exclude at the same time.
A reviewer can later undo or change their decision.

Requirements:
1. Store reviewer decisions separately.
2. One decision per reviewer per record per stage.
3. Changing decision updates the existing decision, not creating duplicates.
4. Undo decision returns to undecided state.
5. UI should show one decision indicator/check mark per reviewer.
6. Current single check mark beside article should be replaced by reviewer-level indicators.
7. Show each member’s decision if blind mode is off.
8. Hide member-specific decisions if blind mode is on.
9. Show quorum status:
   - 0/2 includes
   - 1/2 includes
   - 2/2 includes — eligible for next stage
10. If at least two distinct reviewers include the article, it becomes eligible for the next section.

========================================================
PART 3 — SECOND REVIEW SECTION
========================================================

Create the next section of META·SIFT after initial screening.

Name:
Full-Text / Second Review

This section should include only articles that reached inclusion quorum:
- at least two distinct reviewers included them in initial screening

Workflow:
1. Initial title/abstract screening
2. If at least two reviewers include → moves to Second Review
3. Second Review decision accepted → sent to META·LAB Data Extraction tab

Second Review requirements:
1. Show only quorum-included articles.
2. Support reviewer decisions again if feasible.
3. Project leader can finalize/accept articles.
4. Accepted articles should be saved/imported into META·LAB Data Extraction.
5. Rejected articles should remain in META·SIFT with status/reason.
6. Keep audit trail:
   - who accepted
   - when accepted
   - why accepted/rejected if reason entered

META·LAB handoff:
When an article is accepted in Second Review:
- create or update a study/extraction entry in the linked META·LAB project
- include title, authors, year, journal, DOI, PMID, abstract, URL, notes, labels, PDF metadata if present
- avoid duplicates in Data Extraction
- if no linked META·LAB project exists, allow export or prompt to link/create one

========================================================
PART 4 — PROJECT MEMBERS AND LEADER
========================================================

Each META·SIFT project has:
- leader
- members/reviewers
- roles
- active/inactive status

Default:
The user who creates the project becomes the project leader automatically.

Leader powers:
1. Add members.
2. Remove members.
3. Change member role.
4. Change member status active/inactive.
5. Toggle blind mode from project overview.
6. Delete project.
7. Archive project.
8. Control who can send chat messages.
9. Edit project status done/not done.
10. Control project settings.

Member fields:
- id
- userId
- screeningProjectId
- name
- email
- role:
  - leader
  - reviewer
  - viewer
  - inactive
- status:
  - active
  - inactive
- canScreen
- canChat
- canResolveConflicts
- joinedAt
- updatedAt

Adding a member:
- allow adding by email
- if user exists, add them
- if user does not exist, create pending invite record if feasible
- for local MVP, document invite limitations if email is not implemented

Security:
1. Only project leader can add/remove/change members.
2. Only leader can delete project.
3. Users can only see projects they own or are members of.
4. Inactive members cannot screen unless reactivated.
5. Viewer role cannot make decisions.
6. Member cannot access project if removed.

========================================================
PART 5 — BLIND MODE EDITABLE FROM PROJECT OVERVIEW
========================================================

Blind mode already exists but must be editable from project overview by the project leader.

Requirements:
1. Project overview has blind mode toggle.
2. Only project leader can change blind mode.
3. When blind mode is on:
   - reviewers cannot see other reviewers’ decisions
   - reviewer-level checkmarks are hidden/anonymized
   - conflicts are not shown to normal reviewers
4. When blind mode is off:
   - reviewer decisions become visible based on permissions
   - leader can view conflicts/disagreements
5. Log blind mode changes in audit trail.

========================================================
PART 6 — PROJECT CHAT SYSTEM
========================================================

Each META·SIFT project needs its own member chat system.

Requirements:
1. Chat is visible only inside the project.
2. Users outside the project cannot see chat.
3. Only project members can see chat.
4. Project leader controls who can send messages.
5. Users without chat permission can read or be blocked depending on leader setting.
6. Chat should live on the side of the project.
7. Chat should not appear outside project.
8. Store messages in database.
9. Show sender, time, message body.
10. Support basic message states:
    - sent
    - failed
11. Do not implement unsafe HTML rendering.
12. Sanitize messages.
13. If realtime WebSockets are feasible, implement them.
14. If not feasible, use polling and document it.

Chat database:
- chatMessageId
- screeningProjectId
- senderId
- message
- createdAt
- updatedAt
- deletedAt optional
- visibility/status optional

========================================================
PART 7 — PDF UPLOAD PER ARTICLE
========================================================

Each article should support attaching a PDF of the full manuscript.

Requirements:
1. Add PDF upload to each record/article.
2. Store PDF metadata:
   - file name
   - file size
   - mime type
   - upload date
   - uploaded by
   - linked record ID
3. Store file safely:
   - local storage folder for local dev
   - database metadata
   - future-ready for S3/Supabase storage
4. Validate:
   - PDF only
   - file size limit
   - no executable files
5. Add PDF view/download button.
6. Add remove/replace PDF if user has permission.
7. PDF must be visible only to project members.
8. Do not expose PDF public URL without authorization.
9. Document local storage and future production storage plan.

========================================================
PART 8 — DUPLICATE MANAGEMENT IMPROVEMENTS
========================================================

Current issue:
Duplicate group decision rows are horizontal.
Change them to vertical.

Requirements:
1. In duplicate management, display each possible duplicate record vertically.
2. Make comparison easier.
3. Show fields:
   - title
   - authors
   - year
   - journal
   - DOI
   - PMID
   - source
   - abstract preview
4. Add similarity percentage between studies.
5. Similarity percentage should be visible and explainable.
6. Use duplicate detection logic:
   - DOI match
   - PMID match
   - normalized title match
   - fuzzy title similarity
   - author/year similarity
7. Similarity score should be 0–100%.
8. Show why records are considered similar.
9. Allow leader or authorized member to:
   - keep primary
   - mark duplicate
   - not duplicate
   - merge metadata if safe
10. Save duplicate resolution.

Research Engine should own similarity algorithm.

========================================================
PART 9 — META·SIFT PROJECT LIST IMPROVEMENTS
========================================================

For each project in the META·SIFT main landing/project page, show:
- project title
- owner/leader
- total articles
- project status:
  - not done
  - in progress
  - done
- status indicator
- last updated
- member count
- screening progress if available

Project status:
- editable only by project leader
- saved in database
- visible in project list
- usable as filter

========================================================
PART 10 — PROJECT OVERVIEW TAB
========================================================

Whenever a META·SIFT project is opened, the first tab should be:

Overview

Overview should include:

A. Data Summary
- total articles imported
- total duplicates in project
- confirmed duplicates
- unresolved duplicates
- unresolved/disputed decisions
- number of studies with different decisions
- number eligible for second review
- number accepted to META·LAB Data Extraction

Duplicates count:
Only show confirmed/resolved duplicate totals after duplicate detection has been run and confirmed/resolved.

B. Review Members
Show:
- names
- email
- role
- status active/inactive
- canScreen
- canChat
- canResolveConflicts

Leader can:
- add member
- remove member
- change role
- change status
- change chat permission
- change screening permission

C. Member Progress
For each member:
- screened articles number
- included count
- excluded count
- maybe count
- undecided count
- progress percentage
- visual infographic/progress bar

D. Whole Project Progress
For leader:
- whole project completion %
- total screened
- total unscreened
- total conflicts
- total eligible for second review
- total accepted to data extraction
- member comparison
- progress infographic

Overview should be visually useful and not generic.
It should feel like a real project command center.

========================================================
PART 11 — SCREENING TAB REDESIGN
========================================================

The screening tab currently has two columns.
Redesign it into THREE columns.

Column 1 — Left article list
Keep current article list, but improve it.

Add:
- filter:
  - all articles
  - unopened by me
  - opened by me
  - undecided
  - excluded
  - maybe
  - included
  - quorum included
  - disputed
- show whether current member opened article
- this opened/unopened state is per member
- article status indicators
- reviewer decision indicators
- search

Column 2 — Middle main article detail
This is the main reading area.

Show:
- title
- abstract
- publication type
- authors
- journal
- year
- URL
- DOI
- PMID
- search method/source
- keywords
- PDF attachment/viewer link if uploaded

Abstract:
- highlight inclusion keywords in green
- highlight exclusion keywords in red
- allow toggling highlights
- readable typography
- enough spacing for long abstracts

Decision buttons:
- Include
- Exclude
- Maybe
- Undo decision

Rules:
- one active decision per reviewer
- decision saves to current reviewer only
- display current reviewer’s saved decision
- show quorum status
- promotion to second review disabled until two distinct reviewers included

Column 3 — Right filters and tools
Show:
- study type filter
- inclusion keyword list
- exclusion keyword list
- keyword toggles
- all highlights on/off
- PICO/inclusion/exclusion summary
- labels
- exclusion reasons
- notes
- reviewer status
- blind mode indicator
- project chat side panel or collapsible chat

Right column must be useful, not cluttered.
Use collapsible sections if needed.

========================================================
PART 12 — META·LAB CHANGES
========================================================

META·LAB should no longer duplicate title screening and manual PRISMA work that META·SIFT covers.

Changes:
1. Remove or hide META·LAB manual Title Screening tab.
2. Remove or hide META·LAB manual PRISMA workflow if META·SIFT now owns it.
3. Keep PRISMA diagram/reporting in META·LAB, but make it auto-update from META·SIFT data.
4. Do not delete data.
5. If removing tabs is risky, hide them and document.

PRISMA auto-update:
The META·LAB PRISMA diagram should auto-update based on linked META·SIFT project data:
- records imported
- duplicates removed
- records screened
- records excluded
- full-text/second review assessed
- full-text excluded
- final included studies
- studies sent to data extraction

If no META·SIFT project is linked:
- show empty state
- allow linking a META·SIFT project
- do not crash

Data Extraction:
When META·SIFT second review accepts articles:
- add them to META·LAB Data Extraction tab
- avoid duplicates
- show source as “META·SIFT”
- preserve metadata

========================================================
PART 13 — ADMIN FIXES
========================================================

Two admins:
The admin account ops@metalab.local currently does not work.
Fix admin seeding/login.

Requirements:
1. Ensure exactly two code-created admins work locally.
2. ops@metalab.local must work.
3. Document admin credentials setup through .env.example.
4. Never commit real secrets.
5. If local seed password is needed, use env variable.
6. Admin login should be tested.
7. Admin panel should include META·SIFT controls.

Admin controls for META·SIFT:
- enable/disable META·SIFT
- enable/disable new projects
- enable/disable import
- enable/disable export
- enable/disable duplicate detection
- enable/disable conflict resolution
- view project metrics
- view member metrics
- view duplicate metrics
- view article counts
- view second review counts
- view data extraction handoff counts

========================================================
PART 14 — BACKEND DATABASE REQUIREMENTS
========================================================

Backend must create/update schema for:

META·SIFT:
- ScreeningProject
- ScreeningProjectMember
- ScreeningRecord
- ScreeningDecision
- ScreeningStage
- ScreeningConflict
- ScreeningDuplicateGroup
- ScreeningDuplicateCandidate
- ScreeningLabel
- ScreeningExclusionReason
- ScreeningRecordLabel
- ScreeningRecordOpenState
- ScreeningChatMessage
- ScreeningPdfAttachment
- ScreeningAuditLog
- ScreeningSettings

Project membership:
- project leader
- reviewers
- viewers
- inactive members

Decision uniqueness:
- one active decision per reviewer per record per stage

Use unique constraints where needed.

Access control:
- project owner/leader
- project members
- role-based permissions
- admin-only endpoints

Do not wipe existing database.
Use additive migrations.
Backup first if any destructive operation seems necessary.

========================================================
PART 15 — FRONTEND REQUIREMENTS
========================================================

Frontend must implement:

META·SIFT routes:
- /sift-beta
- /sift-beta/projects
- /sift-beta/projects/:id/overview
- /sift-beta/projects/:id/screening
- /sift-beta/projects/:id/second-review
- /sift-beta/projects/:id/duplicates
- /sift-beta/projects/:id/conflicts
- /sift-beta/projects/:id/import
- /sift-beta/projects/:id/export
- /sift-beta/projects/:id/settings

Main app integration:
- Rayyan & Screening tab
- Open META·SIFT Beta button
- Link META·SIFT project to META·LAB project
- Data Extraction receives accepted second-review articles
- PRISMA auto-updates

UI quality:
- professional
- efficient
- not generic AI dashboard
- no clutter
- strong information hierarchy
- excellent three-column screening layout
- clear reviewer decision indicators
- clear quorum status
- clean overview dashboard
- good error/loading/empty states

========================================================
PART 16 — QA FULL PROJECT TEST
========================================================

QA must perform a full end-to-end test before marking done.

QA must create a real project and test every major function.

Required manual QA flow:

1. Start backend.
2. Start frontend.
3. Confirm database connected.
4. Login as admin.
5. Confirm ops@metalab.local works.
6. Confirm META·SIFT controls exist in admin panel.
7. Login/register as normal user.
8. Create META·LAB project with PICO, inclusion, and exclusion criteria.
9. Open Rayyan & Screening tab.
10. Open META·SIFT Beta.
11. Create META·SIFT project linked to META·LAB project.
12. Confirm leader is project creator.
13. Add second member/reviewer.
14. Confirm member appears in overview.
15. Import sample references.
16. Confirm total articles count.
17. Run duplicate detection.
18. Confirm duplicate candidates show vertically.
19. Confirm similarity percentage appears.
20. Resolve duplicates.
21. Confirm duplicate summary updates.
22. Open screening tab.
23. Confirm three-column layout.
24. Confirm inclusion/exclusion highlights work.
25. Confirm toggles work.
26. Reviewer 1 includes/excludes/maybes records.
27. Reviewer 2 includes/excludes/maybes records.
28. Confirm each member has separate decision indicator.
29. Confirm one reviewer cannot make multiple active decisions on same article.
30. Confirm undo decision works.
31. Confirm article does not move to second review until two distinct reviewers include it.
32. Confirm after two includes, article appears in second review.
33. Accept article in second review.
34. Confirm it appears in META·LAB Data Extraction.
35. Confirm PRISMA diagram auto-updates.
36. Upload PDF to article.
37. Confirm PDF is attached and accessible only inside project.
38. Test project chat.
39. Confirm only members can see chat.
40. Toggle blind mode from project overview.
41. Confirm blind mode hides reviewer decisions.
42. Toggle blind mode off.
43. Confirm decisions become visible.
44. Change member role/status.
45. Confirm inactive member cannot screen.
46. Mark project done.
47. Confirm project list shows owner, total articles, status.
48. Logout/login.
49. Confirm all data persists.
50. Confirm User A cannot access User B’s project.
51. Disable META·SIFT from admin.
52. Confirm META·LAB still works.
53. Re-enable META·SIFT.
54. Confirm META·SIFT works again.

Automated tests:
Add tests for all critical backend, frontend, and integration logic.

Required tests:
- admin seed works
- ops@metalab.local works
- project leader creation
- member add/remove
- role/status changes
- one decision per reviewer per article
- quorum include rule
- second review handoff
- data extraction handoff
- PRISMA auto-update
- PICO keyword extraction
- inclusion/exclusion highlighting
- duplicate similarity %
- vertical duplicate view renders
- per-member opened state
- project chat access control
- PDF upload validation
- user ownership security
- META·SIFT disable does not break META·LAB

Write reports:
- /tests/screening/report.md
- /tests/report.md

========================================================
FINAL DELIVERABLES
========================================================

Deliver:
1. PICO/inclusion/exclusion highlighting.
2. Green inclusion highlights.
3. Red exclusion highlights.
4. Two-reviewer decision system.
5. One active decision per reviewer per article.
6. Per-reviewer decision indicators.
7. Quorum rule requiring two distinct includes.
8. Second Review section.
9. Accepted second-review articles sent to META·LAB Data Extraction.
10. Duplicate management vertical layout.
11. Duplicate similarity percentage.
12. Project members system.
13. Project leader role and controls.
14. Blind mode editable from project overview.
15. Project chat system.
16. PDF upload per article.
17. Project list owner/article count/status.
18. Project overview dashboard.
19. Three-column screening tab.
20. Per-member opened/unopened tracking.
21. META·LAB title screening/manual PRISMA removed or hidden.
22. META·LAB PRISMA auto-updated from META·SIFT.
23. Admin ops@metalab.local fixed.
24. Admin controls for META·SIFT.
25. Database isolation by projectId/membership.
26. Full QA project test completed.
27. Tests and docs updated.

Final report from Main Claude must include:
1. What was built.
2. Files changed.
3. Database migrations changed.
4. How project isolation works.
5. How reviewer quorum works.
6. How second review works.
7. How Data Extraction handoff works.
8. How PRISMA auto-update works.
9. How PDF upload works.
10. How project chat works.
11. How blind mode works.
12. How duplicate similarity works.
13. How admin ops@metalab.local was fixed.
14. Full manual QA project results.
15. Automated test results.
16. Known limitations.
17. Recommended next steps.

STRICT RULES:
1. Do not rebuild from scratch.
2. Do not wipe the database.
3. Do not run destructive migrations without backup.
4. Do not break META·LAB.
5. Keep META·SIFT removable/disableable.
6. Keep user/project access secure.
7. Do not copy Rayyan.
8. Do not mark complete until full QA project test is done.
9. Do not hide failures.
10. Fix issues and retest before final response.


You are now operating with Claude Max capacity. Use the full context, inspect the code deeply, work efficiently with the team, make decisions autonomously, and do not return until this has been implemented, tested with a full project, and documented.