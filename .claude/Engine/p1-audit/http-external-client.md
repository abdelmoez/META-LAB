# P1 Audit — HTTP / External-Client Layer

Audit of how the server makes external HTTP calls and handles provider secrets / throttling / caching today, and what a hardened **shared connector HTTP client** for P1 (Pecan Search Engine) must add. READ-ONLY analysis. All paths absolute-relative to repo root `H:/META-LAB/META-LAB/`.

Runtime facts (from `server/package.json`):
- ESM modules (`import`/`export`), Node 18+ (relies on **global `fetch`** + `AbortController`; every client guards `typeof fetch !== 'function'`). No `engines.node` pin.
- Available deps to build on: **`zod@^3.25.76`** (response-schema validation), **`uuid@^11.0.3`** (correlation IDs), **`express-rate-limit@^7.5.0`** (route-level), `helmet`, `express`. No `undici`, `axios`, `got`, `p-retry`, `opossum`, or `bottleneck` — a hardened client must be hand-rolled (consistent with the existing house style) or add a dep.

---

## 1. The five existing external HTTP clients (current inventory)

There is **NO shared fetch wrapper today**. Each client re-implements the same `fetch + AbortController + setTimeout + try/catch → null/[]` skeleton plus its own ad-hoc cache. This duplication is the single biggest reuse opportunity for P1.

| Client | File | Public fns (file:line) | External endpoint(s) | Secret/identity | Cache | Throttle | Timeout | Failure mode |
|---|---|---|---|---|---|---|---|---|
| **NLM E-utilities** (the reference impl) | `server/searchEngine/nlmClient.js` | `meshLookup()` L169, `meshSuggest()` L230, `pubmedCount()` L257, `meshNarrower()` L151, `emtreeFallback()` L86 (pure), `parseSparqlLabels()` L99 (pure), `mapMeshSummary()` L116 (pure), `mapMeshSummaryList()` L206 (pure), `_caches()` L272 | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils` (L17), `https://id.nlm.nih.gov/mesh/sparql` (L18) | `NCBI_API_KEY` injected as `api_key` query param (L72); `tool`/`email` etiquette params (L73-74) | 4× `createTtlCache` (L27-30): mesh 30d, count 1h, narrower 30d, suggest 30d | **per-host slot throttle** `makeThrottle` L37; `eutilsSlot` (key-aware 110/350ms) L50, `meshRdfSlot` (fixed 350ms) L51 | `NCBI_TIMEOUT_MS` default 5000 (L23) | `nlmFetch` L53 returns `null` on any error; never throws |
| **ROR** institutions | `server/services/rorClient.js` | `searchRor()` L96, `mapRorOrganization()` L53 (pure), `ROR_CLIENT_VERSION` L128 | `https://api.ror.org/v2/organizations` (L19) | none (public, no key) | inline `Map` + `getCached`/`setCached` L73-86, TTL 10min, max 500 | none | `ROR_TIMEOUT_MS` default 3500 (L30) | returns `[]` on any error; never throws |
| **OpenAlex** institutions | `server/services/openAlexClient.js` | `searchOpenAlex()` L62, `mapOpenAlexInstitution()` L27 (pure), `OPENALEX_CLIENT_VERSION` L89 | `https://api.openalex.org/institutions` (L16) | `OPENALEX_MAILTO` polite-pool query param (L70) | inline `Map` TTL 10min, max 500 | none | `OPENALEX_TIMEOUT_MS` default 3500 (L23) | returns `[]` on any error |
| **AI embeddings** (hosted, OpenAI-compatible) | `server/services/aiEmbeddingClient.js` | `buildEmbedFn()` L37 → `embed(texts)`, `embeddingModelInfo()` L110, `embeddingHealth()` L120, `_clearEmbeddingCache()` L107 | `AI_EMBEDDING_ENDPOINT` (env, arbitrary) | `AI_EMBEDDING_API_KEY` as `Authorization: Bearer` header (L61) | inline `Map`, full-text key, max 20000 (L14-27) | none (CHUNK=96 batching L13) | `AI_EMBEDDING_TIMEOUT_MS` default 15000 (L44) | **THROWS** on validation failure (caller falls back to lexical); has `maxRetries=1` (L45) + `Promise.race` timeout (L54) + **response-shape validation** (L70-72) |
| **OA PDF resolver** (multi-provider) | `server/services/oaPdfResolver.js` | `createOaResolver()` L117 → `resolve(doi)`, `loadOaConfig()` L39, `OA_STATUS` L27, `OA_PROVIDERS` L36 | Unpaywall / OpenAlex / CrossRef (L73/84/96) | per-call `email`/`mailto` (L132); CrossRef `User-Agent` w/ mailto (L95) | inline `Map`, `cacheTtlMs` from env (L51) | **token-bucket** `makeBucket` L57 (`OA_PDF_RATE_LIMIT_PER_MINUTE` default 30) | **none** (relies on injected fetch — gap) | returns `{status}` enum; never throws |

### Best individual patterns to harvest (each client got one thing right)
- **nlmClient** → per-host start-spacing throttle that serializes only the SLOT, not the response (`makeThrottle` L37-49); key-aware interval (L25); the `undefined`(miss) vs `null`(cached-negative) cache contract.
- **aiEmbeddingClient** → injected `fetch` for tests (L42 `deps.fetch || globalThis.fetch`), `Promise.race` belt-and-suspenders timeout (L54-56, survives a fetch that ignores AbortSignal), retry loop (L76-82), and **response-shape validation** (L70-72), plus a secret-free `*ModelInfo`/`*Health` introspection pair (L110/120).
- **oaPdfResolver** → token-bucket rate limiter (L57-68), provider-priority fallback chain (L142-154), explicit status enum instead of bare null (`OA_STATUS` L27), and fully **injected deps `{fetch, now}`** (L118-119) → zero live network in CI.

---

## 2. The shared cache primitive — `createTtlCache`

`server/searchEngine/ttlCache.js` — `createTtlCache({ ttlMs, max=2000 })` L11. Tiny in-memory **TTL + LRU** (`Map`, recency-refresh on get L19-21, oldest-eviction on set L24-29). Pure except `Date.now()`.

- **Contract that P1 MUST preserve**: `get()` returns `undefined` for miss/expired, but a stored `null` is a **valid cached negative** (header doc L6-9). Callers distinguish `undefined` vs `null`. nlmClient depends on this for "known no-match" terms (e.g. `meshLookup` L179, L195).
- Only consumer outside searchEngine tests is nlmClient. **REUSE this verbatim** for P1 connector caches — don't invent a second cache. (rorClient/openAlexClient/oaPdfResolver each hand-rolled an equivalent inline Map; P1 should standardize on `createTtlCache` and ideally those three should migrate, but that's out of P1 scope.)

---

## 3. Route-level rate limiting & wiring (the integration seam)

`server/index.js`:
- Imports `rateLimit from 'express-rate-limit'` (L11).
- Per-feature limiters declared as module-level consts: `authLimiter` (L96), `contactLimiter` (L105), `inviteLimiter` (L114), `institutionLimiter` (L124, 120/15min prod for typeahead), **`searchEngineLimiter` (L134, 600 req / 15min prod, 2000 dev/test)** (L132-137), `waitlistLimiter` (L146). All use `windowMs: 15*60*1000` and a `NODE_ENV==='production' ? N : big` max.
- **Mount (THE seam)** L281:
  ```js
  app.use('/api/search-builder', requireAuth, searchEngineLimiter, searchEngineRouter);
  ```
- Router `server/routes/searchEngine.js`: `POST /mesh` `/mesh-suggest` `/count` (NLM proxies, auth+flag only) + `GET/PUT /:projectId` (per-project persistence). Each handler **additionally** gates on the `searchEngine` feature flag → 404 when OFF.

Controller `server/searchEngine/searchEngineController.js`:
- `searchEngineEnabled()` L57 reads `SiteSetting key='featureFlags'` JSON → `.searchEngine === true` (default OFF).
- NLM-proxy handlers `postMesh` L69 / `postMeshSuggest` L81 / `postCount` L93 — **degrade-not-500 pattern**: on error log `console.error('[searchEngine] ...')` and return the empty contract value (`null` / `[]` / `{count:null}`), NOT a 500.
- Persistence handlers `getSearch` L114 / `putSearch` L133 use `gate()` L107 (flag + `resolveProjectAccess` from `server/services/workflowState.js`), persist via `patchModuleState`/`getModuleState` (moduleKey `'search'`), audit via `recordWorkflowAudit`, and emit `emitToMetaLabProject(... {type:'search.updated'} ...)` (L176) for live sync.

**P1 integration seam**: P1's search/import endpoints should follow this exact shape — new router under `server/routes/`, new dedicated `*Limiter` const in `index.js` mounted with `requireAuth` + limiter, controller gates on a P1 feature flag via `SiteSetting featureFlags`, and all external provider calls go through the new shared connector client (server-side only; browser never calls providers). Per-project provenance/persistence should reuse `workflowState.js` (`patchModuleState`/`getModuleState`) the way searchEngineController does — that's the established de-monolithized state seam.

---

## 4. Secrets, env config & startup validation

- Provider secrets are read **lazily inside getter fns** (`apiKey()` L20, `tool()` L21, `email()` L22 in nlmClient; `rorEnabled/rorBase/rorTimeoutMs` in rorClient; `buildEmbedFn(env=process.env)` in aiEmbeddingClient) — never captured at module load, so tests can mutate `process.env`. **P1 should keep this lazy-getter convention.**
- Secrets are **server-side only by design** (nlmClient header L1-13: "the browser NEVER calls NLM directly; this is the only place the server-side NCBI API key is used"). The NCBI key is injected as a **query param** (`api_key`) — note this lands in URL logs, so any P1 logging MUST redact query strings.
- `server/config/validateConfig.js` — `validateConfig({env})` L15 returns `{ok, errors, warnings, isProd}`; `runStartupConfigCheck()` L71 logs and `process.exit(1)` in prod on critical miss. **NEVER logs secret VALUES, only which key is missing** (header L8). **P1 should add its provider-key/email checks here** (e.g. warn if a provider is enabled but its key/mailto is unset — mirrors the existing SMTP half-configured warning L58-62). Currently NO provider keys (NCBI/ROR/OPENALEX/UNPAYWALL/CROSSREF) are validated at startup — gap to close for P1.

---

## 5. Logging today (and the gap)

- Only logger is `server/middleware/requestLogger.js` — `requestLogger` L6 logs `method originalUrl → status (ms)` via `console.log`. **No structured logger, no correlation/request id, no provider-call logging, no redaction.**
- Clients log errors with bare `console.error('[searchEngine] ... ', err.message)` (controller L76/88/100) — message only, but **`originalUrl` in requestLogger includes query strings**, so an NCBI `api_key` in a request URL would be logged in plaintext today. P1's sanitized logging must strip query params / `Authorization` / `api_key`.
- There is no per-request correlation id propagated anywhere. `uuid@11` is available to mint one.

---

## 6. What a hardened shared connector HTTP client for P1 must ADD

Build a new module, e.g. `server/searchEngine/connectors/httpClient.js` (or `server/services/httpClient.js`), as a single `createHttpClient({ ... })` factory that all P1 provider connectors call. It should generalize `nlmFetch` (nlmClient L53-67) and fold in the best bits of aiEmbeddingClient + oaPdfResolver. Required additions over the current per-client skeleton:

1. **Timeouts** — REUSE the `AbortController + setTimeout` pattern (nlmClient L56-57) AND the `Promise.race` belt-and-suspenders (aiEmbeddingClient L54-66) so a fetch ignoring the signal still bails. Per-call override + per-provider default.
2. **Max response size** — **NOT present anywhere today** (gap). Stream/guard `Content-Length` and abort the body read past a cap (P1 imports can pull large result pages → memory-safety). Must be added net-new.
3. **Retry-After honoring** — **NOT present** (gap). On `429`/`503`, parse the `Retry-After` header (seconds or HTTP-date) and wait that long (capped) before the next attempt.
4. **Exponential backoff + jitter** — extend aiEmbeddingClient's flat retry loop (L76-82, `maxRetries=1`) into `base * 2^attempt + random jitter`, capped, only on retryable statuses (429/5xx/network), never on 4xx-except-429.
5. **Circuit breaker** — **NOT present** (gap). Per-host failure-count → open state → short-circuit to a fast failure for a cool-down, so a dead provider doesn't exhaust the request budget. Pairs with the per-host throttle map idea from nlmClient L50-51.
6. **Correlation IDs** — mint via `uuid` per inbound request (or per connector call), thread into outbound headers (e.g. `X-Request-Id`) and into every log line. New.
7. **Sanitized logging** — structured log of `{ correlationId, provider, host, method, status, ms, attempt, cacheHit }`. MUST redact: query string (NCBI `api_key`), `Authorization` header, any `*_API_KEY`. New — and also fixes the existing requestLogger URL-leak risk for provider URLs.
8. **Response-schema validation** — adopt the aiEmbeddingClient shape-check idea (L70-72) but **generalize with `zod`** (already a dep): each connector passes a zod schema; invalid responses are rejected as failures (return null / structured error) so downstream never parses a poisoned payload.
9. **Per-host throttle + token bucket** — REUSE `makeThrottle` (nlmClient L37) for start-spacing AND `makeBucket` (oaPdfResolver L57) for per-minute budgets; keyed per provider HOST (NLM's "one throttle PER HOST" comment L32-36 is the right model — eutils and SPARQL have independent budgets).
10. **Caching** — REUSE `createTtlCache` (ttlCache.js) with the `undefined`-miss / `null`-negative contract; inject the cache so connectors choose TTL per call type (P1 will want long TTL for vocab, short for live counts — mirrors nlmClient L27-30).
11. **Graceful degradation** — keep the house rule: external failure returns a structured result (an `OA_STATUS`-style enum, not a bare null) and **never throws to the route**; controllers degrade to the empty contract value rather than 500 (mirror searchEngineController L75-78).
12. **Injected deps `{ fetch, now }`** — mandatory (oaPdfResolver L118-119, aiEmbeddingClient L42) so CI makes zero live calls.

---

## 7. Concrete REUSE vs BUILD for P1

**REUSE as-is (import, do not reimplement):**
- `server/searchEngine/ttlCache.js` → `createTtlCache` (the cache primitive + miss/negative contract).
- `nlmClient.js` `makeThrottle` (L37) and `oaPdfResolver.js` `makeBucket` (L57) as the throttle/bucket building blocks (currently un-exported — P1 should extract them into the shared client).
- `server/config/validateConfig.js` pattern (add P1 provider checks here).
- `workflowState.js` `resolveProjectAccess` / `getModuleState` / `patchModuleState` / `recordWorkflowAudit` for per-project provenance/persistence (the searchEngineController L107-181 is the worked example).
- `express-rate-limit` consts + mount pattern in `index.js` (L134, L281) — add a `pecanSearchLimiter` and mount the new router the same way.
- Feature-flag gate via `SiteSetting key='featureFlags'` (searchEngineController `searchEngineEnabled` L57).

**BUILD new:**
- The shared connector HTTP client factory (§6 items 1-12) — most of #2 (max size), #3 (Retry-After), #5 (circuit breaker), #6 (correlation id), #7 (sanitized/structured logging) are genuinely net-new; the rest is consolidation of existing snippets.
- Per-provider connector modules (PubMed/EuropePMC/etc.) that map raw responses → a normalized record shape (follow the pure `mapMeshSummary` / `mapRorOrganization` exported-pure convention so they're unit-testable without network).
- A structured logger util with redaction (no logging infra exists beyond `requestLogger`).
- P1 routes + controller + dedicated limiter + flag wiring.

---

## 8. Top risks / gotchas

1. **`api_key` in URLs leaks to logs.** NCBI key is a query param (nlmClient L72) and `requestLogger` logs `originalUrl` (full query) L11. Any P1 connector that logs request URLs will leak provider secrets unless query strings are redacted. **Sanitized logging is not optional.**
2. **No max-response-size guard anywhere.** P1 fetches result *pages* (not single records like the current clients) → unbounded body reads can OOM. Must add a size cap + streaming abort.
3. **Cache contract is load-bearing.** `undefined`=miss vs `null`=cached-negative (ttlCache.js L6-9; nlmClient relies on it L179/L195). A P1 connector that treats `null` as "miss" will hammer providers on every known-negative.
4. **In-memory only.** Every cache, throttle, bucket, and (proposed) circuit breaker is per-process `Map` state. With multiple server instances behind a load balancer the rate limits/budgets are **per-instance, not global** — real provider limits (NCBI 10/s with key) can be exceeded N-fold. Document this; a shared store (Redis) is the real fix if P1 scales horizontally. express-rate-limit default store is also in-memory (same caveat).
5. **Throttle must be per-host, not per-client.** nlmClient L32-36 explicitly warns that mixing eutils and SPARQL budgets is wrong. P1 hits many distinct provider hosts — key throttles/breakers by host.
6. **`Promise.race` timeout vs AbortController.** A `fetch` that ignores the abort signal will leak the connection unless the race rejects (aiEmbeddingClient L54-56 does this; plain `nlmFetch` L56-66 relies solely on abort). Use the race form in the shared client.
7. **No startup validation of provider secrets.** A misconfigured/missing NCBI key or polite-pool email silently degrades (no warning). Add to `validateConfig` so misconfig fails loudly (mirrors the SMTP half-config warning L58-62).
8. **`tool`/`email` etiquette params are mandatory politeness** for NCBI/OpenAlex/Unpaywall polite pools (nlmClient L73-74, openAlexClient L70, oaPdfResolver L132). Omitting them risks IP bans, not just throttling. The shared client must always attach the configured identity.
9. **Degrade-not-500 must be preserved end-to-end.** Controllers return the empty contract value on provider failure (searchEngineController L75-103); P1 must not let a provider error become a user-facing 500.
