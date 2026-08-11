/**
 * Content source for /features/prisma-flow-diagram — 113 W1-A.
 *
 * Claims verified against src/research-engine/prisma/{model,derive,reconcile,
 * projection,svg}.js, server/screening/prismaFlowService.js,
 * src/features/prisma/PrismaFlowDiagram.jsx, src/research-engine/manuscript/
 * {prismaCounts,prismaChecklist,tables}.js and docs/prisma-flow-103.md
 * (including the 105.md connector section) + docs/manuscript-sync-101.md.
 * The limitations section restates that doc's own "not yet wired" list.
 */

export default `---
h1: PRISMA 2020 flow diagrams derived from your records
title: PRISMA Flow Diagram Generator for Systematic Reviews | PecanRev
description: PecanRev derives the PRISMA 2020 flow diagram from the source and disposition of every record, checks the counts reconcile, and exports SVG, PNG and the checklist.
slug: features/prisma-flow-diagram
published: 2026-08-10
updated: 2026-08-10
author: The PecanRev team
---

PecanRev builds the PRISMA 2020 flow diagram from the records themselves. Every record carries where it was identified and what happened to it, the diagram is derived from those two facts in a single pass, and the arithmetic is checked against structural identities before you are shown anything. There is no box you type a number into and hope it still matches your screening log in six months.

## Why do PRISMA numbers stop matching the review?

Because in most workflows they are transcribed. Somebody counts the export from each database, somebody else counts the exclusions, and the diagram is assembled by hand at write-up time — weeks after the decisions were made. Then a late duplicate is found, or twelve more records arrive from citation searching, or an exclusion reason is corrected, and the diagram silently becomes a description of a review that no longer exists. Nothing errors. The mismatch is discovered by a reviewer, if at all.

A diagram derived from the record ledger cannot drift, because there is nothing to drift from. If the count is wrong, the underlying data is wrong, and that is a problem worth finding.

## How does PecanRev derive the diagram?

Each record is projected into a small, flat shape carrying its origin, its source database, its identification source, its duplicate state and stage, its screening decision, whether full text was sought and retrieved, its full-text decision and exclusion reason, and whether it ended up in the quantitative synthesis. The whole flow is then derived from that projection in one pass, so every box on the diagram is computed exactly once, from one source, by one function.

### Where a record came from

Identification sources map onto the two columns PRISMA 2020 asks for. Databases and registers sit in the left-hand arm; citation searching, websites, organisations, hand-searching and other methods sit in the right-hand arm.

The classification rule is deliberately blunt about precedence: an explicit identification source wins, then the record's origin, then the free-text database name. A record found by citation mining is filed under citation searching **even if its source field says PubMed**, because that is how it entered your review. A record with no source row and no import batch at all is treated as manually added and goes to the other-methods arm — defaulting it to a file import would file a hand-added study under database searching, which misreports the search.

### What happened to it

Every record resolves to exactly one of nine dispositions: removed as a duplicate, removed by automation, removed for another reason, excluded at title and abstract, awaiting screening, full text not retrieved, excluded at full text, awaiting full-text assessment, or included. The set is exhaustive and disjoint, which is what makes the diagram add up: a record cannot be in two boxes, and it cannot be in none.

Order matters in that resolution, and it follows the lifecycle — duplicates are settled first, then removals before screening, then the retrieval branch, then the title-and-abstract decision. Only the database arm has a "records screened" box, because PRISMA 2020 does not give the other-methods column one.

## How are duplicates counted without double counting?

Only the non-primary member of a duplicate group is counted as removed, and each removal is attributed to the stage it happened at — during the search, at import, or during screening. Because a record has exactly one disposition, a duplicate removed during the search cannot be counted again in screening.

Import-time duplicates are the awkward case: they are discarded before a record row exists, so there is nothing to point at. They are still counted, added to both the identified and the removed totals, and labelled in the breakdown as discarded at import rather than quietly merged into the deduplication figure.

And zero duplicates is treated as a claim rather than a default. If nothing was removed, the validation panel says so: confirm deduplication was actually run before you report that number.

## What happens to records that were never retrieved?

Full-text retrieval is tracked as a three-state fact — retrieved, not retrieved, or never attempted — and the reason is carried with it: no open-access copy available, not found by any provider, retrieval failed, or not obtained. A record where retrieval was never attempted stays null and never inflates the "not retrieved" box.

An unresolved disagreement between reviewers is treated the same way. If two reviewers split and nobody has resolved it, the record counts as awaiting screening. It is never quietly resolved in favour of one side so the diagram can look finished.

## Does the diagram reconcile?

Every derived flow is run through a structural reconciliation before it is displayed, and both sides of each identity are reported so a discrepancy can be located rather than merely announced. The identities include: identified minus removed equals screened; the removal subtotals sum to the removal box; the duplicate stage breakdown sums exactly to duplicates removed; screened minus excluded minus awaiting equals sought for retrieval; sought minus not retrieved equals assessed, checked separately in each arm; assessed minus excluded minus awaiting equals included reports; studies never exceed reports; the quantitative subset never exceeds the included set; and no box is negative.

When everything checks out the panel says so explicitly. When it does not, the failure is raised as an alert with the specific identity that broke. There are advisory checks too — more than a fifth of sought records not retrieved, or exclusion reasons that do not sum to the number excluded, are flagged as worth checking before submission rather than as errors.

## Why the connectors are part of the engineering

A flow diagram is a claim about how records moved, and a connector that starts in empty space undermines the claim. In PecanRev the diagram is not drawn as a picture with lines at fixed offsets. Every box registers its real geometry as it is placed, and each connector is declared as a relationship between two box identifiers, resolved only once every box exists.

That means an arrow always leaves the bottom edge of its own source box and lands on the top edge of its destination, even when the exclusions box beside it is six reasons tall. Where a straight line would not clear an intervening box, the connector routes as an elbow through the gap. A connector that would have to run backwards draws nothing, because drawing nothing is the honest outcome.

The layout is tested, not eyeballed: an automated suite parses the emitted SVG across several data shapes and asserts that every connector starts and ends on a box edge, that no elbow crosses a box, that no boxes overlap or escape the canvas, that both arms converge on one terminal box, and that the exported file and the on-screen view have byte-identical geometry.

## What happens when there is nothing to draw?

A project with no records shows a plain statement that no records have been identified yet, not a diagram full of fabricated zeros. In the legacy manual-count path, values that were never recorded print as "[not recorded]" rather than as zero.

Zero-result databases are handled with the same care in the other direction. A database that was searched and returned nothing is reported as a real zero, because it really happened and PRISMA requires it. A search that failed is not silently converted into "we searched and found nothing" — only a completed search with no results earns that state.

## Exports and the PRISMA 2020 checklist

The diagram exports as vector SVG and as PNG, with journal size presets and an optional transparent background. The Word manuscript export embeds it as a high-resolution figure, and the reproducibility and journal-submission bundles include the figure files alongside the rest of the package.

Alongside the diagram, PecanRev builds a checklist table covering PRISMA 2020 items 1-26 (item 27, availability of data and code, is not yet tracked), grouped by section, and the PRISMA-S search-reporting checklist as 16 items, both exportable as CSV. Nine checklist items can be pre-filled from project data; each one that is says "auto-detected from project data — verify" rather than claiming the item is done.

## What this does not do

- **Reports are not yet grouped into studies.** The model distinguishes multiple reports of one study and reconciles against it, but nothing in the interface writes that link yet, so today every included record counts as its own study.
- **Automated exclusion before screening has no writer.** The box exists and is tested; PecanRev's own relevance model marks records rather than removing them, so in practice the figure stays zero.
- **Import-time duplicates are counted but not individually inspectable**, because the records were discarded before they were stored.
- **The per-record inspector currently shows counts and breakdowns rather than the record list** behind each box; the list is not wired end to end yet.
- **Not every export path draws the derived diagram.** The PRISMA tab and the Word manuscript export use it; the reproducibility bundle, the standalone report HTML and the journal-submission bundle currently render the older single-column diagram from the manual count fields. Check which one you are attaching.
- **The drawing caps visible detail at six rows** per source list and six exclusion reasons; the full breakdown is available in the panel and the exports.

## Where this sits in the workflow

Identification counts come from the [search engine](/features/search-engine) and its per-database run records; dispositions come from [screening](/features/screening); the diagram and its counts reach the write-up as live facts in the [manuscript editor](/features/manuscript). If several patient cases were extracted from one paper, [case series mode](/features/case-series) keeps the flow counting publications.

New to the standard itself? Read [PRISMA 2020 explained](/resources/prisma-2020-explained), which covers the checklist, the diagram and the mistakes reviewers catch most often.
`;
