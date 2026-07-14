/**
 * strategyGenerator.js — P11 Task 1 (pure engine half of the Guided Boolean search
 * strategy generator ↔ critic loop). Deterministic, network-free rendering of a saved
 * Search-Builder concept model into database-specific Boolean strategies at three
 * sensitivity profiles (broad / balanced / precise).
 *
 * Input shape (the persisted `search` module state):
 *   { concepts:[{ id, label, picoField, op, terms:[{ text, type:'freetext'|'controlled',
 *                 field, vocab:{mesh,emtree,...}, noExplode, truncate, phrase }] }],
 *     databases:[ids], filters:{ dateFrom, dateTo, languages:[], pubTypes:[] } }
 *
 * generateStrategies({ concepts, databases, filters, options }) →
 *   { strategies:[{ database, profile, searchString,
 *                   blocks:[{ concept, terms:[], mesh:[], freeText:[], fieldTags:[], explanation }],
 *                   filters, warnings:[{type,message,term?}] }], notes:[] }
 *
 * ── HOW TO ADD A DATABASE RENDERER (extension point) ──────────────────────────
 * Every provider is a small object registered in RENDERERS via registerRenderer():
 *   {
 *     id, label,
 *     supportsControlled,                 // does it have a subject-heading field (MeSH/Emtree)?
 *     controlledTagLabel(profile),        // e.g. 'Mesh' | 'Majr:NoExp'  (only if supportsControlled)
 *     controlledToken(term, profile),     // rendered controlled clause (only if supportsControlled)
 *     freeTagLabel(term, profile),        // the field tag/scope a free-text term uses
 *     freeToken(term, profile),           // rendered free-text clause
 *     compose(blockQs, filters, profile), // AND-join the concept blocks + attach filters
 *   }
 * Adding Embase / Scopus / Web of Science / Cochrane is a single registerRenderer()
 * call — no change to the generation loop. Unknown databases fall back to a generic
 * keyword rendering and an honest note (native syntax for that DB is not generated).
 * We NEVER fabricate provider syntax.
 *
 * Pure + deterministic: no Date.now(), no randomness, no I/O.
 */
import { matchFamily, norm } from './conceptExtraction.js';
import { getDatabase } from './databases.js';
import { isLiveTerm } from './termLiveness.js';

export const PROFILES = Object.freeze(['broad', 'balanced', 'precise']);
const PROFILE_SET = new Set(PROFILES);

const s = (v) => String(v == null ? '' : v);
const isPhrase = (t) => /\s/.test(s(t).trim());
const quote = (t) => `"${s(t).trim().replace(/"/g, '')}"`;

/* ── ISO / language helpers (tiny, dependency-free) ──────────────────────────── */
const LANG_CODE_TO_NAME = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
  nl: 'Dutch', ar: 'Arabic',
};
const NAME_TO_LANG_CODE = Object.fromEntries(
  Object.entries(LANG_CODE_TO_NAME).map(([code, name]) => [name.toLowerCase(), code]),
);
/** PubMed [Language] expects the full English name ("English"). */
function pubmedLang(token) {
  const t = s(token).trim();
  return LANG_CODE_TO_NAME[t.toLowerCase()] || t;
}
/** OpenAlex language filter uses the ISO-639-1 code ("en"). */
function openalexLang(token) {
  const t = s(token).trim().toLowerCase();
  if (LANG_CODE_TO_NAME[t]) return t;           // already a code
  return NAME_TO_LANG_CODE[t] || t;             // map a name → code, else pass through
}
/** YYYY / YYYY-MM-DD / YYYY/MM/DD → ISO YYYY-MM-DD (start or end of a bare year). */
function toIsoDate(raw, edge) {
  const t = s(raw).trim().replace(/\//g, '-');
  if (/^\d{4}$/.test(t)) return edge === 'end' ? `${t}-12-31` : `${t}-01-01`;
  const m = t.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (m) {
    const mm = String(m[2]).padStart(2, '0');
    const dd = m[3] ? String(m[3]).padStart(2, '0') : (edge === 'end' ? '28' : '01');
    return `${m[1]}-${mm}-${dd}`;
  }
  return t;
}

/* ── free-text token (shared by renderers) ───────────────────────────────────── */
function freeTextBody(term, { truncate }) {
  let t = s(term.text).trim();
  const single = !isPhrase(t);
  if (truncate && single) t = `${t.replace(/\*+$/, '')}*`;
  const trailingStar = /\*$/.test(t);
  const phrase = (isPhrase(t) || term.phrase) && !trailingStar;
  return phrase ? quote(t) : t;
}

/* ── PubMed renderer ─────────────────────────────────────────────────────────── */
const pubmedRenderer = {
  id: 'pubmed',
  label: 'PubMed',
  supportsControlled: true,
  controlledTagLabel(profile) { return profile === 'precise' ? 'Majr:NoExp' : 'Mesh'; },
  controlledToken(term, profile) {
    const heading = (term.vocab && (term.vocab.mesh || term.vocab.heading)) || term.text;
    return `"${s(heading).replace(/"/g, '')}"[${this.controlledTagLabel(profile)}]`;
  },
  freeTagLabel(term, profile) {
    if (profile === 'broad') return 'tw';                 // Text Word — broadest (all fields incl. MeSH terms)
    const f = s(term.field).toLowerCase();
    if (f === 'ti' || f === 'title') return 'ti';
    if (f === 'ab' || f === 'abstract') return 'ab';
    return 'tiab';                                        // Title/Abstract (balanced + precise)
  },
  freeToken(term, profile) {
    const body = freeTextBody(term, { truncate: profile === 'broad' ? !isPhrase(term.text) : !!term.truncate });
    return `${body}[${this.freeTagLabel(term, profile)}]`;
  },
  filterClauses(filters) {
    const cl = [];
    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom || '1500';
      const to = filters.dateTo || '3000';
      cl.push(`("${from}"[Date - Publication] : "${to}"[Date - Publication])`);
    }
    if (filters.languages.length) {
      const names = [...new Set(filters.languages.map(pubmedLang))];
      cl.push(`(${names.map((n) => `${n}[Language]`).join(' OR ')})`);
    }
    if (filters.pubTypes.length) {
      cl.push(`(${filters.pubTypes.map((p) => `"${p}"[Publication Type]`).join(' OR ')})`);
    }
    return cl;
  },
  compose(blockQs, filters) {
    return [...blockQs, ...this.filterClauses(filters)].filter(Boolean).join(' AND ');
  },
};

/* ── OpenAlex renderer ───────────────────────────────────────────────────────── */
// OpenAlex has no controlled-vocabulary field, so a MeSH term is searched as free
// text (with an UNSUPPORTED_FIELD_TAG warning). The `.search` filter supports Boolean
// AND/OR and quoted phrases; per-term field tags are not possible, so the whole
// Boolean expression rides in ONE .search filter whose scope is the profile lever.
const openalexRenderer = {
  id: 'openalex',
  label: 'OpenAlex',
  supportsControlled: false,
  searchField(profile) {
    if (profile === 'broad') return 'default.search';               // all indexed text
    if (profile === 'precise') return 'title.search';               // title only
    return 'title_and_abstract.search';                             // balanced
  },
  freeTagLabel(term, profile) { return this.searchField(profile); },
  freeToken(term) {
    const t = s(term.text).trim();
    return (isPhrase(t) || term.phrase) ? quote(t) : t;             // OpenAlex ignores `*`; no truncation
  },
  filterClauses(filters) {
    const cl = [];
    if (filters.dateFrom) cl.push(`from_publication_date:${toIsoDate(filters.dateFrom, 'start')}`);
    if (filters.dateTo) cl.push(`to_publication_date:${toIsoDate(filters.dateTo, 'end')}`);
    if (filters.languages.length) cl.push(`language:${[...new Set(filters.languages.map(openalexLang))].join('|')}`);
    if (filters.pubTypes.length) cl.push(`type:${filters.pubTypes.map((p) => s(p).toLowerCase().replace(/\s+/g, '-')).join('|')}`);
    return cl;
  },
  compose(blockQs, filters, profile) {
    const search = blockQs.length ? `${this.searchField(profile)}:${blockQs.join(' AND ')}` : '';
    return [search, ...this.filterClauses(filters)].filter(Boolean).join(',');
  },
};

/* ── generic fallback renderer (unknown databases) ───────────────────────────── */
function genericRenderer(id) {
  return {
    id,
    label: (getDatabase(id) && getDatabase(id).label) || id,
    supportsControlled: false,
    generic: true,
    freeTagLabel() { return ''; },
    freeToken(term) {
      const t = s(term.text).trim();
      return (isPhrase(t) || term.phrase) ? quote(t) : t;
    },
    compose(blockQs) { return blockQs.filter(Boolean).join(' AND '); }, // filters not rendered — no fabricated syntax
  };
}

/* ── renderer registry (the documented extension point) ──────────────────────── */
const RENDERERS = new Map();
export function registerRenderer(renderer) {
  if (!renderer || !renderer.id) return;
  RENDERERS.set(renderer.id, renderer);
}
export function listRenderers() { return [...RENDERERS.keys()]; }
export function hasRenderer(id) { return RENDERERS.has(s(id)); }
/** True when the database has a dedicated subject-heading (MeSH/Emtree) field. */
export function databaseSupportsControlled(id) {
  const r = RENDERERS.get(s(id));
  return !!(r && r.supportsControlled);
}
registerRenderer(pubmedRenderer);
registerRenderer(openalexRenderer);

/* ── normalization ───────────────────────────────────────────────────────────── */
// MUST use the shared liveness rule (termLiveness.js): a `disabled: true` term is
// excluded from every generated, paste-ready string, or the studio would execute a
// broader search than the compiled preview / methods text / version hash document.
function liveTerms(concept) {
  return ((concept && concept.terms) || []).filter(isLiveTerm);
}
function normalizeConcepts(concepts) {
  return (Array.isArray(concepts) ? concepts : [])
    .filter((c) => c && typeof c === 'object')
    .map((c, i) => ({
      id: s(c.id) || `c${i + 1}`,
      label: s(c.label).trim() || s(c.picoField).trim() || `Concept ${i + 1}`,
      picoField: s(c.picoField).trim() || null,
      op: c.op === 'OR' ? 'OR' : 'AND',
      terms: liveTerms(c).map((t) => ({
        text: s(t.text).trim(),
        type: t.type === 'controlled' ? 'controlled' : 'freetext',
        field: s(t.field).trim() || 'tiab',
        vocab: t.vocab && typeof t.vocab === 'object' ? t.vocab : null,
        noExplode: !!t.noExplode,
        truncate: !!t.truncate,
        phrase: t.phrase != null ? !!t.phrase : isPhrase(t.text),
      })),
    }));
}
function normalizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v.map((x) => s(x).trim()).filter(Boolean) : []);
  return { dateFrom: s(f.dateFrom).trim(), dateTo: s(f.dateTo).trim(), languages: arr(f.languages), pubTypes: arr(f.pubTypes) };
}

/** Broad profile relaxes recall-reducing limits (language + publication type). */
function effectiveFilters(filters, profile, warnings) {
  if (profile !== 'broad') return { ...filters };
  if (filters.languages.length) warnings.push({ type: 'RELAXED_FILTER', message: `Broad profile removed the language limit (${filters.languages.join(', ')}) to maximise sensitivity.` });
  if (filters.pubTypes.length) warnings.push({ type: 'RELAXED_FILTER', message: 'Broad profile removed the publication-type limit to maximise sensitivity.' });
  return { dateFrom: filters.dateFrom, dateTo: filters.dateTo, languages: [], pubTypes: [] };
}

/* ── DEFAULT thresholds for generation-time warnings ─────────────────────────── */
export const DEFAULT_GENERATOR_CONFIG = Object.freeze({
  imbalanceRatio: 4,       // max/min live-term count across concepts above this → IMBALANCED_BLOCKS
});

function buildExplanation(label, meshCount, freeCount, fieldTags) {
  const parts = [];
  if (meshCount) parts.push(`${meshCount} subject heading${meshCount > 1 ? 's' : ''}`);
  if (freeCount) parts.push(`${freeCount} free-text term${freeCount > 1 ? 's' : ''}`);
  const body = parts.length ? parts.join(' and ') : 'no terms';
  const orNote = meshCount && freeCount ? ', combined with OR' : (meshCount + freeCount > 1 ? ', combined with OR' : '');
  const where = fieldTags.length ? ` (searched in ${fieldTags.join(', ')})` : '';
  return `${label}: ${body}${orNote}${where}.`;
}

/** Render every concept block for one database + profile. */
function buildBlocks(concepts, renderer, profile, warnings) {
  const blocks = [];
  const blockQs = [];
  for (const concept of concepts) {
    // generateStrategyFor is exported and reachable with RAW (un-normalized) concepts
    // (e.g. the critic's revised strategies), so liveness is re-applied here too.
    const live = liveTerms(concept);
    if (!live.length) {
      warnings.push({ type: 'EMPTY_CONCEPT', message: `Concept "${concept.label}" has no search terms and was omitted.` });
      continue;
    }
    const mesh = [];
    const freeText = [];
    const fieldTags = [];
    const addTag = (tag) => { if (tag && !fieldTags.includes(tag)) fieldTags.push(tag); };
    for (const term of live) {
      if (term.type === 'controlled' && renderer.supportsControlled) {
        mesh.push(renderer.controlledToken(term, profile));
        addTag(renderer.controlledTagLabel(profile));
      } else {
        if (term.type === 'controlled') {
          const heading = (term.vocab && (term.vocab.mesh || term.vocab.heading)) || term.text;
          warnings.push({ type: 'UNSUPPORTED_FIELD_TAG', term: term.text, message: `${renderer.label} has no subject-heading field; "${heading}" was searched as free text.` });
        }
        freeText.push(renderer.freeToken({ ...term, type: 'freetext' }, profile));
        addTag(renderer.freeTagLabel(term, profile));
      }
    }
    const tokens = [...mesh, ...freeText];
    const q = tokens.length > 1 ? `(${tokens.join(' OR ')})` : tokens[0];
    blockQs.push(q);

    // Overly-narrow concept: a single rare free-text term with no known synonym family.
    if (tokens.length === 1) {
      const only = live[0];
      const noFamily = only.type !== 'controlled' && !matchFamily(norm(only.text));
      warnings.push({
        type: 'NARROW_CONCEPT',
        term: only.text,
        message: noFamily
          ? `Concept "${concept.label}" has a single term ("${only.text}") with no known synonyms — this can miss relevant records. Consider adding synonyms.`
          : `Concept "${concept.label}" has a single term ("${only.text}"). Consider adding synonyms to improve sensitivity.`,
      });
    }

    blocks.push({
      concept: concept.label,
      picoField: concept.picoField,
      terms: live,
      mesh,
      freeText,
      fieldTags,
      explanation: buildExplanation(concept.label, mesh.length, freeText.length, fieldTags),
    });
  }

  // Unbalanced blocks: a large disparity in term counts across concepts.
  if (blocks.length >= 2) {
    const counts = blocks.map((b) => b.terms.length);
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    if (min >= 1 && max / min > DEFAULT_GENERATOR_CONFIG.imbalanceRatio) {
      warnings.push({ type: 'IMBALANCED_BLOCKS', message: `Concepts are unbalanced (largest has ${max} terms, smallest has ${min}). The thin concept dominates the intersection; consider adding synonyms to it.` });
    }
  }
  return { blocks, blockQs };
}

/** Generate ONE strategy for a database + profile. */
export function generateStrategyFor(concepts, dbId, filters, profile) {
  const renderer = RENDERERS.get(dbId) || genericRenderer(dbId);
  const warnings = [];
  const eff = effectiveFilters(filters, profile, warnings);
  if (renderer.generic) {
    warnings.push({ type: 'UNSUPPORTED_DATABASE', message: `No dedicated ${renderer.label} renderer; a generic keyword rendering was used and filters were not applied. Native syntax is not generated for this database.` });
  }
  const { blocks, blockQs } = buildBlocks(concepts, renderer, profile, warnings);
  if (!blocks.length) warnings.push({ type: 'NO_CONCEPTS', message: 'No concepts with search terms; the strategy is empty.' });
  const searchString = renderer.compose(blockQs, eff, profile);
  return { database: dbId, profile, searchString, blocks, filters: eff, warnings };
}

/**
 * generateStrategies({ concepts, databases, filters, options }) — the public entry.
 * `options.profiles` limits which profiles are produced (default all three).
 */
export function generateStrategies({ concepts, databases, filters, options } = {}) {
  const cs = normalizeConcepts(concepts);
  const dbs = (Array.isArray(databases) && databases.length ? databases : ['pubmed']).map(s).filter(Boolean);
  const profiles = (options && Array.isArray(options.profiles) && options.profiles.length ? options.profiles : PROFILES)
    .filter((p) => PROFILE_SET.has(p));
  const f = normalizeFilters(filters);
  const notes = [];
  if (!cs.length) notes.push('No concepts with search terms were provided; strategies are empty.');

  const strategies = [];
  const seenUnsupported = new Set();
  for (const db of dbs) {
    if (!RENDERERS.has(db) && !seenUnsupported.has(db)) {
      seenUnsupported.add(db);
      notes.push(`No dedicated "${db}" renderer; a generic Boolean rendering was used. Add one via registerRenderer().`);
    }
    for (const profile of (profiles.length ? profiles : PROFILES)) {
      strategies.push(generateStrategyFor(cs, db, f, profile));
    }
  }
  return { strategies, notes };
}

export default generateStrategies;
