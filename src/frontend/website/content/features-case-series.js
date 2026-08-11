/**
 * Content source for /features/case-series — 113 W1-A.
 *
 * Claims verified against src/research-engine/extraction/caseSeries.js,
 * src/research-engine/manuscript/{prismaCounts,factTokens,consistency,
 * readiness,tables}.js, src/features/extraction/engine/*,
 * src/frontend/workspace/tabs/analysisTabs.jsx and docs/case-series-106.md.
 * The limitations section restates that doc's own §8.
 *
 * Overlaps /features/data-extraction deliberately at one point (the counting
 * contract); everything else here is detail that page does not carry.
 */

export default `---
h1: Case series reviews: many patients, one publication
title: Case Series Systematic Review Software | PecanRev
description: Extract many patients from one paper as separate cases, with PRISMA still counting publications, an honest clustering warning, and a per-patient CSV export.
slug: features/case-series
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

A large body of clinical evidence lives in case reports and case series, where one publication describes several patients. PecanRev's case series mode models that directly: each patient becomes a case with its own extracted values, tied to its parent publication, while every count that should be about publications — PRISMA, included studies, the numbers in your Methods — keeps reporting publications. Extracting eight patients from one paper does not turn your flow diagram into eight records.

## Why do case-report reviews break ordinary review tooling?

Because most tools assume one paper equals one study equals one row. Reviews of rare disease, unusual presentations, novel devices and adverse events break that assumption immediately: the evidence base is dozens of papers describing one to twenty patients each, and the analysis unit is the patient while the reporting unit is the paper.

Teams work around this in two ways, and both are bad. Either they create one spreadsheet row per patient and their PRISMA diagram silently inflates, or they collapse each paper into one row and lose the patient-level detail that was the point of the review. The fix is not a workaround; it is having two units of counting and keeping them straight.

## How a case is modelled

A case is an ordinary study row carrying a small additional namespace: an immutable publication identifier shared by every sibling case, an immutable case identifier of its own, its ordinal number within the publication, and an optional label. A row without that namespace is an ordinary study and behaves exactly as before.

The parent link is an identifier rather than the citation, and that choice is load-bearing. A citation-derived key is built from mutable text, so correcting a DOI three weeks later would split one series into two, and a weak author-plus-year fallback could merge two different papers. An identifier assigned once survives every later correction.

## The counting contract

Six numbers are computed and they are deliberately different from one another:

- **Publications** — distinct articles. This is what PRISMA and "included studies" report.
- **Case-series articles** — how many of those publications are case series.
- **Cases** — individual patients extracted from them.
- **Rows** — raw rows in the dataset. Never a study count.
- **Analytical units** — cases plus non-case rows.
- Plus a simple flag for whether the project contains any cases at all.

Collapsing rows into publications has exactly one implementation in the codebase, and every count surface uses it: the PRISMA counts, the manuscript's fact tokens, the consistency and contradiction checks, the readiness gate, the characteristics table, the public synthesis page, the project overview and the duplicate validator. Twelve publications yielding forty-seven cases count as twelve publications everywhere, and that is pinned by test.

The collapse is also conservative about identity. Two rows merge into one publication only on provable identity — the shared publication link, or a strong citation key such as a DOI, a PMID, or author, year and title together. An ambiguous row stays its own publication, because over-counting an ambiguous row is honest and merging two different trials is not.

## What propagates, and what stays on the case

Article-level facts propagate automatically from the publication to every sibling case: authors, year, journal, DOI and PMID, country, study design, funding, the population, intervention and comparator definitions, the screening link and the stored document. Propagation deliberately reaches completed and locked siblings too — letting a DOI correction skip the finished cases would leave one article exporting two different DOIs.

Everything else is case-scoped: the patient's variables, the outcome, and any effect-size cells.

## Case variables

Case variables are project-wide reusable definitions with a label, a type, options, a unit, a group and a required flag. Types cover text, number, select, date and boolean; groups organise the form into demographics, presentation, investigations, management, outcome and other. Fourteen are seeded on first use — age, sex, presentation, symptoms, comorbidities, laboratory values, imaging, treatment, intervention, complications, follow-up, outcome, survival and time to event — all fully editable.

Values are stored flat on the case row, which is what allows every patient-level value to carry the same click-to-capture provenance as any other extracted number: the page, the region and the excerpt it came from.

## Working through a series

Turning the mode on is one checkbox on the article: this paper contains multiple cases. The open row becomes case one, and sibling rows of the same paper join the series. Cases then appear as chips with their own completion state, and switching between them does not reload or remount the PDF — the viewer is anchored on the publication, not the row.

Adding a case inherits the article-level fields. Duplicating a case copies its values but clears completion, locking and analysis-sync stamps, and **downgrades the copied provenance to manual with the page and region cleared** — a duplicated value has not been seen on that page, and claiming otherwise would be a false provenance record. Removing a case renumbers the survivors, keeps the immutable identifiers intact, and refuses to remove the last case of a series. Turning the mode off is non-destructive: the namespace is stripped, nothing is deleted.

## What the analysis does with cases

This is where an honest tool has to be careful, so PecanRev warns rather than silently pooling.

The number of studies in a pooled estimate counts rows, because rows are the observations the estimate is computed from — that is the correct denominator for the pooling maths, and it is deliberately a different number from the publication count reported in PRISMA. But cases from one report share a centre, a protocol and a reporting bias, so treating them as fully independent observations understates uncertainty. The analysis workspace says exactly that in a dedicated warning naming how many of the observations are cases and how many publications they came from, and it recommends reporting the publication and case counts separately and preferring a clustered or multilevel model.

The engine also exposes the case-to-publication pairing a clustered model needs, and case rows are excluded from the same-cohort duplicate detector, which would otherwise flag every sibling case as a duplicated cohort.

## In the manuscript

Case counts reach the write-up through exactly three facts — the number of individual cases, the number of case-series articles, and a combined publications-and-cases phrase — and through nothing else. No PRISMA box and no study count may read a case count; that is a stated invariant of the module.

When a review has no case series those facts resolve to nothing and leave a visible placeholder rather than printing a zero, and an ordinary review's draft is byte-identical to what it would have been before the feature existed.

## Exports

Cases export as CSV with one row per patient, carrying the publication metadata, the identifiers, the case label, every case variable with its unit, the proportion metadata used in single-arm pooling, the effect columns and the notes. The standard extraction CSV gains the case columns only when the project actually contains cases.

## What this does not do

- **Statistical pooling still treats cases as independent rows.** No clustered or multilevel estimator is implemented; the warning and the exported pairing are the handoff to a package that fits one.
- **Patient-level variables do not reach the analysis or the report builder.** There is no "median age across forty-seven cases" and no case-level subgroup analysis. The per-patient CSV is the route out.
- **Select-type variables cannot be filled by clicking the PDF**, because a picked token is never a controlled term. Number, text and date variables can.
- **Cases cannot be reordered from the interface** yet, though the operation exists underneath.
- **The structured table mapper — turning a patient-column table into cases — has no interface.** It is implemented and tested, and nothing surfaces it.
- **Audit entries are attributed to the row, not to the individual case.**
- **Removing a case variable hides its values rather than deleting them**, and there is no restore affordance.
- **Boolean variables render as free text**, and the required flag is neither settable in the editor nor enforced at completion.
- **Two genuinely independent studies published in one paper collapse to one publication**, and there is no way to declare them separate.
- **Turning the mode off can raise the publication count** for a paper whose citation is weak — no DOI, PMID or title — because each row then becomes its own publication again. Adding a DOI or title restores the collapse.
- **Enabling the mode on an article that already has several outcome rows converts them all into cases.** The banner reports how many were converted, and turning the mode off restores them.

## Where this sits in the workflow

Case mode lives inside [data extraction](/features/data-extraction) and is turned on per article. The counting contract is what keeps the [PRISMA flow diagram](/features/prisma-flow-diagram) reporting publications, and single-arm proportion pooling in [meta-analysis](/features/meta-analysis) is where case-derived proportions usually end up.
`;
