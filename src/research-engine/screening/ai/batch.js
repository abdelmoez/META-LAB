/**
 * batch.js — tiny pure batching helpers for chunked scoring/persistence (se2.md §12).
 * No DB, no network.
 */

/** Split an array into chunks of at most `size` (size ≥ 1). Returns [] for empty input. */
export function chunk(arr, size = 500) {
  const a = Array.isArray(arr) ? arr : [];
  const n = Math.max(1, Math.floor(size) || 1);
  const out = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

/** Progress fraction (0..1) for `done` of `total`; 1 when total is 0. */
export function progressFraction(done, total) {
  if (!total || total <= 0) return 1;
  return Math.min(1, Math.max(0, done / total));
}
