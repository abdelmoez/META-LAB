/**
 * duplicateDetectionEngine.js — scalable project-wide duplicate detection (92.md).
 * Pure functions, no database, no side effects.
 *
 * WHY this exists
 * ---------------
 * The original detector (findDuplicateGroups in deduplication.js) compares every
 * ungrouped record against every other one with a FULL-MATRIX Levenshtein — an
 * O(n² · L²) synchronous loop that also re-normalizes both titles on every pair
 * and allocates an (m+1)×(n+1) array-of-arrays per comparison. Measured on this
 * codebase: 500 records block the event loop for ~30s, 2,000 records for ~8min.
 *
 * This engine replaces brute force with the classic record-linkage recipe:
 *   1. Normalize ONCE per record (title fingerprint, lowercased DOI, trimmed PMID).
 *   2. Exact-identifier passes (DOI, then PMID) via a union-find — no scanning.
 *   3. Fuzzy title matching ONLY between blocking-key candidates: two records are
 *      compared iff they share a title prefix, suffix, or rare-token key. A pair
 *      at ≥ 0.92 similarity differs by ≤ 8% of characters, so it virtually always
 *      shares at least one of the three keys — recall is preserved while the
 *      candidate set collapses from C(n,2) to a few pairs per record.
 *   4. Each surviving candidate is scored with a BANDED, early-exit Levenshtein
 *      (O(L·k) time, two reusable rows — no per-pair matrix allocation).
 *
 * The run is COOPERATIVE: `yieldFn` is awaited every `yieldEvery` comparisons and
 * `onProgress` reports real counters, so a caller (the durable worker) can keep
 * the event loop responsive, persist progress, and honour cancellation by
 * throwing from either callback. With the default no-op callbacks the run is
 * fully deterministic: same input → same groups, byte for byte.
 */
import { normalizeTitle } from './deduplication.js';

export const DUP_DETECT_ENGINE_VERSION = 'dupdetect-2.0.0';

export const DUP_DETECT_DEFAULTS = Object.freeze({
  titleThreshold: 0.92, // same threshold the legacy pass used
  minTitleLength: 10,   // normalized titles shorter than this are too generic to fuzzy-match
  maxBlockSize: 400,    // a blocking bucket larger than this is degenerate (e.g. thousands of "untitled") — skipped + counted
  maxComparisons: 2_000_000, // hard global cap on fuzzy pair evaluations (stats.truncated when hit)
  yieldEvery: 2_000,    // await yieldFn/onProgress every N candidate-pair iterations
  prefixKeyLength: 24,  // blocking key: first/last N chars of the normalized title
  tokenKeyCount: 4,     // blocking key: the N longest title tokens (order-insensitive)
});

/** Canonical unordered pair key ("a|b" with a < b) — matches ScreenDuplicateLabel storage. */
export function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * boundedLevenshtein — edit distance capped at `maxDist`. Returns the exact
 * distance when it is ≤ maxDist, otherwise any value > maxDist (early exit).
 * Banded DP: only the |i−j| ≤ maxDist diagonal band is computed, on two reused
 * rows — O(min(m,n)·maxDist) time, O(n) space, zero per-pair matrix allocation.
 */
export function boundedLevenshtein(aStr, bStr, maxDist) {
  if (aStr === bStr) return 0;
  let a = String(aStr || ''), b = String(bStr || '');
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const m = a.length, n = b.length;
  if (maxDist < 0) return maxDist + 1; // unequal strings can never fit a negative budget
  if (n - m > maxDist) return maxDist + 1;
  if (m === 0) return n;
  const BIG = maxDist + 1;
  let prev = new Array(n + 1).fill(BIG);
  let curr = new Array(n + 1).fill(BIG);
  for (let j = 0; j <= Math.min(n, maxDist); j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const from = Math.max(1, i - maxDist);
    const to = Math.min(n, i + maxDist);
    curr.fill(BIG);
    if (from === 1) curr[0] = i <= maxDist ? i : BIG;
    let rowMin = curr[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = from; j <= to; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let v = prev[j - 1] + cost;      // substitution
      const del = prev[j] + 1;         // deletion
      if (del < v) v = del;
      const ins = curr[j - 1] + 1;     // insertion
      if (ins < v) v = ins;
      curr[j] = v < BIG ? v : BIG;
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin >= BIG) return BIG; // the whole band is over budget — no path back under it
    const t = prev; prev = curr; curr = t;
  }
  return prev[n] < BIG ? prev[n] : BIG;
}

/**
 * similarityAtLeast — similarity of two PRE-NORMALIZED titles iff it clears the
 * threshold, else 0. Similarity is (maxLen − dist) / maxLen, identical to the
 * legacy titleSimilarity, but computed with the banded early-exit distance.
 */
export function similarityAtLeast(na, nb, threshold) {
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  const maxDist = Math.floor((1 - threshold) * maxLen);
  if (Math.abs(na.length - nb.length) > maxDist) return 0;
  const d = boundedLevenshtein(na, nb, maxDist);
  if (d > maxDist) return 0;
  return (maxLen - d) / maxLen;
}

/** normalizeRecordForDedup — every derived comparison field, computed exactly once. */
export function normalizeRecordForDedup(r = {}) {
  return {
    id: r.id,
    normDoi: (r.doi || '').trim().toLowerCase(),
    normPmid: (r.pmid == null ? '' : String(r.pmid)).trim(),
    normTitle: normalizeTitle(r.title || ''),
    year: r.year == null ? '' : String(r.year).trim(),
  };
}

/**
 * blockKeysFor — deterministic blocking keys for a normalized title:
 *   p: title prefix   (survives edits near the end)
 *   s: title suffix   (survives edits near the start)
 *   t: the K longest tokens, sorted (survives spacing/stop-word/reorder edits)
 * Two records are fuzzy candidates iff they share at least one key.
 */
export function blockKeysFor(normTitle, { prefixKeyLength = DUP_DETECT_DEFAULTS.prefixKeyLength, tokenKeyCount = DUP_DETECT_DEFAULTS.tokenKeyCount } = {}) {
  const keys = [];
  if (!normTitle) return keys;
  keys.push('p:' + normTitle.slice(0, prefixKeyLength));
  keys.push('s:' + normTitle.slice(-prefixKeyLength));
  const tokens = normTitle.split(' ').filter(Boolean);
  if (tokens.length) {
    const top = [...tokens]
      .sort((x, y) => (y.length - x.length) || (x < y ? -1 : x > y ? 1 : 0))
      .slice(0, tokenKeyCount)
      .sort();
    keys.push('t:' + top.join(' '));
  }
  return keys;
}

/** Minimal union-find with path halving, union by size, and live ≥2-member group count. */
export function createUnionFind() {
  const parent = new Map();
  const size = new Map();
  let groupCount = 0; // number of components with ≥ 2 members

  const add = (x) => { if (!parent.has(x)) { parent.set(x, x); size.set(x, 1); } };
  const find = (x) => {
    add(x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    // path halving
    let c = x;
    while (parent.get(c) !== r) { const p = parent.get(c); parent.set(c, r); c = p; }
    return r;
  };
  const union = (a, b) => {
    let ra = find(a), rb = find(b);
    if (ra === rb) return false;
    const sa = size.get(ra), sb = size.get(rb);
    if (sa < sb) { const t = ra; ra = rb; rb = t; }
    parent.set(rb, ra);
    size.set(ra, sa + sb);
    if (sa === 1 && sb === 1) groupCount += 1;            // two singletons → new group
    else if (sa >= 2 && sb >= 2) groupCount -= 1;         // two groups merged into one
    return true;
  };
  return {
    find,
    union,
    connected: (a, b) => find(a) === find(b),
    get groupCount() { return groupCount; },
    /** All components with ≥2 members, each sorted; groups sorted by first id. */
    groups() {
      const byRoot = new Map();
      for (const x of parent.keys()) {
        const r = find(x);
        if (!byRoot.has(r)) byRoot.set(r, []);
        byRoot.get(r).push(x);
      }
      const out = [];
      for (const members of byRoot.values()) {
        if (members.length >= 2) out.push(members.sort());
      }
      out.sort((g1, g2) => (g1[0] < g2[0] ? -1 : g1[0] > g2[0] ? 1 : 0));
      return out;
    },
  };
}

/**
 * detectDuplicateGroups — the full detection pipeline over plain records.
 *
 * @param {Array<{id,title,doi,pmid,year}>} records
 * @param {object} opts
 *   titleThreshold / minTitleLength / maxBlockSize / maxComparisons / yieldEvery — see DUP_DETECT_DEFAULTS
 *   excludedPairs — Set<string> of pairKey(a,b) that must NEVER be linked directly
 *                   (reviewer-confirmed not_duplicate pairs). Transitive co-membership
 *                   via a third record remains possible by design.
 *   preUnion      — Array<Array<recordId>>: existing (unresolved) group memberships,
 *                   unioned up-front so re-detection extends groups instead of
 *                   duplicating them.
 *   onProgress    — async ({ stage, done, total, groupsFound, comparisonsDone, comparisonsTotal }) —
 *                   awaited at yield points; MAY THROW to abort (cancellation).
 *   yieldFn       — async () => void; awaited at yield points to release the event loop.
 * @returns {Promise<{ groups: string[][], stats: object }>}
 */
export async function detectDuplicateGroups(records, opts = {}) {
  const cfg = { ...DUP_DETECT_DEFAULTS, ...opts };
  const excludedPairs = opts.excludedPairs instanceof Set ? opts.excludedPairs : new Set(opts.excludedPairs || []);
  const preUnion = Array.isArray(opts.preUnion) ? opts.preUnion : [];
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : async () => {};
  const yieldFn = typeof opts.yieldFn === 'function' ? opts.yieldFn : async () => {};

  const stats = {
    engineVersion: DUP_DETECT_ENGINE_VERSION,
    nRecords: records.length,
    nEligibleFuzzy: 0,
    doiGroups: 0,
    pmidGroups: 0,
    exactPairsLinked: 0,
    buckets: 0,
    oversizedBlocks: 0,
    oversizedBlockMembers: 0,
    comparisonsPlanned: 0,
    comparisonsIterated: 0,   // every candidate-pair loop step (drives progress)
    comparisonsEvaluated: 0,  // actual banded-Levenshtein evaluations
    fuzzyPairsLinked: 0,
    skippedByYear: 0,
    skippedByLength: 0,
    skippedExcluded: 0,
    skippedAlreadyGrouped: 0,
    truncated: false,
  };

  const uf = createUnionFind();
  const isExcluded = (a, b) => excludedPairs.size > 0 && excludedPairs.has(pairKey(a, b));

  // ── Pre-union existing group memberships (idempotent re-detection) ──
  for (const memberIds of preUnion) {
    const ids = (memberIds || []).filter(Boolean);
    for (let i = 1; i < ids.length; i++) uf.union(ids[0], ids[i]);
  }

  // ── Stage: normalize (once per record) ──
  const norm = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    norm[i] = normalizeRecordForDedup(records[i]);
    if ((i + 1) % cfg.yieldEvery === 0) {
      await yieldFn();
      await onProgress({ stage: 'normalizing', done: i + 1, total: records.length, groupsFound: uf.groupCount });
    }
  }
  await onProgress({ stage: 'normalizing', done: records.length, total: records.length, groupsFound: uf.groupCount });

  // ── Stage: exact identifiers (DOI, then PMID) ──
  // Within an identifier bucket every member links to the first non-excluded
  // earlier member — reviewer not_duplicate pairs are never linked directly.
  const linkExactBucket = (ids) => {
    let linked = 0;
    for (let i = 1; i < ids.length; i++) {
      for (let j = 0; j < i; j++) {
        if (isExcluded(ids[j], ids[i])) { stats.skippedExcluded += 1; continue; }
        uf.union(ids[j], ids[i]);
        linked += 1;
        break;
      }
    }
    return linked;
  };

  const byDoi = new Map();
  const byPmid = new Map();
  for (const r of norm) {
    if (r.normDoi) {
      if (!byDoi.has(r.normDoi)) byDoi.set(r.normDoi, []);
      byDoi.get(r.normDoi).push(r.id);
    }
    if (r.normPmid) {
      if (!byPmid.has(r.normPmid)) byPmid.set(r.normPmid, []);
      byPmid.get(r.normPmid).push(r.id);
    }
  }
  for (const ids of byDoi.values()) {
    if (ids.length > 1) { stats.doiGroups += 1; stats.exactPairsLinked += linkExactBucket(ids); }
  }
  for (const ids of byPmid.values()) {
    if (ids.length > 1) { stats.pmidGroups += 1; stats.exactPairsLinked += linkExactBucket(ids); }
  }
  await yieldFn();
  await onProgress({ stage: 'exact', done: 1, total: 1, groupsFound: uf.groupCount });

  // ── Stage: fuzzy title matching within blocking buckets ──
  const eligible = [];
  for (const r of norm) {
    if (r.normTitle.length >= cfg.minTitleLength) eligible.push(r);
  }
  stats.nEligibleFuzzy = eligible.length;

  const buckets = new Map(); // blockKey → array of indices into `eligible`
  for (let i = 0; i < eligible.length; i++) {
    for (const k of blockKeysFor(eligible[i].normTitle, cfg)) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
  }
  stats.buckets = buckets.size;

  // Plan size (for honest progress): pairs per kept bucket. An overestimate of the
  // UNIQUE pair count (a pair sharing 2 keys is planned twice) — `done` counts the
  // same loop steps, so progress still lands exactly on total.
  const keptBuckets = [];
  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;
    if (idxs.length > cfg.maxBlockSize) {
      stats.oversizedBlocks += 1;
      stats.oversizedBlockMembers += idxs.length;
      continue;
    }
    keptBuckets.push(idxs);
    stats.comparisonsPlanned += (idxs.length * (idxs.length - 1)) / 2;
  }
  if (stats.comparisonsPlanned > cfg.maxComparisons) stats.comparisonsPlanned = cfg.maxComparisons;

  const seenPairs = new Set(); // i*N+j codes (i<j) — dedupe across shared keys
  const N = eligible.length;
  let sinceYield = 0;
  let done = 0;

  outer:
  for (const idxs of keptBuckets) {
    for (let x = 0; x < idxs.length; x++) {
      for (let y = x + 1; y < idxs.length; y++) {
        if (done >= cfg.maxComparisons) { stats.truncated = true; break outer; }
        done += 1;
        sinceYield += 1;
        if (sinceYield >= cfg.yieldEvery) {
          sinceYield = 0;
          await yieldFn();
          await onProgress({
            stage: 'fuzzy', done, total: stats.comparisonsPlanned,
            groupsFound: uf.groupCount, comparisonsDone: done, comparisonsTotal: stats.comparisonsPlanned,
          });
        }
        const i = idxs[x] < idxs[y] ? idxs[x] : idxs[y];
        const j = idxs[x] < idxs[y] ? idxs[y] : idxs[x];
        const code = i * N + j;
        if (seenPairs.has(code)) continue;
        seenPairs.add(code);

        const a = eligible[i], b = eligible[j];
        if (a.year && b.year && a.year !== b.year) { stats.skippedByYear += 1; continue; }
        if (isExcluded(a.id, b.id)) { stats.skippedExcluded += 1; continue; }
        if (uf.connected(a.id, b.id)) { stats.skippedAlreadyGrouped += 1; continue; }

        const maxLen = Math.max(a.normTitle.length, b.normTitle.length);
        const maxDist = Math.floor((1 - cfg.titleThreshold) * maxLen);
        if (Math.abs(a.normTitle.length - b.normTitle.length) > maxDist) { stats.skippedByLength += 1; continue; }

        stats.comparisonsEvaluated += 1;
        const d = boundedLevenshtein(a.normTitle, b.normTitle, maxDist);
        if (d <= maxDist) {
          uf.union(a.id, b.id);
          stats.fuzzyPairsLinked += 1;
        }
      }
    }
  }
  stats.comparisonsIterated = done;
  await onProgress({
    stage: 'fuzzy', done: stats.comparisonsPlanned, total: stats.comparisonsPlanned,
    groupsFound: uf.groupCount, comparisonsDone: done, comparisonsTotal: stats.comparisonsPlanned,
  });

  const groups = uf.groups();
  stats.groupsOut = groups.length;
  return { groups, stats };
}
