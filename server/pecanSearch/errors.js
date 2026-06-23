/**
 * pecanSearch/errors.js — typed error taxonomy for the Pecan Search Engine (P1).
 *
 * Every failure in the engine is represented by a PecanError carrying:
 *   - code:        a stable internal error code (string, see ERROR_CODES)
 *   - userMessage: a user-safe message (NEVER contains secrets or internals)
 *   - retryable:   whether retrying the same operation could succeed
 *   - httpStatus:  the status to use when surfaced through REST
 *   - meta:        small structured metadata (provider, runId, …) — sanitized
 *
 * Connectors classify provider HTTP failures via classifyHttpError(); the worker
 * uses isRetryable() to decide between a backoff-retry and a terminal per-source
 * failure (honest partial success — one bad source never fails the whole run).
 *
 * Design rule: the *user-safe* surface (userMessage + httpStatus) is always safe
 * to expose; the *diagnostic* surface (message, cause, raw provider body) is for
 * sanitized server logs only and is never serialized to the browser.
 */

/**
 * The canonical error catalogue. `http` is the REST status when exposed;
 * `retryable` is the default retry classification (a connector may override per
 * instance, e.g. a 400 that is actually a transient gateway error).
 */
export const ERROR_CODES = Object.freeze({
  PROVIDER_CREDENTIALS_MISSING: { http: 503, retryable: false, user: 'This source needs credentials that are not configured. An administrator must add them.' },
  PROVIDER_DISABLED:            { http: 404, retryable: false, user: 'This source is not available.' },
  INVALID_QUERY:                { http: 400, retryable: false, user: 'The search query is invalid for this source.' },
  UNSUPPORTED_CLAUSE:           { http: 400, retryable: false, user: 'The search query uses a feature this source does not support.' },
  PROVIDER_AUTH_FAILED:         { http: 502, retryable: false, user: 'The source rejected our credentials.' },
  PROVIDER_RATE_LIMITED:        { http: 503, retryable: true,  user: 'The source is rate-limiting requests. We will retry shortly.' },
  PROVIDER_UNAVAILABLE:         { http: 503, retryable: true,  user: 'The source is temporarily unavailable. We will retry shortly.' },
  PROVIDER_TIMEOUT:             { http: 504, retryable: true,  user: 'The source did not respond in time. We will retry shortly.' },
  PROVIDER_MALFORMED_RESPONSE:  { http: 502, retryable: true,  user: 'The source returned an unexpected response.' },
  RESPONSE_TOO_LARGE:           { http: 502, retryable: false, user: 'The source returned more data than we can safely process.' },
  RESULT_CAP_REACHED:           { http: 200, retryable: false, user: 'The configured result cap was reached for this source.' },
  SEARCH_CANCELLED:             { http: 200, retryable: false, user: 'The search was cancelled.' },
  DB_WRITE_FAILED:              { http: 500, retryable: true,  user: 'A temporary problem occurred while saving results. We will retry.' },
  NORMALIZATION_FAILED:         { http: 500, retryable: false, user: 'A record could not be processed and was skipped.' },
  DEDUP_FAILED:                 { http: 500, retryable: false, user: 'A problem occurred while checking for duplicates.' },
  AUTHORIZATION_FAILED:         { http: 403, retryable: false, user: 'You do not have access to this resource.' },
  QUOTA_EXCEEDED:               { http: 429, retryable: false, user: 'You have reached a usage limit. Please try again later.' },
  WORKER_UNAVAILABLE:           { http: 503, retryable: true,  user: 'The search service is busy. Your search is queued and will start shortly.' },
  CONFIG_INVALID:               { http: 500, retryable: false, user: 'The search engine is misconfigured. Contact an administrator.' },
  UNKNOWN:                      { http: 500, retryable: false, user: 'An unexpected error occurred.' },
});

export class PecanError extends Error {
  /**
   * @param {string} code   one of ERROR_CODES
   * @param {object} [opts] { message, userMessage, retryable, httpStatus, meta, cause }
   */
  constructor(code, opts = {}) {
    const spec = ERROR_CODES[code] || ERROR_CODES.UNKNOWN;
    super(opts.message || spec.user || code);
    this.name = 'PecanError';
    this.code = ERROR_CODES[code] ? code : 'UNKNOWN';
    this.userMessage = opts.userMessage || spec.user || 'An unexpected error occurred.';
    this.retryable = typeof opts.retryable === 'boolean' ? opts.retryable : !!spec.retryable;
    this.httpStatus = Number.isInteger(opts.httpStatus) ? opts.httpStatus : spec.http;
    this.meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : {};
    if (opts.cause) this.cause = opts.cause;
  }

  /** A user-safe, secret-free JSON shape for REST responses. */
  toResponse() {
    return { error: this.userMessage, code: this.code, retryable: this.retryable };
  }
}

/** Convenience factory. */
export function pecanError(code, opts) {
  return new PecanError(code, opts);
}

/** True when an error (PecanError or otherwise) is worth retrying. */
export function isRetryable(err) {
  if (err instanceof PecanError) return err.retryable;
  // Native fetch abort / network errors are generally transient.
  const name = err && (err.name || '');
  return name === 'AbortError' || name === 'FetchError' || name === 'TypeError';
}

/**
 * Map a provider HTTP status (and optional Retry-After) to a typed error code.
 * Used by the shared HTTP client + connectors so retry semantics are consistent
 * across every provider.
 *
 * @param {number} status
 * @param {object} [opts] { retryAfterMs }
 * @returns {string} an ERROR_CODES key
 */
export function classifyHttpStatus(status) {
  const s = Number(status) || 0;
  if (s === 401 || s === 403) return 'PROVIDER_AUTH_FAILED';
  if (s === 429) return 'PROVIDER_RATE_LIMITED';
  if (s === 408 || s === 504 || s === 522 || s === 524) return 'PROVIDER_TIMEOUT';
  if (s === 400 || s === 422) return 'INVALID_QUERY';
  if (s >= 500) return 'PROVIDER_UNAVAILABLE';
  if (s >= 400) return 'PROVIDER_UNAVAILABLE';
  return 'UNKNOWN';
}

/** Coerce any thrown value into a PecanError (used at the worker/route boundary). */
export function toPecanError(err, fallbackCode = 'UNKNOWN') {
  if (err instanceof PecanError) return err;
  if (err && err.name === 'AbortError') {
    return new PecanError('PROVIDER_TIMEOUT', { message: 'request aborted', cause: err });
  }
  return new PecanError(fallbackCode, { message: err && err.message ? String(err.message) : String(err), cause: err });
}
