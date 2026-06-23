/**
 * pecanSearch/redact.js — secret + PII redaction for logs, errors, and telemetry.
 *
 * The engine talks to external providers with server-side API keys (some passed
 * as URL query params, e.g. NCBI `api_key`). Those values must NEVER reach a log
 * line, an error message, an audit entry, a job payload, or a response body.
 *
 * Pure, dependency-free, and defensive: redaction must itself never throw.
 */

// Query-parameter names whose values are always secret/sensitive.
const SENSITIVE_PARAMS = new Set([
  'api_key', 'apikey', 'apikey', 'key', 'token', 'access_token', 'auth',
  'authorization', 'password', 'secret', 'email', 'mailto', 'x-api-key',
]);

// Header names that must be redacted entirely.
const SENSITIVE_HEADERS = new Set([
  'authorization', 'x-api-key', 'api-key', 'cookie', 'set-cookie', 'proxy-authorization',
]);

/**
 * redactUrl — strip the values of sensitive query params from a URL, leaving the
 * shape intact for debugging (e.g. `…?api_key=***&term=cancer`). Never throws;
 * returns the input unchanged if it cannot be parsed.
 */
export function redactUrl(input) {
  const raw = String(input == null ? '' : input);
  try {
    const u = new URL(raw);
    for (const [k] of u.searchParams) {
      if (SENSITIVE_PARAMS.has(k.toLowerCase())) u.searchParams.set(k, '***');
    }
    return u.toString();
  } catch {
    // Not an absolute URL — do a best-effort regex pass on a query string.
    return raw.replace(/([?&](?:api_key|apikey|key|token|access_token|auth|email|mailto|secret)=)[^&#\s]*/gi, '$1***');
  }
}

/** Redact a headers object (or Headers instance) for logging. */
export function redactHeaders(headers) {
  const out = {};
  try {
    const entries = headers && typeof headers.forEach === 'function'
      ? (() => { const e = []; headers.forEach((v, k) => e.push([k, v])); return e; })()
      : Object.entries(headers || {});
    for (const [k, v] of entries) {
      out[k] = SENSITIVE_HEADERS.has(String(k).toLowerCase()) ? '***' : v;
    }
  } catch { /* best-effort */ }
  return out;
}

/**
 * redactSecrets — replace every occurrence of each known secret VALUE in a string
 * with `***`. Use when a secret value might have been interpolated somewhere we
 * don't fully control (defense in depth on top of redactUrl/redactHeaders).
 *
 * @param {string} text
 * @param {string[]} secrets  the actual secret values to scrub (e.g. the API keys)
 */
export function redactSecrets(text, secrets = []) {
  let s = String(text == null ? '' : text);
  for (const secret of secrets) {
    const v = String(secret || '');
    if (v.length >= 4) s = s.split(v).join('***'); // length guard avoids redacting trivial tokens
  }
  return s;
}

/**
 * sanitizeErrorDetail — produce a short, secret-free, user-displayable error
 * string from any thrown value. Caps length and scrubs any provided secrets.
 *
 * @param {unknown} err
 * @param {string[]} [secrets]
 * @param {number} [max]
 */
export function sanitizeErrorDetail(err, secrets = [], max = 500) {
  let msg = '';
  if (err instanceof Error) msg = err.message || err.name || 'Error';
  else if (typeof err === 'string') msg = err;
  else { try { msg = JSON.stringify(err); } catch { msg = String(err); } }
  msg = redactUrl(redactSecrets(msg, secrets));
  return msg.slice(0, max);
}
