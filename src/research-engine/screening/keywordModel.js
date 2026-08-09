/**
 * keywordModel.js — the screening keyword review state + its reducer (107.md §2).
 *
 * Pure functions, no database, no side effects. Shared verbatim by the client
 * (optimistic update) and the server (read-modify-write inside a transaction), so
 * both apply EXACTLY the same rules.
 *
 * Storage model (deliberate, see 107.md §2 "Regeneration"):
 *   - `ScreenProject.inclusionKeywords` / `exclusionKeywords` stay the ACTIVE lists
 *     (JSON string[] of display terms). Every existing consumer — highlighting,
 *     filtering, keyword stats, the AI keyword signal — keeps reading them.
 *   - `ScreenProject.keywordMeta` (new, additive, default "{}") stores ONLY the
 *     user's review state: per-term accept/reject DECISIONS and per-term ORIGINS.
 *   - Suggested terms themselves are NEVER persisted — they are re-derived from the
 *     criteria on every read (suggestKeywords.js). Regeneration is therefore
 *     structurally non-destructive: a manually added term lives in the active list
 *     and no regeneration path writes that list.
 *
 * Canonical shape:
 *   { version: 1,
 *     decisions: { include: { [key]: 'accepted'|'rejected' }, exclude: {…} },
 *     origins:   { include: { [key]: 'manual'|'accepted' },   exclude: {…} } }
 * where `key` is `normalizeKeywordKey(term)`. Terms that carry no explicit origin
 * fall back to 'default' when they are part of the shared seed list, else 'manual'
 * (see `resolveOrigin`) — so the ~80 seeded defaults never have to be written out.
 */
import { normalizeKeywordKey } from './keywordNormalize.js';

export const KEYWORD_META_VERSION = 1;

/** Where an ACTIVE keyword came from. */
export const KEYWORD_ORIGIN = Object.freeze({
  DEFAULT: 'default',    // part of the shared seed list, never edited
  MANUAL: 'manual',      // typed by a leader (editor or abstract selection)
  ACCEPTED: 'accepted',  // a criteria suggestion the reviewer accepted
});

/** A reviewer's verdict on a SUGGESTED term (absent = still pending). */
export const KEYWORD_DECISION = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
});

export const KEYWORD_LISTS = Object.freeze(['include', 'exclude']);
export const KEYWORD_OPS = Object.freeze(['add', 'remove', 'move', 'accept', 'reject']);

/** Longest keyword we will store — mirrors the server-side body validation. */
export const MAX_KEYWORD_LENGTH = 200;

const LIST_FIELD = { include: 'inclusion', exclude: 'exclusion' };
const OTHER_LIST = { include: 'exclude', exclude: 'include' };

const ORIGIN_VALUES = new Set([KEYWORD_ORIGIN.MANUAL, KEYWORD_ORIGIN.ACCEPTED, KEYWORD_ORIGIN.DEFAULT]);
const DECISION_VALUES = new Set([KEYWORD_DECISION.ACCEPTED, KEYWORD_DECISION.REJECTED]);

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A key/value map is canonical when every key is already normalized and every value allowed. */
function mapIsCanonical(map, allowed) {
  if (!isPlainObject(map)) return false;
  for (const [k, v] of Object.entries(map)) {
    if (!k || k !== normalizeKeywordKey(k)) return false;
    if (!allowed.has(v)) return false;
  }
  return true;
}

function cleanMap(raw, allowed) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = normalizeKeywordKey(k);
    if (!key || !allowed.has(v)) continue;
    out[key] = v;
  }
  return out;
}

function metaIsCanonical(meta) {
  if (!isPlainObject(meta)) return false;
  const keys = Object.keys(meta);
  if (keys.length !== 3) return false;
  if (meta.version !== KEYWORD_META_VERSION) return false;
  if (!isPlainObject(meta.decisions) || !isPlainObject(meta.origins)) return false;
  if (Object.keys(meta.decisions).length !== 2 || Object.keys(meta.origins).length !== 2) return false;
  for (const list of KEYWORD_LISTS) {
    if (!mapIsCanonical(meta.decisions[list], DECISION_VALUES)) return false;
    if (!mapIsCanonical(meta.origins[list], ORIGIN_VALUES)) return false;
  }
  return true;
}

/**
 * normalizeKeywordMeta — parse + repair a stored keywordMeta value.
 *
 * BYTE STABILITY (shared-context rule 2): when the input is ALREADY canonical the
 * exact same object is returned, so a load-path normalization never marks a project
 * dirty and never rewrites the column with an identical value.
 *
 * Garbage-tolerant: a malformed JSON string, a number, an array, an unknown
 * decision value or a non-normalized key all degrade to the empty canonical shape
 * (or are silently dropped) rather than throwing.
 *
 * @param {object|string|null|undefined} raw
 * @returns {{version:number, decisions:object, origins:object}}
 */
export function normalizeKeywordMeta(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v || '{}'); } catch { v = {}; }
  }
  if (metaIsCanonical(v)) return v;
  const decisions = {};
  const origins = {};
  for (const list of KEYWORD_LISTS) {
    decisions[list] = cleanMap(isPlainObject(v) && isPlainObject(v.decisions) ? v.decisions[list] : null, DECISION_VALUES);
    origins[list] = cleanMap(isPlainObject(v) && isPlainObject(v.origins) ? v.origins[list] : null, ORIGIN_VALUES);
  }
  return { version: KEYWORD_META_VERSION, decisions, origins };
}

/** Empty canonical meta (a fresh object every call — callers may mutate their copy). */
export function emptyKeywordMeta() {
  return normalizeKeywordMeta(null);
}

/**
 * resolveOrigin — how an ACTIVE term should be badged.
 * Explicit meta origin wins; otherwise a term that is part of the shared seed list
 * is 'default' and anything else is 'manual'.
 *
 * @param {string} term
 * @param {'include'|'exclude'} list
 * @param {object} meta — already normalized
 * @param {{include?:string[], exclude?:string[]}} [defaults]
 * @returns {'default'|'manual'|'accepted'}
 */
export function resolveOrigin(term, list, meta, defaults = {}) {
  const key = normalizeKeywordKey(term);
  const explicit = meta?.origins?.[list]?.[key];
  if (explicit) return explicit;
  const seed = Array.isArray(defaults[list]) ? defaults[list] : [];
  if (seed.some(t => normalizeKeywordKey(t) === key)) return KEYWORD_ORIGIN.DEFAULT;
  return KEYWORD_ORIGIN.MANUAL;
}

/**
 * materializeDefaults — when a side's stored list is empty the panel shows the
 * shared seed list; the first real edit has to write those seeds out so the edit is
 * additive rather than a silent wipe (this mirrors what the pre-107 keyword editor
 * already did). Returns the SAME state object when nothing needed materializing.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object}} state
 * @param {{include?:string[], exclude?:string[]}} defaults
 * @param {Array<'include'|'exclude'>} [lists] — restrict to the sides being edited
 */
export function materializeDefaults(state, defaults = {}, lists = KEYWORD_LISTS) {
  let next = state;
  for (const list of lists) {
    const field = LIST_FIELD[list];
    if (!field) continue;
    const cur = Array.isArray(next[field]) ? next[field] : [];
    if (cur.length) continue;
    const seed = Array.isArray(defaults[list]) ? defaults[list] : [];
    if (!seed.length) continue;
    next = { ...next, [field]: [...seed] };
  }
  return next;
}

function readList(state, list) {
  const v = state[LIST_FIELD[list]];
  return Array.isArray(v) ? v : [];
}

/** Shallow-clone meta down to the two maps we are about to touch. */
function cloneMeta(meta) {
  return {
    version: KEYWORD_META_VERSION,
    decisions: { include: { ...meta.decisions.include }, exclude: { ...meta.decisions.exclude } },
    origins: { include: { ...meta.origins.include }, exclude: { ...meta.origins.exclude } },
  };
}

function fail(state, error) {
  return { ok: false, error, changed: false, reason: 'invalid', state };
}
function unchanged(state, reason) {
  return { ok: true, error: null, changed: false, reason, state };
}

/**
 * applyKeywordOp — the single reducer for every keyword mutation.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object|string}} state
 * @param {{type:'add'|'remove'|'move'|'accept'|'reject', list:'include'|'exclude',
 *          term:string, toList?:'include'|'exclude', origin?:string}} op
 * @returns {{ok:boolean, error:string|null, changed:boolean, reason:string,
 *            state:{inclusion:string[], exclusion:string[], meta:object}}}
 *
 * Guarantees:
 *   - PURE: never mutates `state`; returns the same `state` reference when nothing
 *     changed (so a no-op never triggers a write or a re-render).
 *   - IDEMPOTENT where sensible: adding an existing normalized key is a flagged
 *     no-op (`reason: 'duplicate'`), rejecting twice is a no-op, removing a missing
 *     term is a no-op (`reason: 'not_found'`).
 *   - ATOMIC move: remove + add in one result, carrying the term's origin across.
 *   - MANUAL TERMS ARE NEVER TOUCHED by any op other than one naming them.
 */
export function applyKeywordOp(state, op) {
  const base = {
    inclusion: Array.isArray(state?.inclusion) ? state.inclusion : [],
    exclusion: Array.isArray(state?.exclusion) ? state.exclusion : [],
    meta: normalizeKeywordMeta(state?.meta),
  };
  // Preserve referential identity when the caller already handed us a clean state.
  const start = (state && base.inclusion === state.inclusion && base.exclusion === state.exclusion && base.meta === state.meta)
    ? state : base;

  if (!op || typeof op !== 'object') return fail(start, 'A keyword operation is required');
  const type = op.type;
  if (!KEYWORD_OPS.includes(type)) return fail(start, `Unknown keyword operation "${String(type)}"`);
  const list = op.list;
  if (!KEYWORD_LISTS.includes(list)) return fail(start, 'list must be "include" or "exclude"');
  if (typeof op.term !== 'string') return fail(start, 'term must be a string');
  const term = op.term.trim();
  if (!term) return fail(start, 'term must not be empty');
  if (term.length > MAX_KEYWORD_LENGTH) return fail(start, `term must be ${MAX_KEYWORD_LENGTH} characters or fewer`);
  const key = normalizeKeywordKey(term);
  if (!key) return fail(start, 'term must not be empty');

  let toList = null;
  if (type === 'move') {
    toList = op.toList || OTHER_LIST[list];
    if (!KEYWORD_LISTS.includes(toList)) return fail(start, 'toList must be "include" or "exclude"');
    if (toList === list) return fail(start, 'toList must differ from list');
  }

  const meta = cloneMeta(base.meta);
  const lists = { include: [...base.inclusion], exclude: [...base.exclusion] };
  const hasKey = (l) => lists[l].some(t => normalizeKeywordKey(t) === key);
  const drop = (l) => { lists[l] = lists[l].filter(t => normalizeKeywordKey(t) !== key); };

  let changed = false;
  let reason = 'noop';

  if (type === 'add') {
    if (hasKey(list)) return unchanged(start, 'duplicate');
    lists[list].push(term);
    meta.origins[list][key] = ORIGIN_VALUES.has(op.origin) ? op.origin : KEYWORD_ORIGIN.MANUAL;
    delete meta.decisions[list][key];
    if (meta.origins[list][key] === KEYWORD_ORIGIN.ACCEPTED) meta.decisions[list][key] = KEYWORD_DECISION.ACCEPTED;
    changed = true;
    reason = 'added';
  } else if (type === 'remove') {
    if (!hasKey(list)) return unchanged(start, 'not_found');
    drop(list);
    delete meta.origins[list][key];
    // Removing a term is an explicit "not on this list" verdict, so a criteria
    // suggestion for the same concept must not immediately reappear as pending.
    meta.decisions[list][key] = KEYWORD_DECISION.REJECTED;
    changed = true;
    reason = 'removed';
  } else if (type === 'move') {
    if (!hasKey(list)) return unchanged(start, 'not_found');
    const carried = base.meta.origins[list][key] || KEYWORD_ORIGIN.MANUAL;
    const display = lists[list].find(t => normalizeKeywordKey(t) === key) || term;
    drop(list);
    delete meta.origins[list][key];
    meta.decisions[list][key] = KEYWORD_DECISION.REJECTED;
    if (!hasKey(toList)) lists[toList].push(display);
    meta.origins[toList][key] = carried;
    delete meta.decisions[toList][key];
    if (carried === KEYWORD_ORIGIN.ACCEPTED) meta.decisions[toList][key] = KEYWORD_DECISION.ACCEPTED;
    changed = true;
    reason = 'moved';
  } else if (type === 'accept') {
    const already = base.meta.decisions[list][key] === KEYWORD_DECISION.ACCEPTED;
    if (already && hasKey(list)) return unchanged(start, 'already');
    meta.decisions[list][key] = KEYWORD_DECISION.ACCEPTED;
    if (!hasKey(list)) {
      lists[list].push(term);
      meta.origins[list][key] = KEYWORD_ORIGIN.ACCEPTED;
    }
    changed = true;
    reason = 'accepted';
  } else if (type === 'reject') {
    if (base.meta.decisions[list][key] === KEYWORD_DECISION.REJECTED) return unchanged(start, 'already');
    meta.decisions[list][key] = KEYWORD_DECISION.REJECTED;
    changed = true;
    reason = 'rejected';
  }

  if (!changed) return unchanged(start, reason);
  return {
    ok: true,
    error: null,
    changed: true,
    reason,
    state: { inclusion: lists.include, exclusion: lists.exclude, meta },
  };
}

/**
 * dismissConflictOps — the ops a "Dismiss" on a flagged cross-polarity conflict
 * expands to: reject the concept on BOTH sides so it stops being offered.
 * @param {string} term
 * @returns {Array<object>}
 */
export function dismissConflictOps(term) {
  return [
    { type: 'reject', list: 'include', term },
    { type: 'reject', list: 'exclude', term },
  ];
}
