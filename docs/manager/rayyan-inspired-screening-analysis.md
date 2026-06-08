# Systematic Review Title/Abstract Screening: Methodology Analysis

*META·LAB internal document — methodology reference for META·SIFT Beta design*

---

## 1. What Is Systematic Review Screening?

Systematic review screening is the process by which a research team evaluates a
large set of bibliographic records — retrieved from databases such as PubMed,
Embase, Cochrane CENTRAL, and Scopus — to determine which records are eligible
for inclusion in the final synthesis.

The process follows the PRISMA 2020 (Preferred Reporting Items for Systematic
reviews and Meta-Analyses) framework, which requires transparent reporting of
every stage: how many records were identified, how many were removed as
duplicates, how many were screened, how many were excluded at each stage, and
how many were ultimately included.

Screening typically occurs in two distinct phases:

1. **Title/abstract screening** — reviewers read the title and abstract only and
   make an initial include/exclude/uncertain decision. This phase is designed for
   high sensitivity: when in doubt, the record is kept for the next phase.

2. **Full-text screening** — the full PDF of remaining records is retrieved and
   assessed against the explicit inclusion/exclusion criteria. This phase applies
   the definitive eligibility judgment.

Both phases must be reported in the PRISMA flow diagram with exact record counts.

---

## 2. Standard Workflow

The canonical workflow for a systematic review screening is:

```
Database search
      │
      ▼
Record import (RIS / BibTeX / PubMed NBIB / EndNote XML)
      │
      ▼
Deduplication
  • Exact DOI match
  • Exact PMID match
  • Near-duplicate title detection (fuzzy matching)
      │
      ▼
Title/abstract screening
  • Each reviewer: include / exclude / maybe (uncertain)
  • Blind mode: reviewer decisions hidden from each other
      │
      ▼
Conflict resolution
  • Disagreements surfaced for adjudication
  • Third reviewer or consensus discussion
      │
      ▼
Full-text retrieval
  • PDFs sourced for all included + uncertain records
      │
      ▼
Full-text eligibility assessment
  • Applied against formal inclusion/exclusion criteria
  • Reasons for exclusion recorded
      │
      ▼
Data extraction and synthesis
```

The Cochrane Handbook (version 6.4, 2023) recommends that at least two
independent reviewers screen all records at title/abstract phase, with
disagreements resolved by discussion or a third reviewer (Chapter 4).

---

## 3. Core Feature Set for Screening Tools

The following features are standard in systematic review screening workflows
as described in the Cochrane Handbook and PRISMA 2020 reporting guidelines:

### 3.1 Record Management

- **Import from multiple formats**: RIS, BibTeX, PubMed NBIB, EndNote XML are
  the four most common export formats from reference managers and databases.
- **Record list view**: Sortable and filterable list of all imported records.
- **Record detail view**: Title, authors, year, journal, abstract, DOI, PMID.
- **Pagination or virtual scrolling**: Required for corpora > 1,000 records.

### 3.2 Decision Interface

- **Three-state decisions**: The standard set is include / exclude / undecided
  (sometimes called "maybe" or "uncertain"). Two-state (include/exclude only)
  is simpler but loses the ability to flag genuinely ambiguous records.
- **Keyboard shortcuts**: Essential for reviewers processing hundreds of records
  per session (e.g., I = include, E = exclude, M = maybe, N = next).
- **Progress indicators**: How many records remain, percentage complete.

### 3.3 Blind Mode

In methodologically rigorous reviews, reviewers should not see each other's
decisions while screening is in progress. This prevents anchoring bias — the
tendency of a second reviewer to agree with the first without independent
judgment.

Blind mode is a project-level setting: either all reviewers are blind, or none
are. Mixing blind and non-blind reviewers within the same project is not
methodologically sound.

### 3.4 Conflict Detection

After both reviewers have screened a record, the system detects disagreements
(include vs. exclude, or include vs. maybe, etc.) and flags them for
resolution. Conflicts should be:

- Surfaced in a dedicated conflict list, not buried in the main record list.
- Labeled with both reviewers' decisions.
- Resolvable by a designated adjudicator or by consensus edit.

### 3.5 Exclusion Reasons

For full-text screening, the reason for exclusion must be recorded and reported
(PRISMA 2020, item 17). Standard reason categories from Cochrane:

- Wrong population
- Wrong intervention
- Wrong comparator
- Wrong outcome
- Wrong study design
- Wrong publication type
- Full text unavailable

At title/abstract phase, reasons are typically not required (too many records),
but some teams record them for transparency.

### 3.6 Labels and Notes

- **Labels (tags)**: Free-form or from a controlled vocabulary; useful for
  marking records that belong to a specific sub-question or PICO element.
- **Notes**: Free-text annotation per record per reviewer; useful for
  capturing rationale during screening.
- **Ratings**: Some workflows add a 1–5 relevance rating to support
  prioritization of full-text review.

### 3.7 PRISMA Integration

The system should be able to automatically compute the PRISMA 2020 flow counts:

| PRISMA node | Source |
|---|---|
| Records identified | Total imported |
| Records removed before screening (duplicates) | Deduplication count |
| Records screened | Include + exclude + maybe |
| Records excluded (title/abstract) | Exclude count |
| Reports sought (full-text) | Include + maybe count |
| Reports included in review | Final include count |

---

## 4. META·SIFT Beta: Implemented vs. Planned

### Implemented in Beta

| Feature | Status |
|---------|--------|
| Import: RIS, BibTeX, PubMed NBIB, EndNote XML | Implemented (reuses existing parsers) |
| Deduplication: DOI, PMID, title similarity | Implemented |
| Three-state decisions (include/exclude/maybe) | Implemented |
| One decision per reviewer per record (upsert) | Implemented |
| Blind mode (project-level flag) | Implemented |
| Conflict detection on every save | Implemented |
| Notes per decision | Implemented |
| Rating 1–5 per decision | Implemented |
| Labels (stored as JSON per decision) | Implemented |
| Screening stats endpoint | Implemented |
| Export: CSV and JSON, filtered by decision | Implemented |
| PRISMA flow number computation | Implemented (pure function) |
| Per-project isolation (user owns project) | Implemented |

### Planned for Future Versions

| Feature | Notes |
|---------|-------|
| Full-text screening phase | Separate workflow stage after T/A phase |
| PDF viewer integration | In-app full-text reading |
| Exclusion reasons (full-text phase) | Per PRISMA 2020 item 17 |
| Adjudicator role (third reviewer) | Conflict resolution by designated arbiter |
| Multi-project team invitations | Shared projects across user accounts |
| PRISMA 2020 diagram export (SVG/PDF) | Auto-generated from computed counts |
| Inter-rater reliability metrics | Kappa, percent agreement |
| Bulk label management | Apply/remove labels across selections |
| Search and filter within record list | Keyword, year, journal, decision filters |
| API for CI/CD integration | Programmatic import and export |

---

## 5. How META·SIFT Differs from Generic Tools

META·SIFT Beta is not a general-purpose citation manager. It is designed
specifically for systematic review teams working within the META·LAB ecosystem.

### Research-Grade Methodology First

META·SIFT enforces methodologically sound practices by default:
- Blind mode is available as a first-class project setting.
- Conflict detection is automatic — it cannot be disabled.
- The decision model is strict: one decision per reviewer per record (upsert),
  preventing accidental double-decisions.
- Stats and PRISMA counts are derived from live data, not from manually entered
  numbers.

### Integrated with META·LAB

META·SIFT uses the same authentication system as META·LAB, so teams that
already use META·LAB for meta-analysis do not need a separate account or tool.
Screening projects are logically separate from analysis projects but live in the
same workspace, enabling a future handoff path from screened records to the
data extraction phase.

### Parser Reuse

META·SIFT reuses the reference import parsers already present in the
research engine (`src/research-engine/import-export/parsers.js`), ensuring
that format support is consistent across the platform and maintained in one
place.

### Methodology Focus

The module is explicitly named "SIFT Beta" to signal that it is experimental
and methodology-focused — not a polished consumer product. The goal is
correctness and auditability, not UI richness.

---

## References

- Page MJ, McKenzie JE, Bossuyt PM, et al. The PRISMA 2020 statement. *BMJ*. 2021;372:n71.
- Higgins JPT, Thomas J, Chandler J, et al. *Cochrane Handbook for Systematic Reviews of Interventions* version 6.4. 2023.
- Rethlefsen ML, Kirtley S, Waffenschmidt S, et al. PRISMA-S: an extension to the PRISMA statement for reporting literature searches. *Syst Rev*. 2021;10(1):39.
