You are working on PecanRev, a systematic review and meta-analysis SaaS platform.

This task is focused only on correcting and improving the new guided Search Builder. Do not refactor unrelated parts of the app. Do not break Protocol/PICO, Screening, Data Extraction, Risk of Bias, GRADE, PRISMA, Analysis, Project Control, dashboard, permissions, or Ops Console.

Take your time with each part of this task. Accuracy matters more than speed. Do not rush into code before understanding the current behavior and root cause. It is okay to add a creative, accurate improvement if it clearly makes the Search Builder easier, more reliable, or more institution-grade, but keep it safe, focused, and documented.

Main goal:
Fix the current Search Builder accuracy problems and make the guided keyword/concept workflow more reliable and easier to use.

Current problems:

1. Keyword extraction is pulling in noise.

Step 1 currently suggests connector words, filler words, and sentence fragments as selectable keywords.

Bad examples:

* the
* or
* across
* including
* if
* grouped
* appropriately
* possibly
* underwent

These should not appear as suggested keywords.

2. Terms are leaking across PICO concepts.

Example:
“endoscopic ultrasound” / “EUS” appears in Population, Intervention, and Comparator.

This is conceptually wrong. Since PICO concepts are combined with AND, repeating the same term across multiple concepts makes the search too restrictive and may miss relevant studies.

Example:
Population should not contain “endoscopic ultrasound” unless the population is specifically defined as patients undergoing EUS. Usually, EUS belongs to Intervention/Exposure or Comparator depending on the PICO.

Fix these as root-cause issues, not cosmetic UI issues.

====================================================
PART 1 — INSPECT AND DOCUMENT FIRST
===================================

Before changing code, inspect the current implementation.

Review:

* Step 1 keyword extraction
* PICO-to-keyword logic
* PICO-to-concept assignment
* Organize Concepts tab
* MeSH/controlled vocabulary suggestion logic
* synonym/variant logic if present
* database strategy generation
* hit count service if present
* autosave/sync behavior
* tests

Create documentation:

`docs/manager/search-builder-accuracy-correction-plan.md`

Include:

* current behavior
* root cause of noisy keyword suggestions
* root cause of terms leaking across PICO concepts
* affected files/components/services
* proposed minimal safe implementation plan
* risks
* assumptions
* test plan

Do not skip this documentation step.

====================================================
PART 2 — FIX KEYWORD EXTRACTION NOISE
=====================================

Improve Step 1 keyword extraction so it suggests meaningful search terms, not random words.

Do not suggest isolated stopwords, connectors, filler words, or vague standalone verbs.

Do not suggest words such as:

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
* versus
* vs
* compared
* across
* including
* possibly
* appropriately
* grouped
* underwent
* patients
* subjects
* individuals
* participants

Important:
Some of these words may appear inside meaningful phrases. Do not remove them if they are needed to preserve a real concept.

Good phrases to preserve:

* heart failure with reduced ejection fraction
* quality of life
* standard of care
* endoscopic ultrasound
* EUS-guided biliary drainage
* malignant biliary obstruction
* transpapillary biliary drainage
* transluminal biliary drainage
* adverse events
* treatment discontinuation

Bad keyword suggestions:

* heart
* reduced
* ejection
* fraction
* underwent
* including
* grouped

Better keyword suggestions:

* heart failure with reduced ejection fraction
* heart failure
* endoscopic ultrasound
* EUS-guided biliary drainage
* malignant biliary obstruction

The extraction should prioritize meaningful multi-word clinical/research phrases over isolated weak terms.

If the engine is uncertain whether a phrase is useful, it can include it as a suggestion, but the user must be able to remove it easily.

====================================================
PART 3 — FIX PICO-AWARE CONCEPT ASSIGNMENT
==========================================

Each extracted term should be assigned to the most appropriate PICO concept.

Default concepts:

* Population
* Intervention / Exposure
* Comparator / Control
* Outcomes
* Time Frame

Avoid automatically placing the same term in multiple PICO concepts.

Example PICO:
“EUS-guided antegrade/transpapillary versus transluminal biliary drainage after failed ERCP in malignant biliary obstruction”

Better mapping:

Population:

* malignant biliary obstruction
* failed ERCP
* patients with malignant biliary obstruction after failed ERCP

Intervention / Exposure:

* EUS-guided antegrade biliary drainage
* EUS-guided transpapillary biliary drainage
* endoscopic ultrasound
* EUS

Comparator / Control:

* transluminal biliary drainage
* EUS-guided transluminal biliary drainage if applicable

Outcomes:

* technical success
* clinical success
* adverse events
* stent dysfunction
* reintervention
* mortality if included in PICO

Do not put “EUS” or “endoscopic ultrasound” into Population unless the PICO text clearly makes that the population-defining feature.

If a term appears to fit more than one concept, do not silently duplicate it. Instead:

* assign the best likely concept
* show a warning or “Needs review” badge
* allow the user to move it

====================================================
PART 4 — DETECT DUPLICATES ACROSS CONCEPTS
==========================================

Add cross-concept duplicate detection.

The system should detect when the same or equivalent term appears in multiple AND-ed concepts.

Examples:

* EUS = endoscopic ultrasound
* T2DM = type 2 diabetes mellitus
* GLP-1 receptor agonist = glucagon-like peptide-1 receptor agonist
* tumor = tumour variant

If duplicate or equivalent terms appear across concepts, show a warning:

“This term appears in more than one concept. Since concepts are joined with AND, repeating it may make the search too narrow.”

The user should be able to:

* move the term to the correct concept
* keep it with a clear reason
* hide/remove the duplicate
* undo the action if possible

Do not silently delete user-added terms. Preserve user control.

====================================================
PART 5 — IMPROVE ORGANIZE CONCEPTS INTERACTION
==============================================

In the Organize Concepts tab, make concept correction easier.

Required improvements if feasible within the current architecture:

1. Move or drag keywords between concepts.

Users should be able to move a keyword/suggestion from one concept to another.

Example:
Move “endoscopic ultrasound” from Population to Intervention.

When a term is moved:

* update its concept assignment
* update strategy preview
* update hit counts if available
* preserve linked synonyms/MeSH if appropriate
* provide undo if feasible

2. Combine related terms into a term family.

Users should be able to group related terms under the same concept.

Example:
Combine:

* EUS
* endoscopic ultrasound
* EUS-guided

Into one term family.

Search logic should treat terms in the same family as OR.

Example:
(EUS OR endoscopic ultrasound OR EUS-guided)

This should help users understand that these are variants of the same idea.

3. Keep the UI simple.

Do not make the Organize Concepts tab visually overwhelming.

Use:

* clean concept cards
* collapsible advanced sections
* simple warnings
* clear term labels
* short explanations
* beginner-friendly wording

Avoid:

* too many chips with no hierarchy
* dense Boolean strings at the top
* showing all advanced syntax by default

====================================================
PART 6 — CONTROLLED VOCABULARY ENRICHMENT
=========================================

For every accepted or manually added keyword, the engine should try to find controlled-vocabulary suggestions under the same concept.

Controlled vocabulary:

* MeSH for PubMed/MEDLINE
* Emtree for Embase if supported or safely stubbed

Important:
Do not silently force MeSH/Emtree terms into the final strategy. Show them as suggestions that the user can include or exclude.

For each concept, show a simple coverage indicator:

Examples:

* MeSH found
* Emtree found
* No controlled vocabulary found yet
* Needs review

If no controlled vocabulary is found for a major concept, show a nudge:

“No controlled-vocabulary term found for this concept yet. Consider adding a MeSH or Emtree term if available.”

For each controlled vocabulary term, show:

* term name
* source: MeSH or Emtree
* concept
* include/exclude toggle
* explode on/off toggle if supported

Explain explode in simple language:
“Include narrower related terms.”

No live external calls should run in CI/tests. Use mocks or a clean service boundary. If real MeSH/Emtree support is incomplete, document the limitation honestly.

====================================================
PART 7 — SYNONYMS AND VARIANTS
==============================

Add or improve useful synonym/variant suggestions.

Examples:

* EUS ↔ endoscopic ultrasound
* T2DM ↔ type 2 diabetes mellitus
* tumor ↔ tumour
* randomized ↔ randomised
* drainage ↔ drain*
* adverse events ↔ complications
* biliary obstruction ↔ bile duct obstruction

Each suggestion should stay under the correct PICO concept.

The user should be able to:

* accept
* reject
* edit
* move to another concept
* combine into a term family

Do not flood the user with too many suggestions. Prioritize the most useful ones.

Use clear labels:

* Acronym
* Expanded term
* Synonym
* Spelling variant
* Truncation
* MeSH
* Emtree
* Manual

====================================================
PART 8 — LIVE HIT COUNTS IN ORGANIZE CONCEPTS
=============================================

If the current app already supports hit counts, add them to the Organize Concepts tab.

Goal:
While the user adjusts terms, they should see how the search changes.

Show if available:

* concept-level hit count
* total strategy hit count
* per-database hit count
* last updated time

Example:
Population concept:
PubMed: 4,250 hits

Intervention concept:
PubMed: 1,180 hits

Combined strategy:
PubMed: 214 hits

If hit counts are unavailable, do not fake them. Show:
“Hit counts not available yet.”

Add a simple sensitivity signal if feasible:

* Very broad
* Broad
* Balanced
* Narrow
* Very narrow

Use debounce to avoid excessive calls.
Do not make unsupported live external calls in CI/tests.
One database failing should not break the page.

====================================================
PART 9 — QUALITY CHECK FOUNDATION, NOT FULL BUILD
=================================================

Do not build a full PRESS or PRISMA-S system in this task.

However, create a small foundation for a future Search Quality Check.

For now, implement only the most important warnings if feasible:

* noisy candidate removed
* term appears in multiple concepts
* no controlled vocabulary for a major concept
* likely missing acronym expansion
* concept has no terms
* outcome terms may make the search too narrow
* comparator terms may make the search too narrow

Use simple wording:
“Search Quality Check”

Each warning should include:

* severity: info / warning / critical
* affected concept
* plain-language explanation
* suggested action

This should guide the user, not block them.

Document future ideas separately:

* full PRESS-style peer-review checklist
* PRISMA-S search report export
* validated filters/hedges
* full reproducible manuscript-ready search report

Add these future ideas to:

`docs/manager/search-builder-future-enhancements.md`

====================================================
PART 10 — STATE AND AUTOSYNC REQUIREMENTS
=========================================

All Search Builder changes should save safely.

Events to preserve:

* selected keywords
* rejected suggestions
* moved terms
* combined term families
* accepted/rejected MeSH/Emtree terms
* explode toggles
* manual terms
* manual concepts
* hidden/deleted terms
* selected databases
* generated strategies
* hit count metadata if available

Do not erase:

* manual concepts
* manual terms
* user-hidden terms
* accepted/rejected suggestions
* saved strategies

Avoid:

* duplicate terms
* cross-concept leakage
* blank-state overwrites
* last-write-wins overwrites if avoidable

If real-time collaboration exists, broadcast Search Builder updates to online collaborators. If not, document the limitation and implement the safest minimal sync behavior.

====================================================
IMPLEMENTATION ORDER
====================

Use this order. Do not jump to advanced features before fixing accuracy.

1. Inspect and document
2. Fix noisy extraction
3. Fix PICO-aware concept assignment
4. Add cross-concept duplicate detection
5. Add move/drag between concepts if feasible
6. Add combine term-family behavior if feasible
7. Add controlled vocabulary suggestions per concept
8. Add synonym/variant suggestions
9. Add live hit counts in Organize Concepts if already supported
10. Add small Search Quality Check warnings
11. Document deferred future enhancements

If any item is too risky or too large, implement the safe foundation and document what remains.

====================================================
TESTS
=====

Add or update tests for:

Extraction:

* stopwords/connectors are not suggested
* noisy words are not suggested
* meaningful multi-word phrases are preserved
* vague standalone verbs are excluded
* clinical phrases are retained

PICO mapping:

* terms map to the correct concept
* EUS/endoscopic ultrasound is not placed in Population unless contextually justified
* duplicate terms across concepts are detected
* duplicate warning appears
* user can move term to correct concept

Controlled vocabulary:

* MeSH suggestions appear under the correct concept
* Emtree is supported or cleanly stubbed/documented
* explode toggle works if implemented
* no live external calls in CI/tests

Synonyms/variants:

* acronym expansion works
* spelling variants suggested
* truncation suggestions generated
* accepted/rejected suggestions persist

Organize Concepts:

* moving terms updates concept assignment
* combining terms creates OR-based term family
* manual terms are preserved
* hidden terms are preserved
* strategy preview updates after changes

Hit counts:

* hit counts show if available
* unavailable state is safe and clear
* debounced updates work
* errors do not break the page

Regression:

* no duplicate terms after repeated opening/refreshing
* no blank-state overwrite
* PICO autosync still works
* manual concepts and manual terms remain intact
* unrelated app areas still work

====================================================
BUILD AND QUALITY CHECKS
========================

Run:

* typecheck
* tests
* build

Do not ignore failures. If a failure is unrelated and pre-existing, document it with evidence.

====================================================
VERSION AND COMMIT
==================

If the project uses versioning, bump the patch version.

Suggested commit message:

`fix(search-builder): improve extraction accuracy and PICO concept mapping`

====================================================
FINAL REPORT
============

At the end, report:

* root causes found
* what changed
* what was intentionally deferred
* files changed
* frontend changes
* backend changes if any
* data model changes if any
* controlled vocabulary approach
* hit count approach
* tests added/updated
* build/test results
* version bump
* commit hash
* push status
* known limitations
* recommended next steps

====================================================
ACCEPTANCE CRITERIA
===================

This task is complete only if:

* Step 1 no longer suggests obvious connector/noise words.
* Meaningful multi-word phrases are preserved.
* Terms are assigned to the correct PICO concept.
* EUS/endoscopic ultrasound does not appear in Population unless contextually justified.
* Duplicate terms across concepts are detected and warned.
* Users can move terms between concepts if feasible.
* Users can combine related terms into OR-based term families if feasible.
* Added/accepted keywords attempt controlled-vocabulary enrichment.
* MeSH suggestions appear under the correct concept.
* Emtree support is added if feasible or cleanly stubbed/documented.
* Organize Concepts shows live hit counts where available.
* Unavailable hit counts are clearly labeled and do not break the UI.
* Basic Search Quality Check warnings exist or are documented if deferred.
* Existing manual concepts, manual terms, hidden terms, and saved strategies are preserved.
* Search Builder remains beginner-friendly and not visually overwhelming.
* Existing functionality outside Search Builder is not broken.

Do not ask small clarification questions. Use best product judgment and document assumptions in `docs/manager`.
