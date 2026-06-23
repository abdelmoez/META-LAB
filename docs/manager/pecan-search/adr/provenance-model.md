# ADR: Provenance model — store every retrieved record with raw + normalized + link

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

For a defensible systematic review, every imported reference must be traceable back to the
source, the exact query that found it, and the original provider payload — and that trace
must survive deduplication merges.

## Decision

Persist a **`PecanSourceRecord`** for **every** normalized record retrieved (not just the
ones that land), carrying full provenance:

- `runId`, `sourceId`, `provider`, `providerRecordId` — which run, which source, which
  provider record.
- `rawPayload` — a safe, capped snapshot of the original provider response item.
- `normalized` + `normalizationVersion` — the canonicalized fields + the normalizer
  version that produced them.
- the normalized bibliographic fields (doi, pmid, pmcid, nctId, title, abstract, authors,
  year, journal, …).
- `dedupOutcome` — `new` | `existing_match` | `exact_dup` | `fuzzy_dup` | `ambiguous`.
- `screenRecordId` — the link to the landed `ScreenRecord` (string link, not an FK).

The exact executed query lives on `PecanSearchSource` (`finalQuery` + `queryHash` +
`providerVersion`), and the run stores the canonical AST + plain render. Together: record
→ source query → run strategy.

**Idempotency key:** `@@unique([runId, provider, providerRecordId])` — re-fetching a page
(retry / worker restart) can never persist the same provider record twice. When a record
lacks a stable provider id, `contentHashId()` derives a deterministic fallback from its
strongest identity fields.

**Survives merges:** `screenRecordId` is a plain link, and a dedup merge reuses the
screening duplicate model (primary/duplicate grouping) rather than deleting records — so
the provenance link stays valid after a merge.

## Why store raw payloads at all / why not only the landed records

- Reviewers and audits may need the original record exactly as the provider returned it
  (e.g. to explain a dedup decision or a normalization choice).
- Recording *every* retrieved record (including dups and existing matches) is what makes
  the PRISMA "records identified" and per-source counts exact rather than reconstructed.

## Consequences

- Storage grows with retrieved records; `rawPayload` and text fields are capped to bound
  per-row size (see the raw-payload-retention ADR).
- Provenance is queryable per project (`@@index([metaLabProjectId, doi/pmid])`,
  `@@index([sourceId])`).

## References
`schema.prisma` (`PecanSourceRecord`), `pipeline.runSource`, `connectors/base.contentHashId`,
`normalize.js`, `ARCHITECTURE.md` §5–§6.
