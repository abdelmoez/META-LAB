/**
 * pecanSearch/query/vocab.js — shared provider VOCABULARY mapping.
 *
 * Canonical filter values (language, publication type) arrive as human labels OR
 * codes (a user picks "English" or "review" from a dropdown). Each provider's API
 * expects a DIFFERENT token for the same concept:
 *
 *   language →  PubMed: full English name ("English")
 *               Europe PMC: ISO 639-2/B 3-letter ("eng")
 *               OpenAlex / DOAJ: ISO 639-1 2-letter ("en")     [verified live 2026-06]
 *   pub type →  Crossref: a fixed set of work-type ids (no "review"/"RCT")
 *               Semantic Scholar: a fixed publicationTypes enum ("Review","ClinicalTrial")
 *
 * Passing the raw label through silently zeroed sources (e.g. Europe PMC LANG:"English"
 * → 0 hits; Crossref filter=type:review → the whole query errored). These pure helpers
 * resolve a value to the exact provider token, or return '' so the caller can DROP the
 * clause and emit an explicit warning — never silently weakening the query.
 */

// [name, ISO 639-1, ISO 639-2/B, PubMed English name]
const LANGUAGES = [
  ['english', 'en', 'eng', 'English'],
  ['spanish', 'es', 'spa', 'Spanish'],
  ['french', 'fr', 'fre', 'French'],
  ['german', 'de', 'ger', 'German'],
  ['italian', 'it', 'ita', 'Italian'],
  ['portuguese', 'pt', 'por', 'Portuguese'],
  ['dutch', 'nl', 'dut', 'Dutch'],
  ['russian', 'ru', 'rus', 'Russian'],
  ['chinese', 'zh', 'chi', 'Chinese'],
  ['japanese', 'ja', 'jpn', 'Japanese'],
  ['korean', 'ko', 'kor', 'Korean'],
  ['arabic', 'ar', 'ara', 'Arabic'],
  ['polish', 'pl', 'pol', 'Polish'],
  ['turkish', 'tr', 'tur', 'Turkish'],
  ['swedish', 'sv', 'swe', 'Swedish'],
  ['danish', 'da', 'dan', 'Danish'],
  ['norwegian', 'no', 'nor', 'Norwegian'],
  ['finnish', 'fi', 'fin', 'Finnish'],
  ['czech', 'cs', 'cze', 'Czech'],
  ['greek', 'el', 'gre', 'Greek'],
  ['hungarian', 'hu', 'hun', 'Hungarian'],
  ['hebrew', 'he', 'heb', 'Hebrew'],
  ['ukrainian', 'uk', 'ukr', 'Ukrainian'],
  ['persian', 'fa', 'per', 'Persian'],
  ['hindi', 'hi', 'hin', 'Hindi'],
  ['romanian', 'ro', 'rum', 'Romanian'],
];

// ISO 639-2/T (terminology) → 639-2/B (bibliographic) aliases, plus common variants
// we accept on input so a user code like "deu"/"zho"/"fra" still resolves.
const LANG_ALIASES = { deu: 'ger', fra: 'fre', zho: 'chi', nld: 'dut', ron: 'rum', ell: 'gre', fas: 'per', ces: 'cze', heb: 'heb' };

const LANG_INDEX = new Map();
for (const row of LANGUAGES) {
  const obj = { name: row[0], iso1: row[1], iso2b: row[2], pubmed: row[3] };
  LANG_INDEX.set(row[0], obj); // full name
  LANG_INDEX.set(row[1], obj); // 639-1
  LANG_INDEX.set(row[2], obj); // 639-2/B
}

/** Resolve any language input (name / 2-letter / 3-letter) → the language record, or null. */
export function resolveLanguage(value) {
  let v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return null;
  if (LANG_INDEX.has(v)) return LANG_INDEX.get(v);
  if (LANG_ALIASES[v] && LANG_INDEX.has(LANG_ALIASES[v])) return LANG_INDEX.get(LANG_ALIASES[v]);
  return null;
}
export function toIso6391(value) { const r = resolveLanguage(value); return r ? r.iso1 : ''; }
export function toIso6392b(value) { const r = resolveLanguage(value); return r ? r.iso2b : ''; }
export function toPubmedLanguage(value) { const r = resolveLanguage(value); return r ? r.pubmed : ''; }

// ── Crossref work types ──────────────────────────────────────────────────────────
// Crossref `filter=type:<id>` accepts ONLY these ids. Sending an unknown id (e.g.
// "review", "randomized-controlled-trial") makes the WHOLE /works request fail, so an
// unmappable value must be dropped + warned, never emitted. (Crossref has no review /
// study-design types — those are a study attribute, not a Crossref work type.)
const CROSSREF_TYPES = {
  'journal-article': 'journal-article', 'journal article': 'journal-article', article: 'journal-article', 'research-article': 'journal-article',
  book: 'book', 'book-chapter': 'book-chapter', 'book chapter': 'book-chapter', chapter: 'book-chapter',
  'edited-book': 'edited-book', 'reference-book': 'reference-book', monograph: 'monograph',
  'proceedings-article': 'proceedings-article', 'conference paper': 'proceedings-article', proceedings: 'proceedings-article',
  dataset: 'dataset', preprint: 'posted-content', 'posted-content': 'posted-content',
  dissertation: 'dissertation', thesis: 'dissertation', report: 'report', standard: 'standard',
  'journal-issue': 'journal-issue', component: 'component', other: 'other',
};
/** Map a publication-type label → a valid Crossref work-type id, or '' if none. */
export function toCrossrefType(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  if (CROSSREF_TYPES[v]) return CROSSREF_TYPES[v];
  // Accept an already-valid hyphenated id passed straight through (e.g. "posted-content").
  if (Object.values(CROSSREF_TYPES).includes(v)) return v;
  return '';
}

// ── Semantic Scholar publication types ────────────────────────────────────────────
// S2 `publicationTypes` is a fixed enum; an unknown value matches nothing (→ 0).
const S2_TYPES = {
  review: 'Review', 'systematic review': 'Review',
  'journal article': 'JournalArticle', article: 'JournalArticle', 'research-article': 'JournalArticle',
  'case report': 'CaseReport',
  'clinical trial': 'ClinicalTrial', 'randomized controlled trial': 'ClinicalTrial', rct: 'ClinicalTrial',
  'conference paper': 'Conference', conference: 'Conference', proceedings: 'Conference',
  dataset: 'Dataset', editorial: 'Editorial',
  letter: 'LettersAndComments', 'letters and comments': 'LettersAndComments', comment: 'LettersAndComments',
  'meta-analysis': 'MetaAnalysis', 'meta analysis': 'MetaAnalysis',
  news: 'News', study: 'Study', book: 'Book', 'book chapter': 'BookSection', 'book-section': 'BookSection',
};
const S2_ENUM = new Set(Object.values(S2_TYPES));
/** Map a publication-type label → an S2 publicationTypes enum value, or '' if none. */
export function toS2PublicationType(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v) return '';
  if (S2_TYPES[v]) return S2_TYPES[v];
  // Accept an already-valid enum value passed straight through (case-insensitive).
  for (const e of S2_ENUM) if (e.toLowerCase() === v) return e;
  return '';
}

// ── Date bounds ────────────────────────────────────────────────────────────────────
/**
 * parseDateBound — accept YYYY, YYYY-MM, or YYYY-MM-DD (with - or / separators).
 * Returns { year, month, day, ymd } or null for an unparseable value, so connectors
 * can drop a typo'd bound (e.g. "soon") + warn instead of emitting a clause that
 * silently zeroes the query (PubMed "soon"[Date - Publication]; Crossref from-pub-date:soon).
 */
export function parseDateBound(value) {
  const s = String(value == null ? '' : value).trim().replace(/\//g, '-');
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!m) return null;
  const year = m[1];
  const month = m[2] ? String(Math.min(12, Math.max(1, parseInt(m[2], 10)))).padStart(2, '0') : null;
  const day = m[3] ? String(Math.min(31, Math.max(1, parseInt(m[3], 10)))).padStart(2, '0') : null;
  return { year, month, day, ymd: [year, month, day].filter(Boolean).join('-') };
}
