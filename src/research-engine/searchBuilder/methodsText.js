/**
 * methodsText.js — 69.md §8. Pure, dependency-free generator of a manuscript-ready
 * "Search strategy" Methods paragraph from a saved Search-Builder strategy plus its
 * versions and (optional) executed run counts.
 *
 * DESIGN RULE — HONEST, NEVER FABRICATED. Every sentence is derived from persisted
 * data. Where a fact is genuinely absent, the text emits an explicit bracketed
 * placeholder (e.g. "[insert search date]") rather than inventing a value. Counts are
 * only stated when real run data is supplied; the function never guesses a hit count.
 *
 * Input:
 *   strategy : the `search` module state { concepts[], databases[], filters{} }
 *   versions : [{ version, name, isFinal }]   (to name the final/frozen version)
 *   runs     : [{ provider, date, count }]    (per-database executed counts) — optional
 *
 * Output: { text } is assembled by the caller; this module returns the paragraph
 * string. Exported for unit testing.
 */

const s = (v) => String(v == null ? '' : v);
const trim = (v) => s(v).trim();

// Human labels for the database ids the Search Builder catalogue emits. Kept as a
// small local map (dependency-free) with a graceful fallback to the raw id so a new
// catalogue entry never breaks the paragraph.
const DB_LABELS = {
  pubmed: 'PubMed',
  medline: 'MEDLINE',
  embase: 'Embase',
  cochrane: 'the Cochrane Central Register of Controlled Trials (CENTRAL)',
  central: 'the Cochrane Central Register of Controlled Trials (CENTRAL)',
  scopus: 'Scopus',
  webofscience: 'Web of Science',
  wos: 'Web of Science',
  cinahl: 'CINAHL',
  psycinfo: 'PsycINFO',
  clinicaltrials: 'ClinicalTrials.gov',
  ictrp: 'the WHO ICTRP',
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  core: 'CORE',
  doaj: 'the Directory of Open Access Journals (DOAJ)',
  europepmc: 'Europe PMC',
  semanticscholar: 'Semantic Scholar',
  lens: 'The Lens',
  base: 'BASE',
};

function dbLabel(id) {
  const key = trim(id).toLowerCase();
  return DB_LABELS[key] || trim(id);
}

/** Grammatical list join: [] → '', [a] → 'a', [a,b] → 'a and b', [a,b,c] → 'a, b, and c'. */
function joinList(items) {
  const xs = items.filter(Boolean);
  if (!xs.length) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}

function conceptList(strategy) {
  const raw = strategy && Array.isArray(strategy.concepts) ? strategy.concepts : [];
  return raw
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      label: trim(c.label) || trim(c.picoField),
      terms: (Array.isArray(c.terms) ? c.terms : []).filter((t) => t && typeof t === 'object' && trim(t.text)),
    }))
    .filter((c) => c.terms.length > 0);
}

function selectedDatabases(strategy) {
  const raw = strategy && Array.isArray(strategy.databases) ? strategy.databases : [];
  const out = [];
  const seen = new Set();
  for (const d of raw) {
    const id = trim(d);
    if (id && !seen.has(id.toLowerCase())) { seen.add(id.toLowerCase()); out.push(id); }
  }
  return out;
}

function normFilters(strategy) {
  const f = strategy && strategy.filters && typeof strategy.filters === 'object' ? strategy.filters : {};
  const arr = (v) => (Array.isArray(v) ? v.map(trim).filter(Boolean) : []);
  return {
    dateFrom: trim(f.dateFrom),
    dateTo: trim(f.dateTo),
    languages: arr(f.languages),
    pubTypes: arr(f.pubTypes),
  };
}

function finalVersion(versions) {
  const vs = Array.isArray(versions) ? versions : [];
  return vs.find((v) => v && v.isFinal) || null;
}

/** Language display: common ISO codes → English names; otherwise the raw token. */
const LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
  nl: 'Dutch', ar: 'Arabic',
};
function langLabel(code) {
  const k = trim(code).toLowerCase();
  return LANG_NAMES[k] || trim(code);
}

/**
 * buildSearchMethodsText({ strategy, versions, runs }) — the paragraph string.
 * Always returns a non-empty string; uses bracketed placeholders where data is
 * absent so the output is never silently wrong or fabricated.
 */
export function buildSearchMethodsText({ strategy, versions, runs } = {}) {
  const concepts = conceptList(strategy);
  const dbs = selectedDatabases(strategy);
  const filters = normFilters(strategy);
  const runList = Array.isArray(runs) ? runs.filter((r) => r && typeof r === 'object') : [];
  const finalV = finalVersion(versions);

  const sentences = [];

  // 1) Databases searched + date. Honest placeholder for the date (the strategy has
  //    no inherent "search date"; a real date only exists once a run executes).
  const dbNames = dbs.map(dbLabel);
  if (dbNames.length) {
    sentences.push(`We searched ${joinList(dbNames)} on [insert search date].`);
  } else {
    sentences.push('We searched [insert databases] on [insert search date].');
  }

  // 2) Concept structure. N concepts combined with AND; synonyms within a concept OR.
  if (concepts.length === 0) {
    sentences.push('The search strategy is [insert search strategy — no concepts have been defined yet].');
  } else if (concepts.length === 1) {
    const c = concepts[0];
    sentences.push(`The search strategy comprised a single concept${c.label ? ` (${c.label})` : ''}, with synonyms combined using the OR operator.`);
  } else {
    const labels = concepts.map((c) => c.label).filter(Boolean);
    const named = labels.length === concepts.length
      ? ` (${joinList(labels)})`
      : '';
    sentences.push(`The search strategy combined ${concepts.length} concepts${named} using the AND operator, with synonyms within each concept combined using the OR operator.`);
  }

  // 3) Filters / limits — only when present.
  const limitClauses = [];
  if (filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom && filters.dateTo) limitClauses.push(`publication dates from ${filters.dateFrom} to ${filters.dateTo}`);
    else if (filters.dateFrom) limitClauses.push(`publication dates from ${filters.dateFrom} onwards`);
    else limitClauses.push(`publication dates up to ${filters.dateTo}`);
  }
  if (filters.languages.length) {
    const names = filters.languages.map(langLabel);
    limitClauses.push(`publications in ${joinList(names)}`);
  }
  if (filters.pubTypes.length) {
    limitClauses.push(`the following publication types: ${joinList(filters.pubTypes)}`);
  }
  if (limitClauses.length) {
    sentences.push(`Results were limited to ${joinList(limitClauses)}.`);
  }

  // 4) Per-run counts — ONLY when real run data is supplied; never fabricated.
  if (runList.length) {
    const parts = [];
    let total = 0;
    let haveTotal = true;
    for (const r of runList) {
      const label = dbLabel(r.provider);
      // Number(null) === 0, so guard the empty/absent cases BEFORE coercing — a
      // missing count must become a placeholder, never a fabricated "n = 0".
      const hasCount = r.count != null && r.count !== '' && Number.isFinite(Number(r.count));
      const count = hasCount ? Number(r.count) : null;
      if (count == null) { haveTotal = false; parts.push(`${label} ([insert count])`); }
      else { total += count; parts.push(`${label} (n = ${count})`); }
    }
    let runSentence = `The most recent search retrieved records from ${joinList(parts)}`;
    if (haveTotal && runList.length > 1) runSentence += `, for a total of ${total} records`;
    runSentence += '.';
    sentences.push(runSentence);
  }

  // 5) Final version provenance — only when a version is marked final.
  if (finalV) {
    const vName = trim(finalV.name);
    const vNum = Number.isFinite(Number(finalV.version)) ? Number(finalV.version) : null;
    const id = vName
      ? `"${vName}"${vNum != null ? ` (version ${vNum})` : ''}`
      : (vNum != null ? `version ${vNum}` : 'the final version');
    sentences.push(`The final search strategy (${id}) was frozen for reproducibility, and the full term-by-term strategy for each database is provided in the supplementary material.`);
  } else {
    sentences.push('The full term-by-term search strategy for each database is provided in the supplementary material.');
  }

  return sentences.join(' ');
}

export default buildSearchMethodsText;
