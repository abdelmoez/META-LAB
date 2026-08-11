/**
 * Content source for /resources (hub).
 * 111.md §35 — the article index. Kept short and honest; the value is in the
 * articles, and a hub that pretends to be an article is a doorway page.
 *
 * 113.md W1-B — grouped into Start here / By stage / Reading the results, so the
 * hub is a map of the workflow rather than a flat list. Every guide in
 * content/index.js with a resources/ slug must appear exactly once below; the
 * frontmatter title and description are byte-pinned to the registry entry, so
 * they are NOT edited here without the matching registry change.
 */

export default `---
h1: Systematic review methodology guides
title: Systematic Review Methodology Guides | PecanRev Resources
description: Cited, practical guides to every stage of a systematic review: protocol and search, screening, data extraction, risk of bias, meta-analysis and PRISMA reporting.
slug: resources
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

Guides to systematic review and meta-analysis methodology, written to be useful whether or not you use PecanRev. Each one cites its sources, states where the evidence is genuinely mixed, and says what it does not cover.

We publish a small number of thorough guides rather than a large number of thin ones. Where a guide makes a product-specific claim, it links to the relevant feature page and is clearly marked as such.

## Start here

### [What is a systematic review?](/resources/what-is-a-systematic-review)

The definition, what separates a systematic review from a narrative literature review and from a meta-analysis, the eight standard steps from question to report, how long each realistically takes, and the failure modes that recur most often.

### [How to conduct a systematic review](/resources/how-to-conduct-a-systematic-review)

The operational walkthrough: what each of the eight steps produces, the decision you have to make before moving on, which steps consume the time, and the errors that are cheap to fix early and expensive to fix late.

## One guide per stage

### [Systematic review search strategy](/resources/systematic-review-search-strategy)

Turning a question into concept blocks, why the comparator and outcome are usually not searched, MeSH versus free text and when to explode a descriptor, the Boolean rules that matter, why syntax does not port between databases, and what PRISMA-S requires you to report.

### [Title and abstract screening](/resources/title-and-abstract-screening)

Piloting eligibility criteria before you start, the real state of the evidence on single versus dual screening, how to resolve conflicts in batches, practical mechanics that save hours, and three rules for using screening automation without introducing invisible bias.

### [Data extraction for systematic reviews](/resources/data-extraction-for-systematic-reviews)

What belongs on the form and how to pilot it, which numbers to extract for dichotomous, continuous and time-to-event outcomes, named conversions and their sources, handling multi-arm trials without double counting a shared control, and extracting case series at two levels.

### [Risk of bias assessment](/resources/risk-of-bias-assessment)

The five RoB 2 domains and the effect-of-interest choice you must make first, when ROBINS-I applies instead, Newcastle-Ottawa and why its familiar scoring bands are not part of the instrument, how risk of bias differs from GRADE, and how to use it in the synthesis.

## Reading and reporting the results

### [How to run a meta-analysis](/resources/how-to-run-a-meta-analysis)

Deciding whether to pool at all, choosing an effect measure, the difference between fixed-effect and random-effects models as a question about what you are estimating, why I-squared is a proportion and not an amount, prediction intervals, and the limits of funnel plots and trim-and-fill.

### [Forest plots and heterogeneity](/resources/forest-plots-and-heterogeneity)

Every element of a forest plot and the order to read them in, what Q, I-squared and tau-squared each measure, why the fixed-effect and random-effects diamonds differ, what a prediction interval adds, and how to investigate heterogeneity rather than minimise it.

### [Publication bias](/resources/publication-bias)

Why funnel asymmetry is not the same thing as publication bias, how to read a contour-enhanced funnel plot, the conditions under which Egger's and Begg's tests carry information, what trim-and-fill can and cannot correct, and what actually reduces reporting bias.

### [Network meta-analysis explained](/resources/network-meta-analysis-explained)

How indirect evidence is formed through a common comparator, what network geometry tells you before any estimate, why transitivity cannot be tested statistically, how consistency is assessed, and how to read a ranking without over-reading it.

### [PRISMA 2020 explained](/resources/prisma-2020-explained)

What changed from the 2009 statement, what the 27-item checklist asks for section by section, how to build the flow diagram so the numbers reconcile, the reports-versus-studies distinction that breaks most diagrams, and why PRISMA compliance is not a quality score.

### [PRISMA flow diagram guide](/resources/prisma-flow-diagram-guide)

Which flow template to use, what each box counts, the record-report-study distinction that makes the arithmetic work, where every number should come from, a worked example that balances, and the mistakes peer reviewers catch most reliably.

## Product documentation

For what the platform itself does, see the [feature pages](/features) — each includes an explicit list of what that part of the product does not do.
`;
