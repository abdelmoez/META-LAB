# PecanRev Screening Intelligence Engine

> Feature flag: **`aiScreening`** (default **OFF**) · Implements `screeningEngin.md`
> Status: foundation shipped — deterministic active-learning engine + governance + validation + UI.

PecanRev now has a real **AI-assisted, active-learning, human-governed, auditable**
screening engine for systematic reviews — not an "AI button". The core is a
deterministic, in-process, dependency-free relevance model (the same model family
Rayyan's published engine used), wrapped in a transparent explanation layer, an
active-learning queue, validation metrics, and strict human governance.

The defining design choice: **the core is a deterministic lexical model, not an
LLM call.** That is what makes the scores reproducible, free, private (no record
ever leaves the server), and — critically — what makes the validation metrics
(AUC, WSS@95, recall@k) scientifically defensible. LLM / hosted embeddings are an
**optional pluggable provider** that can only *add* signal, never replace the
baseline.

---

## 1. Architecture

```
src/research-engine/screening/ai/         ← pure, deterministic engine (no DB, no network)
  config.js          default config + deep-merge (the single tunable surface)
  text.js            tokenization, n-grams, field-weighted record features
  vectorizer.js      TF-IDF sparse vectorizer (unigram+bigram, MeSH/keyword feats)
  logreg.js          class-weighted L2 logistic regression (full-batch GD, deterministic)
  coldStart.js       PICO / eligibility-criteria / study-design prior
  embeddings.js      pluggable embedding provider (lexical | hashing | hosted)
  hybrid.js          fuse classifier + cold-start + semantic + keyword → one score
  ranking.js         uncertainty math + active-learning queue modes
  explain.js         honest, non-hallucinated explanations
  validation.js      AUC, recall@k, WSS@95/100, sensitivity/specificity, stages
  activeLearning.js  orchestrator: trainAndScore() — the one entry point
  index.js           barrel

server/                                    ← thin adapter (DB ↔ engine), governance
  services/screeningAiService.js           load records+decisions → engine → persist + audit
  controllers/screeningAiController.js     member-facing endpoints (flag + access gated)
  controllers/screeningAiAdminController.js admin settings + run logs
  prisma/schema.prisma                     ScreenAiRun / ScreenAiScore / ScreenAiFeedback (additive)

src/frontend/screening/ai/                 ← UI (institutional, theme-matched)
  aiApi.js           API client
  useScreeningAi.js  self-detecting hook (404 → feature off → renders nothing)
  AiAssist.jsx       AiScoreCard, AiQueueBar, AiStatusPanel, ScoreBadge
```

### The five scoring layers (per `screeningEngin.md` §A)

1. **Cold-start** — before enough labels exist, score from PICO/criteria/keyword
   matches + study-design detection. The engine never pretends it has a model;
   cold-start scores are flagged `mode: 'cold_start'` and carry a `lowConfidence`
   flag when no criteria are configured.
2. **Supervised active-learning** — once ≥10 labels exist with ≥3 of each class, a
   project-specific **class-weighted logistic regression** trains on the human
   decisions and re-scores every record. Re-runs as decisions accumulate.
3. **Embedding / semantic** — similarity to the already-included vs excluded
   record centroids (in-process TF-IDF by default; pluggable to hosted embeddings).
4. **Hybrid** — only the *available* signals are combined and re-normalized, so a
   missing signal never silently drags the score down. Sub-scores are preserved.
5. **Explanation** — every score is explainable from concrete evidence.

---

## 2. The model

| Aspect | Choice | Why |
|---|---|---|
| Vectorizer | TF-IDF, unigrams + bigrams, smoothed idf, sublinear tf, L2-normalized | Standard, interpretable, reproducible |
| Features | Title (×3), abstract (×1), journal (×1), keywords/MeSH `kw:` (×2) | Title terms are the strongest screening signal |
| Classifier | L2-regularized **logistic regression**, full-batch gradient descent | Same family as Rayyan's SVM; logistic adds calibrated-ish probabilities for uncertainty sampling |
| Class imbalance | **Cost-sensitive `balanced` class weights** (`n/(2·n_class)`) | A handful of includes can stand up to a majority of excludes |
| Determinism | Full-batch GD (order-independent), zero-init, fixed iteration | Same inputs → identical scores → reproducible metrics |
| Active learning | Margin/uncertainty sampling (`1 − |p−0.5|·2`) | Surface the most informative records to label next |

All of the above is pure, unit-tested JavaScript — see `tests/unit/screening/ai/`.

---

## 3. Governance & safety (`screeningEngin.md` §9, §C, §J)

**Hard invariant — the AI never decides.** `screeningAiService.js` has *no* code
path that writes a `ScreenDecision`. The engine writes only `ScreenAiScore` rows.
Every record still goes through the project's normal human two-reviewer workflow,
quorum, conflict resolution, blinding, and audit trail — all untouched.

- **Feature flag** `aiScreening` (default OFF) — every `/ai/*` endpoint 404s when off.
- **Per-project opt-in** — `ScreenProject.aiSettings` (`enabled`, `policy`,
  `blindFromAi`, thresholds). Leaders/owners only.
- **Run permission** — leaders/owners by default; reviewers only if the admin sets
  `allowReviewersToRun`.
- **AI-blinding** — `blindFromAi` hides AI suggestions until a reviewer records their
  own decision, preserving independent human screening.
- **Audit** — every run (`AI_RUN_COMPLETED`), settings change (`AI_SETTINGS_UPDATED`,
  `UPDATE_AI_SCREENING`), and feedback (`AI_FEEDBACK`) is logged (`ScreenAuditLog` /
  `AdminAuditLog`).
- **Privacy** — under the default `lexical` provider, **no record text leaves the
  server**. A hosted embedding provider is opt-in and explicitly configured.

---

## 4. Validation methodology (`screeningEngin.md` §D)

After each run the engine computes an internal-validation snapshot comparing the AI
ranking to the **human final decisions** (`validation.js`):

- **AUC** (rank-based, tie-corrected), **sensitivity/recall**, **specificity**,
  **precision/PPV**, **NPV**, **F1**, **accuracy** at the configured threshold.
- **recall@k** (10/25/50), **WSS@95** and **WSS@100** (Cohen et al. 2006), per-stage
  metrics after 5/10/20/40/60/80 % screened, and a **small-sample warning**.
- **Held-out k-fold cross-validation** (`crossValidate`) — when enough labels exist,
  the engine also computes honest **out-of-sample** metrics: stratified k-fold, the
  held-out fold's labels are *removed* before training each fold, and the pooled
  held-out (score,label) pairs are scored. The UI prefers these over the in-sample
  snapshot and labels them "held-out k-fold CV".

> **Honesty note:** with few labels the engine shows the **apparent / in-sample**
> snapshot (model validated on its own training set, optimistic) and says so. Once
> there are enough labels for k-fold CV, the **held-out** metrics take over
> automatically. The remaining gap is per-topic confidence intervals on a public
> benchmark (§8).

WSS@95 reads as "fraction of screening work the AI ordering would have saved while
still finding 95 % of the includes." Random ordering → ≈ 0.

---

## 5. Admin / Ops

`Ops › Feature Flags`:
- Toggle **AI Screening Engine** (`aiScreening`).
- When on, an **AI Screening · global policy** panel appears: enabled, embedding
  provider, require-human-final-decision, allow-reviewers-to-run, max records/run,
  default policy — plus a **Recent runs** log (status, mode, AUC, failures).

Endpoints: `GET/PUT /api/admin/ai-screening/settings`, `GET /api/admin/ai-screening/runs`.

---

## 6. User guide (reviewer)

In the screening workbench (when the flag + project AI are on):
- **AI relevance** card under each record: a 0–100 score, an honest prediction
  (Likely include / Likely exclude / **Uncertain**), confidence & uncertainty bars,
  and an expandable **"Why this score?"** — reasons to include/exclude, PICO match,
  similar included records, and an uncertainty note. Thumbs-up/down feedback.
- **AI Queue** selector (list header): Most likely include · Most informative
  (uncertainty) · Exclusion triage · Conflicts/Duplicates first · PICO gaps ·
  Missing abstract — plus a score-band filter. A compact **AI nn** badge on each row.
- **AI Screening** panel (right): model status, training-set summary, validation
  metrics, and (leaders) the project AI policy controls.

**How to read a score:** it is a *prioritization aid*, not a verdict. A high score
means "looks like your includes so far"; **Uncertain** means "the model genuinely
can't tell — a good place for a human label." Humans remain responsible for every
inclusion and exclusion.

---

## 7. Developer guide

```js
import { trainAndScore, computeValidation } from 'src/research-engine/screening/ai/index.js';

const { meta, scores } = trainAndScore({
  records,                 // [{ id, title, abstract, authors, year, journal, doi, pmid, keywords }]
  labelByRecordId,         // { [id]: 'include' | 'exclude' | 'maybe' | 'undecided' }
  picoSnapshot,            // project PICO/criteria (object or JSON string)
  inclusionKeywords, exclusionKeywords, studyTypeFilter,
  config,                  // optional partial override of DEFAULT_AI_CONFIG
});
```

`trainAndScore` is pure and deterministic. The server adapter
(`screeningAiService.runScoring`) loads from Prisma, calls it, upserts
`ScreenAiScore`, writes a `ScreenAiRun` with the validation snapshot, and audits.

**Member API:** `GET /ai/status`, `POST /ai/run`, `GET /ai/scores`,
`GET /ai/validation`, `PUT /ai/settings`, `GET /records/:rid/ai/explanation`,
`POST /records/:rid/ai/feedback` (all under `/api/screening/projects/:pid`).

**Tests:** `tests/unit/screening/ai/core.test.js` (+ `engine.test.js`) — 34 tests
covering vectorizer, logistic regression, determinism, class balancing, cold-start,
hybrid, ranking, embeddings, and the full validation suite. Run:
`npm run test:ci` (the engine tests are in the CI gate).

---

## 8. PecanRev vs Rayyan-style screening (`screeningEngin.md` §E)

| Rayyan limitation | PecanRev response |
|---|---|
| Older SVM-style model | Class-weighted logistic regression (calibrated probabilities) + **hybrid** lexical/semantic/PICO |
| Weak differentiation at close thresholds | **Uncertainty sampling** surfaces exactly the borderline records |
| Class imbalance | Cost-sensitive `balanced` weighting |
| Poor specificity / low sensitivity at fixed thresholds | Tunable include/exclude thresholds + per-stage & WSS reporting |
| Limited explainability | Per-record reasons (model terms + criteria + PICO + similar records), never hallucinated |
| No deep semantic understanding in the published engine | Pluggable embedding provider seam (lexical default → hosted upgrade) |
| Opaque commercial internals | Fully open, deterministic, unit-tested, auditable |

PecanRev wins **without** unsafe claims: it never hides uncertainty, never replaces
human reviewers, and exposes every reason and metric.

---

## 9. Status — next phases delivered (v3.33.0)

Three of the documented next-phase items are now **DONE** (v3.33.0):

1. ✅ **Held-out k-fold cross-validation** (v3.32.1) + **95% bootstrap confidence
   intervals** on AUC / WSS@95 / sensitivity (`bootstrapCI`, deterministic, seeded).
   The UI shows the CI in parentheses next to each metric.
2. ✅ **Server-side AI-ordered queue.** `listRecords` takes optional `aiQueue` (mode)
   and `aiBand` params; when present (flag on) it joins `ScreenAiScore` and
   orders/filters the **whole pool** before paginating, attaching the AI score
   inline. The default screening path is byte-identical when the params are absent.
3. ✅ **Hosted embeddings wired end-to-end.** `server/services/aiEmbeddingClient.js`
   (OpenAI-compatible `/v1/embeddings`, batched, in-memory cache, mockable) feeds the
   engine's provider; `trainAndScore` now **uses dense embeddings** for the semantic
   signal (dense centroids + `cosineDense`, leave-one-out), with graceful lexical
   fallback. Selectable via Ops (`lexical` | `hashing` | `hosted`).

### Still remaining
4. **Auto-rescore trigger.** Scoring runs on demand (manual / API). **Next:** optional
   debounced auto-rescore after N new decisions, via the realtime bus.
5. **Public benchmark datasets** are not bundled; the engine + CV + CIs are ready to
   run one (e.g. CLEF/Cohen drug-review collections) for a publishable validation.

### Recommended path to a publishable validation
Run the (now-implemented) k-fold CV + bootstrap CIs on a public SR screening benchmark
→ report AUC + WSS@95 with CIs across topics → (optionally) enable the hosted-embedding
hybrid and compare.
