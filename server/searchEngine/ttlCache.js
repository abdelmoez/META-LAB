/**
 * ttlCache.js — tiny in-memory TTL + LRU cache for the search engine (separated
 * backend module). Pure (only Date.now), unit-testable. Used to collapse repeated
 * MeSH lookups (TTL ~30d) and PubMed count queries (TTL ~1h) to zero NLM calls and
 * stay polite to NLM's rate limits.
 *
 * get() returns `undefined` when absent/expired. A stored value of `null` is a
 * VALID cached "negative" result (e.g. a known no-match term), so callers should
 * distinguish `undefined` (miss) from `null` (cached no-match).
 */
export function createTtlCache({ ttlMs, max = 2000 }) {
  const map = new Map(); // key -> { at, value }

  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { map.delete(key); return undefined; }
      // refresh LRU recency
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      else if (map.size >= max) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) map.delete(oldest);
      }
      map.set(key, { at: Date.now(), value });
      return value;
    },
    has(key) { return this.get(key) !== undefined; },
    get size() { return map.size; },
    clear() { map.clear(); },
  };
}
