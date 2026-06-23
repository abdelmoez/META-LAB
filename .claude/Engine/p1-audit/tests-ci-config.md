# P1 Pecan Search Engine — Audit: Tests, CI & Config/Env Conventions

Read-only architecture map for the implementer. All paths absolute-relative to repo root `H:/META-LAB/META-LAB`.

---

## 1. Test runner & config

- **Runner:** Vitest 2.1.8 (root `devDependencies`, `package.json:38`). ESM project (`"type":"module"`).
- **Config:** `vitest.config.js` (root). Only two knobs:
  - `esbuild.jsx:'automatic'` (so `.jsx` unit tests can render real components without importing React).
  - `test.testTimeout:15000`, `test.hookTimeout:30000` (integration tests do real bcrypt cost-12 + HTTP round-trips).
  - **No `setupFiles`, no `globals`, no `environment` override (defaults to node), no coverage block, no `include`/`exclude` globs.** Tests import `{ describe, it, expect, beforeAll, vi }` explicitly from `'vitest'`. Test selection is purely by the path args in npm scripts.
- **vite.config.js** has NO `test` block (config lives only in vitest.config.js). It does proxy `/api` → `127.0.0.1:3001` in dev.

## 2. npm test scripts (`package.json:13-17`)

```
test                          → vitest run                              (whole tree)
test:unit                     → vitest run tests/unit
test:integration              → vitest run tests/integration
test:ci                       → vitest run tests/unit tests/screening/unit   ← THE HERMETIC GATE
test:search-builder-intelligence → node scripts/search-builder-benchmark.mjs (not vitest)
```

**Critical:** `test:ci` runs ONLY `tests/unit` + `tests/screening/unit`. Integration suites (`tests/integration`, `tests/screening/integration`) are **NOT** in the CI gate because they require a live server. The "1917/2032 green" counts in MEMORY refer to the hermetic unit gate.

## 3. Test directory layout

```
tests/
  unit/              121 *.test.js(x)  — pure, server-free, deterministic   [CI]
    institutions/    (subdir)
    screening/       (subdir of unit)
    security/        cors-cookies.test.js, cors-origin.test.js
  integration/        33 *.test.js     — LIVE server on :3001              [NOT CI]
  screening/
    unit/             7 *.test.js                                          [CI]
    integration/     16 *.test.js     — LIVE server on :3001              [NOT CI]
  e2e/               (Playwright)
  fixtures/
    import/          sample.ciw, sample.csv
    meta/            canonical.js
  report.md
```
- **File count:** 177 `*.test.js(x)` files total. **Approx case count ≈ 2309** `it(`/`test(` occurrences (grep). The hermetic `test:ci` subset is the meaningful "~2032 green" number.

## 4. Integration test pattern (the live-server model)

Representative: `tests/integration/api-auth.test.js`. **There is NO in-process app boot and NO supertest, NO fresh test DB per run.** Pattern:

```js
const API = 'http://localhost:3001/api';
async function serverUp() { try { return (await fetch(`${API}/health`)).ok; } catch { return false; } }
let up = false;
beforeAll(async () => { up = await serverUp(); });
it('...', async () => { if (!up) return; /* fetch + assert */ });
```

- Every test body opens with `if (!up) return;` so the suite **passes vacuously when the server is down** (this is why integration isn't in CI — green ≠ exercised). Confirmed across all 36 integration files (grep `serverUp`/`localhost:3001`).
- Auth is exercised by hitting real `/api/auth/register|login` and threading the raw `set-cookie` header back as `Cookie:`. Helper `registerAndLogin(email,pw)` tries login-then-register (idempotent across re-runs). Uniqueness via `${Date.now()}` email suffixes (no teardown — rows accumulate in the shared dev DB).
- `grep new PrismaClient tests/` → only **`tests/integration/db-migration-roundtrip.test.js`** constructs Prisma clients directly.

## 5. In-process Prisma DB test pattern (the ONE example)

`tests/integration/db-migration-roundtrip.test.js` is the only test that builds real Prisma DBs in-process:
- `require('@prisma/client')` via `createRequire` rooted at `server/db/client.js`; reads `Prisma.dmmf.datamodel.models`.
- `pushSchema(url)` = `execSync('npx prisma db push --schema=… --skip-generate --force-reset', { env:{...process.env, DATABASE_URL:url} })` against two temp SQLite files `server/prisma/.tmp-roundtrip-{src,tgt}.db` (file URLs `file:./.tmp-roundtrip-*.db`).
- `new PrismaClient({ datasources: { db: { url: SRC_URL } } })` — **per-test client with an explicit overridden datasource URL** is the idiom for a fresh isolated DB.
- Header comment notes it's **NOT part of the hermetic CI gate** (shells out to `prisma db push`); run on demand with `npx vitest run tests/integration/db-migration-roundtrip.test.js`.

> Implication for P1: if a connector needs persistence (e.g. a `SearchRun`/`ImportedRecord` table), the deterministic CI test should test the **pure mapping/dedup/provenance logic against fixtures**, and any real-DB write-path test goes in `tests/integration/` as a live-server or on-demand `db push --force-reset` test — NOT in `test:ci`.

## 6. Connector / external-API test conventions (THE P1 TEMPLATE)

The repo has an established, **CI-safe, no-live-network** pattern for HTTP connectors. P1 should copy it verbatim.

### 6a. Best template — `server/services/oaPdfResolver.js` (+ `tests/unit/oaPdfResolver.test.js`)
- **Dependency-injected `fetch` + `now`:** `createOaResolver(cfg, deps = {})` where `deps = { fetch, now }`. Provider fns are `fromUnpaywall(doi,cfg,fetch)`, `fromOpenAlex(...)`, `fromCrossRef(...)` — each returns `{provider,url,license}|null`.
- **Config reader:** `loadOaConfig(env = process.env, settings = {})` returns a plain config object; truthy-coerces flags; env keys defaulted. Exported constants `OA_STATUS`, `OA_PROVIDERS = ['unpaywall','openalex','crossref']`.
- **Test (oaPdfResolver.test.js):** header says *"Fully mocked: an injected fetch + fixed clock → NO live network in CI."* A `mockFetch(routes)` helper builds a `vi.fn(async url => …)` from a URL-substring → body map (`Error` value throws, `'__404__'` → 404, else `{ok:true,json:async()=>body}`); `const fixedNow = () => 1_000_000`. Then `createOaResolver(baseCfg, { fetch, now: fixedNow })`. This file lives in `tests/unit/` → it IS in the CI gate.

### 6b. PURE-mapper pattern — `server/searchEngine/nlmClient.js` (+ `tests/unit/searchEngine.test.js`)
- Network fns (`meshLookup`, `meshSuggest`, `pubmedCount`, `meshNarrower`) call a private `nlmFetch(url, slot)` that uses **global `fetch`** (not injected) and **degrade gracefully — return `null`/`[]` on ANY failure, never throw**.
- The **transform logic is split into exported PURE functions** that take already-parsed JSON: `mapMeshSummary(rec)`, `mapMeshSummaryList(result,uids,cap)`, `emtreeFallback(mesh)`, `parseSparqlLabels(json)`. `tests/unit/searchEngine.test.js` tests ONLY these pure fns with literal fixture objects — header: *"The network paths are covered by the skip-aware integration suite + live verification."*
- Rate-throttle idiom worth reusing: `makeThrottle(intervalFn)` (per-host start-spacing gate); env-aware `minIntervalMs` (key→110ms, no-key→350ms). TTL/LRU via `server/searchEngine/ttlCache.js` `createTtlCache({ttlMs,max})`.
- The live integration counterpart uses the same `serverUp()` skip pattern (e.g. `tests/screening/integration/oa-fulltext.test.js` — "Requires the server on 127.0.0.1:3001; skips" when down).

### 6c. Fixture conventions
- Inline string/object fixtures defined as top-of-file `const` in the test (RIS/PubMed/WoS blocks in `tests/unit/importParsers.test.js`; MeSH `result` objects in `searchEngine.test.js`).
- File fixtures under `tests/fixtures/<area>/` (`import/sample.csv`, `import/sample.ciw`, `meta/canonical.js`). For P1, add `tests/fixtures/search/<provider>/` (captured-then-trimmed API JSON responses) and `tests/fixtures/import/` rows.
- Import parsers (`src/research-engine/import-export/parsers.js`) export `detectAndParse`, `detectFormat`, `parseCSV`, `parseTXT`, `PARSER_REGISTRY`, `SUPPORTED_IMPORT_FORMATS` — pure, BOM-safe (`stripBom`), already unit-tested. **Reuse for P1 auto-import normalization rather than re-parsing.**

## 7. The single Prisma client + provider selection

`server/db/client.js`:
- `export const prisma` — singleton; default `@prisma/client` (SQLite). When `DATABASE_PROVIDER ∈ {postgres,postgresql}`, lazily `require('../prisma/generated/postgres-client').PrismaClient`. **No call-site changes** to swap providers — every `import { prisma } from '../db/client.js'` keeps working.
- `globalThis.__prisma` cache reused unless `NODE_ENV==='production'`.
- Schema: `server/prisma/schema.prisma`; generated clients `server/prisma/generated/`; migrate tooling `server/db/migrate/core.js` (`migrateAll`,`verifyAll`); PG schema dir `server/prisma/postgres/`; isolated waitlist client `server/waitlist/` + `server/prisma/waitlist/schema.prisma`.
- Server scripts (`server/package.json:6-11`): `db:generate:postgres`, `db:push:postgres`, `db:migrate:postgres`, `db:verify:postgres`, `db:sync-postgres-schema`.

## 8. Config/env module conventions (server side)

Central config modules live in `server/config/`:
- **`validateConfig.js`** — `validateConfig({env=process.env})` → `{ok,errors,warnings,isProd}` (PURE, unit-testable: `tests/unit/...validateConfig.test.js`). `runStartupConfigCheck()` logs + `process.exit(1)` in production on any critical error. `critical(msg)` pushes to errors in prod / warnings in dev. **NEVER logs secret values — only which key is missing/insecure.** Currently validates `JWT_SECRET` (≥16 chars, placeholder check), `DATABASE_URL`, `DATABASE_PROVIDER`/`POSTGRES_DATABASE_URL`, CORS/`APP_BASE_URL` (no wildcard, https in prod), SMTP/EMAIL_FROM pairing. **→ P1 should ADD provider-key checks here** (e.g. warn if a provider is `*_ENABLED=true` but its key/mailto is unset — as a WARNING, not a prod-fatal error, mirroring how email is treated).
- **`cookies.js`** — `sessionCookieName()` (`'metalab_session'`, internal name preserved across rebrand), `sessionCookieOptions()` / `clearSessionCookieOptions()` (`httpOnly`, `sameSite:'strict'`, `secure: NODE_ENV==='production'`, `path:'/'`). Not P1-relevant beyond reuse if P1 adds endpoints.
- **`cors.js`** — `resolveCorsOrigin(env)`, `resolveCorsAllowlist(env)`, `corsOriginDelegate(env)` (allowlist echo, never `*`). Env-driven; tested in `tests/unit/security/cors-*.test.js`.

### Env-reading idiom
- Each service reads `process.env.X` lazily via small closures, with defaults, NEVER a global config object. Examples: `nlmClient.js` `const apiKey = () => process.env.NCBI_API_KEY || ''`; `loadOaConfig(env=process.env,...)`. **Always pass `env` as a defaulted param so the reader is unit-testable** (`validateConfig`, `loadOaConfig`, `resolveCors*` all do this).
- Env loaded by `server/load-env.js` (resolved relative to `server/.env`) before any Prisma/JWT module initialises. Frontend build env is the SEPARATE root `.env` (only `VITE_`-prefixed vars reach the client; `APP_BASE_URL` shared).
- **No secret is ever exposed to the browser.** Provider keys are server-side only — the browser calls `/api/...`, the server proxies the external API (the explicit nlmClient/oaPdfResolver model).

### Existing provider-key naming convention (`server/.env.example`)
Per-provider triad/quad, all OPTIONAL with graceful fallback:
```
<PROVIDER>_ENABLED      (truthy: true|1)            e.g. OPENALEX_ENABLED, ROR_ENABLED
<PROVIDER>_API_BASE     (override base URL)          e.g. OPENALEX_API_BASE, ROR_API_BASE
<PROVIDER>_API_KEY      (secret, server-only)        e.g. NCBI_API_KEY, AI_EMBEDDING_API_KEY
<PROVIDER>_MAILTO /_EMAIL (polite contact)           e.g. OPENALEX_MAILTO, UNPAYWALL_EMAIL, NCBI_EMAIL
<PROVIDER>_TIMEOUT_MS   (per-request, default ~5000) e.g. NCBI_TIMEOUT_MS, OPENALEX_TIMEOUT_MS
NCBI_TOOL               (tool identity, default 'metalab')
```
Also: `OA_PDF_RETRIEVAL_ENABLED`, `OA_PDF_CACHE_TTL_HOURS`, `OA_PDF_RATE_LIMIT_PER_MINUTE`. Runtime operational policy (enable/quotas/thresholds) is preferentially stored in a **`SiteSetting`** (e.g. `aiScreeningSettings`, OA settings via `loadOaConfig(env, settings)`), NOT env, so toggles need no redeploy. **P1 follows the same split: secrets/base-URLs in env; user-tunable policy in a SiteSetting + Ops tab.**

---

## 9. How P1 should add tests (recommendation)

**Deterministic, no live external calls in CI:**

1. **Unit (in `tests/unit/`, runs in `test:ci`):**
   - Put all parse/normalize/dedup/provenance/PRISMA-S logic in **PURE exported functions** (mirror `mapMeshSummary`/`parseSparqlLabels`). Test with literal fixture objects + `tests/fixtures/search/<provider>/*.json` captured responses (trimmed). No `fetch`.
   - For each connector, write `createXConnector(cfg, { fetch, now })` (oaPdfResolver model) and test the full resolve/paginate/error-degrade path with a `vi.fn` `mockFetch(routes)` + `fixedNow`. Cover: success map, 404/empty, thrown network error → graceful null/[], rate-limit/timeout, dedup across providers, provenance fields.
   - `loadP1Config(env=process.env, settings={})` reader → unit test the env defaulting + `*_ENABLED` gating.
   - Reuse `src/research-engine/import-export/parsers.js` for record normalization rather than re-implementing.

2. **Connector-contract (fixture-based, in `tests/unit/`):** assert the connector maps a recorded real API JSON fixture to the exact P1 record contract shape (ids, DOI, provenance, source tag). These are the "contract tests" — they pin the external schema without hitting the network.

3. **Integration (in `tests/integration/`, NOT in `test:ci`):** copy the `serverUp()`+`if(!up)return` live-server pattern for end-to-end `/api/search/*` + auto-import routes; thread the auth cookie via `registerAndLogin`. Any real-DB write-path proof uses the `db push --force-reset` + per-test `new PrismaClient({datasources})` idiom from `db-migration-roundtrip.test.js` and is run on-demand, never gating CI.

4. **Add to `validateConfig.js`:** warnings (not prod-fatal) for `<PROVIDER>_ENABLED` set without required key/mailto. Add the env vars to `server/.env.example` under a new "Pecan Search Engine (P1)" block following the `<PROVIDER>_{ENABLED,API_BASE,API_KEY,MAILTO,TIMEOUT_MS}` convention.

**Gotchas / risks:**
- Integration green is **misleading** — bodies no-op when the server is down, so a P1 integration suite proves nothing in CI. All real P1 coverage MUST be unit/contract in `test:ci`.
- `nlmClient` uses **global `fetch`** (not injected) — harder to test; prefer the `oaPdfResolver` **injected-fetch** style for every P1 connector so CI is hermetic.
- No `setupFiles` / global mocks — each test wires its own `vi.fn` fetch; there is no global network kill-switch, so a connector that calls real `fetch` at import time or in a pure path would silently make live calls. Keep network strictly behind injected `fetch`.
- Shared dev SQLite has no per-test teardown; live tests rely on `Date.now()` uniqueness. Don't assume a clean DB.
- Secrets must never reach the client bundle (only `VITE_`-prefixed root env vars are exposed); keep all P1 provider keys server-side and proxy via `/api`.
- `db-migration-roundtrip` and similar `db push`-shelling tests must stay OUT of `test:ci` (they need `npx prisma`).
