# Pecan Search Engine — Connector Contract (FROZEN)

Every provider is a **connector** built by a factory and registered in
`connectors/registry.js`. A connector hides its provider's API shape from the rest
of the engine — provider response structure NEVER leaks past `normalize()`.

Reference implementation: **`connectors/pubmed.js`** (+ `connectors/pubmedXml.js`).
Copy its structure. Shared helpers: `connectors/base.js`, `query/ast.js`,
`normalize.js`, `throttle.js`, `errors.js`.

## Factory

```js
export function createXConnector(providerConfig, deps) { … return connector }
```

- `providerConfig` — one entry of `config.providers[id]` (id, label, baseUrl,
  apiKey [secret], timeoutMs, pageSize, maxCap, defaultCap, supportedFields, …).
- `deps` — `{ http, now, sleep, logger, contact, retryLimit }`.
  - `http` = `createHttpClient(...)` → `http.requestJson(url, opts)` /
    `http.requestText(url, opts)`. **Never call `fetch` directly** — all external
    calls go through `http` (timeouts/retries/size-guard/circuit-breaker/redaction).
  - `contact` = `{ tool, email }` for polite-pool identification (Crossref/OpenAlex
    `mailto`, NCBI `tool`/`email`). Send it when the provider asks for it.

## Interface (return object)

```
provider: string

capabilities() => { id, label, platform, requiresCredentials, configured,
                    available, supportsCountPreview, maxResults, supportedFields }

translateQuery(canonical, { override }) => TranslatedQuery
  // Use query/ast.js: normalizeCanonical(), then walk concepts → provider string.
  // Concepts join with AND; a concept's terms join with concept.op (default OR).
  // Return makeTranslated({ provider, version, query, supported, unsupported,
  //   modified, warnings, assumptions, hasOverride }). NEVER silently drop an
  //   unsupported field/operator — push a warning. If `override` (non-empty
  //   string) is given, use it verbatim as the query and set hasOverride.

validateQuery(canonical) => { ok, errors[], warnings[] }   // usually validateCanonical()

previewCount(translated, { signal }) => { count|null, kind, at }
  // kind: 'exact' | 'estimate' | 'unavailable' | 'unsupported'. Never throw —
  // return { count:null, kind:'unavailable' } on failure.

search(translated, cursor|null, { signal, pageSize, capRemaining }) =>
  { records: RawItem[], nextCursor: string|null, total: number|null, rateLimit }
  // cursor is a STRING you own (JSON-encode page state). null = first page.
  // nextCursor=null => exhausted. Throw a typed PecanError on a hard failure;
  // the worker decides retry vs partial via err.retryable.

normalize(rawItem) => NormalizedRecord
  // normalizeRecord(partial, { provider, version: NORMALIZATION_VERSION }) then
  // set providerRecordId (stable id: provider id, DOI, NCT, or contentHashId(rec)).
  // Attach `raw` (a small safe snapshot) for provenance.
```

## Hard rules

1. **Zero new dependencies.** Parse JSON natively; if a provider returns XML, write
   a small pure parser (see `pubmedXml.js`) — do not add a parser package.
2. **Server-side keys only.** Read the key from `providerConfig.apiKey`; never log
   it (the http client redacts URL params, but don't echo it into errors either).
3. **Politeness.** Use `throttle.makeThrottle(intervalMs, { now, sleep })` for
   per-provider start-spacing and send the contact `mailto`/`tool` when documented.
4. **Pagination cap.** Respect `providerConfig.maxResults` and `capRemaining`; never
   page past the provider's documented ceiling.
5. **Determinism.** All behavior must be testable with an injected mock `fetch` +
   fixed clock — no real network in CI. Provide JSON/text fixtures.
6. **Verify the live docs** before implementing (esearch params, cursor tokens,
   field names). Note the review date in the file header.

## Registration (done by the integrator)

Add `import { createXConnector } from './x.js'` + `x: createXConnector` to
`CONNECTOR_FACTORIES` in `registry.js`. If the provider has an optional key, add its
env var to `PROVIDER_REGISTRY[x].keyEnv` in `config.js`.

## Tests

Add `tests/unit/pecanSearch/<provider>.test.js` using the shared harness
`tests/unit/pecanSearch/_harness.js` (`makeMock`, `fixedDeps`) plus provider
fixtures. Cover: translate (incl. an unsupported-field warning), validate-empty,
previewCount, one-page, multi-page cursor, empty result, malformed page tolerance,
429/500 classification, normalization + raw provenance.
