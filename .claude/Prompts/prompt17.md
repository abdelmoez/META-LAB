I want you to redesign ONLY the landing page of my app.

Important:
This is a frontend-only landing page redesign. Do not touch backend logic, database, APIs, authentication, project logic, permissions, META·LAB/META·SIFT linking, screening logic, data extraction, meta-analysis calculations, exports, or saved data.

Goal:
Change the landing page so it follows the same structure, visual rhythm, typography, spacing, simplicity, and elegance of the Nextly landing page template located in:

/template

First, inspect /template completely before changing anything.

I want the landing page to feel almost like the Nextly template in structure and design language, but with original META·LAB / META·SIFT content.

Design requirements:
- Follow the same general structure as Nextly.
- Use simple text.
- Use large, clean headings.
- Use the same or closest font style used by Nextly.
- Make the page bright, clean, modern, and elegant.
- Day mode should be the main/default look.
- Dark mode can remain available if already supported.
- Use Framer Motion for animations.
- Framer Motion is already installed, so use it directly.
- Keep animations smooth, subtle, and premium.
- Do not make the page flashy or crowded.
- Do not use generic AI SaaS purple-gradient style.
- Keep the layout simple and readable.

Landing page content should be adapted to my app.

My app is META·LAB / META·SIFT, a systematic review, screening, and meta-analysis platform.

The app helps researchers:
- create systematic review projects
- define protocol/PICO
- import references
- remove duplicates
- screen title/abstract
- resolve reviewer conflicts
- complete second/full-text review
- send included studies to data extraction
- calculate effect sizes
- run meta-analysis
- generate forest/funnel plots
- build PRISMA
- export results and reports
- collaborate with team members

Main landing page message:
“From screening to meta-analysis, one clean workspace for evidence synthesis.”

Use this as the main hero direction, but improve the wording if needed.

Suggested landing page structure, based on Nextly:
1. Navbar
   - Logo / app name
   - Simple nav links
   - Sign in button
   - Get started button

2. Hero section
   - Large headline
   - Simple subheadline
   - Two call-to-action buttons
   - Clean visual/illustration/dashboard preview
   - Framer Motion entrance animation

3. Trusted / credibility strip
   - Instead of fake logos, use simple credibility text such as:
     “Built for systematic reviews, screening, extraction, meta-analysis, and PRISMA workflows.”
   - Do not create fake metrics or fake institutional logos.

4. Feature section
   - Use simple cards like the template.
   - Features:
     - Guided review workflow
     - Fast study screening
     - Duplicate detection
     - Data extraction
     - Meta-analysis engine
     - PRISMA and exports
     - Team collaboration
     - Audit-ready workspace

5. Workflow section
   - Show the golden path:
     Project → Protocol → Import → Screen → Extract → Analyze → PRISMA → Export
   - Make it clean and visual, similar to the template’s section style.

6. META·SIFT section
   - Explain screening, duplicates, reviewer decisions, conflicts, second review.

7. META·LAB section
   - Explain data extraction, effect sizes, meta-analysis, forest/funnel plots, PRISMA.

8. Benefits section
   - Simple benefit blocks:
     - Less scattered workflow
     - Easier team review
     - Cleaner evidence synthesis
     - Publication-ready outputs

9. Final CTA
   - Simple large heading
   - Short text
   - Get started button

10. Footer
   - Clean and minimal like Nextly.

Animation requirements:
Use Framer Motion for:
- hero heading fade/slide in
- hero visual fade/scale in
- feature cards reveal on scroll
- workflow steps staggered animation
- CTA section reveal
- subtle button hover/tap motion

Do not over-animate.
Do not animate dense text aggressively.
Animations should be fast, smooth, and elegant.

Technical requirements:
- Reuse the existing landing page route/components if possible.
- Do not duplicate the whole app structure unnecessarily.
- Use components from /template when safe.
- If copying from /template, adapt names, imports, and styling properly.
- Preserve current routing.
- Preserve existing sign-in/get-started links.
- Make it responsive for mobile, tablet, and desktop.
- Fix overflow issues.
- Keep code clean and maintainable.

Style requirements:
- Use the template’s font approach.
- Use the template’s spacing and section rhythm.
- Use the template’s button style.
- Use the template’s card style.
- Use the template’s clean navbar/footer style.
- Use soft backgrounds, simple cards, and generous whitespace.
- Make the page feel polished but not complicated.

Do not:
- Change backend files.
- Change API routes.
- Change database schema.
- Break authentication.
- Break app navigation.
- Remove existing app features.
- Add fake testimonials, fake numbers, or fake company logos.
- Add heavy animations that slow the page.
- Create a totally different style from /template.

Implementation steps:
1. Inspect /template and identify the landing page structure, font, components, styling, and animations.
2. Inspect the current landing page.
3. Create a short plan before editing.
4. Redesign the current landing page using the Nextly structure.
5. Replace generic template text with META·LAB / META·SIFT content.
6. Add Framer Motion animations.
7. Ensure responsive design.
8. Ensure links/buttons still work.
9. Run build/lint if available.
10. Report exactly what files changed and what was improved.

Final result:
The landing page should look like a clean, modern Nextly-style startup landing page, but written for META·LAB / META·SIFT and its systematic review/meta-analysis workflow.

Most important:
Use /template as the visual and structural source of truth. Make the landing page simple, elegant, bright, modern, large-font, and animated with Framer Motion, without touching backend functionality.