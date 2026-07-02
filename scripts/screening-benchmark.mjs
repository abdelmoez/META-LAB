#!/usr/bin/env node
/**
 * screening-benchmark.mjs — leak-free out-of-sample benchmark for the PecanRev
 * screening AI engine (screeningEngine.md validation protocol; roadmap P4.7).
 *
 * Drives the ACTUAL deterministic engine primitives (recordFeatures /
 * buildVectorizer / trainLogReg / predictProba / trainAndScore /
 * heldOutCalibrationMetrics), so the numbers it prints are the engine's own — not
 * an independent reimplementation.
 *
 * PROTOCOL (out-of-sample only):
 *   - k-fold stratified CV (default 5). Fit the TF-IDF vocabulary on TRAIN folds
 *     only; transform the held-out fold against that train-only vocabulary.
 *   - Pool the out-of-fold predicted probabilities, then compute:
 *       AUC          ROC AUC over pooled OOF scores.
 *       WSS@95/@100  Work Saved over Sampling at 95% / 100% recall (Cohen 2006).
 *       recall@k     fraction of positives captured in the top-k ranked records.
 *       precision@k  positives in top-k / k (pessimistic tie-ranking).
 *       ECE (held-out) nested-CV calibration error (the deployed panel's estimator).
 *   - Reported per-dataset and as the mean over all datasets in the family.
 *
 * DATASET FAMILIES (loaders in scripts/benchmark/loaders.mjs):
 *   cohen    — bundled 15 Cohen-2006 datasets (the historical default).
 *   synergy  — asreview/synergy-dataset (USER-PROVIDED path; nothing bundled).
 *   clef     — CLEF eHealth TAR 2017–2019, prepared layout (USER-PROVIDED path).
 * A missing/empty path for synergy/clef prints instructions and exits non-zero
 * WITHOUT producing fake results.
 *
 * USAGE:
 *   node scripts/screening-benchmark.mjs [--dataset cohen|synergy|clef]
 *        [--path <dir>] [--config <versionId>] [--out <dir>]
 *        [--folds 5] [--seed 1337] [--stamp <ISO-date>] [--latency] [--help]
 *
 *   # legacy positional form still works: named modes select scoring/config path
 *   node scripts/screening-benchmark.mjs current_hybrid current_clf v2-lexical-tuned
 *
 * Deterministic: fixed seed everywhere; same inputs + same engine config → same
 * numbers. Results depend on the engine config version AND the seed — both are
 * recorded in every JSON/CSV row.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  resolveConfig,
  recordFeatures,
  buildVectorizer,
  transform,
  trainLogReg,
  predictProba,
  trainAndScore,
  stratifiedFolds,
  rocAuc,
  wssAtRecall,
  recallAtK,
  heldOutCalibrationMetrics,
} from '../src/research-engine/screening/ai/index.js';
import { ENGINE_CONFIG_VERSIONS, resolveEngineConfig } from '../src/research-engine/screening/ai/config.js';
import { loadDatasetFamily, BenchmarkDataError } from './benchmark/loaders.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COHEN_DIR = resolve(__dirname, '..', '.claude', 'screening', 'DEV screening engine', 'cohen_datasets_plus');
const DEFAULT_SEED = 1337;
const DEFAULT_FOLDS = 5;
const PRECISION_KS = [10, 25, 50];

// ── rankedLabels — DUPLICATED (~8 lines) from validation.js so the harness ranks
// identically without importing an unexported helper. Ties broken PESSIMISTICALLY:
// within an equal-score block excludes (0) rank ABOVE includes (1), then input idx.
function rankedLabels(scores, labels) {
  const idx = scores.map((s, i) => i);
  idx.sort((a, b) =>
    (scores[b] - scores[a]) ||
    ((labels[a] ? 1 : 0) - (labels[b] ? 1 : 0)) ||
    (a - b));
  return idx.map(i => (labels[i] ? 1 : 0));
}

/**
 * precisionAtK — positives among the top-k ranked records / k, using the same
 * pessimistic tie-ranking as validation.js. Returns null when there are no records.
 */
export function precisionAtK(scores, labels, k) {
  const ranked = rankedLabels(scores, labels);
  if (!ranked.length || k <= 0) return null;
  const lim = Math.min(k, ranked.length);
  let found = 0;
  for (let i = 0; i < lim; i++) found += ranked[i];
  return found / k; // denominator is k (not lim) — precision@k over a fixed budget
}

// ── Out-of-fold scoring under a given mode ──────────────────────────────────────
function oofScores(records, mode, cfgVersion, { seed, folds }) {
  const ids = records.map(r => r.id);
  const recById = new Map(records.map(r => [r.id, r]));
  const foldSets = stratifiedFolds(ids, (id) => recById.get(id).label, folds, seed);

  const cfg = cfgVersion ? resolveEngineConfig(cfgVersion) : resolveConfig();
  const oof = new Array(records.length).fill(null);
  const idxOf = new Map(records.map((r, i) => [r.id, i]));

  for (let f = 0; f < folds; f++) {
    const held = new Set(foldSets[f]);
    const trainRecs = records.filter(r => !held.has(r.id));
    const testRecs = records.filter(r => held.has(r.id));

    // Fit TF-IDF vocabulary on the TRAIN fold ONLY (strict anti-leakage).
    const trainFeats = trainRecs.map(r => recordFeatures(r, cfg.vectorizer));
    const vec = buildVectorizer(trainFeats, cfg.vectorizer);

    if (mode === 'current_clf' || mode === 'clf') {
      // Pure classifier probability (mirrors the Python predict_proba path).
      const samples = trainRecs.map((r, i) => ({ x: transform(trainFeats[i], vec), y: r.label }));
      const model = trainLogReg(samples, vec.terms.length, cfg.classifier);
      for (const r of testRecs) {
        const x = transform(recordFeatures(r, cfg.vectorizer), vec);
        oof[idxOf.get(r.id)] = predictProba(model, x);
      }
    } else {
      // Full production scoring path (hybrid fusion or version-specific). Train labels
      // only; inject the train-only vectorizer so held-out text never enters the vocab.
      const labelByRecordId = {};
      for (const r of trainRecs) labelByRecordId[r.id] = r.label === 1 ? 'include' : 'exclude';
      const res = trainAndScore({
        records: [...trainRecs, ...testRecs],
        labelByRecordId,
        config: cfg,
        vectorizer: vec,
        lean: true,
        scoreIdSet: held,
      });
      for (const s of res.scores) oof[idxOf.get(s.recordId)] = s.score;
    }
  }
  return oof;
}

// ── Held-out (nested) ECE — the SAME estimator the deployed panel uses ──────────
function heldOutEce(labels, oof) {
  const scores = [], ly = [];
  labels.forEach((y, i) => { if (oof[i] != null) { scores.push(oof[i]); ly.push(y); } });
  const ho = heldOutCalibrationMetrics(scores, ly, { eceBins: 10 }, 5);
  return { ece: ho.ece, slope: ho.slope };
}

// ── Deterministic bootstrap CI for a metric over (score,label) pairs ────────────
// Local seeded resampler so the harness owns its own determinism (no reliance on a
// non-exported RNG). Same inputs + same seed → same interval.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrapCI(scores, labels, metricFn, { iters = 300, seed = 20260620, alpha = 0.05 } = {}) {
  const n = scores.length;
  const point = metricFn(scores, labels);
  if (n < 2 || point == null) return { point: point ?? null, lo: null, hi: null };
  const rng = mulberry32(seed >>> 0);
  const rs = new Array(n), rl = new Array(n), vals = [];
  for (let b = 0; b < iters; b++) {
    for (let i = 0; i < n; i++) { const j = Math.floor(rng() * n); rs[i] = scores[j]; rl[i] = labels[j]; }
    const v = metricFn(rs, rl);
    if (v != null && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return { point, lo: null, hi: null };
  vals.sort((a, b) => a - b);
  const pick = (q) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(q * (vals.length - 1))))];
  return { point, lo: pick(alpha / 2), hi: pick(1 - alpha / 2) };
}

// ── Per-dataset metric bundle over pooled OOF scores ────────────────────────────
function computeDatasetMetrics(dataset, oof, { seed }) {
  const labels = dataset.records.map(r => r.label);
  const sc = [], ly = [];
  oof.forEach((s, i) => { if (s != null) { sc.push(s); ly.push(labels[i]); } });

  const auc = rocAuc(sc, ly);
  const aucCI = bootstrapCI(sc, ly, (s, l) => rocAuc(s, l), { seed });
  const wss95d = wssAtRecall(sc, ly, 0.95);
  const wss95 = wss95d ? wss95d.wss : null;
  const wss95CI = bootstrapCI(sc, ly, (s, l) => { const w = wssAtRecall(s, l, 0.95); return w ? w.wss : null; }, { seed });
  const wss100d = wssAtRecall(sc, ly, 1.0);
  const wss100 = wss100d ? wss100d.wss : null;
  const { ece } = heldOutEce(labels, oof);
  const nPos = labels.reduce((a, b) => a + b, 0);

  const recall = {}, precision = {};
  for (const k of PRECISION_KS) {
    recall[k] = recallAtK(sc, ly, k);
    precision[k] = precisionAtK(sc, ly, k);
  }

  return {
    dataset: dataset.id, name: dataset.name,
    n: dataset.records.length, nPos,
    auc, aucCILo: aucCI.lo, aucCIHi: aucCI.hi,
    wss95, wss95CILo: wss95CI.lo, wss95CIHi: wss95CI.hi,
    wss100,
    recall10: recall[10], recall25: recall[25], recall50: recall[50],
    precision10: precision[10], precision25: precision[25], precision50: precision[50],
    ece,
  };
}

function mean(xs) { const v = xs.filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
const f3 = (x) => (x == null ? '  —  ' : x.toFixed(3));

// ── Arg parsing ─────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    dataset: 'cohen', path: null, config: null, out: null,
    folds: DEFAULT_FOLDS, seed: DEFAULT_SEED, stamp: null,
    latency: false, help: false, modes: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': opts.help = true; break;
      case '--latency': opts.latency = true; break;
      case '--dataset': opts.dataset = argv[++i]; break;
      case '--path': case '--data': opts.path = argv[++i]; break;
      case '--config': opts.config = argv[++i]; break;
      case '--out': opts.out = argv[++i]; break;
      case '--folds': opts.folds = parseInt(argv[++i], 10); break;
      case '--seed': opts.seed = parseInt(argv[++i], 10); break;
      case '--stamp': opts.stamp = argv[++i]; break;
      default:
        if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2); }
        opts.modes.push(a); // legacy positional scoring modes
    }
  }
  return opts;
}

const HELP = `screening-benchmark — leak-free out-of-sample benchmark for the PecanRev screening AI engine

USAGE:
  node scripts/screening-benchmark.mjs [options] [modes...]

OPTIONS:
  --dataset <cohen|synergy|clef>  dataset family (default: cohen)
  --path <dir>                    dataset path (required for synergy/clef; defaults to the
                                  bundled Cohen dir for cohen)
  --config <versionId>            engine config version to score under
                                  (${Object.keys(ENGINE_CONFIG_VERSIONS).join(' | ')})
  --out <dir>                     write results.json + results.csv here
  --folds <n>                     CV folds (default ${DEFAULT_FOLDS})
  --seed <n>                      RNG seed (default ${DEFAULT_SEED})
  --stamp <ISO-date>              deterministic 'date' field in output (omitted if unset)
  --latency                       also run the ~3000-record scoring latency probe (cohen only)
  --help                          show this help

MODES (legacy positional; default current_hybrid,current_clf + the chosen config):
  current_hybrid  full production hybrid score (what the deployed panel reports)
  current_clf     pure classifier probability (isolates hybrid dilution)
  <versionId>     any ENGINE_CONFIG_VERSIONS entry, scored on its production path

METRICS: AUC (ROC), WSS@95 & WSS@100 (Cohen 2006 work-saved-over-sampling),
recall@k and precision@k for k∈{10,25,50}, held-out (nested-CV) calibration ECE.
Results depend on the engine config version AND seed — both recorded in every row.
See docs/validation/BENCHMARK_README.md for dataset provenance and layouts.`;

function writeOutputs(outDir, payload) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(payload, null, 2), 'utf8');

  const cols = [
    'mode', 'dataset', 'n', 'nPos', 'auc', 'aucCILo', 'aucCIHi',
    'wss95', 'wss95CILo', 'wss95CIHi', 'wss100',
    'recall10', 'recall25', 'recall50', 'precision10', 'precision25', 'precision50',
    'ece', 'engineConfigVersion', 'embeddingProvider', 'seed', 'folds', 'date',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const row of payload.rows) lines.push(cols.map(c => esc(row[c])).join(','));
  writeFileSync(join(outDir, 'results.csv'), lines.join('\n') + '\n', 'utf8');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return; }
  if (!Number.isFinite(opts.folds) || opts.folds < 2) { console.error('--folds must be an integer ≥ 2'); process.exit(2); }
  if (!Number.isFinite(opts.seed)) { console.error('--seed must be an integer'); process.exit(2); }

  const path = opts.path || (opts.dataset === 'cohen' ? DEFAULT_COHEN_DIR : null);

  // Load the dataset family — a missing/empty path throws BenchmarkDataError with
  // human instructions, which we surface and exit non-zero (NO fake results).
  let datasets;
  try {
    datasets = loadDatasetFamily(opts.dataset, path);
  } catch (err) {
    if (err instanceof BenchmarkDataError) { console.error(err.message); process.exit(2); }
    throw err;
  }

  // Scoring modes: explicit positional modes win; otherwise hybrid + clf + chosen config.
  const chosenConfig = opts.config && ENGINE_CONFIG_VERSIONS[opts.config] ? opts.config : null;
  if (opts.config && !chosenConfig) {
    console.error(`Unknown --config "${opts.config}". Known: ${Object.keys(ENGINE_CONFIG_VERSIONS).join(', ')}`);
    process.exit(2);
  }
  const runModes = opts.modes.length
    ? opts.modes
    : ['current_hybrid', 'current_clf', chosenConfig || 'v2-lexical-tuned'];

  const nRecords = datasets.reduce((a, d) => a + d.records.length, 0);
  console.log(`PecanRev screening benchmark — dataset "${opts.dataset}": ${datasets.length} datasets, `
    + `${nRecords} records, ${opts.folds}-fold stratified CV (seed ${opts.seed})`);
  console.log(`Known engine config versions: ${Object.keys(ENGINE_CONFIG_VERSIONS).join(', ')}\n`);

  const allRows = [];
  for (const mode of runModes) {
    const isVersion = !!ENGINE_CONFIG_VERSIONS[mode];
    const cfgVersion = isVersion ? mode : null;
    // engineConfigVersion recorded on each row: an explicit version mode names itself;
    // clf/hybrid modes run under the default deployed config.
    const engineConfigVersion = isVersion ? mode : (mode === 'current_clf' ? 'default(clf)' : 'default(hybrid)');

    console.log(`══ mode: ${mode}${isVersion ? ' (engine config version)' : ''} ══`);
    console.log(`${'dataset'.padEnd(24)}  ${'AUC'.padStart(6)}  ${'WSS@95'.padStart(7)}  ${'WSS@100'.padStart(7)}  `
      + `${'R@10'.padStart(5)}  ${'P@10'.padStart(5)}  ${'ECE'.padStart(6)}   N (pos)`);

    const agg = { auc: [], wss95: [], wss100: [], r10: [], p10: [], ece: [] };
    for (const dataset of datasets) {
      const oof = oofScores(dataset.records, mode, cfgVersion, { seed: opts.seed, folds: opts.folds });
      const m = computeDatasetMetrics(dataset, oof, { seed: opts.seed });
      agg.auc.push(m.auc); agg.wss95.push(m.wss95); agg.wss100.push(m.wss100);
      agg.r10.push(m.recall10); agg.p10.push(m.precision10); agg.ece.push(m.ece);

      console.log(`${String(m.name).padEnd(24)}  ${f3(m.auc)}  ${f3(m.wss95)}  ${f3(m.wss100)}  `
        + `${f3(m.recall10)}  ${f3(m.precision10)}  ${f3(m.ece)}   ${m.n} (${m.nPos})`);

      allRows.push({
        mode, ...m,
        engineConfigVersion, embeddingProvider: 'lexical',
        seed: opts.seed, folds: opts.folds, date: opts.stamp || '',
      });
    }
    console.log(`${'─'.repeat(24)}  ${'─'.repeat(6)}  ${'─'.repeat(7)}  ${'─'.repeat(7)}  ${'─'.repeat(5)}  ${'─'.repeat(5)}  ${'─'.repeat(6)}`);
    console.log(`${'MEAN'.padEnd(24)}  ${f3(mean(agg.auc))}  ${f3(mean(agg.wss95))}  ${f3(mean(agg.wss100))}  `
      + `${f3(mean(agg.r10))}  ${f3(mean(agg.p10))}  ${f3(mean(agg.ece))}\n`);
  }

  if (opts.out) {
    const payload = {
      meta: {
        dataset: opts.dataset, path, modes: runModes,
        folds: opts.folds, seed: opts.seed,
        embeddingProvider: 'lexical',
        date: opts.stamp || null,
        engineConfigVersions: Object.keys(ENGINE_CONFIG_VERSIONS),
      },
      rows: allRows,
    };
    writeOutputs(opts.out, payload);
    console.log(`Wrote ${allRows.length} rows → ${join(opts.out, 'results.json')} + results.csv`);
  }

  if (opts.latency && opts.dataset === 'cohen') {
    // ~3000-record in-process scoring latency (screeningEngine.md task 5).
    const all = [];
    for (const d of datasets) { all.push(...d.records); if (all.length >= 3000) break; }
    const corpus = all.slice(0, 3000).map((r, i) => ({ ...r, id: `rec_${i}` }));
    const nLabeled = 200;
    const labelByRecordId = {};
    corpus.slice(0, nLabeled).forEach(r => { labelByRecordId[r.id] = r.label === 1 ? 'include' : 'exclude'; });
    console.log(`══ latency: full train+score of ${corpus.length} records, ${nLabeled} labelled ══`);
    for (const mode of ['current_hybrid', 'v2-lexical-tuned']) {
      const cfg = ENGINE_CONFIG_VERSIONS[mode] ? resolveEngineConfig(mode) : resolveConfig();
      const t0 = performance.now();
      trainAndScore({ records: corpus, labelByRecordId, config: cfg });
      const dt = performance.now() - t0;
      console.log(`${mode.padEnd(20)} ${dt.toFixed(0)} ms  (${(dt / corpus.length).toFixed(2)} ms/record)`);
    }
  }
}

// Only run when invoked as a script (not when imported by tests).
if (existsSync(fileURLToPath(import.meta.url)) && process.argv[1] &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(err => { console.error(err); process.exit(1); });
}
