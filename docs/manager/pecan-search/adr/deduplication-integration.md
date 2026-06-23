# ADR: Deduplication integration — reuse the explainable engine, precision-first

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

P1 imports records from many sources into a project that may already contain records.
We must remove duplicates without ever silently hiding an eligible study, and the result
must be consistent with the existing screening Duplicates view and PRISMA counts.

## Decision

**Reuse PecanRev's existing explainable deduplication engine** —
`src/research-engine/screening/deduplication.js` (`scorePair`, `classifyPair`,
`normalizeTitle`, `DUP_TYPES`, `DUP_MODEL_VERSION`). It is **not** reimplemented. The P1
layer (`dedup.js`) only builds an efficient index over the project's records and maps the
existing engine's verdicts to pipeline outcomes.

The policy is **precision-first** (a false merge can hide an eligible study):

| Verdict | Outcome | Action |
|---------|---------|--------|
| DOI/PMID identity (pre-existing) | `existing_match` | not landed; provenance attaches |
| DOI/PMID identity (in-run) | `exact_dup` | not landed |
| `classifyPair` PROBABLE + mergeable | `fuzzy_dup` | auto-merged, decision recorded |
| POSSIBLE / RELATED / FAMILY | `ambiguous` | **landed as a distinct record** + queued for human review |
| NOT | `new` | landed |

An exact normalized-title match **without** a shared identifier is deliberately *not*
treated as identity — it defers to `classifyPair`, because same-title-different-id is
usually a related report (preprint↔journal, erratum) that must not be auto-merged.

**Consistency:** resolving an ambiguous merge reuses the **existing screening duplicate
model** (`ScreenDuplicateGroup` + `ScreenRecord.isDuplicate/isPrimary/duplicateGroupId`),
so the standard Duplicates UI and "duplicates removed" PRISMA count stay correct, and
dedup uncertainty never leaks into screening conflicts.

**Scalability:** exact matches are O(1) map lookups; fuzzy comparison is bounded to a
12-char title-prefix block with a configurable `fuzzyCeiling` (default 20000). Beyond it,
the standard post-import `detectDuplicatesInProject` pass still catches fuzzy dups.

Every decision is stored on `PecanDedupDecision` with the score, component signals,
`ruleVersion` (`DUP_MODEL_VERSION`), reasons, and conflicts — auditable and reversible.

## Why reuse rather than build a P1-specific deduper

- The screening engine is already labeled-tested and explainable; a second deduper would
  risk divergent verdicts between import-time and screening-time dedup.
- Reusing the screening duplicate model is the only way to keep the existing Duplicates UI
  and PRISMA counts authoritative.

## Consequences

- P1 inherits the screening engine's precision target and version (`DUP_MODEL_VERSION`).
- Ambiguous pairs require a human step by design — that is the safety property, not a gap.

## References
`dedup.js`, `duplicates.js`, `src/research-engine/screening/deduplication.js`,
`schema.prisma` (`PecanDedupDecision`), `ARCHITECTURE.md` §6.
