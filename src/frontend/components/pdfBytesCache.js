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
 *
 * ── VERSION PINS (116.md §74/§95, r3) ────────────────────────────────────────
 * `invalidate(url)` only fires in the tab that performed the replace, so it cannot
 * be the whole answer for a URL whose BYTES change while the URL does not. Screening
 * attachments are safe by construction (a replace remints the attachment id, so the
 * URL changes), but a STUDY-DOCUMENT URL is stable per study: when another member
 * replaces the file, this tab would serve its old bytes from memory on the next
 * mount — with no request, so the server's ETag/`must-revalidate` never gets a say —
 * while the annotation layer resolves the NEW content hash and paints the new
 * document's rectangles over the old document's pages. That is the "coordinates from
 * a different document" state §74 exists to prevent.
 *
 * So a caller that KNOWS what the URL should currently be serving pins it:
 *
 *     pinPdfBytesVersion(url, fileHash)   // "this URL now serves exactly this file"
 *
 * A cached entry that does not carry that version is dropped, and the entry fetched
 * afterwards is stamped with it — so the pin is a one-time refetch on a real change
 * and a plain cache hit on every revisit. Callers that know no version behave exactly
 * as before. The pin is a fact the caller has just learned from the server (the
 * document metadata it resolved the hash from), never a guess.
 */

const MAX_ENTRIES = 5;
const MAX_BYTES = 96 * 1024 * 1024;   // ~96 MB ceiling across all cached documents
const MAX_PINS = 64;                  // version pins are tiny; still bounded

/** url -> { promise, bytes, size, version } — Map preserves insertion order (LRU). */
const cache = new Map();
/** url -> version the caller last proved this URL serves. */
const pinned = new Map();
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
 * getPdfBytes(url, fetcher, { version }) → Promise<ArrayBuffer>
 *
 * `fetcher()` must resolve to an ArrayBuffer (or reject). A rejected fetch is
 * removed from the cache so the next mount retries rather than replaying a failure.
 * The returned buffer is a COPY: pdf.js transfers/detaches the buffer it is given,
 * which would otherwise poison every later cache hit.
 *
 * `version` (optional, §74/§95 r3) is the identity the caller expects these bytes to
 * have — a content hash. A cached entry stamped with a different one is not a hit.
 * Omitted, the URL's standing pin (`pinPdfBytesVersion`) applies; with neither, the
 * URL alone is the key, exactly as before.
 */
export function getPdfBytes(url, fetcher, { version = '' } = {}) {
  if (!url || typeof fetcher !== 'function') {
    return typeof fetcher === 'function' ? fetcher() : Promise.reject(new Error('no url'));
  }
  const want = String(version || pinned.get(url) || '');
  const hit = cache.get(url);
  if (hit && hit.version === want) {
    touch(url, hit);
    return hit.promise.then((buf) => buf.slice(0));
  }
  if (hit) invalidatePdfBytes(url);   // right URL, wrong document — refetch (§74)
  const entry = { size: 0, version: want };
  entry.promise = Promise.resolve()
    .then(() => fetcher())
    .then((buf) => {
      if (!buf || typeof buf.byteLength !== 'number') throw new Error('not bytes');
      // 116.md §95 (r3) — ONLY account for bytes that are still in the map. An entry
      // can leave it while its promise is in flight (an `invalidate` from a replace, an
      // `evict` triggered by a concurrent load); adding its size afterwards leaked the
      // whole document into `totalBytes` with no entry to subtract it again, and once
      // the leak passed MAX_BYTES `evict()` emptied the cache on EVERY later call —
      // §95's caching silently stopped working for the rest of the session.
      const mine = cache.get(url) === entry;
      // Never cache a single document larger than the whole ceiling.
      if (buf.byteLength > MAX_BYTES) { if (mine) cache.delete(url); return buf; }
      if (!mine) return buf;
      entry.size = buf.byteLength;
      totalBytes += entry.size;
      evict();
      return buf;
    })
    .catch((err) => {
      // Same rule on the failure path: only drop the entry if it is still OURS, so a
      // late failure cannot evict a newer, successful load of the same URL.
      if (cache.get(url) === entry) cache.delete(url);
      throw err;
    });
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

/**
 * pinPdfBytesVersion(url, version) — 116.md §74/§95 (r3).
 *
 * "As of now, this URL serves exactly this file." Drops any cached entry that was not
 * produced for that version, and makes the NEXT fetch of this URL carry it, so a
 * revisit is a normal cache hit and a replace by another member is a refetch. Called
 * from the surfaces that resolve a study document's content hash from the server
 * (usePdfSource, RobPdfPanel) — the only URLs whose bytes can change under a stable
 * URL. A missing url/version is a no-op.
 */
export function pinPdfBytesVersion(url, version) {
  const v = String(version || '');
  if (!url || !v) return;
  if (pinned.get(url) !== v) {
    pinned.set(url, v);
    if (pinned.size > MAX_PINS) {
      const oldest = pinned.keys().next();
      if (!oldest.done && oldest.value !== url) pinned.delete(oldest.value);
    }
  }
  const entry = cache.get(url);
  if (entry && entry.version !== v) invalidatePdfBytes(url);
}

/** Forget everything (sign-out / project switch). */
export function clearPdfBytesCache() {
  cache.clear();
  pinned.clear();
  totalBytes = 0;
}

/** Diagnostics + unit tests only. */
export function pdfBytesCacheStats() {
  return { entries: cache.size, bytes: totalBytes, pins: pinned.size, maxEntries: MAX_ENTRIES, maxBytes: MAX_BYTES };
}

export default { getPdfBytes, invalidatePdfBytes, pinPdfBytesVersion, clearPdfBytesCache, pdfBytesCacheStats };
