# ADR: Connector architecture — one factory per provider behind a frozen contract

**Status:** Accepted · **Scope:** Pecan Search Engine (P1)

## Context

Seven providers (PubMed, Europe PMC, ClinicalTrials.gov, Crossref, DOAJ, OpenAlex,
Semantic Scholar) each have a different API shape, query grammar, paging scheme, and
error behavior. The engine's pipeline must not know any of that.

## Decision

Each provider is a **connector built by a factory** and registered in
`connectors/registry.js → CONNECTOR_FACTORIES`. The contract is frozen in `CONTRACT.md`
and documented in code in `connectors/base.js`; `connectors/pubmed.js` is the reference.

A connector exposes only: `provider`, `capabilities()`, `translateQuery()`,
`validateQuery()`, `previewCount()`, `search(translated, cursor, ctx)`, `normalize()`.
The pipeline (`pipeline.runSource`) only ever sees this contract — **a provider's response
structure never leaks past `normalize()`**.

Hard rules (enforced by the contract + tests):
- **No connector calls `fetch` directly** — all egress goes through the single shared
  `httpClient.js` (timeouts, retries, size-guard, circuit breaker, redaction), so every
  provider gets uniform resilience and secret handling.
- **Zero new dependencies** — JSON is parsed natively; XML providers get a small pure
  parser (`pubmedXml.js`), no parser package.
- **Dependency-injected** (`{ http, now, sleep, logger, contact, retryLimit }`) so the
  whole engine is testable with a mock fetch + fixed clock — no real network in CI.
- **Cursor is an opaque string the connector owns** (JSON-encoded page state), so each
  provider's paging scheme (history WebEnv, cursorMark, page tokens, bulk tokens) stays
  internal.
- **Never silently weaken a query** — unsupported fields/operators produce a warning, not
  a dropped clause.

A provider with no factory is reported `implemented: false` and is not selectable, so
providers can be added incrementally.

## Why not a single switch-driven adapter or per-provider HTTP code

- A god-adapter would re-leak provider shapes into the pipeline and make testing one
  provider require touching all of them.
- Per-provider `fetch` calls would scatter timeout/retry/redaction logic and make a
  uniform circuit breaker and secret redaction impossible to guarantee.

## Consequences

- Adding a provider = one new file + one registry line + fixtures + contract tests; no
  pipeline changes.
- The connector boundary is the single place to reason about a provider's grammar and
  paging, which keeps the translation warnings honest.

## References
`CONTRACT.md`, `connectors/base.js`, `connectors/registry.js`, `connectors/pubmed.js`,
`httpClient.js`, `ARCHITECTURE.md` §2.
