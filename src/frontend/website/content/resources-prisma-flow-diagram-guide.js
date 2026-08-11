/**
 * Content source for /resources/prisma-flow-diagram-guide.
 *
 * 113.md W1-B — the FLOW DIAGRAM specifically. /resources/prisma-2020-explained
 * owns the checklist and the "what changed in 2020" intent; this page owns the
 * diagram: which template, what each box counts, where each number comes from,
 * and the arithmetic. Cross-link, do not restate the checklist.
 */

export default `---
h1: How to build the PRISMA 2020 flow diagram
title: PRISMA Flow Diagram Guide: Boxes, Counts and Common Mistakes
description: Which PRISMA 2020 flow template to use, what each box counts, where every number comes from, and the arithmetic errors peer reviewers catch most often.
slug: resources/prisma-flow-diagram-guide
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

The PRISMA 2020 flow diagram is a figure that accounts for every record in a systematic review across four stages — identification, screening, eligibility and inclusion — such that each stage's output equals the previous stage's input minus what was removed at it. Its purpose is arithmetic accountability: a reader should be able to follow every retrieved record to either an exclusion with a reason or a place in the included set.

This guide is about the diagram itself. For the 27-item checklist and what changed from the 2009 statement, see [PRISMA 2020 explained](/resources/prisma-2020-explained).

## Which flow diagram template should you use?

PRISMA 2020 publishes more than one version, and choosing the wrong one is a reporting error before you have entered a single number.

- **New reviews, databases and registers only.** The simplest template. Use it when every record came from a database or a trial register.
- **New reviews, including other methods.** A two-column layout. The left column is databases and registers; the right column covers records identified by other methods — citation searching, contacting authors, organisation websites, hand searching. Use this whenever any of those contributed, which is most reviews that follow the guidance.
- **Updated reviews.** A variant with an additional set of boxes for studies included in the previous version of the review, and reports of those studies. Use it for a review update rather than forcing an update into the new-review template.

The templates are available from the PRISMA statement website. Do not redraw one from memory, and do not delete a box because it happens to be zero. A zero is a reported result; a missing box is a gap.

## What does each box count?

### Identification

**Records identified from databases and registers.** The raw number of records returned, per source, before any deduplication. Report it per database and per register, not only as a total. Registers — ClinicalTrials.gov, the WHO ICTRP — are named separately from bibliographic databases in the 2020 layout.

**Records removed before screening.** Three sub-counts: duplicate records removed, records marked as ineligible by automation tools, and records removed for any other reason. These are removals, not exclusions, and they sit above the screening box. Folding duplicates into "records excluded" is the single most common structural error in the diagram.

If you used an automation tool to mark records ineligible, that number belongs here and the tool has to be described in the methods. If you did not, the box is zero.

### Screening

**Records screened.** Identified minus removed before screening. This is the number of titles and abstracts a human actually judged.

**Records excluded.** The number excluded at title and abstract. No reasons are required at this stage, and adding a reason breakdown here is optional rather than expected.

### Eligibility

**Reports sought for retrieval.** Records that survived title-and-abstract screening and for which you tried to obtain the full text.

**Reports not retrieved.** Full texts you could not obtain. This box is frequently reported as zero when it should not be. If you could not get a paper and therefore could not assess it, that is a limitation of the review and it belongs in the diagram.

**Reports assessed for eligibility.** Sought minus not retrieved.

**Reports excluded, with reasons.** Every full text you read and rejected, grouped by the criterion it failed, with a count per reason. The reasons should be your pre-specified eligibility criteria, not free text invented per record. The reasons must sum to the total excluded, and PRISMA also asks for the list of excluded studies with their citations, normally in a supplement.

### Included

**Studies included in review**, and **reports of included studies**. Two numbers, not one.

## What is the difference between a record, a report and a study?

Getting these three words right is what makes the diagram reconcile.

- A **record** is a database entry — a title and abstract as returned by a search. Records are what you screen.
- A **report** is a document: a published paper, a preprint, a registry entry, a conference abstract.
- A **study** is a piece of research. One study can generate several reports: a protocol, a primary paper, a secondary analysis, a long-term follow-up.

The diagram switches vocabulary deliberately as it descends. The upper boxes count records, the middle boxes count reports, and the bottom counts both studies and their reports. A review of 30 studies described in 41 reports is normal and should be reported as both numbers.

Case series follow the same logic in the other direction. A case series describing eight patients is **one report of one study**. Extracting eight rows of patient-level data does not make it eight records, and a flow diagram inflated by patient counts will not reconcile against the search.

## Where does each number actually come from?

The diagram is a summary of your record ledger, so build the ledger first and read the diagram off it.

- **Per-database counts**: from the search execution itself, recorded on the day the search was run. Rerunning the strategy later gives a different number, and the diagram needs the original.
- **Duplicates removed**: from the deduplication step, which should be a recorded operation rather than a manual tidy-up. Report the method and the tool.
- **Screening counts**: from the decision recorded against each record. Every record must carry exactly one terminal decision.
- **Full-text outcomes**: from the retrieval log plus the full-text decision, with a reason attached to each exclusion.
- **Included studies and reports**: from the linkage between reports and studies, which has to be recorded explicitly. If two papers describe one trial, something in your data has to say so.

Numbers reconstructed from memory at write-up time are where diagrams go wrong. If a count cannot be traced to a recorded operation, it is an estimate, and PRISMA does not have a box for estimates.

## Does the diagram balance?

Four identities must hold for the databases-and-registers column:

- Records identified, minus records removed before screening, equals records screened.
- Records screened, minus records excluded, equals reports sought for retrieval.
- Reports sought, minus reports not retrieved, equals reports assessed for eligibility.
- Reports assessed, minus reports excluded, equals reports of included studies from this column.

The other-methods column follows the same pattern from its own starting number. The two columns converge only at the final included boxes, and the totals there are the sum of both paths.

A worked example. Suppose 2,410 records from four databases and 63 from two registers, so 2,473 identified. Deduplication removes 812, leaving 1,661 screened. Title-and-abstract screening excludes 1,547, so 114 reports are sought. Six cannot be obtained, so 108 are assessed. Sixty-nine are excluded with reasons — 31 wrong population, 22 wrong comparator, 11 no extractable outcome data, 5 conference abstract with no full report — leaving 39 reports. Citation searching contributed 14 records, of which 9 were assessed and 3 included. The review therefore includes 42 reports; if 4 of those are secondary publications of trials already counted, it includes 38 studies in 42 reports.

If your diagram does not balance, the error is almost never in the diagram. It is in the ledger: a record with two decisions, a record with none, a duplicate removed after screening rather than before, or a report counted as a study.

## What if the review is an update, or has no results?

**Updated reviews** use the update template, which carries the previously included studies through as their own boxes so a reader can see what the update added. Do not silently merge the previous review's included studies into the new identification count.

**Reviews that include no studies** still need the diagram. An empty review is a legitimate and informative result, and the flow diagram is what shows the reader that the search was adequate and the emptiness is real.

**Searches that returned zero records** are reported as zero for that database rather than omitted. Dropping the row makes the search look narrower than it was.

## How should the figure be produced and reported?

The diagram is a figure in the results section, referenced by the study selection item. Produce it from your recorded counts rather than by editing a template by hand, so that a late change to the record set propagates. Open tooling exists for this — Haddaway and colleagues published an R package and Shiny app that generates PRISMA 2020-compliant diagrams from a counts table.

Whatever produces it, the numbers in the figure, the numbers in the results text and the numbers in the abstract have to agree. A mismatch between the abstract's study count and the diagram's is the error peer reviewers catch most reliably, because it requires no expertise to spot.

## Common mistakes

- **Using the databases-only template** when citation searching or author contact contributed records.
- **Counting duplicates as records excluded** instead of removed before screening.
- **Reporting "reports not retrieved" as zero** when full texts were genuinely unavailable.
- **One number where two are required** in the final boxes: studies and reports are different counts.
- **Exclusion reasons that do not sum** to the total excluded at full text.
- **Reasons invented per record** rather than mapped to the pre-specified eligibility criteria.
- **Inflating the diagram with patient cases** from a case series.
- **Omitting a database that returned zero.**
- **A diagram that disagrees with the abstract.**
- **Deleting empty boxes** rather than reporting them as zero.

## References

- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)
- Page MJ, Moher D, Bossuyt PM, et al. PRISMA 2020 explanation and elaboration: updated guidance and exemplars for reporting systematic reviews. *BMJ*. 2021;372:n160. [doi:10.1136/bmj.n160](https://doi.org/10.1136/bmj.n160)
- The PRISMA statement website — flow diagram templates. [prisma-statement.org](https://www.prisma-statement.org)
- Haddaway NR, Page MJ, Pritchard CC, McGuinness LA. PRISMA2020: an R package and Shiny app for producing PRISMA 2020-compliant flow diagrams, with interactivity for optimised digital transparency and open synthesis. *Campbell Systematic Reviews*. 2022;18:e1230. [doi:10.1002/cl2.1230](https://doi.org/10.1002/cl2.1230)
- Rethlefsen ML, Kirtley S, Waffenschmidt S, et al. PRISMA-S: an extension to the PRISMA Statement for Reporting Literature Searches in Systematic Reviews. *Systematic Reviews*. 2021;10:39. [doi:10.1186/s13643-020-01542-z](https://doi.org/10.1186/s13643-020-01542-z)
- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 4: Searching for and selecting studies. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)

## Doing this in PecanRev

PecanRev derives PRISMA 2020 counts from the project's actual record ledger rather than from numbers typed into a form, so the diagram, the results text and the abstract read the same source. Per-source counts come from [search execution records](/features/search-engine) — retrieved, new, already present, duplicates skipped and failed are recorded per run, and a database that returned zero results is reported as zero rather than dropped. Deduplication runs as a recorded server-side job with reviewable match groups, so "duplicates removed" is a real number rather than a reconstruction.

Screening decisions are recorded per record in [screening](/features/screening), and the publication-versus-case distinction is enforced in [data extraction](/features/data-extraction): a case series contributes one publication to the flow no matter how many patient cases you extract from it.

In the [manuscript editor](/features/manuscript), PRISMA numbers are live fact tokens rather than typed values, and a count the project cannot answer renders as a visible bracketed placeholder — numeric coercion explicitly rejects null and empty values, so an unknown count can never render as "0 records identified". Manual overrides are possible and are clearly labelled as overrides, and they record the project value they disagree with.
`;
