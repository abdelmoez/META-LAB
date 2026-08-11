/**
 * Content source for /compare/pecanrev-vs-rayyan — 113 W1-A.
 *
 * Policy (see compare-index.js): only publicly documented competitor
 * capabilities, neutral phrasing, no pricing, no ratings, no invented feature
 * matrix, dated verification line, link to the vendor's own site and to the
 * peer-reviewed paper describing the tool. PecanRev claims restate the verified
 * feature-page claims only.
 */

export default `---
h1: PecanRev vs Rayyan
title: PecanRev vs Rayyan: Screening Tool or Review Platform?
description: Rayyan is a fast collaborative screening app; PecanRev is an end-to-end review platform. What each does well and how to choose between them.
slug: compare/pecanrev-vs-rayyan
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

Rayyan is a widely used web and mobile application for collaborative citation screening, described in a peer-reviewed paper in Systematic Reviews in 2016 and known for blind screening, inclusion and exclusion labels, keyword highlighting and a relevance rating that reorders the screening queue. PecanRev is an end-to-end review platform: the same screening decisions continue into extraction, risk of bias, meta-analysis, PRISMA reporting and the manuscript. The comparison is really between a very good tool for one stage and a project that carries every stage.

## What is Rayyan known for?

Rayyan was published as a tool for speeding up the screening phase of systematic reviews and its documented strengths sit squarely there: importing citations from reference managers and databases, duplicate detection, collaborative screening with several reviewers, a blind mode so reviewers cannot see each other's decisions, include/maybe/exclude labelling with reasons, keyword and term highlighting, faceted filters over the record set, and a relevance rating that reorders records so likely-relevant ones surface earlier. It is available on the web and as mobile apps, which is genuinely useful — screening is one of the few review tasks that works on a phone.

Two strengths worth naming:

- **It is fast to start.** A team can import records and be screening within minutes, with very little setup.
- **It is well cited and widely taught**, so collaborators frequently already know it.

## Where does PecanRev differ?

**Screening is one stage of a project, not the product.** In PecanRev the same records continue through [data extraction](/features/data-extraction) beside the PDF, [risk of bias](/features/risk-of-bias), [meta-analysis](/features/meta-analysis) and the [manuscript](/features/manuscript), with one audit trail across all of them.

**PRISMA numbers come from the ledger.** Every record carries its source and its disposition, and the [flow diagram](/features/prisma-flow-diagram) is derived from that rather than typed in. Databases that returned zero results are reported as zero.

**The relevance model is documented in full, and it cannot decide.** PecanRev's optional screening prioritisation is a deterministic lexical model — TF-IDF features feeding a class-weighted logistic regression, fused with a cold-start prior, a semantic centroid, a keyword signal and a citation-graph signal — not a large language model, and there is no code path by which it can record a decision. It reports held-out cross-validated performance with confidence intervals rather than a single flattering number, it withholds scores until enough decisions exist, and it is off by default. The complete scoping is on [AI in systematic reviews](/ai-systematic-review).

**Full text is a separate stage with its own record set**, so a decision made on an abstract is never confused with a decision made on the paper, and exclusion reasons recorded at full text are the ones the flow diagram reports.

**Deduplication is a durable job, not an in-page action.** It has real states, groups matches for human review, and refuses to silently rerun on changed data — it raises a staleness notice instead.

## When is Rayyan the better fit?

- Screening is the only stage you need help with, and the rest of your pipeline is settled.
- You want to start in minutes with minimal project setup.
- You want to screen on a phone or tablet between other work.
- Your collaborators already use it and switching cost matters more than integration.

## When is PecanRev the better fit?

- You want the screening decisions to feed the PRISMA diagram, the analysis and the manuscript without re-entering anything.
- You are extracting data as well as screening, and you want every value traceable to a page and a region of the PDF.
- You are pooling results and would rather not move the dataset into another package.
- You need [case series mode](/features/case-series), where several patients come from one publication and the counts still report publications.

## What both take seriously

Both support several reviewers working independently, both support blind screening so a reviewer cannot see peers' decisions, and in both the human makes every inclusion decision. Any relevance ranking in either tool changes the order records are read in, not their fate.

## How this comparison was written

We describe only capabilities that Rayyan documents publicly or that are described in the peer-reviewed paper about it, we publish no pricing or ratings for a product we do not build, and we do not speculate about features we cannot verify. Rayyan has continued to develop since its original publication; check the current feature set on its own site.

Information verified as of August 2026. Products change; confirm anything decision-critical against [rayyan.ai](https://www.rayyan.ai) before you choose.

## References

- Ouzzani M, Hammady H, Fedorowicz Z, Elmagarmid A. Rayyan — a web and mobile app for systematic reviews. Systematic Reviews. 2016;5:210. [doi:10.1186/s13643-016-0384-5](https://doi.org/10.1186/s13643-016-0384-5)
- Rayyan, available at [rayyan.ai](https://www.rayyan.ai).
- [PecanRev feature documentation](/features) — every PecanRev claim on this page is described in more detail on the relevant feature page.
`;
