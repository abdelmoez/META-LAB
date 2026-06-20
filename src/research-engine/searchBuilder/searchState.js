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
import { picoToConcepts, norm } from './conceptExtraction.js';

/** Deterministic JSON: object keys sorted, undefined keys omitted (as JSON does),
 *  array order preserved (it is semantically the display order). */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** The shared, persisted slice of the tab state (everything that rides to the server). */
export function pickPersisted(state) {
  return {
    concepts: Array.isArray(state && state.concepts) ? state.concepts : [],
    overrides: state && state.overrides && typeof state.overrides === 'object' ? state.overrides : {},
    ignored: Array.isArray(state && state.ignored) ? state.ignored : [],
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
