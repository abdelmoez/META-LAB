/**
 * manuscript/citations.js — 64.md (P3). Pure, dependency-free citation/reference
 * engine. Builds normalized references from included studies, deduplicates them
 * (DOI → PMID → title+year), and formats reference lists + inline citations in
 * biomedical styles (Vancouver, JAMA, AMA, APA). Also exports BibTeX and RIS.
 *
 * Honesty: author/journal/volume/issue/pages come straight from the extracted
 * record. Missing fields are omitted (or shown as a bracketed placeholder when the
 * caller asks) — never invented. Author names are parsed best-effort and fall back
 * to the verbatim string rather than mangling an ambiguous name.
 */

const clean = (s) => String(s == null ? '' : s).trim();

/**
 * Split an author free-text string into individual author tokens. Prefers an
 * explicit ';' separator; falls back to ' and '/'&'; finally to ',' ONLY when the
 * comma clearly separates "Surname Initials"-style names (so "Smith, John" is kept
 * whole but "Smith J, Doe A" splits). Pure.
 */
export function splitAuthors(str) {
  const s = clean(str);
  if (!s) return [];
  if (s.includes(';')) return s.split(';').map(clean).filter(Boolean);
  if (/\band\b|&/.test(s)) return s.split(/\s+and\s+|\s*&\s*/i).map(clean).filter(Boolean);
  if (s.includes(',')) {
    const parts = s.split(',').map(clean).filter(Boolean);
    // Split on commas only when EVERY piece is a "Surname Initials" token (ends in
    // 1-3 capital initials, optionally dotted) — so "Smith J, Doe A" splits but the
    // single Last,First author "Smith, John" is kept verbatim (never mangled).
    const looksLikeNames = parts.length > 1 && parts.every((p) => /\s+[A-Z]{1,3}\.?$/.test(p));
    if (looksLikeNames) return parts;
    return [s]; // ambiguous (e.g. "Smith, John") → keep verbatim as one author
  }
  return [s];
}

/** Parse one author token into {family, given} best-effort. Pure. */
export function parseAuthor(token) {
  const t = clean(token);
  if (!t) return { family: '', given: '', raw: '' };
  if (t.includes(',')) {
    const [fam, giv] = t.split(',');
    return { family: clean(fam), given: clean(giv), raw: t };
  }
  // "Surname AB" or "Surname Firstname"
  const m = t.match(/^(.*?)\s+([A-Za-z.\- ]+)$/);
  if (m) {
    const family = clean(m[1]);
    const givenRaw = clean(m[2]);
    return { family, given: givenRaw, raw: t };
  }
  return { family: t, given: '', raw: t };
}

/** Initials "AB" from a given-name string ("Andrew B." / "Andrew Brian" / "A B"). */
function initialsOf(given) {
  const g = clean(given);
  if (!g) return '';
  const tokens = g.split(/[\s.\-]+/).filter(Boolean);
  return tokens.map((w) => w[0].toUpperCase()).join('');
}

/** Format a single author for a given style. Pure. */
export function formatAuthorName(author, style = 'vancouver') {
  const a = author || {};
  const family = clean(a.family) || clean(a.raw);
  const init = initialsOf(a.given);
  if (!family) return clean(a.raw);
  if (style === 'apa') {
    const inits = init ? init.split('').map((c) => `${c}.`).join(' ') : '';
    return inits ? `${family}, ${inits}` : family;
  }
  // vancouver / jama / ama → "Family AB"
  return init ? `${family} ${init}` : family;
}

/** Format the full author list for a style (with et al. rules). Pure. */
export function formatAuthorList(authors, style = 'vancouver') {
  const list = (Array.isArray(authors) ? authors : []).map((a) =>
    (typeof a === 'string' ? parseAuthor(a) : a));
  if (!list.length) return '';
  const names = list.map((a) => formatAuthorName(a, style));
  // Vancouver/JAMA/AMA: list up to 6, then "et al."; APA: up to 20 with & before last.
  if (style === 'apa') {
    if (names.length === 1) return names[0];
    if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
    return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`;
  }
  if (names.length <= 6) return names.join(', ');
  return `${names.slice(0, 6).join(', ')}, et al`;
}

/** Normalize an arbitrary reference-ish object into the canonical reference shape. Pure. */
export function normalizeReference(raw, idHint) {
  const r = raw || {};
  const authorsArr = Array.isArray(r.authorsList)
    ? r.authorsList
    : splitAuthors(r.authors || r.author || '').map(parseAuthor);
  return {
    id: r.id || idHint || '',
    authorsList: authorsArr,
    authorsRaw: clean(r.authors || r.author || ''),
    title: clean(r.title),
    journal: clean(r.journal),
    year: clean(r.year),
    volume: clean(r.volume),
    issue: clean(r.issue),
    pages: clean(r.pages),
    doi: clean(r.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''),
    pmid: clean(r.pmid),
    url: clean(r.url),
    used: r.used !== false,
  };
}

/** Build references from a project's included studies (numeric ES first, then any with a title). Pure. */
export function referencesFromProject(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const onlyIncluded = opts.onlyIncluded !== false;
  const pool = onlyIncluded
    ? studies.filter((s) => s && (s.es !== '' && s.es != null && !isNaN(+s.es)) || (s && clean(s.title)))
    : studies;
  const refs = pool
    .filter((s) => s && (clean(s.title) || clean(s.authors) || clean(s.author)))
    .map((s, i) => normalizeReference(s, s.id || `ref_${i + 1}`));
  return dedupeReferences(refs);
}

/** Deduplicate references by DOI, then PMID, then normalized title+year. Pure. */
export function dedupeReferences(refs) {
  const list = Array.isArray(refs) ? refs.map((r) => normalizeReference(r, r.id)) : [];
  const seen = new Map();
  const out = [];
  for (const r of list) {
    const keyDoi = r.doi ? `doi:${r.doi.toLowerCase()}` : '';
    const keyPmid = r.pmid ? `pmid:${r.pmid}` : '';
    const keyTitle = r.title ? `t:${r.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${r.year}` : '';
    const key = keyDoi || keyPmid || keyTitle;
    if (!key) { out.push(r); continue; }
    if (seen.has(key)) {
      // merge: keep the more complete record
      const existing = seen.get(key);
      for (const f of ['journal', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url']) {
        if (!existing[f] && r[f]) existing[f] = r[f];
      }
      continue;
    }
    seen.set(key, r);
    out.push(r);
  }
  return out;
}

function pagesPart(r) {
  return r.pages ? r.pages : '';
}

/** Format a single reference (no leading number) in the given style. Pure. */
export function formatCitation(ref, style = 'vancouver') {
  const r = normalizeReference(ref, ref && ref.id);
  const authors = formatAuthorList(r.authorsList, style);
  const title = r.title;
  const j = r.journal;
  const y = r.year;
  const v = r.volume;
  const iss = r.issue;
  const pg = pagesPart(r);
  const doi = r.doi ? `doi:${r.doi}` : '';
  const pmid = r.pmid ? `PMID: ${r.pmid}` : '';

  const join = (parts, sep = ' ') => parts.filter((x) => clean(x)).join(sep);

  if (style === 'apa') {
    // Author, A. B. (Year). Title. Journal, Volume(Issue), Pages. https://doi.org/…
    const head = join([authors, y ? `(${y}).` : '']);
    const titleP = title ? `${title}.` : '';
    let jp = j;
    if (v) jp += `, ${v}`;
    if (iss) jp += `(${iss})`;
    if (pg) jp += `, ${pg}`;
    if (jp) jp += '.';
    const doiP = r.doi ? `https://doi.org/${r.doi}` : '';
    return join([head, titleP, jp, doiP]).trim();
  }

  // Vancouver / JAMA / AMA — "Authors. Title. Journal. Year;Vol(Iss):Pages. doi/PMID"
  const titleP = title ? `${title}.` : '';
  const authP = authors ? `${authors}.` : '';
  const jp = j ? `${j}.` : '';
  // Year;Vol(Iss):Pages
  let cite = '';
  if (y) cite += y;
  if (v) cite += `;${v}`;
  if (iss) cite += `(${iss})`;
  if (pg) cite += `:${pg}`;
  if (cite) cite += '.';
  const idPart = doi || pmid;
  // JAMA tends to italicise the journal — handled by the renderer; the string is style-agnostic here.
  return join([authP, titleP, jp, cite, idPart]).trim();
}

/**
 * Generate a numbered reference list. Returns an array of { index, id, ref, text }
 * in the supplied order (order of appearance / inclusion). Pure.
 */
export function generateReferenceList(refs, style = 'vancouver') {
  const list = dedupeReferences(refs);
  return list.map((r, i) => ({
    index: i + 1,
    id: r.id,
    ref: r,
    text: formatCitation(r, style),
  }));
}

/** Inline citation marker for a 1-based index in a style. Pure. */
export function inlineMarker(index, style = 'vancouver') {
  const n = Number(index);
  if (!Number.isFinite(n)) return '';
  if (style === 'apa') return `(${n})`;
  // Vancouver/JAMA/AMA — superscript-style numeric; rendered as [n] in plain text/markdown.
  return `[${n}]`;
}

/** BibTeX export for a set of references. Pure. */
export function toBibTeX(refs) {
  const list = dedupeReferences(refs);
  const esc = (s) => clean(s).replace(/[{}]/g, '');
  return list.map((r, i) => {
    const first = (r.authorsList[0] && (r.authorsList[0].family || r.authorsList[0].raw)) || 'ref';
    const key = `${esc(first).replace(/[^A-Za-z0-9]/g, '')}${r.year || ''}${i + 1}`;
    const authorBib = r.authorsList.map((a) => (a.family ? `${a.family}, ${a.given}`.trim().replace(/,\s*$/, '') : a.raw)).join(' and ');
    const fields = [
      authorBib && `  author = {${authorBib}}`,
      r.title && `  title = {${esc(r.title)}}`,
      r.journal && `  journal = {${esc(r.journal)}}`,
      r.year && `  year = {${r.year}}`,
      r.volume && `  volume = {${r.volume}}`,
      r.issue && `  number = {${r.issue}}`,
      r.pages && `  pages = {${esc(r.pages)}}`,
      r.doi && `  doi = {${r.doi}}`,
      r.pmid && `  pmid = {${r.pmid}}`,
    ].filter(Boolean).join(',\n');
    return `@article{${key},\n${fields}\n}`;
  }).join('\n\n') + (list.length ? '\n' : '');
}

/** RIS export for a set of references. Pure. */
export function toRIS(refs) {
  const list = dedupeReferences(refs);
  return list.map((r) => {
    const lines = ['TY  - JOUR'];
    for (const a of r.authorsList) {
      const nm = a.family ? `${a.family}, ${a.given}`.replace(/,\s*$/, '') : a.raw;
      if (nm) lines.push(`AU  - ${nm}`);
    }
    if (r.title) lines.push(`TI  - ${r.title}`);
    if (r.journal) lines.push(`JO  - ${r.journal}`);
    if (r.year) lines.push(`PY  - ${r.year}`);
    if (r.volume) lines.push(`VL  - ${r.volume}`);
    if (r.issue) lines.push(`IS  - ${r.issue}`);
    if (r.pages) {
      const [sp, ep] = String(r.pages).split(/[-–]/);
      if (sp) lines.push(`SP  - ${clean(sp)}`);
      if (ep) lines.push(`EP  - ${clean(ep)}`);
    }
    if (r.doi) lines.push(`DO  - ${r.doi}`);
    if (r.pmid) lines.push(`AN  - ${r.pmid}`);
    lines.push('ER  - ');
    return lines.join('\n');
  }).join('\n\n') + (list.length ? '\n' : '');
}

/** Quick completeness audit for journal-submission readiness. Pure. */
export function auditReferences(refs) {
  const list = dedupeReferences(refs);
  const missingId = list.filter((r) => !r.doi && !r.pmid).length;
  const missingJournal = list.filter((r) => !r.journal).length;
  const missingYear = list.filter((r) => !r.year).length;
  return {
    total: list.length,
    missingDoiOrPmid: missingId,
    missingJournal,
    missingYear,
  };
}

export default {
  splitAuthors,
  parseAuthor,
  formatAuthorName,
  formatAuthorList,
  normalizeReference,
  referencesFromProject,
  dedupeReferences,
  formatCitation,
  generateReferenceList,
  inlineMarker,
  toBibTeX,
  toRIS,
  auditReferences,
};
