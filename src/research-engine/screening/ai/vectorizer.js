/**
 * vectorizer.js — deterministic TF-IDF sparse vectorizer for screening records.
 *
 * Pure functions, no DB, no network. Builds a vocabulary from a corpus of
 * feature-token lists (see text.recordFeatures), then transforms any feature
 * list into an L2-normalized sparse TF-IDF vector.
 *
 * Sparse vectors are plain objects { [index:number]: weight:number } — compact,
 * JSON-serializable, and fast enough for the few-thousand-record reviews this
 * engine targets.
 */

/**
 * buildVectorizer — fit a TF-IDF vocabulary over a corpus.
 *
 * @param {string[][]} corpus — array of feature-token lists (one per document)
 * @param {object} [cfg] — config.vectorizer
 * @returns {{ vocab: Record<string,number>, idf: number[], terms: string[],
 *            df: number[], nDocs: number, sublinearTf: boolean }}
 */
export function buildVectorizer(corpus, cfg = {}) {
  const minDf = cfg.minDf ?? 2;
  const maxFeatures = cfg.maxFeatures ?? 20000;
  const sublinearTf = cfg.sublinearTf ?? true;
  const nDocs = corpus.length;

  // Document frequency per term.
  const dfMap = new Map();
  for (const feats of corpus) {
    const seen = new Set(feats);
    for (const t of seen) dfMap.set(t, (dfMap.get(t) || 0) + 1);
  }

  // Filter by minDf, then keep the most-frequent maxFeatures terms.
  // Deterministic ordering: df desc, then term asc.
  let kept = [];
  for (const [term, df] of dfMap) {
    if (df >= minDf) kept.push([term, df]);
  }
  kept.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (kept.length > maxFeatures) kept = kept.slice(0, maxFeatures);

  // Final vocab indexed in alphabetical order for stable, human-readable indices.
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const vocab = {};
  const terms = new Array(kept.length);
  const df = new Array(kept.length);
  const idf = new Array(kept.length);
  for (let i = 0; i < kept.length; i++) {
    const [term, d] = kept[i];
    vocab[term] = i;
    terms[i] = term;
    df[i] = d;
    // Smoothed idf (sklearn TfidfTransformer default): ln((1+N)/(1+df)) + 1.
    idf[i] = Math.log((1 + nDocs) / (1 + d)) + 1;
  }

  return { vocab, idf, terms, df, nDocs, sublinearTf };
}

/**
 * transform — turn a feature-token list into an L2-normalized sparse TF-IDF
 * vector against a fitted vectorizer. Unknown terms are dropped.
 *
 * @param {string[]} feats
 * @param {ReturnType<typeof buildVectorizer>} vec
 * @returns {Record<number,number>} sparse vector { index: weight }
 */
export function transform(feats, vec) {
  const { vocab, idf, sublinearTf } = vec;
  const counts = new Map();
  for (const f of feats) {
    const idx = vocab[f];
    if (idx === undefined) continue;
    counts.set(idx, (counts.get(idx) || 0) + 1);
  }
  const out = {};
  let norm = 0;
  for (const [idx, tf] of counts) {
    const tfw = sublinearTf ? 1 + Math.log(tf) : tf;
    const w = tfw * idf[idx];
    out[idx] = w;
    norm += w * w;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (const idx of Object.keys(out)) out[idx] /= norm;
  }
  return out;
}

/**
 * dot — dot product of two sparse vectors (iterates the smaller one).
 * @param {Record<number,number>} a
 * @param {Record<number,number>} b
 * @returns {number}
 */
export function dot(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  const [small, large] = ka.length <= kb.length ? [a, b] : [b, a];
  let s = 0;
  for (const k of Object.keys(small)) {
    const bv = large[k];
    if (bv !== undefined) s += small[k] * bv;
  }
  return s;
}

/**
 * cosine — cosine similarity of two sparse vectors. Vectors produced by
 * `transform` are already L2-normalized, so this equals their dot product;
 * we renormalize defensively in case raw vectors are passed.
 * @param {Record<number,number>} a
 * @param {Record<number,number>} b
 * @returns {number} in [-1, 1]
 */
export function cosine(a, b) {
  const na = Math.sqrt(dot(a, a));
  const nb = Math.sqrt(dot(b, b));
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}
