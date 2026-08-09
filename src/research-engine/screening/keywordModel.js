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
 *     origins:   { include: { [key]: 'manual'|'accepted' },   exclude: {…} },
 *     seeded?:   { include?: true, exclude?: true } }
 * where `key` is `normalizeKeywordKey(term)`. Terms that carry no explicit origin
 * fall back to 'default' when they are part of the shared seed list, else 'manual'
 * (see `resolveOrigin`) — so the ~80 seeded defaults never have to be written out.
 *
 * `seeded` marks a side that has been DELIBERATELY EDITED. An empty stored list is
 * normally displayed as the shared defaults; once the side is marked, an empty list
 * means empty (see `resolveKeywordState`), so deleting the last chip no longer
 * resurrects ~28/~50 default terms. The key is OMITTED when nothing is marked, so
 * every project that predates it keeps its exact byte shape and its defaults.
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
// 108.md §20 — 'clear-decision' is the non-verdict inverse of accept/reject: it
// returns a suggestion to PENDING (and, with removeTerm, undoes the term an accept
// added). Without it a decision could only ever be replaced, never withdrawn.
export const KEYWORD_OPS = Object.freeze(['add', 'remove', 'move', 'accept', 'reject', 'clear-decision']);

/** Longest keyword we will store — mirrors the server-side body validation. */
export const MAX_KEYWORD_LENGTH = 200;

/**
 * 108.md §20 — how many ops one transactional batch may carry. A compound inverse is
 * ONE server round trip and ONE history entry; the worst case is the exact inverse of
 * a `move` onto a list that ALREADY held the term (drop + re-add the target term at
 * its prior index + restore its decision, then re-add the source term + restore its
 * decision = 5). 6 leaves one slot of headroom without turning the endpoint into a
 * general bulk-write API.
 */
export const MAX_KEYWORD_OPS = 6;

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

/** `seeded` holds ONLY `true` under a known list key — an empty marker is dropped. */
function cleanSeeded(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const list of KEYWORD_LISTS) if (raw[list] === true) out[list] = true;
  return out;
}

function seededIsCanonical(seeded) {
  if (!isPlainObject(seeded)) return false;
  const keys = Object.keys(seeded);
  if (!keys.length) return false;   // the canonical form OMITS an empty marker
  for (const k of keys) {
    if (!KEYWORD_LISTS.includes(k) || seeded[k] !== true) return false;
  }
  return true;
}

function metaIsCanonical(meta) {
  if (!isPlainObject(meta)) return false;
  const keys = Object.keys(meta);
  // 3 keys = the pre-`seeded` shape (still canonical); 4 = with the edited marker.
  if (keys.length !== 3 && keys.length !== 4) return false;
  if (keys.length === 4 && !seededIsCanonical(meta.seeded)) return false;
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
  const out = { version: KEYWORD_META_VERSION, decisions, origins };
  const seeded = cleanSeeded(isPlainObject(v) ? v.seeded : null);
  if (Object.keys(seeded).length) out.seeded = seeded;
  return out;
}

/**
 * isSideSeeded — has this side been DELIBERATELY edited (chip removed, term moved
 * off it, or the shared defaults materialized into it)? When true an empty stored
 * list must stay empty instead of falling back to the shared defaults.
 * Expects an already-normalized meta (any object is tolerated).
 *
 * @param {object|null|undefined} meta
 * @param {'include'|'exclude'} list
 * @returns {boolean}
 */
export function isSideSeeded(meta, list) {
  const seeded = isPlainObject(meta) ? meta.seeded : null;
  return isPlainObject(seeded) && seeded[list] === true;
}

/** seeded map + one more side, always in KEYWORD_LISTS order (stable JSON bytes). */
function withSeeded(seeded, list) {
  const next = {};
  for (const l of KEYWORD_LISTS) if (l === list || (isPlainObject(seeded) && seeded[l] === true)) next[l] = true;
  return next;
}

/**
 * 108.md §20 — drop ONE side's marker in place, deleting the key entirely when the
 * map empties so the meta goes back to its exact pre-edit 3-key byte shape.
 * Only ever called from `add { clearSeeded: true }`: the reducer must be able to
 * CLEAR the marker (undoing the remove that set it) but never to set it outside a
 * real "not on this list" verdict.
 */
function clearSeededMarker(meta, list) {
  if (!isPlainObject(meta.seeded) || meta.seeded[list] !== true) return;
  const next = {};
  for (const l of KEYWORD_LISTS) if (l !== list && meta.seeded[l] === true) next[l] = true;
  if (Object.keys(next).length) meta.seeded = next;
  else delete meta.seeded;
}

/**
 * 108.md §20 — where a restored term goes. An absent index APPENDS (byte-identical
 * to the pre-108 behaviour); an out-of-range one CLAMPS to [0, length] rather than
 * failing, mirroring searchBuilder/undoStack.js:381 — a collaborator can legitimately
 * shrink the list between the delete and the undo, and restoring the term at the edge
 * beats refusing the undo.
 */
function insertAt(index, length) {
  if (!Number.isInteger(index)) return length;
  return Math.min(Math.max(index, 0), length);
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
 * Writing the seeds out is also the moment the side stops being "never edited", so
 * it is marked in `meta.seeded` — otherwise removing every term one by one would
 * leave an empty list that the defaults fallback silently repopulates.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object}} state
 * @param {{include?:string[], exclude?:string[]}} defaults
 * @param {Array<'include'|'exclude'>} [lists] — restrict to the sides being edited
 */
export function materializeDefaults(state, defaults = {}, lists = KEYWORD_LISTS) {
  let next = state;
  let meta = null;
  const baseMeta = normalizeKeywordMeta(state?.meta);
  for (const list of lists) {
    const field = LIST_FIELD[list];
    if (!field) continue;
    const cur = Array.isArray(next[field]) ? next[field] : [];
    if (cur.length) continue;
    // A side that was DELIBERATELY emptied stays empty — re-seeding it here is what
    // silently undid a leader's curation the op after they removed the last chip.
    if (isSideSeeded(baseMeta, list)) continue;
    const seed = Array.isArray(defaults[list]) ? defaults[list] : [];
    if (!seed.length) continue;
    if (!meta) meta = cloneMeta(baseMeta);
    meta.seeded = withSeeded(meta.seeded, list);
    next = { ...next, [field]: [...seed], meta };
  }
  return next;
}

function readList(state, list) {
  const v = state[LIST_FIELD[list]];
  return Array.isArray(v) ? v : [];
}

/**
 * 108.md §20 — CANONICAL KEY ORDER for the two lookup maps.
 *
 * Object keys iterate in insertion order and `JSON.stringify(meta)` is exactly what
 * lands in `ScreenProject.keywordMeta` (and what the ops endpoint's CAS pre-image
 * compares), so an op that DELETES a key and an inverse that re-adds it would leave
 * the meta deep-equal but byte-different — the term's verdict would silently drift to
 * the end of the map on every undo. Sorting on write makes the serialized meta a
 * canonical form, so "exact inverse" really does mean byte-identical.
 *
 * Deliberately NOT applied on the load path: `normalizeKeywordMeta` must keep
 * returning an already-canonical stored meta BY REFERENCE (shared-context rule 2), so
 * a legacy row is only re-ordered by the first op that rewrites it anyway. `seeded`
 * is excluded — it is emitted in KEYWORD_LISTS order by `withSeeded`.
 */
function sortedMap(map) {
  const keys = Object.keys(map);
  let ordered = true;
  for (let i = 1; i < keys.length; i += 1) if (keys[i - 1] > keys[i]) { ordered = false; break; }
  if (ordered) return map;
  const out = {};
  for (const k of keys.sort()) out[k] = map[k];
  return out;
}

/** Re-key the freshly cloned maps in canonical order. Mutates the clone in place. */
function canonicalizeMeta(meta) {
  for (const list of KEYWORD_LISTS) {
    meta.decisions[list] = sortedMap(meta.decisions[list]);
    meta.origins[list] = sortedMap(meta.origins[list]);
  }
  return meta;
}

/** Shallow-clone meta down to the two maps we are about to touch. */
function cloneMeta(meta) {
  const out = {
    version: KEYWORD_META_VERSION,
    decisions: { include: { ...meta.decisions.include }, exclude: { ...meta.decisions.exclude } },
    origins: { include: { ...meta.origins.include }, exclude: { ...meta.origins.exclude } },
  };
  const seeded = cleanSeeded(meta.seeded);
  if (Object.keys(seeded).length) out.seeded = seeded;
  return out;
}

function fail(state, error) {
  return { ok: false, error, changed: false, reason: 'invalid', state };
}
function unchanged(state, reason) {
  return { ok: true, error: null, changed: false, reason, state };
}

/**
 * Coerce a raw keyword state into `{inclusion:[], exclusion:[], meta:canonical}` and
 * preserve referential identity when the caller already handed us a clean one (the
 * byte-stability rule: a no-op must return the SAME object).
 */
function normalizeKeywordState(state) {
  const base = {
    inclusion: Array.isArray(state?.inclusion) ? state.inclusion : [],
    exclusion: Array.isArray(state?.exclusion) ? state.exclusion : [],
    meta: normalizeKeywordMeta(state?.meta),
  };
  return (state && base.inclusion === state.inclusion && base.exclusion === state.exclusion && base.meta === state.meta)
    ? state : base;
}

/**
 * applyKeywordOp — the single reducer for every keyword mutation.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object|string}} state
 * @param {{type:'add'|'remove'|'move'|'accept'|'reject'|'clear-decision',
 *          list:'include'|'exclude', term:string, toList?:'include'|'exclude',
 *          origin?:'manual'|'accepted'|'default'|null, reject?:boolean,
 *          index?:number, removeTerm?:boolean, clearSeeded?:boolean}} op
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
 *   - HARD-400 FLAG DISCIPLINE: every optional flag is valid on a fixed set of op
 *     types and is rejected everywhere else, so a typo can never silently no-op.
 *
 * `reject: false` (valid on `remove` and `move` only) is the NON-VERDICT variant —
 * the true inverse of `add`/`accept`/`move` used by the snackbar Undo. It deletes
 * the term and its origin and records NO decision, so an accidentally added concept
 * goes back to being a pending criteria suggestion instead of being permanently
 * rejected. Plain `remove`/`move` (the chip × and → buttons) are unchanged: they
 * ARE a deliberate "not on this list" verdict.
 *
 * 108.md §20 added the three pieces an EXACT inverse needs — never guess them by
 * hand, ask `keywordInverseOps(stateBefore, op)`:
 *   - `index` (add / move-target): splice the term back where it was. Absent =
 *     append, i.e. byte-identical to every pre-108 caller.
 *   - `origin: null` (add): restore the explicit ABSENCE of an origin, exactly as
 *     `move` already carries it. Without this a restored shared default came back
 *     permanently badged 'manual'.
 *   - `clearSeeded: true` (add): drop `meta.seeded[list]` when the remove being
 *     undone is the op that set it. The reducer can only ever CLEAR the marker here,
 *     never set it, and only on an add that really re-added the term.
 */
export function applyKeywordOp(state, op) {
  const start = normalizeKeywordState(state);

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
  } else if (op.toList !== undefined) {
    return fail(start, 'toList applies only to "move"');
  }
  if (op.reject !== undefined && typeof op.reject !== 'boolean') return fail(start, 'reject must be a boolean');
  if (op.reject !== undefined && type === 'clear-decision') {
    return fail(start, 'reject does not apply to "clear-decision"');
  }
  if (op.reject === false && type !== 'remove' && type !== 'move') {
    return fail(start, 'reject:false applies only to "remove" and "move"');
  }
  if (op.index !== undefined) {
    if (!Number.isInteger(op.index)) return fail(start, 'index must be an integer');
    if (type !== 'add' && type !== 'move') return fail(start, 'index applies only to "add" and "move"');
  }
  if (op.origin !== undefined) {
    if (op.origin !== null && !ORIGIN_VALUES.has(op.origin)) {
      return fail(start, 'origin must be "manual", "accepted", "default" or null');
    }
    if (type !== 'add') return fail(start, 'origin applies only to "add"');
  }
  if (op.removeTerm !== undefined) {
    if (typeof op.removeTerm !== 'boolean') return fail(start, 'removeTerm must be a boolean');
    if (type !== 'clear-decision') return fail(start, 'removeTerm applies only to "clear-decision"');
  }
  if (op.clearSeeded !== undefined) {
    if (typeof op.clearSeeded !== 'boolean') return fail(start, 'clearSeeded must be a boolean');
    if (type !== 'add') return fail(start, 'clearSeeded applies only to "add"');
  }
  // The UNDO variant is not a deliberate edit, so it must not mark the side as
  // edited either — an undone add leaves the meta byte-identical to before it.
  const verdict = op.reject !== false;

  const meta = cloneMeta(start.meta);
  const lists = { include: [...start.inclusion], exclude: [...start.exclusion] };
  const hasKey = (l) => lists[l].some(t => normalizeKeywordKey(t) === key);
  const drop = (l) => { lists[l] = lists[l].filter(t => normalizeKeywordKey(t) !== key); };

  let changed = false;
  let reason = 'noop';

  if (type === 'add') {
    if (hasKey(list)) return unchanged(start, 'duplicate');
    lists[list].splice(insertAt(op.index, lists[list].length), 0, term);
    // `origin: null` means "this term carried no explicit origin" — the shape a
    // shared default has. Absent `origin` keeps the historical 'manual' default.
    if (op.origin === null) delete meta.origins[list][key];
    else meta.origins[list][key] = ORIGIN_VALUES.has(op.origin) ? op.origin : KEYWORD_ORIGIN.MANUAL;
    delete meta.decisions[list][key];
    if (meta.origins[list][key] === KEYWORD_ORIGIN.ACCEPTED) meta.decisions[list][key] = KEYWORD_DECISION.ACCEPTED;
    if (op.clearSeeded === true) clearSeededMarker(meta, list);
    changed = true;
    reason = 'added';
  } else if (type === 'remove') {
    if (!hasKey(list)) return unchanged(start, 'not_found');
    drop(list);
    delete meta.origins[list][key];
    if (verdict) {
      // Removing a term is an explicit "not on this list" verdict, so a criteria
      // suggestion for the same concept must not immediately reappear as pending.
      meta.decisions[list][key] = KEYWORD_DECISION.REJECTED;
      meta.seeded = withSeeded(meta.seeded, list);
    } else {
      delete meta.decisions[list][key];
    }
    changed = true;
    reason = 'removed';
  } else if (type === 'move') {
    if (!hasKey(list)) return unchanged(start, 'not_found');
    // Carry the SOURCE origin verbatim — including its ABSENCE. Stamping 'manual'
    // on a term that carried no explicit origin (i.e. a shared default) made the
    // inverse move un-restorable: the term came back badged 'manual' forever.
    const carried = start.meta.origins[list][key];
    const display = lists[list].find(t => normalizeKeywordKey(t) === key) || term;
    drop(list);
    delete meta.origins[list][key];
    if (verdict) {
      meta.decisions[list][key] = KEYWORD_DECISION.REJECTED;
      meta.seeded = withSeeded(meta.seeded, list);
    } else {
      delete meta.decisions[list][key];
    }
    if (!hasKey(toList)) lists[toList].splice(insertAt(op.index, lists[toList].length), 0, display);
    if (carried) meta.origins[toList][key] = carried;
    else delete meta.origins[toList][key];
    delete meta.decisions[toList][key];
    if (carried === KEYWORD_ORIGIN.ACCEPTED) meta.decisions[toList][key] = KEYWORD_DECISION.ACCEPTED;
    changed = true;
    reason = 'moved';
  } else if (type === 'accept') {
    const already = start.meta.decisions[list][key] === KEYWORD_DECISION.ACCEPTED;
    if (already && hasKey(list)) return unchanged(start, 'already');
    meta.decisions[list][key] = KEYWORD_DECISION.ACCEPTED;
    if (!hasKey(list)) {
      lists[list].push(term);
      meta.origins[list][key] = KEYWORD_ORIGIN.ACCEPTED;
    }
    changed = true;
    reason = 'accepted';
  } else if (type === 'reject') {
    if (start.meta.decisions[list][key] === KEYWORD_DECISION.REJECTED) return unchanged(start, 'already');
    meta.decisions[list][key] = KEYWORD_DECISION.REJECTED;
    changed = true;
    reason = 'rejected';
  } else if (type === 'clear-decision') {
    // 108.md §20 — the exact inverse of accept/reject. Withdrawing a verdict is NOT
    // itself a verdict: the term goes back to PENDING, and the side is never marked
    // edited. `removeTerm` additionally undoes the term an `accept` ADDED (its origin
    // goes with it); without it the lists are left completely untouched.
    const hadDecision = start.meta.decisions[list][key] !== undefined;
    const removeTerm = op.removeTerm === true && hasKey(list);
    if (!hadDecision && !removeTerm) return unchanged(start, 'already');
    delete meta.decisions[list][key];
    if (removeTerm) {
      drop(list);
      delete meta.origins[list][key];
    }
    changed = true;
    reason = 'cleared';
  }

  if (!changed) return unchanged(start, reason);
  return {
    ok: true,
    error: null,
    changed: true,
    reason,
    state: { inclusion: lists.include, exclusion: lists.exclude, meta: canonicalizeMeta(meta) },
  };
}

/**
 * applyKeywordOps — 108.md §20. Apply a SHORT array of ops as one transaction.
 *
 * ALL-OR-NOTHING: the ops are folded in order and the FIRST invalid one discards the
 * whole batch, returning the untouched start state. A compound inverse (e.g. the
 * add + clear-decision that undoes an accept) is therefore one server round trip,
 * one CAS write and one history entry — it can never land half applied.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object|string}} state
 * @param {Array<object>} ops — 1…MAX_KEYWORD_OPS operations
 * @returns {{ok:boolean, error:string|null, changed:boolean, reason:string,
 *            state:object, results:Array<{changed:boolean, reason:string}>}}
 *   `reason` is the single op's reason for a 1-op batch (so the existing single-op
 *   response contract is unchanged) and 'batch'/'noop' otherwise; `results` carries
 *   the per-op outcome in request order.
 */
export function applyKeywordOps(state, ops) {
  const start = normalizeKeywordState(state);
  if (!Array.isArray(ops) || !ops.length) {
    return { ...fail(start, 'ops must be a non-empty array'), results: [] };
  }
  if (ops.length > MAX_KEYWORD_OPS) {
    return { ...fail(start, `ops must contain at most ${MAX_KEYWORD_OPS} operations`), results: [] };
  }
  let cur = start;
  const results = [];
  for (const op of ops) {
    const out = applyKeywordOp(cur, op);
    if (!out.ok) return { ...fail(start, out.error), results: [] };
    results.push({ changed: out.changed, reason: out.reason });
    cur = out.state;
  }
  const changed = results.some(r => r.changed);
  return {
    ok: true,
    error: null,
    changed,
    reason: results.length === 1 ? results[0].reason : (changed ? 'batch' : 'noop'),
    state: cur,
    results,
  };
}

/**
 * keywordInverseOps — 108.md §20. THE exact inverse of one forward op, derived from
 * the state that op was applied to. The history layer must never assemble an inverse
 * by hand: three pieces of it (the term's index, the ABSENCE of an origin, and
 * whether `meta.seeded[list]` was already set before a verdict remove) exist only in
 * the pre-image, and guessing any of them silently corrupts the round trip.
 *
 * Contract: `applyKeywordOps(applyKeywordOp(before, op).state, keywordInverseOps(before, op)).state`
 * deep-equals `before` — lists, origins, decisions AND `seeded` — for every op the
 * reducer accepts, with ONE documented exception (see below).
 *
 * Returns `[]` when the forward op was invalid or a no-op: there is nothing to undo,
 * so the history layer must record no entry.
 *
 * NOTE ON `stateBefore`: pass the state the op ACTUALLY ran against. The server runs
 * `materializeDefaults` first, so when a side's stored list was empty the op saw the
 * ~28/~50 shared defaults, not `[]`. Call `materializeDefaults(state, defaults,
 * touched)` before this helper (or snapshot the previous response's post-image, which
 * is always post-materialization) or the recorded index will be meaningless.
 *
 * `move` onto a list that ALREADY holds the term overwrites the target's origin and
 * decision, so the inverse drops and re-adds the target term at its exact prior index
 * to restore them — which is why MAX_KEYWORD_OPS is 6 rather than 2.
 *
 * ONE ASYMMETRY, by design: the reducer can CLEAR `meta.seeded[list]` (via
 * `add { clearSeeded:true }`) but never SET it outside a real verdict, so the inverse
 * of an inverse cannot restore the marker. It never has to: REDO replays the original
 * FORWARD op, which sets the marker again exactly as it did the first time.
 *
 * ONE INEXACT CASE, pinned by a test: restoring an 'accepted' verdict for a term that
 * is NOT on the list re-ACTIVATES the term (`accept` adds it). No op can write that
 * decision without the term, and the reducer itself can never produce the state —
 * only the legacy full-array `PUT /projects/:pid` can, by replacing a list without
 * touching keywordMeta. Re-activating is the self-healing reading of the stored
 * verdict, so this is treated as a repair rather than a defect.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object|string}} stateBefore
 * @param {object} op — the forward op
 * @returns {Array<object>} ops to feed straight into `applyKeywordOps`
 */
export function keywordInverseOps(stateBefore, op) {
  const before = normalizeKeywordState(stateBefore);
  const probe = applyKeywordOp(before, op);
  if (!probe.ok || !probe.changed) return [];

  const { type, list } = op;
  const term = op.term.trim();
  const key = normalizeKeywordKey(term);
  const listOf = (l) => (l === 'include' ? before.inclusion : before.exclusion);
  const idxOf = (l) => listOf(l).findIndex(t => normalizeKeywordKey(t) === key);
  const displayOf = (l) => { const i = idxOf(l); return i >= 0 ? listOf(l)[i] : term; };
  const originOf = (l) => before.meta.origins[l][key];
  const decisionOf = (l) => before.meta.decisions[l][key];
  // `origin: null` is the explicit "carried no origin" marker `add` understands.
  const originArg = (l) => { const o = originOf(l); return o === undefined ? null : o; };
  // The decision an `add`/`move` leaves behind is derived from the origin it carries.
  const impliedDecision = (o) => (o === KEYWORD_ORIGIN.ACCEPTED ? KEYWORD_DECISION.ACCEPTED : undefined);
  /** Ops that turn the decision `got` (what the inverse so far leaves) back into `want`. */
  const restoreDecision = (l, want, got) => {
    if (want === got) return [];
    if (want === KEYWORD_DECISION.ACCEPTED) return [{ type: 'accept', list: l, term }];
    if (want === KEYWORD_DECISION.REJECTED) return [{ type: 'reject', list: l, term }];
    return [{ type: 'clear-decision', list: l, term }];
  };
  /** Re-add a term exactly where and how it was, undoing the seeded marker it set. */
  const restoreTerm = (l, verdictRemoved) => {
    const add = { type: 'add', list: l, term: displayOf(l), index: idxOf(l), origin: originArg(l) };
    // Only clear the marker when THIS removal is what set it — a side that was
    // already marked edited before the op must stay marked.
    if (verdictRemoved && !isSideSeeded(before.meta, l)) add.clearSeeded = true;
    return [add, ...restoreDecision(l, decisionOf(l), impliedDecision(originOf(l)))];
  };

  if (type === 'add') {
    // The add cleared any pending verdict on the term — put it back.
    return [{ type: 'clear-decision', list, term, removeTerm: true },
      ...restoreDecision(list, decisionOf(list), undefined)];
  }
  if (type === 'remove') {
    return restoreTerm(list, op.reject !== false);
  }
  if (type === 'move') {
    const toList = op.toList || OTHER_LIST[list];
    const ops = [];
    if (idxOf(toList) >= 0) {
      // The target already held the term, so the move did not push it — but it DID
      // overwrite the target's origin and decision. Drop and rebuild it in place.
      ops.push({ type: 'remove', list: toList, term, reject: false });
      ops.push(...restoreTerm(toList, false));
    } else {
      ops.push({ type: 'remove', list: toList, term, reject: false });
      ops.push(...restoreDecision(toList, decisionOf(toList), undefined));
    }
    ops.push(...restoreTerm(list, op.reject !== false));
    return ops;
  }
  if (type === 'accept') {
    // An accept on a term that was already active only wrote a decision; one on a
    // pending suggestion also ADDED the term with an 'accepted' origin.
    if (idxOf(list) >= 0) return restoreDecision(list, decisionOf(list), KEYWORD_DECISION.ACCEPTED);
    return [{ type: 'clear-decision', list, term, removeTerm: true },
      ...restoreDecision(list, decisionOf(list), undefined)];
  }
  if (type === 'reject') {
    return restoreDecision(list, decisionOf(list), KEYWORD_DECISION.REJECTED);
  }
  if (type === 'clear-decision') {
    if (op.removeTerm === true && idxOf(list) >= 0) return restoreTerm(list, false);
    return restoreDecision(list, decisionOf(list), undefined);
  }
  return [];
}

/**
 * keywordRemoveInverse — 108.md §20's named entry point for the DELETE path (the
 * context menu's "Delete keyword" and the chip ×). Delegates to `keywordInverseOps`,
 * which is total over every op type; kept as its own export because the delete path
 * is the one the history layer must never hand-roll.
 *
 * @param {{inclusion:string[], exclusion:string[], meta:object|string}} stateBefore
 * @param {object} op — the forward `remove` (or any other op)
 * @returns {Array<object>}
 */
export function keywordRemoveInverse(stateBefore, op) {
  return keywordInverseOps(stateBefore, op);
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
