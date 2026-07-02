/**
 * features/publicSynthesis/publicSynthesisApi.js — 68.md (P8). Thin fetch clients
 * for the public-synthesis backend.
 *
 * Two surfaces:
 *  - synthesisApi: AUTHENTICATED authoring API (server/routes/publicSynthesis.js,
 *    mounted at /api/synthesis). Every call carries the session cookie, speaks
 *    JSON, and throws an Error carrying the server's { error } message (+ `.status`
 *    and `.body`) so the panel can surface 403 TIER_LIMIT bodies honestly.
 *  - publicApi: the PUBLIC, UNAUTHENTICATED read helpers (server/routes/publicView.js,
 *    mounted at /api/public). Used by PublicSynthesisPage to fetch a token payload,
 *    and to build the download / QR / share / embed URLs shown to owners.
 *
 * No synthesis logic lives here — only the contract wire-up. Response shapes are
 * exactly what publicSynthesisController.js / publicView.js return.
 */

const AUTH_BASE = '/api/synthesis';
const PUBLIC_BASE = '/api/public';
const enc = encodeURIComponent;

/** Authenticated JSON request; throws on !ok with the server's message + body. */
async function authReq(path, { method = 'GET', body, signal } = {}) {
  const opts = { method, credentials: 'include', headers: { Accept: 'application/json' }, signal };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${AUTH_BASE}${path}`, opts);
  let payload = null;
  try { payload = await res.json(); } catch { /* empty/non-JSON body */ }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Request failed (${res.status})`);
    err.status = res.status;
    err.body = payload;
    throw err;
  }
  return payload;
}

export const synthesisApi = {
  /** GET status: { published, embedEnabled, shareToken, settings, versions, publishedByName, currentVersion, canManage }. */
  status: (mlpid) => authReq(`/${enc(mlpid)}/status`),
  /** PUT { settings, embedEnabled? } — persist section toggles / branding / download / embed. */
  saveSettings: (mlpid, settings, embedEnabled) =>
    authReq(`/${enc(mlpid)}/settings`, { method: 'PUT', body: { settings, ...(typeof embedEnabled === 'boolean' ? { embedEnabled } : {}) } }),
  /** POST { settings } — snapshot the current sanitized payload into a new version + enable. */
  publish: (mlpid, settings) => authReq(`/${enc(mlpid)}/publish`, { method: 'POST', body: { settings } }),
  /** POST — disable public access (token kept). */
  unpublish: (mlpid) => authReq(`/${enc(mlpid)}/unpublish`, { method: 'POST', body: {} }),
  /** POST — mint a new share token (old links break). */
  regenerateToken: (mlpid) => authReq(`/${enc(mlpid)}/regenerate-token`, { method: 'POST', body: {} }),
  /** GET { payload } — build the sanitized payload WITHOUT persisting (for the preview modal). */
  preview: (mlpid) => authReq(`/${enc(mlpid)}/preview`),
  /** GET { id, name, cards } — the composer layout. */
  getDashboard: (mlpid) => authReq(`/${enc(mlpid)}/dashboard`),
  /** PUT { name?, cards } — save the composer layout (card types whitelisted server-side). */
  putDashboard: (mlpid, { name, cards }) =>
    authReq(`/${enc(mlpid)}/dashboard`, { method: 'PUT', body: { name, cards } }),
};

/** Fetch a published payload by public token. Throws on !ok (404 = not available). */
export async function fetchPublicSynthesis(token, { signal } = {}) {
  const res = await fetch(`${PUBLIC_BASE}/synthesis/${enc(token)}`, { signal });
  let payload = null;
  try { payload = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error((payload && payload.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload; // { payload, version, publishedAt, settings }
}

/** Same-origin prefix (empty in a non-browser context so URLs stay relative). */
function origin() {
  try { return (typeof location !== 'undefined' && location.origin) ? location.origin : ''; }
  catch { return ''; }
}

/** Public URLs (same-origin) an owner copies / links to. */
export const publicUrls = {
  page: (token) => `${origin()}/public/synthesis/${enc(token)}`,
  embed: (token) => `${origin()}/embed/synthesis/${enc(token)}`,
  exportJson: (token) => `${PUBLIC_BASE}/synthesis/${enc(token)}/export.json`,
  exportCsv: (token) => `${PUBLIC_BASE}/synthesis/${enc(token)}/export.csv`,
  qr: (token) => `${PUBLIC_BASE}/synthesis/${enc(token)}/qr.png`,
};

/** The iframe embed snippet an owner pastes into their site. */
export function embedSnippet(token) {
  return `<iframe src="${publicUrls.embed(token)}" width="100%" height="720" style="border:0;border-radius:12px" loading="lazy"></iframe>`;
}

export default synthesisApi;
