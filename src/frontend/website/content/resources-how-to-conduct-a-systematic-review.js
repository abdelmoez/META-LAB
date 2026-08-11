/**
 * Content source for /resources/how-to-conduct-a-systematic-review.
 *
 * 113.md W1-B — the cornerstone HOW-TO guide. Deliberately operational: the
 * companion page /resources/what-is-a-systematic-review owns the definition and
 * the "what is it" intent, so this one owns "how do I actually run one" —
 * deliverables, decisions and order of work, step by step.
 *
 * Every reference below is a real, verifiable publication. Do not add a citation
 * you have not checked, and do not describe a PecanRev capability that does not
 * ship.
 */

export default `---
h1: How to conduct a systematic review
title: How to Conduct a Systematic Review: A Step-by-Step Guide
description: An operational eight-step walkthrough of running a systematic review, from protocol and search through screening, extraction, appraisal and reporting.
slug: resources/how-to-conduct-a-systematic-review
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

To conduct a systematic review, you fix a question and a protocol before you look at results, run a documented multi-database search, screen every record against pre-specified criteria in duplicate, extract data into a piloted form, appraise each included study for risk of bias, synthesise only what is compatible, and report the whole process against PRISMA 2020. The order is not decorative. Each step produces the input the next one consumes, and every shortcut you take early is inherited by everything downstream.

This guide is the operational companion to [what a systematic review is](/resources/what-is-a-systematic-review). That page defines the method and how it differs from a narrative review; this one is about the doing — what each step actually produces, who does it, and the decision you have to make before you can move on.

## Step 1: What makes a question answerable?

A reviewable question is one where two competent people, reading the same paper, would agree on whether it is in scope. PICO — Population, Intervention, Comparator, Outcome — is the usual scaffold for intervention questions, with PECO for exposures and PICOS when design is itself a criterion.

The test to apply before you go further: write your eligibility criteria, take ten papers you already know, and have a colleague independently classify them. If you disagree on more than one, the criteria are not yet operational. Ambiguity discovered here costs an afternoon; the same ambiguity discovered during screening costs weeks and contaminates your PRISMA counts.

Decide at this stage whether the answer will be a pooled estimate or a structured narrative. It changes what you extract.

**Deliverable:** a one-paragraph question and a numbered list of inclusion and exclusion criteria.

## Step 2: What goes in the protocol, and why register it?

The protocol states everything you will do before you know what the results will be: question, criteria, databases and search strategy, screening process and number of reviewers, the data elements to extract, the risk-of-bias instrument, the planned synthesis and any planned subgroups.

Registration — PROSPERO for most health reviews — is what converts pre-specification into an externally checkable claim. Without a timestamped record, "we pre-specified this subgroup" is unverifiable, and reviewers increasingly treat it as unverified.

Amend rather than rewrite. A protocol amendment with a date and a reason is a normal part of doing research. A protocol that quietly matches the final analysis is not.

**Deliverable:** a registered protocol with a registration number, and a change log kept from day one.

## Step 3: How do you build and document the search?

A systematic search means several databases chosen for the question, a strategy built concept by concept, and a record of exactly what was run and when. Subject coverage differs substantially between MEDLINE, Embase, CENTRAL and subject-specific databases, and the difference is not random noise you can ignore — Bramer and colleagues found that no single database was sufficient and that the required combination depended on the topic.

Have the strategy peer reviewed before you run it. PRESS is a published checklist for exactly this, and an information specialist reading your line-by-line strategy for an hour is the cheapest error-correction available in the whole project.

Search beyond bibliographic databases where the question warrants it: trial registries, reference lists of included studies, forward citation searching, and grey literature.

PRISMA-S sets out what must be reported: every database with its platform and the date searched, the full strategy for at least one database verbatim, any limits or filters, and the deduplication method.

The [search strategy guide](/resources/systematic-review-search-strategy) covers concept blocks, MeSH and Boolean construction in detail.

**Deliverable:** a saved, dated strategy per database, the raw result counts, and a deduplicated record set.

## Step 4: How should screening be organised?

Screening runs in two passes: title and abstract first, then full text for everything that survives. Two reviewers screen independently and disagreements are resolved by discussion or by a third reviewer.

Three practical rules save more time than any tool:

- **Pilot on 50 to 100 records together** before splitting the work. Most criterion ambiguity surfaces in the first fifty.
- **Screen inclusively at title and abstract.** The cost of carrying a doubtful record to full text is minutes; the cost of wrongly excluding it is a missed study nobody will ever detect.
- **Record exclusion reasons only at full text.** PRISMA 2020 requires a reason per excluded full-text report, and does not require one for records excluded on title and abstract.

The evidence on single versus dual screening is genuinely mixed and context-dependent; dual screening remains the default recommendation, and a review that departs from it should say so and justify it.

See [title and abstract screening](/resources/title-and-abstract-screening) for the mechanics.

**Deliverable:** a decision per record, exclusion reasons for every full-text exclusion, and a reconciled included set.

## Step 5: What does a good extraction form look like?

Design the form from the protocol, then pilot it on three to five studies with two extractors and compare. The pilot almost always reveals a field that means two different things to two people.

Extract what the paper reports in the form it reports it, and derive the rest with a documented formula rather than reformatting numbers by hand. Converting a median and interquartile range to a mean and standard deviation is legitimate and well described; doing it without recording that you did it is not.

Two people extract independently and an adjudicator resolves differences. Keep both original records — the disagreement rate is itself a reportable quality signal, and it disappears the moment you overwrite one extractor's values with the other's.

The [data extraction guide](/resources/data-extraction-for-systematic-reviews) covers outcome types, multi-arm trials and case series.

**Deliverable:** a locked extraction dataset with per-value provenance and a documented conversion log.

## Step 6: How do you appraise the included studies?

Risk of bias is judged per study and per outcome, with an instrument matched to the design: RoB 2 for randomised trials, ROBINS-I for non-randomised studies of interventions, QUADAS-2 for diagnostic accuracy, the Newcastle-Ottawa Scale for cohort and case-control studies.

Assess internal validity, not reporting quality. A well-conducted trial with a thin methods section is a reporting problem; an unblinded outcome assessment for a subjective outcome is a bias problem. Confusing the two produces appraisals that track journal style rather than study conduct.

Certainty in the body of evidence for each outcome is a separate judgement, normally made with GRADE after synthesis, and it takes risk of bias as one of five inputs alongside inconsistency, indirectness, imprecision and publication bias.

See [risk of bias assessment](/resources/risk-of-bias-assessment) for the domain-by-domain detail.

**Deliverable:** a per-study, per-outcome judgement with a written rationale for each domain.

## Step 7: When should you pool, and when should you not?

Pool when the studies address the same question closely enough that a single average is a meaningful summary of them. That is a clinical and methodological judgement made before you see the forest plot, not a statistical one made after.

If you pool, pre-specify the effect measure and the model, report both heterogeneity and a prediction interval where estimable, and investigate heterogeneity only through the routes you pre-specified. If you do not pool, synthesise structurally — SWiM is the reporting guideline for synthesis without meta-analysis, and following it produces something far more useful than a list of study summaries.

"We could not pool responsibly, so we synthesised narratively" is an honest finding. A pooled estimate over clinically incompatible studies is a number with no referent.

See [forest plots and heterogeneity](/resources/forest-plots-and-heterogeneity), [publication bias](/resources/publication-bias) and [how to run a meta-analysis](/resources/how-to-run-a-meta-analysis).

**Deliverable:** the synthesis, its heterogeneity assessment, and the pre-specified investigations you actually ran.

## Step 8: What does complete reporting require?

PRISMA 2020 is the reporting standard: a 27-item checklist, an abstract checklist, and a flow diagram accounting for every record from identification to inclusion. The [flow diagram guide](/resources/prisma-flow-diagram-guide) covers the arithmetic that most often fails to reconcile.

Report the search strategy verbatim for at least one database, the full list of excluded full-text reports with reasons, per-study characteristics, per-study risk-of-bias judgements, and the certainty of evidence per outcome. Data, code and extraction forms belong in an open repository where the journal permits it.

**Deliverable:** a manuscript whose numbers reconcile with the project data, plus the supplementary material that makes the review reproducible.

## How long does each step take?

Two steps dominate: screening scales with the number of records retrieved, and extraction scales with included studies multiplied by outcomes. Search design is a small share of the effort and drives both of the others, which is the argument for spending disproportionate time on it and having it peer reviewed.

The steps teams routinely underestimate are full-text retrieval, adjudicating extraction disagreements, and the reconciliation pass at the end where the abstract, the results and the flow diagram are made to agree.

## What goes wrong most often?

- **Starting the search before the criteria are operational.** Everything downstream inherits the ambiguity.
- **One database.** The most common and most damaging shortcut.
- **Criteria that drift during screening** without an amendment record.
- **Extracting into a spreadsheet with no provenance.** Eight months later nobody can say which table a number came from.
- **Pooling because the data are poolable.** Statistical compatibility is not clinical compatibility.
- **A flow diagram that does not reconcile** with the numbers in the results text.

## References

- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)
- Page MJ, Moher D, Bossuyt PM, et al. PRISMA 2020 explanation and elaboration: updated guidance and exemplars for reporting systematic reviews. *BMJ*. 2021;372:n160. [doi:10.1136/bmj.n160](https://doi.org/10.1136/bmj.n160)
- Rethlefsen ML, Kirtley S, Waffenschmidt S, et al. PRISMA-S: an extension to the PRISMA Statement for Reporting Literature Searches in Systematic Reviews. *Systematic Reviews*. 2021;10:39. [doi:10.1186/s13643-020-01542-z](https://doi.org/10.1186/s13643-020-01542-z)
- McGowan J, Sampson M, Salzwedel DM, Cogo E, Foerster V, Lefebvre C. PRESS Peer Review of Electronic Search Strategies: 2015 Guideline Statement. *Journal of Clinical Epidemiology*. 2016;75:40-46. [doi:10.1016/j.jclinepi.2016.01.021](https://doi.org/10.1016/j.jclinepi.2016.01.021)
- Bramer WM, Rethlefsen ML, Kleijnen J, Franco OH. Optimal database combinations for literature searches in systematic reviews: a prospective exploratory study. *Systematic Reviews*. 2017;6:245. [doi:10.1186/s13643-017-0644-y](https://doi.org/10.1186/s13643-017-0644-y)
- Campbell M, McKenzie JE, Sowden A, et al. Synthesis without meta-analysis (SWiM) in systematic reviews: reporting guideline. *BMJ*. 2020;368:l6890. [doi:10.1136/bmj.l6890](https://doi.org/10.1136/bmj.l6890)
- Booth A, Clarke M, Dooley G, et al. The nuts and bolts of PROSPERO: an international prospective register of systematic reviews. *Systematic Reviews*. 2012;1:2. [doi:10.1186/2046-4053-1-2](https://doi.org/10.1186/2046-4053-1-2)

## Doing this in PecanRev

One PecanRev project carries all eight steps and the audit trail that connects them. The [search engine](/features/search-engine) compiles one concept board into paste-ready queries for sixteen databases and produces a PRISMA-S style report from execution records rather than from settings. [Screening](/features/screening) records decisions per record with blind review available; [data extraction](/features/data-extraction) supports two independent extractors plus an adjudicator, with per-value provenance back to the page; [meta-analysis](/features/meta-analysis) runs on the extracted data in the same project; and the [manuscript editor](/features/manuscript) resolves study counts and PRISMA numbers as live tokens, so the abstract and the flow diagram cannot disagree.
`;
