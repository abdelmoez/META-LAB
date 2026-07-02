# Screening-AI Benchmark Harness

`scripts/screening-benchmark.mjs` runs a **leak-free, out-of-sample** benchmark of
the PecanRev screening AI engine (`src/research-engine/screening/ai/`) against
public systematic-review screening datasets. It drives the engine's *own*
deterministic primitives (TF-IDF vectorizer + class-weighted logistic regression +
hybrid fusion), so the numbers it reports are the engine's real behaviour — not a
re-implementation.

Dataset loading lives in `scripts/benchmark/loaders.mjs`; every loader returns the
same normalized schema:

```js
{
  id:   string,                 // dataset id (e.g. "ADHD")
  name: string,                 // label for the results table
  records: [{
    id:       string,           // stable per-record id
    title:    string,
    abstract: string,
    keywords: string,           // MeSH + author keywords, "; "-joined
    year:     number | null,    // publication year if known
    label:    0 | 1,            // 1 = include (human final decision)
  }]
}
```

## No-bundled-data policy

**This repo bundles NO screening corpora except the Cohen 2006 set** already
present under `.claude/screening/DEV screening engine/cohen_datasets_plus/`. The
SYNERGY and CLEF loaders read **only** from a path you provide. If that path is
missing or empty the harness prints where to obtain the data and the expected
layout, then **exits non-zero without producing any results** — it never
fabricates records or numbers.

## Datasets

### Cohen 2006 (default, bundled)

15 drug-class systematic-review datasets from Cohen et al. 2006,
*"Reducing Workload in Systematic Review Preparation Using Automated Citation
Classification"* (J Am Med Inform Assoc). Layout — one CSV per review:

```
<dir>/cohen_<Name>.csv     header: pmid,label,title,abstract,mesh,keywords,journal
```

`label ∈ {0,1}` (1 = include). This is the historical benchmark and the CLI
default; no `--path` is needed (it defaults to the bundled directory).

### SYNERGY (user-provided)

The [asreview/synergy-dataset](https://github.com/asreview/synergy-dataset)
collection (CC-licensed — check the upstream repo for exact terms). Obtain it from
GitHub, then point `--path` at either a directory of one-CSV-per-dataset or a
single dataset CSV. Column names vary across releases, so the loader is tolerant:

| normalized field | accepted CSV columns                          |
|------------------|-----------------------------------------------|
| `label`          | `label_included`, `included`, `label` (1 = include) |
| `title`          | `title`, `primary_title`                      |
| `abstract`       | `abstract`, `abstract_note`                   |
| `keywords`       | `keywords`, `mesh_terms` (optional)           |
| `year`           | `year`, `publication_year` (optional)         |
| `id`             | `openalex_id`, `doi`, `id`, `record_id` (optional; else row #) |

Rows without a recognizable label are skipped (never assigned a fake label).

### CLEF eHealth TAR 2017–2019 (user-provided, prepared layout)

CLEF eHealth Technology-Assisted Review data must be obtained (and its licence
accepted) from the official task pages — see
[CLEF-TAR/tar](https://github.com/CLEF-TAR/tar). **Raw CLEF distributions vary**
(qrels + separate PMID/abstract dumps), so this harness reads a **simplified
prepared layout you build yourself** from the official release:

```
<path>/<topic>/records.csv     header: id,title,abstract
<path>/<topic>/qrels.txt        lines: "<topic> 0 <docid> <relevance>"
```

To prepare it: for each topic, fetch the abstracts for the topic's PMIDs (e.g. via
the official PMID list + a PubMed dump) into `records.csv`, and copy the topic's
qrels into `qrels.txt`. A document is an **include** (label 1) when its qrels
relevance is `> 0`, else **exclude** (0). Only documents present in *both* files
are used.

> This is an honest simplification: preparing `records.csv` requires abstracts you
> must source from PubMed/the official dump — the harness does not fetch them.

## Running

```bash
# Default: Cohen, engine's default modes (hybrid + pure-classifier + tuned config)
node scripts/screening-benchmark.mjs

# A specific engine config version on the Cohen set
node scripts/screening-benchmark.mjs --config v2-lexical-tuned

# SYNERGY / CLEF from a user-provided path, writing JSON + CSV results
node scripts/screening-benchmark.mjs --dataset synergy --path /data/synergy --out results/synergy
node scripts/screening-benchmark.mjs --dataset clef    --path /data/clef-prepared --out results/clef

# npm alias for the default run
npm run test:screening-benchmark
```

### CLI

| flag | meaning |
|------|---------|
| `--dataset <cohen\|synergy\|clef>` | dataset family (default `cohen`) |
| `--path <dir>` | dataset path (required for synergy/clef) |
| `--config <versionId>` | engine config version (`v1-hybrid-legacy`, `v2-lexical-tuned`) |
| `--out <dir>` | write `results.json` + `results.csv` here |
| `--folds <n>` | CV folds (default 5) |
| `--seed <n>` | RNG seed (default 1337) |
| `--stamp <ISO-date>` | deterministic `date` field in output (omitted if unset) |
| `--latency` | also run the ~3000-record scoring latency probe (cohen only) |
| `--help` | usage |

Legacy positional **modes** still work (`current_hybrid`, `current_clf`, or any
config version id) and select the scoring path per run.

## Metrics

All metrics are computed on **pooled out-of-fold** predictions (the TF-IDF
vocabulary is fit on train folds only; the held-out fold is transformed against
that train-only vocabulary — strict anti-leakage).

- **AUC** — ROC area under the curve (Mann–Whitney rank-sum, average-rank tie
  handling). 0.5 = random ranking, 1.0 = perfect separation.
- **WSS@95 / WSS@100** — *Work Saved over Sampling* at 95% / 100% recall
  (Cohen 2006): `WSS@r = (TN + FN)/N − (1 − r)`, evaluated at the rank where recall
  first reaches `r`. Interpreted as the fraction of screening effort saved versus
  random ordering while still catching `r` of the includes. Random ranking ≈ 0.
- **recall@k** — fraction of all positives captured in the top-k ranked records.
- **precision@k** — positives in the top-k divided by the **fixed budget k**
  (`precision@k = |positives in top-k| / k`), for k ∈ {10, 25, 50}. Uses the same
  **pessimistic tie-ranking** as the engine's `validation.js`: within an
  equal-score block, excludes are ranked above includes (worst case within ties).
- **ECE (held-out)** — Expected Calibration Error from *nested* cross-validation
  (fit a calibrator on the other folds, evaluate on the held-out fold; 10 bins).
  This is the same honest estimator the deployed calibration panel surfaces. It is
  `null` when there are too few per-class samples for a meaningful nested estimate
  (small datasets) — reported as `—` rather than a fabricated value.

95% percentile-bootstrap confidence intervals (deterministic, seeded) are reported
for AUC and WSS@95 in the JSON/CSV output.

## Reproducibility

Results depend on **two** things that are recorded in every output row:

1. **Engine config version** (`engineConfigVersion`) — which frozen set of engine
   tunables the run scored under (`v1-hybrid-legacy`, `v2-lexical-tuned`, or the
   default hybrid/clf path). Defined in
   `src/research-engine/screening/ai/config.js` (`ENGINE_CONFIG_VERSIONS`).
2. **Seed** (`seed`) — the RNG seed driving stratified fold assignment and the
   bootstrap CIs (default `1337`).

Given the same dataset, config version, seed, and fold count, the harness is fully
deterministic — the same inputs always produce the same numbers. The
`embeddingProvider` column is always `lexical` (the dependency-free in-process
provider; hosted embeddings are an optional layer not exercised by this harness).

## Output files (`--out`)

- `results.json` — `{ meta, rows }`. `meta` records dataset/path/modes/folds/seed/
  embeddingProvider/date/engineConfigVersions; `rows` is one object per
  (mode × dataset) with every metric above plus its provenance fields.
- `results.csv` — the same rows flattened, one header line then one row per
  (mode × dataset), suitable for spreadsheets or downstream aggregation.
