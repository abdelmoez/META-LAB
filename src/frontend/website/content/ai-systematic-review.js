/**
 * Content source for /ai-systematic-review — 113 W1-A.
 *
 * THIS PAGE IS A SCOPING DOCUMENT, NOT A PITCH. Every sentence was checked
 * against: src/research-engine/screening/ai/*, docs/ai-screening.md,
 * docs/validation/MODEL_CARD.md, server/services/{aiExtractClient,
 * extractionLlmClient,aiEmbeddingClient,screeningAiService}.js,
 * server/controllers/{aiExtractController,extractionController,
 * settingsController}.js, server/routes/screening.js,
 * src/research-engine/extraction/heuristicExtract.js,
 * src/research-engine/screening/suggestKeywords.js, src/frontend/services/ocr.js,
 * src/shared/opsSettingsCatalog.js and server/security/csp.js.
 *
 * Two corrections to the loose internal shorthand, both reflected below:
 *  1. There are TWO external-model paths in extraction (the Anthropic-proxied
 *     endpoint behind `aiExtraction`, and the OpenAI-compatible endpoint behind
 *     `extractionAssist` when an admin selects provider 'external'), plus an
 *     OPTIONAL hosted-embedding sub-signal in screening. Not one call.
 *  2. docs/privacy-ai-providers.md section 2.3 is stale on this point; it is NOT
 *     a source for this page.
 *
 * The FAQ block is interpolated from the registry entry's `faq` array — the same
 * array the entry's jsonLd hands to faqJsonLd().
 */

import { faqMarkdown } from './faqSection.js';

export default `---
h1: AI in systematic reviews: exactly what PecanRev automates
title: AI for Systematic Reviews: Exactly What Is Automated | PecanRev
description: Which parts of PecanRev involve a model and which are deterministic: relevance ranking that cannot decide, optional extraction suggestions, and nothing else.
slug: ai-systematic-review
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

Two things in PecanRev are model-assisted, and both are optional and off by default: an optional screening relevance ranking, which is a deterministic lexical model rather than a large language model and has no way to record a decision, and an optional extraction assistant, whose default provider is a deterministic server-side heuristic and whose external providers are language models an administrator must configure. Everything else in the platform — the search compiler, deduplication, the PRISMA derivation, the statistics, the risk-of-bias algorithms, the manuscript generator — is deterministic code, and we never call it AI.

## Why publish this at all?

Because "AI-powered systematic review" is now a claim that means nothing, and researchers evaluating tools have no way to tell a ranking model from a decision engine, or a rule table from a language model, without asking. A review is a method whose credibility rests on being able to say exactly how each decision was made. If a vendor cannot tell you what the model was allowed to do, you cannot report your methods honestly.

So this page is a scope statement. It names each model-assisted step, what it may and may not do, and where your text goes.

## Screening relevance ranking

### What it is

An optional prioritisation engine that reorders the screening queue so likely-includable records surface earlier. It is deterministic and lexical, not a language model. A TF-IDF representation — title weighted, abstract, keywords and MeSH weighted, journal, unigrams and bigrams, sublinear term frequency — feeds a class-weighted logistic regression trained on your own project's labels.

Four further signals are fused with renormalising weights, so a signal that is unavailable is dropped rather than zero-filled: a cold-start prior scored against your PICO snapshot and eligibility criteria, a semantic centroid similarity, a keyword signal, and a citation-graph signal built from direct citation and bibliographic coupling.

Supervised training begins only once at least ten labels exist including at least three includes and three excludes. Before that the cold-start prior does the work, so the queue is useful from the first record.

### What it is not allowed to do

It cannot record a screening decision. This is structural rather than a setting: there is no route in the API that writes a decision from the model, human final decision is a hard-coded rule rather than a configurable one, and the product's own model card describes the property as a structural invariant. The model changes the order in which a human reads records. It never changes what happens to them.

### Honest validation, by default

Performance is reported at three levels of honesty rather than one flattering number: an in-sample figure explicitly labelled optimistic, a held-out stratified k-fold cross-validation as the headline, and an unbiased seeded random validation sample. Metrics include ROC AUC, work saved over sampling at 95% and 100% recall, and recall at k, each with seeded bootstrap confidence intervals.

Probability calibration is fitted from out-of-fold predictions only, and below fifty samples no calibration is applied at all — the interface shows the raw score and says it is uncalibrated. A recall-targeted operating point and a stopping-rule estimate are offered as decision support and flagged preliminary when the label set is small.

### Governance

The feature is off by default and the routes are hidden when it is. When enabled it is leader-gated by default, scores are withheld until at least fifty screening decisions exist, blind review suppresses reviewer-derived signals both when scores are computed and when data is read, and there is a global kill switch that overrides every other toggle. A tool that changes the order in which humans read evidence should be opt-in, and this one is.

## Extraction assistance

This is where a language model can genuinely be involved, so the detail matters.

### The default provider is deterministic

The default extraction assistant is a heuristic, self-hosted extractor that works from patterns in the title, abstract or pasted text and returns sentence-level provenance with conservative confidence. It is not a language model and nothing leaves the server.

### The external providers

Two distinct external paths exist. Both are off by default, both require a site administrator to enable the feature **and** server-side credentials to be configured, and neither is reachable unless both are true.

- **A server-proxied endpoint** that submits document text to an Anthropic model, with the model chosen by server configuration. When the feature is off the endpoint does not exist; when it is on but unconfigured the server says so rather than failing quietly.
- **An OpenAI-compatible endpoint** used by the extraction suggestion service when an administrator switches the provider from heuristic to external. The endpoint, key and model come from server environment configuration.

In both cases the request is made by the server. The browser only ever talks to its own origin, provider credentials never reach the client, and the production content security policy restricts the browser to same-origin connections, so a cross-origin model call from the page would be blocked even if one were attempted. No model call is reachable from the browser: every one of them is server-proxied.

### What a suggestion is allowed to become

Nothing, on its own. Human validation is a hard, non-configurable rule: a suggestion becomes data only when a person accepts or edits it, and the result is recorded as accepted or edited with a reference to the originating suggestion.

Several further guards sit between a model's output and your dataset:

- **A whitelist.** Only fields that genuinely exist on a study can enter the patch. Enumerated fields are validated against their allowed values, and anything unrecognised is dropped into a note with a warning rather than coerced.
- **Canonical conversions.** A ratio measure is returned raw and then log-transformed through the same documented conversion recipe the rest of the product uses, with an audit record. A raw ratio never lands in an effect-size field.
- **A review flag on everything.** Any patch derived from a model marks the study as needing review.
- **A grounding check.** For the suggestion service, a suggestion whose provenance excerpt does not literally occur in the submitted text is dropped before you ever see it, and elements the model skipped are returned honestly as not found.
- **Scientific judgements are deliberately excluded.** The denominator population, its description and the action status of an estimate cannot be set by a model at all. They stay unclassified until a person resolves them, because pooling depends on them and they are judgements, not extractions.
- **It arrives as a draft.** In the workspace the result is added as a draft record labelled as model-derived, at low confidence, carrying the instruction to verify every value against the source.

## Keyword suggestions are deterministic

PecanRev can suggest screening keywords from your eligibility criteria. The suggester is a pure function with no model and no network: it is negation-aware, blocks generic nouns, prefers qualified phrases over bare words, caps itself at twelve suggestions per side, and emits concepts whose polarity is ambiguous as flagged conflicts rather than guessing which list they belong in.

Suggestions do nothing until a leader accepts one. They are derived live and never persisted, they do not highlight, they do not filter, and they do not count towards anything — which also means a pending suggestion has no effect on any relevance score.

## Text recognition is not AI

Optical character recognition for scanned PDFs runs on a pinned WebAssembly Tesseract build served from PecanRev's own origin, loaded only when you invoke it. Nothing about the image leaves your browser. It is labelled "text recognition" throughout the product and never as AI, because calling deterministic character recognition AI is exactly the kind of inflation this page exists to avoid.

## What PecanRev does not automate

- **Inclusion and exclusion decisions.** Every one is made and recorded by a person.
- **Risk-of-bias judgements.** The guided appraisal that pre-fills signalling answers is a deterministic cue-phrase matcher, not a model, it covers only part of each instrument, and it writes only to suggestion rows.
- **Data values.** A suggestion is a suggestion until a person accepts it.
- **The search strategy.** The strategy builder and its critic loop are deterministic code working against real per-database hit counts.
- **The manuscript.** The draft is generated from your project's own data by deterministic templates — no model writes a sentence of your paper.
- **Statistical choices.** No model picks your effect measure, your pooling model or your heterogeneity estimator.
- **Protocol text, PRISMA counts, GRADE ratings, provenance classification and the first-pass auto-extract** are all deterministic engines. Several are labelled in the code itself as explicitly not models, and none of them is presented as AI in the interface.

## What leaves your server, and when

- **By default, nothing goes to a model provider.** Both extraction language-model paths are off, and the screening model's semantic signal runs in-process.
- **If an administrator enables an external extraction provider**, the document text you submit for that extraction is sent by the server to the configured endpoint.
- **If an administrator selects hosted embeddings** for the screening model's semantic sub-signal, record text is sent to the configured embedding endpoint. The default is a local, in-process representation.
- **The citation-graph signal sends identifiers only** — DOIs and PMIDs — never titles or abstracts.
- **Bibliographic lookups** to PubMed, Crossref, OpenAlex, Europe PMC and similar services are not AI, and are how a reference manager works.

## Frequently asked questions

${faqMarkdown('/ai-systematic-review')}

## Why we scope it this way

Because the alternative is a review whose methods section cannot be written truthfully. PRISMA 2020 asks you to report the automation tools used in your process; you can only do that if the vendor has told you what they were. A tool that says "AI-assisted screening" without saying which model, trained on what, allowed to do what, has handed you a reporting problem rather than a feature.

See the ranking model in context on [screening](/features/screening), the assistant in context on [data extraction](/features/data-extraction), or the whole deterministic workflow around them on [systematic review software](/systematic-review-software).
`;
