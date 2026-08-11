# Privacy — AI Providers and Data Egress

PecanRev's screening AI is **self-hosted and lexical by default**. In its default
configuration no record data leaves the server: the relevance model, cold-start prior,
and semantic similarity all run in-process on deterministic lexical features. External
providers are strictly **opt-in** and **additive** — enabling one adds a signal; it
never becomes required, and any provider failure degrades silently to the lexical
baseline.

This document states exactly what leaves the server in each mode, the env vars that
control it, and the audit trail.

---

## 1. Default: nothing leaves the server

With the default settings — embedding provider `lexical`, no citation enrichment, no
hosted extraction — the engine sends **no** record data anywhere. The TF-IDF classifier,
PICO/criteria cold-start prior, and centroid-cosine semantic signal are all computed
in-process. This is the recommended posture for sensitive corpora.

The `hashing` embedding provider is likewise fully in-process (a dependency-free
deterministic hashing embedder) and sends nothing externally.

---

## 2. What leaves the server, by mode

| Mode | Trigger | What is sent | To where |
|------|---------|--------------|----------|
| Lexical (default) | always | *nothing* | — |
| Hashing embeddings | admin selects `hashing` | *nothing* (in-process) | — |
| **Hosted embeddings** | admin selects `hosted` **and** `AI_EMBEDDING_ENDPOINT` + `AI_EMBEDDING_API_KEY` set | **record embedding text** (built from title/abstract/keywords) | the configured `AI_EMBEDDING_ENDPOINT` |
| **Citation enrichment** | leader runs enrichment (66.md P4.3) | **only public identifiers (DOI / PMID)** — no titles, abstracts, or project data | OpenAlex (`OPENALEX_API_BASE`) |
| Extraction assist — `heuristic` (default) | always, when the feature is on | *nothing* (in-process) | — |
| **AI extraction (`aiExtraction`)** | admin enables the flag **and** `ANTHROPIC_API_KEY` is set | **the PDF itself** (base64, ≤20 MB) and/or **pasted article text** (≤24 000 chars) + the extraction field schema | Anthropic (`https://api.anthropic.com/v1/messages`) |
| **Extraction assist — `external`** | admin selects provider `external` **and** `EXTRACTION_LLM_ENDPOINT` + `EXTRACTION_LLM_API_KEY` set | **study title, abstract and supplied text** (≤24 000 chars) + the data-element schema | the configured OpenAI-compatible endpoint |

### 2.1 Hosted embeddings

Only when an admin selects the `hosted` provider **and** the environment is configured
does record text leave the server, sent to the configured OpenAI-compatible embedding
endpoint. The API key is server-side only and never reaches the client. Any failure
(missing env, timeout, malformed response) falls back to the in-process lexical signal;
the engine never scores on a poisoned vector. Embeddings are cached (in-memory LRU +
persistent `EmbeddingCacheEntry`) so unchanged records are not re-sent on re-runs.

### 2.2 Citation enrichment (OpenAlex)

Enrichment sends **only DOIs and PMIDs** to OpenAlex to fetch public citation counts and
reference lists — never titles, abstracts, or any project content. Requests are batched,
rate-limited, and use a polite-pool `mailto` from env. Results are cached globally by
identifier, so a re-run costs no API calls. Citation metadata is optional and additive;
it can only add signal and never gates screening.

### 2.3 Extraction LLM paths (two of them, both off by default)

> **Corrected 113.md §8.** This section used to say there was "no extraction-LLM
> endpoint or API-key env var in the server". That was wrong, and had been for some
> time: there are **two independent external extraction paths**, each with its own
> env vars, feature flag and provider. Both are off by default; neither was disclosed
> here. What follows is what the code actually does.

**Path A — AI extraction (`aiExtraction`).** `POST /api/ai-extract` sends the
**submitted PDF itself**, base64-encoded (decoded size capped at 20 MB), and/or pasted
article text truncated to 24 000 characters, plus a user-supplied focus string (≤2 000
chars) and the extraction field schema, to **Anthropic's Messages API**
(`https://api.anthropic.com/v1/messages`). Model: `AI_EXTRACT_MODEL`, default
`claude-sonnet-5`. Requires the `aiExtraction` feature flag (**default off**, so the
route 404s) *and* `ANTHROPIC_API_KEY` (unset → 503). This is the largest single egress
in the product: it is the whole document, not a summary of it.

**Path B — extraction assist, provider `external`.** The extraction assistant has two
providers: `heuristic` (**the default**, deterministic, in-process, nothing leaves) and
`external`. With `external` selected, `POST …/studies/:id/ai-suggest` sends the study
title, abstract and any supplied text — joined and truncated to 24 000 characters —
plus the data-element schema to the OpenAI-compatible chat-completions endpoint at
`EXTRACTION_LLM_ENDPOINT`. Model: `EXTRACTION_LLM_MODEL`, default `gpt-4o-mini`.
Requires the `extractionAssist` feature flag (**default off**) *and* both the endpoint
and `EXTRACTION_LLM_API_KEY`. Unlike hosted embeddings, a misconfigured `external`
provider **fails loudly (502)** rather than silently falling back — a provider that
quietly stops being used is worse here than an error.

Common to both: the API key is read server-side and never reaches the browser; the
model's output is a **suggestion, not data**. Every mapped field is written as a draft
that marks the study as needing review, only fields that genuinely exist on a study can
be written, enumerated values are validated or dropped into a note, and (path B) a
suggestion whose quoted excerpt does not literally occur in the submitted text is
discarded before anyone sees it. Human validation is enforced in code, not as a setting.

**Honest caveats.**

- **"Default off" is not "off for everyone".** `server/services/featureAccess.js` grants
  accounts with the `admin` role a bypass on all three AI feature flags. An
  administrator can therefore trigger either path while the flag reads OFF, provided
  the corresponding API key is configured. If your posture depends on nothing leaving,
  do not configure the keys — that is the only gate no role bypasses.
- **There is no single master AI kill switch.** `aiScreeningSettings.killSwitch`
  disables the screening engine only. The three feature flags are independent.
- **`server/.env.example` is incomplete for path A** — `ANTHROPIC_API_KEY`,
  `AI_EXTRACT_MODEL` and `AI_EXTRACT_TIMEOUT_MS` are read by the code but not listed
  there. They are documented in §3 below.
- A **legacy browser-side Anthropic client** still exists in
  `src/frontend/services/aiService.js` and is referenced by workspace components. It is
  disabled by a hardcoded `AI_FEATURES_ENABLED = false` and would additionally be
  blocked by the app's CSP (`connect-src 'self'`), so it makes no requests. It is
  recorded here because it ships in the bundle; it should be deleted rather than
  relied on to stay false.

---

## 3. Environment variables

| Var | Purpose | Default / effect when unset |
|-----|---------|-----------------------------|
| `AI_EMBEDDING_ENDPOINT` | Hosted embedding endpoint (OpenAI-compatible `POST {model, input:[…]}`) | unset → hosted embeddings disabled; falls back to lexical |
| `AI_EMBEDDING_API_KEY` | Bearer key for the endpoint (server-side only) | unset → hosted embeddings disabled |
| `AI_EMBEDDING_MODEL` | Embedding model id | `text-embedding-3-small` |
| `AI_EMBEDDING_TIMEOUT_MS` | Per-request timeout | `15000` |
| `OPENALEX_API_BASE` | Citation provider base URL | `https://api.openalex.org` |
| `PECAN_SEARCH_CONTACT_EMAIL` / `NCBI_EMAIL` | Polite-pool `mailto` for OpenAlex | unset → no `mailto` (still works, lower rate) |
| `AI_CITATION_MAX_PER_RUN` | Cap on identifiers fetched per enrichment run | `5000` |
| `ANTHROPIC_API_KEY` | **Path A** key for the Anthropic Messages API (server-side only) | unset → `POST /api/ai-extract` returns 503 |
| `AI_EXTRACT_MODEL` | **Path A** model id | `claude-sonnet-5` |
| `AI_EXTRACT_TIMEOUT_MS` | **Path A** per-request timeout | `60000` |
| `EXTRACTION_LLM_ENDPOINT` | **Path B** full OpenAI-compatible chat-completions URL | unset → provider `external` throws (502) |
| `EXTRACTION_LLM_API_KEY` | **Path B** bearer key (server-side only) | unset → provider `external` throws (502) |
| `EXTRACTION_LLM_MODEL` | **Path B** model id | `gpt-4o-mini` |
| `EXTRACTION_LLM_TIMEOUT_MS` | **Path B** per-request timeout | `45000` |

Both `AI_EMBEDDING_ENDPOINT` and `AI_EMBEDDING_API_KEY` must be set for hosted
embeddings to activate; either missing → the engine stays lexical.

`AI_EMBEDDING_PROVIDER` appears in `server/.env.example` but **no code reads it** —
the embedding provider is chosen only by the admin setting. Do not rely on the env var
to disable hosted embeddings; clear the key instead.

`server/.env.example` also states that `EXTRACTION_LLM_*` is gated by the
`aiExtraction` flag. It is not: those vars belong to path B, which is gated by
`extractionAssist`. `aiExtraction` gates path A and `ANTHROPIC_API_KEY`.

---

## 4. Provider selection and governance

- The embedding provider is an **admin** setting (`lexical` / `hashing` / `hosted`),
  surfaced in Ops. Hosted egress requires both the admin selection **and** the env
  configuration above.
- Citation enrichment is **leader-gated** (like scoring runs) and only runs when a
  leader triggers it.
- A global **kill switch** disables the whole engine, overriding all provider settings.
- The screening feature itself is behind the `aiScreening` flag (default OFF).

---

## 5. Audit trail

- **Model status card** (`GET …/ai/status`) reports the active embedding provider and a
  **secret-free** config snapshot (`configured`, `model`, `endpointConfigured`) — the
  API key is never exposed.
- **Citation status** (`GET …/ai/citation-status`) reports enrichment coverage,
  provider (`openalex`), and whether a `mailto` is configured.
- Every scoring run records the embedding provider actually used
  (`embeddingProviderUsed`) and whether citation features were active in its config
  snapshot, and writes an `AI_RUN_COMPLETED` audit entry.
- Citation enrichment and validation-sample creation write their own audit entries.

---

## 6. Summary

Default posture keeps everything in-process. Record-derived data leaves the server in
exactly four ways, all opt-in and all requiring a server-side key that is not set by
default:

| # | Path | Enabled by | What is sent |
|---|------|-----------|--------------|
| a | Hosted embeddings | admin selects `hosted` + `AI_EMBEDDING_*` | embedding text (title/abstract/keywords, ≤4 000 chars) |
| b | Citation enrichment | a leader runs it | DOIs and PMIDs only |
| c | AI extraction (path A) | `aiExtraction` flag + `ANTHROPIC_API_KEY` | **the PDF itself**, and/or ≤24 000 chars of article text |
| d | Extraction assist `external` (path B) | `extractionAssist` flag + provider `external` + `EXTRACTION_LLM_*` | title, abstract and ≤24 000 chars of supplied text |

(a) and (b) fail safe to the lexical baseline. (c) and (d) fail loudly, and their
output is always a draft a person must accept. Every one of them is audited. The one
control no role can bypass is the absence of the API key: an `admin` account bypasses
all three feature flags (§2.3), so an unconfigured key — not an off switch — is what
guarantees nothing leaves.
