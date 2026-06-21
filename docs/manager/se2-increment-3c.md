# SE2 — Increment 3c: biomedical embeddings (se2.md §7)

> Third slice of Increment 3. Makes the optional dense-embedding layer biomedical-ready,
> hardened, and honest. Additive; the deterministic in-process lexical engine remains the
> DEFAULT and the always-available fallback — no external dependency is required to run.

## What shipped

### Biomedical document representation (pure)
New `src/research-engine/screening/ai/embeddingText.js`:
- `buildEmbeddingText(record)` assembles the embedding input with **title + abstract
  dominant** and metadata (keywords/MeSH, publication type, journal) capped to ≤ 20 % of
  the budget so it never overwhelms the science (§7 "do not let metadata noise overwhelm
  the title and abstract"). Normalises away control/zero-width characters; truncates the
  abstract first when over the model's input budget; returns a **quality** summary
  (`empty / hasAbstract / titleOnly / short / truncated`) covering the §7 edge cases
  (missing abstract, title-only, very short, malformed).
- `embeddingTextHash` (stable 64-bit hex) for cache keys tied to the exact text.
- Wired into the embedding providers (`embeddings.js`) so hashing **and** hosted vectors
  are built from this biomedical representation instead of a raw field concatenation.

### Embedding-service hardening (`aiEmbeddingClient.js`, §7/§17)
- **Timeout** (`AI_EMBEDDING_TIMEOUT_MS`, default 15 s) via `AbortController`, **one
  transient retry**, and **dimension validation**: every returned vector must be a finite,
  uniform-length array — a malformed batch throws so the engine falls back to the lexical
  signal rather than scoring on a poisoned vector.
- `embeddingModelInfo()` (secret-free config snapshot) and `embeddingHealth()` (live probe
  → `{ ok, dim }`) for Ops/observability. Provider/key/text still never leave the server,
  and text is sent to a hosted endpoint **only** when an admin selects the `hosted`
  provider and env is configured (privacy preserved).

## Embedding model selection (§7) — recommendation & rationale
The engine is **provider-agnostic** (OpenAI-compatible `/v1/embeddings` wire format), so
any of the candidates can be deployed without code changes. Evaluated against §7's
criteria (biomedical retrieval quality, input length, size, latency, self-hostability,
licensing, privacy, reproducibility):

| Model | Notes |
|---|---|
| **SPECTER2** (allenai) | Scientific-paper embeddings (title+abstract); strong for retrieval/similarity; self-hostable; Apache-2.0. **Recommended self-hosted default.** |
| PubMedBERT-derived (e.g. `pritamdeka/S-PubMedBert-MS-MARCO`) | Biomedical sentence embeddings; good for clinical text; self-hostable. |
| Biomedical BGE variants | Strong general retrieval; biomedical fine-tunes available; self-hostable. |
| Voyage `voyage-2`/scientific | Hosted; strong quality; **not** self-hosted → privacy/cost trade-off. |

**Recommended default: a self-hosted SPECTER2 (or PubMedBERT) service** behind a small
OpenAI-compatible shim (e.g. a `text-embeddings-inference` / FastAPI container exposing
`POST /v1/embeddings`), pointed at by `AI_EMBEDDING_ENDPOINT`. Rationale: keeps project
text **on-premise** (first-class privacy, §7), Apache-2.0/permissive licensing, reproducible
pinned model version, no per-call cost, and adequate CPU latency for screening batch sizes.
A hosted provider remains a configurable option for teams that accept the data-egress
trade-off.

## Files
- **New:** `embeddingText.js`, `tests/unit/screening/ai/embeddingText.test.js` (8 tests).
- **Changed:** `embeddings.js` (use biomedical text), `index.js` (exports),
  `aiEmbeddingClient.js` (timeout/retry/dim-validation + health/metadata), `.env.example`
  (`AI_EMBEDDING_TIMEOUT_MS` + biomedical guidance).

## Verified
- +9 pure unit tests; all engine AI tests green; full suite 1702 + build green.

## Adversarial review (7 agents, 3 lenses + verify) — 3 findings (all LOW), all fixed
- `buildEmbeddingText` could exceed `maxChars` by 2 via a non-default `metaShare` override
  (unreachable by the sole production caller) — metadata budget now clamped + zero-budget
  body guarded (+1 regression test).
- `embeddingHealth` polluted the shared LRU with its probe vector — now deleted after use.
- The request timeout relied on `fetch` honoring `AbortSignal` — now also raced against a
  timeout promise so a signal-ignoring fetch still bails.

## Honesty & limitations (§7/§19)
- The **default remains lexical TF-IDF** (labelled as lexical, not semantic). The dense
  biomedical layer is **opt-in** and only as good as the deployed model — the UI continues
  to label the active provider precisely.
- The actual biomedical model is an **operator deployment** (this repo ships the
  architecture + hardening + selection guidance, not a bundled model/GPU).
- **Persistent cross-run embedding cache** (a DB table keyed by text-hash/model/version) is
  a documented follow-up; current caching is the in-process LRU (keyed by model+text). For
  hosted providers this means re-embedding across process restarts — fine for self-hosted,
  a cost note for hosted.

## Next
- **3d — §12:** background-job scalability beyond the 5,000-record cap.
