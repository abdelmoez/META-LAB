/**
 * Content source for /features (hub).
 * 111.md §6 — a hub must be substantive in its own right, not a link farm.
 * This page explains the workflow as a whole and hands off to the detail pages.
 */

export default `---
h1: Everything PecanRev does, stage by stage
title: PecanRev Features — The Systematic Review Workflow End to End
description: How PecanRev connects search strategy, screening, extraction, meta-analysis and manuscript writing into one project where every number traces back to its source.
slug: features
published: 2026-08-09
updated: 2026-08-10
author: The PecanRev team
---

A systematic review is one continuous chain of evidence. A record found by a search becomes a screening decision, becomes an extracted value, becomes a row in a pooled estimate, becomes a number in an abstract. Every tool boundary in that chain is a place where the link can break silently.

PecanRev is built as one project rather than five tools. This page describes what each stage does and how the handoffs work; each stage has a detailed page of its own.

## Search strategy

You build a search from your research question by grouping terms from the question itself into concepts. Terms within a concept are OR-ed, concepts are AND-ed, and the parentheses are generated for you. MeSH descriptors carry their scope notes and entry terms so you can check what you are actually searching for, and synonym expansion is opt-in one term at a time rather than a bulk button.

That single strategy compiles to paste-ready queries for sixteen databases. Separately, seven sources can be run automatically from inside the product — the two lists overlap but neither contains the other, and the interface says which is which. Where no verified subject-heading crosswalk exists — MeSH to Emtree, for example — the compiler produces a correctly formatted free-text phrase and tells you it did, instead of pretending a mapping exists.

Read more: [search engine](/features/search-engine).

**Hands off:** deduplicated records with per-source provenance, plus a durable run record carrying the exact executed query per database.

## Screening

Title and abstract screening runs in a keyboard-driven three-column workbench with Include, Maybe and Exclude decisions, your criteria terms highlighted in the abstract, and structured abstract headings detected and formatted. Full-text screening is a separate stage.

Duplicate detection runs as a durable server-side job with reviewable groups. Blind review mode hides peers' decisions from a reviewer at read time. Optional relevance ranking reorders the queue and cannot record a decision.

Read more: [screening](/features/screening).

**Hands off:** a decision ledger that PRISMA counts are derived from, and the included set.

## PRISMA flow diagram

Every record carries where it was identified and what happened to it, and the PRISMA 2020 flow diagram is derived from those two facts in one pass rather than typed into boxes at write-up time. Each record resolves to exactly one of nine dispositions, so the arithmetic reconciles by construction, and the identities are checked before you are shown anything. The diagram exports as SVG and PNG and embeds in the Word manuscript.

Read more: [PRISMA flow diagram](/features/prisma-flow-diagram).

**Hands off:** a figure that cannot silently disagree with the screening ledger it came from.

## Data extraction

The PDF sits beside the form. Focus a field, click a number in the paper, and the value is captured with its page, region and excerpt — so every value can be traced back to where it came from. Two extractors can work independently and an adjudicator resolves the differences without overwriting either original.

You record what the paper reports; the engine derives the analysis fields, with eleven named conversions each carrying its formula, literature reference and assumptions. Case series are modelled as many patient cases under one publication, and the PRISMA counts still report publications.

Read more: [data extraction](/features/data-extraction), and [case series mode](/features/case-series) for reviews where one paper describes several patients.

**Hands off:** consensus values mapped to effect-size inputs, with an analysis sync state per article so a later edit shows as drift rather than silently changing a pooled result.

## Risk of bias

Four instruments are encoded as real tools rather than blank grids: RoB 2, ROBINS-I, and both official Newcastle-Ottawa forms. You answer the instrument's own signalling questions, the published decision table computes the domain and overall judgements, and the trace of the rule that produced each one is shown to you. Overriding a computed judgement is allowed and requires a written reason, and both the proposed and final judgements are kept.

Read more: [risk of bias](/features/risk-of-bias).

**Hands off:** per-result judgements, a traffic-light figure, and a Methods sentence naming only the instruments that actually have completed assessments.

## Meta-analysis

Fixed-effect and random-effects estimates for every analysis, eight tau-squared estimators, HKSJ intervals, Q, tau-squared, I-squared and prediction intervals, forest and funnel plots, Egger's test, trim-and-fill, subgroup analysis with a Q-between test, meta-regression, leave-one-out and influence diagnostics, and frequentist network meta-analysis with geometry, inconsistency and contribution matrices.

The page also lists, by name, the methods PecanRev does not implement.

Read more: [meta-analysis](/features/meta-analysis), and [network meta-analysis](/features/network-meta-analysis) when the question is which of several treatments rather than whether one works.

**Hands off:** pooled estimates and heterogeneity statistics as live facts.

## Manuscript

The draft stores references to project facts rather than transcribed numbers, so a change to the project appears in the manuscript immediately and the Abstract cannot disagree with the Results. Methods text is generated from execution records — only databases that were actually searched are named, and a claim about independent reviewers appears only if the reviewer count is recorded.

Change tracking groups a reconcile pass into one entry with provenance, and Word export resolves every fact against freshly fetched sources.

Read more: [manuscript editor](/features/manuscript).

## Collaboration and audit

Projects are multi-user with role-based permissions. Concurrent edits to shared state use compare-and-set with a clean conflict and reconcile rather than last-write-wins. Extraction has an append-only audit log; screening keyword changes are atomic server-side operations; risk-of-bias assessment supports two independent assessors plus a consensus row where neither original is overwritten.

## Learn the method

The tooling is one half; the method is the other. Every stage above has a guide that explains it independently of any software, and the full set lives in [resources](/resources).

- [What is a systematic review?](/resources/what-is-a-systematic-review)
- [How to conduct a systematic review](/resources/how-to-conduct-a-systematic-review)
- [PRISMA 2020 explained](/resources/prisma-2020-explained)
- [Building a search strategy](/resources/systematic-review-search-strategy)
- [Title and abstract screening](/resources/title-and-abstract-screening)
- [Data extraction for systematic reviews](/resources/data-extraction-for-systematic-reviews)
- [Risk of bias assessment](/resources/risk-of-bias-assessment)
- [The PRISMA flow diagram](/resources/prisma-flow-diagram-guide)
- [How to run a meta-analysis](/resources/how-to-run-a-meta-analysis)
- [Forest plots and heterogeneity](/resources/forest-plots-and-heterogeneity)
- [Publication bias](/resources/publication-bias)
- [Network meta-analysis explained](/resources/network-meta-analysis-explained)
`;
