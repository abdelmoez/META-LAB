/**
 * extraction/validationMetrics.js — P5. Pure, dependency-free scoring of an
 * automated extractor (the heuristic assistant, or any future AI) against a
 * human-verified GOLD standard. Lets us report, honestly, how often the assistant
 * is right — the difference between "we have AI extraction" and "we know how good it
 * is".
 *
 * INPUTS
 *   suggestions: the output of heuristicExtract.suggestFromText — a list of
 *     { elementId, armKey, value, notFound } (plus provenance/confidence, ignored here).
 *   gold: [{ elementId, armKey, value }] — the human-verified truth. An element with
 *     NO gold entry is treated as "gold absent" (the truth is that there is nothing
 *     to extract). armKey defaults to ''.
 *
 * FORMULAS (all rates in [0,1]; a rate over an empty denominator is reported as 0)
 *   Let, over the joined set of (elementId, armKey) keys present in either side:
 *     - exactMatch: suggested value equals gold value (numeric ==, or normalized text ==).
 *     - withinTol : |suggested − gold| / max(|suggested|,|gold|) ≤ tol (default 0.01),
 *                   OR exact for non-numerics. Near-zero uses an absolute floor.
 *     - missedByAi: gold present AND ai notFound (a false negative).
 *     - falseFind : ai proposed AND gold absent   (a false positive).
 *   Summary:
 *     n                 = number of joined field comparisons
 *     exactMatchRate    = (# exactMatch) / (# where BOTH present)
 *     withinTolRate     = (# withinTol)  / (# where BOTH present)
 *     fieldPrecision    = TP / (TP + FP)   where TP = ai proposed & gold present & withinTol,
 *                                                FP = ai proposed & (gold absent OR not withinTol)
 *     fieldRecall       = TP / (TP + FN)   where FN = gold present & (ai notFound OR not withinTol)
 *     missingnessAccuracy = (# where ai-notFound agrees with gold-absent, in BOTH directions)
 *                           / n   — i.e. how well the assistant knows when to stay silent.
 */

import { valueKey } from './model.js';

const DEFAULT_TOL = 0.01;
const ABS_FLOOR = 1e-9;

/**
 * compareToGold(suggestions, gold, opts?) — score suggestions vs gold.
 * @returns {{ fields: Array, summary: object }}
 */
export function compareToGold(suggestions = [], gold = [], opts = {}) {
  const tol = opts.tol == null ? DEFAULT_TOL : opts.tol;

  const sugMap = new Map();
  for (const s of suggestions) {
    sugMap.set(valueKey(s.elementId, s.armKey || ''), s);
  }
  const goldMap = new Map();
  for (const g of gold) {
    goldMap.set(valueKey(g.elementId, g.armKey || ''), g);
  }

  const keys = new Set([...sugMap.keys(), ...goldMap.keys()]);

  const fields = [];
  let bothPresent = 0;
  let exactCount = 0;
  let tolCount = 0;
  let tp = 0; // ai proposed, gold present, withinTol
  let fp = 0; // ai proposed, (gold absent OR not withinTol)
  let fn = 0; // gold present, (ai notFound OR not withinTol)
  let missAgree = 0; // ai-silence matches gold-absence in both directions

  for (const key of [...keys].sort()) {
    const s = sugMap.get(key);
    const g = goldMap.get(key);
    const [elementId, armKey] = splitKey(key);

    const aiProposed = !!s && !s.notFound && s.value !== undefined;
    const goldPresent = !!g && !isValueMissing(g.value);
    const suggested = aiProposed ? s.value : null;
    const goldVal = goldPresent ? g.value : null;

    // Numeric error metrics (only when both sides are scalar numbers).
    const numPair = extractNumericPair(suggested, goldVal);
    let numericAbsError = null;
    let numericRelError = null;
    if (numPair) {
      numericAbsError = Math.abs(numPair.a - numPair.b);
      const denom = Math.max(Math.abs(numPair.a), Math.abs(numPair.b));
      numericRelError = denom === 0 ? 0 : numericAbsError / denom;
    }

    const exactMatch = aiProposed && goldPresent && valuesExactEqual(suggested, goldVal);
    const withinTol = aiProposed && goldPresent && valuesWithinTol(suggested, goldVal, tol);
    const missedByAi = goldPresent && (!s || s.notFound);
    const falseFind = aiProposed && !goldPresent;

    if (aiProposed && goldPresent) {
      bothPresent += 1;
      if (exactMatch) exactCount += 1;
      if (withinTol) tolCount += 1;
    }

    // Precision/recall bookkeeping.
    if (aiProposed && goldPresent && withinTol) tp += 1;
    if (aiProposed && (!goldPresent || !withinTol)) fp += 1;
    if (goldPresent && (!aiProposed || !withinTol)) fn += 1;

    // Missingness: agreement means (ai silent AND gold absent) OR (ai proposed AND gold present).
    if ((!aiProposed && !goldPresent) || (aiProposed && goldPresent)) missAgree += 1;

    fields.push({
      elementId,
      armKey,
      suggested,
      gold: goldVal,
      exactMatch,
      numericAbsError,
      numericRelError,
      withinTol,
      missedByAi,
      falseFind,
    });
  }

  const n = fields.length;
  const summary = {
    n,
    exactMatchRate: rate(exactCount, bothPresent),
    withinTolRate: rate(tolCount, bothPresent),
    fieldPrecision: rate(tp, tp + fp),
    fieldRecall: rate(tp, tp + fn),
    missingnessAccuracy: rate(missAgree, n),
  };

  return { fields, summary };
}

/* ── Value comparison helpers ─────────────────────────────────────────────── */

function valuesExactEqual(a, b) {
  const pa = scalarOf(a);
  const pb = scalarOf(b);
  if (pa !== undefined && pb !== undefined) {
    if (typeof pa === 'number' && typeof pb === 'number') return pa === pb;
    return normText(pa) === normText(pb);
  }
  // Object values (dichotomous/continuous): deep-equal the present subfields.
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (numOr(a[k]) !== numOr(b[k])) return false;
    }
    return true;
  }
  return false;
}

function valuesWithinTol(a, b, tol) {
  const pa = scalarOf(a);
  const pb = scalarOf(b);
  if (typeof pa === 'number' && typeof pb === 'number') {
    const diff = Math.abs(pa - pb);
    if (diff <= ABS_FLOOR) return true;
    const denom = Math.max(Math.abs(pa), Math.abs(pb));
    return denom === 0 ? diff <= ABS_FLOOR : diff / denom <= tol;
  }
  if (pa !== undefined && pb !== undefined) {
    return normText(pa) === normText(pb);
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const va = numOr(a[k]);
      const vb = numOr(b[k]);
      if (va === null && vb === null) continue;
      if (va === null || vb === null) return false;
      const diff = Math.abs(va - vb);
      const denom = Math.max(Math.abs(va), Math.abs(vb));
      if (!(diff <= ABS_FLOOR || (denom !== 0 && diff / denom <= tol))) return false;
    }
    return true;
  }
  return false;
}

/** extractNumericPair — return {a,b} if both values are (or contain) a single scalar number. */
function extractNumericPair(a, b) {
  const pa = scalarOf(a);
  const pb = scalarOf(b);
  if (typeof pa === 'number' && typeof pb === 'number') return { a: pa, b: pb };
  return null;
}

/** scalarOf — unwrap { value } / bare scalar; returns undefined for object-multi values. */
function scalarOf(v) {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (isPlainObject(v)) {
    if ('value' in v) return v.value;
    return undefined; // dichotomous/continuous object — handled elsewhere
  }
  return undefined;
}

function isValueMissing(v) {
  if (v === null || v === undefined || v === '') return true;
  const s = scalarOf(v);
  if (s === null || s === undefined || s === '') {
    // Could still be an object value with present subfields.
    if (isPlainObject(v)) return Object.values(v).every((x) => x === null || x === undefined || x === '');
    return true;
  }
  return false;
}

function normText(v) {
  return String(v).trim().replace(/\s+/g, ' ').toLowerCase();
}
function numOr(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
function rate(num, den) {
  return den === 0 ? 0 : num / den;
}
function splitKey(key) {
  const idx = key.indexOf('::');
  if (idx === -1) return [key, ''];
  return [key.slice(0, idx), key.slice(idx + 2)];
}
