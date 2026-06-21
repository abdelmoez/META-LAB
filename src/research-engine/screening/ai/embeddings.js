/**
 * embeddings.js — pluggable embedding-provider abstraction.
 *
 * Pure functions, no network in this layer. The DEFAULT provider is 'lexical':
 * it returns no vectors, and the engine gracefully falls back to TF-IDF cosine
 * similarity (which already gives a real, dependency-free "semantic" signal via
 * the included/excluded record centroids — see activeLearning.js).
 *
 * A dependency-free 'hashing' provider is included so a fixed-width dense vector
 * is available without any external service. A 'hosted' provider is wired by
 * INJECTING an `embed` function (the server supplies one that calls a real
 * embedding API); the pure layer never makes the network call itself, so secrets
 * and record text never leak from here. If no embed fn is injected, 'hosted'
 * degrades to lexical fallback — exactly the "graceful fallback" the spec wants.
 */
import { recordText, tokenize, ngrams } from './text.js';

/** Deterministic 32-bit string hash (FNV-1a). */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * hashingEmbed — feature-hashing embedder. Maps n-grams into a fixed-width
 * dense vector with signed hashing, then L2-normalizes. Deterministic.
 * @param {string} text
 * @param {number} dims
 * @returns {number[]}
 */
export function hashingEmbed(text, dims = 512) {
  const vec = new Array(dims).fill(0);
  const grams = ngrams(tokenize(text), [1, 2]);
  for (const g of grams) {
    const h = fnv1a(g);
    const idx = h % dims;
    const sign = (h & 1) ? 1 : -1;
    vec[idx] += sign;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

/** Cosine similarity of two equal-length dense vectors. */
export function cosineDense(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * createEmbeddingProvider — build a provider from config + optional injected deps.
 *
 * @param {object} cfg — config.provider ({ embedding, hashingDims })
 * @param {object} [deps]
 * @param {(texts:string[])=>Promise<number[][]>|number[][]} [deps.embed] — hosted embed fn
 * @returns {{ name:string, available:boolean,
 *            embedRecords:(records:object[])=>Promise<number[][]|null> }}
 */
export function createEmbeddingProvider(cfg = {}, deps = {}) {
  const name = cfg.embedding || 'lexical';
  const dims = cfg.hashingDims || 512;

  if (name === 'hashing') {
    return {
      name,
      available: true,
      async embedRecords(records) {
        return records.map(r => hashingEmbed(recordText(r), dims));
      },
    };
  }

  if (name === 'hosted' && typeof deps.embed === 'function') {
    return {
      name,
      available: true,
      async embedRecords(records) {
        try {
          const out = await deps.embed(records.map(r => recordText(r)));
          return Array.isArray(out) && out.length === records.length ? out : null;
        } catch {
          return null; // graceful fallback to lexical
        }
      },
    };
  }

  // 'lexical' (default) or 'hosted' with no injected embed fn → no dense vectors.
  return { name: 'lexical', available: false, async embedRecords() { return null; } };
}
