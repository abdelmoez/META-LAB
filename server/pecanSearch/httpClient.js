/**
 * pecanSearch/httpClient.js — the single, hardened external-API client used by
 * EVERY connector. No connector calls fetch directly; this is the one place that
 * talks to the outside world, so timeouts, retries, rate-limit etiquette, size
 * limits, the circuit breaker, correlation IDs, and log redaction are uniform.
 *
 * Dependency-injected (fetch, now, sleep, random, logger) so it is fully
 * deterministic under test — the connector contract tests drive it with a mock
 * fetch + a fixed clock and never touch the network.
 *
 * Guarantees:
 *   - Per-request timeout via AbortController (never hangs a worker).
 *   - Max response size guard (content-length AND post-read byte check) → never
 *     loads an unbounded provider response into memory (OOM protection).
 *   - Retry-After honored; exponential backoff + jitter on transient failures
 *     (429/5xx/timeout/network) up to retryLimit; non-retryable codes fail fast.
 *   - Per-host circuit breaker: after N consecutive failures the host is "open"
 *     and requests fail fast for a cooldown, shedding load from a sick provider.
 *   - Correlation id per logical request, propagated into logs.
 *   - Secrets in the URL (e.g. NCBI api_key) and headers are redacted before any
 *     log line; raw bodies are never logged.
 */
import { PecanError, classifyHttpStatus, toPecanError } from './errors.js';
import { redactUrl, redactHeaders } from './redact.js';

const DEFAULT_BREAKER = Object.freeze({ threshold: 5, cooldownMs: 30000 });

function hostOf(url) {
  try { return new URL(url).host; } catch { return 'unknown'; }
}

/** Parse a Retry-After header (seconds or HTTP-date) into milliseconds, or null. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Math.max(0, parseInt(s, 10) * 1000);
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return Math.max(0, t - now);
  return null;
}

/** Read a response body as text, capped at maxBytes. Works with real + mock fetch. */
async function readCapped(res, maxBytes) {
  // Fast reject on a declared oversize body.
  const len = res.headers && typeof res.headers.get === 'function' ? Number(res.headers.get('content-length')) : NaN;
  if (Number.isFinite(len) && len > maxBytes) {
    throw new PecanError('RESPONSE_TOO_LARGE', { meta: { declared: len, maxBytes } });
  }
  // Prefer streaming so we can abort mid-body on a lying/absent content-length.
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new PecanError('RESPONSE_TOO_LARGE', { meta: { read: total, maxBytes } });
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  }
  // Mock/simple fetch: read text then enforce the cap.
  const text = await res.text();
  if (typeof text === 'string' && Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new PecanError('RESPONSE_TOO_LARGE', { meta: { maxBytes } });
  }
  return text;
}

/**
 * createHttpClient(deps) → { requestJson, requestText, breakerState }
 *
 * @param {object} deps
 *   fetch    — fetch implementation (default global fetch)
 *   now      — () => epoch ms (default Date.now)
 *   sleep    — (ms) => Promise (default setTimeout)
 *   random   — () => [0,1) (default Math.random) — jitter source (DI for tests)
 *   logger   — { debug, warn } (default console-ish; debug is a no-op unless verbose)
 *   secrets  — string[] of secret values to scrub from any logged message
 *   breaker  — { threshold, cooldownMs }
 */
export function createHttpClient(deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random || Math.random;
  const logger = deps.logger || { debug() {}, warn(...a) { console.warn(...a); } };
  const breakerCfg = { ...DEFAULT_BREAKER, ...(deps.breaker || {}) };
  const breakers = new Map(); // host -> { failures, openUntil }

  function breakerFor(host) {
    let b = breakers.get(host);
    if (!b) { b = { failures: 0, openUntil: 0 }; breakers.set(host, b); }
    return b;
  }
  function onSuccess(host) { const b = breakerFor(host); b.failures = 0; b.openUntil = 0; }
  function onFailure(host) {
    const b = breakerFor(host);
    b.failures += 1;
    if (b.failures >= breakerCfg.threshold) b.openUntil = now() + breakerCfg.cooldownMs;
  }

  function backoffMs(attempt, retryAfterMs) {
    if (Number.isFinite(retryAfterMs)) return Math.min(retryAfterMs, 60000);
    const base = Math.min(1000 * 2 ** attempt, 16000);     // 1s,2s,4s,8s,16s…
    const jitter = base * 0.25 * random();                  // ±25% jitter
    return Math.round(base + jitter);
  }

  /**
   * request — perform a single logical request with retries. Returns
   * { status, headers, text } or throws a PecanError. Internal; callers use
   * requestJson / requestText.
   */
  async function request(url, opts = {}) {
    const {
      method = 'GET', headers = {}, body = null, timeoutMs = 20000,
      maxBytes = 25 * 1024 * 1024, retryLimit = 4, signal: externalSignal = null,
      correlationId = null, provider = '',
    } = opts;
    const host = hostOf(url);
    const cid = correlationId || `pq_${Math.floor(now()).toString(36)}_${Math.floor(random() * 1e6).toString(36)}`;

    let attempt = 0;
    for (;;) {
      // Circuit breaker: fail fast while the host is open.
      const b = breakerFor(host);
      if (b.openUntil && now() < b.openUntil) {
        throw new PecanError('PROVIDER_UNAVAILABLE', {
          message: `circuit open for ${host}`, meta: { provider, host, cid },
        });
      }
      // Honor an upstream cancellation immediately.
      if (externalSignal && externalSignal.aborted) {
        throw new PecanError('SEARCH_CANCELLED', { meta: { provider, cid } });
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (externalSignal) externalSignal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res;
      try {
        res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
      } catch (err) {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
        // Distinguish an upstream cancel from a timeout/network error.
        if (externalSignal && externalSignal.aborted) {
          throw new PecanError('SEARCH_CANCELLED', { meta: { provider, cid } });
        }
        onFailure(host);
        const e = err && err.name === 'AbortError'
          ? new PecanError('PROVIDER_TIMEOUT', { meta: { provider, host, cid, timeoutMs }, cause: err })
          : new PecanError('PROVIDER_UNAVAILABLE', { meta: { provider, host, cid }, cause: err });
        if (attempt < retryLimit && e.retryable) {
          const wait = backoffMs(attempt, null);
          logger.warn(`[pecan-http] ${provider} ${redactUrl(url)} → ${e.code}; retry ${attempt + 1}/${retryLimit} in ${wait}ms (cid=${cid})`);
          attempt += 1; await sleep(wait); continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
        if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      }

      // HTTP-level result.
      if (res.ok) {
        let text;
        try { text = await readCapped(res, maxBytes); }
        catch (err) { onFailure(host); throw toPecanError(err, 'PROVIDER_MALFORMED_RESPONSE'); }
        onSuccess(host);
        return { status: res.status, headers: res.headers, text, correlationId: cid };
      }

      // Non-2xx: classify and decide retry.
      const code = classifyHttpStatus(res.status);
      const retryAfterMs = parseRetryAfter(res.headers && res.headers.get && res.headers.get('retry-after'), now());
      const err = new PecanError(code, {
        message: `${provider || host} responded ${res.status}`,
        meta: { provider, host, cid, status: res.status, retryAfterMs },
      });
      // Drain the error body within the cap so the socket frees (best-effort).
      try { await readCapped(res, Math.min(maxBytes, 64 * 1024)); } catch { /* ignore */ }

      onFailure(host);
      if (attempt < retryLimit && err.retryable) {
        const wait = backoffMs(attempt, retryAfterMs);
        logger.warn(`[pecan-http] ${provider} ${redactUrl(url)} → ${res.status} ${code}; retry ${attempt + 1}/${retryLimit} in ${wait}ms (cid=${cid})`);
        attempt += 1; await sleep(wait); continue;
      }
      throw err;
    }
  }

  /** GET/POST and parse JSON. Throws PROVIDER_MALFORMED_RESPONSE on bad JSON. */
  async function requestJson(url, opts = {}) {
    const r = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    try {
      return { ...r, json: r.text ? JSON.parse(r.text) : null };
    } catch (err) {
      throw new PecanError('PROVIDER_MALFORMED_RESPONSE', {
        message: 'invalid JSON', meta: { provider: opts.provider || '', cid: r.correlationId }, cause: err,
      });
    }
  }

  /** GET/POST and return raw text (e.g. PubMed efetch XML). */
  async function requestText(url, opts = {}) {
    return request(url, opts);
  }

  return {
    requestJson,
    requestText,
    /** Diagnostics: snapshot the circuit-breaker state per host. */
    breakerState() {
      const out = {};
      for (const [host, b] of breakers) out[host] = { failures: b.failures, open: b.openUntil > now() };
      return out;
    },
    _redactHeaders: redactHeaders,
  };
}
