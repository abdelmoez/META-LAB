/**
 * extraction/tableParse.js — P5. Pure, dependency-free table parsing to help a
 * reviewer paste a results table (CSV/TSV/pipe text OR an HTML <table>) and turn it
 * into a grid the extraction UI can map onto Data Elements.
 *
 * NO dependencies, NO DOM. The HTML parser is a small tolerant state machine over a
 * regex token stream — it is NOT a spec-compliant HTML parser and does not try to
 * be. It only needs to survive the messy <table> markup people paste from PDFs and
 * journal sites.
 *
 * SAFETY: every parser caps output at MAX_ROWS × MAX_COLS so a pathological paste
 * (or a crafted input) can't blow up memory or time.
 */

export const MAX_ROWS = 5000;
export const MAX_COLS = 200;

/**
 * parseDelimited(text) — auto-detect the delimiter among comma, semicolon, tab, and
 * pipe, then parse to a rectangular-ish grid of trimmed string cells.
 *
 * Quoting: double-quote wrapped fields are supported (RFC-4180 style), including
 * escaped quotes ("") and embedded delimiters/newlines inside quotes. Only the
 * detected delimiter is special; the others are literal.
 *
 * @param {string} text
 * @returns {{ rows: string[][], delimiter: ','|';'|'\t'|'|' }}
 */
export function parseDelimited(text) {
  const src = typeof text === 'string' ? text : '';
  const delimiter = detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = src.length;
  let started = false; // whether the current row has any content/field yet

  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    // Drop a trailing fully-empty row (e.g. file ends in newline).
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row.length > MAX_COLS ? row.slice(0, MAX_COLS) : row);
    }
    row = [];
    started = false;
  };

  while (i < n) {
    if (rows.length >= MAX_ROWS) break;
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      started = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      started = true;
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      if (started || field.length) pushRow();
      i += 1;
      continue;
    }
    field += ch;
    started = true;
    i += 1;
  }
  // Flush the final field/row (no trailing newline).
  if (started || field.length) pushRow();

  return { rows, delimiter };
}

/**
 * detectDelimiter(text) — pick the delimiter that yields the most consistent column
 * count across the first few non-empty lines. Ties break in priority order
 * comma > tab > semicolon > pipe (comma is the most common). Falls back to comma.
 */
export function detectDelimiter(text) {
  const candidates = [',', '\t', ';', '|'];
  const lines = String(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20);
  if (!lines.length) return ',';

  let best = ',';
  let bestScore = -Infinity;
  for (const d of candidates) {
    // Count occurrences per line (quote-naive; good enough for detection).
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const total = counts.reduce((a, c) => a + c, 0);
    if (total === 0) continue;
    // Reward consistency (low variance in column count) and presence.
    const cols = counts.map((c) => c + 1);
    const mean = cols.reduce((a, c) => a + c, 0) / cols.length;
    const variance = cols.reduce((a, c) => a + (c - mean) ** 2, 0) / cols.length;
    const score = mean * 10 - variance; // more columns, more consistent = better
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line, delim) {
  let inQ = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQ = !inQ;
    } else if (ch === delim && !inQ) {
      count += 1;
    }
  }
  return count;
}

/**
 * parseHtmlTables(html) — extract every <table> as { caption, rows } where rows is
 * string[][] of decoded, tag-stripped cell text. Tolerant of missing closing tags,
 * mixed case, and attributes. <th> and <td> are both treated as cells.
 *
 * @param {string} html
 * @returns {Array<{ caption: string, rows: string[][] }>}
 */
export function parseHtmlTables(html) {
  const src = typeof html === 'string' ? html : '';
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = tableRe.exec(src)) !== null) {
    if (tables.length >= MAX_ROWS) break;
    const inner = m[1];
    const caption = extractCaption(inner);
    const rows = extractRows(inner);
    tables.push({ caption, rows });
  }
  // Handle a final <table> with no closing tag (tolerant fallback).
  if (tables.length === 0) {
    const open = /<table\b[^>]*>([\s\S]*)$/i.exec(src);
    if (open) {
      const inner = open[1];
      tables.push({ caption: extractCaption(inner), rows: extractRows(inner) });
    }
  }
  return tables;
}

function extractCaption(inner) {
  const c = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(inner);
  return c ? decodeEntities(stripTags(c[1])).trim() : '';
}

function extractRows(inner) {
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)(?:<\/tr>|(?=<tr\b)|$)/gi;
  let rm;
  while ((rm = rowRe.exec(inner)) !== null) {
    if (rows.length >= MAX_ROWS) break;
    const rowHtml = rm[1];
    if (!rowHtml || !/<(td|th)\b/i.test(rowHtml)) continue;
    const cells = [];
    const cellRe = /<(td|th)\b[^>]*>([\s\S]*?)(?:<\/(?:td|th)>|(?=<(?:td|th)\b)|$)/gi;
    let cm;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      if (cells.length >= MAX_COLS) break;
      cells.push(decodeEntities(stripTags(cm[2])).trim());
    }
    if (cells.length) rows.push(cells);
    if (rm.index === rowRe.lastIndex) rowRe.lastIndex++; // guard zero-width match
  }
  return rows;
}

/** stripTags — remove any remaining HTML tags and collapse block breaks to spaces. */
function stripTags(s) {
  return String(s)
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * decodeEntities — decode the handful of named entities we care about plus numeric
 * (&#NN; and &#xNN;) references. Dependency-free; not exhaustive by design.
 */
export function decodeEntities(s) {
  const named = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&nbsp;': ' ',
  };
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (ent) => (ent.toLowerCase() in named ? named[ent.toLowerCase()] : ent));
}

function safeCodePoint(cp) {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch (_) {
    return '';
  }
}

/**
 * gridQuality(rows) — a rough 0..1 confidence that `rows` is a real data table
 * worth mapping, plus human-readable reasons. Rewards rectangularness, a header +
 * body, numeric density in the body, and a minimum size; penalizes ragged rows and
 * tiny/degenerate grids.
 *
 * @param {string[][]} rows
 * @returns {{ score:number, reasons:string[] }}
 */
export function gridQuality(rows) {
  const reasons = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { score: 0, reasons: ['empty grid'] };
  }
  const nRows = rows.length;
  const colCounts = rows.map((r) => (Array.isArray(r) ? r.length : 0));
  const maxCols = Math.max(...colCounts);
  const minCols = Math.min(...colCounts);

  if (maxCols < 2 || nRows < 2) {
    reasons.push('too small to be a table (need ≥2 rows and ≥2 columns)');
  }

  // Rectangularness: fraction of rows that have the modal column count.
  const modeCols = modalValue(colCounts);
  const rectFrac = colCounts.filter((c) => c === modeCols).length / nRows;
  if (rectFrac >= 0.9) reasons.push('rows are rectangular');
  else if (rectFrac < 0.6) reasons.push('rows are ragged (inconsistent column counts)');

  // Numeric density in the body (skip the first row as a likely header).
  const body = rows.slice(1);
  let numCells = 0;
  let totalCells = 0;
  for (const r of body) {
    for (const c of r || []) {
      totalCells += 1;
      if (looksNumeric(c)) numCells += 1;
    }
  }
  const numDensity = totalCells === 0 ? 0 : numCells / totalCells;
  if (numDensity >= 0.3) reasons.push('body has meaningful numeric content');
  else reasons.push('body has little numeric content');

  // Score: weighted blend, clamped to [0,1].
  const sizeScore = clamp01((Math.min(nRows, 10) / 10) * 0.5 + (Math.min(maxCols, 6) / 6) * 0.5);
  const raggedPenalty = minCols === maxCols ? 0 : 0.1;
  const score = clamp01(0.4 * rectFrac + 0.35 * numDensity + 0.25 * sizeScore - raggedPenalty);

  return { score, reasons };
}

function modalValue(arr) {
  const counts = new Map();
  let best = arr[0];
  let bestN = 0;
  for (const v of arr) {
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  return best;
}

/** looksNumeric — cell parses as a number, possibly with %, commas, or ± notation. */
export function looksNumeric(cell) {
  if (cell == null) return false;
  const s = String(cell).trim();
  if (s === '') return false;
  const cleaned = s.replace(/[,%\s]/g, '').replace(/±.*$/, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return false;
  return Number.isFinite(Number(cleaned));
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
