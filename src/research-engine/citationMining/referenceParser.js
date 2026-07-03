/**
 * referenceParser.js — P15 Bibliomine. Deterministic, network-free reference
 * parser. PARSER-FIRST design: (1) locate the bibliography section in extracted
 * seed-review text, (2) segment it into entries, (3) extract fields with an
 * HONEST per-entry confidence. Never throws on garbage — it returns warnings.
 *
 * Not an "AI" — pure string heuristics. Fields are only reported when they parse
 * cleanly; nothing is fabricated, and `confidence` reflects how much was found.
 *
 * Known accuracy caveats (documented, not hidden):
 *   - Journal ABBREVIATIONS with internal periods ("N. Engl. J. Med.") are kept
 *     verbatim once the title is isolated, but a title containing ". " (e.g.
 *     "vs. placebo") can be truncated at that boundary.
 *   - Reference lists with NO numbering, blank lines, or indentation are the
 *     genuinely ambiguous case; we segment by line and flag it in `warnings`.
 */

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// Common PDF ligatures → ASCII so titles/authors compare cleanly.
const LIGATURES = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'], [/ﬅ/g, 'st'], [/ﬆ/g, 'st'],
];

/** Normalize messy extracted text: line endings, ligatures, quotes, de-hyphenation. */
function normalizeText(text) {
  let t = String(text == null ? '' : text);
  t = t.replace(/\r\n?/g, '\n');
  for (const [re, rep] of LIGATURES) t = t.replace(re, rep);
  t = t.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  // De-hyphenate a word split across a line break: "anti-\ncoagulation" → "anticoagulation".
  t = t.replace(/([A-Za-z])-\n([a-z])/g, '$1$2');
  return t;
}

const HEADING_RE = /^\s*(?:\d+\.?\s*)?(references?|bibliography|literature cited|works cited|reference list)\s*:?\s*$/i;
const STOP_RE = /^\s*(?:\d+\.?\s*)?(appendix|appendices|acknowledge?ments?|supplementary|author contributions?|funding|conflicts? of interest|competing interests?|declarations?)\b/i;

/**
 * Locate the reference/bibliography section. Uses the LAST matching heading (so a
 * table-of-contents "References" line loses to the real one) and stops at a
 * following top-level section (Appendix / Acknowledgements / …). When no heading
 * is present, the whole input is treated as the list.
 */
function locateReferenceSection(text) {
  const lines = text.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) if (HEADING_RE.test(lines[i])) startIdx = i;
  if (startIdx === -1) return { body: text, foundHeading: false };
  const rest = lines.slice(startIdx + 1);
  let endRel = rest.length;
  for (let i = 0; i < rest.length; i++) { if (STOP_RE.test(rest[i])) { endRel = i; break; } }
  return { body: rest.slice(0, endRel).join('\n'), foundHeading: true };
}

const NUM_PATTERNS = [
  { style: 'numbered-bracket', re: /^\s*\[(\d+)\]\s*/ },
  { style: 'numbered-dot', re: /^\s*(\d+)\.\s+/ },
  { style: 'numbered-paren', re: /^\s*\((\d+)\)\s*/ },
];

/** Pick the numbering style whose markers form the longest near-monotonic run starting low. */
function detectNumbering(lines) {
  let best = null;
  for (const p of NUM_PATTERNS) {
    const marks = [];
    lines.forEach((ln) => { const m = p.re.exec(ln); if (m) marks.push(+m[1]); });
    if (marks.length < 2) continue;
    let inc = 0;
    for (let k = 1; k < marks.length; k++) if (marks[k] > marks[k - 1]) inc++;
    const monotonic = inc >= marks.length - 1 - Math.floor(marks.length * 0.1);
    const startsLow = marks[0] <= 2;
    if (monotonic && startsLow && (!best || marks.length > best.count)) best = { ...p, count: marks.length };
  }
  return best;
}

/** Segment section body into raw entry strings; returns the segmentation style + warnings. */
function segmentEntries(body) {
  const lines = body.split('\n');
  const numbering = detectNumbering(lines);
  const warnings = [];
  let entries = [];
  let style;

  if (numbering) {
    style = numbering.style;
    let cur = null;
    for (const ln of lines) {
      if (numbering.re.test(ln)) {
        if (cur != null) entries.push(cur);
        cur = ln.replace(numbering.re, '');
      } else if (cur != null && ln.trim()) {
        cur += ' ' + ln.trim();
      }
    }
    if (cur != null) entries.push(cur);
  } else {
    const contentLines = lines.filter((l) => l.trim().length);
    const indented = contentLines.filter((l) => /^(\s{2,}|\t)/.test(l));
    if (/\n\s*\n/.test(body.trim())) {
      style = 'blank-separated';
      entries = body.split(/\n\s*\n+/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
    } else if (indented.length >= 1 && indented.length < contentLines.length) {
      style = 'hanging-indent';
      let cur = null;
      for (const ln of lines) {
        if (!ln.trim()) continue;
        if (/^(\s{2,}|\t)/.test(ln)) { if (cur != null) cur += ' ' + ln.trim(); else cur = ln.trim(); }
        else { if (cur != null) entries.push(cur); cur = ln.trim(); }
      }
      if (cur != null) entries.push(cur);
    } else {
      style = 'line-per-entry';
      let cur = null;
      for (const ln of contentLines) {
        const t = ln.trim();
        if (cur != null && /^[a-z(]/.test(t)) cur += ' ' + t; // obvious wrapped continuation
        else { if (cur != null) entries.push(cur); cur = t; }
      }
      if (cur != null) entries.push(cur);
      warnings.push('No numbering, blank lines, or indentation detected — segmented by line; multi-line entries may be split.');
    }
  }

  entries = entries.map((e) => e.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return { entries, style, warnings };
}

// ── Per-entry field extraction ───────────────────────────────────────────────

const DOI_RE = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;
const PMID_RE = /pmid:?\s*(\d{1,9})/i;
const URL_RE = /https?:\/\/[^\s<>()]+/i;
const YEAR_RE = /\b(?:19|20)\d{2}[a-z]?\b/g;
const PAREN_YEAR_RE = /\(\s*((?:19|20)\d{2})[a-z]?\s*\)/;

/** Trim trailing punctuation and an unbalanced trailing ')' from a DOI. */
function stripDoiTail(doi) {
  let d = doi.replace(/[.,;>]+$/, '');
  const open = (d.match(/\(/g) || []).length;
  const close = (d.match(/\)/g) || []).length;
  if (close > open && d.endsWith(')')) d = d.slice(0, -1).replace(/[.,;]+$/, '');
  return d;
}

function extractDoi(s) {
  const m = DOI_RE.exec(s);
  return m ? stripDoiTail(m[0]) : '';
}

function extractYear(s, maxYear) {
  const paren = PAREN_YEAR_RE.exec(s);
  if (paren && +paren[1] >= 1900 && +paren[1] <= maxYear) return String(+paren[1]);
  YEAR_RE.lastIndex = 0;
  let m;
  while ((m = YEAR_RE.exec(s))) {
    const y = +m[0].slice(0, 4);
    if (y >= 1900 && y <= maxYear) return String(y);
  }
  return '';
}

/** Heuristic: does this leading segment read like an author list? */
function looksLikeAuthors(s) {
  const t = clean(s);
  if (!t || t.length > 350) return false;
  if (/\bet al\.?/i.test(t)) return true;
  if (/[A-Z][a-z]+,?\s+[A-Z]\.?[A-Z]?\.?(\b|,|;)/.test(t)) return true; // "Smith J" / "Smith, J."
  if (/[A-Z]\.\s*[A-Z]?\.?\s*[A-Z][a-z]+/.test(t)) return true;         // "J. Smith"
  return false;
}

/** Split an entry on sentence boundaries (". "). Titles with internal ". " are a known limit. */
function splitSegments(entry) {
  return entry.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Journal = remainder after the title up to the first year / volume / semicolon token. */
function journalFrom(rest) {
  let r = clean(rest);
  if (!r) return '';
  r = r.replace(DOI_RE, '').replace(URL_RE, '').replace(PMID_RE, '');
  const cut = r.search(/(?:,?\s*(?:19|20)\d{2})|;|\b\d+\s*\(\d+\)|\b\d+\s*:\s*\d+/);
  if (cut > 0) r = r.slice(0, cut);
  return r.replace(/^[\s.,;:]+/, '').replace(/[.,;:]+$/, '').trim();
}

/** Isolate authors / title / journal and record which citation pattern matched. */
function parseNameStructure(entry) {
  // APA — Authors (Year). Title. Journal, vol(iss), pp.
  const apa = /^(.*?)\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.?\s*(.*)$/.exec(entry);
  if (apa && looksLikeAuthors(apa[1])) {
    // Keep a trailing period — it is the final initial ("… A. B."), not a separator.
    const authors = clean(apa[1]).replace(/[,;&\s]+$/, '');
    const after = clean(apa[2]);
    const idx = after.search(/\.\s+/);
    const title = (idx === -1 ? after : after.slice(0, idx)).replace(/\.$/, '').trim();
    const rest = idx === -1 ? '' : after.slice(idx + 1);
    return { authors, title, journal: journalFrom(rest), pattern: 'apa' };
  }

  // Vancouver — Authors. Title. Journal. Year;vol:pp.
  const segs = splitSegments(entry);
  if (segs.length && looksLikeAuthors(segs[0])) {
    const authors = clean(segs[0]).replace(/[.,;]+$/, '');
    const title = clean(segs[1] || '');
    let rest = '';
    if (title) {
      const ti = entry.indexOf(title);
      rest = ti >= 0 ? entry.slice(ti + title.length) : segs.slice(2).join('. ');
    }
    return { authors, title, journal: journalFrom(rest), pattern: 'vancouver' };
  }

  // Fallback — no clear author list; treat the first segment as the title.
  return { authors: '', title: clean(segs[0] || entry), journal: journalFrom(segs.slice(1).join('. ')), pattern: 'unknown' };
}

// Confidence weights sum to 1.0 → confidence is monotonic in the set of parsed fields.
const CONF_W = { title: 0.30, authors: 0.20, year: 0.15, doi: 0.15, journal: 0.10, pmid: 0.05, url: 0.05 };
function scoreConfidence(f) {
  let c = 0;
  for (const k of Object.keys(CONF_W)) if (clean(f[k])) c += CONF_W[k];
  return Math.round(Math.min(1, c) * 100) / 100;
}

function parseEntry(raw, index, maxYear) {
  const entry = clean(raw);
  const doi = extractDoi(entry);
  const pmidM = PMID_RE.exec(entry);
  const pmid = pmidM ? pmidM[1] : '';
  const urlM = URL_RE.exec(entry);
  const url = urlM ? urlM[0].replace(/[.,;)]+$/, '') : '';
  const year = extractYear(entry, maxYear);
  const { authors, title, journal, pattern } = parseNameStructure(entry);
  const ref = { index, raw: entry, authors, title, journal, year, doi, pmid, url, confidence: 0 };
  ref.confidence = scoreConfidence(ref);
  return { ref, pattern };
}

function dominantStyle(patterns) {
  if (!patterns.length) return 'unknown';
  const c = {};
  for (const p of patterns) c[p] = (c[p] || 0) + 1;
  const apa = c.apa || 0, van = c.vancouver || 0, unk = c.unknown || 0;
  if (apa && van && Math.min(apa, van) >= patterns.length * 0.2) return 'mixed';
  if (apa >= van && apa >= unk) return 'apa';
  if (van >= apa && van >= unk) return 'vancouver';
  return 'unknown';
}

/**
 * parseReferences — parse extracted text into structured references.
 *
 * @param {string} text
 * @param {object} [opts] — { currentYear?, maxYear? } to bound plausible years.
 * @returns {{
 *   references: Array<{ index, raw, authors, title, journal, year, doi, pmid, url, confidence }>,
 *   meta: { count, detectedStyle, segmentation, foundHeading, warnings: string[] }
 * }}
 */
export function parseReferences(text, opts = {}) {
  const maxYear = opts.maxYear || (opts.currentYear ? opts.currentYear + 1 : 2100);
  const warnings = [];
  const src = normalizeText(text);
  const { body, foundHeading } = locateReferenceSection(src);
  if (!foundHeading) warnings.push('No reference-section heading found; treated the entire input as the reference list.');

  const { entries, style: segmentation, warnings: segW } = segmentEntries(body);
  warnings.push(...segW);

  const parsed = entries.map((e, i) => parseEntry(e, i + 1, maxYear));
  const references = parsed.map((p) => p.ref);

  if (!references.length) {
    warnings.push('No reference entries could be parsed from the input.');
  } else {
    const noYear = references.filter((r) => !r.year).length;
    if (noYear) warnings.push(`${noYear} of ${references.length} entr${references.length === 1 ? 'y' : 'ies'} had no detectable year.`);
    const noTitle = references.filter((r) => !r.title).length;
    if (noTitle) warnings.push(`${noTitle} of ${references.length} entr${references.length === 1 ? 'y' : 'ies'} had no detectable title.`);
  }

  return {
    references,
    meta: {
      count: references.length,
      detectedStyle: dominantStyle(parsed.map((p) => p.pattern)),
      segmentation: segmentation || 'none',
      foundHeading,
      warnings,
    },
  };
}

export default { parseReferences };
