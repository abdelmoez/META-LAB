# Full-Text OA Providers (68.md P9)

The provider chain lives in `server/fullText/providers.js`. Each provider is an
async `lookup(record, ctx)` returning a normalized outcome:

```
{ provider, status, pdfUrl?, landingUrl?, oaStatus?, license?, version?, payload?, reason? }
```

`status ∈ 'found' | 'no_oa' | 'not_found' | 'failed'`.

**Legal safety (non-negotiable).** A provider only ever returns a URL the OA API
itself hands us. We never scrape a publisher, guess a PDF URL, or bypass a
paywall. See `docs/full-text-privacy-and-licensing.md`.

**Robustness.** Every provider is wrapped by `safe()` so it can never throw out — a
network error, timeout, or malformed payload degrades to `status: 'failed'` with a
short `reason`. Each does one JSON fetch with a **15s timeout** (`FT_TIMEOUT_MS`)
and **one retry** (`FT_RETRY`), and takes an injected `fetch` (`ctx.fetchFn`) so it
is unit-testable against mocked fixtures. A `404` is treated as `not_found`, not an
error.

## Priority order

The order is the admin setting `fullTextSettings.providerOrder`
(`server/fullText/fullTextService.js`), default:

```
['unpaywall', 'europepmc', 'openalex', 'clinicaltrials']
```

`resolveProviderChain(order)` keeps only known ids, in the caller's order; the
order is **authoritative** (unlisted known providers are NOT appended). The worker
runs the chain in order and **stops at the first `found` outcome that carries a
`pdfUrl`**. `coerceFullTextSettings` (Ops PUT) dedupes and drops unknown provider
ids, falling back to the default order if the result would be empty.

## Polite-pool email

Providers that require or benefit from a contact email resolve it from a fallback
chain (`resolveEmail`): `ctx.email` → `UNPAYWALL_EMAIL` →
`PECAN_SEARCH_CONTACT_EMAIL` → `NCBI_EMAIL`. The automated worker passes no
explicit email, so it uses this env chain.

## unpaywall

| | |
|---|---|
| **Endpoint** | `GET {UNPAYWALL_API_BASE|https://api.unpaywall.org/v2}/{doi}?email={email}` |
| **Identifiers** | DOI (normalized) |
| **Env** | `UNPAYWALL_EMAIL` (required — no email → `status: 'failed'`, reason "no email configured"); `UNPAYWALL_API_BASE` (optional override) |
| **PDF** | `best_oa_location.url_for_pdf`; landing `url_for_landing_page`/`url` |
| **Semantics** | no DOI → `not_found`; DOI unknown (404) → `not_found`; `!is_oa` or no `best_oa_location` → `no_oa`; PDF present → `found` (`oaStatus` from `oa_status`, else `gold`); landing-only → `found` with `landingUrl`, no `pdfUrl` |
| **License/version** | `best.license`, `best.version` recorded |

## europepmc

| | |
|---|---|
| **Endpoint** | `GET {EUROPEPMC_API_BASE|.../europepmc/webservices/rest}/search?query=...&resultType=core&format=json&pageSize=1` |
| **Identifiers** | PMID (preferred, `EXT_ID:{pmid} AND SRC:MED`) else DOI (`DOI:{doi}`) |
| **Env** | `EUROPEPMC_API_BASE` (optional override); no email required |
| **PDF** | first `fullTextUrlList.fullTextUrl[]` with `documentStyle: 'pdf'` |
| **Semantics** | no PMID/DOI → `not_found`; no matching record → `not_found`; PDF url → `found` (`version: 'publishedVersion'`); OA HTML only → `found` landing; else → `no_oa` |
| **payload** | `pmcid`, `source` |

## openalex

| | |
|---|---|
| **Endpoint** | `GET {OPENALEX_API_BASE|https://api.openalex.org}/works/doi:{doi}?select=open_access,best_oa_location[&mailto=]` |
| **Identifiers** | DOI |
| **Env** | `OPENALEX_API_BASE` (optional); email (from the chain) sent as `mailto` when present, optional |
| **PDF** | `best_oa_location.pdf_url`; landing `landing_page_url` |
| **Semantics** | no DOI → `not_found`; DOI unknown (404) → `not_found`; `!open_access.is_oa` or no `best_oa_location` → `no_oa`; PDF → `found` (`oaStatus` from `oa_status`, else `gold`); landing-only → `found` landing |
| **License/version** | `best.license`, `best.version` recorded |

## clinicaltrials — REGISTRY, never a journal PDF

| | |
|---|---|
| **Endpoint** | `GET {CLINICALTRIALS_API_BASE|https://clinicaltrials.gov/api/v2}/studies/{nctId}?format=json` |
| **Identifiers** | NCT id, scanned from `rawData`/`doi`/`sourceDb`/`url`/`pmid` (`extractNctId`) |
| **Env** | `CLINICALTRIALS_API_BASE` (optional override) |
| **Result** | a **registry landing page** `https://clinicaltrials.gov/study/{nct}` with **`version: 'registry'` and NO `pdfUrl`** |
| **Semantics** | no NCT → `not_found`; unknown NCT (404) → `not_found`; no protocol section → `not_found`; otherwise → `found` (landing only) |
| **payload** | `nctId`, `hasResults`, and a listed large-document URL if the registry provides one (`docUrl`) — still a registry link, never treated as a journal PDF |

**A registry hit is explicitly labeled as a registry** (`version: 'registry'`,
`landingUrl` only). Because the worker only downloads a `pdfUrl`, a
ClinicalTrials.gov result can never be attached as a "full-text PDF" — it surfaces
as a `linkOut`. This is deliberate: a trial registry entry is not a journal
article.

## Failure semantics summary

- `not_found` — the record lacks the identifier this provider needs, or the id is
  unknown to the source. The chain continues to the next provider.
- `no_oa` — the record is known but has no open-access copy. The chain continues.
- `found` — an OA hit; if it carries a `pdfUrl` the worker attempts the download
  and stops on success. Landing-only `found` → `linkOut`.
- `failed` — the provider errored on every attempt (network/timeout/bad payload).
  The chain continues; a record where **every** provider failed is counted
  `failed`.

Every outcome, whatever the status, is written as a `FullTextCandidate` row so the
per-record candidate history is complete.
