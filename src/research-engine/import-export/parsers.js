/**
 * parsers.js
 * Reference import parsers for RIS, BibTeX, EndNote XML, and PubMed NBIB formats.
 * Also provides auto-detection, record normalisation, and duplicate-merging.
 *
 * All logic copied verbatim from meta-lab-3-patched.jsx.
 */

import { uid } from '../project-model/defaults.js';

/**
 * normTitle(t)
 * Normalise a title string for fuzzy deduplication:
 * lower-case, collapse non-alphanumeric runs to spaces.
 *
 * @param {string|*} t
 * @returns {string}
 */
export function normTitle(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/**
 * mkRecord(r)
 * Build a canonical record object from raw parsed fields.
 * Strips DOI URL prefixes, assigns a fresh uid, initialises screening fields.
 *
 * @param {object} r  Raw parsed fields: { title, authors, year, journal, doi, pmid, abstract, source }
 * @returns {object}  Canonical record
 */
export function mkRecord(r) {
  return {
    id:        uid(),
    title:     r.title    || "",
    authors:   r.authors  || "",
    year:      r.year     || "",
    journal:   r.journal  || "",
    doi:       (r.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim(),
    pmid:      r.pmid     || "",
    abstract:  r.abstract || "",
    source:    r.source   || "",
    decision:  "",
    reviewer2: "",
    notes:     "",
    dupOf:     null,
  };
}

/**
 * parseRIS(text)
 * Parse a RIS-format string (tag-value pairs bounded by TY…ER blocks).
 *
 * @param {string} text  Raw file content
 * @returns {Array}      Array of canonical record objects
 */
export function parseRIS(text) {
  const recs = [];
  let cur = null;

  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z][A-Z0-9])\s{0,2}-\s?(.*)$/);
    if (!m) {
      if (cur && cur._last && line.trim()) { cur[cur._last] += " " + line.trim(); }
      return;
    }
    const tag = m[1], val = (m[2] || "").trim();
    if (tag === "TY") { cur = { authors: [], _last: null }; recs.push(cur); return; }
    if (!cur) { cur = { authors: [], _last: null }; recs.push(cur); }
    if (tag === "ER") { cur = null; return; }

    if (tag === "AU" || tag === "A1" || tag === "A2") {
      cur.authors.push(val); cur._last = null;
    } else if (tag === "TI" || tag === "T1") {
      cur.title = (cur.title ? cur.title + " " : "") + val; cur._last = "title";
    } else if (tag === "JO" || tag === "JF" || tag === "T2" || tag === "JA") {
      if (!cur.journal) cur.journal = val; cur._last = "journal";
    } else if (tag === "PY" || tag === "Y1") {
      const y = (val.match(/\d{4}/) || [])[0]; if (y) cur.year = y; cur._last = null;
    } else if (tag === "DO") {
      cur.doi = val; cur._last = null;
    } else if (tag === "AB" || tag === "N2") {
      cur.abstract = (cur.abstract ? cur.abstract + " " : "") + val; cur._last = "abstract";
    } else if (tag === "AN" && /^\d+$/.test(val)) {
      if (!cur.pmid) cur.pmid = val; cur._last = null;
    } else if (tag === "ID" && /^\d+$/.test(val)) {
      if (!cur.pmid) cur.pmid = val; cur._last = null;
    } else {
      cur._last = null;
    }
  });

  return recs
    .filter(r => r.title || r.authors.length)
    .map(r => mkRecord({ ...r, authors: r.authors.join("; "), source: "RIS" }));
}

/**
 * parseNBIB(text)
 * Parse a PubMed NBIB / MEDLINE format string.
 * Handles PMID, TI, AU, DP, JT, AB, LID/AID doi tags.
 *
 * @param {string} text  Raw file content
 * @returns {Array}      Array of canonical record objects
 */
export function parseNBIB(text) {
  const recs = [];
  let cur = null, last = null;

  text.split(/\r?\n/).forEach(line => {
    if (/^\s{6}/.test(line) && cur && last) { cur[last] += " " + line.trim(); return; }
    const m = line.match(/^([A-Z]{2,4})\s*-\s?(.*)$/);
    if (!m) return;
    const tag = m[1], val = (m[2] || "").trim();

    if (tag === "PMID") { cur = { authors: [] }; recs.push(cur); cur.pmid = val; last = null; return; }
    if (!cur) { cur = { authors: [] }; recs.push(cur); }

    if (tag === "TI")       { cur.title   = val; last = "title"; }
    else if (tag === "AU")  { cur.authors.push(val); last = null; }
    else if (tag === "DP")  { const y = (val.match(/\d{4}/) || [])[0]; if (y) cur.year = y; last = null; }
    else if (tag === "JT" || tag === "TA") { if (!cur.journal) cur.journal = val; last = "journal"; }
    else if (tag === "AB")  { cur.abstract = val; last = "abstract"; }
    else if (tag === "LID" || tag === "AID") {
      const d = val.match(/(10\.\d{4,9}\/[^\s]+)\s*\[doi\]/i);
      if (d && !cur.doi) cur.doi = d[1];
      last = null;
    }
    else last = null;
  });

  return recs
    .filter(r => r.title || r.pmid)
    .map(r => mkRecord({ ...r, authors: r.authors.join("; "), source: "PubMed" }));
}

/**
 * parseBibTeX(text)
 * Parse a BibTeX string.  Handles nested braces and double-quoted values.
 * Joins multiple authors with "; ".
 *
 * @param {string} text  Raw file content
 * @returns {Array}      Array of canonical record objects
 */
export function parseBibTeX(text) {
  const recs = [];
  const entries = text.split(/@\w+\s*\{/).slice(1);

  entries.forEach(block => {
    const rec = {};
    const grab = field => {
      const re = new RegExp(field + "\\s*=\\s*[{\"]", "i");
      const m  = re.exec(block);
      if (!m) return "";
      let i = m.index + m[0].length, depth = 1, out = "", open = block[i - 1];
      for (; i < block.length; i++) {
        const ch = block[i];
        if (open === "{") {
          if (ch === "{") depth++;
          else if (ch === "}") { depth--; if (depth === 0) break; }
        } else {
          if (ch === "\"") break;
        }
        out += ch;
      }
      return out.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
    };

    rec.title   = grab("title");
    rec.year    = (grab("year").match(/\d{4}/) || [])[0] || "";
    rec.journal = grab("journal") || grab("booktitle");
    rec.doi     = grab("doi");
    rec.abstract = grab("abstract");
    const auth  = grab("author");
    rec.authors = auth ? auth.split(/\s+and\s+/).join("; ") : "";

    if (rec.title || rec.authors) recs.push(mkRecord({ ...rec, source: "BibTeX" }));
  });

  return recs;
}

/**
 * parseEndNoteXML(text)
 * Parse an EndNote XML export (<records><record>…</record></records>).
 * Uses DOMParser — requires a DOM environment (browser or jsdom).
 *
 * @param {string} text  Raw XML file content
 * @returns {Array}      Array of canonical record objects
 */
export function parseEndNoteXML(text) {
  const recs = [];
  try {
    const doc     = new DOMParser().parseFromString(text, "text/xml");
    const records = doc.getElementsByTagName("record");
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const txt = sel => {
        const el = rec.querySelector(sel);
        return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
      };
      const authorsNodes = rec.querySelectorAll("contributors authors author");
      const authors = Array.from(authorsNodes)
        .map(a => a.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean).join("; ");
      recs.push(mkRecord({
        title:   txt("titles title"),
        authors,
        year:    txt("dates year"),
        journal: txt("periodical full-title") || txt("titles secondary-title"),
        doi:     txt("electronic-resource-num"),
        abstract: txt("abstract"),
        source:  "EndNote",
      }));
    }
  } catch (e) { /* malformed XML — return whatever was parsed so far */ }
  return recs.filter(r => r.title || r.authors);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Broader import formats (roadmap 1.4): CSV, delimited TXT, and CIW
 * (Web of Science / Clarivate tagged export). All PURE — text in, records out.
 * ───────────────────────────────────────────────────────────────────────── */

// Canonical column synonyms → record field. Header matching is case-insensitive
// and whitespace-trimmed.
const CSV_FIELD_SYNONYMS = {
  title:    ["title", "article title", "document title", "primary title", "ti"],
  authors:  ["authors", "author", "author(s)", "author full names", "authors full name", "au", "af"],
  year:     ["year", "publication year", "pub year", "pubyear", "py", "date", "pubdate"],
  journal:  ["journal", "source", "source title", "journal/source", "publication", "journal title", "so", "journal name"],
  doi:      ["doi", "di", "digital object identifier"],
  pmid:     ["pmid", "pubmed id", "pubmedid", "pm", "pubmed"],
  abstract: ["abstract", "ab", "summary"],
  url:      ["url", "link", "fulltext url", "full text url", "full-text url"],
  keywords: ["keywords", "keyword", "author keywords", "de", "index keywords", "id"],
};

/** Build a header-cell → canonical-field lookup from a header row. */
function mapHeader(cells) {
  const map = cells.map(raw => {
    const h = String(raw || "").trim().toLowerCase();
    for (const [field, syns] of Object.entries(CSV_FIELD_SYNONYMS)) {
      if (syns.includes(h)) return field;
    }
    return null;
  });
  return map;
}

/**
 * RFC-4180-ish tokenizer: splits delimited text into rows of cells, honouring
 * quoted fields ("a,b"), escaped quotes ("" → "), and quoted newlines.
 */
function tokenizeDelimited(text, delim) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop fully-empty trailing rows.
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

/** Choose the delimiter that yields the most columns on the header line. */
function sniffDelimiter(text) {
  const firstLine = text.replace(/\r\n?/g, "\n").split("\n").find(l => l.trim()) || "";
  const counts = [
    [",", (firstLine.match(/,/g) || []).length],
    ["\t", (firstLine.match(/\t/g) || []).length],
    [";", (firstLine.match(/;/g) || []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Build a record from a header-mapped row; attaches url/keywords only if present. */
function rowToRecord(map, cells, source) {
  const get = field => {
    const idx = map.indexOf(field);
    return idx >= 0 ? String(cells[idx] ?? "").trim() : "";
  };
  // PMID often arrives as "12345" or "PMID:12345" — keep digits only.
  const pmidRaw = get("pmid");
  const pmid = (pmidRaw.match(/\d{4,}/) || [])[0] || "";
  const yearRaw = get("year");
  const year = (yearRaw.match(/\d{4}/) || [])[0] || "";
  const rec = mkRecord({
    title:    get("title"),
    authors:  get("authors"),
    year,
    journal:  get("journal"),
    doi:      get("doi"),
    pmid,
    abstract: get("abstract"),
    source,
  });
  const url = get("url");
  const keywords = get("keywords");
  if (url) rec.url = url;
  if (keywords) rec.keywords = keywords;
  return rec;
}

/**
 * parseCSV(text)
 * Parse a delimited reference table (comma / tab / semicolon auto-detected).
 * Requires a header row whose columns map to known reference fields.
 *
 * @param {string} text
 * @param {string} [delim]  force a delimiter; auto-detected when omitted
 * @returns {Array} canonical records
 */
export function parseCSV(text, delim) {
  const d = delim || sniffDelimiter(text);
  const rows = tokenizeDelimited(text, d);
  if (rows.length < 2) return [];
  const map = mapHeader(rows[0]);
  if (!map.includes("title") && !map.includes("doi")) return []; // not a reference table
  return rows.slice(1)
    .map(cells => rowToRecord(map, cells, "CSV"))
    .filter(r => r.title || r.doi || r.pmid);
}

/**
 * parseTXT(text)
 * Plain-text import. If the text is a delimited table with a recognisable
 * header, it is parsed like CSV; otherwise each non-empty line is treated as a
 * record title (a documented, safe fallback). Ambiguous fields are left empty
 * rather than invented.
 *
 * @param {string} text
 * @returns {Array} canonical records
 */
export function parseTXT(text) {
  const firstLine = text.replace(/\r\n?/g, "\n").split("\n").find(l => l.trim()) || "";
  const delim = sniffDelimiter(text);
  if ((firstLine.match(new RegExp(delim === "\t" ? "\t" : "\\" + delim, "g")) || []).length >= 1) {
    const map = mapHeader(tokenizeDelimited(firstLine, delim)[0] || []);
    if (map.includes("title") || map.includes("doi")) return parseCSV(text, delim);
  }
  // Fallback: one record per non-empty line, title only.
  return text.replace(/\r\n?/g, "\n").split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => mkRecord({ title: line, source: "TXT" }));
}

/**
 * parseCIW(text)
 * Web of Science / Clarivate tagged export (.ciw). 2-letter field tags, one
 * record per PT…ER block, 3-space-indented continuation lines. AU/AF list one
 * author per line; TI/SO/AB continuations are joined with a space.
 *
 * @param {string} text
 * @returns {Array} canonical records
 */
export function parseCIW(text) {
  const recs = [];
  let cur = null, tag = null;
  // A record begins only at PT (publication type); AU = short author names,
  // AF = full author names (parallel lists — prefer AF when present).
  const startRec = () => { cur = { au: [], af: [], keywords: [] }; recs.push(cur); };

  text.replace(/\r\n?/g, "\n").split("\n").forEach(line => {
    if (/^\s{2,}\S/.test(line) && cur && tag) {       // continuation of the current tag
      const val = line.trim();
      if (tag === "AU") cur.au.push(val);
      else if (tag === "AF") cur.af.push(val);
      else if (tag === "DE" || tag === "ID") cur.keywords.push(val);
      else if (tag === "TI") cur.title = (cur.title ? cur.title + " " : "") + val;
      else if (tag === "AB") cur.abstract = (cur.abstract ? cur.abstract + " " : "") + val;
      else if (tag === "SO") cur.journal = (cur.journal ? cur.journal + " " : "") + val;
      return;
    }
    const m = line.match(/^([A-Z][A-Z0-9])\s(.*)$/);
    if (!m) { if (/^(ER|EF)\b/.test(line)) { cur = null; tag = null; } return; }
    tag = m[1];
    const val = (m[2] || "").trim();
    if (tag === "PT") { startRec(); return; }
    if (!cur) return;   // ignore tags before the first PT (FN/VR file header, etc.)
    switch (tag) {
      case "AU": cur.au.push(val); break;
      case "AF": cur.af.push(val); break;
      case "TI": cur.title = val; break;
      case "SO": case "J9": case "JI": if (!cur.journal) cur.journal = val; break;
      case "AB": cur.abstract = val; break;
      case "PY": { const y = (val.match(/\d{4}/) || [])[0]; if (y) cur.year = y; break; }
      case "DI": cur.doi = val; break;
      case "PM": if (/^\d+$/.test(val)) cur.pmid = val; break;
      case "DE": case "ID": if (val) cur.keywords.push(val); break;
      case "U1": case "URL": if (!cur.url) cur.url = val; break;
      case "ER": case "EF": cur = null; tag = null; break;
      default: break;
    }
  });

  return recs
    .filter(r => r.title || r.doi || r.pmid)
    .map(r => {
      const authors = (r.af.length ? r.af : r.au).join("; ");
      const rec = mkRecord({
        title: r.title, authors, year: r.year,
        journal: r.journal, doi: r.doi, pmid: r.pmid, abstract: r.abstract, source: "CIW",
      });
      if (r.url) rec.url = r.url;
      if (r.keywords && r.keywords.length) rec.keywords = r.keywords.join("; ");
      return rec;
    });
}

/** True when the first delimited line looks like a known reference-table header. */
function looksLikeReferenceTable(head) {
  const firstLine = head.split("\n").find(l => l.trim()) || "";
  const delim = sniffDelimiter(firstLine);
  if ((firstLine.match(new RegExp(delim === "\t" ? "\t" : "\\" + delim, "g")) || []).length < 1) return false;
  const map = mapHeader((tokenizeDelimited(firstLine, delim)[0] || []));
  return map.includes("title") || map.includes("doi");
}

/**
 * detectAndParse(text, filename)
 * Auto-detect format from content / filename extension and dispatch to the
 * appropriate parser.  Falls back through RIS → BibTeX → MEDLINE.
 *
 * @param {string} text      Raw file content
 * @param {string} [filename]  Optional filename for extension hints
 * @returns {{ records: Array, format: string }}
 */
export function detectAndParse(text, filename) {
  const fn   = (filename || "").toLowerCase();
  const head = text.slice(0, 3000);

  if (fn.endsWith(".xml") || /<xml|<records>|<record>/i.test(head))
    return { records: parseEndNoteXML(text), format: "EndNote XML" };
  if (fn.endsWith(".bib") || /^@\w+\s*\{/m.test(head))
    return { records: parseBibTeX(text), format: "BibTeX" };
  if (fn.endsWith(".nbib") || /^PMID\s*-/m.test(head))
    return { records: parseNBIB(text), format: "PubMed nbib" };
  // CIW / Web of Science tagged export — header is "FN …\nVR …" or PT-led records.
  if (fn.endsWith(".ciw") || (/^FN\s/m.test(head) && /^VR\s/m.test(head)) || /^PT\s[A-Z]/m.test(head))
    return { records: parseCIW(text), format: "CIW (Web of Science)" };
  if (fn.endsWith(".ris") || /^TY\s{0,2}-/m.test(head))
    return { records: parseRIS(text), format: "RIS" };
  // CSV / delimited table — only when a header row maps to known reference fields.
  if (fn.endsWith(".csv") || (!fn.endsWith(".txt") && looksLikeReferenceTable(head)))
    return { records: parseCSV(text), format: "CSV" };
  if (fn.endsWith(".txt") || fn.endsWith(".tsv"))
    return { records: parseTXT(text), format: "TXT" };

  // fallback: try each format in turn
  let r = parseRIS(text);   if (r.length) return { records: r, format: "RIS" };
  r = parseBibTeX(text);    if (r.length) return { records: r, format: "BibTeX" };
  r = parseNBIB(text);      if (r.length) return { records: r, format: "MEDLINE" };
  r = parseCSV(text);       if (r.length) return { records: r, format: "CSV" };
  return { records: [], format: "unknown" };
}

/**
 * dedupeRecords(existing, incoming)
 * Merge incoming records into an existing list, tagging duplicates by
 * DOI, PMID, or normalised title+year.
 *
 * @param {Array} existing  Current record list
 * @param {Array} incoming  Newly parsed records
 * @returns {{ merged: Array, dupCount: number, added: number }}
 *          merged  — combined list (duplicates present but tagged with dupOf)
 *          dupCount — number of incoming records that were duplicates
 *          added   — total number of incoming records
 */
export function dedupeRecords(existing, incoming) {
  const all = [...existing];
  const seenDOI   = new Map();
  const seenPMID  = new Map();
  const seenTitle = new Map();

  existing.forEach(r => {
    if (r.doi)   seenDOI.set(r.doi.toLowerCase(), r.id);
    if (r.pmid)  seenPMID.set(r.pmid, r.id);
    const k = normTitle(r.title) + "|" + (r.year || "");
    if (r.title) seenTitle.set(k, r.id);
  });

  let dupCount = 0;
  incoming.forEach(r => {
    let dupOf = null;
    if (r.doi && seenDOI.has(r.doi.toLowerCase()))
      dupOf = seenDOI.get(r.doi.toLowerCase());
    else if (r.pmid && seenPMID.has(r.pmid))
      dupOf = seenPMID.get(r.pmid);
    else {
      const k = normTitle(r.title) + "|" + (r.year || "");
      if (r.title && seenTitle.has(k)) dupOf = seenTitle.get(k);
    }

    if (dupOf) {
      dupCount++;
      r.dupOf = dupOf;
    } else {
      if (r.doi)   seenDOI.set(r.doi.toLowerCase(), r.id);
      if (r.pmid)  seenPMID.set(r.pmid, r.id);
      const k = normTitle(r.title) + "|" + (r.year || "");
      if (r.title) seenTitle.set(k, r.id);
    }
    all.push(r);
  });

  return { merged: all, dupCount, added: incoming.length };
}
