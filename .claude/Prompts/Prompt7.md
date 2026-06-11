CLAUDE MAX / FABLE 5.0 — DEEP PRODUCT, DESIGN, SECURITY, AND SYSTEM UPGRADE PROMPT

Claude, I want you to treat this as a high-level product and engineering upgrade.

I do not want shallow implementation.
I want your opinion, your judgment, and your best suggestions.

Before coding:
1. Inspect the full app deeply.
2. Run it locally.
3. Observe the current UI/UX.
4. Check the workflows in META·LAB and META·SIFT.
5. Review the database/auth/permissions system.
6. Review the ops/admin/mod console.
7. Review the landing page.
8. Review security and diagnostics.
9. Then write your own plan and opinion before implementing.

I want you to think like:
- a senior full-stack architect
- a product designer
- a security reviewer
- a UX researcher
- a serious medical research software builder
- a SaaS founder preparing the app for real users

Use the full team:

1. Main Claude — Overall Manager / Integrator
2. Backend, Auth & Database Developer
3. Frontend App Developer
4. Research Engine Developer
5. QA Developer
6. Website Manager / Public Website Agent
7. Collaboration & Realtime Agent
8. Security & Diagnostics Agent — add this extra agent if useful

Autonomy:
Do not ask me small questions.
Make strong decisions.
If there are multiple good options, choose the best one and explain why.
If you disagree with part of my request, say so in the planning document and propose a better solution.
Then implement the best version.

Create this first:

docs/manager/claude-opinion-and-upgrade-plan.md

This document must include:
1. Your honest opinion of the current app.
2. What feels strong.
3. What feels weak.
4. What feels confusing.
5. What should be redesigned.
6. What should not be changed because it works well.
7. Your recommended visual direction.
8. Your recommended UX direction.
9. Your recommended security fixes.
10. Your recommended diagnostics/testing plan.
11. Your final implementation plan.

Do not just obey blindly. I want your professional opinion and suggestions.

====================================================
TASK 1 — FIX MOD PERMISSION LIMITATIONS
====================================================

Current issue:
Mod should not be able to edit Admins or other Mods.

Rules:
- Admin can manage users, mods, and ordinary users.
- Mod can help with limited user/support tasks.
- Mod cannot edit Admin.
- Mod cannot edit another Mod.
- Mod cannot promote anyone to Mod or Admin.
- Mod cannot change roles above their authority.
- Mod cannot change Admin/Mod password unless you decide a safe support flow exists; default should be no.
- Mod can edit only ordinary users if allowed.
- Mod can view/respond to messages if allowed.

Backend:
Enforce this server-side.
Do not rely only on hiding frontend buttons.

Frontend:
Hide edit controls for Admin and Mod rows when current user is Mod.
Show a small lock/permission note if helpful.

QA:
Test:
- Mod cannot edit Admin.
- Mod cannot edit another Mod.
- Mod can perform allowed support actions on regular users.
- Admin can manage Mods.

====================================================
TASK 2 — PROJECT OVERVIEW ALIGNMENT FIX
====================================================

Current issue:
In project overview, the project and linked META·SIFT containers are not aligned with the rest of the containers.

Fix:
- Align these cards/containers with the rest of the overview layout.
- Make spacing, width, height, padding, and typography consistent.
- Keep them visually integrated with the design.
- Do not make this a one-off hack.
- Fix responsive behavior too.

QA:
Check project overview at:
- laptop width
- 1080p
- 1440p
- ultrawide

====================================================
TASK 3 — NEW HIGH-END DESIGN DIRECTION
====================================================

I want a new design direction for the whole product.

Especially:
- index landing page
- META·LAB app
- META·SIFT app
- ops/admin/mod console

Important:
Do not destroy the workflow.
Do not move everything randomly.
Keep the existing general structure and feature locations where they make sense.
But improve the UI and UX deeply.

Design goal:
The app should feel like a serious institutional-grade research platform for:
- medical researchers
- academic teams
- hospitals
- universities
- research institutes
- systematic review teams
- meta-analysis groups

It should not look generic.
It should not look like a typical AI-generated SaaS template.
It should not be flashy without meaning.
It should be attractive, elegant, memorable, and interesting to look at.

Landing page:
Create a much better index landing page.

It should include:
- premium hero section
- app name first
- strong research-focused tagline
- animated but tasteful visuals
- graphs/infographics related to evidence synthesis
- systematic review workflow visual
- meta-analysis/forest plot-inspired visual language
- institution-grade trust feeling
- clear CTA
- meaningful product preview
- sections that make users understand what this app does quickly
- not too much text
- not a full tutorial
- visually rich but fast

The landing page should attract big institutions and serious researchers.
It should feel polished enough that a university, research group, or hospital department would take it seriously.

Suggested visual style:
- night mode as default
- deep academic dark background
- refined off-white text
- subtle blue/teal/green/gold accents
- monochrome icons
- refined graphs
- subtle motion
- cards with quiet depth
- research-paper/data-grid inspiration
- forest plot / PRISMA / evidence map visual motifs

Avoid:
- generic purple-blue AI gradients
- random glowing blobs
- stock-looking AI sections
- childish icons
- fake metrics
- fake testimonials
- too much animation
- low-contrast design

====================================================
TASK 4 — REDESIGN META·LAB AND META·SIFT WITHOUT BREAKING WORKFLOW
====================================================

Before implementing, inspect and observe:
- META·LAB dashboard
- META·LAB project overview
- data extraction
- methods/equations
- PRISMA
- project control
- META·SIFT overview
- screening
- second review
- duplicates
- conflicts
- import/export
- chat
- ops/admin/mod console

Then create a design plan.

Goal:
Make the apps more appealing and interesting while preserving functionality.

Improve:
- spacing
- hierarchy
- typography
- card design
- tabs
- tables
- project cards
- buttons
- status badges
- forms
- empty states
- loading states
- error states
- progress visualization
- member/permission displays
- screening layout polish
- overview dashboards
- ops console readability

Do not compromise:
- workflow
- permissions
- data safety
- project linking
- reviewer decisions
- META·LAB/META·SIFT separation
- research-engine calculations

====================================================
TASK 5 — DAY MODE AND NIGHT MODE
====================================================

Add two modes:
- Night mode
- Day mode

Night mode should be the main/default mode.

Requirements:
1. Night mode default.
2. Day mode available from user/account dropdown or settings.
3. Save user preference.
4. Apply across:
   - landing page
   - META·LAB
   - META·SIFT
   - ops/admin/mod console
5. Avoid hardcoded colors scattered everywhere.
6. Use a proper theme token system if possible.
7. Keep both modes professional.
8. Night mode should not have poor contrast.
9. Day mode should not look like an afterthought.

QA:
- Toggle mode.
- Refresh page.
- Preference persists.
- Major pages look good in both modes.

====================================================
TASK 6 — REMOVE “RAYYAN & SCREENING” SECTION
====================================================

Remove the “Rayyan & Screening” section because it no longer serves anything.

Everything should be included naturally inside the app now.

Rules:
- Do not call anything Rayyan.
- META·SIFT remains the app/module name.
- If there is still a need to access META·SIFT, integrate it through:
  - linked project controls
  - META·LAB project overview
  - shared workspace navigation
  - project switcher
  - main app navigation
- Remove stale/unused Rayyan references from UI.
- Keep docs clear that META·SIFT is our own screening module.

QA:
- No “Rayyan & Screening” visible in app UI.
- META·SIFT still accessible where appropriate.
- No broken links.

====================================================
TASK 7 — SECURITY CHECK AND FULL DIAGNOSTICS
====================================================

Run a full security check and full diagnostic test of the app.

I want you to deeply check:
- auth
- sessions/tokens/cookies
- admin/mod access
- user ownership
- workspace membership
- META·LAB permissions
- META·SIFT permissions
- project linking
- viewer read-only enforcement
- owner/leader protections
- ops console access
- message replies
- email config safety
- file upload safety if relevant
- API route protection
- CORS
- environment variables
- secrets
- database safety
- destructive commands
- migrations
- input validation
- XSS risks in abstracts/chat/messages
- imported reference sanitization
- chat permissions
- notifications
- realtime event authorization

Create:
docs/manager/security-and-diagnostics-report.md

Report must include:
1. What was checked.
2. What passed.
3. What failed.
4. What was fixed.
5. What still needs work.
6. High-priority risks.
7. Medium-priority risks.
8. Low-priority risks.
9. Recommended next security improvements.

Do not perform offensive hacking.
This is defensive security review of my own app.

====================================================
TASK 8 — FULL FLOW DIAGNOSTICS
====================================================

Run a full flow check of the app.

Test these flows:

META·LAB:
- register/login
- create project
- project overview
- project control
- add member
- change permissions
- viewer read-only
- data extraction
- PRISMA
- methods/equations
- linked META·SIFT
- project rename
- project status
- autosave
- realtime updates if implemented

META·SIFT:
- create/open linked project
- import records
- duplicate management
- screening
- keyword highlighting
- two-reviewer decisions
- conflict resolution
- second review
- accepted article to META·LAB Data Extraction
- project overview
- project control
- chat
- notifications
- member permissions
- owner/leader rules

Ops/Admin/Mod:
- admin login
- mod login
- mod limited access
- user editing
- messages
- message notification clearing
- email reply fallback
- metrics
- linked project visibility
- project progress
- unique login metrics
- last active

Create:
docs/manager/full-diagnostics-report.md

This report should include:
1. Tested flows.
2. Passed flows.
3. Broken flows.
4. Fixes implemented.
5. Remaining recommended fixes.
6. Your suggestions for the next major upgrade.

====================================================
TASK 9 — GIVE YOUR SUGGESTIONS AFTER CHECKING EVERYTHING
====================================================

After the security check and diagnostics, give me your professional suggestions.

Create:
docs/manager/claude-product-suggestions.md

Include:
1. What should be improved next.
2. What features are missing.
3. What UX is still weak.
4. What security should be hardened before public launch.
5. What database/backend areas should be cleaned.
6. What should be simplified.
7. What should be postponed.
8. What could make this app attractive to institutions.
9. What could make this app useful for researchers.
10. What could make the app feel more premium and trustworthy.

I want your opinion. Do not be passive.

====================================================
TASK 10 — MONOCHROME ICON SYSTEM
====================================================

Change icons to be without color.

Current issue:
I do not like colored icons like bell, home, projects, etc.

Requirements:
1. Replace colored icons with monochrome icons.
2. Use consistent stroke width.
3. Use currentColor or theme-aware color.
4. Icons should work in night and day modes.
5. Notification badge can still use subtle accent color if needed, but icons themselves should be monochrome.
6. Keep icon style elegant and professional.

Apply to:
- bell
- home
- projects
- user/account
- settings
- ops/admin
- chat
- notifications
- project controls
- META·LAB navigation
- META·SIFT navigation
- landing page icons

QA:
- Check icons in night mode.
- Check icons in day mode.
- No random colored icons remain unless intentionally approved.

====================================================
TASK 11 — ADD PROJECT CHAT TO META·LAB TOO
====================================================

Implement project chat in META·LAB as well.

Important:
The chat should be the same shared project chat between META·LAB and META·SIFT when they belong to the same Review Workspace.

Requirements:
1. META·LAB project should have chat access.
2. META·SIFT project should have chat access.
3. If linked through same Review Workspace, both apps show the same chat.
4. Messages sent in META·LAB appear in META·SIFT.
5. Messages sent in META·SIFT appear in META·LAB.
6. Chat is workspace/project-specific.
7. Only project members can view chat.
8. Leader/owner can control who can send messages.
9. Chat icon should be in the project header/tab row, on the right side.
10. Chat opens as slide-in drawer.
11. Clicking outside closes it.
12. Sending message keeps cursor in text field.
13. Unread notification badge works.
14. Typing indicator works if implemented.
15. Chat permissions enforced server-side.

Frontend:
- Add shared ProjectChatDrawer component if possible.
- Use it in META·LAB and META·SIFT.
- Avoid duplicated chat UI.

Backend:
- Chat should use ReviewWorkspace ID when projects are linked.
- If standalone, use module project ID safely.
- Enforce membership.

QA:
- Send message in META·LAB.
- See it in META·SIFT.
- Send message in META·SIFT.
- See it in META·LAB.
- Non-member cannot access chat.
- Read/unread works across both apps.

====================================================
FINAL QA REQUIREMENTS
====================================================

QA must run manual and automated tests before marking complete.

Manual QA:
1. Mod cannot edit admin.
2. Mod cannot edit other mods.
3. Project overview containers aligned.
4. Landing page redesigned.
5. META·LAB redesigned without workflow breakage.
6. META·SIFT redesigned without workflow breakage.
7. Night mode default.
8. Day mode works.
9. Theme persists.
10. Rayyan & Screening removed.
11. META·SIFT still accessible properly.
12. Security check completed.
13. Full diagnostics completed.
14. Monochrome icons applied.
15. META·LAB chat works.
16. Shared META·LAB/META·SIFT chat works.
17. Non-member chat blocked.
18. Admin/mod/user access still correct.
19. Viewer read-only still enforced.
20. Accepted second-review article still reaches Data Extraction.
21. Main app still builds and runs.

Automated tests:
- role restrictions for Mod
- owner/leader/member access
- theme toggle/persistence
- user dropdown/nav still works
- no Rayyan route/nav references
- chat access control
- shared workspace chat
- security route checks
- basic diagnostics smoke tests
- app build

Update:
- /tests/report.md
- /tests/screening/report.md if relevant

====================================================
FINAL DELIVERABLES
====================================================

Deliver:
1. Mod cannot edit Admins or Mods.
2. Project overview alignment fixed.
3. New landing page design.
4. META·LAB UI polish/redesign.
5. META·SIFT UI polish/redesign.
6. Night/day mode with night as default.
7. Rayyan & Screening section removed.
8. Security check report.
9. Full diagnostics report.
10. Claude/team suggestions report.
11. Monochrome icon system.
12. Project chat added to META·LAB.
13. Shared chat between META·LAB and META·SIFT.
14. Tests updated.
15. Docs updated.

Final response must include:
1. Your opinion of the app before and after.
2. What you redesigned.
3. What you fixed.
4. Security findings.
5. Diagnostics findings.
6. Product suggestions.
7. Files changed.
8. Manual QA results.
9. Automated test results.
10. Known limitations.
11. Recommended next steps.

Do not return until implemented, tested, and documented.