/**
 * text.js — deterministic text processing for the screening AI engine.
 *
 * Pure functions, no DB, no network. Tokenization + n-gram generation + a
 * field-weighted "document" view of a screening record. Reuses the project's
 * existing STOPWORDS set so highlighting and scoring share the same vocabulary
 * intuition.
 */
import { STOPWORDS } from '../keywords.js';

/**
 * tokenize — lowercase, strip non-alphanumerics, split on whitespace, optionally
 * drop stopwords and short tokens. Numbers are preserved (e.g. "type 2", years)
 * but a bare punctuation token never survives.
 *
 * @param {string} text
 * @param {{minTokenLen?:number, dropStopwords?:boolean}} [opts]
 * @returns {string[]}
 */
export function tokenize(text, opts = {}) {
  const minTokenLen = opts.minTokenLen ?? 2;
  const dropStopwords = opts.dropStopwords ?? true;
  if (!text || typeof text !== 'string') return [];
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')   // keep alphanumerics; punctuation → space
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (const tok of raw) {
    if (tok.length < minTokenLen) continue;
    if (dropStopwords && STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

/**
 * ngrams — build unigram..(n) grams from a token list. Bigrams join with '_'
 * so they form a single distinct feature key (e.g. "heart_failure").
 *
 * @param {string[]} tokens
 * @param {[number,number]} [range] inclusive [min,max] gram size
 * @returns {string[]}
 */
export function ngrams(tokens, range = [1, 2]) {
  const [lo, hi] = range;
  const out = [];
  for (let n = lo; n <= hi; n++) {
    if (n === 1) {
      for (const t of tokens) out.push(t);
    } else {
      for (let i = 0; i + n <= tokens.length; i++) {
        out.push(tokens.slice(i, i + n).join('_'));
      }
    }
  }
  return out;
}

/**
 * splitKeywordField — split a record's `keywords` / MeSH string into individual
 * terms. Handles ';' , ',' and newline separators. Each term is lowercased and
 * whitespace-collapsed; multi-word terms keep internal spaces converted to '_'
 * so they become a single `kw:` feature.
 *
 * @param {string} keywords
 * @returns {string[]}
 */
export function splitKeywordField(keywords) {
  if (!keywords || typeof keywords !== 'string') return [];
  return keywords
    .split(/[;,\n]/)
    .map(s => s.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(s => s.replace(/\s+/g, '_'));
}

/**
 * recordFeatures — turn a screening record into a flat, field-weighted list of
 * feature tokens. Each field's tokens are repeated `fieldWeights[field]` times
 * so that, after TF-IDF, title terms naturally weigh more than abstract terms
 * (a standard and defensible bibliographic-screening heuristic). Keyword/MeSH
 * terms are emitted as `kw:<term>` features when enabled.
 *
 * @param {{title?,abstract?,keywords?,journal?}} record
 * @param {object} vectorizerCfg — config.vectorizer
 * @returns {string[]} feature tokens (with repetition encoding field weight)
 */
export function recordFeatures(record = {}, vectorizerCfg = {}) {
  const {
    ngramRange = [1, 2],
    minTokenLen = 2,
    dropStopwords = true,
    useKeywordFeatures = true,
    fieldWeights = { title: 3, abstract: 1, keywords: 2, journal: 1 },
  } = vectorizerCfg;

  const tokOpts = { minTokenLen, dropStopwords };
  const feats = [];

  const addField = (text, weight) => {
    if (!text || weight <= 0) return;
    const grams = ngrams(tokenize(text, tokOpts), ngramRange);
    for (let w = 0; w < weight; w++) for (const g of grams) feats.push(g);
  };

  addField(record.title, fieldWeights.title ?? 3);
  addField(record.abstract, fieldWeights.abstract ?? 1);
  addField(record.journal, fieldWeights.journal ?? 1);

  if (useKeywordFeatures) {
    const kwWeight = fieldWeights.keywords ?? 2;
    for (const term of splitKeywordField(record.keywords)) {
      for (let w = 0; w < kwWeight; w++) feats.push(`kw:${term}`);
    }
  }
  return feats;
}

/**
 * recordText — a plain concatenation of the human-readable text of a record,
 * used for semantic/embedding similarity and for cold-start keyword matching.
 * @param {{title?,abstract?,keywords?,journal?}} record
 * @returns {string}
 */
export function recordText(record = {}) {
  return [record.title, record.abstract, record.keywords, record.journal]
    .filter(v => typeof v === 'string' && v.trim())
    .join('\n');
}

/**
 * hasUsableText — whether a record carries enough text for the AI to say
 * anything meaningful. Used to flag "AI quality limited (no abstract)".
 * @param {{title?,abstract?}} record
 * @returns {boolean}
 */
export function hasUsableText(record = {}) {
  const title = (record.title || '').trim();
  const abstract = (record.abstract || '').trim();
  return abstract.length >= 40 || title.length >= 15;
}
