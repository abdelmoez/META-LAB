/**
 * openAlexClient.js — OpenAlex institution lookup (prompt35 follow-up).
 *
 * SECONDARY institution source behind ROR (ROR stays the canonical identity).
 * Queries the PUBLIC OpenAlex API (https://openalex.org — no API key) from the
 * BACKEND only, normalises to our suggestion shape, and degrades gracefully: any
 * failure / disabled / missing fetch returns [] so it can only ever ADD coverage,
 * never break search. OpenAlex records carry a ROR id, so the search controller
 * can dedupe OpenAlex hits against ROR hits by ror id.
 *
 * Enable/disable with OPENALEX_ENABLED ('false' disables). OPENALEX_MAILTO joins
 * OpenAlex's polite pool (recommended). Only the public query string is sent — no
 * secrets, tokens, emails (other than the optional polite-pool mailto), or user ids.
 */

const DEFAULT_BASE = 'https://api.openalex.org/institutions';
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map();

function enabled() { return String(process.env.OPENALEX_ENABLED ?? 'true').toLowerCase() !== 'false'; }
function base() { return process.env.OPENALEX_API_BASE || DEFAULT_BASE; }
function timeoutMs() { const n = Number(process.env.OPENALEX_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 3500; }

// Map ONE OpenAlex institution record to our normalized suggestion shape. Pure +
// exported for unit testing without network access.
export function mapOpenAlexInstitution(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const name = rec.display_name ? String(rec.display_name) : '';
  if (!name) return null;
  const geo = rec.geo && typeof rec.geo === 'object' ? rec.geo : {};
  const aliases = Array.isArray(rec.display_name_alternatives) ? rec.display_name_alternatives.filter(Boolean).map(String) : [];
  return {
    canonicalName: name,
    rorId: rec.ror || null,            // OpenAlex carries the ROR id → dedupes vs ROR
    city: geo.city || null,
    countryName: geo.country || null,
    countryCode: rec.country_code || geo.country_code || null,
    aliases: aliases.slice(0, 6),
    website: rec.homepage_url || null,
    source: 'openalex',
  };
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.results;
}
function setCached(key, results) {
  if (cache.size >= CACHE_MAX) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  cache.set(key, { at: Date.now(), results });
}

/**
 * Search OpenAlex for institutions matching `q`. Always resolves (never rejects)
 * to normalized suggestions; returns [] when disabled / unavailable / on error.
 * @param {string} q
 * @param {{ limit?: number }} [opts]
 */
export async function searchOpenAlex(q, { limit = 6 } = {}) {
  const query = String(q || '').trim();
  if (!enabled() || query.length < 2) return [];
  if (typeof fetch !== 'function') return [];
  const cacheKey = query.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached.slice(0, limit);

  const mailto = process.env.OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(process.env.OPENALEX_MAILTO)}` : '';
  const url = `${base()}?search=${encodeURIComponent(query)}&per-page=${Math.min(25, Math.max(1, limit))}${mailto}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res || !res.ok) { setCached(cacheKey, []); return []; }
    const data = await res.json();
    const items = Array.isArray(data?.results) ? data.results : [];
    const results = items.map(mapOpenAlexInstitution).filter(Boolean);
    setCached(cacheKey, results);
    return results.slice(0, limit);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const OPENALEX_CLIENT_VERSION = 'v1';
