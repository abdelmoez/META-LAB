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
| Extraction LLM assist | *not currently wired to a hosted provider* | *nothing leaves the server by default* | — (off by default) |

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

### 2.3 Extraction LLM assist (off by default)

The screening/extraction assist does **not** currently call a hosted LLM: there is no
extraction-LLM endpoint or API-key env var in the server, and extraction assist runs
without sending record data to an external LLM. If a hosted extraction provider is added
later it must follow the same opt-in, env-gated, server-side-key, fail-safe pattern as
hosted embeddings, and this document must be updated with its exact egress before it
ships enabled.

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

Both `AI_EMBEDDING_ENDPOINT` and `AI_EMBEDDING_API_KEY` must be set for hosted
embeddings to activate; either missing → the engine stays lexical.

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

Default posture keeps everything in-process. The only ways record-derived data leaves
the server are: (a) an admin explicitly enabling hosted embeddings with a configured
endpoint (sends embedding text), and (b) a leader running citation enrichment (sends
only DOIs/PMIDs). Both are opt-in, env/permission-gated, fail-safe to the lexical
baseline, and audited.
