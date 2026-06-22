/**
 * searchState.js — SE1 Task 5. Pure, network-free helpers for the Search Builder's
 * shared (server-persisted) state. Kept out of the React component so the
 * conflict-safe sync core is unit-testable:
 *
 *   - serializeSearchState / searchStatesEqual — a stable, key-sorted signature of
 *     the persisted slice ({concepts, overrides, ignored}). The tab uses it to make
 *     BOTH autosave and remote-apply idempotent: it never re-PUTs state it just
 *     saved/loaded, and never closes the loop into a save↔poke ping-pong.
 *   - extractActiveConcepts — PICO → auto concepts with any user-hidden/deleted term
 *     filtered out, so a re-sync never resurrects a term the user removed (until
 *     "Reset suggestions"). Idempotent: same PICO + same `ignored` ⇒ same concepts.
 *
 * Deterministic and dependency-light (only the extraction engine). No timestamps,
 * no randomness — id assignment stays in the component.
 */
import { picoToConcepts, extractConcepts, norm } from './conceptExtraction.js';

/* ── SE2: the five canonical PICO concept groups ──────────────────────────────
   The Search Builder ALWAYS shows these five, in this order, each keyed by a
   stable `picoField` (independent of the user-editable label). */
export const PICO_FIELD_DEFS = [
  { key: 'P', label: 'Population' },
  { key: 'I', label: 'Intervention / Exposure' },
  { key: 'C', label: 'Comparator / Control' },
  { key: 'O', label: 'Outcomes' },
  { key: 'T', label: 'Time Frame' },
];

// Map an SE1-era pico_auto concept's PICO-field label → the new canonical key, so a
// saved search migrates its terms (incl. user MeSH conversions) into the five groups
// instead of being orphaned. Keyed on the concept's `field` first, then its `label`.
const LEGACY_FIELD_TO_KEY = {
  population: 'P',
  intervention: 'I', exposure: 'I', 'intervention / exposure': 'I', 'intervention/exposure': 'I',
  comparator: 'C', control: 'C', 'comparator / control': 'C', 'comparator/control': 'C',
  outcome: 'O', outcomes: 'O',
  'time frame': 'T', timeframe: 'T',
};

// Mirrors features/protocol/constants.js TIMEFRAME_OPTIONS labels. Duplicated (not
// imported) to keep this engine module free of a features/* dependency; update both
// if the presets change.
const TIMEFRAME_LABELS = {
  any: 'No time restriction', last1: 'Last 1 year', last3: 'Last 3 years',
  last5: 'Last 5 years', last10: 'Last 10 years', since2000: 'Since 2000',
  inception: 'Since inception',
};

/** The canonical PICO key a concept belongs to ('P'/'I'/'C'/'O'/'T'), or null if it
 *  is a user-created (manual) concept. */
export function conceptFieldKey(c) {
  if (!c) return null;
  if (c.picoField) return c.picoField;
  if (c.source === 'pico_auto') return LEGACY_FIELD_TO_KEY[norm(c.field)] || LEGACY_FIELD_TO_KEY[norm(c.label)] || null;
  return null;
}

/** Human-readable time restriction from the PICO object (preset, custom range, or
 *  legacy free-text), or '' when none is set. Pure. */
export function timeframeLabel(pico) {
  const p = pico || {};
  if (p.timeframeMode === 'custom') {
    const s = String(p.tfStart || '').trim();
    const e = String(p.tfEnd || '').trim();
    if (s && e) return `${s}–${e}`;
    if (s) return `${s}–present`;
    return '';
  }
  if (p.timeframeMode && TIMEFRAME_LABELS[p.timeframeMode]) return TIMEFRAME_LABELS[p.timeframeMode];
  if (p.timeframe && String(p.timeframe).trim()) return String(p.timeframe).trim();
  return '';
}

/** One PICO field's text → a FLAT, deduped, ordered list of search terms (all the
 *  family ladders + synonyms for that field merged into a single concept group). */
export function extractFieldTerms(text) {
  const terms = []; const seen = new Set();
  for (const c of extractConcepts(text, '')) {
    for (const t of c.terms) {
      const n = norm(t.text);
      if (n && !seen.has(n)) { seen.add(n); terms.push({ ...t }); }
    }
  }
  return terms;
}

/**
 * Idempotent PICO → Search Builder sync (SE2 core). Always returns the five PICO
 * concept groups (in canonical order) followed by the user's manual concepts.
 *
 * Guarantees:
 *  - the five field groups always exist and each mirrors its PICO field;
 *  - hidden/deleted auto terms (in `ignoredList`) are not re-added;
 *  - manual concepts, manual terms, and auto terms converted to MeSH are preserved;
 *  - existing term/concept objects are reused (ids + MeSH `vocab` survive);
 *  - no duplicate terms; same PICO + same existing ⇒ same result.
 *
 * Pure: assigns no ids and performs no I/O. The caller fills ids for any new
 * (id-less) concept/term and runs MeSH lookups.
 */
export function syncSearchBuilderFromPico(pico, existingConcepts, ignoredList) {
  const existing = Array.isArray(existingConcepts) ? existingConcepts : [];
  const ig = new Set((ignoredList || []).map(norm));

  // Bucket existing terms by PICO key; everything else is a manual concept (kept as-is).
  const termsByKey = { P: [], I: [], C: [], O: [], T: [] };
  const conceptByKey = {};
  const manualConcepts = [];
  for (const c of existing) {
    const key = conceptFieldKey(c);
    if (key && termsByKey[key]) {
      for (const t of (c.terms || [])) termsByKey[key].push(t);
      if (!conceptByKey[key]) conceptByKey[key] = c; // first wins (for id/label reuse)
    } else {
      manualConcepts.push(c);
    }
  }

  const fieldText = { P: pico && pico.P, I: pico && pico.I, C: pico && pico.C, O: pico && pico.O };

  const groups = PICO_FIELD_DEFS.map(({ key, label }) => {
    const prior = termsByKey[key];
    const manualTerms = prior.filter((t) => t.source !== 'pico_auto');     // user-added / user synonyms: always kept
    const priorAuto = prior.filter((t) => t.source === 'pico_auto');
    const priorAutoByNorm = new Map(priorAuto.map((t) => [norm(t.text), t]));

    const autoTerms = [];
    if (key !== 'T') {
      const used = new Set();
      for (const t of extractFieldTerms(fieldText[key] || '')) {
        const n = norm(t.text);
        if (ig.has(n) || used.has(n)) continue;                            // hidden term, or already added
        used.add(n);
        const reuse = priorAutoByNorm.get(n);                              // keep id + vocab if we had it
        autoTerms.push(reuse || { ...t, sourceField: label });
      }
      // Keep an auto term the user converted to MeSH even if it is no longer extracted.
      for (const t of priorAuto) {
        const n = norm(t.text);
        if (!used.has(n) && !ig.has(n) && (t.type === 'controlled' || t.vocab)) { used.add(n); autoTerms.push(t); }
      }
    }

    const priorConcept = conceptByKey[key];
    const group = {
      id: priorConcept && priorConcept.id ? priorConcept.id : undefined,
      // Keep a user-renamed label only once the concept already carries a picoField
      // (i.e. it was created by this new model); legacy/family concepts reset to canonical.
      label: priorConcept && priorConcept.picoField && priorConcept.label ? priorConcept.label : label,
      picoField: key,
      field: label,
      source: 'pico_auto',
      op: 'AND',
      terms: [...autoTerms, ...manualTerms],
    };
    if (key === 'T') {
      const tf = timeframeLabel(pico);
      if (tf) group.note = tf;
    }
    return group;
  });

  return [...groups, ...manualConcepts];
}

/** Deterministic JSON: object keys sorted, undefined keys omitted (as JSON does),
 *  array order preserved (it is semantically the display order). */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** The shared, persisted slice of the tab state (everything that rides to the server).
 *  SB3 adds `databases` (selected database ids; [] = use the catalogue defaults) and
 *  `readyForScreening` (advisory handoff marker). Both are additive + optional, so
 *  pre-SB3 saved searches load unchanged. */
export function pickPersisted(state) {
  return {
    concepts: Array.isArray(state && state.concepts) ? state.concepts : [],
    overrides: state && state.overrides && typeof state.overrides === 'object' ? state.overrides : {},
    ignored: Array.isArray(state && state.ignored) ? state.ignored : [],
    databases: Array.isArray(state && state.databases) ? state.databases.filter((s) => typeof s === 'string') : [],
    readyForScreening: !!(state && state.readyForScreening),
  };
}

/** Stable signature of the persisted slice — equal signature ⇒ no save / no apply needed. */
export function serializeSearchState(state) {
  return stableStringify(pickPersisted(state));
}

/** True when two states carry the same persisted content (ignores any volatile extras). */
export function searchStatesEqual(a, b) {
  return serializeSearchState(a) === serializeSearchState(b);
}

/**
 * Decide whether a freshly-refetched remote document should replace local state.
 * Pure so the conflict-safe sync core is unit-testable without a DOM.
 *   - 'skip'  : identical to what we hold/sent, or not newer than our revision
 *   - 'defer' : genuinely newer, but the user is mid-edit — park and apply on idle
 *   - 'adopt' : genuinely newer and the user is idle — apply now
 * @param {{remoteSig:string, lastSavedSig:string, remoteRevision?:number,
 *          knownRevision?:number, busy:boolean}} p
 */
export function remoteAdoptDecision({ remoteSig, lastSavedSig, remoteRevision, knownRevision, busy }) {
  if (remoteSig === lastSavedSig) return 'skip';                       // our own echo / already applied
  if (typeof remoteRevision === 'number' && typeof knownRevision === 'number'
      && remoteRevision <= knownRevision) return 'skip';              // not newer than what we have
  return busy ? 'defer' : 'adopt';
}

/**
 * PICO → auto-extracted concepts, with any hidden/deleted auto term removed.
 * @param {object} pico   {P,I,C,O}
 * @param {string[]} ignoredList  normalized texts of terms the user removed
 * @returns concepts whose terms are all still active (empty concepts dropped)
 */
export function extractActiveConcepts(pico, ignoredList) {
  const ig = new Set((ignoredList || []).map((s) => norm(s)));
  return picoToConcepts(pico)
    .map((c) => ({ ...c, terms: c.terms.filter((t) => !ig.has(norm(t.text))) }))
    .filter((c) => c.terms.length);
}

/* ── SB3: helpers for Tab 1 ("Select Keywords") ──────────────────────────────
   Selecting a keyword in the question/PICO text means adding it as a search term
   into the matching canonical PICO concept group; unselecting removes it. These
   are pure (no id assignment, no I/O — the caller fills ids, mirroring the sync
   contract) so the click→concept mapping is unit-testable without a DOM. */

/** The canonical PICO concept group for a given key ('P'/'I'/'C'/'O'/'T'), or null. */
export function findFieldConcept(concepts, fieldKey) {
  return (Array.isArray(concepts) ? concepts : []).find((c) => conceptFieldKey(c) === fieldKey) || null;
}

/** True when a term with this (normalized) text already lives in the field group. */
export function fieldHasTerm(concepts, fieldKey, text) {
  const c = findFieldConcept(concepts, fieldKey);
  const n = norm(text);
  return !!(n && c && (c.terms || []).some((t) => norm(t.text) === n));
}

/**
 * Add a manually-selected keyword as a term into the canonical PICO group `fieldKey`.
 * No-op (returns the same array) if the text is blank or already present. The new
 * term is id-less and `source:'user_added'` (so a PICO re-sync never strips it); the
 * caller assigns its id. Pure.
 */
export function addManualTermToField(concepts, fieldKey, text, source = 'user_added') {
  const n = norm(text);
  const clean = String(text || '').trim();
  if (!n || !clean) return Array.isArray(concepts) ? concepts : [];
  const list = Array.isArray(concepts) ? concepts : [];
  const idx = list.findIndex((c) => conceptFieldKey(c) === fieldKey);
  const term = { text: clean, normalizedLabel: n, type: 'freetext', field: 'tiab', source };
  if (idx >= 0) {
    if ((list[idx].terms || []).some((t) => norm(t.text) === n)) return list; // dedupe
    return list.map((c, i) => (i === idx ? { ...c, terms: [...(c.terms || []), term] } : c));
  }
  // No canonical group for this key (defensive — the five groups normally exist).
  const def = PICO_FIELD_DEFS.find((d) => d.key === fieldKey);
  return [...list, { label: def ? def.label : clean, picoField: fieldKey, field: def ? def.label : fieldKey, source: 'pico_auto', op: 'AND', terms: [term] }];
}

/** Remove every term matching `text` (normalized) from the canonical group `fieldKey`. Pure. */
export function removeTermFromField(concepts, fieldKey, text) {
  const n = norm(text);
  return (Array.isArray(concepts) ? concepts : []).map((c) =>
    conceptFieldKey(c) === fieldKey ? { ...c, terms: (c.terms || []).filter((t) => norm(t.text) !== n) } : c);
}

/* ── SB3: helper for Tab 2 ("Organize Concepts") ─────────────────────────────
   A simple, beginner-readable status for a concept card. Pure + deterministic.
   Returns one of: 'empty' | 'needs-review' | 'mesh-suggested' | 'ready'. */
export function conceptStatus(concept) {
  const terms = (concept && concept.terms) || [];
  const live = terms.filter((t) => String(t.text || '').trim());
  if (!live.length) return concept && concept.note ? 'ready' : 'empty'; // Time-Frame group is "ready" when a restriction is set
  if (live.some((t) => t.type === 'controlled')) return 'ready';        // has a subject heading + free text
  if (live.some((t) => t.type !== 'controlled' && t.vocab)) return 'mesh-suggested'; // a heading is available but not added
  if (live.length === 1) return 'needs-review';                         // one term — suggest adding synonyms
  return 'ready';
}

/** Human label + intent for each `conceptStatus` value (UI maps to colour). */
export const CONCEPT_STATUS_LABELS = {
  empty: 'No terms yet',
  'needs-review': 'Needs review',
  'mesh-suggested': 'Subject heading suggested',
  ready: 'Ready',
};
