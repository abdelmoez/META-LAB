/**
 * server/utils/fetchTimeout.js — bounded outbound HTTP (93.md Phase 10).
 *
 * Every outbound fetch to a third-party provider (Unpaywall, OpenAlex, CrossRef,
 * OA PDF CDNs, …) MUST be time-bounded: a hung upstream socket would otherwise
 * pin a request handler (and, in a loop, the whole worker) forever. Two budgets:
 *
 *   METADATA_TIMEOUT_MS (15s) — small JSON metadata lookups. Providers answer in
 *     well under a second when healthy; 15s is generous for a slow day and short
 *     enough that a wedged provider can't stall a 25-record OA batch for minutes.
 *   DOWNLOAD_TIMEOUT_MS (60s) — full PDF byte downloads (tens of MB from
 *     variable-speed OA hosts). Tunable via OA_METADATA_TIMEOUT_MS /
 *     OA_DOWNLOAD_TIMEOUT_MS where the caller reads its config.
 *
 * `readBodyCapped` additionally enforces a byte cap DURING streaming: previously
 * the whole body was buffered via arrayBuffer() and only then compared against
 * maxBytes — a hostile/misconfigured host could push hundreds of MB into memory
 * before the check ran. Here we read the web stream chunk-by-chunk and cancel
 * the moment the cap is crossed. Falls back to arrayBuffer() (with the same
 * post-hoc cap) when the response has no readable body (mocked fetch in tests,
 * exotic runtimes) so error semantics never change for existing callers.
 */

export const METADATA_TIMEOUT_MS = 15_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * AbortSignal that fires after `ms`. Wrapped in try/catch so environments
 * without AbortSignal.timeout (or a mocked global) degrade to "no timeout"
 * instead of throwing — a missing bound must never break a working fetch.
 */
export function timeoutSignal(ms) {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

/**
 * Human-readable message for a failed fetch, mapping the DOMException noise of
 * an AbortSignal.timeout firing ("TimeoutError"/"AbortError") to a clear
 * "timed out after Ns"; anything else keeps its original message.
 */
export function describeFetchError(err, timeoutMs) {
  const names = err ? [err.name, err.cause && err.cause.name] : [];
  if (names.includes('TimeoutError') || names.includes('AbortError')) {
    return `timed out after ${Math.round((timeoutMs || 0) / 1000)}s`;
  }
  return (err && err.message) ? err.message : String(err);
}

/**
 * Read a fetch Response body into a Buffer, enforcing `maxBytes` WHILE
 * streaming. Returns { ok:true, buffer } or { ok:false, error } — never throws
 * (the callers' contract is thrown-nothing / null-return error semantics).
 *
 * The cap error string is exactly 'PDF exceeds size limit' to preserve the
 * message existing callers (and their tests/UI copy) already surface.
 */
export async function readBodyCapped(res, maxBytes) {
  const body = res && res.body;
  if (!body || typeof body.getReader !== 'function') {
    // No web stream available (unit-test fetch mocks return plain objects) →
    // legacy buffered path with the same post-hoc cap.
    try {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) return { ok: false, error: 'PDF exceeds size limit' };
      return { ok: true, buffer: buf };
    } catch (e) {
      return { ok: false, error: `download failed: ${e && e.message ? e.message : e}` };
    }
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength != null ? value.byteLength : value.length || 0;
        if (total > maxBytes) {
          // Stop pulling bytes immediately; cancel() releases the connection.
          try { await reader.cancel(); } catch { /* already closed */ }
          return { ok: false, error: 'PDF exceeds size limit' };
        }
        chunks.push(Buffer.from(value));
      }
    }
    return { ok: true, buffer: Buffer.concat(chunks) };
  } catch (e) {
    try { await reader.cancel(); } catch { /* best-effort */ }
    return { ok: false, error: `download failed: ${describeFetchError(e, DOWNLOAD_TIMEOUT_MS)}` };
  }
}
