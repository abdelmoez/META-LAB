/**
 * Content source for /about.
 * 111.md §11 + §36 — E-E-A-T page. HARD RULE: no fabricated team members,
 * credentials, customer counts, institutional relationships or awards. The
 * page establishes trust by being specific and honest about the product only.
 */

export default `---
h1: About PecanRev
title: About PecanRev — Who We Build For and How We Build
description: PecanRev is an end-to-end systematic review and meta-analysis platform. What it is, the principles behind how it handles evidence and AI, and where its limits are.
slug: about
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

PecanRev is a platform for conducting systematic reviews and meta-analyses, covering the full research cycle in one project: research question and protocol, search strategy, screening, data extraction, risk of bias, statistical synthesis, PRISMA reporting, and manuscript preparation.

It exists because the alternative — a reference manager, a spreadsheet, a screening tool, a statistics package, and a word processor, connected by copy and paste — loses the one thing a systematic review is supposed to have, which is a traceable line from a published number back to the page it came from.

## Who it is for

Academic research teams, clinical evidence synthesis groups, methodologists, and postgraduate students running a review as part of a thesis. It assumes you know what a systematic review is, or want to learn properly; it is not a summarisation tool and does not attempt to be one.

## The principles we build to

These are not aspirations. They are constraints that shape what the software is allowed to do.

### Software ranks, humans decide

No model in PecanRev records a screening decision or commits an extracted value. Relevance ranking reorders a queue; AI extraction produces suggestions that only become data when a person accepts or edits them, and the acceptance is recorded as such. This is enforced in code, not by policy, because a rule that can be configured off is not a safeguard.

### Report what happened, not what usually happens

Generated Methods text is derived from execution records. Databases named in the search paragraph are the ones that were provably searched; the search date is derived from the latest valid run; a claim about independent reviewers appears only if a reviewer count is recorded. Where the project cannot support a sentence, the draft shows an explicit gap rather than a plausible-sounding default.

### Absence is a value

A count the system does not know renders as a visible placeholder, never as zero. A risk-of-bias instrument ships without unofficial scoring bands attached to it. A "not classified" state stays distinct from a classification. Systems that fill blanks with reasonable guesses produce datasets whose errors are undetectable.

### Publish the limitations

Every feature page on this site includes what the feature does **not** do. The [meta-analysis page](/features/meta-analysis) lists the models we have not implemented — bivariate and HSROC diagnostic models, Bayesian network meta-analysis, Freeman-Tukey proportion pooling, Begg's test — by name. A review team choosing tooling needs that before they design the analysis, not after.

### Nothing is silently derived

Converting a median and interquartile range into a mean and standard deviation is a legitimate and well-described operation. Doing it invisibly is not. Original reported values are stored immutably, derived values are flagged as converted, and every conversion carries its method, formula, literature reference and assumptions.

## How PecanRev uses AI

Transparency about this matters more in research software than almost anywhere else, so here is the specific position:

- **The screening relevance model is not a large language model.** It is a deterministic lexical model — TF-IDF features feeding a class-weighted logistic regression, fused with a cold-start prior, a semantic similarity signal, a keyword signal and a citation-graph signal. It runs on your project's own labels. It is off by default and gated behind a project leader enabling it.
- **The default extraction assistant is heuristic and self-hosted.** It works from patterns in the text and returns sentence-level provenance. No data leaves the server.
- **An external LLM provider is optional and server-proxied.** When enabled by an administrator, requests are proxied by the server; the browser only ever talks to its own origin, and provider credentials never reach the client. Provider and model are recorded with every suggestion set.
- **External suggestions are grounded before you see them.** If the excerpt a suggestion cites does not literally appear in the submitted text, the suggestion is discarded.
- **Optical character recognition is not AI**, and we label it "text recognition" in the product. It runs in your browser on a self-hosted WebAssembly build; the image never leaves the machine.
- **Model performance is reported honestly.** In-sample figures are labelled optimistic; cross-validated figures are the headline; calibration is fitted out-of-fold, and below fifty samples no calibration is applied and the interface says so.

## Standards we build against

PRISMA 2020 and PRISMA-S for reporting; the Cochrane Handbook for methods; PROSPERO for protocol registration; RoB 2, ROBINS-I and the Newcastle-Ottawa Scale for risk of bias; GRADE for certainty of evidence. Where an instrument is implemented, it is encoded from the source document rather than from a secondary summary of it.

## What we do not claim

We do not publish user counts, institutional endorsements, accuracy percentages for AI assistance, or testimonials. When there is validation data worth reporting — for example, comparing AI extraction suggestions against human consensus within a project — the product computes it from your own data and shows it to you. A marketing number computed from someone else's corpus would not tell you anything about your review.

## Contact and legal

Questions about the platform, research collaborations or institutional access can be sent through the [contact form](/#contact). Terms of service and the privacy policy are at [/terms](/terms).

## Explore

- [All features](/features)
- [Search engine](/features/search-engine) · [Screening](/features/screening) · [Data extraction](/features/data-extraction) · [Meta-analysis](/features/meta-analysis) · [Manuscript editor](/features/manuscript)
- [Methodology guides](/resources)
`;
