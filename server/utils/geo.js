/**
 * geo.js — privacy-first, country-LEVEL-ONLY geolocation (prompt19 Task 12).
 *
 * PRIVACY CONTRACT (non-negotiable):
 *   - We resolve and store the COUNTRY ONLY. Never the city, region, coordinates,
 *     or the raw IP address. The only thing derived from the IP that may be
 *     persisted is an OPTIONAL salted SHA-256 hash (hashIp) — never the IP itself.
 *   - Every resolution path is best-effort. resolveCountry NEVER throws: the
 *     caller (register) must never 500 or be slowed because of geolocation.
 *
 * RESOLUTION ORDER (resolveCountry → { code, name, source }):
 *   1. Proxy country header (cf-ipcountry, x-vercel-ip-country, x-country,
 *      x-appengine-country). Uppercased 2-letter ISO-3166 alpha-2. 'XX'/'T1'
 *      (Cloudflare's "unknown"/Tor placeholders) are ignored. source = 'header'.
 *   2. OPTIONAL offline lookup via dynamic import of 'geoip-lite' — ONLY if it is
 *      already installed. We never npm-install it and never add it as a dep; the
 *      try/catch silently skips this step when the package is absent. source = 'geoip'.
 *   3. Private / loopback / empty IP (127.*, ::1, 10.*, 192.168.*, 172.16-31.*,
 *      localhost) → code '', name '' (persisted as 'Unknown' — never the
 *      misleading literal 'Local'), source 'local'.
 *   4. Otherwise → code '', name 'Unknown', source 'none'.
 *
 * Production note: real country detection requires the client IP to reach this
 * process. Configure `trust proxy` (server/index.js, default on) so req.ip is the
 * true client IP, and front the app with a proxy that sets a country header
 * (CF-IPCountry / x-vercel-ip-country) OR install the optional offline `geoip-lite`
 * package — this module uses either automatically when present.
 */

import crypto from 'crypto';

// Proxy headers that carry a 2-letter country code, in priority order.
const COUNTRY_HEADERS = [
  'cf-ipcountry',        // Cloudflare
  'x-vercel-ip-country', // Vercel edge
  'x-country',           // generic / custom proxies
  'x-appengine-country', // Google App Engine
];

// Cloudflare placeholders that mean "no country" — must be treated as unknown.
const PLACEHOLDER_CODES = new Set(['XX', 'T1']);

let geoipModule;      // cached resolved module (or null once we know it's absent)
let geoipAttempted = false;
let warnedNoGeoSource = false; // throttle the "no country source" misconfig warning to once

function warnNoGeoSourceOnce() {
  if (warnedNoGeoSource) return;
  warnedNoGeoSource = true;
  console.warn('[geo] No country source for a public client IP: neither a proxy country header (CF-IPCountry / x-vercel-ip-country) nor the offline geoip-lite DB resolved it. Country will be saved as "Unknown". Install geoip-lite (an optionalDependency) and/or front the app with a proxy that sets a country header.');
}

/**
 * Best-effort dynamic import of geoip-lite. Returns the module or null.
 * Never installs anything; a missing package resolves to null and is cached.
 */
async function loadGeoip() {
  if (geoipAttempted) return geoipModule || null;
  geoipAttempted = true;
  try {
    const mod = await import('geoip-lite');
    geoipModule = mod?.default || mod || null;
  } catch {
    geoipModule = null; // not installed — silently skip step 2 forever
  }
  return geoipModule;
}

/**
 * Extract the best-guess client IP without trusting anything blindly.
 *
 * With 'trust proxy' configured (server/index.js), Express has already resolved
 * the real client IP into req.ip from X-Forwarded-For — trust that first. If req.ip
 * is still a private address (e.g. trust proxy not set, or a private upstream),
 * defensively pick the FIRST PUBLIC IP from the X-Forwarded-For chain rather than
 * the left-most value. Falls back to the socket address. Returns '' when nothing
 * usable is present.
 */
export function getClientIp(req) {
  if (!req) return '';
  const direct = req.ip ? String(req.ip).trim() : '';
  if (direct && !isPrivateIp(direct)) return direct;        // trusted public client IP

  const xff = req.headers?.['x-forwarded-for'];
  if (xff) {
    const parts = String(xff).split(',').map(s => s.trim()).filter(Boolean);
    const firstPublic = parts.find(ip => !isPrivateIp(ip));
    if (firstPublic) return firstPublic;                    // first non-private hop
  }
  if (direct) return direct;                                // genuine local/private (dev)
  const sock = req.socket?.remoteAddress || req.connection?.remoteAddress;
  return sock ? String(sock).trim() : '';
}

/**
 * Normalize an IP for private/loopback classification: strip an IPv6 prefix on
 * IPv4-mapped addresses (::ffff:127.0.0.1 → 127.0.0.1).
 */
function normalizeIp(ip) {
  if (!ip) return '';
  let s = ip.trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s;
}

/**
 * True for empty, loopback, or RFC1918 private addresses.
 * 127.*, ::1, 10.*, 192.168.*, 172.16-31.*, localhost, and empty.
 */
export function isPrivateIp(ip) {
  const s = normalizeIp(ip);
  if (!s) return true;
  if (s === '::1' || s === 'localhost') return true;
  if (s.startsWith('127.')) return true;
  if (s.startsWith('10.')) return true;
  if (s.startsWith('192.168.')) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = s.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // Unique-local / link-local IPv6 (fc00::/7, fe80::/10).
  if (s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true;
  return false;
}

/**
 * Human-readable country name from a 2-letter ISO code, via the zero-dependency
 * Intl.DisplayNames (Node 18+). Falls back to the raw code on any failure.
 */
export function countryNameFromCode(code) {
  if (!code || typeof code !== 'string') return '';
  const upper = code.trim().toUpperCase();
  if (upper.length !== 2) return upper;
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' });
    return dn.of(upper) || upper;
  } catch {
    return upper; // Intl/region table unavailable — return the code itself
  }
}

/**
 * Pull a valid 2-letter country code out of the proxy headers, or '' if none.
 */
function codeFromHeaders(req) {
  const headers = req?.headers || {};
  for (const h of COUNTRY_HEADERS) {
    const raw = headers[h];
    if (!raw) continue;
    const code = String(raw).trim().toUpperCase();
    if (code.length === 2 && /^[A-Z]{2}$/.test(code) && !PLACEHOLDER_CODES.has(code)) {
      return code;
    }
  }
  return '';
}

/**
 * Resolve the registrant's country from the request. NEVER throws.
 * Returns { code, name, source }:
 *   code:   ISO-3166 alpha-2 ('' when unknown/local)
 *   name:   human-readable country name ('Unknown' | 'Local' when no code)
 *   source: 'header' | 'geoip' | 'local' | 'none'
 */
export async function resolveCountry(req) {
  try {
    // 1. Proxy country header (most reliable in production behind CF/Vercel).
    const headerCode = codeFromHeaders(req);
    if (headerCode) {
      return { code: headerCode, name: countryNameFromCode(headerCode), source: 'header' };
    }

    const ip = getClientIp(req);

    // 3 (checked before the optional geoip step): private/loopback/empty IP.
    // A private IP can never be geolocated. We do NOT save the misleading literal
    // "Local" as the user's country (prompt30 Part 1) — return an empty name (the
    // caller persists it as 'Unknown') while still tagging source 'local' so
    // analytics can tell a local/private registration apart from a failed lookup.
    if (isPrivateIp(ip)) {
      return { code: '', name: '', source: 'local' };
    }

    // 2. OPTIONAL offline lookup — only if geoip-lite happens to be installed.
    const geoip = await loadGeoip();
    if (geoip && typeof geoip.lookup === 'function') {
      try {
        const hit = geoip.lookup(normalizeIp(ip));
        const code = hit?.country ? String(hit.country).trim().toUpperCase() : '';
        if (code && /^[A-Z]{2}$/.test(code)) {
          return { code, name: countryNameFromCode(code), source: 'geoip' };
        }
      } catch { /* lookup failed — fall through to unknown */ }
    }

    // 4. Public IP we could not resolve → Unknown. This means BOTH a proxy country
    // header AND the offline geoip DB were unavailable for a real public client —
    // the production misconfiguration that makes "everyone Unknown". Warn ONCE so it
    // is visible in logs without spamming (prompt32 observability).
    warnNoGeoSourceOnce();
    return { code: '', name: 'Unknown', source: 'none' };
  } catch {
    // Absolute backstop — geolocation must never break registration.
    return { code: '', name: 'Unknown', source: 'none' };
  }
}

/**
 * OPTIONAL salted SHA-256 of an IP. Uses JWT_SECRET as the salt so the digest
 * cannot be reversed via a precomputed rainbow table. Returns '' when there is
 * no IP. The raw IP is NEVER stored — only this hash, and only if the caller
 * chooses to persist it. Never throws.
 */
export function hashIp(ip) {
  try {
    const s = normalizeIp(ip);
    if (!s) return '';
    const salt = process.env.JWT_SECRET || 'metalab-geo-salt';
    return crypto.createHash('sha256').update(`${salt}:${s}`).digest('hex');
  } catch {
    return '';
  }
}
