/**
 * server/security/cspReport.js — first-party CSP violation reporting endpoint
 * (prompt 51).
 *
 * Browsers POST a violation report (legacy `application/csp-report` body
 * `{"csp-report": {...}}`, or the modern Reporting API `application/reports+json`
 * array `[{type:'csp-violation', body:{...}}]`). This module sanitizes the
 * report to a small, safe shape and logs ONE compact line through the existing
 * console-based observability — it never builds a database, never reflects
 * report content into a response, and deliberately drops anything that could
 * carry secrets or user data (query strings, fragments, `script-sample`,
 * cookies, auth headers, path-embedded tokens).
 *
 * The route is mounted BEFORE the maintenance gate, the global JSON body parser
 * and every authenticated router (see server/index.js), so reports always flow,
 * carry no CSRF/auth assumptions, and use a tight 16KB body limit + rate limit.
 */

import { getVersion } from '../version.js';

const MAX_FIELD = 512;

// Strip C0/C1 control characters (incl. CR/LF/TAB) BEFORE logging — a report is
// unauthenticated, attacker-controlled input, so raw newlines would let it forge
// extra log lines (CWE-117 log injection). Then bound the length.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
function clip(v, n = 64) {
  if (v == null) return '';
  return String(v).replace(CONTROL_CHARS, ' ').slice(0, n);
}

// Redact opaque high-entropy path segments (e.g. /invite/<32-byte CSPRNG token>,
// a single-use bearer token) so a violation that fires on such a page does not
// deposit the secret into logs. The route shape stays useful for diagnosis.
function redactPath(pathname) {
  return String(pathname)
    .split('/')
    .map((seg) => (/^[A-Za-z0-9_-]{20,}$/.test(seg) ? '<redacted>' : seg))
    .join('/');
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Redact a URL down to origin + path, with query/fragment/userinfo stripped and
 * high-entropy path tokens redacted. Non-URL values (inline, eval, blob:…,
 * data:…) collapse to a scheme/sentinel. Control chars are always stripped.
 * @param {unknown} u
 * @returns {string}
 */
export function sanitizeUrl(u) {
  if (typeof u !== 'string' || !u) return '';
  // Keep scheme-only sentinels intact (inline, eval, wasm-eval).
  if (/^(inline|eval|wasm-eval)$/i.test(u)) return u.toLowerCase();
  try {
    const url = new URL(u);
    // blob:/data: can embed an origin or payload in the "path" — keep only the
    // scheme, which is all that is useful for diagnosing the violation.
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol;
    return clip(`${url.protocol}//${url.host}${redactPath(url.pathname)}`, MAX_FIELD);
  } catch {
    return clip(String(u).split(/[?#]/)[0], MAX_FIELD);
  }
}

/** True for the browser-extension origins that generate benign CSP noise. */
export function isExtensionNoise(blockedUri) {
  return /^(chrome|moz|safari-web|safari|webkit-masked-url|about)/i.test(String(blockedUri || ''));
}

/**
 * Reduce a raw report body (either wire format) to a small, safe object, or
 * null if it is not a recognizable report. Never includes `script-sample`,
 * raw URLs with query strings, or any header/cookie data.
 * @param {unknown} body
 * @returns {null | {
 *   effectiveDirective:string, blockedUri:string, documentUri:string,
 *   sourceFile:string, lineNumber:(number|null), columnNumber:(number|null),
 *   disposition:string, statusCode:(number|null)
 * }}
 */
export function sanitizeCspReport(body) {
  let r = null;
  if (body && typeof body === 'object') {
    if (body['csp-report'] && typeof body['csp-report'] === 'object') {
      r = body['csp-report']; // legacy application/csp-report
    } else if (Array.isArray(body)) {
      const first = body.find((x) => x && (x.type === 'csp-violation' || x.body));
      r = first ? (first.body || first) : null; // Reporting API array
    } else if (body.type === 'csp-violation' && body.body) {
      r = body.body;
    } else if (body['effective-directive'] || body.effectiveDirective ||
               body['violated-directive'] || body.violatedDirective) {
      r = body; // already a bare report object
    }
  }
  if (!r || typeof r !== 'object') return null;

  const get = (...keys) => {
    for (const k of keys) if (r[k] != null && r[k] !== '') return r[k];
    return undefined;
  };

  const effectiveDirective = clip(get('effectiveDirective', 'effective-directive', 'violatedDirective', 'violated-directive'), 64);
  if (!effectiveDirective) return null;

  return {
    effectiveDirective,
    blockedUri: sanitizeUrl(get('blockedURL', 'blocked-uri', 'blockedUri')),
    documentUri: sanitizeUrl(get('documentURL', 'document-uri', 'documentUri')),
    sourceFile: sanitizeUrl(get('sourceFile', 'source-file')),
    lineNumber: numOrNull(get('lineNumber', 'line-number')),
    columnNumber: numOrNull(get('columnNumber', 'column-number')),
    disposition: clip(get('disposition'), 16),
    statusCode: numOrNull(get('statusCode', 'status-code')),
  };
}

/**
 * Express handler: sanitize, classify extension noise, log one compact line,
 * and return 204. Never throws, never reflects input.
 */
export function cspReportHandler(req, res) {
  try {
    const safe = sanitizeCspReport(req.body);
    if (safe) {
      let version = 'unknown';
      try { version = getVersion().version; } catch { /* non-fatal */ }
      const tag = isExtensionNoise(safe.blockedUri) ? ' [ext-noise]' : '';
      console.warn(
        `[csp-report]${tag} dir=${safe.effectiveDirective} ` +
        `blocked=${safe.blockedUri || '-'} doc=${safe.documentUri || '-'} ` +
        `src=${safe.sourceFile || '-'}:${safe.lineNumber ?? '?'}:${safe.columnNumber ?? '?'} ` +
        `disp=${safe.disposition || '-'} v=${version}`
      );
    }
  } catch { /* a report must never break the server */ }
  return res.status(204).end();
}
