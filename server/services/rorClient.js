/**
 * rorClient.js — Research Organization Registry (ROR) lookup (prompt35).
 *
 * Canonical institution identity provider. Queries the PUBLIC ROR v2 API
 * (https://ror.org — no API key, open data) from the BACKEND only, normalises
 * results to our suggestion shape, and degrades gracefully: any failure (no
 * network, timeout, non-200, missing global fetch, disabled by env) returns an
 * EMPTY array so institution search — and therefore onboarding/registration —
 * never breaks. Results are cached in-memory with a short TTL to be polite to
 * the public API and snappy for repeated prefixes.
 *
 * Enable/disable with ROR_ENABLED ('false' disables). Override the base URL with
 * ROR_API_BASE (e.g. a mirror) and timeout with ROR_TIMEOUT_MS.
 *
 * NOTE: no secrets are sent to ROR — only the public query string. No passwords,
 * tokens, emails, or user identifiers are ever forwarded.
 */

const DEFAULT_BASE = 'https://api.ror.org/v2/organizations';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CACHE_MAX = 500;
const cache = new Map(); // normQuery -> { at: epochMs, results: [...] }

function rorEnabled() {
  return String(process.env.ROR_ENABLED ?? 'true').toLowerCase() !== 'false';
}
function rorBase() {
  return process.env.ROR_API_BASE || DEFAULT_BASE;
}
function rorTimeoutMs() {
  const n = Number(process.env.ROR_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 3500;
}

// Pull the display name + aliases out of a ROR v2 `names` array.
function pickNames(names) {
  const list = Array.isArray(names) ? names : [];
  let display = '';
  const aliases = [];
  for (const n of list) {
    const value = (n && n.value) ? String(n.value) : '';
    if (!value) continue;
    const types = Array.isArray(n.types) ? n.types : [];
    if (!display && types.includes('ror_display')) display = value;
    else aliases.push(value);
  }
  if (!display && aliases.length) display = aliases.shift();
  return { display, aliases };
}

// Map ONE ROR v2 organization record to our normalized suggestion shape.
// Exported (pure) so it can be unit-tested without network access.
export function mapRorOrganization(org) {
  if (!org || typeof org !== 'object') return null;
  const { display, aliases } = pickNames(org.names);
  if (!display) return null;
  const loc = (Array.isArray(org.locations) ? org.locations : [])[0];
  const geo = loc && loc.geonames_details ? loc.geonames_details : {};
  const website = (Array.isArray(org.links) ? org.links : [])
    .find(l => l && (l.type === 'website' || !l.type) && l.value);
  return {
    canonicalName: display,
    rorId: org.id || null,
    city: geo.name || null,
    countryName: geo.country_name || null,
    countryCode: geo.country_code || null,
    aliases: aliases.slice(0, 6),
    website: website ? website.value : null,
    source: 'ror',
  };
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  // We cannot call Date.now()? — server context allows it (not the pure engine).
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.results;
}
function setCached(key, results) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), results });
}

/**
 * Search ROR for institutions matching `q`. Always resolves (never rejects) to
 * an array of normalized suggestions; returns [] when disabled / unavailable /
 * on any error so callers can treat ROR as best-effort enrichment.
 * @param {string} q
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<object>>}
 */
export async function searchRor(q, { limit = 6 } = {}) {
  const query = String(q || '').trim();
  if (!rorEnabled() || query.length < 2) return [];
  if (typeof fetch !== 'function') return []; // Node < 18 without global fetch
  const cacheKey = query.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached.slice(0, limit);

  const url = `${rorBase()}?query=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), rorTimeoutMs());
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res || !res.ok) { setCached(cacheKey, []); return []; }
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    const results = items
      .map(mapRorOrganization)
      .filter(Boolean);
    setCached(cacheKey, results);
    return results.slice(0, limit);
  } catch {
    // Network error, timeout/abort, bad JSON — never throw to the caller.
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export const ROR_CLIENT_VERSION = 'v1';
