/**
 * Content source for /resources/data-extraction-for-systematic-reviews.
 *
 * 113.md W1-B — extraction methodology guide. Conversion formulae named here are
 * the ones in the cited literature (Wan 2014, Luo 2018, Cochrane Handbook ch. 6);
 * multi-arm handling follows Cochrane Handbook ch. 23. Do not add a formula
 * without its source.
 */

export default `---
h1: Data extraction for systematic reviews
title: Data Extraction for Systematic Reviews: Forms, Outcomes and Arms
description: How to design and pilot an extraction form, handle continuous and dichotomous outcomes, multi-arm trials and case series, and keep every value traceable.
slug: resources/data-extraction-for-systematic-reviews
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

Data extraction is the step where a set of included papers becomes a dataset. You design a form from the protocol, pilot it on a handful of studies, have two people extract independently, adjudicate the differences, and record for every value both where it came from and any transformation applied to it. Extraction errors are the least visible errors in a systematic review: nothing about a wrong number looks wrong in a forest plot.

## What belongs on the extraction form?

The protocol decides the fields; the form implements them. A workable form has five groups.

- **Identification.** First author, year, journal, DOI or PMID, country, funding source and declared conflicts of interest, and the study's registration number if it has one.
- **Design and methods.** Design, setting, dates of recruitment, unit of allocation and unit of analysis, follow-up duration, and how missing data were handled.
- **Participants.** Eligibility criteria as the study stated them, number randomised or enrolled, number analysed, and the baseline characteristics that could plausibly modify the effect.
- **Interventions and comparators.** Enough detail that a reader can tell whether two studies gave the same treatment — dose, route, frequency, duration, co-interventions, and what the comparator actually was.
- **Outcomes.** For each outcome you plan to synthesise: its definition as the study defined it, the measurement instrument, the timepoint, and the numerical result in the exact form the paper reports it.

Add a free-text notes field. Judgement calls, oddities and assumptions have to live somewhere, and if the form has nowhere to put them they end up nowhere.

### Pilot the form before you trust it

Two extractors independently complete the form for three to five studies chosen to be different from each other, then compare field by field. Nearly every pilot finds at least one field that two competent people read two different ways, and one field nobody can populate because papers do not report it. Fix the form, then start.

Methodological guidance on extraction forms is thinner than most reviewers expect — Buchter and colleagues found the available guidance sparse and inconsistent — which is precisely why piloting matters more than form templates.

## How many extractors, and how are disagreements handled?

Two people extract independently and a third adjudicates. This is not ceremony: extraction error rates in single-extraction reviews are high enough to change conclusions, and the errors are silent.

Keep both original records. If you resolve a disagreement by overwriting one extractor's value, you destroy the only measurement you have of how reliable the extraction was. Write consensus as a third record, note how each disagreement was resolved, and you can report the disagreement rate as a quality signal.

Extractors should be masked to nothing in particular — masking to author and journal is occasionally proposed and rarely practical — but they must be masked to each other's values until adjudication, or the second extraction becomes a review of the first.

## Which numbers do you extract for each outcome type?

Extract what the paper reports, in the form it reports it, and derive the analysis quantity afterwards with a recorded formula. Reformatting numbers in your head at the point of entry is where units get lost.

### Dichotomous outcomes

Extract the number of events and the total analysed, per arm. Not the percentage, and not the odds ratio, if the counts are available — counts let you compute any effect measure later and let you check the paper's arithmetic, which is worth doing more often than you would expect.

Note whether the denominator is the number randomised or the number analysed, and record both when they differ. The difference is the study's attrition, which you need for risk of bias anyway.

### Continuous outcomes

Extract the mean, the standard deviation and the number analysed, per arm. Decide in advance whether you are pooling final values or change from baseline, and never mix the two in the same analysis without a documented reason — they estimate the same thing only under assumptions that rarely hold.

When the paper reports something else, record what it reported and convert with a named method:

- **Median with interquartile range or range to mean and SD** — Wan and colleagues give estimators for each case, improved for the median-and-range situation by Luo and colleagues. Both are approximations that assume approximate symmetry; for a strongly skewed outcome the honest choice is often not to pool.
- **Standard error to standard deviation** — multiply by the square root of the sample size.
- **A 95% confidence interval to a standard deviation** — via the interval width and the appropriate t or normal quantile.
- **A p-value plus an effect estimate to a standard error** — only when the test and its sidedness are stated.

Record the original reported values in their own fields, mark the derived value as derived, and name the conversion. A derived number that looks identical to a reported one is a reproducibility failure waiting to happen.

### Time-to-event outcomes

Extract the hazard ratio and its confidence interval, plus the number of events and the number at risk where reported. Reconstructing a hazard ratio from a survival curve is possible and sometimes necessary, but it is an estimation procedure with assumptions, and it belongs in the methods rather than being silently folded into the dataset.

### Ordinal, count and rate outcomes

Ordinal scales are usually dichotomised at a pre-specified cut point or treated as continuous when the scale is long; both choices need pre-specification because the cut point can be chosen after the fact to produce a result. Rates need the person-time denominator, not just the count.

## How do you extract a multi-arm trial without double counting?

A trial with three or more arms cannot simply contribute one comparison per arm pair to the same pairwise meta-analysis: the shared control arm would be counted more than once, understating the standard error and giving the trial too much weight.

The Cochrane Handbook sets out the legitimate options:

- **Include only the comparison relevant to your question** and report which arms you dropped and why.
- **Combine arms** into a single group where they are conceptually one intervention — summing event counts for dichotomous outcomes, and pooling means and standard deviations with the standard formula for continuous ones.
- **Split the shared arm** across comparisons, dividing the control group's events and total between them. This keeps all arms visible but produces correlated comparisons, which is a compromise, not a fix.

In a network meta-analysis the situation is different: multi-arm trials are handled properly by accounting for the correlation between comparisons from the same study, which is one of the reasons a network model is not just several pairwise models. Extract arm-level data — events and totals, or means and SDs per arm — rather than contrast-level effect estimates, because arm-level data can always be reduced to contrasts and the reverse is not true.

## How are case reports and case series extracted?

A single publication describing several patients raises a counting problem. The publication is one record in your PRISMA flow; the patients are several rows in your dataset. Conflating the two inflates the flow diagram and, in a synthesis of proportions, inflates the apparent sample.

Extract at two levels. Publication-level fields — authors, year, journal, identifiers, country, design, funding — belong to the publication and are shared by every case in it. Case-level fields — age, sex, presentation, investigations, treatment, complications, follow-up, outcome, time to event — belong to the individual patient.

Report both counts explicitly: the number of publications and the number of cases. And be careful about what a pooled proportion over case series means. Case series are selected for being reportable, so a proportion pooled across them estimates the frequency of a finding among reported cases, not among patients. The JBI critical appraisal tool for case series is the standard instrument for appraising them, and the JBI Manual for Evidence Synthesis covers the design in more detail than the Cochrane Handbook does.

## What must be recorded alongside each value?

Provenance is the difference between a dataset you can defend and one you cannot. For each extracted value, record where in the source it came from — ideally the page and the table or figure — who entered it, when, whether it was reported or derived, and which conversion produced it if derived.

The test is simple: eight months later, a reviewer asks why study 17's control-arm SD is 4.2. If answering requires re-reading the paper, the provenance was insufficient.

Lock the dataset when extraction is complete and treat later edits as amendments with a reason, because an edited value after pooling silently changes a published estimate.

## Common failure modes

- **Extracting percentages instead of counts.** You lose the ability to check arithmetic or change effect measure.
- **Mixing change-from-baseline and final values** in one pooled analysis.
- **Silent unit mismatches.** One study in millimoles per litre, another in milligrams per decilitre.
- **Undocumented conversions.** The number is defensible; the missing record of how it was produced is not.
- **Double counting a shared control arm** in a multi-arm trial.
- **Counting cases as records** in the PRISMA flow.
- **Extracting into a spreadsheet with no provenance column.** Fast, and unreconstructable later.

## References

- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 5: Collecting data; Chapter 6: Choosing effect measures and computing estimates of effect; Chapter 23: Including variants on randomized trials. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Wan X, Wang W, Liu J, Tong T. Estimating the sample mean and standard deviation from the sample size, median, range and/or interquartile range. *BMC Medical Research Methodology*. 2014;14:135. [doi:10.1186/1471-2288-14-135](https://doi.org/10.1186/1471-2288-14-135)
- Luo D, Wan X, Liu J, Tong T. Optimally estimating the sample mean from the sample size, median, mid-range, and/or mid-quartile range. *Statistical Methods in Medical Research*. 2018;27(6):1785-1805. [doi:10.1177/0962280216669183](https://doi.org/10.1177/0962280216669183)
- Buchter RB, Weise A, Pieper D. Development, testing and use of data extraction forms in systematic reviews: a review of methodological guidance. *BMC Medical Research Methodology*. 2020;20:259. [doi:10.1186/s12874-020-01143-3](https://doi.org/10.1186/s12874-020-01143-3)
- Munn Z, Barker TH, Moola S, et al. Methodological quality of case series studies: an introduction to the JBI critical appraisal tool. *JBI Evidence Synthesis*. 2020;18(10):2127-2133. [doi:10.11124/JBISRIR-D-19-00099](https://doi.org/10.11124/JBISRIR-D-19-00099)
- Aromataris E, Lockwood C, Porritt K, Pilla B, Jordan Z (editors). *JBI Manual for Evidence Synthesis*. JBI. [synthesismanual.jbi.global](https://synthesismanual.jbi.global)
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)

## Doing this in PecanRev

[PecanRev data extraction](/features/data-extraction) puts the PDF and the structured form side by side. Focusing a field and clicking a number in the paper captures it with the page, a bounding box and the excerpt, so the source chip can scroll back to the exact region later. Projects define their own data elements as a versioned form, and elements can be scoped to a specific arm — which is what arm-level extraction for multi-arm trials and network meta-analysis requires.

Eleven named conversions are implemented, each labelled with its formula, its literature reference, a caution tier and its explicit assumptions, including the Wan median-and-IQR method described above. Originally reported values are stored immutably in their own fields and derived values are flagged as converted.

Two extractors can work on the same article without seeing each other's values, and the adjudicator's consensus is written as a separate record so neither original is overwritten. Case series are modelled directly: a case is a study row tagged with its publication, and PRISMA and study counts continue to report publications, not cases. Extracted data feeds [meta-analysis](/features/meta-analysis) in the same project without an export step.
`;
