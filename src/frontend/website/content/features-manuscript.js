/**
 * Content source for /features/manuscript.
 * 111.md §8 — sourced from docs/manuscript-sync-101.md and
 * src/research-engine/manuscript/*.
 */

export default `---
h1: A manuscript editor that keeps its numbers honest
title: Systematic Review Manuscript Editor with Live PRISMA Facts | PecanRev
description: Write your review in an editor where study counts, PRISMA numbers and pooled estimates are live tokens from project data, with change tracking and Word export.
slug: features/manuscript
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

The last mile of a systematic review is a document full of numbers that have to agree with each other and with the underlying data. Screening finished a week ago, one more study was added, and now the Abstract says 41 studies, the Results say 42, and the PRISMA diagram says something else again. The PecanRev manuscript editor exists to make that class of error structurally impossible.

## Fact tokens: the number is a reference, not a transcription

When the draft needs a value from the project, it stores a **fact token** rather than a number. The token persists in the document as an atomic chip, and the value is resolved at render time from a registry of project facts.

The consequence is that there is no Refresh button and no regeneration step. A change to the project appears in the manuscript the moment the data arrives, because nothing needs regenerating. Equally important, **your prose is safe by construction**: no code path rewrites section text. The only thing that can change is the inside of a token.

Every token in a single render resolves from one project snapshot, so the Results, the PRISMA section and the Abstract cannot disagree about the study count. They are literally reading the same number.

### Missing facts stay visibly missing

A fact the project cannot answer resolves as missing and renders as a visible bracketed placeholder. Numeric coercion explicitly rejects null, undefined and empty values, so an unknown PRISMA count can never render as "0 records identified". A blank that looks blank is recoverable; a zero that looks like data is not.

## Change tracking with provenance

When facts change, PecanRev reconciles the freshly resolved values against what the draft last saw and lists the differences newest-first. Clicking an entry navigates to the first section that states the fact. One reconcile pass shares one group identifier, so re-running a search that changes four facts appears as one entry in the panel, not four.

A provenance card for each fact shows who updated it, what changed, the reason, the previous value, the current value, and which manuscript field is affected, with accept and revert actions.

Show Changes is purely a view state — a single attribute on the editor root. The DOM content is identical in both modes, so switching it off gives an exactly clean manuscript with fact chips visually indistinguishable from prose. Colour is never the only indicator; a label and a glyph carry the same information.

### Overrides that do not lie

You can pin a wording that disagrees with the project value. An override changes only what the manuscript says, never the underlying research data, and the override records the project value it disagrees with. The discrepancy keeps being reported for as long as it exists. Reverted changes are marked, not deleted.

There is a deliberate split of authority here: the server-side event ledger is the append-only, concurrency-protected audit record, while the per-draft fact log is a bounded rendering cache. Nothing scientific depends on the cache alone.

## Methods generated from execution records

Methods and Abstract text are generated from what actually happened, not from what was configured.

- Databases named in the search paragraph are the ones that were provably searched. Each is classified as configured, attempted, failed, invalidated, zero results, imported, or completed, and only the last three are reportable. A later success supersedes an earlier failure.
- The search date is derived from the latest valid search, not typed into a field.
- Claims about reviewer independence and about which fields were extracted appear only when that information is actually recorded.
- The risk-of-bias instrument named is the one with completed assessments.

A first-observation rule keeps history honest: the first time a fact is seen its value is recorded but no change is emitted, so opening a pre-existing project does not manufacture a change history. A transition into "missing" is never reported as a change.

## Citations, tables and figures

Citation tokens and table and figure tokens are their own atomic chip types. They renumber themselves in place — "Table 2" becomes "Table ?" and back — without disturbing the cursor, so inserting a table in the middle of a paragraph does not scramble the caret or the numbering.

Manuscript tables are built from project data, including a Summary of Findings table derived from the primary analysis.

## Risk of bias

Risk-of-bias assessment supports dual independent assessment: two assessments share a project, study and instrument with different reviewers, plus a third consensus row, and neither reviewer's row is overwritten.

The Newcastle-Ottawa Scale is encoded verbatim from the source documents, for both the cohort and case-control forms. It ships with **no default verdict banding**: the familiar 0-3 / 4-6 / 7-9 "poor, fair, good" bands are an explicitly labelled opt-in, because no official Newcastle-Ottawa document defines them. Presenting an unofficial threshold as if it were part of the instrument is exactly the kind of quiet inaccuracy that survives peer review and then propagates.

## Export

Fact tokens are resolved once during export against freshly re-fetched sources, so an export can never leak raw token syntax and the exported numbers match what the editor displayed. Citation, table and figure tokens deliberately survive into the export because their numbering runs downstream. Word export is produced by an OOXML writer.

Consistency checks, contradiction detection, export validation and a readiness check run over the draft before you send it anywhere.

### Export limitations

- **Native Word track changes is not implemented.** There is no insertion or deletion markup in the exported document; only a clean export is guaranteed.
- Network meta-analysis and ranking plots are not included in the Word export.
- Drafts created before fact tokens existed contain none, and get no live updates until their sections are regenerated. This is deliberate — retrofitting tokens into old prose would fabricate a provenance that was never recorded.

## Upstream

The numbers in the draft come from [screening](/features/screening), [data extraction](/features/data-extraction) and [meta-analysis](/features/meta-analysis), and the search paragraph comes from the [search engine](/features/search-engine) execution records.

For the reporting standard behind all of this, see [PRISMA 2020 explained](/resources/prisma-2020-explained).
`;
