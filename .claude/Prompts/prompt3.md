CLAUDE MAX — TARGETED META·SIFT BUG FIXES

Goal:
Fix the remaining META·SIFT issues. Do NOT add unrelated features. Do NOT redesign the whole app. Fix these specific bugs, test them fully, and report the exact root causes.

Use the same team:
1. Main Claude — Manager / Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. QA Developer
6. Website Manager / Public Website Agent
7. Collaboration & Realtime Agent

Autonomy:
Do not ask me small questions.
Investigate, fix, test, document, and only return when these issues are verified.

Important assumption:
The unfinished note “and in the Whole-Project Progress,” means:
- regular members should NOT see whole-project/team-wide progress if it exposes other members’ work
- only the project leader should see whole-project progress and other-member progress
- regular members should only see their own progress

====================================================
BUG 1 — INCLUDE KEYWORDS NOT SHOWING
====================================================

Problem:
Include keywords are still not showing. Only the PICO/question is showing.

Expected:
The Screening right panel should show:
- Keywords for Include
- Keywords for Exclude
- Select All
- individual checkboxes
- article count beside each keyword
- Show more / Show less
- filtering behavior
- green highlights for include words
- red highlights for exclude words

Default include keywords must be present for every META·SIFT project:

randomized
trail
compared with
controlled trial
randomly
randomized controlled trial
randomly assigned
assigned to
randomised
double blind
controlled study
placebo
randomly allocated
RCT
placebo controlled
single blind
randomised controlled trial
parallel group
control groups
parallel groups
cross over
double blinded
CCT
doubleblind
double marked
doubleblinded
single masked
controlled design

Default exclude keywords must also show:
meta-analysis
systematic review
cohort
observational
non-randomized
retrospectively
retrospective study
sensitivity and specificity
literature review
in Vitro
animal
prevalence
nonrandomized
case control
case reports
cross-sectional
regression analysis
retrospective cohort
randomised controlled trials
animals
non-randomised
rat
survey
single arm
case report
regression analyses
fish
porcine
longitudinal
healthy controls
soil
beagle
equine
murine
rabbit
rodent
beagles
broiler
cadaver
piglets
rabbits
rodents
broilers
cadavers
purebred
cadaveric
transgenic
age-matched
healthy control

Backend/Research Engine:
1. Confirm default keywords are generated for every project.
2. Confirm they are saved in the database or returned from a stable default source.
3. Confirm include and exclude lists are both returned to frontend.
4. Confirm keyword counts are calculated from project records.
5. If project has no custom keywords, use defaults automatically.
6. Do not require PICO to exist before default keywords show.

Frontend:
1. Fix rendering so include keywords appear.
2. Do not only show PICO/question.
3. Add fallback: if API returns no keyword list, display default list.
4. Show include and exclude sections separately.
5. Show count beside each keyword.
6. Selecting keywords filters articles.
7. Show “shown / total articles.”
8. Highlight selected include words green and exclude words red.

QA:
Test that include keywords appear in a new project and existing project.

====================================================
BUG 2 — CHAT NOTIFICATION ALWAYS SHOWS AFTER LOGIN
====================================================

Problem:
Chat notification appears every time I log in, even if I already read all messages.

Expected:
Chat notification badge should show only if there are unread messages for the current user in that specific META·SIFT project.

Requirements:
1. Track read state per user per project.
2. When user opens chat, mark messages as read for that user.
3. Store lastReadAt or per-message read receipt.
4. On login, calculate unread count correctly.
5. Do not show notification if all messages are read.
6. If another member sends a new message after lastReadAt, show notification.
7. Notification should be project-specific.
8. Do not mark messages read just by logging in.
9. Mark messages read only when chat drawer is opened or user explicitly views them.

Backend:
Add/fix:
- lastReadAt per user/project
or:
- ChatMessageReadReceipt table

Suggested endpoints:
- GET /api/screening/projects/:projectId/chat/unread-count
- POST /api/screening/projects/:projectId/chat/mark-read

Frontend:
1. Fetch unread count.
2. Show badge only if unreadCount > 0.
3. When opening chat drawer, call mark-read.
4. Clear badge after successful mark-read.
5. Keep chat input focused after sending message.

QA:
1. User A sends message.
2. User B sees badge.
3. User B opens chat.
4. Badge disappears.
5. User B logs out/logs in.
6. Badge should NOT reappear unless a new message was sent.

====================================================
BUG 3 — PDF VIEWER CONNECTION RESET
====================================================

Problem:
PDF preview still does not work. Preview shows:
“The connection was reset.”

This likely means PDF serving/streaming endpoint is broken, the file path is invalid, headers are wrong, auth middleware is interrupting the stream, or frontend is using the wrong URL.

Expected:
PDF preview should work in:
- Screening
- Second Review

Backend must diagnose:
1. Exact PDF preview URL.
2. HTTP method.
3. Status code.
4. Server logs.
5. Whether file exists on disk/storage.
6. Whether auth middleware passes.
7. Whether response headers are correct.
8. Whether stream is interrupted.

Fix requirements:
1. Serve PDF with correct headers:
   - Content-Type: application/pdf
   - Content-Disposition: inline
   - Content-Length if available
2. Support range requests if needed:
   - Accept-Ranges: bytes
   - 206 Partial Content
3. Do not load huge PDFs into memory unnecessarily.
4. Validate user is project member before serving.
5. Return JSON error for API metadata failures, but actual PDF endpoint should stream PDF correctly.
6. If preview fails, frontend should show download/open fallback.
7. PDF route must not be blocked by frontend router.
8. PDF route must not return HTML.
9. PDF file should not be publicly exposed without authorization.

Suggested endpoints:
- POST /api/screening/projects/:projectId/records/:recordId/pdf
- GET /api/screening/projects/:projectId/records/:recordId/pdf/preview
- GET /api/screening/projects/:projectId/records/:recordId/pdf/download
- DELETE /api/screening/projects/:projectId/records/:recordId/pdf

Frontend:
1. Use iframe/object/embed or a PDF viewer only after confirming endpoint returns application/pdf.
2. Do not fetch as JSON.
3. If auth uses cookies, include credentials.
4. If auth uses token, add authorized PDF preview approach.
5. Show proper error:
   - “PDF file not found”
   - “You do not have permission”
   - “Preview failed, download instead”

QA:
Upload a real PDF and preview it in:
1. Screening
2. Second Review
3. After refresh
4. After logout/login
5. As unauthorized user — should be blocked

====================================================
BUG 4 — META·SIFT LANDING PROJECT CARDS NEED MORE INFO
====================================================

Problem:
META·SIFT landing/project page needs more project context.

Expected:
For each META·SIFT project card/list row show:
- project title
- linked META·LAB project name
- if not linked: “Not linked to META·LAB”
- project owner/leader
- if current user is leader: show “You are leader”
- total articles
- project status
- updated date
- member count if available

Design:
- make font slightly larger, only a little
- improve readability
- do not make it bulky
- keep it professional

Backend:
Ensure project list endpoint returns:
- linkedMetaLabProjectId
- linkedMetaLabProjectTitle
- leaderName
- leaderEmail
- currentUserRole
- totalArticles
- status

Frontend:
Render these clearly on the landing/project list.

====================================================
BUG 5 — SECOND REVIEW FINAL INCLUDED STUDIES SHOULD GO DIRECTLY TO DATA EXTRACTION
====================================================

Problem:
Final included studies from META·SIFT after Second Review are not appearing in META·LAB Data Extraction.

Expected:
After an article is accepted/final included in Second Review:
1. It should be sent automatically to linked META·LAB project Data Extraction.
2. It should appear in the Data Extraction tab.
3. The handoff should be idempotent and not create duplicates.
4. If no META·LAB project is linked, show clear warning and allow linking.
5. Handoff status should be visible:
   - pending
   - sent
   - already exists
   - failed

Data sent:
- title
- authors
- year
- journal
- DOI
- PMID
- URL
- abstract
- publication type
- search method/source
- labels
- notes
- PDF metadata if present
- source = META·SIFT
- screeningRecordId
- screeningProjectId

Backend:
1. Fix handoff endpoint/service.
2. Confirm linked META·LAB project ID is used.
3. Confirm Data Extraction entry is created in correct project.
4. Prevent duplicates by DOI/PMID/title/screeningRecordId.
5. Add handoff audit log.

Frontend:
1. After Second Review accept, show “Sent to Data Extraction.”
2. In META·LAB Data Extraction, refresh or refetch data so the article appears.
3. If already exists, show “Already in Data Extraction.”

QA:
1. Link META·SIFT project to META·LAB project.
2. Accept article in Second Review.
3. Open META·LAB Data Extraction.
4. Confirm article is present.

====================================================
BUG 6 — MEMBER PROGRESS VISIBILITY
====================================================

Problem:
Members should only see their own progress.
Only leader should see other members’ progress and whole-project progress.

Expected:
Regular project member/reviewer can see:
- their screened count
- their included count
- their excluded count
- their maybe count
- their own progress percentage

Regular member should NOT see:
- other members’ names/progress
- comparison between members
- team-wide detailed progress if it reveals other members’ work

Project leader can see:
- all member progress
- whole-project progress
- team comparison
- total screened
- total unscreened
- total conflicts
- total eligible for second review
- total accepted to Data Extraction

Backend:
1. Enforce visibility server-side.
2. Do not send other-member progress to non-leader users.
3. Add role checks.

Frontend:
1. If user is leader, show full whole-project progress.
2. If user is member, show only “My Progress.”
3. Hide team/member comparison for non-leaders.
4. If needed, show a simple aggregate that does not reveal individual member activity.

QA:
1. Login as leader, confirm full progress visible.
2. Login as member, confirm only own progress visible.
3. Confirm API does not leak other-member progress to member.

====================================================
QA FULL REGRESSION TEST
====================================================

QA must test all fixes before marking done.

Manual QA flow:
1. Login as admin.
2. Confirm META·SIFT admin/control panel works.
3. Login as project leader.
4. Open META·SIFT landing page.
5. Confirm project cards show linked META·LAB project, owner/leader, role, total articles.
6. Create/open linked META·SIFT project.
7. Confirm include keywords show by default.
8. Confirm exclude keywords show by default.
9. Select include keyword and confirm filtering/highlight.
10. Select exclude keyword and confirm filtering/highlight.
11. Confirm shown count / total count appears.
12. Upload PDF.
13. Preview PDF in Screening.
14. Preview PDF in Second Review.
15. Confirm no “connection reset.”
16. Send chat message as member A.
17. Login as member B.
18. Confirm unread badge appears.
19. Open chat.
20. Confirm unread badge clears.
21. Logout/login again.
22. Confirm badge does not reappear unless new message exists.
23. Leader accepts article in Second Review.
24. Confirm article appears in linked META·LAB Data Extraction.
25. Login as regular member.
26. Confirm only own progress visible.
27. Confirm other-member/whole-project progress hidden.
28. Login as leader.
29. Confirm whole-project progress and all member progress visible.

Automated tests:
Add/update tests for:
- default include keywords returned
- default exclude keywords returned
- keyword counts
- keyword filtering
- PDF preview endpoint returns application/pdf
- PDF endpoint access control
- chat unread count per user/project
- mark chat read
- project card linked META·LAB info
- second review accept → Data Extraction handoff
- member progress visibility
- leader progress visibility

Update:
- /tests/screening/report.md
- /tests/report.md

====================================================
FINAL REPORT
====================================================

Main Claude final report must include:
1. Root cause for include keywords not showing.
2. Root cause for chat notification always showing.
3. Root cause for PDF connection reset.
4. Root cause for Data Extraction handoff failure.
5. Backend changes.
6. Frontend changes.
7. Database changes.
8. Security/access-control changes.
9. QA manual test results.
10. Automated test results.
11. Known limitations.
12. Recommended next steps.

Do not return until all listed issues are fixed, tested, and documented.