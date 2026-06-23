# ADR: Raw-payload retention — keep a capped, sanitized snapshot per record

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

Provenance and auditability want the original provider payload for every retrieved record.
Unbounded retention of raw provider responses would bloat the database and risk storing
oversized or sensitive content.

## Decision

Retain a **capped, sanitized raw snapshot per record** on `PecanSourceRecord.rawPayload`,
plus the derived normalized form on `PecanSourceRecord.normalized`:

- **What is kept:** the connector's small safe `raw` snapshot (string or JSON), stored
  capped (`rawPayload` sliced to ~20 KB in `pipeline.runSource`). Long bibliographic
  fields are individually capped too (e.g. `title` 1000, `abstract` 12000, `authors`
  2000) and `keywords` / `meshTerms` are stored as capped JSON.
- **Why both raw and normalized:** the raw snapshot preserves exactly what the provider
  returned (auditability); `normalized` records what the engine actually used downstream —
  normalization never destroys the original.
- **Sanitization:** the response is never logged; only this stored snapshot persists, and
  it is bounded in size so a hostile/oversized provider response cannot blow up a row
  (the HTTP client already rejects bodies over `maxResponseBytes` = 25 MB with
  `RESPONSE_TOO_LARGE` before they reach storage).
- **Lifecycle:** raw payloads live with the run; `PecanSourceRecord` cascades on
  `PecanSearchRun` delete (`onDelete: Cascade`), so deleting a run reclaims its raw data.

## Why cap rather than store full responses, or store nothing

- **Full responses** would be unbounded (some provider items are large) and largely
  redundant — the strongest identity + bibliographic fields are what audits actually need.
- **Storing nothing** would make a dedup decision or a normalization choice unexplainable
  after the fact, defeating the provenance goal.
- The cap is a pragmatic middle: enough to reproduce/explain a record, bounded enough to
  keep row size predictable.

## Consequences

- Extremely large source items are truncated in `rawPayload` (the normalized fields, which
  drive behavior, are preserved). This is an accepted trade-off; the executed query +
  `providerRecordId` still uniquely identify the record at the source if the full payload
  is ever needed.
- Retention is coupled to run retention — there is no separate raw-payload purge job; pruning
  old runs prunes their raw data via the cascade.

## References
`schema.prisma` (`PecanSourceRecord.rawPayload` / `normalized`), `pipeline.runSource`
(field caps), `normalize.js`, `httpClient.readCapped`, `ADR provenance-model.md`.
