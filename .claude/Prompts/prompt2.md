CLAUDE MAX — META·SIFT + META·LAB INTEGRATION UPGRADE

Goal:
Continue improving META·SIFT Beta and its integration with META·LAB.

This is a follow-up task. Do NOT rebuild the apps from scratch.
Read the current codebase, database schema, admin panel, META·SIFT routes, META·LAB routes, docs, and tests first.

Current problems:
1. Uploaded PDF full articles cannot be previewed in Screening or Second Review.
2. Resolved conflicts are not being sent to Second Review when the final resolution is Include.
3. META·SIFT controls in the admin/control panel are not working well.
4. META·SIFT admin section does not show projects.
5. I want the META·SIFT control panel to control everything related to META·SIFT.
6. META·LAB and META·SIFT project association is confusing.
7. Articles approved in META·SIFT Second Review are not appearing in META·LAB Data Extraction.
8. Admins should be able to access the control panel from META·SIFT.
9. Chat should move to a better global project-level drawer.
10. Screening left column should show per-member “new/viewed” status.
11. Disputes should have a clear dispute icon.
12. Keyword highlighting/filtering needs to be upgraded heavily.

Use the current app foundation. The original app already has systematic-review/meta-analysis logic, project data, validation, reference import, and research workflows, so do not remove or rewrite existing working features unnecessarily. 

Use the team:

1. Main Claude — Overall Manager / Integrator (can add new agents if think it is needed)
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. QA Developer
6. Website Manager / Public Website Agent
7. Collaboration & Realtime Agent

Autonomy:
Do not ask me for small confirmations.
Make the best technical/product/design decisions.
Implement, test, fix failures, document, then report.
Only stop if blocked by missing credentials, missing files, or a serious security issue.

Strict rules:
1. Do not wipe or reset the database.
2. Do not break META·LAB.
3. Do not break META·SIFT.
4. Keep META·SIFT removable/disableable.
5. Keep META·LAB and META·SIFT as separate apps/modules, but create a stronger shared association layer.
6. Do not expose private project data to non-members.
7. Never commit real secrets.
8. Do not mark complete until QA creates a full project and confirms the workflow works end-to-end.

========================================================
CORE ARCHITECTURE DECISION
========================================================

I want META·LAB and META·SIFT to feel like one project experience, but still remain separate apps.

Implement this with a shared parent concept:

Review Workspace

A Review Workspace can link:
- one META·LAB project
- one or more META·SIFT projects if needed
- shared owner/leader
- shared project title
- shared project status
- shared PICO/inclusion/exclusion
- shared PRISMA data handoff
- shared Data Extraction handoff

Important:
Do NOT merge all code into one app.
Do NOT make META·LAB dependent on META·SIFT startup.
Do NOT make META·SIFT dependent on META·LAB startup.

But create a strong association:
- A META·SIFT project should clearly show which META·LAB project/workspace it belongs to.
- A META·LAB project should clearly show which META·SIFT project is linked.
- Articles accepted in META·SIFT Second Review should automatically appear in the linked META·LAB Data Extraction tab.
- PRISMA in META·LAB should update from the linked META·SIFT project.

If there is no linked project:
- show a clear “Link to META·LAB project” option
- do not crash
- do not silently fail

Document this architecture in:
docs/manager/meta-lab-meta-sift-integration.md

========================================================
TASK 1 — FIX PDF PREVIEW IN SCREENING AND SECOND REVIEW
========================================================

Problem:
Uploaded full-article PDFs cannot be previewed in Screening or Second Review.

Requirements:
1. Each article/record can have a PDF attachment.
2. PDF can be uploaded.
3. PDF metadata is saved.
4. PDF can be previewed in:
   - Screening tab
   - Second Review tab
5. PDF preview should work inside the browser if possible.
6. If browser preview fails, show download/open button.
7. PDF should be accessible only to project members.
8. Do not expose public unauthenticated PDF URLs.
9. Validate PDF:
   - MIME type
   - extension
   - size limit
10. Add clear error messages:
   - upload failed
   - preview unavailable
   - unauthorized
   - file not found

Frontend:
- Add PDF preview panel or modal.
- In article detail, add:
  - Upload PDF
  - View PDF
  - Replace PDF if permitted
  - Remove PDF if permitted

Backend:
- Add secure file serving endpoint.
- Add authorization check.
- Store file metadata.
- Store file safely for local development.
- Document production storage plan.

Suggested endpoints:
- POST /api/screening/projects/:projectId/records/:recordId/pdf
- GET /api/screening/projects/:projectId/records/:recordId/pdf
- DELETE /api/screening/projects/:projectId/records/:recordId/pdf

========================================================
TASK 2 — RESOLVED CONFLICTS SHOULD GO TO SECOND REVIEW
========================================================

Problem:
If a conflict is resolved as Include, it should be sent to Second Review, but currently it is not.

Requirements:
1. Conflict resolution must create a final resolution decision.
2. If final resolved decision is Include:
   - record becomes eligible for Second Review
   - record appears in Second Review list
3. If final resolved decision is Exclude:
   - record does not appear in Second Review
   - exclusion reason should be stored if provided
4. If Maybe/Uncertain:
   - keep it in disputed/pending area
5. Add audit log:
   - who resolved
   - decision
   - time
   - reason/note
6. Add tests for resolved include → Second Review.

========================================================
TASK 3 — FIX META·SIFT CONTROL PANEL
========================================================

Problem:
META·SIFT control panel does not appear to work correctly. It does not show projects, and it does not control everything.

Requirements:
Create a complete META·SIFT section inside the admin/control panel.

Admins should be able to control literally everything that is safe to control:

A. Overview
- total META·SIFT projects
- active projects
- archived projects
- done projects
- total imported records
- total screened records
- total included
- total excluded
- total maybe
- total disputes
- total conflicts resolved
- total second-review articles
- total sent to META·LAB Data Extraction
- total PDFs uploaded
- total chat messages
- active members/reviewers

B. Projects
Show all META·SIFT projects:
- project title
- linked META·LAB project/workspace
- owner/leader
- total articles
- total members
- status
- created date
- updated date
- done/not done
- disabled/active/archived
- second-review count
- Data Extraction handoff count

Admin actions:
- view metadata
- enable/disable project
- archive/unarchive
- inspect project health
- do not expose private content unnecessarily unless admin explicitly opens project detail
- ensure admin-only access

C. Members
Admin can see:
- project members
- roles
- status
- leader
- active/inactive
- screening progress
- chat permission

D. Settings
Admin can control:
- enable/disable META·SIFT
- enable/disable project creation
- enable/disable import
- enable/disable export
- enable/disable PDF upload
- enable/disable duplicate detection
- enable/disable conflict resolution
- enable/disable chat
- enable/disable second review
- require two reviewers for inclusion
- minimum include quorum number
- default blind mode
- max PDF file size
- max records per project
- maintenance message

E. Handoff
Admin can view:
- META·SIFT → META·LAB handoff logs
- failed handoffs
- successful handoffs
- retry failed handoff if safe

F. Audit log
Show:
- admin changes
- project leader changes
- member changes
- conflict resolutions
- second-review accept/reject
- Data Extraction handoff
- PDF uploads/removals

Admin access from META·SIFT:
If the logged-in user is admin, show an admin/control-panel icon or button from META·SIFT.
This should route to the control panel.
Normal users must not see this.

========================================================
TASK 4 — STRONGER META·LAB ↔ META·SIFT ASSOCIATION
========================================================

Problem:
There is confusion about which META·SIFT project sends accepted articles to which META·LAB project.

Requirements:
1. Add a clear link between META·LAB project and META·SIFT project.
2. Show linked project name on both sides.
3. From META·LAB:
   - show linked META·SIFT project
   - allow opening it
   - show screening progress
4. From META·SIFT:
   - show linked META·LAB project
   - allow opening it
   - show Data Extraction handoff status
5. If accepted Second Review articles are sent to META·LAB, they must appear in the correct linked META·LAB project Data Extraction tab.
6. Prevent sending to the wrong project.
7. Add “link project” and “unlink project” if safe.
8. Add validation:
   - if no linked META·LAB project, cannot auto-send
   - show prompt to link project
9. Handoff should be idempotent:
   - do not duplicate the same article in Data Extraction
   - match by DOI, PMID, title, or screeningRecordId
10. Add handoff status:
   - pending
   - sent
   - failed
   - already exists

========================================================
TASK 5 — FIX SECOND REVIEW → DATA EXTRACTION HANDOFF
========================================================

Problem:
After Second Review is sent to META·LAB, it does not show in Data Extraction.

Requirements:
1. Investigate the current handoff.
2. Find exact failing API/database logic.
3. Fix backend handoff.
4. Fix frontend refresh.
5. Add Data Extraction entry from accepted Second Review article.
6. Include metadata:
   - title
   - authors
   - year
   - journal
   - DOI
   - PMID
   - URL
   - abstract
   - publication type
   - source database/search method
   - labels
   - notes
   - PDF metadata if present
   - source = META·SIFT
7. After handoff, META·LAB Data Extraction tab should update.
8. If app is already open, refresh/reload data automatically or show “new articles added” state.
9. Add tests.

========================================================
TASK 6 — PROJECT CHAT REDESIGN
========================================================

Current chat is good, but it should not live only inside Screening.

Move chat to project-level UI.

Requirements:
1. Add chat icon in the same top/tab row area as:
   - Overview
   - Screening
   - Second Review
   - Duplicates
   - Conflicts
   - Import
   - Export
2. Place the chat icon on the right side, not with the left tabs.
3. Chat icon should show notification badge if there are new messages.
4. Chat should open as a slide-in drawer from the side of the screen.
5. Drawer should overlay the page without affecting layout.
6. Clicking outside chat closes it.
7. Pressing close button closes it.
8. After sending a message, cursor/focus should remain in the text field.
9. Chat should be available across:
   - Overview
   - Screening
   - Second Review
   - Duplicates
   - Conflicts
   - Import
   - Export
   - Settings
10. Chat should be project-specific.
11. Users outside project cannot see it.
12. Leader controls who can send messages.
13. Notification badge should be per member.

========================================================
TASK 7 — SCREENING LEFT COLUMN NEW/VIEWED/DISPUTE STATUS
========================================================

Requirements:
Each member should see articles as “new” until they open/view them.

Rules:
1. New/viewed state is per member.
2. If member opens an article, mark it viewed for that member.
3. Viewed status is independent of decision status.
4. An article can be viewed but still undecided.
5. Add filter:
   - New to me
   - Viewed by me
6. If a record has dispute/conflict, show clear dispute icon.
7. Do not represent everything as only check/cross.
8. Status indicators should include:
   - undecided
   - included by me
   - excluded by me
   - maybe by me
   - quorum included
   - disputed
   - second review eligible
   - sent to Data Extraction
9. Use clear icons and labels.

========================================================
TASK 8 — DEFAULT KEYWORD HIGHLIGHTING AND FILTERING
========================================================

Add default keyword sets to every META·SIFT project.

These are default suggestions, editable per project.

Include keywords default list:
- randomized
- trail
- compared with
- controlled trial
- randomly
- randomized controlled trial
- randomly assigned
- assigned to
- randomised
- double blind
- controlled study
- placebo
- randomly allocated
- RCT
- placebo controlled
- single blind
- randomised controlled trial
- parallel group
- control groups
- parallel groups
- cross over
- double blinded
- CCT
- doubleblind
- double marked
- doubleblinded
- single masked
- controlled design

Exclude keywords default list:
- trails
- randomized controlled trials
- meta-analysis
- systematic review
- cohort
- this review
- observational
- non-randomized
- retrospectively
- retrospective study
- sensitivity and specificity
- literature review
- in Vitro
- animal
- prevalence
- nonrandomized
- case control
- case reports
- cross-sectional
- regression analysis
- retrospective cohort
- randomised controlled trials
- trail
- animals
- non-randomised
- rat
- survey
- single arm
- case report
- regression analyses
- fish
- porcine
- longitudinal
- healthy controls
- soil
- beagle
- equine
- murine
- rabbit
- rodent
- beagles
- broiler
- cadaver
- piglets
- rabbits
- rodents
- broilers
- cadavers
- purebred
- cadaveric
- transgenic
- age-matched
- healthy control

Note:
Some words may have typos or variants like “trail” and “trails.”
Keep them for now because they may catch imported text errors, but document that the list is editable.

Keyword UI requirements:
1. Right column should show:
   - Keywords for Include
   - Keywords for Exclude
2. Each keyword has a checkbox.
3. Include “Select All” for include keywords.
4. Include “Select All” for exclude keywords.
5. Add “Show more” and “Show less.”
6. Default view should show a shorter list.
7. Expanded view shows all.
8. Beside each keyword, show number of articles that contain that word/phrase.
9. Count articles, not occurrences.
   - If an article contains the keyword 5 times, count it as 1 article.
10. Selecting one or more keywords filters article list to only articles containing selected keywords.
11. Multiple selected keywords should combine logically in a clear way:
   - default OR behavior: show articles containing any selected keyword
   - document this
12. Show:
   - number of articles currently shown / total project articles
13. Selected include keywords highlight matching text green.
14. Selected exclude keywords highlight matching text red.
15. If both include and exclude match same text, handle priority consistently.
16. Allow turning highlights off without clearing filters.
17. Allow clearing all filters.
18. Keyword counts should update based on current project records.

Example:
Shown: 47 / 312 articles

Research Engine:
Create reusable functions for:
- normalize text
- phrase matching
- keyword article counts
- keyword filtering
- highlight token generation

Frontend:
Do not directly mutate abstract HTML unsafely.
Avoid XSS.
Render highlights safely.

========================================================
TASK 9 — QA FULL TEST
========================================================

QA must not mark done until full manual test is completed.

Required manual QA flow:
1. Login as admin.
2. Confirm admin can access control panel from META·SIFT.
3. Confirm META·SIFT control panel shows projects.
4. Confirm settings save.
5. Login as normal user.
6. Create/link META·LAB project.
7. Create/link META·SIFT project.
8. Import references.
9. Upload PDF to at least one article.
10. Preview PDF in Screening.
11. Preview PDF in Second Review.
12. Add second reviewer.
13. Reviewer 1 screens records.
14. Reviewer 2 screens records.
15. Confirm one decision per reviewer per article.
16. Confirm new/viewed state works per member.
17. Confirm dispute icon appears for conflict.
18. Resolve conflict as Include.
19. Confirm article appears in Second Review.
20. Accept article in Second Review.
21. Confirm it appears in linked META·LAB Data Extraction.
22. Confirm PRISMA updates.
23. Open chat from Overview.
24. Send message.
25. Confirm focus remains in text field.
26. Confirm chat notification badge works.
27. Open chat from Screening and Second Review.
28. Confirm same project chat appears.
29. Test keyword filters:
    - select include keyword
    - select exclude keyword
    - select multiple
    - confirm count shown / total
    - confirm green/red highlights
    - confirm Show more/less
    - confirm clear filters
30. Confirm main META·LAB still works if META·SIFT is disabled.
31. Confirm no private data leaks between users.

Automated tests:
Add tests for:
- PDF upload/preview endpoint authorization
- resolved conflict include → second review
- second review accept → data extraction handoff
- project association
- admin META·SIFT project list
- admin META·SIFT settings
- chat drawer notification logic
- per-member viewed state
- dispute icon state
- keyword article counts
- keyword filtering
- safe highlighting
- one decision per reviewer
- user/project access control

Update:
- /tests/screening/report.md
- /tests/report.md

========================================================
FINAL DELIVERABLES
========================================================

Deliver:
1. PDF preview fixed in Screening.
2. PDF preview fixed in Second Review.
3. Resolved included conflicts sent to Second Review.
4. META·SIFT control panel fully functional.
5. META·SIFT projects visible in control panel.
6. Admin can access control panel from META·SIFT.
7. Strong META·LAB ↔ META·SIFT project association.
8. Second Review accepted articles appear in META·LAB Data Extraction.
9. Chat moved to project-level right-side icon/drawer.
10. Chat notification badge.
11. Chat drawer closes on outside click.
12. Chat input remains focused after sending.
13. Screening left column new/viewed per member.
14. Dispute icon.
15. Default include/exclude keyword lists.
16. Keyword checkboxes.
17. Keyword article counts.
18. Keyword filtering.
19. Shown count / total count.
20. Green/red highlighting.
21. Show more/show less.
22. Full QA project test completed.
23. Tests updated.
24. Docs updated.

Final report must include:
1. What was fixed.
2. Root causes found.
3. Backend changes.
4. Frontend changes.
5. Database changes.
6. Project association design.
7. Data Extraction handoff explanation.
8. Admin/control panel changes.
9. Keyword filtering/highlighting explanation.
10. PDF preview explanation.
11. Chat redesign explanation.
12. Manual QA results.
13. Automated test results.
14. Known limitations.
15. Recommended next steps.

Do not return until this is implemented, tested with a full project, and documented.