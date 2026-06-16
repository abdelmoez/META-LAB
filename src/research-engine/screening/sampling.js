/**
 * sampling.js — reproducible calibration sampling (roadmap 1.3).
 *
 * Pure, deterministic. A stored integer seed reproduces the exact same
 * calibration subset, so a pilot sample is auditable and re-derivable — a
 * requirement for the reproducibility guarantees in PART A.5.
 */

/**
 * mulberry32 — small, fast, deterministic 32-bit PRNG. Given the same seed it
 * always yields the same sequence in [0, 1).
 * @param {number} seed  unsigned 32-bit integer
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher–Yates shuffle of indices [0..len) using the seed.
 * @returns {number[]} a permutation of [0..len)
 */
export function seededPermutation(len, seed) {
  const rand = mulberry32(seed);
  const idx = Array.from({ length: len }, (_, i) => i);
  for (let i = len - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
  }
  return idx;
}

/**
 * Pick a reproducible random subset of `n` items.
 * @param {Array}  items  the population to sample from
 * @param {number} n      desired sample size (clamped to [0, items.length])
 * @param {number} seed   integer seed; the same seed reproduces the same sample
 * @returns {{ sample: Array, indices: number[], seed: number, n: number, total: number }}
 */
export function seededSample(items, n, seed) {
  if (!Array.isArray(items)) return null;
  const total = items.length;
  const size = Math.max(0, Math.min(Math.floor(n) || 0, total));
  const perm = seededPermutation(total, seed >>> 0);
  const indices = perm.slice(0, size).sort((a, b) => a - b); // keep original order in the subset
  return { sample: indices.map(i => items[i]), indices, seed: seed >>> 0, n: size, total };
}
