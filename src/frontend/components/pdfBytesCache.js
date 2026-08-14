/**
 * pdfBytesCache.js — 116.md §95. A tiny, SESSION-ONLY cache of already-downloaded
 * PDF bytes, shared by every mount of AppPdfViewer in the tab.
 *
 * THE PROBLEM IT SOLVES. AppPdfViewer fetches the whole file on every mount, and
 * every consumer mounts it with `key={url}` — so Screening → Conflict → Extraction
 * for the SAME paper re-downloads the same bytes three times, and going back
 * downloads them again. The server side of the fix is a validated ETag/304 on the
 * binary routes; this is the client side, for the case where the browser did not
 * keep the response (large PDFs are routinely evicted from the HTTP cache).
 *
 * WHY IT IS NOT AN "INSECURE PERSISTENT CACHE" (§95 explicitly warns):
 *   - it is a module-level JS Map, so it dies with the tab. Nothing is written to
 *     localStorage, IndexedDB, the Cache API or the disk;
 *   - it is keyed by the AUTHENTICATED URL, and only ever populated by a fetch that
 *     the current session already succeeded on. A sign-out reloads the SPA, which
 *     drops the module;
 *   - it stores at most MAX_ENTRIES documents and evicts the least-recently-used,
 *     so a long session cannot grow without bound;
 *   - `invalidate(url)` is called whenever a document is replaced/removed, and
 *     `clear()` on sign-out surfaces, so stale bytes can never outlive their row.
 *
 * Eviction policy: strict LRU over MAX_ENTRIES entries, plus a total byte ceiling
 * (MAX_BYTES) so five 40 MB files cannot pin ~200 MB of tab memory. An in-flight
 * promise is cached too, so two components mounting the same URL in the same frame
 * share ONE network request instead of racing.
 */

const MAX_ENTRIES = 5;
const MAX_BYTES = 96 * 1024 * 1024;   // ~96 MB ceiling across all cached documents

/** url -> { promise, bytes, size } — Map preserves insertion order (our LRU list). */
const cache = new Map();
let totalBytes = 0;

function touch(url, entry) {
  cache.delete(url);
  cache.set(url, entry);          // re-inserting moves it to the "most recent" end
}

function evict() {
  while (cache.size > MAX_ENTRIES || totalBytes > MAX_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const entry = cache.get(oldest.value);
    cache.delete(oldest.value);
    totalBytes -= (entry && entry.size) || 0;
    if (totalBytes < 0) totalBytes = 0;
  }
}

/**
 * getPdfBytes(url, fetcher) → Promise<ArrayBuffer>
 *
 * `fetcher()` must resolve to an ArrayBuffer (or reject). A rejected fetch is
 * removed from the cache so the next mount retries rather than replaying a failure.
 * The returned buffer is a COPY: pdf.js transfers/detaches the buffer it is given,
 * which would otherwise poison every later cache hit.
 */
export function getPdfBytes(url, fetcher) {
  if (!url || typeof fetcher !== 'function') {
    return typeof fetcher === 'function' ? fetcher() : Promise.reject(new Error('no url'));
  }
  const hit = cache.get(url);
  if (hit) {
    touch(url, hit);
    return hit.promise.then((buf) => buf.slice(0));
  }
  const entry = { size: 0 };
  entry.promise = Promise.resolve()
    .then(() => fetcher())
    .then((buf) => {
      if (!buf || typeof buf.byteLength !== 'number') throw new Error('not bytes');
      // Never cache a single document larger than the whole ceiling.
      if (buf.byteLength > MAX_BYTES) { cache.delete(url); return buf; }
      entry.size = buf.byteLength;
      totalBytes += entry.size;
      evict();
      return buf;
    })
    .catch((err) => { cache.delete(url); throw err; });
  cache.set(url, entry);
  evict();
  return entry.promise.then((buf) => buf.slice(0));
}

/** Forget one document (called when its bytes are replaced or removed). */
export function invalidatePdfBytes(url) {
  const entry = cache.get(url);
  if (!entry) return;
  cache.delete(url);
  totalBytes -= entry.size || 0;
  if (totalBytes < 0) totalBytes = 0;
}

/** Forget everything (sign-out / project switch). */
export function clearPdfBytesCache() {
  cache.clear();
  totalBytes = 0;
}

/** Diagnostics + unit tests only. */
export function pdfBytesCacheStats() {
  return { entries: cache.size, bytes: totalBytes, maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES };
}

export default { getPdfBytes, invalidatePdfBytes, clearPdfBytesCache, pdfBytesCacheStats };
