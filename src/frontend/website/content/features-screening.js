/**
 * Content source for /features/screening.
 * 111.md §8 — claims sourced from docs/screening-extraction-107.md and
 * docs/ai-screening.md. The AI section is deliberately explicit that the
 * model ranks and never decides.
 */

export default `---
h1: Screening software for systematic reviews
title: Title, Abstract & Full-Text Screening Software | PecanRev
description: Screen citations in a keyboard-first workbench with criteria-driven highlighting, server-side duplicate detection, and optional relevance ranking.
slug: features/screening
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

Screening is where a systematic review spends most of its human hours, and where most of its avoidable errors are made. PecanRev's screening workspace is built to make the boring part fast and the judgement part deliberate: everything a reviewer needs is on one screen, the keyboard does the navigation, and nothing about a record's fate is ever decided by software.

## The screening workbench

Title and abstract screening uses a three-column layout: the record list on the left, the abstract in the middle, and a decision bar pinned at the bottom. Decisions are **Include**, **Maybe** and **Exclude**, saved per record as you go, with an optimistic glyph on the list so you always know where you have been. A record you have not judged yet shows no active state — "undecided" is a real state, not a default of "exclude".

Full-text screening is a separate stage with its own record set and its own scoring context, so a decision made on an abstract is never confused with a decision made on the full paper.

### Keyboard-first, with pagination that keeps up

Arrow keys move through the queue. When you arrow past the last loaded record the next page loads automatically, the first genuinely new record is selected by identity rather than by index, and the list scrolls the minimum distance needed to show it. If you leave and come back, a one-shot Resume pass restores and centres your last position.

Text-selection shortcuts turn reading into criteria refinement: select a phrase in an abstract and press Cmd/Ctrl+I to add it to the inclusion keyword list, or Cmd/Ctrl+E for exclusion. A snackbar offers Undo, and Undo issues the true inverse operation on the server rather than a best-effort guess.

### Abstracts you can actually read

Structured abstracts are detected and formatted. The parser recognises around sixty heading forms — Background, Objective, Objectives, Methods, Materials and Methods, Results, Findings, Conclusion, Conclusions and many variants — and bolds them while preserving the original casing exactly as published.

Active inclusion and exclusion keywords are highlighted in the abstract as marked ranges. The highlighting is rendered as React elements, never as injected HTML, so a hostile string in an imported abstract cannot become markup.

## Keyword suggestions that wait for a human

PecanRev can suggest screening keywords from your eligibility criteria. The suggester is negation-aware, blocks generic nouns, prefers qualified phrases over bare words, caps itself at twelve suggestions per side, and flags concepts whose polarity is ambiguous as conflicts rather than guessing which list they belong in.

Crucially, **suggestions do nothing until a leader accepts them**. They do not highlight, they do not filter, and they do not count towards anything. Keyword changes themselves are atomic per-term operations executed inside a server transaction with optimistic-concurrency retry, so two reviewers editing the keyword lists at the same time cannot corrupt them.

## Duplicate detection as a durable job

Deduplication runs as a server-side job with real states — queued, processing, completed, failed, cancelled — rather than as a fragile in-page operation. Matched records are grouped for review and can be batch-deleted after you look at them.

Two details matter in practice. First, nothing reruns automatically: if records have changed since the last detection pass, you get an explicit staleness notice and decide whether to run again. Second, job state is server-authoritative with a monotonic client guard, so a slow poll arriving out of order can never drag a finished job backwards into "processing".

## Working as a team

Projects support multiple reviewers with role-based permissions, separating what a project leader can configure from what a reviewer can do.

**Blind review mode** suppresses reviewer-derived signals both when scores are computed and when data is read, so a reviewer cannot see peers' ratings, notes or decisions. That protection is applied on read, not merely hidden in the interface.

PecanRev is also careful about what it will later *claim* about your process. The manuscript generator refuses to assert that records were screened "by two independent reviewers" unless a reviewer count is actually recorded, and a project with two reviewers but no recorded resolution process gets an explicit gap in the draft rather than a fabricated sentence about disagreements being resolved by discussion. Reporting what happened is a feature; reporting what usually happens is a defect.

## Optional relevance ranking — what it does and what it refuses to do

PecanRev includes an optional AI-assisted prioritisation engine. It **reorders the screening queue by estimated relevance so that likely-includable records surface earlier**. It does not, and cannot, record a decision: there is no decision-write code path from the model, and human final decision is enforced as a hard rule rather than a setting.

The model is deterministic and lexical, not a large language model. A TF-IDF representation — title weighted, abstract, keywords and MeSH weighted, journal, unigrams and bigrams, sublinear term frequency — feeds a class-weighted logistic regression. Four further signals are fused with renormalising weights, so a signal that is unavailable is dropped rather than zero-filled: a cold-start prior scored against your PICO snapshot and eligibility criteria, a semantic centroid similarity, a keyword signal, and a citation-graph signal built from direct citation and bibliographic coupling. For the citation signal, only DOIs and PMIDs leave the server — never titles or abstracts.

Supervised training begins only once there are at least ten labels including at least three positives and three negatives; before that, the cold-start prior does the work so the queue is useful from the first record.

### Honest validation, by default

Performance is reported at three levels of honesty rather than one flattering number: an in-sample figure explicitly labelled optimistic, a held-out stratified k-fold cross-validation as the headline, and an unbiased seeded random validation sample. Metrics include ROC AUC, work saved over sampling at 95% and 100% recall, and recall at k, each with seeded bootstrap confidence intervals.

Probability calibration is fitted from out-of-fold predictions only, and below fifty samples no calibration is applied at all — the interface shows the raw score and says that it is uncalibrated. A recall-targeted operating point (0.95 by default) and a stopping-rule estimate are offered as decision support and are flagged preliminary below thirty labels or ten positives.

### Governance

The feature flag defaults to **off**, with the routes hidden entirely when it is. When enabled it is leader-gated by default, scores are withheld until at least fifty screening decisions exist, and there is a global kill switch. A tool that changes the order in which humans read evidence should be opt-in, and this one is.

## Where screening sits in the workflow

Records arrive from the [search engine](/features/search-engine) with full source provenance, and every screening decision feeds the PRISMA record accounting that appears in the [manuscript editor](/features/manuscript). Included studies move on to [data extraction](/features/data-extraction).

If you are deciding how to run screening on your own review, read our guide to [title and abstract screening](/resources/title-and-abstract-screening).
`;
