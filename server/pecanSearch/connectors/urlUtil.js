/**
 * pecanSearch/connectors/urlUtil.js — safe URL construction for connectors.
 * All provider query parameters go through proper URL encoding (never string
 * concatenation of raw user input), closing the query/log/SSRF injection surface.
 */

/**
 * buildUrl(base, path, params) — compose a provider URL with encoded query params.
 * Null/undefined params are dropped; arrays repeat the key. Returns a string.
 *
 * The base host is fixed server-side configuration (never user-controlled), so
 * outbound requests can only reach configured providers (SSRF protection).
 */
export function buildUrl(base, path = '', params = {}) {
  const root = String(base || '').replace(/\/+$/, '');
  const p = String(path || '');
  const url = new URL(root + (p ? (p.startsWith('/') ? p : `/${p}`) : ''));
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    if (Array.isArray(v)) { for (const item of v) if (item != null) url.searchParams.append(k, String(item)); }
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}
