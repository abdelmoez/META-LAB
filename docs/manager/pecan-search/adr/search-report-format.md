# ADR: Search-report format — PRISMA-S–oriented, derived from stored data

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

Systematic reviews must report exactly what was searched, where, when, and with what
results, in a reproducible form. PRISMA-S is the reporting standard for the search.

## Decision

Generate a **PRISMA-S–oriented search report** (`report.js → buildReport(runId)`) in which
**every number derives from persisted run data** — never reconstructed approximately:

- **Run-level:** search name, run date (ISO-8601 UTC), who ran it, the database-neutral
  canonical strategy (`canonicalText`), the engine version, and the deduplication method
  ("PecanRev explainable engine (scorePair / classifyPair)").
- **PRISMA identification counts** (`prismaCounts`): `recordsIdentified` (raw, by source),
  `duplicatesRemoved` (exact + auto-merged fuzzy), `existingMatched`, `recordsToScreening`
  (net new), `ambiguousPending`, `failedRecords` — aggregated from per-source rows via
  `aggregateCounts`.
- **Per source:** the database label + platform, the **exact executed query** + its hash,
  whether a manual override was used, translation warnings, filters, cap + capReached,
  preview count, and the retrieved/imported/existing-matched/duplicates-removed/
  ambiguous/failed counts, connector version, state, timestamps, and any sanitized error.

**Exporters:** structured **JSON** (default), **CSV** (per-source table + metadata header,
with spreadsheet formula-injection guarding for cells starting `= + - @`), and a
self-contained print-friendly **HTML** document (all dynamic text HTML-escaped) suitable
for saving as PDF and attaching to a manuscript or PROSPERO record.

## Why PRISMA-S and why derive-from-stored

- **PRISMA-S** is the recognized standard for reporting the search component of a review;
  aligning the report to it makes PecanRev output directly usable by authors and reviewers.
- **Deriving every count from persisted `PecanSearchSource` rows** (rather than recomputing
  from live data or estimates) makes the report exact and reproducible — the exact executed
  query is stored per source, so the report *is* the audit record.

## Why not a free-form / proprietary report

- A non-standard format would force authors to re-derive PRISMA numbers by hand and would
  not satisfy reviewers asking for PRISMA-S compliance.

## Consequences

- The report is only as complete as the stored run — which is the point: it reflects
  exactly what executed, including honest partial-success and per-source errors.
- Three export formats cover machine consumption (JSON), spreadsheets (CSV), and
  human/print (HTML→PDF). All are injection/escaping-hardened.

## References
`report.js` (`buildReport`, `prismaCounts`, `reportToCsv`, `reportToHtml`),
`runService.aggregateCounts`, `ARCHITECTURE.md` §8, `USER_GUIDE.md` §7–§8.
