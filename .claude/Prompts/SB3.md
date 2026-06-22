You are working on PecanRev, a systematic review and meta-analysis SaaS platform.

This task is focused only on improving the Search Builder user experience and search strategy workflow. Do not refactor unrelated parts of the app. Do not break Protocol/PICO, Screening, Data Extraction, Risk of Bias, GRADE, PRISMA, Analysis, Project Control, dashboard, permissions, or Ops Console.

Current problem:
The Search Builder currently feels too technical and visually exhausting for users who do not already know how to build a systematic review search strategy. It may work for advanced users, but beginners need a clearer guided flow.

Goal:
Redesign the Search Builder into a simple, guided, beginner-friendly workflow that helps users move from their research question/PICO into keywords, concepts, MeSH terms, database strategies, and export-ready search strings.

Do not make it overly complex. The goal is to make the Search Builder easier to understand within 10 seconds of opening it.

Important product principle:
PecanRev should help the researcher build the search strategy. It should not assume the researcher already knows Boolean logic, MeSH, database syntax, or systematic review search structure.

High-level idea:
Use a tabbed or guided-step layout inside Search Builder.

Possible tabs:

1. Select Keywords
2. Organize Concepts
3. Choose Databases
4. Build Strategy
5. Check / Export

You may adjust names if better, but keep the flow simple.

The first tab is the most important.

====================================================
TAB 1 — SELECT KEYWORDS
=======================

Purpose:
Let users select important words/phrases directly from the research question and PICO fields.

User experience:
The page should show the research question and PICO fields in simple text boxes or readable cards.

Fields:

* Research Question
* Population
* Intervention / Exposure
* Comparator / Control
* Outcomes
* Time Frame

The text should be interactive.

Users should be able to:

* click a word to select it as a keyword
* click and drag, double-click, or use an easy UI control to select multi-word phrases
* unselect a keyword by clicking again
* add a manual keyword if needed
* see selected keywords appear in a “Selected keywords” area
* see which PICO field each keyword came from

Example:
Research question:
“In adults with obesity, do GLP-1 receptor agonists compared with placebo improve weight loss and HbA1c?”

The user can click:

* adults with obesity
* obesity
* GLP-1 receptor agonists
* placebo
* weight loss
* HbA1c

The system can also auto-suggest important keywords, but the user should still be able to control the final selection.

Important:
This should not be only automatic extraction. The user should be able to clearly click/select the words or phrases they want.

Auto-suggestions:
The system may highlight suggested keywords automatically, but the user should be able to accept, remove, or edit them.

Connector/filler words should not be selected as keywords unless manually forced:

* and
* or
* if
* the
* a
* an
* of
* with
* without
* in
* on
* at
* to
* from
* by
* versus
* vs
* compared with
* among
* patients with
* adults with

However, do not accidentally break meaningful phrases. For example:

* “heart failure with reduced ejection fraction” should stay as a phrase.
* “quality of life” should stay as a phrase.
* “standard of care” should stay as a phrase.

If uncertain whether a term should be included, include it as a suggestion, but allow the user to remove it.

The first tab should feel like:
“Click the important ideas in your question. PecanRev will help turn them into a search strategy.”

====================================================
TAB 2 — ORGANIZE CONCEPTS
=========================

Purpose:
Take the selected keywords and organize them into clean PICO-based search concepts.

Default concept groups should be:

* Population
* Intervention / Exposure
* Comparator / Control
* Outcomes
* Time Frame

Keep the “Add Concept” button for custom/manual concepts.

Each concept group should show:

* selected keywords
* synonyms
* acronyms
* MeSH / subject heading suggestions
* hidden/deleted terms if applicable
* simple explanation of how the concept is used in the search

Make this easier than the current interface.

Current issue:
The existing Search Builder concept view looks visually exhausting. It shows too much at once and may overwhelm beginners.

Improve it by using:

* cleaner cards
* collapsible sections
* less dense text
* simple labels
* clear “Recommended” vs “Manual” vs “MeSH” term labels
* beginner-friendly explanations
* progressive disclosure for advanced options

Each concept card should have a simple status:

* Ready
* Needs review
* No terms yet
* MeSH suggested
* Too broad
* Too narrow

Avoid making users read a wall of chips and logic at once.

Suggested card layout:

Population
Short explanation: “Who or what is being studied?”
Selected terms: obesity, overweight, adults
Suggested synonyms: body mass index, BMI
Suggested MeSH: Obesity
Status: Ready

Intervention / Exposure
Short explanation: “What treatment, exposure, or test is being studied?”
Selected terms: GLP-1 receptor agonists, semaglutide, liraglutide
Suggested MeSH: Glucagon-Like Peptide-1 Receptor
Status: Needs review

Comparator / Control
Short explanation: “What is it compared against?”
Selected terms: placebo, lifestyle intervention, standard care
Status: Ready

Outcomes
Short explanation: “What outcomes are measured?”
Selected terms: weight loss, HbA1c, adverse events
Status: Ready

Time Frame
Short explanation: “What publication date limits apply?”
Selected value: Last 10 years
Status: Ready

====================================================
TAB 3 — CHOOSE DATABASES
========================

Purpose:
Let users select which databases they want to search.

Add more databases and show a small access note for each one so users know whether they may need institutional access or a subscription.

Suggested database list:

Core biomedical/systematic review databases:

* PubMed / MEDLINE
* Embase
* Cochrane Library
* ClinicalTrials.gov
* WHO ICTRP

Common multidisciplinary databases:

* Scopus
* Web of Science
* Google Scholar

Health/allied health/nursing/psychology:

* CINAHL
* PsycINFO

Grey literature / theses:

* ProQuest Dissertations & Theses
* OpenGrey or other grey literature source if currently supported or relevant

Open/free biomedical sources:

* Europe PMC
* PubMed Central

Optional/specialty databases:

* IEEE Xplore for engineering/AI/medical device reviews
* ACM Digital Library for computer science/digital health reviews

For each database, show a small note:

Examples:

* PubMed / MEDLINE — Free
* PubMed Central — Free full-text archive
* ClinicalTrials.gov — Free trials registry
* WHO ICTRP — Free trials registry
* Embase — Usually requires institutional subscription
* Scopus — Usually requires institutional subscription
* Web of Science — Usually requires institutional subscription
* Cochrane Library — Mixed access; subscription may be needed for full access
* CINAHL — Usually requires institutional subscription
* PsycINFO — Usually requires institutional subscription
* Google Scholar — Free to search, but limited reproducibility/export
* ProQuest Dissertations & Theses — Usually requires institutional subscription
* IEEE Xplore — Mixed access; subscription often needed
* ACM Digital Library — Mixed access; subscription often needed
* Europe PMC — Free

Important:
Use conservative wording such as “usually requires institutional subscription” instead of making absolute claims.

Also add a tooltip or info icon explaining:
“Access depends on your institution. PecanRev helps prepare the search strategy, but your institution may control database availability.”

====================================================
TAB 4 — BUILD STRATEGY
======================

Purpose:
Show the user how selected concepts become a search strategy.

Beginner explanation:

* Similar terms inside the same concept are joined with OR.
* Different concepts are joined with AND.

Example:
(obesity OR overweight) AND (GLP-1 receptor agonists OR semaglutide) AND (placebo OR standard care) AND (weight loss OR HbA1c)

The UI should show this visually first, not only as a raw Boolean string.

Suggested layout:

* visual concept blocks at top
* generated search logic underneath
* database-specific search strings below

Allow:

* copy strategy
* edit strategy
* reset to generated version
* save version
* show advanced syntax

Expert users should be able to switch to advanced mode.

Beginner mode:

* simple explanations
* generated strategy
* minimal syntax

Expert mode:

* direct Boolean editing
* field tags such as [tiab] and [MeSH]
* database-specific syntax
* proximity operators where supported
* advanced filters

====================================================
TAB 5 — CHECK / EXPORT
======================

Purpose:
Help the user check whether the strategy is usable and export it.

Show:

* selected databases
* final strategy per database
* hit counts if available
* last updated time if hit counts are available
* warnings if the search is very broad or very narrow
* missing concept warnings
* export options

Export options:

* copy PubMed strategy
* copy Embase strategy
* copy Cochrane strategy
* copy all strategies
* export search strategy table
* save search version
* mark search as ready for Screening Import

Do not require live database hit counts if not currently supported.
If hit counts are unavailable, show:
“Hit counts are not available for this database yet.”

Do not make live external calls in CI/tests.

====================================================
USER-FRIENDLY DESIGN REQUIREMENTS
=================================

The Search Builder should not feel overwhelming.

Use:

* tabs or a light guided stepper
* short explanations
* clean cards
* collapsible advanced sections
* progressive disclosure
* clear empty states
* tooltips for technical terms
* “Beginner mode” as the default
* “Expert mode” for advanced users

Avoid:

* too many chips on one screen
* dense Boolean logic at the top
* showing all database syntax at once
* too much technical language
* forcing users to understand MeSH before selecting keywords
* making users manually type everything

Replace technical wording where possible:

Instead of “Boolean operators,” use “Search logic.”
Instead of “MeSH extraction,” use “Suggested medical subject headings.”
Instead of “Query syntax,” use “Database search format.”
Instead of “Explode term,” use “Include narrower related terms,” with an advanced tooltip.

====================================================
AUTOSYNC REQUIREMENTS
=====================

The Search Builder must stay synced with Protocol/PICO.

If the user edits PICO:

* selected keyword suggestions should update
* concept groups should update
* generated strategy should update
* database strategies should update
* the user should not need to refresh

Do not erase:

* manual concepts
* manual terms
* user-hidden terms
* user edits
* saved strategy versions

Avoid duplicates after repeated opening, refreshing, or syncing.

Other online collaborators should see Search Builder changes without refresh if real-time collaboration infrastructure already supports this. If this is not available yet, document the gap and implement the safest minimal approach.

====================================================
IMPLEMENTATION APPROACH
=======================

1. Inspect first
   Before changing code, inspect:

* current Search Builder components
* PICO state/data model
* current concept/term extraction logic
* current MeSH suggestion logic
* database strategy generation logic
* autosave/sync behavior
* real-time collaboration support if any
* the current UI shown in the Search Builder screenshot

Create documentation:

`docs/manager/search-builder-guided-ux-plan.md`

Include:

* current behavior
* current files/components
* UX problems
* proposed new tab structure
* data model impact
* risks
* minimal implementation plan

2. Product design before implementation
   First create the proposed UX structure in documentation before coding.

Include:

* tab names
* what each tab shows
* how data moves between tabs
* what is beginner mode vs expert mode
* database list and access note wording
* acceptance criteria

3. Implement safely
   Make targeted changes only inside the Search Builder area unless a small shared component is necessary.

Do not globally redesign the app.

Preserve:

* existing search builder data
* existing project data
* existing PICO data
* existing manual concepts
* existing saved strategies
* existing database strategy generation where possible

4. Add tests
   Add/update tests for:

* clickable keyword selection from research question/PICO
* multi-word phrase selection
* connector/filler word exclusion
* meaningful phrase preservation
* selected keywords mapping to correct PICO concept
* default PICO concept groups
* manual concepts preserved
* manual terms preserved
* no duplicate terms after repeated sync
* database list rendering
* database access notes rendering
* beginner/expert mode behavior if implemented
* search strategy generation from selected concepts
* export/copy behavior if affected

5. Build/checks
   Run:

* typecheck
* tests
* build

Do not ignore failures. If failures are unrelated and pre-existing, document them clearly.

6. Version and commit
   If the project uses versioning, bump patch version.

Commit message suggestion:

`feat(search-builder): add guided keyword selection workflow`

7. Final report
   Report:

* what changed
* screenshots or description of new Search Builder flow
* files changed
* frontend changes
* backend changes if any
* data model changes if any
* tests added/updated
* build/test result
* version bump
* commit hash
* push status
* known limitations
* recommended next steps

====================================================
ACCEPTANCE CRITERIA
===================

This task is complete only if:

* Search Builder is easier for a beginner to understand.
* The first tab lets users select keywords directly from the research question/PICO.
* Users can select or unselect words/phrases.
* Auto-suggested keywords are helpful but not forced.
* Selected keywords flow into PICO concept groups.
* PICO concept groups are shown individually.
* The concept view is cleaner and less visually exhausting than the current UI.
* Users can choose databases.
* Database options include clear notes about free vs subscription/institutional access.
* The search strategy is generated from selected concepts.
* Beginner users can use the page without knowing Boolean logic.
* Expert users still have access to advanced editing.
* PICO/Search Builder autosync still works.
* Existing manual concepts and terms are not erased.
* Existing functionality outside Search Builder is not broken.

Do not ask small clarification questions. Use best product judgment and document assumptions in `docs/manager`.
