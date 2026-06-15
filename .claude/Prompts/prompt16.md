First inspect /template completely before changing anything. Do not start coding until you understand the template design system.
 I want you to redesign the frontend of my existing META·LAB / META·SIFT app using the design template already present in my project at:

/template

Inside /template there is a full landing page design from “Nextly — Landing Page Template for startups.”

Your task is to inspect that template first, understand its design language, layout, spacing, typography, components, animations, colors, and structure, then apply that design direction across my app.

This is a FRONTEND DESIGN OVERHAUL ONLY.

Do not damage, rewrite, reset, or break the backend, database, APIs, auth, project logic, permissions, META·LAB/META·SIFT linking, screening workflow, analysis engine, exports, or existing saved data.

The app is a systematic review, screening, and meta-analysis platform. It has two main connected modules:
- META·LAB: protocol/PICO, data extraction, effect sizes, meta-analysis, forest/funnel plots, PRISMA, methods/equations, exports.
- META·SIFT: import references, duplicate management, title/abstract screening, keyword highlighting, reviewer decisions, conflicts, second review, PDF viewing, included studies, and handoff to META·LAB.

The full app workflow is:
Create project → protocol/PICO → import references → remove duplicates → screen title/abstract → resolve conflicts → second/full-text review → included studies → data extraction → effect size calculation → meta-analysis → PRISMA → export.

Preserve that workflow completely. Only improve how it looks and feels.

The goal:
Make the whole app look like the /template design: simple, elegant, modern, clean, friendly, bright, and premium.

Important design requirements:
1. Day mode should now be the main/default theme.
2. Dark mode must remain available.
3. The landing page should look very close to the /template landing page structure and visual language, but with META·LAB / META·SIFT’s own content, identity, and purpose.
4. Use Framer Motion for animation. The package is already installed.
5. The app should feel smooth, modern, and alive, but not flashy.
6. The design should be clean and simple, not overcomplicated.
7. Use the /template as the source of truth for design direction.
8. Do not create a random new visual style. Follow the template.
9. Do not remove features.
10. Do not change backend behavior.

Before coding:
- Inspect the existing app structure.
- Inspect /template carefully.
- Identify reusable layout patterns, sections, components, colors, typography, animations, and spacing from /template.
- Map which parts of the current app should be redesigned.
- Check which components already exist and should be restyled instead of duplicated.
- Make a safe implementation plan before editing.

Core pages/screens to redesign:
1. Public landing page
2. Login/register/auth pages
3. Project landing / project selector
4. Main Review Workspace shell
5. Workspace overview / command center
6. META·SIFT import page
7. META·SIFT duplicate management
8. META·SIFT screening page
9. META·SIFT conflict/second review pages
10. META·LAB data extraction
11. META·LAB effect size calculator
12. META·LAB meta-analysis page
13. Forest/funnel/PRISMA/export pages
14. Methods & Equations page
15. Project control/settings
16. Member/permission pages
17. Notifications/chat UI
18. Admin/mod/ops console if present

Landing page:
Make the landing page strongly inspired by /template.
Use similar:
- hero structure
- navbar style
- spacing
- section rhythm
- cards
- icons
- feature blocks
- testimonials/benefits style if applicable
- footer style
- smooth animations
- clean startup/SaaS feel

But replace all generic startup content with content for my platform:
- systematic reviews
- study screening
- duplicate detection
- meta-analysis
- PRISMA
- team collaboration
- extraction
- exports
- research workflow
- institutional-grade evidence synthesis

The landing page should communicate:
“From screening to meta-analysis, one clean workspace for evidence synthesis.”

App design:
Apply the same clean /template-inspired look to the logged-in app:
- light background
- soft cards
- rounded corners
- generous spacing
- modern typography
- subtle borders
- simple icons
- clear buttons
- clean forms
- friendly empty states
- elegant tables
- smooth hover states
- consistent animations

Use theme tokens:
- Do not hardcode random colors everywhere.
- Create or improve design tokens for background, surface, card, border, text, muted text, primary, success, warning, danger, info.
- Day mode first.
- Dark mode should be the same design language but adapted.

Animations:
Use Framer Motion for:
- landing hero animation
- section reveal on scroll
- card entrance
- hover/tap microinteractions
- page transitions where safe
- modals/drawers
- chat/notification drawer
- export dialog
- workflow progress motion

Do not animate dense tables in a way that slows the app.
Do not make screening slower.
Do not use distracting animations.

Project landing page:
Redesign it as a beautiful dashboard/workspace selector.
It should include:
- welcome header
- create project button
- project search/filter/sort
- recent projects
- owned/shared/archived filters
- project cards or clean table/card hybrid
- role badge
- linked META·LAB/META·SIFT status
- progress indicator
- member avatars
- last modified date
- open project button
- empty state

Main app shell:
Create or improve a consistent app shell:
- top navbar/header
- sidebar or workflow navigation
- account dropdown
- notifications
- chat
- module switcher between META·LAB and META·SIFT
- breadcrumb/back to projects
- clean responsive layout

Sidebar/workflow navigation should be simple and grouped:

Workspace:
- Overview
- Protocol / PICO
- Team & Permissions
- Audit Trail

META·SIFT:
- Import
- Duplicates
- Screening
- Conflicts
- Second Review
- Included Studies

META·LAB:
- Data Extraction
- Effect Sizes
- Meta-analysis
- Forest Plot
- Funnel Plot
- PRISMA
- Methods & Equations
- Exports

Every page should have:
- clear title
- short helper description
- one obvious primary action
- secondary actions less visually dominant
- loading state
- empty state
- error state
- read-only state when permissions require it

META·SIFT screening:
Keep the existing functionality, but redesign it with a cleaner interface.
Use a three-column layout if already supported or feasible:
- left: article list and filters
- middle: article title/abstract/PDF/decision buttons
- right: keyword filters, notes, labels, exclusion reasons

Make it comfortable for long screening sessions:
- readable abstract text
- clear include/maybe/exclude buttons
- visible reviewer status
- clean keyword highlighting
- no clutter
- no overflow bugs
- keyboard shortcuts preserved if present

META·LAB analysis:
Make the statistical pages clean and credible:
- result summary cards
- pooled estimate
- 95% CI
- p-value
- I²
- tau²
- Q statistic
- model type
- number of studies
- warnings
- clean plots
- export button
- methods/equations link

Preserve statistical logic. Do not change calculations unless already required elsewhere. This task is frontend-focused.

Exports:
Redesign export dialogs in the /template style:
- clean modal
- format options
- image size options where relevant
- export button
- cancel button
- helpful descriptions

Tables:
Make all tables modern:
- clean headers
- soft borders
- hover state
- status badges
- right-aligned numeric columns
- responsive behavior
- column overflow handling
- long DOI/URL/title/email should not break layout

Global overflow fixes:
Fix visual overflow for:
- long project titles
- workspace names
- owner emails
- member emails
- DOI
- PMID
- URLs
- article titles
- abstracts
- export names
Use proper CSS such as:
- min-width: 0
- overflow-wrap
- word-break where needed
- truncate with tooltip where appropriate

Components to create or refactor if needed:
- AppShell
- PublicNavbar
- LandingHero
- LandingSection
- FeatureCard
- WorkspaceSidebar
- TopUtilityBar
- ProjectCard
- WorkflowProgress
- ModuleSwitcher
- StatusBadge
- RoleBadge
- EmptyState
- LoadingState
- ErrorState
- ExportDialog
- ScreeningArticleList
- ArticleReader
- KeywordPanel
- AnalysisSummaryCard
- StatCard
- PlotCard
- NotificationDrawer
- ChatDrawer

Important safety rules:
- Do not touch backend routes unless absolutely necessary for frontend compatibility.
- Do not modify database schema.
- Do not run destructive migrations.
- Do not remove existing features.
- Do not break auth.
- Do not break project opening by exact project ID.
- Do not break META·LAB/META·SIFT linking.
- Do not break permissions.
- Do not break read-only behavior.
- Do not break data extraction.
- Do not break meta-analysis calculations.
- Do not break exports.
- Do not commit secrets.
- Do not hide real errors with vague messages.
- Do not duplicate existing systems if one already works.

Implementation approach:
1. Inspect /template.
2. Inspect current frontend.
3. Identify the design tokens and layout patterns from /template.
4. Create a short design mapping.
5. Apply global theme and typography.
6. Redesign public landing page first.
7. Redesign auth pages.
8. Redesign app shell.
9. Redesign project selector.
10. Redesign key META·SIFT pages.
11. Redesign key META·LAB pages.
12. Redesign dialogs/drawers/tables/forms.
13. Add Framer Motion animations.
14. Test responsiveness.
15. Test dark mode.
16. Run build/tests.
17. Report exactly what changed.

Deliverables:
- A redesigned landing page based on /template.
- A clean day-mode-first design system.
- Dark mode still available.
- Framer Motion animations.
- Redesigned logged-in app shell.
- Redesigned project selector.
- Redesigned META·SIFT interface.
- Redesigned META·LAB interface.
- Improved tables, cards, dialogs, forms, empty states, and loading states.
- No backend damage.
- No feature removal.
- Build/test result.
- Clear final summary of files changed.

Important final design principle:
The app should feel like a simple, elegant startup product, but underneath it should still preserve the full serious research workflow of META·LAB and META·SIFT.

Use /template as the visual source of truth.
Make the app look like it belongs to the same design family as that template, while giving META·LAB / META·SIFT its own identity and purpose.