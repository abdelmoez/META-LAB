/**
 * loaders.mjs — dataset loaders for the PecanRev screening-AI benchmark harness.
 *
 * Every loader returns the SAME normalized benchmark schema:
 *
 *   {
 *     id:   string,                       // dataset identifier (e.g. "ADHD")
 *     name: string,                       // human label for the table
 *     records: Array<{
 *       id:       string,                 // stable per-record id
 *       title:    string,
 *       abstract: string,
 *       keywords: string,                 // MeSH + author keywords, `; `-joined
 *       year:     number|null,            // publication year if known, else null
 *       label:    0|1,                    // 1 = include (human final decision)
 *     }>
 *   }
 *
 * A dataset FAMILY (cohen / synergy / clef) usually contains several datasets;
 * each loader returns an ARRAY of the objects above.
 *
 * POLICY — NO BUNDLED DATA. The SYNERGY and CLEF loaders read only from a
 * user-provided path. When that path is missing/empty they throw a
 * `BenchmarkDataError` carrying human instructions (where to obtain the data and
 * the expected layout); the CLI turns that into a clear message + non-zero exit.
 * They NEVER synthesize records.
 *
 * Pure + deterministic: parsing only, no RNG, no network. The engine's seeded CV
 * makes the downstream numbers reproducible.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Error type the CLI recognises to print instructions and exit non-zero (no fake data). */
export class BenchmarkDataError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BenchmarkDataError';
  }
}

// ── Minimal RFC-4180 CSV parser (quoted fields with embedded commas/newlines/""). ──
// Byte-identical behaviour to the parser the harness shipped with, so the Cohen
// loader produces the exact same records it did before this refactor.
export function parseCsv(text) {
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

/** Parse a CSV string into `{ header: string[], rows: string[][] }` (data rows only). */
function parseCsvTable(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { header: [], rows: [] };
  return { header: rows[0].map(h => h.trim()), rows: rows.slice(1) };
}

/** Case-insensitive header lookup returning the first matching column index, or -1. */
function findCol(header, candidates) {
  const lower = header.map(h => h.toLowerCase());
  for (const cand of candidates) {
    const i = lower.indexOf(cand.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/** Coerce a variety of truthy label spellings to 0/1, or null if unrecognised. */
function coerceLabel(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'included' || s === 'include') return 1;
  if (s === '0' || s === 'false' || s === 'no' || s === 'excluded' || s === 'exclude') return 0;
  const n = Number(s);
  if (n === 1) return 1;
  if (n === 0) return 0;
  return null;
}

/** Extract a 4-digit year from a free-form date/year string, or null. */
function coerceYear(raw) {
  if (raw == null) return null;
  const m = String(raw).match(/(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return (y >= 1800 && y <= 2100) ? y : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Cohen 2006 loader — the historical default. Kept BYTE-COMPATIBLE with the
// harness's original inline `loadDataset`: same id/title/abstract/keywords, same
// row-skipping rules, so the benchmark prints identical AUC/WSS for the same args.
// ────────────────────────────────────────────────────────────────────────────

/** Load ONE Cohen CSV file into the normalized `{id,name,records}` shape. */
export function loadCohenFile(path) {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  const records = [];
  if (rows.length) {
    const header = rows[0].map(h => h.trim());
    const idx = (name) => header.indexOf(name);
    const iL = idx('label'), iT = idx('title'), iA = idx('abstract');
    const iM = idx('mesh'), iK = idx('keywords'), iJ = idx('journal'), iP = idx('pmid');
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length < header.length) continue;
      const label = parseInt(row[iL], 10);
      if (label !== 0 && label !== 1) continue;
      records.push({
        id: `${row[iP] || r}`,
        label,
        title: row[iT] || '',
        abstract: row[iA] || '',
        // The engine reads MeSH from `keywords`; concat mesh+keywords there so the
        // keyword-feature path sees the same inputs the original harness used.
        keywords: [row[iM] || '', row[iK] || ''].filter(Boolean).join('; '),
        // `journal` is a weighted engine feature (fieldWeights.journal); keep it so
        // scores stay byte-identical to the original inline loader. It is NOT part of
        // the cross-family normalized schema — synergy/clef records omit it — but the
        // engine only reads fields it knows, so carrying it here is safe.
        journal: row[iJ] || '',
        year: null,
      });
    }
  }
  const base = path.split(/[\\/]/).pop() || path;
  const name = base.replace(/^cohen_/, '').replace(/\.csv$/i, '');
  return { id: name, name, records };
}

/**
 * loadCohen — load every `cohen_*.csv` in a directory (sorted), normalized.
 * @param {string} dir
 * @returns {Array<{id,name,records}>}
 */
export function loadCohen(dir) {
  if (!dir || !existsSync(dir)) {
    throw new BenchmarkDataError(cohenInstructions(dir));
  }
  const files = readdirSync(dir).filter(f => f.startsWith('cohen_') && f.endsWith('.csv')).sort();
  if (!files.length) {
    throw new BenchmarkDataError(cohenInstructions(dir));
  }
  return files.map(f => loadCohenFile(join(dir, f)));
}

function cohenInstructions(dir) {
  return [
    `Cohen 2006 dataset directory not found or empty: ${dir || '(none given)'}`,
    '',
    'Expected layout: <dir>/cohen_<Name>.csv, each with a header row:',
    '  pmid,label,title,abstract,mesh,keywords,journal',
    'where label ∈ {0,1} (1 = include). This repo ships the 15 Cohen datasets under',
    '  .claude/screening/DEV screening engine/cohen_datasets_plus/',
    'Pass --path <dir> to point elsewhere. Original source: Cohen et al. 2006,',
    '"Reducing Workload in Systematic Review Preparation…", J Am Med Inform Assoc.',
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// SYNERGY loader — asreview/synergy-dataset. One CSV per dataset. Column names
// vary across releases, so accept the common variants tolerantly.
//   title:    title | primary_title
//   abstract: abstract | abstract_note
//   label:    label_included | included | label   (1 = include)
//   keywords: keywords | mesh_terms  (optional)
//   year:     year | publication_year            (optional)
//   id:       openalex_id | doi | id | record_id  (optional; falls back to row #)
// ────────────────────────────────────────────────────────────────────────────

/** Load ONE SYNERGY CSV file into the normalized shape. */
export function loadSynergyFile(path) {
  const { header, rows } = parseCsvTable(readFileSync(path, 'utf8'));
  if (!header.length) throw new BenchmarkDataError(`SYNERGY CSV has no header: ${path}`);

  const iTitle = findCol(header, ['title', 'primary_title']);
  const iAbstract = findCol(header, ['abstract', 'abstract_note']);
  const iLabel = findCol(header, ['label_included', 'included', 'label']);
  const iKeywords = findCol(header, ['keywords', 'mesh_terms', 'mesh']);
  const iYear = findCol(header, ['year', 'publication_year']);
  const iId = findCol(header, ['openalex_id', 'doi', 'id', 'record_id']);

  if (iLabel < 0) {
    throw new BenchmarkDataError(
      `SYNERGY CSV ${path} has no recognizable label column ` +
      `(looked for: label_included, included, label). Found: ${header.join(', ')}`);
  }
  if (iTitle < 0 && iAbstract < 0) {
    throw new BenchmarkDataError(
      `SYNERGY CSV ${path} has neither a title nor an abstract column. Found: ${header.join(', ')}`);
  }

  const records = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const label = coerceLabel(row[iLabel]);
    if (label == null) continue; // skip unlabelled / unrecognised rows (never invent a label)
    records.push({
      id: `${(iId >= 0 && row[iId]) ? row[iId] : `row${r}`}`,
      label,
      title: iTitle >= 0 ? (row[iTitle] || '') : '',
      abstract: iAbstract >= 0 ? (row[iAbstract] || '') : '',
      keywords: iKeywords >= 0 ? (row[iKeywords] || '') : '',
      year: iYear >= 0 ? coerceYear(row[iYear]) : null,
    });
  }
  const base = path.split(/[\\/]/).pop() || path;
  const name = base.replace(/\.csv$/i, '');
  return { id: name, name, records };
}

/**
 * loadSynergy — load SYNERGY data from a user-provided path. The path may be a
 * single CSV file OR a directory of `*.csv` (one dataset per file).
 * @param {string} path
 * @returns {Array<{id,name,records}>}
 */
export function loadSynergy(path) {
  if (!path || !existsSync(path)) {
    throw new BenchmarkDataError(synergyInstructions(path));
  }
  const st = statSync(path);
  let files;
  if (st.isDirectory()) {
    files = readdirSync(path).filter(f => f.toLowerCase().endsWith('.csv')).sort();
    if (!files.length) throw new BenchmarkDataError(synergyInstructions(path));
    files = files.map(f => join(path, f));
  } else {
    files = [path];
  }
  const datasets = files.map(f => loadSynergyFile(f)).filter(d => d.records.length);
  if (!datasets.length) throw new BenchmarkDataError(synergyInstructions(path));
  return datasets;
}

function synergyInstructions(path) {
  return [
    `SYNERGY dataset path not found or empty: ${path || '(none given)'}`,
    '',
    'The SYNERGY dataset is NOT bundled with this repo. Obtain it from:',
    '  https://github.com/asreview/synergy-dataset  (CC-licensed; see repo for terms)',
    '',
    'Expected: a directory of one-CSV-per-dataset, OR a single dataset CSV, with columns',
    '(tolerant to variants):',
    '  title | primary_title',
    '  abstract | abstract_note',
    '  label_included | included | label   (1 = include, 0 = exclude)',
    '  keywords | mesh_terms                (optional)',
    '  year | publication_year             (optional)',
    '  openalex_id | doi | id | record_id  (optional record id)',
    '',
    'Then run:  node scripts/screening-benchmark.mjs --dataset synergy --path <dir-or-csv>',
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// CLEF eHealth TAR loader (2017–2019). Raw CLEF distributions vary widely, so we
// accept a SIMPLIFIED PREPARED layout the user builds from the official release:
//
//   <path>/<topic>/records.csv   (header: id,title,abstract)
//   <path>/<topic>/qrels.txt     (lines: "<topic> 0 <docid> <relevance>")
//
// The BENCHMARK_README documents how to derive this layout and is honest that the
// user must prepare it from the official distribution — we bundle nothing.
// ────────────────────────────────────────────────────────────────────────────

/** Parse a CLEF-style qrels file → Map<docid, 0|1>. Lines: `topic 0 docid rel`. */
export function parseQrels(text) {
  const rel = new Map();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 4) continue;
    const docid = parts[2];
    const r = parseInt(parts[3], 10);
    if (!docid || Number.isNaN(r)) continue;
    rel.set(docid, r > 0 ? 1 : 0);
  }
  return rel;
}

/** Load ONE prepared CLEF topic directory into the normalized shape. */
export function loadClefTopic(topicDir, topicId) {
  const recordsCsv = join(topicDir, 'records.csv');
  const qrelsTxt = join(topicDir, 'qrels.txt');
  if (!existsSync(recordsCsv) || !existsSync(qrelsTxt)) {
    throw new BenchmarkDataError(
      `CLEF topic "${topicId}" is missing records.csv and/or qrels.txt in ${topicDir}`);
  }
  const rel = parseQrels(readFileSync(qrelsTxt, 'utf8'));
  const { header, rows } = parseCsvTable(readFileSync(recordsCsv, 'utf8'));
  const iId = findCol(header, ['id', 'docid', 'pmid', 'record_id']);
  const iTitle = findCol(header, ['title']);
  const iAbstract = findCol(header, ['abstract']);
  if (iId < 0) {
    throw new BenchmarkDataError(
      `CLEF topic "${topicId}" records.csv has no id column (looked for id,docid,pmid). Found: ${header.join(', ')}`);
  }
  const records = [];
  for (const row of rows) {
    if (!row || !row.length) continue;
    const docid = row[iId];
    if (!docid || !rel.has(docid)) continue; // only judged docs are labelled
    records.push({
      id: `${docid}`,
      label: rel.get(docid),
      title: iTitle >= 0 ? (row[iTitle] || '') : '',
      abstract: iAbstract >= 0 ? (row[iAbstract] || '') : '',
      keywords: '',
      year: null,
    });
  }
  return { id: `${topicId}`, name: `CLEF ${topicId}`, records };
}

/**
 * loadClef — load a prepared CLEF path: a directory whose immediate subdirectories
 * are topics, each containing records.csv + qrels.txt.
 * @param {string} path
 * @returns {Array<{id,name,records}>}
 */
export function loadClef(path) {
  if (!path || !existsSync(path)) {
    throw new BenchmarkDataError(clefInstructions(path));
  }
  const topics = readdirSync(path).filter(name => {
    const p = join(path, name);
    try { return statSync(p).isDirectory(); } catch { return false; }
  }).sort();
  if (!topics.length) throw new BenchmarkDataError(clefInstructions(path));
  const datasets = topics.map(t => loadClefTopic(join(path, t), t)).filter(d => d.records.length);
  if (!datasets.length) throw new BenchmarkDataError(clefInstructions(path));
  return datasets;
}

function clefInstructions(path) {
  return [
    `CLEF eHealth TAR dataset path not found or empty: ${path || '(none given)'}`,
    '',
    'CLEF eHealth Technology-Assisted Review data is NOT bundled with this repo and',
    'must be obtained (and its licence accepted) from the official task pages:',
    '  CLEF eHealth 2017/2018/2019 TAR — https://github.com/CLEF-TAR/tar',
    '',
    'Raw CLEF distributions vary, so this harness reads a SIMPLIFIED PREPARED layout',
    'you build from the official release:',
    '  <path>/<topic>/records.csv   (header: id,title,abstract)',
    '  <path>/<topic>/qrels.txt     (lines: "<topic> 0 <docid> <relevance>")',
    'A doc is an INCLUDE (label 1) when its qrels relevance > 0, else EXCLUDE (0).',
    'Only docs present in BOTH files are used. See docs/validation/BENCHMARK_README.md',
    'for how to derive this layout from the official qrels + PMID abstract dumps.',
    '',
    'Then run:  node scripts/screening-benchmark.mjs --dataset clef --path <dir>',
  ].join('\n');
}

// ── Family dispatch ───────────────────────────────────────────────────────────
export const LOADERS = { cohen: loadCohen, synergy: loadSynergy, clef: loadClef };

/**
 * loadDatasetFamily — dispatch to the right loader by family name.
 * @param {'cohen'|'synergy'|'clef'} family
 * @param {string} path
 * @returns {Array<{id,name,records}>}
 */
export function loadDatasetFamily(family, path) {
  const fn = LOADERS[family];
  if (!fn) throw new BenchmarkDataError(`Unknown dataset family "${family}". Expected one of: ${Object.keys(LOADERS).join(', ')}`);
  return fn(path);
}
