/**
 * aiEmbeddingClient.js — OPTIONAL hosted-embedding integration for the screening
 * AI engine. Reads AI_EMBEDDING_* from the environment and returns an `embed`
 * function the pure engine's embedding provider can inject. Server-side ONLY — the
 * API key never reaches the client and record text is sent to the configured
 * endpoint ONLY when an admin selects the `hosted` provider AND env is configured.
 *
 * Wire format: OpenAI-compatible POST { model, input:[...] } → { data:[{embedding}] }.
 * If env is not configured, buildEmbedFn returns null and the engine gracefully
 * falls back to the in-process lexical (TF-IDF) semantic signal.
 */

import crypto from 'node:crypto';

const CHUNK = 96;                  // texts per request (provider limits)
const cache = new Map();           // `${model}\n${text}` → embedding (bounded LRU, in-memory)
const CACHE_MAX = 20000;

// ── Persistent second-level cache (66.md P4.1) ────────────────────────────────
// EmbeddingCacheEntry rows keyed (textHash, model) survive restarts so re-runs
// never re-embed unchanged records. Strictly best-effort: any DB error degrades
// to the HTTP path. The prisma client is imported lazily so this module stays
// usable in tests without a database.
let _prismaPromise = null;
function getPrisma() {
  if (!_prismaPromise) {
    _prismaPromise = import('../db/client.js').then(m => m.prisma).catch(() => null);
  }
  return _prismaPromise;
}
function textHashOf(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex');
}
async function dbCacheGet(model, texts) {
  try {
    const prisma = await getPrisma();
    if (!prisma) return new Map();
    const hashes = texts.map(textHashOf);
    const rows = await prisma.embeddingCacheEntry.findMany({
      where: { model, textHash: { in: hashes } },
      select: { textHash: true, vector: true },
    });
    const byHash = new Map(rows.map(r => [r.textHash, r.vector]));
    const out = new Map(); // text → vector
    texts.forEach((t, i) => {
      const raw = byHash.get(hashes[i]);
      if (!raw) return;
      try {
        const v = JSON.parse(raw);
        if (Array.isArray(v) && v.length && v.every(Number.isFinite)) out.set(t, v);
      } catch { /* ignore corrupt row */ }
    });
    return out;
  } catch { return new Map(); }
}
function dbCachePut(model, entries /* Array<[text, vector]> */) {
  // Fire-and-forget write-behind; never blocks or throws into the embed path.
  getPrisma().then(async (prisma) => {
    if (!prisma) return;
    for (const [text, vec] of entries) {
      const textHash = textHashOf(text);
      await prisma.embeddingCacheEntry.upsert({
        where: { textHash_model: { textHash, model } },
        create: { textHash, model, dims: vec.length, vector: JSON.stringify(vec) },
        update: {},
      }).catch(() => {});
    }
  }).catch(() => {});
}

// Keyed on the FULL text (not a 32-bit hash) so two distinct texts can never
// collide and return each other's embedding. Map preserves insertion order →
// cheap LRU: evict the oldest entry when full.
function cacheKey(model, text) { return `${model}\n${text}`; }
function cacheSet(key, vec) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, vec);
}

/**
 * buildEmbedFn — construct an embed(texts)→Promise<number[][]> from env, or null
 * when AI_EMBEDDING_ENDPOINT / AI_EMBEDDING_API_KEY are not both set.
 *
 * @param {object} [env] defaults to process.env
 * @param {{fetch?:Function}} [deps] inject fetch for tests
 * @returns {((texts:string[])=>Promise<number[][]>)|null}
 */
export function buildEmbedFn(env = process.env, deps = {}) {
  const endpoint = env.AI_EMBEDDING_ENDPOINT;
  const apiKey = env.AI_EMBEDDING_API_KEY;
  const model = env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';
  if (!endpoint || !apiKey) return null;
  const fetchFn = deps.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;
  const timeoutMs = parseInt(env.AI_EMBEDDING_TIMEOUT_MS, 10) || 15000;
  const maxRetries = 1;  // one transient retry; failures degrade to lexical fallback

  // se2.md §7 — one request with a hard timeout + dimension validation. Every returned
  // vector must be a finite, uniform-length array; a malformed batch throws so the engine
  // falls back to the lexical signal rather than scoring on a poisoned vector.
  async function postOnce(texts) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    // Race the request against the timeout so a fetch that ignores AbortSignal still bails.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { if (ctrl) ctrl.abort(); reject(new Error(`Embedding request timed out after ${timeoutMs}ms`)); }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, input: texts }),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        }),
        timeout,
      ]);
      if (!res.ok) throw new Error(`Embedding endpoint returned ${res.status}`);
      const data = await res.json();
      const out = ((data && data.data) || []).map(d => d && d.embedding);
      if (out.length !== texts.length || out.some(v => !Array.isArray(v) || !v.length)) throw new Error('Embedding count mismatch');
      const dim = out[0].length;
      if (out.some(v => v.length !== dim || v.some(x => !Number.isFinite(x)))) throw new Error('Embedding dimension validation failed');
      return out;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function embedChunk(texts) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try { return await postOnce(texts); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  // Persistent cache is ON by default in production; OFF under test (same
  // convention as aiCompute's inline mode) unless a test opts in explicitly.
  const underTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
  const usePersistentCache = deps.persistentCache === true || (deps.persistentCache !== false && !underTest);
  return async function embed(texts) {
    const out = new Array(texts.length);
    let miss = [];
    let missIdx = [];
    texts.forEach((t, i) => {
      const key = cacheKey(model, t);
      if (cache.has(key)) out[i] = cache.get(key);
      else { miss.push(t); missIdx.push(i); }
    });
    // Second-level persistent cache (survives restarts; best-effort).
    if (usePersistentCache && miss.length) {
      const dbHits = await dbCacheGet(model, miss);
      if (dbHits.size) {
        const stillMiss = [];
        const stillIdx = [];
        miss.forEach((t, j) => {
          const v = dbHits.get(t);
          if (v) {
            out[missIdx[j]] = v;
            cacheSet(cacheKey(model, t), v);
          } else { stillMiss.push(t); stillIdx.push(missIdx[j]); }
        });
        miss = stillMiss; missIdx = stillIdx;
      }
    }
    const fresh = [];
    for (let c = 0; c < miss.length; c += CHUNK) {
      const slice = miss.slice(c, c + CHUNK);
      const vecs = await embedChunk(slice);
      vecs.forEach((v, j) => {
        const i = missIdx[c + j];
        out[i] = v;
        cacheSet(cacheKey(model, texts[i]), v);
        fresh.push([texts[i], v]);
      });
    }
    if (usePersistentCache && fresh.length) dbCachePut(model, fresh);
    return out;
  };
}

/** Test-only: clear the in-memory embedding cache. */
export function _clearEmbeddingCache() { cache.clear(); }

/** Secret-free embedding config snapshot for Ops/health (se2.md §7/§17). */
export function embeddingModelInfo(env = process.env) {
  return {
    configured: !!(env.AI_EMBEDDING_ENDPOINT && env.AI_EMBEDDING_API_KEY),
    model: env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    timeoutMs: parseInt(env.AI_EMBEDDING_TIMEOUT_MS, 10) || 15000,
    endpointConfigured: !!env.AI_EMBEDDING_ENDPOINT,
  };
}

/** Live health probe (se2.md §7): embeds a tiny text and reports dim/ok. Never throws. */
export async function embeddingHealth(env = process.env, deps = {}) {
  const fn = buildEmbedFn(env, deps);
  if (!fn) return { ok: false, configured: false, reason: 'not_configured' };
  const model = env.AI_EMBEDDING_MODEL || 'text-embedding-3-small';
  try {
    const [v] = await fn(['health check']);
    return { ok: Array.isArray(v) && v.length > 0, configured: true, dim: Array.isArray(v) ? v.length : 0 };
  } catch (e) { return { ok: false, configured: true, error: e.message }; }
  finally { cache.delete(cacheKey(model, 'health check')); } // don't pollute the shared LRU
}
