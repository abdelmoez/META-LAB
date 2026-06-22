You are working on PecanRev, a systematic review and meta-analysis SaaS platform.

This task is focused only on improving the Search Builder intelligence and accuracy. Do not refactor unrelated parts of the app. Do not break Protocol/PICO, Screening, Data Extraction, Risk of Bias, GRADE, PRISMA, Analysis, Project Control, dashboard, permissions, or Ops Console.

Take your time. Accuracy matters more than speed. Do not rush into coding. First understand the problem, study examples, create a broad evaluation set, then improve the engine carefully.

It is okay to add a creative, accurate idea if it clearly improves the Search Builder, makes it more institution-grade, or makes it easier for beginners. But keep changes focused, safe, documented, and tested.

====================================================
THE PROBLEM
===========

The current guided Search Builder is visually improving, but the search intelligence is still not reliable enough.

Current issues seen in the EUS biliary drainage example:

1. The engine puts procedure terms into the wrong PICO concept.
   Example:
   “endoscopic ultrasound” / “EUS” appears in Population, Intervention, and Comparator.

This is dangerous because concepts are combined with AND. If the same term appears in multiple AND-ed concepts, the strategy becomes artificially narrow and may miss relevant studies.

2. Population contains mixed fragments instead of a clean disease/population concept.
   Bad Population terms include:

* endoscopic ultrasound
* EUS
* ERCP
* drainage
* biliary
* failed
* obstruction
* adults
* etc

A better Population should include:

* malignant biliary obstruction
* patients with malignant biliary obstruction
* failed ERCP
* unsuccessful ERCP

3. The engine still creates bad standalone terms.
   Bad examples:

* failed
* drainage
* biliary
* obstruction
* adults
* etc
* underwent
* including
* grouped
* appropriately
* possibly

These should either be removed or combined into meaningful phrases.

4. The controlled vocabulary suggestion can be conceptually wrong.
   Example:
   “Endoscopic Ultrasound-Guided Fine Needle Aspiration” MeSH appears, but this review is about EUS-guided biliary drainage, not FNA. A close-but-wrong controlled vocabulary term is harmful.

5. Outcomes are empty, but the app does not explain that this may be acceptable.
   In many systematic review searches, outcomes are optional because adding them can make the search too narrow. The app should explain this instead of making the user think something is broken.

====================================================
REFERENCE EXAMPLE TO STUDY
==========================

Use this example as one of the first gold-standard cases.

Review topic:
“EUS-guided antegrade/transpapillary versus transluminal biliary drainage after failed ERCP in malignant biliary obstruction: systematic review and meta-analysis”

A cleaner concept structure should look closer to this:

Population:

* malignant biliary obstruction
* patients with malignant biliary obstruction
* biliary obstruction
* bile duct obstruction
* failed ERCP
* unsuccessful ERCP
* failed endoscopic retrograde cholangiopancreatography

Intervention / Exposure:

* EUS-guided antegrade biliary drainage
* EUS-guided transpapillary biliary drainage
* endoscopic ultrasound-guided antegrade drainage
* endoscopic ultrasound-guided transpapillary drainage
* EUS-guided biliary drainage
* endoscopic ultrasound-guided biliary drainage
* endoscopic ultrasound
* EUS

Comparator / Control:

* EUS-guided transluminal biliary drainage
* transluminal biliary drainage
* choledochoduodenostomy
* hepaticogastrostomy

Outcomes:
Optional for the primary search. Possible extraction/search terms if needed:

* technical success
* clinical success
* adverse events
* stent dysfunction
* reintervention
* mortality

Important rule:
Do not place “EUS” or “endoscopic ultrasound” in Population unless the population is specifically defined by undergoing EUS.

Example rough PubMed strategy:

(
"malignant biliary obstruction"[tiab]
OR "biliary obstruction"[tiab]
OR "bile duct obstruction"[tiab]
OR "failed ERCP"[tiab]
OR "failed endoscopic retrograde cholangiopancreatography"[tiab]
OR "unsuccessful ERCP"[tiab]
)
AND
(
"EUS-guided biliary drainage"[tiab]
OR "endoscopic ultrasound-guided biliary drainage"[tiab]
OR "EUS-guided antegrade biliary drainage"[tiab]
OR "endoscopic ultrasound-guided antegrade drainage"[tiab]
OR "EUS-guided transpapillary biliary drainage"[tiab]
OR "endoscopic ultrasound-guided transpapillary drainage"[tiab]
)
AND
(
"transluminal biliary drainage"[tiab]
OR "EUS-guided transluminal biliary drainage"[tiab]
OR choledochoduodenostomy[tiab]
OR hepaticogastrostomy[tiab]
)

This does not need to be copied exactly. Use it as a teaching example for how the engine should think.

====================================================
MAIN GOAL
=========

Improve the Search Builder so it behaves like a real systematic review search assistant, not a simple keyword splitter.

The engine should:

* extract meaningful clinical/research phrases
* remove noisy terms
* classify terms into the correct PICO concept
* avoid leaking terms across AND-ed concepts
* detect cross-concept duplicates
* suggest synonyms, acronyms, variants, and controlled vocabulary carefully
* avoid close-but-wrong MeSH/Emtree suggestions
* explain when outcomes are optional
* help beginners understand the search strategy
* preserve expert flexibility

====================================================
IMPORTANT: BUILD AN EVALUATION CORPUS FIRST
===========================================

Before making major logic changes, create an evaluation corpus of at least 1,000 synthetic but realistic systematic review search examples.

This does not mean manually hardcoding 1,000 rules into the app.

It means creating a benchmark/test dataset that teaches and tests the engine across many realistic review patterns.

Create:

`docs/manager/search-builder-evaluation-corpus-plan.md`

Then create a structured fixture file if appropriate, for example:

`src/features/search-builder/__fixtures__/searchBuilderGoldCases.ts`

or another location matching the repo structure.

Each case should include:

* caseId
* reviewTitle
* researchQuestion if available
* PICO fields
* expected Population terms
* expected Intervention/Exposure terms
* expected Comparator/Control terms
* expected Outcomes terms
* optional Time Frame
* terms that should be rejected as noise
* terms that should not appear in Population
* duplicate/cross-concept warnings expected
* controlled vocabulary suggestions expected if known
* synonyms/acronyms/variants expected
* notes explaining the reasoning

The corpus should cover many types of reviews, including but not limited to:

* GI procedures
* EUS/ERCP/biliary drainage
* inflammatory bowel disease medications
* hepatology/cirrhosis
* colonoscopy/polypectomy
* bariatric surgery
* cardiology
* endocrinology/diabetes
* oncology
* infectious disease
* nephrology
* pulmonology
* critical care
* surgery
* diagnostic test accuracy reviews
* drug vs placebo reviews
* procedure vs procedure reviews
* exposure/risk factor reviews
* prognosis reviews
* screening reviews
* non-inferiority/comparative effectiveness reviews

Include difficult examples where the engine must not confuse:

* disease/population vs intervention
* procedure vs comparator
* outcome vs population
* acronym vs unrelated word
* database term vs clinical term
* broad disease term vs specific subgroup
* outcome terms that may be optional
* comparator terms that may over-restrict the search

The 1,000 examples may be generated programmatically using templates, but the first 25–50 should be high-quality, manually reviewed gold examples.

The EUS biliary drainage example above must be included as a gold case.

====================================================
CREATE A SEARCH BUILDER BENCHMARK
=================================

Create a test/benchmark runner that compares the current engine output against the gold cases.

The benchmark should measure:

1. Noise rejection
   Did the engine avoid suggesting bad terms like “the,” “or,” “underwent,” “including,” etc.?

2. Phrase preservation
   Did the engine preserve meaningful phrases instead of splitting them into weak fragments?

3. Correct PICO assignment
   Did the term land in the correct concept?

4. Cross-concept leakage
   Did the same term or equivalent term appear in multiple AND-ed concepts?

5. Controlled vocabulary safety
   Did the engine avoid clearly wrong MeSH/Emtree suggestions?

6. Synonym/acronym expansion
   Did it suggest useful expansions like EUS ↔ endoscopic ultrasound?

7. Strategy safety
   Would the generated strategy likely be too narrow because of duplicated terms across concepts?

The benchmark does not need to be perfect, but it must be useful.

Add a script if appropriate, for example:

`npm run test:search-builder-intelligence`

or integrate it into existing test structure.

====================================================
FIX THE ENGINE AFTER STUDYING THE CORPUS
========================================

After creating and reviewing the corpus, improve the engine.

Do not just add one-off fixes for the EUS example.

Create reusable logic for:

1. Better phrase extraction

* prefer multi-word clinical phrases
* avoid weak single-word fragments
* keep meaningful phrases intact
* use punctuation, PICO field context, and medical phrase patterns

2. Strong noise filtering
   Remove isolated stopwords, connectors, vague verbs, and sentence filler.

Examples to reject:

* the
* a
* an
* and
* or
* if
* of
* in
* on
* at
* to
* from
* by
* with
* without
* across
* including
* possibly
* appropriately
* grouped
* underwent
* adults when not clinically meaningful alone
* patients when alone
* subjects when alone
* participants when alone
* etc

3. PICO-aware classification
   Classify extracted terms into one best concept whenever possible:

* Population
* Intervention / Exposure
* Comparator / Control
* Outcomes
* Time Frame
* Unassigned / Needs Review

4. Concept leakage prevention
   Do not silently place the same term in multiple concepts.

If duplicate/equivalent terms appear across concepts:

* warn the user
* recommend best concept
* allow move/keep/remove
* do not silently over-restrict the strategy

5. Controlled vocabulary matching with safety
   Whenever a user adds or accepts a keyword, try to find matching controlled-vocabulary terms:

* MeSH for PubMed/MEDLINE
* Emtree for Embase if supported or cleanly stubbed

But:

* do not silently force controlled vocabulary into the final strategy
* do not add close-but-wrong controlled vocabulary
* show confidence/needs-review when uncertain
* allow include/exclude
* allow explode on/off if supported
* no live external calls in CI/tests

6. Synonym and variant expansion
   Suggest useful variants:

* EUS ↔ endoscopic ultrasound
* T2DM ↔ type 2 diabetes mellitus
* ERCP ↔ endoscopic retrograde cholangiopancreatography
* tumor ↔ tumour
* randomized ↔ randomised
* drainage ↔ drain*
* biliary obstruction ↔ bile duct obstruction

7. Outcome guidance
   If Outcomes are empty, do not automatically treat this as a critical problem.

Instead explain:
“Outcomes are optional in many systematic review searches. Adding outcomes can make the search more specific but may reduce sensitivity.”

If the user adds outcome terms, show a warning when the strategy becomes too narrow.

====================================================
UI IMPROVEMENTS REQUIRED
========================

In the Organize Concepts tab:

1. Show bad/wrong terms clearly.
   If a term is suspicious, mark it as “Needs review.”

2. Allow moving terms between concepts.
   Users should be able to move or drag a term from the wrong concept to the correct concept.

Example:
Move “endoscopic ultrasound” from Population to Intervention.

3. Allow combining related terms into a term family.
   Example:

* EUS
* endoscopic ultrasound
* EUS-guided

Should be grouped as one concept family joined by OR.

4. Show duplicate warnings.
   Example:
   “EUS appears in multiple concepts. Since concepts are joined with AND, this may make the search too narrow.”

5. Keep it beginner-friendly.
   Do not overwhelm users with too many chips, warnings, or syntax. Use collapsible sections and simple language.

====================================================
DOCUMENT ADVANCED FEATURES AS NEXT PHASE
========================================

Do not fully build these in this task unless they are already mostly implemented and low-risk:

* full PRESS-style quality checklist
* full PRISMA-S search report export
* validated search filters/hedges
* full live hit counts for all databases
* real Emtree integration
* institutional database access logic

Instead, document them in:

`docs/manager/search-builder-next-phase-roadmap.md`

Include:

* what should be built next
* why it matters
* implementation risks
* required data/API access
* recommended order

====================================================
SAFETY REQUIREMENTS
===================

Do not:

* break existing Search Builder tabs
* erase manual terms
* erase manual concepts
* erase hidden/rejected terms
* overwrite saved strategies
* silently add terms to the final strategy without user visibility
* fake hit counts
* make live external calls in CI/tests
* add broad app refactors
* change unrelated workflows

Preserve:

* user-selected keywords
* rejected suggestions
* moved terms
* combined term families
* manual terms
* manual concepts
* hidden terms
* selected databases
* saved strategies
* autosync behavior

====================================================
TESTING REQUIREMENTS
====================

Add or update tests for:

Extraction:

* stopwords/connectors are not suggested
* vague/noisy standalone words are not suggested
* meaningful multi-word phrases are preserved
* disease/procedure/outcome phrases are not broken into useless fragments

PICO mapping:

* disease terms map to Population
* intervention/procedure terms map to Intervention
* comparator terms map to Comparator
* outcome terms map to Outcomes
* EUS/endoscopic ultrasound is not placed in Population for the EUS biliary drainage case

Duplicate detection:

* EUS/endoscopic ultrasound duplicated across concepts is detected
* duplicate warnings appear
* user can resolve by moving/removing/keeping

Controlled vocabulary:

* matching MeSH suggestions appear under correct concept
* close-but-wrong MeSH suggestions are marked uncertain or excluded
* no live external calls in CI/tests

Synonyms/variants:

* acronym expansion works
* spelling variants work
* truncation suggestions work where appropriate
* accepted/rejected suggestions persist

UI behavior:

* moving a term updates the concept
* combining terms creates an OR family
* strategy preview updates after concept changes
* outcomes-empty guidance displays when appropriate

Regression:

* no blank-state overwrite
* no duplicate terms after repeated sync/opening
* manual concepts remain intact
* manual terms remain intact
* hidden/rejected terms remain intact
* unrelated app areas still work

Benchmark:

* the 1,000-case corpus can be run through the engine
* benchmark output reports failures clearly
* EUS biliary drainage gold case passes

====================================================
BUILD AND QUALITY CHECKS
========================

Run:

* typecheck
* tests
* search-builder benchmark if created
* build

Do not ignore failures. If a failure is unrelated and pre-existing, document it with evidence.

====================================================
VERSION AND COMMIT
==================

If the project uses versioning, bump patch version.

Suggested commit message:

`fix(search-builder): improve search intelligence and PICO mapping`

====================================================
FINAL REPORT
============

At the end, report:

* root causes found
* how many evaluation cases were created
* how the EUS biliary drainage case performs before vs after
* what changed in extraction logic
* what changed in PICO mapping
* what changed in controlled vocabulary handling
* what changed in UI
* what was intentionally deferred
* files changed
* tests added/updated
* benchmark result
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

* The EUS biliary drainage example no longer produces a conceptually wrong search structure.
* “EUS” / “endoscopic ultrasound” is not placed in Population unless clearly justified.
* Noise terms like “the,” “or,” “including,” “possibly,” “grouped,” and “underwent” are not suggested as keywords.
* Meaningful clinical phrases are preserved.
* Terms are assigned to the most appropriate PICO concept.
* Cross-concept duplicate terms are detected and warned.
* Users can move terms between concepts.
* Users can combine related terms into OR-based families if feasible.
* Added/accepted keywords attempt controlled-vocabulary enrichment.
* Wrong or low-confidence MeSH/controlled vocabulary suggestions are not silently added.
* Outcomes-empty guidance is shown.
* At least 1,000 evaluation cases or generated benchmark cases exist, with at least 25–50 manually reviewed gold cases.
* A benchmark/test process exists to evaluate Search Builder intelligence.
* Manual concepts, manual terms, hidden terms, rejected suggestions, and saved strategies are preserved.
* Search Builder remains beginner-friendly.
* Existing functionality outside Search Builder is not broken.

Do not ask small clarification questions. Use best product judgment and document assumptions in `docs/manager`.
