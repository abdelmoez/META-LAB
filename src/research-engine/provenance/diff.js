/**
 * provenance/diff.js — 88.md "Before-and-After Values" + Privacy/Security.
 * Structured, size-bounded, redacted diffing of previous→new values so the event
 * ledger keeps enough to understand a change WITHOUT storing secrets, PHI, or huge
 * blobs. Large values are replaced by a { __hash, __size } fingerprint.
 *
 * Pure — no DOM/React/network/Date.
 */

const MAX_STRING = 2000;      // strings longer than this are truncated + hashed
const MAX_ARRAY = 50;         // arrays longer than this keep a head sample + count
const MAX_DEPTH = 6;

/** Keys whose values must never be persisted verbatim (secrets / PHI-ish). */
const REDACT_KEY = /(token|secret|password|passwd|authorization|api[-_]?key|cookie|session|credential|ssn|mrn|dob|patient|email|phone)/i;

/** FNV-1a 32-bit hex of a stable JSON stringification. Self-contained (no import). */
export function fnv1a(input) {
  const str = typeof input === 'string' ? input : stableStringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

/** Deterministic stringify (sorted keys) so hashes are stable across key order. */
export function stableStringify(v) {
  // `seen` tracks the ANCESTOR path, not every visited node: we delete a node after
  // recursing out of it, so a shared-but-acyclic reference used in two sibling
  // positions serializes its real value both times and ONLY a true cycle (a node that
  // is its own ancestor) becomes '[circular]'. A whole-tree visited-set would falsely
  // collapse DAG-shaped inputs to '[circular]', making the hash lossy.
  const seen = new WeakSet();
  const walk = (x) => {
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[circular]';
    seen.add(x);
    let out;
    if (Array.isArray(x)) out = x.map(walk);
    else { out = {}; for (const k of Object.keys(x).sort()) out[k] = walk(x[k]); }
    seen.delete(x);
    return out;
  };
  try { return JSON.stringify(walk(v)); } catch { return String(v); }
}

/**
 * Sanitize an arbitrary value for storage in an event record: redact sensitive
 * keys, truncate long strings, cap large arrays, and fingerprint anything past a
 * depth/size bound. Returns a JSON-safe, bounded copy. Pure.
 */
export function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value === undefined ? null : null;
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'boolean') return value;
  if (t === 'bigint') return Number(value);
  if (t === 'string') {
    return value.length > MAX_STRING
      ? { __truncated: true, __size: value.length, __hash: fnv1a(value), head: value.slice(0, 200) }
      : value;
  }
  if (t !== 'object') return null; // functions/symbols dropped
  if (depth >= MAX_DEPTH) return { __hash: fnv1a(value), __depth: depth };
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) {
      return {
        __array: true, __size: value.length, __hash: fnv1a(value),
        head: value.slice(0, 5).map((v) => sanitizeValue(v, depth + 1)),
      };
    }
    return value.map((v) => sanitizeValue(v, depth + 1));
  }
  const out = {};
  for (const k of Object.keys(value)) {
    if (REDACT_KEY.test(k)) { out[k] = '[redacted]'; continue; }
    out[k] = sanitizeValue(value[k], depth + 1);
  }
  return out;
}

/** Are two values equal after stable stringify? (No-op detection.) Pure. */
export function isNoop(prev, next) {
  return stableStringify(prev) === stableStringify(next);
}

/**
 * structuredDiff(prev, next) → a compact, JSON-safe description of what changed.
 * For scalars: {kind:'scalar', prev, next}. For objects: {kind:'object', changed:{key:{prev,next}}, added:[…], removed:[…]}.
 * For arrays: {kind:'array', prevLen, nextLen, addedCount, removedCount} (identity by stable stringify of items).
 * All values are sanitized. Pure.
 */
export function structuredDiff(prev, next) {
  const pIsObj = prev && typeof prev === 'object' && !Array.isArray(prev);
  const nIsObj = next && typeof next === 'object' && !Array.isArray(next);
  const pIsArr = Array.isArray(prev);
  const nIsArr = Array.isArray(next);

  if (pIsArr || nIsArr) {
    const pa = pIsArr ? prev : [];
    const na = nIsArr ? next : [];
    const pset = new Set(pa.map(stableStringify));
    const nset = new Set(na.map(stableStringify));
    let added = 0, removed = 0;
    for (const s of nset) if (!pset.has(s)) added++;
    for (const s of pset) if (!nset.has(s)) removed++;
    return { kind: 'array', prevLen: pa.length, nextLen: na.length, addedCount: added, removedCount: removed };
  }

  if (pIsObj || nIsObj) {
    const po = pIsObj ? prev : {};
    const no = nIsObj ? next : {};
    const keys = new Set([...Object.keys(po), ...Object.keys(no)]);
    const changed = {};
    const added = [];
    const removed = [];
    for (const k of keys) {
      const inP = k in po, inN = k in no;
      if (inP && !inN) { removed.push(k); continue; }
      if (!inP && inN) { added.push(k); continue; }
      if (!isNoop(po[k], no[k])) {
        changed[k] = { prev: sanitizeValue(po[k]), next: sanitizeValue(no[k]) };
      }
    }
    return { kind: 'object', changed, added, removed };
  }

  return { kind: 'scalar', prev: sanitizeValue(prev), next: sanitizeValue(next) };
}

export default { fnv1a, stableStringify, sanitizeValue, isNoop, structuredDiff };
