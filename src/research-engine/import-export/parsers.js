/**
 * parsers.js
 * Reference import parsers for RIS, BibTeX, EndNote XML, and PubMed NBIB formats.
 * Also provides auto-detection, record normalisation, and duplicate-merging.
 *
 * All logic copied verbatim from meta-lab-3-patched.jsx.
 */

import { uid } from '../project-model/defaults.js';
// 116.md §14 — recognized-database detection: a parser may state where a record
// came from ONLY when the file itself names a database the shared vocabulary
// recognises. Both modules are pure (shared client/server).
import { dbKind } from '../search/searchProvenance.js';

/**
 * recognizedDatabase(value) — the trimmed value when it names a database or
 * register the canonical vocabulary (searchProvenance CANONICAL_ALIASES/DB_KINDS
 * + classifySource) recognises; '' otherwise. 116.md §14: "If an RIS file
 * contains a record originally exported from Embase, and that information can be
 * reliably detected, do not throw it away" — and, symmetrically, never promote an
 * unrecognised token (least of all a file-format name) into a database claim.
 * Pure.
 */
export function recognizedDatabase(value) {
  const v = String(value == null ? "" : value).trim();
  if (!v) return "";
  return dbKind(v, v) !== "other" ? v : "";
}

/**
 * stripBom(text)
 * Remove a leading UTF-8 / UTF-16 byte-order mark so the first field tag of a
 * file exported on Windows is recognised (e.g. "﻿TY  - JOUR"). Pure string
 * op — decoding from bytes happens upstream (the server reads as UTF-8). Also
 * normalises a lone NBSP that some exporters prepend.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripBom(text) {
  let s = String(text == null ? "" : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

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
 * @param {object} r  Raw parsed fields: { title, authors, year, journal, doi, pmid, abstract, source, sourceDb }
 * @returns {object}  Canonical record
 */
/**
 * 117.md §27/§30 — BIBLIOGRAPHIC fields beyond the screening core.
 *
 * They are attached ONLY when the source file actually carried them. That is not a
 * style choice: a screening record is persisted, so adding always-present keys would
 * change the shape of every imported record in every existing project. Present-only
 * keeps the screening import byte-identical while letting the reference library read
 * a real volume/issue/pages/publisher/ISBN/URL instead of a dead end.
 */
export const EXTRA_RECORD_FIELDS = Object.freeze([
  "volume", "issue", "pages", "publisher", "place", "edition", "isbn", "url",
  "language", "publicationType", "pmcid", "articleNumber", "keywords", "bookTitle",
  "editors", "conference", "institution", "referenceType",
]);

export function mkRecord(r) {
  const rec = {
    id:        uid(),
    title:     r.title    || "",
    authors:   r.authors  || "",
    year:      r.year     || "",
    journal:   r.journal  || "",
    doi:       (r.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim(),
    pmid:      r.pmid     || "",
    abstract:  r.abstract || "",
    source:    r.source   || "",
    // 116.md §14 — the ORIGINAL database, only when reliably detected from the
    // file itself (RIS `DB` tag, EndNote remote-database-name, nbib ⇒ PubMed).
    // Parsers no longer stamp the file FORMAT anywhere near a source field.
    sourceDb:  r.sourceDb || "",
    // 59.md Change 1 — pass through a normalised screening decision when present.
    decision:  normalizeImportedDecision(r.decision),
    reviewer2: "",
    notes:     "",
    dupOf:     null,
  };
  for (const f of EXTRA_RECORD_FIELDS) {
    const v = String(r[f] == null ? "" : r[f]).trim();
    if (v) rec[f] = v;
  }
  return rec;
}

// 59.md Change 1 — accepted screening-decision labels (the four states export writes).
export const IMPORT_DECISIONS = ["include", "exclude", "maybe", "undecided"];
// Lenient synonyms → canonical state; anything else is treated as INVALID (returns "").
// POLICY (65.md SCR-9): 'conflict' maps to 'maybe' — a per-reviewer decision can never
// BE 'conflict' (conflict is a derived, between-reviewers state), so an exported
// conflict cell is imported as the closest per-reviewer state: needs another look.
const DECISION_ALIASES = {
  include: "include", included: "include", yes: "include", accept: "include", accepted: "include", relevant: "include",
  in: "include", keep: "include", eligible: "include",
  exclude: "exclude", excluded: "exclude", no: "exclude", reject: "exclude", rejected: "exclude", irrelevant: "exclude",
  out: "exclude", "not relevant": "exclude", ineligible: "exclude",
  maybe: "maybe", unsure: "maybe", uncertain: "maybe", unclear: "maybe", conflict: "maybe", "?": "maybe",
  undecided: "undecided", "": "undecided", pending: "undecided", unscreened: "undecided", none: "undecided",
};

/**
 * normalizeImportedDecision(v) — case-insensitive, whitespace-trimmed mapping of an
 * imported decision cell to a canonical state ("include" | "exclude" | "maybe" |
 * "undecided"). Empty/missing → "undecided" (neutral). An UNRECOGNISED non-empty
 * value returns "" so the caller can flag a row-level warning instead of silently
 * mislabelling the record (59.md: invalid values must not corrupt the dataset).
 */
export function normalizeImportedDecision(v) {
  if (v == null) return "undecided";
  const k = String(v).trim().toLowerCase();
  if (k === "") return "undecided";
  return Object.prototype.hasOwnProperty.call(DECISION_ALIASES, k) ? DECISION_ALIASES[k] : "";
}

/**
 * parseRIS(text)
 * Parse a RIS-format string (tag-value pairs bounded by TY…ER blocks).
 *
 * @param {string} text  Raw file content
 * @returns {Array}      Array of canonical record objects
 */
/**
 * 117.md §30 — the RIS reference TYPE tag (`TY`) → our §28 taxonomy. Only mappings
 * we are sure of; anything else stays undefined so the library falls back to its
 * own default rather than mislabelling a record.
 */
const RIS_TYPE_TO_REFERENCE_TYPE = {
  JOUR: "journal-article", EJOUR: "journal-article", ABST: "conference-abstract",
  BOOK: "book", EBOOK: "book", CHAP: "book-chapter", ECHAP: "book-chapter",
  CONF: "conference-abstract", CPAPER: "conference-proceeding",
  RPRT: "report", THES: "thesis", ELEC: "website", ICOMM: "website",
  DATA: "dataset", COMP: "software", STAND: "guideline", GOVDOC: "government-publication",
  UNPB: "preprint", PREPRINT: "preprint", GEN: "other",
};

/**
 * 117.md §27/§30 — RIS `SN` and EndNote `<isbn>` carry an ISSN for journals and an
 * ISBN for books, in the same field. Length is what separates them: an ISBN has 10
 * or 13 digits, an ISSN exactly 8. Claiming an ISSN as an ISBN would print a
 * fabricated book identifier in a reference, so the test is on the digit count, not
 * on the punctuation. Pure.
 */
export function looksLikeIsbn(value) {
  const compact = String(value == null ? "" : value).replace(/[^0-9Xx]/g, "");
  return compact.length === 10 || compact.length === 13;
}

/** Join RIS SP/EP into a page range ("100-110"), tolerating either alone. Pure. */
function risPages(sp, ep) {
  const a = String(sp == null ? "" : sp).trim();
  const b = String(ep == null ? "" : ep).trim();
  if (a && b) return `${a}-${b}`;
  return a || b || "";
}

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
    if (tag === "TY") {
      cur = { authors: [], keywords: [], _last: null };
      // 117.md §30 — remember the declared reference type (see the map above).
      if (RIS_TYPE_TO_REFERENCE_TYPE[val.toUpperCase()]) cur.referenceType = RIS_TYPE_TO_REFERENCE_TYPE[val.toUpperCase()];
      recs.push(cur);
      return;
    }
    if (!cur) { cur = { authors: [], keywords: [], _last: null }; recs.push(cur); }
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
    } else if (tag === "DB") {
      // 116.md §14 — Ovid/Embase/Scopus/ProQuest/EBSCO exports name their source
      // database in the standard `DB` tag. Kept only when the vocabulary
      // recognises it (below); an unrecognised value stays out of sourceDb.
      if (!cur.db) cur.db = val; cur._last = null;
    /* 117.md §27/§30 — the bibliographic tags the parser used to DROP on the floor.
       Volume/issue/pages are what makes a Vancouver reference complete, and
       publisher/ISBN/URL are what makes a book or a website citable at all. */
    } else if (tag === "VL") {
      if (!cur.volume) cur.volume = val; cur._last = null;
    } else if (tag === "IS" || tag === "CP") {
      if (!cur.issue) cur.issue = val; cur._last = null;
    } else if (tag === "SP") {
      if (!cur.sp) cur.sp = val; cur._last = null;
    } else if (tag === "EP") {
      if (!cur.ep) cur.ep = val; cur._last = null;
    } else if (tag === "PB") {
      if (!cur.publisher) cur.publisher = val; cur._last = null;
    } else if (tag === "CY" || tag === "PP") {
      if (!cur.place) cur.place = val; cur._last = null;
    } else if (tag === "ET") {
      if (!cur.edition) cur.edition = val; cur._last = null;
    } else if (tag === "SN") {
      // SN carries ISSN for journals and ISBN for books — only an ISBN-shaped
      // value is claimed as an ISBN, so a journal's ISSN is never mislabelled.
      if (!cur.isbn && looksLikeIsbn(val)) cur.isbn = val;
      cur._last = null;
    } else if (tag === "UR" || tag === "L1" || tag === "LK") {
      if (!cur.url) cur.url = val; cur._last = null;
    } else if (tag === "LA") {
      if (!cur.language) cur.language = val; cur._last = null;
    } else if (tag === "M3") {
      if (!cur.publicationType) cur.publicationType = val; cur._last = null;
    } else if (tag === "C7" || tag === "AR") {
      if (!cur.articleNumber) cur.articleNumber = val; cur._last = null;
    } else if (tag === "KW") {
      if (val) cur.keywords.push(val); cur._last = null;
    } else {
      cur._last = null;
    }
  });

  // 116.md §14 — no format token in `source` any more ("RIS" is how the record
  // was PARSED, never where it came from); the recognized `DB` tag becomes the
  // record's original database.
  return recs
    .filter(r => r.title || r.authors.length)
    .map(r => mkRecord({
      ...r,
      authors: r.authors.join("; "),
      pages: r.pages || risPages(r.sp, r.ep),
      keywords: (r.keywords || []).join("; "),
      sourceDb: recognizedDatabase(r.db),
    }));
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

    if (tag === "PMID") { cur = { authors: [], keywords: [] }; recs.push(cur); cur.pmid = val; last = null; return; }
    if (!cur) { cur = { authors: [], keywords: [] }; recs.push(cur); }

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
    /* 117.md §27/§30 — MEDLINE's own bibliographic tags: volume, issue, pagination,
       PMCID, language, publication type and MeSH-ish keywords. */
    else if (tag === "VI")  { if (!cur.volume) cur.volume = val; last = null; }
    else if (tag === "IP")  { if (!cur.issue) cur.issue = val; last = null; }
    else if (tag === "PG")  { if (!cur.pages) cur.pages = val; last = null; }
    else if (tag === "PMC") { if (!cur.pmcid) cur.pmcid = val; last = null; }
    else if (tag === "LA")  { if (!cur.language) cur.language = val; last = null; }
    else if (tag === "PT")  { if (!cur.publicationType) cur.publicationType = val; last = null; }
    else if (tag === "OT")  { cur.keywords.push(val); last = null; }
    else last = null;
  });

  return recs
    .filter(r => r.title || r.pmid)
    // nbib is PubMed's OWN export format, so "PubMed" here is genuine database
    // detection, not invention (116.md §14) — carried as sourceDb, not as a
    // format token in `source`.
    .map(r => mkRecord({
      ...r,
      authors: r.authors.join("; "),
      keywords: (r.keywords || []).join("; "),
      sourceDb: "PubMed",
    }));
}

/**
 * parseBibTeX(text)
 * Parse a BibTeX string.  Handles nested braces and double-quoted values.
 * Joins multiple authors with "; ".
 *
 * @param {string} text  Raw file content
 * @returns {Array}      Array of canonical record objects
 */
/** 117.md §30 — BibTeX entry type → our §28 taxonomy (unmapped → library default). */
const BIB_TYPE_TO_REFERENCE_TYPE = {
  article: "journal-article", book: "book", booklet: "book",
  incollection: "book-chapter", inbook: "book-chapter",
  inproceedings: "conference-proceeding", conference: "conference-proceeding",
  proceedings: "conference-proceeding",
  techreport: "report", phdthesis: "thesis", mastersthesis: "thesis",
  electronic: "website", online: "website", software: "software",
  dataset: "dataset", unpublished: "preprint", misc: "other",
};

export function parseBibTeX(text) {
  const recs = [];
  // 117.md §30 — keep the entry TYPE that precedes each brace (`@book{`), which the
  // old split discarded; it is the only reliable type signal a .bib file carries.
  const types = (String(text).match(/@(\w+)\s*\{/g) || [])
    .map(t => (t.match(/@(\w+)/) || [])[1] || "");
  const entries = text.split(/@\w+\s*\{/).slice(1);

  entries.forEach((block, bi) => {
    const rec = {};
    const bibType = BIB_TYPE_TO_REFERENCE_TYPE[String(types[bi] || "").toLowerCase()];
    if (bibType) rec.referenceType = bibType;
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
    // 117.md §27/§30 — the bibliographic fields BibTeX has always carried and this
    // parser has always thrown away. `number` is BibTeX's name for the issue.
    rec.volume    = grab("volume");
    rec.issue     = grab("number");
    rec.pages     = grab("pages").replace(/--/g, "-");
    rec.publisher = grab("publisher");
    rec.place     = grab("address");
    rec.edition   = grab("edition");
    rec.isbn      = grab("isbn");
    rec.url       = grab("url") || grab("howpublished").replace(/^\\url\{?/, "");
    rec.language  = grab("language");
    rec.editors   = grab("editor");
    rec.institution = grab("institution") || grab("school");
    if (grab("booktitle") && grab("journal")) rec.bookTitle = grab("booktitle");
    if (grab("keywords")) rec.keywords = grab("keywords");

    // 116.md §14 — no format token: BibTeX has no reliable database field.
    if (rec.title || rec.authors) recs.push(mkRecord(rec));
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
        // 117.md §27/§30 — EndNote's own bibliographic elements. `pages` is a plain
        // element; `isbn` doubles as ISSN in EndNote, so it is claimed only when it
        // looks like an ISBN (same rule as the RIS `SN` tag).
        volume:  txt("volume"),
        issue:   txt("number"),
        pages:   txt("pages"),
        publisher: txt("publisher"),
        place:   txt("pub-location"),
        edition: txt("edition"),
        isbn:    (looksLikeIsbn(txt("isbn")) ? txt("isbn") : ""),
        url:     txt("urls related-urls url") || txt("urls web-urls url"),
        language: txt("language"),
        publicationType: txt("work-type"),
        // 116.md §14 — EndNote records carry the database they were fetched from
        // in <remote-database-name>; kept only when recognised. No format token.
        sourceDb: recognizedDatabase(txt("remote-database-name")),
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
  // 117.md §27/§30 — the bibliographic columns every reference exporter writes and
  // this importer used to ignore. Reading them is what makes an imported reference
  // citable in Vancouver ("2020;12(3):100-110") instead of half-blank.
  volume:   ["volume", "vol", "vl"],
  issue:    ["issue", "number", "no", "is", "ip"],
  pages:    ["pages", "page numbers", "page range", "pagination", "pg", "bp-ep"],
  publisher: ["publisher", "publisher name", "pu"],
  isbn:     ["isbn", "bn"],
  language: ["language", "languages", "la"],
  publicationType: ["publication type", "document type", "type", "dt", "pt"],
  pmcid:    ["pmcid", "pmc", "pmc id"],
  // 116.md §14 — an explicit database column (recognized-only; a Scopus "Source"
  // column stays a journal via the mapping above, which is correct for Scopus).
  sourceDb: ["database", "source database", "database name", "database provider"],
  // 59.md Change 1 — round-trip the screening decision column written by export
  // (and accept common synonyms) so a pre-labelled benchmark dataset imports already
  // screened. Values are normalised in normalizeImportedDecision().
  decision: ["decision", "screening decision", "label", "screening", "status", "decision (title/abstract)"],
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
function rowToRecord(map, cells) {
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
    // 117.md §27/§30 — bibliographic columns (present-only inside mkRecord).
    volume:   get("volume"),
    issue:    get("issue"),
    pages:    get("pages"),
    publisher: get("publisher"),
    isbn:     get("isbn"),
    language: get("language"),
    publicationType: get("publicationType"),
    pmcid:    get("pmcid"),
    // 116.md §14 — no format token; only a recognized explicit database column.
    sourceDb: recognizedDatabase(get("sourceDb")),
    decision: get("decision"), // 59.md Change 1 — round-trip the screening decision
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
    .map(cells => rowToRecord(map, cells))
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
    .map(line => mkRecord({ title: line })); // 116.md §14 — no format token
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
      // 117.md §27/§30 — WoS volume / issue / start-end page / publisher / ISBN.
      case "VL": if (!cur.volume) cur.volume = val; break;
      case "IS": if (!cur.issue) cur.issue = val; break;
      case "BP": if (!cur.bp) cur.bp = val; break;
      case "EP": if (!cur.ep) cur.ep = val; break;
      case "AR": if (!cur.articleNumber) cur.articleNumber = val; break;
      case "PU": if (!cur.publisher) cur.publisher = val; break;
      case "BN": if (!cur.isbn) cur.isbn = val; break;
      case "LA": if (!cur.language) cur.language = val; break;
      case "DT": if (!cur.publicationType) cur.publicationType = val; break;
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
        // 116.md §14 — no format token ("CIW" is a file format, not a source).
        journal: r.journal, doi: r.doi, pmid: r.pmid, abstract: r.abstract,
        // 117.md §27/§30 — the bibliographic tags WoS exports carry.
        volume: r.volume, issue: r.issue, pages: risPages(r.bp, r.ep),
        articleNumber: r.articleNumber, publisher: r.publisher, isbn: r.isbn,
        language: r.language, publicationType: r.publicationType,
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
  text = stripBom(text);                 // tolerate a Windows/UTF-8 BOM (data-quality)
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

// ── Modular parser registry (prompt50 WS2) ──────────────────────────────────
// A single map from a format key to its parser, so a NEW bibliographic-database
// export format can be added in ONE place without rewriting detectAndParse's
// dispatch. detectAndParse stays the content/extension auto-detector;
// PARSER_REGISTRY lets a caller force a known format (e.g. an explicit selector).
export const PARSER_REGISTRY = {
  ris:     { label: "RIS",                    parse: (t) => parseRIS(t) },
  bibtex:  { label: "BibTeX",                 parse: (t) => parseBibTeX(t) },
  nbib:    { label: "PubMed/MEDLINE (nbib)",  parse: (t) => parseNBIB(t) },
  medline: { label: "MEDLINE",                parse: (t) => parseNBIB(t) },
  pubmed:  { label: "PubMed",                 parse: (t) => parseNBIB(t) },
  endnote: { label: "EndNote XML",            parse: (t) => parseEndNoteXML(t) },
  xml:     { label: "EndNote XML",            parse: (t) => parseEndNoteXML(t) },
  ciw:     { label: "CIW (Web of Science)",   parse: (t) => parseCIW(t) },
  wos:     { label: "CIW (Web of Science)",   parse: (t) => parseCIW(t) },
  scopus:  { label: "Scopus (RIS/CSV)",       parse: (t) => { const r = parseRIS(t); return r.length ? r : parseCSV(t); } },
  embase:  { label: "Embase (RIS)",           parse: (t) => parseRIS(t) },
  cochrane:{ label: "Cochrane (RIS)",         parse: (t) => parseRIS(t) },
  csv:     { label: "CSV",                    parse: (t) => parseCSV(t) },
  tsv:     { label: "TSV",                    parse: (t) => parseCSV(t, "\t") },
  txt:     { label: "Text",                   parse: (t) => parseTXT(t) },
};

// The format options the import UI offers + the file extensions that map onto
// each. 'auto' (the safe default) lets the server content-detect the real format.
export const SUPPORTED_IMPORT_FORMATS = [
  { key: "auto",    label: "Auto-detect",      extensions: [".ris", ".txt", ".nbib", ".bib", ".ciw", ".csv", ".tsv", ".xml"] },
  { key: "ris",     label: "RIS",              extensions: [".ris"] },
  { key: "nbib",    label: "PubMed / MEDLINE", extensions: [".nbib", ".txt"] },
  { key: "ciw",     label: "Web of Science",   extensions: [".ciw", ".txt"] },
  { key: "bibtex",  label: "BibTeX",           extensions: [".bib"] },
  { key: "endnote", label: "EndNote XML",      extensions: [".xml"] },
  { key: "csv",     label: "CSV",              extensions: [".csv"] },
  { key: "tsv",     label: "TSV",              extensions: [".tsv", ".txt"] },
  { key: "txt",     label: "Plain text",       extensions: [".txt"] },
];

/**
 * parseByFormat(text, formatKey, filename)
 * Parse with an EXPLICIT format key from PARSER_REGISTRY. 'auto'/unknown keys —
 * and an explicit key that yields zero records (a mismatched selector) — fall
 * back to content/extension auto-detection. BOM-tolerant. Always returns
 * { records, format }.
 */
export function parseByFormat(text, formatKey, filename) {
  const clean = stripBom(text);
  const key = String(formatKey || "").toLowerCase();
  const entry = key && key !== "auto" ? PARSER_REGISTRY[key] : null;
  if (entry) {
    const records = entry.parse(clean) || [];
    if (records.length) return { records, format: entry.label };
  }
  return detectAndParse(clean, filename);
}

/** detectFormat(text, filename) — the format name auto-detection WOULD choose. */
export function detectFormat(text, filename) {
  return detectAndParse(text, filename).format;
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
