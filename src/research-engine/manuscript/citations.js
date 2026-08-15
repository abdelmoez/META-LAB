/**
 * manuscript/citations.js — 64.md (P3), extended by 117.md §32-§41. Pure,
 * dependency-free citation/reference engine. Builds normalized references from
 * included studies, deduplicates them (DOI → PMID → title+year), and formats
 * reference lists + inline citations in biomedical styles (Vancouver, JAMA, AMA,
 * APA, Harvard, Nature, NEJM). Also exports BibTeX and RIS.
 *
 * Honesty: author/journal/volume/issue/pages come straight from the extracted
 * record. Missing fields are omitted (or shown as a bracketed placeholder when the
 * caller asks) — never invented. Author names are parsed best-effort and fall back
 * to the verbatim string rather than mangling an ambiguous name.
 *
 * 117.md additions, all of which exist so a citation SURVIVES editing:
 *   §32  ALIASES. Deduplication and merges never delete an id — they record
 *        `oldId → survivor`. Every consuming path (ordering, markers, chips,
 *        bibliography, docx) resolves through the same alias map, so a
 *        `[[cite:oldId]]` written months ago keeps pointing at the right reference.
 *        The old dedupe silently DROPPED later duplicates, which orphaned their
 *        citations to "[?]" — `dedupeReferencesWithAliases` is the fix.
 *   §35  MULTI-CITE. One chip may carry several ids: `[[cite:a,b,c]]`. Runs of
 *        three or more consecutive numbers collapse to a range ("[1–4]").
 *   §36  Numbering is ALWAYS by first appearance and never stored.
 *   §37  Styles are a formatting layer over the metadata, not a property of it.
 */

import { SECTION_IDS } from './model.js';

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
  if (style === 'apa' || style === 'harvard') {
    // 117.md §37 — Harvard shares APA's "Family, A. B." author form. Kept as an
    // explicit branch (not a fallthrough) so the two can diverge later without
    // touching APA's pinned output.
    const inits = init ? init.split('').map((c) => `${c}.`).join(' ') : '';
    return inits ? `${family}, ${inits}` : family;
  }
  // vancouver / jama / ama / nature / nejm → "Family AB"
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
  // 117.md §37 — Harvard: "Smith, J., Doe, A. and Roe, B."; 4+ authors → "et al.".
  if (style === 'harvard') {
    if (names.length === 1) return names[0];
    if (names.length > 3) return `${names[0]} et al.`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  // 117.md §37 — Nature lists up to 5 then "et al."; NEJM lists up to 6 then "et al."
  // (its journal-instruction rule), both in the same "Family AB" form as Vancouver.
  if (style === 'nature') {
    if (names.length <= 5) return names.join(', ');
    return `${names[0]} et al.`;
  }
  if (names.length <= 6) return names.join(', ');
  return `${names.slice(0, 6).join(', ')}, et al`;
}

/**
 * 117.md §27 — the EXTENDED bibliographic fields. They are optional on every code
 * path that existed before (BibTeX/RIS/format only emit what is present), so adding
 * them cannot change any pinned output for a reference that does not carry them.
 */
export const EXTRA_REFERENCE_FIELDS = Object.freeze([
  'articleNumber', 'pmcid', 'isbn', 'publisher', 'place', 'edition', 'bookTitle',
  'editors', 'conference', 'institution', 'registryId', 'version', 'repository',
  'publicationType', 'language', 'accessed', 'abstract', 'notes',
  'pdfAttachmentId', 'screeningRecordId', 'studyId', 'sourceDb',
]);

const LIST_REFERENCE_FIELDS = Object.freeze(['keywords', 'tags']);

const asList = (v) => {
  if (Array.isArray(v)) return v.map(clean).filter(Boolean);
  const s = clean(v);
  return s ? s.split(/[;,]/).map(clean).filter(Boolean) : [];
};

/** Normalize an arbitrary reference-ish object into the canonical reference shape. Pure. */
export function normalizeReference(raw, idHint) {
  const r = raw || {};
  const authorsArr = Array.isArray(r.authorsList)
    ? r.authorsList
    : splitAuthors(r.authors || r.author || '').map(parseAuthor);
  const out = {
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
  // 117.md §27 — additive, present-only: a reference that never had a publisher
  // still normalizes to exactly the object it always did.
  for (const f of EXTRA_REFERENCE_FIELDS) {
    const v = clean(r[f]);
    if (v) out[f] = v;
  }
  for (const f of LIST_REFERENCE_FIELDS) {
    const list = asList(r[f]);
    if (list.length) out[f] = list;
  }
  if (r.type) out.type = clean(r.type);
  if (r.origin) out.origin = clean(r.origin);
  if (r.custom && typeof r.custom === 'object' && !Array.isArray(r.custom)) {
    const custom = {};
    for (const k of Object.keys(r.custom)) { const v = clean(r.custom[k]); if (v) custom[k] = v; }
    if (Object.keys(custom).length) out.custom = custom;
  }
  if (Array.isArray(r.corrected) && r.corrected.length) out.corrected = [...r.corrected];
  return out;
}

/**
 * Build references from a project's included studies. The `studies[]` array IS the
 * included/extraction set, so we collect every study carrying citation metadata
 * (title/authors) regardless of whether it has a numeric effect size — a study can
 * be included in the review without entering the meta-analysis.
 *
 * IDS: a study's own id IS the reference id, always. The positional `ref_N`
 * fallback exists only for the (rare, legacy) study rows that carry no id at all —
 * a positional id for a study that HAS one would change every time the study list is
 * reordered, silently repointing citations (117.md §36: stable ids, never positions).
 *
 * `opts.dedupe === false` returns the raw per-study list so the caller can dedupe
 * with alias tracking (117.md §32). Pure.
 */
export function referencesFromProject(project, opts = {}) {
  const studies = Array.isArray(project && project.studies) ? project.studies : [];
  const refs = studies
    .filter((s) => s && (clean(s.title) || clean(s.authors) || clean(s.author)))
    .map((s, i) => {
      const ref = normalizeReference(s, s.id || `ref_${i + 1}`);
      if (s.id) ref.studyId = String(s.id);
      return ref;
    });
  return (opts && opts.dedupe === false) ? refs : dedupeReferences(refs);
}

/** Fields a dedupe merge backfills onto the surviving copy (never overwrites). */
const DEDUPE_FILL_FIELDS = Object.freeze([
  'title', 'year', 'journal', 'volume', 'issue', 'pages', 'doi', 'pmid', 'url',
  ...EXTRA_REFERENCE_FIELDS,
]);

/**
 * 117.md §32 — deduplicate by DOI, then PMID, then normalized title+year, RECORDING
 * an alias for every dropped copy.
 *
 * This is the honest form of the old `dedupeReferences`: dropping a duplicate is
 * fine, but a `[[cite:droppedId]]` already written into the manuscript must keep
 * resolving. It used to render "[?]" forever, which is exactly the "citation nodes
 * pointing at missing references" §39 asks us to detect — created by our own dedupe.
 *
 * @returns {{ refs: object[], aliases: {[droppedId]: survivingId} }}  Pure.
 */
export function dedupeReferencesWithAliases(refs) {
  const list = Array.isArray(refs) ? refs.map((r) => normalizeReference(r, r.id)) : [];
  const seen = new Map();
  const out = [];
  const aliases = {};
  for (const r of list) {
    const keyDoi = r.doi ? `doi:${r.doi.toLowerCase()}` : '';
    const keyPmid = r.pmid ? `pmid:${r.pmid}` : '';
    const keyTitle = r.title ? `t:${r.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${r.year}` : '';
    const key = keyDoi || keyPmid || keyTitle;
    if (!key) { out.push(r); continue; }
    if (seen.has(key)) {
      // merge: keep the more complete record (backfill any field the first copy lacks)
      const existing = seen.get(key);
      for (const f of DEDUPE_FILL_FIELDS) {
        if (!existing[f] && r[f]) existing[f] = r[f];
      }
      for (const f of LIST_REFERENCE_FIELDS) {
        const merged = [...new Set([...(existing[f] || []), ...(r[f] || [])])];
        if (merged.length) existing[f] = merged;
      }
      if ((r.authorsList || []).length > (existing.authorsList || []).length) existing.authorsList = r.authorsList;
      if (r.id && existing.id && r.id !== existing.id) aliases[r.id] = existing.id;
      continue;
    }
    seen.set(key, r);
    out.push(r);
  }
  return { refs: out, aliases };
}

/** Deduplicate references by DOI, then PMID, then normalized title+year. Pure. */
export function dedupeReferences(refs) {
  return dedupeReferencesWithAliases(refs).refs;
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

  // 117.md §37 — Harvard: "Smith, J. and Doe, A. (2020) 'Title', Journal, 12(3), pp. 100-110."
  if (style === 'harvard') {
    const head = join([authors, y ? `(${y})` : '']);
    const titleH = title ? `'${title}',` : '';
    let venue = j || '';
    if (v) venue += `${venue ? ', ' : ''}${v}`;
    if (iss) venue += `(${iss})`;
    if (pg) venue += `${venue ? ', ' : ''}pp. ${pg}`;
    if (venue) venue += '.';
    const doiH = r.doi ? `doi: ${r.doi}.` : '';
    return join([head, titleH, venue, doiH]).trim();
  }

  // 117.md §37 — Nature: "Smith, J. Title. Journal 12, 100-110 (2020)."
  if (style === 'nature') {
    const authN = authors ? `${authors}.` : '';
    const titleN = title ? `${title}.` : '';
    let venue = j || '';
    if (v) venue += `${venue ? ' ' : ''}${v}`;
    if (pg) venue += `${venue ? ', ' : ''}${pg}`;
    const yr = y ? `(${y}).` : (venue ? '.' : '');
    const doiN = r.doi ? `doi:${r.doi}` : '';
    return join([authN, titleN, join([venue, yr]), doiN]).trim();
  }

  // Vancouver / JAMA / AMA / NEJM — "Authors. Title. Journal. Year;Vol(Iss):Pages. doi/PMID"
  // NEJM's reference form is the numbered Vancouver family with the journal
  // abbreviated (abbreviation is the author's data, not ours to invent), so it
  // shares this branch deliberately rather than duplicating a near-identical one.
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
 * Format a reference as styled SEGMENTS [{text, italics}] so renderers (docx/UI)
 * can apply real per-style emphasis. This is where Vancouver and JAMA genuinely
 * DIFFER: JAMA/AMA italicise the journal name (Vancouver does not); APA italicises
 * the journal + volume. The plain-text formatCitation() above is the un-emphasised
 * form used for clipboard/BibTeX. Pure.
 */
export function formatCitationSegments(ref, style = 'vancouver') {
  const r = normalizeReference(ref, ref && ref.id);
  const authors = formatAuthorList(r.authorsList, style);
  const segs = [];
  const push = (text, italics) => { if (clean(text)) segs.push({ text, italics: !!italics }); };

  if (style === 'apa') {
    push(`${authors}${authors ? ' ' : ''}`);
    push(r.year ? `(${r.year}). ` : '');
    push(r.title ? `${r.title}. ` : '');
    let jr = r.journal || '';
    if (r.volume) jr += `${jr ? ', ' : ''}${r.volume}`;
    push(jr, true); // journal + volume italic
    let tail = '';
    if (r.issue) tail += `(${r.issue})`;
    if (r.pages) tail += `${tail || jr ? ', ' : ''}${r.pages}`;
    if (jr || tail) tail += '. ';
    push(tail);
    if (r.doi) push(`https://doi.org/${r.doi}`);
    return segs;
  }

  // 117.md §37 — Harvard italicises the JOURNAL (the title is quoted, not italic).
  if (style === 'harvard') {
    push(authors ? `${authors} ` : '');
    push(r.year ? `(${r.year}) ` : '');
    push(r.title ? `'${r.title}', ` : '');
    push(r.journal ? `${r.journal}` : '', true);
    let tail = '';
    if (r.volume) tail += `${r.journal ? ', ' : ''}${r.volume}`;
    if (r.issue) tail += `(${r.issue})`;
    if (r.pages) tail += `${tail || r.journal ? ', ' : ''}pp. ${r.pages}`;
    if (r.journal || tail) tail += '. ';
    push(tail);
    push(r.doi ? `doi: ${r.doi}.` : '');
    return segs;
  }

  // 117.md §37 — Nature italicises the journal and BOLDS the volume. Bold is a new
  // segment flag; every existing renderer ignores an unknown flag, and the docx
  // exporter reads it, so no other style's output moves.
  if (style === 'nature') {
    push(authors ? `${authors}. ` : '');
    push(r.title ? `${r.title}. ` : '');
    push(r.journal ? `${r.journal} ` : '', true);
    if (r.volume) segs.push({ text: `${r.volume}`, italics: false, bold: true });
    let tail = '';
    if (r.pages) tail += `${r.volume ? ', ' : ''}${r.pages}`;
    if (r.year) tail += `${tail ? ' ' : ''}(${r.year})`;
    if (tail) tail += '. ';
    push(tail);
    push(r.doi ? `doi:${r.doi}` : '');
    return segs;
  }

  // vancouver / jama / ama / nejm
  const journalItalic = (style === 'jama' || style === 'ama' || style === 'nejm');
  push(authors ? `${authors}. ` : '');
  push(r.title ? `${r.title}. ` : '');
  push(r.journal ? `${r.journal}. ` : '', journalItalic);
  let cite = '';
  if (r.year) cite += r.year;
  if (r.volume) cite += `;${r.volume}`;
  if (r.issue) cite += `(${r.issue})`;
  if (r.pages) cite += `:${r.pages}`;
  if (cite) cite += '. ';
  push(cite);
  push(r.doi ? `doi:${r.doi}` : (r.pmid ? `PMID: ${r.pmid}` : ''));
  return segs;
}

/* ── Inline citations: stable [[cite:<refId>]] tokens, auto-numbered by order of
   first appearance across the manuscript (Vancouver/JAMA numeric style).

   117.md §35 — ONE token may carry SEVERAL ids: `[[cite:a,b,c]]`. The id character
   class already excluded `]` and whitespace but not `,`, so multi-cite tokens have
   always been GRAMMATICALLY legal; everything below is what makes them mean
   something. A single-id token is byte-identical to what it always was, so every
   stored manuscript keeps rendering exactly as before. ── */
export const CITATION_TOKEN_RE = /\[\[cite:([^\]\s]+)\]\]/g;

/** Split a token's id payload into individual reference ids. Pure. */
export function parseCiteIds(payload) {
  return String(payload == null ? '' : payload)
    .split(',')
    .map(clean)
    .filter(Boolean);
}

/**
 * Build the stable token a user inserts at the cursor. Accepts one id or a list
 * (117.md §35 — a multi-select insertion is ONE chip, not three adjacent ones, so
 * that "Remove citation" and the range collapse have a single object to act on).
 * Pure.
 */
export function citationToken(refId) {
  const ids = Array.isArray(refId) ? refId.map(clean).filter(Boolean) : parseCiteIds(refId);
  return `[[cite:${ids.join(',')}]]`;
}

/** Resolve an id through an alias map (117.md §32). Cycle-safe. Pure. */
export function resolveCiteId(id, aliases) {
  let cur = clean(id);
  if (!cur || !aliases) return cur;
  const get = (k) => (typeof aliases.get === 'function' ? aliases.get(k) : aliases[k]);
  const seen = new Set([cur]);
  for (let i = 0; i < 32; i += 1) {
    const next = clean(get(cur));
    if (!next || next === cur || seen.has(next)) return cur;
    seen.add(next);
    cur = next;
  }
  return cur;
}

/**
 * Scan ordered section texts for [[cite:id]] tokens; return
 * { orderMap: Map(id→1-based index), orderedIds: [id...] } by first appearance.
 *
 * 117.md §32 — `opts.aliases` maps merged/deduped ids onto their survivor. The
 * returned orderMap carries BOTH the canonical id AND every alias id that resolves
 * into it, so every downstream consumer (markers, chips, docx, the renumber effect)
 * gets the right number from a plain `orderMap.get(idInTheToken)` without knowing
 * aliases exist. That is what keeps a months-old `[[cite:oldId]]` working.
 *
 * §36 — numbering is BY FIRST APPEARANCE and never stored, so reordering paragraphs
 * renumbers for free.
 * Pure.
 */
export function collectCitationOrder(texts, opts = {}) {
  const aliases = opts && opts.aliases;
  /**
   * 117.md §39 — `opts.knownIds` (a Set/Map/array of ids the LIBRARY actually
   * holds) makes an unresolvable citation consume NO number.
   *
   * Without it, `[[cite:typo]]` still took a slot in the sequence while the
   * bibliography — which is built from the reference list, not from the text —
   * skipped it, so every marker after the typo was silently off by one against the
   * numbered list. An off-by-one citation is worse than a visible "[?]": it is
   * confidently wrong. Omitting the option keeps the old behaviour, so callers that
   * genuinely do not know the library (a preview with no project) are unaffected.
   */
  const known = opts && opts.knownIds;
  const isKnown = (id) => {
    if (!known) return true;
    if (typeof known.has === 'function') return known.has(id);
    if (Array.isArray(known)) return known.includes(id);
    return Object.prototype.hasOwnProperty.call(known, id);
  };
  const orderMap = new Map();
  const orderedIds = [];
  const seenRaw = new Set();
  for (const t of (texts || [])) {
    const s = String(t == null ? '' : t);
    const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      for (const raw of parseCiteIds(m[1])) {
        seenRaw.add(raw);
        const id = resolveCiteId(raw, aliases);
        if (!isKnown(id)) continue;
        if (!orderMap.has(id)) { orderMap.set(id, orderedIds.length + 1); orderedIds.push(id); }
      }
    }
  }
  // Mirror each alias id onto its survivor's number (never overwrite a canonical
  // entry — an id that is both cited directly and an alias target keeps its own).
  for (const raw of seenRaw) {
    if (orderMap.has(raw)) continue;
    const id = resolveCiteId(raw, aliases);
    if (orderMap.has(id)) orderMap.set(raw, orderMap.get(id));
  }
  if (aliases && typeof aliases !== 'function') {
    const keys = typeof aliases.keys === 'function' ? [...aliases.keys()] : Object.keys(aliases);
    for (const from of keys) {
      if (orderMap.has(from)) continue;
      const to = resolveCiteId(from, aliases);
      if (orderMap.has(to)) orderMap.set(from, orderMap.get(to));
    }
  }
  return { orderMap, orderedIds };
}

/** The ordered section texts of a draft (canonical section order). Pure. */
export function draftSectionTexts(draft) {
  if (!draft || !draft.sections) return [];
  return SECTION_IDS.map((id) => draft.sections[id] && draft.sections[id].content);
}

/**
 * 117.md §35 — collapse a sorted run of citation numbers to ranges.
 * [1,2] → "1,2" (a two-number "range" is not a range); [1,2,3,4] → "1–4";
 * [1,2,3,7,9,10,11] → "1–3,7,9–11". Uses an EN DASH, which is the typographic
 * convention every one of the supported styles uses for a citation range. Pure.
 */
export function collapseNumberRanges(numbers) {
  const nums = [...new Set((numbers || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j += 1;
    if (j - i >= 2) out.push(`${nums[i]}–${nums[j]}`);
    else for (let k = i; k <= j; k += 1) out.push(String(nums[k]));
    i = j + 1;
  }
  return out.join(',');
}

/** True when a style renders author-year markers rather than numbers (§37). */
export function isAuthorYearStyle(style) {
  return style === 'harvard';
}

/** "Smith, 2020" / "Smith et al., 2020" — the Harvard in-text form. Pure. */
export function authorYearLabel(ref) {
  const r = ref || {};
  const list = Array.isArray(r.authorsList) ? r.authorsList : [];
  const first = list[0];
  const fam = clean(first ? (first.family || first.raw) : '') || clean(r.title) || clean(r.id);
  const name = list.length > 2 ? `${fam} et al.` : (list.length === 2
    ? `${fam} and ${clean(list[1].family || list[1].raw)}`
    : fam);
  const y = clean(r.year);
  return y ? `${name}, ${y}` : name;
}

/**
 * 117.md §35/§37 — the visible marker for ONE citation token.
 *
 * @param ids       the token's reference ids (already alias-resolved or not)
 * @param orderMap  Map(id → 1-based number), alias keys included
 * @param style     citation style id
 * @param opts      { refsById: Map|object } — needed by author-year styles only
 * Unknown ids render "[?]", never a silent omission. Pure.
 */
export function formatCitationMarker(ids, orderMap, style = 'vancouver', opts = {}) {
  const list = Array.isArray(ids) ? ids : parseCiteIds(ids);
  if (!list.length) return '[?]';
  const lookup = (id) => {
    const src = opts && opts.refsById;
    if (!src) return null;
    return (typeof src.get === 'function' ? src.get(id) : src[id]) || null;
  };
  if (isAuthorYearStyle(style)) {
    const parts = list.map((id) => {
      const ref = lookup(id);
      return ref ? authorYearLabel(ref) : '?';
    });
    return `(${parts.join('; ')})`;
  }
  const nums = [];
  let unknown = false;
  for (const id of list) {
    const n = orderMap && (typeof orderMap.get === 'function' ? orderMap.get(id) : orderMap[id]);
    if (n == null) unknown = true; else nums.push(n);
  }
  if (!nums.length) return '[?]';
  const body = collapseNumberRanges(nums) + (unknown ? ',?' : '');
  if (style === 'apa') return `(${body})`;
  return `[${body}]`;
}

/**
 * Replace [[cite:id]] tokens with markers via orderMap. Unknown ids → [?].
 * 117.md §32/§35 — alias-aware and multi-cite-aware; `opts.refsById` enables the
 * author-year styles. Pure.
 */
export function renderInlineMarkers(text, orderMap, style = 'vancouver', opts = {}) {
  const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
  const aliases = opts && opts.aliases;
  return String(text == null ? '' : text).replace(re, (_full, payload) => {
    const ids = parseCiteIds(payload).map((id) => resolveCiteId(id, aliases));
    return formatCitationMarker(ids, orderMap, style, opts);
  });
}

/**
 * Order a manuscript's references by inline-citation appearance, then append any
 * uncited references at the end. If the draft has no inline citations, returns the
 * list unchanged (inclusion order).
 * 117.md §32 — `opts.aliases` makes a citation of a merged-away id order (and
 * therefore number) its SURVIVOR. Pure.
 */
export function orderReferencesForManuscript(draft, refs, opts = {}) {
  const list = Array.isArray(refs) ? refs : [];
  // The reference list IS the known-id set here, so ordering and numbering agree
  // even when the caller did not pass one explicitly (117.md §39).
  const { orderedIds } = collectCitationOrder(draftSectionTexts(draft), {
    ...opts,
    knownIds: opts.knownIds || new Set(list.map((r) => r.id)),
  });
  if (!orderedIds.length) return list;
  const byId = new Map(list.map((r) => [r.id, r]));
  const ordered = [];
  const used = new Set();
  for (const id of orderedIds) { if (byId.has(id) && !used.has(id)) { ordered.push(byId.get(id)); used.add(id); } }
  for (const r of list) { if (!used.has(r.id)) ordered.push(r); }
  return ordered;
}

/**
 * 117.md §39 — every citation token in a draft, with its resolved ids and section.
 * The integrity checks and the "which references are cited" filter both read this,
 * so they can never disagree about what the manuscript actually cites. Pure.
 */
export function collectCitationUsage(draft, opts = {}) {
  const aliases = opts && opts.aliases;
  const tokens = [];
  const cited = new Set();
  const raw = new Set();
  const texts = draftSectionTexts(draft);
  SECTION_IDS.forEach((sectionId, i) => {
    const s = String(texts[i] == null ? '' : texts[i]);
    const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      const ids = parseCiteIds(m[1]);
      const resolved = ids.map((id) => resolveCiteId(id, aliases));
      for (let k = 0; k < ids.length; k += 1) { raw.add(ids[k]); cited.add(resolved[k]); }
      tokens.push({ sectionId, index: m.index, token: m[0], ids, resolved });
    }
  });
  // Statements carry citations too (the docx renders them through the same path).
  const statements = (draft && draft.statements) || {};
  for (const key of Object.keys(statements)) {
    const s = String(statements[key] == null ? '' : statements[key]);
    const re = new RegExp(CITATION_TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(s)) !== null) {
      const ids = parseCiteIds(m[1]);
      const resolved = ids.map((id) => resolveCiteId(id, aliases));
      for (let k = 0; k < ids.length; k += 1) { raw.add(ids[k]); cited.add(resolved[k]); }
      tokens.push({ sectionId: `statement:${key}`, index: m.index, token: m[0], ids, resolved });
    }
  }
  return { tokens, cited, raw };
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
    segments: formatCitationSegments(r, style),
  }));
}

/** Inline citation marker for a 1-based index in a style. Pure. */
export function inlineMarker(index, style = 'vancouver') {
  const n = Number(index);
  if (!Number.isFinite(n)) return '';
  if (style === 'apa') return `(${n})`;
  // Vancouver/JAMA/AMA/Nature/NEJM — superscript-style numeric; rendered as [n] in
  // plain text/markdown. Harvard is author-year and therefore has no meaningful
  // single-number form: callers that can be author-year go through
  // formatCitationMarker (which has the reference metadata) instead.
  return `[${n}]`;
}

/**
 * 117.md §28/§30 — the interchange TYPE codes for a reference type. A reference
 * that never declared a type is `journal-article`, which maps to the codes the
 * exporters have always emitted (`@article` / `TY  - JOUR`), so nothing moves for
 * the references that existed before the taxonomy did.
 */
const BIB_TYPE_BY_REFERENCE_TYPE = {
  'journal-article': 'article',
  book: 'book',
  'book-chapter': 'incollection',
  'conference-abstract': 'inproceedings',
  'conference-proceeding': 'inproceedings',
  website: 'misc',
  guideline: 'techreport',
  report: 'techreport',
  thesis: 'phdthesis',
  preprint: 'misc',
  dataset: 'misc',
  'trial-registration': 'misc',
  'review-registration': 'misc',
  'government-publication': 'techreport',
  software: 'misc',
  other: 'misc',
};

const RIS_TYPE_BY_REFERENCE_TYPE = {
  'journal-article': 'JOUR',
  book: 'BOOK',
  'book-chapter': 'CHAP',
  'conference-abstract': 'CONF',
  'conference-proceeding': 'CPAPER',
  website: 'ELEC',
  guideline: 'STAND',
  report: 'RPRT',
  thesis: 'THES',
  preprint: 'JOUR',
  dataset: 'DATA',
  'trial-registration': 'DBASE',
  'review-registration': 'DBASE',
  'government-publication': 'GOVDOC',
  software: 'COMP',
  other: 'GEN',
};

function bibEntryType(ref) {
  return BIB_TYPE_BY_REFERENCE_TYPE[ref && ref.type] || 'article';
}

function risEntryType(ref) {
  return RIS_TYPE_BY_REFERENCE_TYPE[ref && ref.type] || 'JOUR';
}

/** BibTeX export for a set of references. Pure. */
export function toBibTeX(refs) {
  const list = dedupeReferences(refs);
  // Escape LaTeX/BibTeX specials so titles like "A & B in 50%…" produce valid .bib.
  const esc = (s) => clean(s)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}]/g, '')
    .replace(/([&%$#_])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
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
      // 117.md §27/§41 — present-only, so a reference without them produces the
      // exact bytes it always did.
      r.publisher && `  publisher = {${esc(r.publisher)}}`,
      r.isbn && `  isbn = {${r.isbn}}`,
      r.edition && `  edition = {${esc(r.edition)}}`,
      r.url && `  url = {${r.url}}`,
    ].filter(Boolean).join(',\n');
    return `@${bibEntryType(r)}{${key},\n${fields}\n}`;
  }).join('\n\n') + (list.length ? '\n' : '');
}

/** RIS export for a set of references. Pure. */
export function toRIS(refs) {
  const list = dedupeReferences(refs);
  return list.map((r) => {
    const lines = [`TY  - ${risEntryType(r)}`];
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
      const pg = String(r.pages).split(/[-–]+/).filter(Boolean); // collapse double-hyphen ranges
      if (pg[0]) lines.push(`SP  - ${clean(pg[0])}`);
      if (pg[1]) lines.push(`EP  - ${clean(pg[1])}`);
    }
    if (r.doi) lines.push(`DO  - ${r.doi}`);
    if (r.pmid) lines.push(`AN  - ${r.pmid}`);
    // 117.md §27/§30 — present-only extras, in the tags the importers read back.
    if (r.publisher) lines.push(`PB  - ${r.publisher}`);
    if (r.isbn) lines.push(`SN  - ${r.isbn}`);
    if (r.url) lines.push(`UR  - ${r.url}`);
    if (r.language) lines.push(`LA  - ${r.language}`);
    if (r.abstract) lines.push(`AB  - ${r.abstract}`);
    for (const k of (r.keywords || [])) lines.push(`KW  - ${k}`);
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
  dedupeReferencesWithAliases,
  formatCitation,
  formatCitationSegments,
  generateReferenceList,
  inlineMarker,
  citationToken,
  parseCiteIds,
  resolveCiteId,
  collapseNumberRanges,
  isAuthorYearStyle,
  authorYearLabel,
  formatCitationMarker,
  collectCitationOrder,
  collectCitationUsage,
  draftSectionTexts,
  renderInlineMarkers,
  orderReferencesForManuscript,
  toBibTeX,
  toRIS,
  auditReferences,
};
