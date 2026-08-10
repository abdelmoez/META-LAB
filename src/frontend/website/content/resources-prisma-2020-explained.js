/**
 * Content source for /resources/prisma-2020-explained.
 * 111.md §§9, 37 — cornerstone page. All references verified real.
 */

export default `---
h1: PRISMA 2020 explained
title: PRISMA 2020 Explained: Checklist, Flow Diagram and Common Mistakes
description: What changed in PRISMA 2020, what the 27-item checklist asks for, how to build the flow diagram correctly, and the reporting errors reviewers catch most often.
slug: resources/prisma-2020-explained
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

PRISMA is a reporting guideline. That sentence carries more weight than it looks. PRISMA does not tell you how to conduct a systematic review, how many databases to search, or whether to pool. It tells you what you must **report** so that a reader can judge how the review was conducted. Treating it as a methods standard is the most common category error in the field; treating it as a box-ticking exercise at submission time is the second.

The current version is PRISMA 2020, published simultaneously across several journals in 2021, replacing the 2009 statement.

## What changed in 2020

The 2009 statement had 27 items; so does 2020, but the content moved substantially.

- **Search reporting is much stricter.** The 2020 statement asks for the full search strategy for every database, register and website, including any filters and limits — not a description of it, the strategy itself.
- **The identification step was restructured.** The flow diagram now separates records identified from databases and registers from records identified by other methods, and adds an explicit option to report records removed before screening, including duplicates and records removed by automation tools.
- **Automation is acknowledged.** Items now ask whether automation tools were used in searching, screening, data collection and risk-of-bias assessment, and how.
- **Certainty of evidence has its own items**, covering both assessment and presentation.
- **Reporting bias assessment** replaced the narrower framing of publication bias.
- **Registration, protocol and amendments** are explicitly required, including any amendments and the reasons for them.
- **A new abstract checklist** (PRISMA 2020 for Abstracts, 12 items) applies to the abstract specifically.

Extensions cover specific situations: PRISMA-S for search reporting, PRISMA-ScR for scoping reviews, PRISMA-P for protocols, PRISMA-NMA for network meta-analyses, and others.

## The checklist, section by section

### Title and abstract

Item 1 asks you to identify the report as a systematic review in the title. Item 2 points to the separate abstract checklist. A structured abstract that omits the number of studies, the number of participants and the certainty of evidence will fail it.

### Introduction

Items 3 and 4 cover the rationale in the context of existing knowledge and an explicit statement of objectives or questions, normally in PICO terms.

### Methods

This is where reviews most often lose marks.

- **Eligibility criteria** (item 5) — and how studies were grouped for synthesis.
- **Information sources** (item 6) — every database, register, website, organisation and reference list consulted, with the date each was last searched.
- **Search strategy** (item 7) — the full strategy for all sources, including filters and limits.
- **Selection process** (item 8) — how many reviewers screened each record, whether they worked independently, and any automation tools used.
- **Data collection process** (item 9) — the same detail for extraction.
- **Data items** (items 10a, 10b) — the outcomes sought and how you handled results that were reported in multiple compatible ways, plus all other variables extracted and any assumptions made about missing information.
- **Study risk of bias assessment** (item 11) — the tool, how many assessors, independence, automation.
- **Effect measures** (item 12).
- **Synthesis methods** (items 13a-13f) — eligibility for each synthesis, data preparation, tabulation and visual display, the synthesis method itself, heterogeneity exploration and sensitivity analyses.
- **Reporting bias assessment** (item 14) and **certainty assessment** (item 15).

### Results

- **Study selection** (items 16a, 16b) — the flow diagram, plus studies that met the criteria but were excluded, with reasons.
- **Study characteristics** (17), **risk of bias in studies** (18), **results of individual studies** (19), **results of syntheses** (20a-20d), **reporting biases** (21), **certainty of evidence** (22).

### Discussion and other information

Interpretation, limitations of the evidence and of the review process, implications; then registration and protocol, support, competing interests, and availability of data, code and other materials.

## Building the flow diagram correctly

The diagram accounts for every record from identification through to the studies included in the review. Two structural points cause most errors.

**Databases/registers and "other methods" are separate columns.** Records found by citation searching, by contacting authors, from organisational websites, or by hand searching do not belong in the database count. They flow down a parallel path.

**Removals before screening are their own box.** Duplicate records removed, records marked ineligible by automation tools, and records removed for other reasons are reported before the screening count — not folded into exclusions.

Then, in order: records screened, records excluded; reports sought for retrieval, reports not retrieved; reports assessed for eligibility, reports excluded with reasons; studies included, and reports of included studies.

### Reports versus studies

This distinction is worth internalising because it is where a diagram usually stops adding up. A **study** is a piece of research. A **report** is a publication describing it. One study can have several reports — a protocol, a primary results paper, a secondary analysis, a conference abstract. The final boxes count both: studies included in review, and reports of those included studies.

The same logic governs case series. A case series describing eight patients is **one report of one study**, not eight records, even if you extract eight rows of patient data from it.

### Numbers that must reconcile

- Records identified, minus records removed before screening, equals records screened.
- Records screened, minus records excluded, equals reports sought for retrieval.
- Reports sought, minus reports not retrieved, equals reports assessed for eligibility.
- Reports assessed, minus reports excluded, equals reports of included studies.

If your diagram does not balance, the error is upstream in the record accounting, not in the diagram.

## Reasons for exclusion

PRISMA asks for exclusion reasons at the **full-text** stage, not at title and abstract. You do not need to justify each of the 4,000 abstracts you screened out. You do need to state, for each full text you read and rejected, which criterion it failed — and the reasons should map to your pre-specified eligibility criteria, not be invented per record.

## Common mistakes

- **Reporting a search "description" instead of the search strategy.** Item 7 wants the copy-pasteable strategy.
- **Omitting the date each source was last searched.** Item 6 asks for it per source.
- **Counting duplicates as screened records.** They are removed before screening.
- **Mixing citation-searching finds into the database column.**
- **Reporting studies and reports interchangeably** in the final boxes.
- **Silently dropping a database that returned zero results.** A zero is a result and should be reported.
- **Claiming dual independent screening in the methods** when only one person screened. Item 8 asks specifically how many reviewers screened each record and whether they worked independently.
- **Filling in the checklist after the fact** so that it describes the paper rather than the review. The checklist is a reporting aid, not a certification.

## PRISMA is not a quality score

A review can be fully PRISMA-compliant and still be a poor review: a single-database search, thoroughly reported, is still a single-database search. Conversely, an excellent review can be badly reported. PRISMA raises the floor on transparency, which is a precondition for judging quality — not a substitute for it. AMSTAR 2 and ROBIS are the instruments for appraising a review's conduct.

## References

- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)
- Page MJ, Moher D, Bossuyt PM, et al. PRISMA 2020 explanation and elaboration: updated guidance and exemplars for reporting systematic reviews. *BMJ*. 2021;372:n160. [doi:10.1136/bmj.n160](https://doi.org/10.1136/bmj.n160)
- Rethlefsen ML, Kirtley S, Waffenschmidt S, et al. PRISMA-S: an extension to the PRISMA Statement for Reporting Literature Searches in Systematic Reviews. *Systematic Reviews*. 2021;10:39. [doi:10.1186/s13643-020-01542-z](https://doi.org/10.1186/s13643-020-01542-z)
- Shea BJ, Reeves BC, Wells G, et al. AMSTAR 2: a critical appraisal tool for systematic reviews that include randomised or non-randomised studies of healthcare interventions, or both. *BMJ*. 2017;358:j4008. [doi:10.1136/bmj.j4008](https://doi.org/10.1136/bmj.j4008)
- The PRISMA statement website: [prisma-statement.org](https://www.prisma-statement.org)

## In PecanRev

PecanRev derives PRISMA counts from the actual screening record ledger rather than from numbers you type, keeps the publication-versus-case distinction intact for case series, and reports a database that returned zero results as zero rather than dropping it. See [screening](/features/screening) and the [manuscript editor](/features/manuscript).
`;
