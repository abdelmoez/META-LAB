/**
 * Content source for /resources/systematic-review-search-strategy.
 *
 * 113.md W1-B — search methodology guide. Owns the "how do I build the search"
 * intent; the workflow overview lives on /resources/how-to-conduct-a-systematic-review.
 * Database behaviour described here is taken from the official NLM documentation
 * and the cited methods literature, never from memory of an interface.
 */

export default `---
h1: How to build a systematic review search strategy
title: Systematic Review Search Strategy: PubMed, MeSH and Boolean Logic
description: How to turn a review question into a reproducible search: concept blocks, MeSH and free text, Boolean logic, database translation and PRISMA-S documentation.
slug: resources/systematic-review-search-strategy
published: 2026-08-09
updated: 2026-08-09
author: The PecanRev team
---

A systematic review search strategy is a structured, documented query built from the concepts in your review question: each concept becomes a block of synonyms combined with OR, the blocks are combined with AND, controlled vocabulary is added alongside free text, and the whole thing is translated into each database's own syntax and recorded so someone else can run it again. Sensitivity is the goal, not precision. You are trying not to miss studies, and you accept a large number of irrelevant records as the price.

## How do you turn a question into concept blocks?

Take the question apart into its concepts, then deliberately drop one or two of them.

For a PICO question, the population and the intervention are almost always searched. The comparator is usually not — searching for "placebo" removes every trial that reported its comparator in words your synonym list did not anticipate. The outcome is usually not searched either, because outcomes are frequently absent from titles, abstracts and indexing, particularly adverse events and secondary outcomes. Two or three blocks is the normal shape of a good strategy. Four is often a strategy that is quietly excluding studies.

Within each block, collect: the natural-language terms clinicians use, the terms authors use in titles, spelling variants across English variants, abbreviations and their expansions, brand and generic drug names, and historical terms that were current during your date range.

## What is the difference between MeSH and free-text terms?

MeSH — Medical Subject Headings — is the controlled vocabulary that the National Library of Medicine assigns to MEDLINE records. A human indexer reads the article and tags it with descriptors from a fixed hierarchy, so a MeSH search finds papers about a topic regardless of the words the authors chose.

Free-text searching matches the characters in the title and abstract fields. It finds papers indexers have not yet reached, papers where indexing is arguable, and record types that are not indexed at all.

You need both, ORed together inside each concept block, for three reasons: indexing lags publication by weeks to months, so the newest and often most relevant records carry no MeSH; not every database record is indexed; and indexing decisions are judgements that will sometimes disagree with yours.

### Exploding, focusing and subheadings

A MeSH descriptor sits in a tree. Searching it normally **explodes** it, meaning the search also retrieves every narrower descriptor beneath it. That is the behaviour you usually want in a systematic review; turning explosion off narrows the search and needs a justification in your methods.

Restricting to the major topic — the descriptors an indexer marked as the article's central subject — and attaching subheadings both increase precision and reduce sensitivity. Both are usually inappropriate for a systematic review search, for the same reason: they make retrieval depend on an indexer's emphasis rather than on the article's content.

Read the scope note before you use a descriptor. Scope notes routinely reveal that a term does not mean what its label suggests, and the entry terms listed with it are a free source of synonyms for your free-text block.

## What Boolean and syntax rules actually matter?

- **OR inside a block, AND between blocks.** A concept block is a set of synonyms, so it is always ORed. Blocks are the concepts that must co-occur, so they are ANDed.
- **Parenthesise every block explicitly.** Operator precedence differs between platforms, and an unbracketed strategy that behaves correctly in one database will silently return the wrong set in another.
- **Truncation** — usually an asterisk — catches word endings. Truncating too early is a classic failure: a three-letter stem plus a wildcard can pull in thousands of unrelated words and, on some platforms, silently exceed a term limit.
- **Phrase searching** with quotation marks is not universal in behaviour. In PubMed, quoted phrases are searched as phrases, and PubMed reports when a phrase was not found as such — read the search details rather than assuming.
- **Avoid NOT.** Boolean NOT removes any record mentioning the excluded term anywhere, including in a sentence that would have qualified the study for inclusion. Exclusions belong in screening, where a human reads the reason and records it.

### Automatic term mapping in PubMed

PubMed does not search your words literally by default. Untagged terms go through automatic term mapping, which may translate them into a combination of MeSH terms and text words. This is helpful for a quick lookup and unhelpful for a systematic review, because the translation is invisible unless you look and can change over time.

For a reproducible strategy, tag your fields explicitly — for example a descriptor as a MeSH Terms search and a phrase as a Title/Abstract search — and always save the Search Details, which show exactly what PubMed executed. A strategy that relies on automatic mapping is not reproducible even in PubMed, let alone anywhere else.

## How do you translate a strategy across databases?

Translation is not find-and-replace, because each database has its own controlled vocabulary, its own field tags and its own operators.

- **Vocabulary.** MEDLINE uses MeSH. Embase uses Emtree. CINAHL uses CINAHL Headings. PsycINFO uses the APA Thesaurus. There is no official, complete crosswalk between them. A MeSH descriptor has no guaranteed Emtree equivalent, and mapping tools that claim otherwise are producing a best guess.
- **Field tags.** The tag for a title-and-abstract search differs by platform, as do the tags for author keywords and for publisher-supplied keywords.
- **Operators.** Truncation characters, proximity operators and their distance syntax all differ. Proximity in particular is not portable and is the most common source of a strategy that runs without error and returns the wrong records.
- **Interfaces.** The same database on two platforms can behave differently. Record the platform, not just the database name.

The honest approach when no verified equivalent exists is to search the concept as a well-formed free-text phrase in that database's grammar and to say so in your methods, rather than to assert an equivalence you cannot support.

### Search filters

Validated filters exist for study designs — the Cochrane Highly Sensitive Search Strategies for identifying randomised trials being the best known — and for some populations and topics. Use a published, validated filter and cite it. Do not write your own design filter for a systematic review; a filter is an empirical instrument with known sensitivity, and an improvised one has none.

Language and date limits require justification. Restricting by language introduces a known bias risk; restricting by date is defensible when the intervention or technology did not exist before a given year, and indefensible as a convenience.

## Which databases, and what else besides databases?

No single database is sufficient, and the combination that achieves adequate recall depends on the topic — Bramer and colleagues showed this directly. For most health questions the core is MEDLINE, Embase and CENTRAL, plus at least one subject-specific database where one exists.

Bibliographic databases are not the whole search. Also cover:

- **Trial registries** — ClinicalTrials.gov and the WHO ICTRP — for unpublished and ongoing studies. Registry entries also reveal outcome switching.
- **Reference lists** of included studies, and forward citation searching on them.
- **Grey literature**: theses, conference abstracts, reports from relevant organisations.
- **Contacting authors** when a study is clearly relevant and its data are incomplete.

## How should the search be documented and peer reviewed?

Have the strategy peer reviewed before you run it. PRESS is a published checklist for that review, covering translation of the question, Boolean and proximity operators, subject headings, text-word searching, spelling and syntax, and limits. An hour of an information specialist's time is the cheapest error correction in the whole project.

PRISMA-S then defines what has to be reported: each database with its platform and the date it was searched, the full strategy for at least one database reproduced verbatim including every line and its result count, any filters and limits with a citation for validated filters, the other sources searched, and the deduplication method and software.

Save the strategy as it was run, not as you would like it to have been. Record the number of records retrieved per database on the day, because rerunning the same strategy later returns a different number and you will need the original for the flow diagram. A database configured but never run must never appear in the methods as searched, and a search that returned zero records is reported as zero rather than dropped.

## Common failure modes

- **Searching all four PICO elements.** Almost always over-restrictive.
- **MeSH without free text.** Misses everything not yet indexed, including the most recent literature.
- **Over-truncation.** A short stem plus a wildcard can dominate the whole result set.
- **Assuming syntax ports.** Especially proximity operators and quoted phrases.
- **Undocumented iteration.** A strategy refined ten times and reported once, in its final form, with no record of what changed.
- **Reporting a search you did not run.** The methods section must be derived from execution records.

## References

- Higgins JPT, Thomas J, Chandler J, Cumpston M, Li T, Page MJ, Welch VA (editors). Chapter 4: Searching for and selecting studies. In: *Cochrane Handbook for Systematic Reviews of Interventions*, version 6.5. Cochrane, 2024. [training.cochrane.org/handbook](https://training.cochrane.org/handbook)
- Rethlefsen ML, Kirtley S, Waffenschmidt S, et al. PRISMA-S: an extension to the PRISMA Statement for Reporting Literature Searches in Systematic Reviews. *Systematic Reviews*. 2021;10:39. [doi:10.1186/s13643-020-01542-z](https://doi.org/10.1186/s13643-020-01542-z)
- McGowan J, Sampson M, Salzwedel DM, Cogo E, Foerster V, Lefebvre C. PRESS Peer Review of Electronic Search Strategies: 2015 Guideline Statement. *Journal of Clinical Epidemiology*. 2016;75:40-46. [doi:10.1016/j.jclinepi.2016.01.021](https://doi.org/10.1016/j.jclinepi.2016.01.021)
- Bramer WM, Rethlefsen ML, Kleijnen J, Franco OH. Optimal database combinations for literature searches in systematic reviews: a prospective exploratory study. *Systematic Reviews*. 2017;6:245. [doi:10.1186/s13643-017-0644-y](https://doi.org/10.1186/s13643-017-0644-y)
- Bramer WM, Giustini D, de Jonge GB, Holland L, Bekhuis T. De-duplication of database search results for systematic reviews in EndNote. *Journal of the Medical Library Association*. 2016;104(3):240-243. [doi:10.3163/1536-5050.104.3.014](https://doi.org/10.3163/1536-5050.104.3.014)
- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement: an updated guideline for reporting systematic reviews. *BMJ*. 2021;372:n71. [doi:10.1136/bmj.n71](https://doi.org/10.1136/bmj.n71)
- National Library of Medicine. *PubMed User Guide*. [pubmed.ncbi.nlm.nih.gov/help](https://pubmed.ncbi.nlm.nih.gov/help/)
- National Library of Medicine. *MeSH Browser*. [meshb.nlm.nih.gov](https://meshb.nlm.nih.gov/)

## Doing this in PecanRev

The [PecanRev search engine](/features/search-engine) is built around the concept-block model described above. You build concepts from the research question itself, MeSH descriptors carry their scope note, entry terms and tree number in the interface, and one board compiles to paste-ready queries for sixteen databases. Boolean NOT is deliberately unsupported for the reason given above.

Where no verified vocabulary crosswalk exists — Emtree, CINAHL Headings, the APA Thesaurus — PecanRev does not invent one: the concept is compiled as a correctly formatted free-text phrase in that database's grammar, with a warning naming the vocabulary that has no verified equivalent. Seven sources can be run automatically from inside the product; the rest are compile-and-paste, and the interface says which is which. The Methods paragraph and PRISMA-S style report are generated from execution records, so a database you configured but never ran is never reported as searched. Records flow onward into [screening](/features/screening).
`;
