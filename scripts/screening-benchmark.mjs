#!/usr/bin/env node
/**
 * screening-benchmark.mjs — leak-free Cohen-2006 benchmark for the PecanRev
 * screening AI engine (screeningEngine.md, tasks 2 & 5 of the validation protocol).
 *
 * Mirrors the reference Python harness (.claude/screening/DEV screening engine/
 * screening_benchmark.py) but drives the ACTUAL deterministic engine primitives
 * (recordFeatures / buildVectorizer / trainLogReg / predictProba / trainAndScore /
 * fitCalibrator), so the numbers it prints are the engine's own — not an
 * independent reimplementation.
 *
 * PROTOCOL (out-of-sample only, screeningEngine.md "Validation protocol"):
 *   - 5-fold stratified CV. Fit the TF-IDF vocabulary on TRAIN folds only; transform
 *     the held-out fold against that train-only vocabulary.
 *   - Pool the out-of-fold predicted probabilities, then:
 *       AUC      = ROC AUC over pooled OOF scores.
 *       WSS@95   = 0.95 − r/N (r = records read to reach 95% recall, ranked desc).
 *       held-out ECE = nested calibration: fit isotonic on a calibration split,
 *                      evaluate ECE on a SEPARATE held-out split (10 equal-width bins).
 *   - Reported per-dataset and as the mean over all 15 Cohen datasets.
 *
 * Scoring modes compared (decomposes WHERE the deployed gap comes from):
 *   current_hybrid : DEFAULT_AI_CONFIG, validated on the fused hybrid score
 *                    (this is what the deployed panel reports — target ≈ 0.81/0.24).
 *   current_clf    : DEFAULT_AI_CONFIG features, validated on the PURE classifier
 *                    probability (isolates the hybrid-dilution effect).
 *   <version>      : any named ENGINE_CONFIG_VERSIONS entry (e.g. v2-lexical-tuned),
 *                    validated on its own production scoring path.
 *
 * USAGE:
 *   node scripts/screening-benchmark.mjs                  # default: current_hybrid,current_clf,v2-lexical-tuned
 *   node scripts/screening-benchmark.mjs v2-lexical-tuned # one or more modes
 *   node scripts/screening-benchmark.mjs --latency        # also run the ~3000-record latency probe
 *   node scripts/screening-benchmark.mjs --data <dir>     # override the Cohen CSV directory
 *
 * Deterministic: fixed seed everywhere; same inputs → same numbers.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
  fitCalibrator,
  applyCalibrator,
  expectedCalibrationError,
  calibrationSlopeIntercept,
} from '../src/research-engine/screening/ai/index.js';
import { ENGINE_CONFIG_VERSIONS, resolveEngineConfig } from '../src/research-engine/screening/ai/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = resolve(__dirname, '..', '.claude', 'screening', 'DEV screening engine', 'cohen_datasets_plus');
const SEED = 1337;
const K = 5;

// ── Minimal RFC-4180 CSV parser (quoted fields with embedded commas/newlines/""). ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* swallow */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadDataset(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  const idx = (name) => header.indexOf(name);
  const iL = idx('label'), iT = idx('title'), iA = idx('abstract');
  const iM = idx('mesh'), iK = idx('keywords'), iJ = idx('journal'), iP = idx('pmid');
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < header.length) continue;
    const label = parseInt(row[iL], 10);
    if (label !== 0 && label !== 1) continue;
    out.push({
      id: `${row[iP] || r}`,
      label,
      title: row[iT] || '',
      abstract: row[iA] || '',
      // The engine reads MeSH from `keywords`; concat the dataset's mesh+keywords there
      // so the "rich"/keyword-feature path has the same inputs the Python harness used.
      keywords: [row[iM] || '', row[iK] || ''].filter(Boolean).join('; '),
      journal: row[iJ] || '',
    });
  }
  return out;
}

// ── Out-of-fold scoring under a given mode ──────────────────────────────────────
function oofScores(records, mode, cfgVersion) {
  const ids = records.map(r => r.id);
  const labelOf = (id) => records.find(r => r.id === id).label;
  const recById = new Map(records.map(r => [r.id, r]));
  const folds = stratifiedFolds(ids, (id) => recById.get(id).label, K, SEED);
  const foldOf = new Map();
  folds.forEach((f, fi) => f.forEach(id => foldOf.set(id, fi)));

  const cfg = cfgVersion ? resolveEngineConfig(cfgVersion) : resolveConfig();
  const oof = new Array(records.length).fill(null);
  const idxOf = new Map(records.map((r, i) => [r.id, i]));

  for (let f = 0; f < K; f++) {
    const held = new Set(folds[f]);
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

// ── Held-out (nested) ECE: fit isotonic on calib split, evaluate on held-out split ──
function heldOutEce(records, oof) {
  // Split the labelled OOF pairs into two stratified halves: fit a calibrator on the
  // first, measure ECE/slope on the second (never on the points used to fit) — the
  // honest measurement screeningEngine.md task 4 requires.
  const pairs = records.map((r, i) => ({ s: oof[i], y: r.label })).filter(p => p.s != null);
  const pos = pairs.filter(p => p.y === 1), neg = pairs.filter(p => p.y === 0);
  const calib = [], evalSet = [];
  pos.forEach((p, i) => (i % 2 === 0 ? calib : evalSet).push(p));
  neg.forEach((p, i) => (i % 2 === 0 ? calib : evalSet).push(p));
  if (calib.length < 10 || evalSet.length < 10) return { ece: null, slope: null };
  const cal = fitCalibrator(calib.map(p => p.s), calib.map(p => p.y), { minSamplesToCalibrate: 20, isotonicMinSamples: 100, eceBins: 10 });
  if (cal.method === 'none') return { ece: null, slope: null };
  const probs = evalSet.map(p => applyCalibrator(cal.params, p.s));
  const labels = evalSet.map(p => p.y);
  return { ece: expectedCalibrationError(probs, labels, 10), slope: calibrationSlopeIntercept(probs, labels).slope };
}

function mean(xs) { const v = xs.filter(x => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
const f3 = (x) => (x == null ? '  —  ' : x.toFixed(3));

async function main() {
  const argv = process.argv.slice(2);
  const wantLatency = argv.includes('--latency');
  const dataIdx = argv.indexOf('--data');
  const dataDir = dataIdx >= 0 ? argv[dataIdx + 1] : DEFAULT_DATA_DIR;
  const modes = argv.filter(a => !a.startsWith('--') && a !== (dataIdx >= 0 ? argv[dataIdx + 1] : null));
  const runModes = modes.length ? modes : ['current_hybrid', 'current_clf', 'v2-lexical-tuned'];

  if (!existsSync(dataDir)) {
    console.error(`Cohen dataset directory not found: ${dataDir}`);
    console.error('Pass --data <dir> with cohen_*.csv files (columns: pmid,label,title,abstract,mesh,keywords,journal).');
    process.exit(2);
  }
  const files = readdirSync(dataDir).filter(f => f.startsWith('cohen_') && f.endsWith('.csv')).sort();
  console.log(`PecanRev screening benchmark — ${files.length} Cohen datasets, ${K}-fold stratified CV (seed ${SEED})`);
  console.log(`Known engine config versions: ${Object.keys(ENGINE_CONFIG_VERSIONS).join(', ')}\n`);

  for (const mode of runModes) {
    const isVersion = !!ENGINE_CONFIG_VERSIONS[mode];
    const cfgVersion = isVersion ? mode : null;
    console.log(`══ mode: ${mode}${isVersion ? ' (engine config version)' : ''} ══`);
    console.log(`${'dataset'.padEnd(24)}  ${'AUC'.padStart(6)}  ${'WSS@95'.padStart(7)}  ${'ECE_ho'.padStart(7)}  ${'slope'.padStart(6)}   N (pos)`);
    const aucs = [], wsss = [], eces = [], slopes = [];
    for (const file of files) {
      const records = loadDataset(join(dataDir, file));
      const labels = records.map(r => r.label);
      const oof = oofScores(records, mode, cfgVersion);
      const scored = oof.map((s, i) => ({ s, y: labels[i] })).filter(p => p.s != null);
      const sc = scored.map(p => p.s), ly = scored.map(p => p.y);
      const auc = rocAuc(sc, ly);
      const w = wssAtRecall(sc, ly, 0.95);
      const wss = w ? w.wss : null;
      const { ece, slope } = heldOutEce(records, oof);
      const nPos = labels.reduce((a, b) => a + b, 0);
      aucs.push(auc); wsss.push(wss); eces.push(ece); slopes.push(slope);
      const name = file.replace('cohen_', '').replace('.csv', '');
      console.log(`${name.padEnd(24)}  ${f3(auc)}  ${f3(wss)}  ${f3(ece)}  ${f3(slope)}   ${records.length} (${nPos})`);
    }
    console.log(`${'─'.repeat(24)}  ${'─'.repeat(6)}  ${'─'.repeat(7)}  ${'─'.repeat(7)}  ${'─'.repeat(6)}`);
    console.log(`${'MEAN'.padEnd(24)}  ${f3(mean(aucs))}  ${f3(mean(wsss))}  ${f3(mean(eces))}  ${f3(mean(slopes))}\n`);
  }

  if (wantLatency) {
    // ~3000-record in-process scoring latency (screeningEngine.md task 5). Build a
    // ~3000-record corpus by concatenating datasets; score under each mode.
    const all = [];
    for (const file of files) { all.push(...loadDataset(join(dataDir, file))); if (all.length >= 3000) break; }
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

main().catch(err => { console.error(err); process.exit(1); });
