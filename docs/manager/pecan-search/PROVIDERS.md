# Pecan Search Engine — Provider Setup (P1)

This document covers every provider connector: required configuration, the optional
API key and the exact environment-variable names, rate-limit etiquette, how to test the
connection, how a failure is surfaced, and how to disable a provider.

> **No real secrets ever go in this document, in a `SiteSetting`, or in the browser.**
> API keys are read from server-side environment variables only. The browser receives a
> boolean (`configured` / `hasKey`), never the value (`config.publicProviderConfig`).

---

## 1. How configuration works (two sources, strictly separated)

`server/pecanSearch/config.js → loadPecanConfig(env, settings)` merges, in order:

```
PROVIDER_REGISTRY defaults  <  ENVIRONMENT (secrets + base URLs + contact)  <  admin policy
```

1. **Environment (server-side only)** — secrets, base URLs, contact identity. Per-provider
   convention:
   - `<PROVIDER>_API_BASE` — override the default base URL.
   - `<PROVIDER>_TIMEOUT_MS` — per-request timeout for this provider.
   - `<PROVIDER>_API_KEY` — the secret key, **only** for providers whose registry entry
     names a `keyEnv` (PubMed → `NCBI_API_KEY`, Semantic Scholar → `S2_API_KEY`).
   - Shared, cross-provider:
     - `PECAN_SEARCH_CONTACT_EMAIL` — polite-pool contact email (falls back to
       `NCBI_EMAIL` / `CROSSREF_MAILTO`). Sent to NCBI / Crossref / OpenAlex / Europe PMC.
     - `PECAN_SEARCH_TOOL` — tool name for NCBI `tool=` (falls back to `NCBI_TOOL`,
       default `pecanrev`).
     - `PECAN_SEARCH_TIMEOUT_MS` — engine default request timeout (default 20000).
     - `PECAN_SEARCH_INSTITUTIONAL_MODE` — when `true`, a provider is OFF unless
       explicitly enabled in the admin policy (opt-in allowlist).
   - The `<PROVIDER>` token is the **uppercased provider id**: `PUBMED`, `EUROPEPMC`,
     `CLINICALTRIALS`, `CROSSREF`, `DOAJ`, `OPENALEX`, `SEMANTICSCHOLAR`. So e.g.
     `OPENALEX_API_BASE`, `CROSSREF_TIMEOUT_MS`.

2. **Admin policy — the `searchProviderSettings` SiteSetting (NON-secret)** — edited in
   Ops › Search Providers (`adminController.js`): per-provider `enabled`, `defaultCap`,
   `maxCap`, `timeoutMs`, plus engine-wide `defaultResultCap`, `maxResultCap`,
   `concurrency`, `retryLimit`, `requestTimeoutMs`, `previewThrottleMs`, `pageDelayMs`,
   `institutionalMode`. Never contains a key.

A provider is **`available` = `enabled && configured`**. `configured` is `true` unless
the registry marks `requiresCredentials: true` and no key is present. (Today **no**
provider sets `requiresCredentials`, so all keys are *optional* and only raise rate
limits.) A provider is **selectable** in the UI only when `available && implemented`
(has a connector in `CONNECTOR_FACTORIES`).

The registry (`config.js → PROVIDER_REGISTRY`) sets each provider's `maxResults` ceiling
(the per-search hard cap; the engine never pages past it).

---

## 2. Per-provider reference

Each connector verifies the live provider docs and records the review date in its file
header. All connectors go through the shared hardened HTTP client (`httpClient.js`) and
the per-provider start-spacing throttle (`throttle.js`).

### PubMed — `connectors/pubmed.js`
- **Platform:** NCBI E-utilities (`esearch` + `efetch`, history-server WebEnv paging).
- **Base URL:** `https://eutils.ncbi.nlm.nih.gov/entrez/eutils` (override `PUBMED_API_BASE`).
- **Required config:** none. Works key-less.
- **Optional API key:** `NCBI_API_KEY` (registry `keyEnv`). Sent as the `api_key` query
  param **server-side only** (the HTTP client redacts it in logs). Raises the rate limit.
- **ENV vars:** `NCBI_API_KEY`, `PUBMED_API_BASE`, `PUBMED_TIMEOUT_MS`,
  `PECAN_SEARCH_CONTACT_EMAIL` (sent as `email`), `PECAN_SEARCH_TOOL` (sent as `tool`).
- **Rate limit:** NCBI etiquette — ~3 req/s without a key, ~10 req/s with one. The
  connector start-spaces at 360 ms (no key) / 120 ms (key) via `makeThrottle`.
- **Count preview:** exact (`esearch rettype=count`).
- **Max results:** 10000 (`maxResults`).

### Europe PMC — `connectors/europepmc.js`
- **Platform:** EBI REST (`/search`, `cursorMark` paging, `resultType=core`).
- **Base URL:** `https://www.ebi.ac.uk/europepmc/webservices/rest` (override `EUROPEPMC_API_BASE`).
- **Required config:** none. No key.
- **Optional API key:** none (registry `keyEnv: ''`).
- **ENV vars:** `EUROPEPMC_API_BASE`, `EUROPEPMC_TIMEOUT_MS`, `PECAN_SEARCH_CONTACT_EMAIL`
  (sent as the `&email` contact param; Europe PMC asks tools to identify).
- **Rate limit:** polite throttle via the per-provider spacer; Retry-After + backoff
  handled by the HTTP client.
- **Count preview:** exact (`hitCount`).
- **Notes:** Lucene-like grammar (`TITLE:`, `ABSTRACT:`, `AUTH:`, `DOI:`, `JOURNAL:`,
  `KW:`, PMID via `EXT_ID:"…" AND SRC:MED`). MeSH has no native field tag → rendered
  best-effort with a warning.

### ClinicalTrials.gov — `connectors/clinicaltrials.js`
- **Platform:** CTG API v2 (`/studies`, forward-only `nextPageToken` paging, Essie grammar).
- **Base URL:** `https://clinicaltrials.gov/api/v2` (override `CLINICALTRIALS_API_BASE`).
- **Required config:** none. No key, no `mailto` param (CTG v2 documents neither).
- **Optional API key:** none.
- **ENV vars:** `CLINICALTRIALS_API_BASE`, `CLINICALTRIALS_TIMEOUT_MS`.
- **Rate limit:** polite throttle + HTTP-client backoff.
- **Count preview:** exact (`countTotal=true → totalCount`).
- **Notes:** not a field-Boolean bibliographic DB — field tags (mesh/journal/doi/pmid/
  author) are approximated as free text **with a warning**; trial records carry no
  authors and usually no DOI/PMID by design.

### Crossref — `connectors/crossref.js`
- **Platform:** Crossref REST (`/works`, `cursor=*` deep paging, DISMAX relevance).
- **Base URL:** `https://api.crossref.org` (override `CROSSREF_API_BASE`).
- **Required config:** none.
- **Optional API key:** none, but a **contact email is strongly recommended** — it puts
  PecanRev in Crossref's faster, more reliable *polite pool* (`&mailto=`).
- **ENV vars:** `CROSSREF_API_BASE`, `CROSSREF_TIMEOUT_MS`,
  `PECAN_SEARCH_CONTACT_EMAIL` (or legacy `CROSSREF_MAILTO`) → sent as `&mailto`.
- **Rate limit:** polite-pool spacing; `rows` max 1000/request.
- **Count preview:** exact (`message.total-results`).
- **Notes:** `query.*` params *rank* by similarity, they do not strictly filter — Boolean
  AND/OR/NOT and per-field restrictions are **approximated and warned**; only date +
  work-type map to exact `filter=` constraints.

### DOAJ — `connectors/doaj.js`
- **Platform:** DOAJ API v3 (`/search/articles/{query}`, page-based, Elasticsearch
  `query_string`).
- **Base URL:** `https://doaj.org/api/v3` (override `DOAJ_API_BASE`).
- **Required config:** none. No key.
- **Optional API key:** none.
- **ENV vars:** `DOAJ_API_BASE`, `DOAJ_TIMEOUT_MS`.
- **Rate limit:** polite throttle + HTTP-client backoff.
- **Count preview:** exact (`total`).
- **Hard limits:** the API **refuses any offset ≥ 1000 records** (HTTP 400) — the
  connector caps pagination at 1000 regardless of `maxCap` and warns. Wildcard/regex
  `query_string` features are disabled server-side → truncation is dropped with a
  warning. Journal-article only (no preprints/trials).

### OpenAlex — `connectors/openalex.js`
- **Platform:** OpenAlex REST (`/works`, opaque `cursor` paging, analyzed `.search`).
- **Base URL:** `https://api.openalex.org` (override `OPENALEX_API_BASE`).
- **Required config:** none.
- **Optional API key:** none, but a **contact email is recommended** — the polite pool
  (`&mailto=`) is faster and more reliable.
- **ENV vars:** `OPENALEX_API_BASE`, `OPENALEX_TIMEOUT_MS`,
  `PECAN_SEARCH_CONTACT_EMAIL` → sent as `&mailto` on every call.
- **Rate limit:** polite-pool spacing; `per-page` max 200.
- **Count preview:** exact (`meta.count`).
- **Notes:** each concept becomes one `title_and_abstract.search` filter; per-field tags
  collapse to title+abstract, intra-concept AND inside one search value and MeSH/
  truncation are unsupported → **warned**. Abstracts arrive as an inverted index and are
  reconstructed.

### Semantic Scholar — `connectors/semanticscholar.js`
- **Platform:** S2 Academic Graph API (`/paper/search/bulk`, token paging).
- **Base URL:** `https://api.semanticscholar.org/graph/v1` (override `SEMANTICSCHOLAR_API_BASE`).
- **Required config:** none. Works key-less.
- **Optional API key:** `S2_API_KEY` (registry `keyEnv`). Sent as the **`x-api-key`
  header** (never in the URL, never logged — the HTTP client redacts that header).
  Raises the per-second limit.
- **ENV vars:** `S2_API_KEY`, `SEMANTICSCHOLAR_API_BASE`, `SEMANTICSCHOLAR_TIMEOUT_MS`.
- **Rate limit:** S2 rate-limits aggressively; the connector leans on the HTTP client's
  429 Retry-After + exponential backoff. A key materially helps.
- **Count preview:** **estimate** (`total` is an estimate of corpus matches → `kind:
  'estimate'`).
- **Notes:** bulk search matches TITLE+ABSTRACT only; field-restricted search
  (title-only/author/journal) and language filters are unsupported → included as keyword
  + **warned**.

---

## 3. How to test a provider connection

1. **Ops health view** — Ops › Search Providers (`GET /api/admin/search-providers`,
   `adminController.getSearchProviders`) lists every provider with `implemented`,
   `enabled`, `configured`, `available`, plus the live queue/worker health. This is the
   fastest "is it wired up?" check.
2. **Provider catalogue endpoint** — `GET /api/pecan-search/providers`
   (`getProviders`) returns each provider's public capabilities + `implemented` /
   `selectable`. (Requires the `pecanSearch` flag ON + auth.)
3. **Count preview = a live round-trip** — in a project, build a query and request a
   count preview (`POST /api/pecan-search/projects/:projectId/preview-count`). A returned
   `{ count, kind:'exact'|'estimate' }` proves the base URL, key (if any), and grammar
   translation all work end-to-end. `{ count:null, kind:'unavailable' }` means the live
   call failed (network/quota/disabled).
4. **Translate (no network)** — `POST …/translate` shows the exact provider query string
   + warnings without calling the provider; use it to verify grammar mapping in isolation.
5. **A tiny real run** — start a run against the one provider with a small per-source cap;
   watch the source `stage` advance and the counts populate.

---

## 4. How a failure is presented

Failures are typed (`errors.js → PecanError` / `ERROR_CODES`) so the surface is uniform:

- **User-safe surface only** reaches the browser: `{ error: userMessage, code, retryable }`.
  Secrets, raw provider bodies, and internals never leave the server.
- **Per source**, the failure is stored on `PecanSearchSource.errorClass` (e.g.
  `PROVIDER_RATE_LIMITED`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`,
  `PROVIDER_MALFORMED_RESPONSE`, `RESPONSE_TOO_LARGE`) + a sanitized `errorDetail`.
- **Retryable vs terminal:** transient codes (429 / 5xx / timeout / network) → the source
  is marked `partial` and can be retried (resuming from its cursor); non-retryable codes
  (bad query, response too large) → `failed`. The run state is the honest aggregate
  (`partial` if some sources succeeded).
- **One bad record never kills a page or a run** — a record that fails to normalize is
  counted in `failedRecordCount` and skipped.
- A provider that is disabled/unconfigured at run time is `skipped`
  (`errorClass: PROVIDER_DISABLED`), not failed.
- The report (`OPERATIONS.md`, `USER_GUIDE.md`) and Ops view surface
  `recentFailedSources` with the sanitized class + detail.

---

## 5. How to disable a provider

- **Per provider (admin, recommended):** Ops › Search Providers — set the provider's
  `enabled: false` in the `searchProviderSettings` policy
  (`adminController.updateSearchProviders`, validated + audited). It immediately becomes
  `available: false`, drops out of the selectable set, and any in-flight run marks it
  `skipped` at run time. No deploy needed.
- **Institutional allowlist mode:** set `PECAN_SEARCH_INSTITUTIONAL_MODE=true` (or
  `institutionalMode: true` in the policy) → every provider defaults to OFF and only the
  ones explicitly `enabled` in the policy run. Use this for licensed/restricted
  deployments.
- **Whole engine:** turn the `pecanSearch` feature flag OFF (Ops › Feature Flags) → all
  P1 endpoints 404 and the UI is gated off. The tables remain (additive); no data loss.
- **Remove a connector entirely (code):** remove its entry from `CONNECTOR_FACTORIES`
  in `connectors/registry.js` → it reports `implemented: false` and is never selectable
  (rarely needed — disabling via policy is preferred).

---

## See also
- `OPERATIONS.md` — secret rotation, quota adjustment, outage handling.
- `ARCHITECTURE.md` §2 (connector interface), §9 (security boundaries).
- Source: `server/pecanSearch/config.js`, `connectors/*.js`, `CONTRACT.md`.
