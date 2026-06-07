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
  if (fn.endsWith(".ris") || /^TY\s{0,2}-/m.test(head))
    return { records: parseRIS(text), format: "RIS" };

  // fallback: try each format in turn
  let r = parseRIS(text);   if (r.length) return { records: r, format: "RIS" };
  r = parseBibTeX(text);    if (r.length) return { records: r, format: "BibTeX" };
  r = parseNBIB(text);      if (r.length) return { records: r, format: "MEDLINE" };
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
