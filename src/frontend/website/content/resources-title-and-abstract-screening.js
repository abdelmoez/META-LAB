/**
 * Content source for /resources/title-and-abstract-screening.
 * 111.md §9 — cornerstone page. References verified real.
 */

export default `---
h1: Title and abstract screening: a practical guide
title: Title and Abstract Screening: A Practical Guide
description: How to pilot eligibility criteria, decide between single and dual screening, resolve conflicts, use screening automation responsibly, and record decisions so PRISMA reporting works.
slug: resources/title-and-abstract-screening
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

Title and abstract screening is the first sieve. Its job is not to find the studies you will include — it is to discard, cheaply and safely, the records that cannot possibly be relevant. Understanding that asymmetry is the whole skill: a false exclusion at this stage is usually unrecoverable, while a false inclusion costs one full-text read.

Screen for **plausibility, not certainty**. If the abstract does not give you enough to exclude, it is a full text.

## Before you screen: pilot the criteria

Eligibility criteria that read clearly in a protocol frequently turn out to be ambiguous in contact with real abstracts. Pilot them before starting.

A workable pilot: both reviewers independently screen the same 50 to 100 records, then compare. You are not looking for a good agreement statistic — you are looking for the specific records you disagreed on, because each one identifies an under-specified criterion. Rewrite the criterion, record the amendment and its reason, and repeat if agreement is still poor.

Write criteria that can be applied by someone who is not you. "Adult patients" needs an age boundary. "Recent studies" needs a year. "Relevant outcomes" needs a list.

## Single or dual screening?

The default recommendation from Cochrane and from the Institute of Medicine standards is that two people screen each record independently and that disagreements are resolved by discussion or by a third reviewer. The reason is straightforward: single screening misses includable studies at a rate that is not negligible and not predictable in advance.

The methodological literature is more nuanced than "always double". A systematic review of the question found that error rates for single screening vary widely across studies and topics, so a blanket claim in either direction is not supported. What is well supported:

- Dual independent screening at **title and abstract** is the standard against which alternatives are measured.
- If resources force a compromise, safer designs exist than plain single screening — for example, one reviewer screens all records and a second screens all *excluded* records, or a second reviewer checks a random sample so that the error rate is at least estimated rather than assumed.
- Whatever you do, **report it accurately**. PRISMA 2020 item 8 asks how many reviewers screened each record and whether they worked independently. A methods section claiming independent duplicate screening for a process that was single-screened is a reporting failure, not a shortcut.

## Resolving conflicts

Disagreement is information. A conflict rate that is very low may mean the criteria are clear, or it may mean the reviewers are anchoring on each other. A high rate usually means a criterion needs rewriting.

Practical approach:

1. **Do not resolve conflicts one by one as they arise.** Batch them. Patterns are visible in a batch and invisible one at a time.
2. **Group conflicts by criterion.** Fifteen conflicts about the same population boundary is one problem, not fifteen.
3. **Default to inclusion** when the disagreement is about insufficient information. The cost is one full-text retrieval.
4. **Record the resolution mechanism** — discussion, third reviewer, or a criterion amendment — because PRISMA asks for the process, and because a criterion amendment mid-screening must be applied retrospectively to records already screened.

Blinding reviewers to each other's decisions while screening is worth doing. Once you can see that your colleague included a record, your independent judgement is no longer independent.

## Practical mechanics that actually save time

- **Deduplicate first.** Records identified in more than one database should be removed before screening. PRISMA 2020 accounts for these in a separate box precisely because they are not screened.
- **Use the keyboard.** Screening a few thousand abstracts is a rhythm task. Anything that requires the mouse breaks the rhythm.
- **Highlight your criteria terms in the abstract.** Visual anchoring reduces the time to a decision materially and reduces the chance of missing a disqualifying detail in a long structured abstract.
- **Keep a "Maybe" state.** Forcing a binary decision on an ambiguous abstract pushes reviewers into premature exclusion. A Maybe that resolves to a full-text read is the correct outcome.
- **Screen in blocks with breaks.** Screening accuracy degrades over a long session in a way that is obvious in retrospect and invisible at the time.
- **Log the reason at full text, not at abstract.** Recording a reason for each of thousands of abstract exclusions costs a great deal and PRISMA does not ask for it.

## Screening automation and machine learning

Tools that rank the screening queue by predicted relevance are now common, and used correctly they are genuinely useful: they front-load the includable records so that the team sees most of them early. Used carelessly, they introduce a bias that is invisible in the final report.

Three rules keep automation honest.

**The model ranks; the human decides.** A prioritisation tool that can record a decision is an automated exclusion tool, and must be reported as one under PRISMA item 8.

**Stopping early is a methodological decision, not a convenience.** If you stop screening at 80% of the queue because the model says the remainder is unlikely to be relevant, you have adopted a stopping rule, and it must be pre-specified where possible and reported always, along with the estimated recall it implies.

**Beware evaluations on your own labelled data.** A model's performance measured on the records it was trained on is not evidence. Held-out cross-validation, or better still an unbiased random validation sample, is what should be reported — and the confidence interval on a recall estimate from a small sample is wide.

Automation cannot fix a bad search. If a relevant study was never retrieved, no ranking algorithm will surface it.

## What to record

For PRISMA and for your own future sanity:

- The number of records identified per source and per date.
- Records removed before screening, split into duplicates, records removed by automation, and other reasons.
- Records screened and records excluded.
- Reports sought for retrieval and reports not retrieved.
- Reports assessed at full text, with an exclusion reason per rejected report.
- Whether screening was independent, by how many people, and with what tools.

If those numbers are produced from a decision ledger rather than typed into a diagram by hand, they will still be right in six months when a reviewer asks you to justify one of them.

## References

- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5, chapter 4 (Searching for and selecting studies). Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)
- Waffenschmidt S, Knelangen M, Sieben W, Buhn S, Pieper D. Single screening versus conventional double screening for study selection in systematic reviews: a methodological systematic review. *BMC Medical Research Methodology*. 2019;19:132. [doi:10.1186/s12874-019-0782-0](https://doi.org/10.1186/s12874-019-0782-0)
- Institute of Medicine. *Finding What Works in Health Care: Standards for Systematic Reviews*. Washington, DC: The National Academies Press; 2011. [doi:10.17226/13059](https://doi.org/10.17226/13059)
- O'Mara-Eves A, Thomas J, McNaught J, Miwa M, Ananiadou S. Using text mining for study identification in systematic reviews: a systematic review of current approaches. *Systematic Reviews*. 2015;4:5. [doi:10.1186/2046-4053-4-5](https://doi.org/10.1186/2046-4053-4-5)

## In PecanRev

PecanRev's [screening workspace](/features/screening) is keyboard-driven, highlights your criteria terms in the abstract, keeps a distinct Maybe state, supports blind review, and treats its relevance ranking as ranking only — there is no code path by which the model can record a decision. Records arrive from the [search engine](/features/search-engine) already deduplicated, with per-source provenance intact.
`;
