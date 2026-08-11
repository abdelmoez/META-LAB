/**
 * Content source for /systematic-review-software — 113 W1-A, the flagship
 * commercial page for the "systematic review software / tool / platform" intent.
 *
 * Every product claim here is a restatement of a claim already verified against
 * the codebase for the feature pages (src/frontend/website/content/features-*.js)
 * and the homepage FAQ in publicPages.js. Nothing new is asserted: this page
 * assembles the workflow, the detail pages prove each stage.
 *
 * The FAQ block is interpolated from the registry entry's `faq` array, which is
 * the same array the entry's jsonLd hands to faqJsonLd() — visible copy and
 * FAQPage schema cannot diverge.
 */

import { faqMarkdown } from './faqSection.js';

export default `---
h1: Systematic review software for the whole review, not one stage
title: Systematic Review Software for the Whole Workflow | PecanRev
description: Systematic review software that carries one project from search strategy through screening, extraction, risk of bias, meta-analysis, PRISMA and the manuscript.
slug: systematic-review-software
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

Systematic review software is the tooling a review team uses to run a protocol-driven evidence synthesis: building and recording the search, screening records against eligibility criteria, extracting data, assessing risk of bias, pooling results, and reporting all of it to a standard such as PRISMA 2020. PecanRev is a platform that does all of those stages inside one project, so a record found by a search, a screening decision, an extracted value and a pooled estimate stay connected to each other and to the manuscript that reports them.

## Why does the handoff between stages matter more than any single feature?

Most review teams already have a tool for each stage: a reference manager, a screening app, a spreadsheet, a statistics package, a word processor. Each of those can be good at its job and the review can still go wrong, because the review is not a set of stages. It is one chain of evidence, and every tool boundary is a place where the chain can break silently.

The breaks are familiar. A study is excluded at full text but the flow diagram still counts it. A median is converted to a mean in a spreadsheet cell and nobody can say which formula was used. A reviewer fixes an extracted value after the analysis was run, and the abstract keeps the old pooled estimate. None of these produce an error message. They produce a published number that no longer matches the data behind it.

PecanRev is built as one project rather than five tools, and the handoffs are the product. Screening decisions are what the PRISMA counts are derived from. Extracted values are what the effect sizes are computed from. Pooled estimates are what the manuscript's Results section resolves at render time. When something upstream changes, the change is visible downstream instead of quietly stale.

## How does a review move through PecanRev?

### 1. Question and protocol

A project starts from the research question, written in plain language, and carries the protocol, the eligibility criteria and the search strategy as project data rather than as attachments. That matters later in two concrete ways: the eligibility criteria you record are the criteria that highlight terms in abstracts during screening, and the search strategy is built by manipulating the question itself rather than by retyping it into a query box.

### 2. Search strategy

You build the search by grouping terms from the question into concepts. Terms within a concept are OR-ed, concepts are AND-ed, and the parentheses are generated for you. MeSH descriptors carry their scope notes and entry terms so you can check what you are actually searching for, and synonym expansion is opt-in one term at a time rather than a bulk button.

One strategy compiles to paste-ready queries for sixteen databases, including PubMed/MEDLINE, Embase, the Cochrane Library (CENTRAL), CINAHL, PsycINFO, Scopus, Web of Science, Europe PMC, ClinicalTrials.gov and the WHO ICTRP. Seven of those can be executed from inside PecanRev — PubMed, Europe PMC, ClinicalTrials.gov, Crossref, DOAJ, OpenAlex and Semantic Scholar — and each run stores the exact query that was executed against each database. Where no verified subject-heading crosswalk exists, the compiler produces a correctly formatted free-text phrase and says so instead of pretending a mapping exists.

Read the detail: [search engine](/features/search-engine).

### 3. Deduplication

Duplicate detection runs as a durable server-side job with real states rather than as a fragile in-page operation. Matched records are grouped for review and can be batch-deleted after a human looks at them. Nothing reruns automatically: if records have changed since the last pass, you get an explicit staleness notice and decide.

### 4. Title, abstract and full-text screening

Title and abstract screening uses a three-column workbench — record list, abstract, decision bar — with Include, Maybe and Exclude decisions and keyboard navigation through the queue. Structured abstract headings are detected and formatted, and your inclusion and exclusion terms are highlighted in the abstract as marked ranges, never as injected HTML.

Full-text screening is a separate stage with its own record set, so a decision made on an abstract is never confused with a decision made on the paper. Blind review mode suppresses peers' ratings, notes and decisions at read time, not merely in the interface.

Read the detail: [screening](/features/screening).

### 5. Data extraction

The PDF sits beside the form. Focus a field, click the number in the paper, and the value is captured with its page, its region and the excerpt it came from. Projects define their own data elements as a versioned extraction form, and reusable templates ship for common designs including RCT intervention, diagnostic accuracy, observational cohort, and arm-level data for network meta-analysis.

Two extractors can work on the same article without seeing each other's values, and an adjudicator resolves each disagreement into a consensus row that never overwrites either original — so the disagreement rate stays measurable after the fact. Reviewers record the format the paper actually used and the engine derives the analysis fields, using eleven named conversions that each carry their formula, a literature reference, a caution tier and their explicit assumptions.

Read the detail: [data extraction](/features/data-extraction).

### 6. Risk of bias

Risk-of-bias assessment is a real instrument rather than a blank grid. Four tools are implemented — RoB 2 for randomised trials, ROBINS-I for non-randomised studies of interventions, and both official Newcastle-Ottawa forms — and you answer each tool's own signalling questions while the engine applies the published decision table and shows its reasoning. You can override any judgement, and an override requires a written justification; both the proposed and the final judgement are stored.

The workspace is behind a flag that is off by default, and the dual-assessor and consensus model is implemented at the data layer without an interface yet. The feature page says so plainly, along with everything else it does not do.

Read the detail: [risk of bias](/features/risk-of-bias).

### 7. Meta-analysis

The analysis engine runs on the data you extracted, in the same project, with the same audit trail — there is no export to a statistics package and no re-keying. Fixed-effect and random-effects estimates are computed for every analysis and both are shown. Between-study variance can be estimated with eight estimators including DerSimonian-Laird, REML and Paule-Mandel; Hartung-Knapp-Sidik-Jonkman intervals are produced alongside every random-effects result from two studies upward.

Every result reports Cochran's Q, tau-squared, I-squared with a descriptive band, and a prediction interval from three studies upward. Forest and funnel plots are generated as SVG. Egger's test and trim-and-fill cover small-study effects; subgroup analysis with a Q-between test, meta-regression, leave-one-out and influence diagnostics cover the sensitivity work. Single-arm proportion pooling uses a logit transform, and [network meta-analysis](/features/network-meta-analysis) is available as a frequentist engine.

Read the detail: [meta-analysis](/features/meta-analysis).

### 8. PRISMA reporting

PRISMA 2020 counts are derived from the project's own import and screening ledger rather than typed into a diagram by hand, so the flow diagram reconciles with the decisions that were actually recorded. A database that returned zero results is reported as zero rather than dropped, and a case series is counted as one publication even when several patient cases were extracted from it.

Read the detail: [PRISMA flow diagram](/features/prisma-flow-diagram).

### 9. Manuscript

The draft stores references to project facts rather than transcribed numbers, so a change to the project appears in the manuscript immediately and the Abstract cannot disagree with the Results. Methods text is generated from execution records: only databases that were actually searched are named, and a claim about two independent reviewers appears only when a reviewer count is actually recorded. Change tracking groups a reconcile pass into one entry with provenance, and Word export resolves every fact against freshly fetched data at export time.

Read the detail: [manuscript editor](/features/manuscript).

## What holds the stages together?

Three mechanisms, and they are worth evaluating in any platform you consider.

**Provenance.** A captured value can carry the field it filled, the method used, the page, a bounding box, the excerpt, when and by whom, the original and transformed values, and the rule applied. A source chip next to a value scrolls the PDF back to the region it came from.

**Sync state.** Each article carries an analysis sync state — not ready, ready, synced, updated since sync, or excluded — driven by a stable hash over the fields that feed the analysis. Editing an extracted value after pooling shows up as visible drift instead of silently changing a published estimate.

**Refusal to over-claim.** The manuscript generator will not assert that records were screened by two independent reviewers unless a reviewer count is recorded, and a project with two reviewers but no recorded resolution process gets an explicit gap in the draft rather than a fabricated sentence. Reporting what happened is a feature; reporting what usually happens is a defect.

## Which review types is this built for?

PecanRev is built for intervention reviews with a quantitative synthesis, for prevalence and proportion reviews with single-arm pooling, and for reviews of case reports and case series, where [case series mode](/features/case-series) models several patients under one publication while the counting contract keeps reporting publications. Reviews that stop at narrative synthesis are supported too — the search, screening, extraction and PRISMA stages do not require you to pool anything.

## What does PecanRev not do?

Publishing the boundaries is deliberate; a review team should choose its tooling knowing them.

- **Begg's rank correlation test is not implemented.** Small-study effects are covered by Egger's test and trim-and-fill.
- **Bivariate and HSROC models for diagnostic test accuracy are not implemented.** If your primary question is diagnostic accuracy, use a package that fits the bivariate model.
- **Bayesian network meta-analysis is not available.** The network engine is frequentist only, and it reports P-scores rather than SUCRA because that is the statistic it computes.
- **Freeman-Tukey double-arcsine and GLMM pooling of proportions are not implemented.** Proportion pooling is logit-transform only.
- **Native Word track changes is not implemented**, and network and ranking plots are not included in the Word export.
- **PecanRev does not decide anything for you.** Screening ranking cannot record a decision, and an extraction suggestion becomes data only when a person accepts or edits it. See [AI in systematic reviews](/ai-systematic-review) for exactly which steps are model-assisted and which are not.

## How should you choose systematic review software?

A short, honest rubric, whichever platform you end up with:

1. **Ask where the PRISMA numbers come from.** If they are typed in, they will eventually disagree with your screening log.
2. **Ask what happens to a value after the analysis has been run.** Silent recomputation and silent staleness are both wrong; visible drift is right.
3. **Ask whether derived numbers name their formula.** A median-to-mean conversion without a citation is an untraceable number in your results.
4. **Ask what the tool refuses to claim.** A platform that will write "two independent reviewers" into your Methods without checking is writing your reporting for you.
5. **Ask which statistical methods are genuinely implemented**, by name, and which are not. Every platform has a boundary; only some publish it.
6. **Ask what any "AI" feature is actually allowed to do.** Ranking a queue and deciding an inclusion are very different powers.

## Frequently asked questions

${faqMarkdown('/systematic-review-software')}

## Where to start

If you are new to the method, start with [what is a systematic review?](/resources/what-is-a-systematic-review) and [PRISMA 2020 explained](/resources/prisma-2020-explained). If you are evaluating platforms, the [feature index](/features) walks the same workflow stage by stage, and the [comparisons](/compare) set PecanRev beside other tools researchers use.
`;
