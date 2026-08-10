/**
 * Content source for /resources/what-is-a-systematic-review.
 * 111.md §§9, 10, 37 — cornerstone educational page. Every reference below is a
 * real, verifiable publication; do not add a citation you have not checked.
 */

export default `---
h1: What is a systematic review?
title: What Is a Systematic Review? Definition, Steps and Standards
description: A systematic review answers a defined question using a pre-specified, reproducible method. This guide explains what separates it from a literature review, the standard steps, and the reporting rules that govern it.
slug: resources/what-is-a-systematic-review
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

A systematic review is a review of the evidence on a clearly formulated question that uses explicit, pre-specified methods to identify, select and critically appraise relevant studies, and to collect and analyse the data from those studies. The defining property is not thoroughness — it is **reproducibility**. Another team, given the protocol, should be able to run the same search, apply the same eligibility criteria, and arrive at the same included set.

That definition follows the Cochrane Handbook, which sets out the key characteristics as a clearly stated set of objectives with pre-defined eligibility criteria, an explicit and reproducible methodology, a systematic search that attempts to identify all studies meeting the eligibility criteria, an assessment of the validity of the findings of the included studies, and a systematic presentation and synthesis of their characteristics and findings.

## Systematic review versus literature review

The distinction is methodological, not one of length or quality of writing.

- **Question.** A narrative review may start broad and let the question evolve. A systematic review fixes the question before the search.
- **Search.** A narrative review searches at the author's discretion. A systematic review documents an exhaustive, reproducible search.
- **Selection.** A narrative review selects implicitly. A systematic review applies pre-defined eligibility criteria, normally with more than one person judging each record.
- **Appraisal.** A narrative review may skip critical appraisal. A systematic review assesses risk of bias with a structured instrument.
- **Synthesis.** A narrative review synthesises in prose. A systematic review synthesises systematically, quantitatively where the studies allow it.
- **Reproducibility.** A narrative review is not reproducible. A systematic review is, by design.

A narrative review is a legitimate and often valuable form. It is simply not a systematic review, and presenting one as the other misrepresents the strength of the evidence.

A **meta-analysis** is a statistical technique for combining results across studies. It is one possible component of a systematic review, not a synonym for it. Many good systematic reviews contain no meta-analysis, because the included studies are too clinically or methodologically diverse to pool responsibly.

## The steps

### 1. Formulate the question

Most clinical questions are framed as PICO: Population, Intervention, Comparator, Outcome. Variants exist for other designs — PECO for exposures in observational research, PICOS when the study design is itself a criterion, SPIDER for qualitative evidence. The framework matters less than the discipline it imposes: the question must be specific enough that two people can independently decide whether a given paper is about it.

### 2. Write and register a protocol

The protocol states the question, eligibility criteria, search strategy, screening process, data to be extracted, risk-of-bias tool, and planned synthesis — all **before** the results are known. Registering it publicly, usually in PROSPERO for health-related reviews, is what makes outcome switching and post-hoc criterion changes visible.

Pre-specification is the single most effective safeguard in the whole method. Eligibility criteria written after you have seen which studies exist are not criteria; they are a conclusion.

### 3. Search the literature

A systematic search means multiple databases, a strategy designed around the concepts in the question, and full documentation of what was run and when. Searching only PubMed is a common and consequential shortcut: subject coverage differs substantially across MEDLINE, Embase, CENTRAL, and subject-specific databases, and the difference is not random.

The search should also cover sources that are not bibliographic databases: trial registries, reference lists of included studies, and grey literature where relevant to the question.

PRISMA-S sets out what a reported search must contain — every database with its platform and date, the full strategy for at least one database, and the deduplication method.

### 4. Screen

Records are screened in two passes: titles and abstracts first, then full texts of anything that survives. Standard practice is for two reviewers to screen independently and resolve disagreements by discussion or by a third reviewer. Reasons for exclusion are recorded at the full-text stage — and only at that stage; PRISMA does not require a reason for each record excluded on title and abstract.

Single screening is faster and, in some contexts, may miss relatively few includable studies — but the evidence on this is mixed and context-dependent, and dual screening remains the default recommendation.

### 5. Extract data

Two people extract independently into a piloted form, and disagreements are adjudicated. What gets extracted is decided in the protocol: study characteristics, participant characteristics, intervention details, outcome definitions, and the numerical results in the form the paper reports them.

Record what the paper actually reports and derive the rest with a documented formula. Converting a median and interquartile range to a mean and standard deviation is legitimate and well described in the literature; doing it without recording that you did it is not.

### 6. Assess risk of bias

Risk of bias is assessed per study, per outcome, using an instrument appropriate to the design — RoB 2 for randomised trials, ROBINS-I for non-randomised studies of interventions, QUADAS-2 for diagnostic accuracy studies, the Newcastle-Ottawa Scale for cohort and case-control studies. This is about the internal validity of each study, not about the quality of its reporting.

Certainty in the body of evidence for each outcome is a separate judgement, usually made with GRADE.

### 7. Synthesise

Where studies are similar enough in population, intervention, comparator and outcome, results can be pooled statistically. Where they are not, structured narrative synthesis — for example following the SWiM reporting guideline — is the correct choice. "We could not pool, so we listed the studies" is a weaker but honest outcome; pooling incompatible studies to produce a number is a stronger-looking but wrong one.

### 8. Report

PRISMA 2020 is the reporting standard for systematic reviews in health research: a 27-item checklist plus a flow diagram accounting for every record from identification to inclusion.

## How long does a systematic review take?

Longer than most first-time teams expect. The steps that consume the time are screening — which scales linearly with the number of records retrieved — and data extraction, which scales with the number of included studies and the number of outcomes. Search design is a small fraction of the total effort and has an outsized effect on all of it, which is a good argument for spending time there.

## Common failure modes

- **Searching one database.** The most frequent and most damaging shortcut.
- **Criteria that shift during screening.** If you have to refine a criterion, record the change and the reason; do not rewrite history.
- **Pooling everything poolable.** Statistical compatibility is not clinical compatibility.
- **Reporting a subgroup finding as if it were pre-specified.** Post-hoc subgroups are hypothesis-generating.
- **Losing the audit trail.** If you cannot reconstruct why a record was excluded eight months later, the review is not reproducible, whatever the methods section says.

## References

- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)
- Rethlefsen ML, Kirtley S, Waffenschmidt S, et al. PRISMA-S: an extension to the PRISMA Statement for Reporting Literature Searches in Systematic Reviews. *Systematic Reviews*. 2021;10:39. [doi:10.1186/s13643-020-01542-z](https://doi.org/10.1186/s13643-020-01542-z)
- Institute of Medicine. *Finding What Works in Health Care: Standards for Systematic Reviews*. Washington, DC: The National Academies Press; 2011. [doi:10.17226/13059](https://doi.org/10.17226/13059)
- Booth A, Clarke M, Dooley G, et al. The nuts and bolts of PROSPERO: an international prospective register of systematic reviews. *Systematic Reviews*. 2012;1:2. [doi:10.1186/2046-4053-1-2](https://doi.org/10.1186/2046-4053-1-2)
- Waffenschmidt S, Knelangen M, Sieben W, Buhn S, Pieper D. Single screening versus conventional double screening for study selection in systematic reviews: a methodological systematic review. *BMC Medical Research Methodology*. 2019;19:132. [doi:10.1186/s12874-019-0782-0](https://doi.org/10.1186/s12874-019-0782-0)

## Doing this in PecanRev

PecanRev implements this workflow as a single project: [search strategy building](/features/search-engine), [screening](/features/screening), [data extraction](/features/data-extraction), [meta-analysis](/features/meta-analysis), and a [manuscript editor](/features/manuscript) whose PRISMA counts are read live from the project rather than typed in.
`;
