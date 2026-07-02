# AI Screening Engine

PecanRev's screening intelligence engine ranks candidate records by relevance to a
systematic-review question and estimates how much screening work that ranking can
save. It is **decision support only** — the engine scores and ranks; a human always
records the include/exclude decision. There is no code path by which the AI writes a
screening decision.

Feature flag: `aiScreening` (default **OFF**). Every AI HTTP route is existence-hidden
behind a 404 while the flag is off.

The engine is deliberately **deterministic**: the same records + the same human
decisions + the same config always produce the same scores. That property is what
makes the validation metrics reproducible and citable, and it is why a lexical
active-learning model — not an opaque LLM call — is the core of the engine.

---

## 1. Architecture at a glance

```
records + human decisions
        │
        ▼
  ┌───────────────┐   TF-IDF (title×3 / abstract / keywords·MeSH / journal)
  │  vectorizer   │   unigrams + bigrams, sublinear TF, min-df 2, ≤20k features
  └──────┬────────┘
         │
   ┌─────┴───────────────────────────────────────────────┐
   ▼                 ▼                ▼               ▼
classifier      cold-start        semantic         citation        ← sub-signals
(logreg,        (PICO /           (centroid        (OpenAlex
 momentum)       criteria          cosine, or       graph
                 prior)            embeddings)      proximity)
   └─────┬───────────┴────────────────┴───────────────┴──┐
         ▼                                                │
  ┌──────────────┐   renormalized over the ACTIVE signals only
  │ hybrid fusion│   (a missing signal is dropped, never zero-filled)
  └──────┬───────┘
         ▼
   relevance score  ──►  ranking / band / prediction
         │
         ▼
  validation (in-sample + held-out CV + unbiased random-sample),
  probability calibration, recall-targeted operating point,
  stopping-rule estimate, drift tracking
```

Pure engine code lives in `src/research-engine/screening/ai/` (no DB, no network,
unit-tested). The server layer (`server/services/screeningAiService.js`,
`server/controllers/screeningAiController.js`) is a thin adapter: it loads records +
decisions from Prisma, calls the pure engine, persists scores, and audits — it holds
**no** model maths.

---

## 2. Core signals

### 2.1 TF-IDF + momentum logistic regression (supervised core)

The relevance classifier is a class-weighted logistic regression over a TF-IDF
vocabulary built from each record's title (weight 3), abstract, keywords/MeSH
(weight 2), and journal. It trains only once enough labels exist
(`minLabelsToTrain` = 10, with `minPositivesToTrain` / `minNegativesToTrain` = 3);
below that the engine falls back to the cold-start prior rather than faking a model.

The tuned config (`v2-lexical-tuned`, the default) changes **only the optimiser**
relative to the original deployed engine: it adds deterministic heavy-ball momentum
and an sklearn-style inverse-regularisation constant (C) so the classifier converges
to the regularised optimum the plain full-batch gradient descent under-fit. The
feature set and hybrid fusion are unchanged, so cold-start behaviour before a model
can be trained is identical to v1.

### 2.2 Cold-start prior

Before (or instead of) a trained classifier, the engine scores each record against
the PICO snapshot, inclusion/exclusion criteria, study-type filter, and keyword
lists. This is what makes the queue usable from record one, and it is the fallback
whenever supervised training preconditions are not met.

### 2.3 Semantic similarity

Similarity of each record to the already-**included** set minus the already-**excluded**
set. Two modes:

- **Lexical (default):** cosine of the record's TF-IDF vector against the
  included/excluded centroids. Labelled records use leave-one-out (their own vector
  is subtracted from the centroid) so self-similarity never inflates the score.
- **Dense embeddings:** when an embedding provider is configured and every record
  gets a uniform-length dense vector, cosine is computed on the dense vectors
  instead. All-or-nothing per run — a ragged/partial embedding set falls back to the
  lexical path.

### 2.4 Citation-graph signal (66.md P4.3)

An **additive** signal that contrasts a record's citation-graph proximity to the
included set against its proximity to the excluded set. Components:

- **Direct citation:** the record cites labelled works, or labelled works cite it.
- **Bibliographic coupling:** shared references with the labelled sets (leave-one-out
  on the labelled side, so a labelled record's own references don't count as shared
  with itself).

The signal is `clamp01(0.5 + 0.5·(includeStrength − excludeStrength))`, so a record
with no citation links to either side is neutral (0.5), one pulled toward the included
side is > 0.5, and one pulled toward the excluded side is < 0.5.

Citation features are **derived from each scoring call's own labels**, so
cross-validation folds recompute them from the training fold only and stay
leakage-free. When citation metadata is absent, the signal is `null` for every
record and the hybrid fusion renormalizes it away — a run without enrichment scores
**byte-identically** to the pre-citation engine (this is verified in
`tests/unit/screening/ai/citationSignals.test.js`). Citation data can only **add**
signal; it never gates screening.

Availability requires citation metadata for at least `minLabeledWithMetadata` (3)
labelled records with at least one on the included side; otherwise the signal reports
unavailable.

---

## 3. Hybrid fusion

`hybridScore()` combines only the signals that are actually available, renormalizing
their weights so a missing signal never silently drags the score toward zero. Default
weights (before renormalization):

| Signal            | Weight |
|-------------------|--------|
| classifier        | 0.55   |
| cold-start        | 0.20   |
| semantic          | 0.15   |
| keyword (raw)     | 0.10   |
| citation          | 0.10   |

Every sub-score is preserved in the output so the UI can show the breakdown and the
explanation layer can be honest about what drove the number. The keyword signal is
folded into cold-start in the production path to avoid double-counting.

---

## 4. Embedding provider modes

Configured by `provider.embedding`; resolved server-side, best-effort (any failure
falls back to the lexical engine):

- **`lexical` (default):** no external vectors; the in-process TF-IDF centroid
  similarity is the semantic signal. Nothing leaves the server.
- **`hashing`:** a dependency-free in-process hashing embedder (deterministic,
  unit-norm). Nothing leaves the server.
- **`hosted`:** an env-configured external embedding service. Record text is sent to
  the configured endpoint (see `docs/privacy-ai-providers.md`).

Embedding text is normalized and hashed for a **persistent cache** so re-runs don't
re-embed unchanged records.

---

## 5. Citation enrichment (OpenAlex)

`server/services/citationEnrichmentService.js` fetches public bibliographic metadata
(citation counts + reference lists) from OpenAlex for records that have a DOI or
PMID, caches it globally by identifier in `CitationMetadata`, and exposes it to the
pure engine as a plain per-record map.

Privacy: **only public identifiers (DOI / PMID) leave the server** — no titles,
abstracts, or project data are sent. Calls are batched (50/req), rate-limited
(200 ms between batches, polite-pool `mailto` from env), timeout-guarded, and
cached, so a re-run costs no API calls. Every failure path degrades to "no citation
signal" and scoring proceeds unchanged.

---

## 6. Recall-targeted operating point (66.md P4.5)

Screening is recall-first. Instead of a balanced 0.5 cut, `recallTargetedThreshold()`
picks the **highest** score threshold whose recall on held-out (cross-validated)
predictions is ≥ the target (default 0.95). Ties are handled pessimistically: a
threshold `≥ t` admits every record at score `t`, so a tied block is consumed as a
unit and the worst case within it is assumed.

The operating point is reported with `achievedRecall`, `specificity`, `precision`,
`screenedFraction`, and `workSavedFraction`, and is flagged **preliminary** below
`minLabels` (30) or `minPositives` (10). Per-record predictions switch from the
conservative fixed bands to the recall-targeted threshold only when the
cross-validated operating point is reliable; the prediction policy
(`conservative_bands` vs `recall_targeted`) is stamped on the run.

Hand-computed cases for this logic live in
`tests/unit/screening/ai/recallThreshold.test.js`.

---

## 7. Validation

Three metric sets, each labelled with its provenance so a reader knows how honest it
is:

1. **In-sample (apparent):** AI score vs settled human labels on the same records the
   model trained on. Optimistic; shown for transparency only.
2. **Held-out (cross-validated):** stratified k-fold CV where each held-out fold's
   labels are **removed** (not just unused) before training, so the pooled
   out-of-fold pairs are genuinely out-of-sample. This is the honest headline number.
3. **Unbiased random-sample (66.md P4.6):** prioritized screening biases the labelled
   set toward likely-includes. A seeded uniform-random **validation sample** breaks
   that bias: when one exists, the engine also cross-validates on the sample's labels
   alone and labels the metric source `random` / `prioritized` / `mixed`.

Metrics: ROC AUC, WSS@95 / WSS@100 (Cohen 2006), recall@k, plus per-stage recall /
precision after screening the top f·N records. Headline metrics carry 95% percentile
bootstrap confidence intervals computed with a **seeded** PRNG (deterministic).

The validation sample is created via a seeded Fisher–Yates partial shuffle; the seed,
method, and membership are persisted so every metric computed on it is reproducible.

---

## 8. Probability calibration

The ranking score is mapped to `P(include)` using **out-of-fold** CV predictions
(never in-sample). Method is chosen by sample size (Platt below
`isotonicMinSamples`, isotonic at/above); below `minSamplesToCalibrate` (50) no
calibration is applied and the UI shows the raw score, labelled as such.

The **reported** calibration quality (ECE / slope / intercept) is measured via
**nested** CV (`heldOutCalibrationMetrics`), not the optimistic apparent ECE that
isotonic scored on its own fit points would give. The apparent numbers are kept under
`apparentMetrics` for provenance.

---

## 9. Stopping-rule estimate

`evaluateStopping()` sums calibrated `P(include)` over the unscreened records to
estimate the remaining eligible studies, gated by preconditions (enough found
includes, enough decisions, adequate calibration, recent-yield check) and judged
against a conservative lower bound. It is **decision support only** — never actionable
on its own, and any records dropped by the per-run cap suppress an actionable
recommendation because their eligible mass is unaccounted for.

---

## 10. Engine config versions

A run's model **version** already lives in `ScreenAiRun` (active/parent/rollback
lineage). The `ENGINE_CONFIG_VERSIONS` registry adds the **engine-config** dimension:
a named, frozen set of tunables a run is scored under, recorded on the run so it is
reproducible and rollback-able.

- **`v1-hybrid-legacy`** — the original deployed engine, kept byte-for-byte (empty
  override == `DEFAULT_AI_CONFIG`) so a rollback restores exact prior behaviour.
- **`v2-lexical-tuned`** — the default; the tuned lexical config (momentum + C).

A project may pin a version; a rollback pins the target run's version and embedding
provider.

---

## 11. Job architecture

Scoring and citation enrichment are CPU/IO-heavy, so the HTTP layer never runs them
inline. `POST …/ai/run` and `POST …/ai/citation-enrichment` **enqueue a durable job**
and return `202` + a `jobId` immediately; an in-process worker runs the compute (the
scoring compute in a `worker_thread` with an inline fallback), writes progress to the
job row, and emits `ai.updated` on completion. The client polls
`GET …/ai/job-status`. Jobs de-duplicate (an in-flight job is reused, so a
double-click can't start two heavy runs) and honour a retry cap for stuck jobs.

All `runScoring` entry points serialize per `(project, stage)` through an in-process
mutex so two interleaving runs can't leave two active model versions. Score upserts
commit in bounded chunked transactions so a large review becomes visible
progressively.

---

## 12. Governance & safety invariants

- The AI **never** finalises a decision (`requireHumanFinalDecision`); there is no
  decision-write route or code path.
- Running scoring is leader-gated by default (reviewers only when an admin enables
  `allowReviewersToRun`).
- Scores are withheld server-side until the project has ≥ `minScreenedDecisions`
  (default 50) screened records; an admin may bypass per-request for testing only.
- Blind review suppresses reviewer-derived signals both at scoring time and on read,
  so a reviewer never sees signals derived from peers' ratings/notes/decisions.
- A global kill switch forces the engine off everywhere, overriding all other
  toggles.

---

## 13. Reproducing the benchmark numbers

Run the leak-free out-of-sample benchmark harness:

```
npm run test:screening-benchmark
```

This drives the actual engine primitives (no reimplementation) over the bundled
Cohen-2006 datasets with 5-fold stratified CV and seed 1337, printing AUC, WSS@95,
WSS@100, recall@k, precision@k, and held-out ECE per dataset and as the family mean.
See `docs/validation/VALIDATION_PROTOCOL.md` for the full protocol and
`docs/validation/MODEL_CARD.md` for the model card.
