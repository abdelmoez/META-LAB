/**
 * Content source for /features/data-extraction.
 * 111.md §8 — sourced from docs/pecan-extraction-engine.md,
 * docs/data-extraction.md, docs/case-series-106.md, docs/extraction-provenance.md.
 */

export default `---
h1: Data extraction built for traceable evidence
title: Systematic Review Data Extraction Software | PecanRev
description: Extract study data beside the PDF, capture values by clicking them, convert medians and confidence intervals with cited formulas, and extract many patient cases from a single case series.
slug: features/data-extraction
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

Data extraction is where a review becomes a dataset. It is also where transcription errors, silent unit mismatches, and undocumented conversions enter the evidence base. PecanRev's extraction workspace is designed so that every number in your analysis can be traced back to the place on the page it came from, and every derived number can be traced back to the formula that produced it.

## The PDF and the form, side by side

The workspace is a resizable split: the paper on the left, the structured form on the right. You enter it from an article list that shows extraction status, progress, validation counts, whether a PDF is available, and whether the article's data is in sync with the analysis. The list is searchable, sortable and filterable, and it will drop you back where you stopped.

### Click to capture

Focus a field, then click the number in the PDF. The captured token is parsed intelligently — a ratio with a confidence interval, a range, an event-and-total pair, a mean with a standard deviation, or a plain value — and placed in the field. On an empty field, focus advances to the next one automatically. On a field that already has a value, the new capture replaces it immediately and the previous value is kept in the provenance history rather than discarded.

Manual entry is always available and always visible. Every identity and value field can be typed directly, and a free-text notes field is there for the assumptions and judgement calls that structured fields cannot hold.

## Structured extraction forms

Projects define their own data elements as a versioned extraction form. Element types cover dichotomous outcomes, continuous outcomes, categorical variables, baseline characteristics, study design, intervention and comparator detail, timepoints, adverse events, free text, numeric values and dates. Elements can be scoped to a specific arm.

Reusable templates ship for common designs: a generic form, RCT intervention, diagnostic accuracy, observational cohort, a dichotomous two-by-two table, a continuous outcome, and arm-level data for network meta-analysis.

### Dual independent extraction and adjudication

Two extractors can work on the same article without seeing each other's values. An adjudicator then gets a side-by-side comparison and resolves each disagreement by accepting one side, recording agreement, or entering a custom consensus value with a note. Consensus rows are written separately — **neither extractor's original data is ever overwritten**, so the disagreement rate itself remains measurable after the fact.

## Record what the paper reports, derive the rest

Reviewers are not asked to do arithmetic in their heads. You record the format the paper actually used, and the engine derives the analysis fields from it. Supported reported formats include mean and SD, median with interquartile range, median with range, mean with standard error, mean with 95% confidence interval, events and total per arm, and an effect estimate with its 95% confidence interval.

### Eleven named conversions, each with its source

The converter panel implements a fixed, documented set of transformations:

- Median and IQR to mean and SD (Wan et al. 2014, Box-Cox method)
- Median and range to mean and SD
- Standard error to standard deviation
- 95% confidence interval of a mean to SD
- 95% confidence interval to standard error
- Variance to standard deviation
- P-value plus effect estimate to standard error
- Percentage to event count
- Event count to percentage
- Odds ratio, risk ratio or hazard ratio to a log estimate with SE derived from its confidence interval
- Linear unit conversion by scale factor

Each conversion is labelled with its method, its formula, a literature reference — for example the relevant section of the Cochrane Handbook — a caution tier, and its explicit assumptions. The originally reported values are stored immutably in their own fields; derived values are flagged as converted and carry an audit entry naming the conversion that produced them. Nothing is silently rewritten.

## Case reports and case series: many cases, one publication

A large body of clinical evidence lives in case reports and case series, where one publication describes several patients. PecanRev models this directly: a case is a normal study row tagged with its publication, case identifier, case number and label.

The counting contract is the important part. **PRISMA and study counts continue to report publications, not cases.** Extracting eight patients from one case series does not inflate your flow diagram to eight records.

Article-level fields — authors, year, journal, DOI, PMID, country, design, funding, the population, intervention and comparator definitions, the screening link and the stored document — propagate automatically to every sibling case. Case-level values stay on the case.

Case variables are project-wide reusable definitions with a label, type, options, unit, group and required flag. Fourteen are seeded on first use, covering age, sex, presentation, symptoms, comorbidities, laboratory values, imaging, treatment, intervention, complications, follow-up, outcome, survival and time to event — all fully editable. Cases appear as chips with their own completion state, and switching between them does not reload the PDF. Turning case mode off is non-destructive.

Cases export as CSV with one row per patient, carrying the publication metadata, identifiers, case label, every case variable and the effect columns.

## Provenance for every value

A captured value can carry the field it filled, the method used, the page, a bounding box, the excerpt, when and by whom, the original and transformed values, the rule applied, a confidence, and whether text recognition was involved. Methods are recorded distinctly: table, figure, click, manual, automatic, AI, or OCR.

A source chip next to a value scrolls the PDF to the region and shows a persistent highlight until you dismiss it. When only a page number is known, PecanRev shows a labelled page-level indicator rather than drawing a bounding box it cannot justify.

An append-only audit log records completion, reopening, locking, unlocking and analysis inclusion with actor and timestamp, and is exposed read-only per article.

### Completion gates and analysis sync

Validation has three tiers: information, warning, and blocking. An article can be marked complete only when there are no blocking errors; warnings and information never block. Completion, reopening, locking and inclusion in the analysis are all permissioned across view, edit and adjudicate roles.

Each article carries an analysis sync state — not ready, ready, synced, updated since sync, or excluded — driven by a stable hash over the fields that feed the analysis. Editing an extracted value after pooling shows up as visible drift instead of silently changing a published estimate.

Even the save indicator is honest: the toolbar badge is threaded from the real save status and never shows "Saved" when a save is in flight or has failed.

## AI assistance, bounded

Suggestions never become values on their own. Human validation is a hard, non-configurable rule: a suggestion becomes data only when a person accepts or edits it, and the result is recorded as AI-accepted or AI-edited with a reference to the originating suggestion.

Two providers exist. The default is a **heuristic, self-hosted, deterministic extractor** that works from patterns in the title, abstract or pasted text and returns sentence-level provenance with conservative confidence — no data leaves the server. The optional external provider is an OpenAI-compatible endpoint proxied by the server, configured by environment variables; the browser only ever talks to its own origin and the API key never reaches the client.

An anti-hallucination grounding check runs before you ever see an external suggestion: if the provenance excerpt does not literally occur in the submitted text, the suggestion is dropped. Provider and model are persisted with every suggestion set.

Optical character recognition is explicitly **not** AI, and is labelled "text recognition" in the product. It runs on a pinned WebAssembly Tesseract build served from the same origin, loaded only when you invoke it. Nothing about the image leaves your browser.

## Handoff to analysis

Consensus values map to the study's raw fields and the canonical effect-size calculator produces the estimate and its interval. If a study already has an effect size, the handoff refuses to overwrite it without explicit confirmation, and when it does write it stamps the value as calculated and converted with the conversion recorded.

Continue to [meta-analysis](/features/meta-analysis), or see how extracted values reach the write-up in the [manuscript editor](/features/manuscript).
`;
