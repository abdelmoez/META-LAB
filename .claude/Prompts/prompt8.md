CLAUDE MAX / FABLE 5.0 — LANDING PAGE, OPS CONTROL CENTER, LAYOUT BUGS, AND CHAT PLACEMENT

Claude, this is a new design-focused and UX-focused prompt.

I am talking to you directly here: I still do not like the index landing page design and aesthetic. I want you to rethink it deeply and make a new overhaul design.

I do not want small cosmetic edits.
I want a serious redesign.

Before implementing, inspect the current landing page, ops console, META·LAB, META·SIFT, theme system, layout system, and shared components. Then give your own professional opinion and make a decision. Do not come back to me for small confirmations.

You can add your own suggestions and design judgment. I want your opinion, not just execution.

Use the team:
1. Main Claude — Overall Manager / Integrator
2. Frontend App Developer
3. Website Manager / Public Website Agent
4. Backend, Auth & Database Developer
5. Collaboration & Realtime Agent
6. QA Developer
7. Security & Diagnostics Agent if needed

Primary agents for this task:
- Main Claude
- Website Manager
- Frontend App Developer
- QA Developer

Backend only helps if ops metrics/data endpoints are needed.

====================================================
TASK 1 — COMPLETELY RETHINK THE INDEX LANDING PAGE
====================================================

Current issue:
I still do not like the index landing page design and aesthetic.

I want a new overhaul design that is very attractive, with moving pieces, but not too flashy.

I want you to think like a world-class product designer.

You can use:
- advanced CSS
- SVG
- Canvas if useful
- lightweight animation libraries if already available or easy to add
- motion/animation
- graphs
- infographics
- interactive visuals
- abstract research/data visuals
- forest plot-inspired visuals
- PRISMA-inspired visuals
- evidence-map visuals
- subtle particles or moving lines if tasteful
- screenshots/mockups of the app if useful
- animated workflow diagrams
- whatever design approach you think is best

But do NOT make it generic.
Do NOT make it look like a random AI SaaS template.
Do NOT make it flashy without meaning.
Do NOT use fake stock-looking content.
Do NOT make it slow or heavy.

Design goal:
The landing page should feel like a serious, premium, institutional research platform for:
- hospitals
- universities
- medical researchers
- systematic review teams
- meta-analysis groups
- academic institutes
- evidence synthesis labs

It should be:
- beautiful
- modern
- premium
- academic
- credible
- interesting
- memorable
- alive with subtle motion
- not childish
- not generic
- not overdesigned

Night mode should remain the main visual identity.

I want you to be the designer that everyone wants to design their website, apps, and products.

Before implementing, create:

docs/manager/landing-page-redesign-opinion.md

Include:
1. What is wrong with the current landing page.
2. What design direction you recommend.
3. What visual metaphor you will use.
4. What animations/moving parts you will add.
5. How you will keep it professional and not flashy.
6. How you will make it attractive to institutions.
7. What sections you will keep, remove, or redesign.
8. Why your design is better.

Then implement it.

Landing page suggested structure:
- Hero section with strong visual identity.
- Animated research/evidence synthesis visual.
- Clear product statement.
- CTA buttons.
- Evidence workflow section.
- META·LAB + META·SIFT integration section.
- Research-engine / analysis credibility section.
- Collaboration and project-control section.
- Institution-grade security/workspace section.
- Visual app preview.
- Final CTA.

Important:
Keep copy concise.
Let the visuals and structure do the work.

====================================================
TASK 2 — OPS CONTROL CENTER REDESIGN
====================================================

I also want the ops control panel to feel more like a real control center.

Not confusing.
Not overwhelming.
But powerful.

Current goal:
The ops console should include graphs, infographics, live-feeling animation, active tracking, and better visual hierarchy.

It should feel like:
- a research platform command center
- admin operations dashboard
- live system health monitor
- project activity tracker
- user/support management hub

But it must stay user-friendly with excellent UX.

Improve:
- overview cards
- user metrics
- project metrics
- META·SIFT metrics
- activity charts
- unique login metrics
- project completion metrics
- done-today metrics
- support/message metrics
- linked project status
- live/recent activity feed
- system health indicators
- admin/mod role clarity

Use tasteful motion:
- animated counters
- chart transitions
- subtle pulse for live status
- progress visualizations
- no distracting animations

Do not create fake data.
If data is missing, create useful empty states or connect existing endpoints.

Before implementing, create:

docs/manager/ops-control-center-redesign-opinion.md

Include:
1. What is weak in the current ops console.
2. What should become more visual.
3. Which graphs/infographics you recommend.
4. Which metrics matter most.
5. What should admins see.
6. What should mods see.
7. How to keep it powerful but not confusing.

Then implement.

====================================================
TASK 3 — FIX TEXT OVERFLOW / CONTAINER OVERLAP BUGS
====================================================

There is a UI bug where long text overlaps or escapes its container.

Examples:
1. Project Control → Project Info
   - Owner
   - Last modified
   - Workspace
   are getting out of the box if the title/text is long.

2. “⬡ Linked to META·SIFT — PRISMA auto-filled”
   - the title can get out of the box/container.

This needs to be fixed globally, not only patched in one place.

Requirements:
1. Long titles must wrap or truncate gracefully.
2. Text must never escape cards/containers.
3. Use proper CSS:
   - min-width: 0
   - overflow-wrap
   - word-break when needed
   - text-overflow ellipsis where appropriate
   - responsive grid/flex fixes
4. Cards should resize or wrap cleanly.
5. Preserve readability.
6. Add tooltip/full-title display if truncating important text.
7. Fix this across META·LAB, META·SIFT, and ops cards where similar bugs may happen.

QA:
Test with very long:
- project title
- workspace title
- owner email
- linked project title
- DOI/URL
- imported article title
- member name/email

No text should overflow outside the container.

====================================================
TASK 4 — CHAT ICON PLACEMENT OPINION AND IMPLEMENTATION
====================================================

I think it may be better to move the chat icon to where the account and notification icon are.

Claude, I want your opinion on this.

My thought:
The chat icon is more like a global/project utility, similar to notifications/account, not a normal workflow tab. So maybe it belongs in the top-right utility cluster.

Please inspect the app first and decide.

If you agree:
Move the chat icon to the top-right area beside:
- account dropdown
- notification bell

Requirements if moved:
1. Chat icon should appear in the top-right utility area.
2. It should only appear inside a project/workspace context where chat exists.
3. It should use the same monochrome icon style.
4. It should show unread badge.
5. It should open the same slide-in chat drawer.
6. It should not disrupt page layout.
7. It should work in META·LAB and META·SIFT.
8. If META·LAB and META·SIFT are linked, the chat should be shared for the same Review Workspace.
9. If no project context exists, hide or disable chat icon.
10. Keep notification bell separate from chat.

If you disagree:
Write your reasoning in the plan, choose a better UX, and implement that.

Do not ask me.
Make a decision and act.

====================================================
TASK 5 — DESIGN SYSTEM CLEANUP
====================================================

While doing this, improve the design system enough to prevent inconsistency.

Requirements:
1. Use theme tokens instead of random hardcoded colors.
2. Keep night mode primary.
3. Keep day mode polished.
4. Use consistent spacing.
5. Use consistent typography.
6. Use consistent card styles.
7. Use consistent icon style.
8. Use consistent motion duration/easing.
9. Make landing page, app, and ops feel like the same product family.

Do not redesign so aggressively that the workflow becomes confusing.
The product should become more premium, not less usable.

====================================================
TASK 6 — QA AND REGRESSION TESTING
====================================================

QA must test:

Landing page:
1. New design renders.
2. Animations work.
3. No layout shift issues.
4. No performance disaster.
5. Looks good in night mode.
6. Looks good in day mode.
7. Responsive on laptop, desktop, ultrawide, and mobile-ish widths.
8. CTA links work.

Ops console:
1. Overview loads.
2. Graphs/infographics render.
3. Empty states work.
4. Admin sees full console.
5. Mod still sees limited console.
6. No unauthorized metrics leak to Mod.
7. Animations do not break usability.

Overflow bug:
1. Long project title does not escape.
2. Long workspace title does not escape.
3. Long owner email does not escape.
4. Long linked META·SIFT title does not escape.
5. Long article title does not break card.
6. Long DOI/URL does not break layout.

Chat:
1. Chat icon placement works.
2. Unread badge works.
3. Chat drawer opens.
4. Chat drawer closes.
5. Chat works in META·LAB.
6. Chat works in META·SIFT.
7. Shared workspace chat still works.
8. Non-member cannot access chat.

Regression:
1. META·LAB project creation still works.
2. META·SIFT project creation still works.
3. Linked projects still work.
4. Project Control still works.
5. Owner/leader/member permissions still work.
6. Viewer read-only still works.
7. Ops/mod access still works.
8. Build passes.

Update:
- /tests/report.md
- /tests/screening/report.md if relevant

====================================================
FINAL DELIVERABLES
====================================================

Deliver:
1. New index landing page overhaul.
2. Ops control center redesign with graphs/infographics/live-feeling tracking.
3. Text overflow/container overlap bugs fixed globally.
4. Chat icon placement decision and implementation.
5. Design system cleanup.
6. QA completed.
7. Docs updated.

Final response must include:
1. Your honest design opinion.
2. What design direction you chose.
3. Why the landing page is better now.
4. What changed in ops console.
5. How you fixed text overflow globally.
6. Your decision on chat icon placement.
7. Files changed.
8. Manual QA results.
9. Automated/build test results.
10. Known limitations.
11. Recommended next design/product steps.

Do not return until implemented, tested, and documented.