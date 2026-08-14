/**
 * pdfBytesCache.test.js — 116.md §95 (PDF caching).
 *
 * The client half of "avoid repeated unnecessary downloads when navigating between
 * Screening, Conflict and Extraction for the same file in the same session", and the
 * proof that it is NOT the "insecure persistent caching" §95 warns against:
 *   - memory only (a module-level Map — nothing here can reach localStorage/IndexedDB);
 *   - bounded by entry count AND total bytes, LRU-evicted;
 *   - a failed fetch is never cached, so Retry really retries;
 *   - `invalidate` / `clear` exist and are called on replace / sign-out;
 *   - every hand-out is a COPY, because pdf.js detaches the buffer it is given.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getPdfBytes, invalidatePdfBytes, pinPdfBytesVersion, clearPdfBytesCache, pdfBytesCacheStats,
} from '../../../src/frontend/components/pdfBytesCache.js';

const bytes = (n, fill = 1) => {
  const b = new ArrayBuffer(n);
  new Uint8Array(b).fill(fill);
  return b;
};

beforeEach(() => clearPdfBytesCache());

describe('116.md §95 — the session byte cache', () => {
  it('fetches once and serves every later mount of the same URL from memory', async () => {
    const fetcher = vi.fn(async () => bytes(1024));
    const a = await getPdfBytes('/api/a.pdf', fetcher);
    const b = await getPdfBytes('/api/a.pdf', fetcher);
    const c = await getPdfBytes('/api/a.pdf', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(a.byteLength).toBe(1024);
    expect(b.byteLength).toBe(1024);
    expect(c.byteLength).toBe(1024);
  });

  it('two components mounting in the same frame share ONE request', async () => {
    let resolve;
    const fetcher = vi.fn(() => new Promise((res) => { resolve = res; }));
    const p1 = getPdfBytes('/api/a.pdf', fetcher);
    const p2 = getPdfBytes('/api/a.pdf', fetcher);
    await Promise.resolve();      // the fetcher starts on the next microtask
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(bytes(64));
    expect((await p1).byteLength).toBe(64);
    expect((await p2).byteLength).toBe(64);
  });

  it('hands out a COPY — pdf.js detaching one buffer cannot poison the cache', async () => {
    const source = bytes(8, 7);
    const first = await getPdfBytes('/api/a.pdf', async () => source);
    const second = await getPdfBytes('/api/a.pdf', async () => source);
    expect(first).not.toBe(second);
    expect(new Uint8Array(second)).toEqual(new Uint8Array(8).fill(7));
  });

  it('never caches a FAILED fetch, so Retry actually retries', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(bytes(16));
    await expect(getPdfBytes('/api/a.pdf', fetcher)).rejects.toThrow('network');
    expect(pdfBytesCacheStats().entries).toBe(0);
    const ok = await getPdfBytes('/api/a.pdf', fetcher);
    expect(ok.byteLength).toBe(16);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-buffer answer rather than caching garbage', async () => {
    await expect(getPdfBytes('/api/a.pdf', async () => ({ nope: true }))).rejects.toThrow();
    expect(pdfBytesCacheStats().entries).toBe(0);
  });

  it('evicts least-recently-used beyond the entry cap', async () => {
    const { maxEntries } = pdfBytesCacheStats();
    for (let i = 0; i < maxEntries + 3; i++) {
      await getPdfBytes(`/api/${i}.pdf`, async () => bytes(32));
    }
    expect(pdfBytesCacheStats().entries).toBeLessThanOrEqual(maxEntries);
  });

  it('a re-read makes an entry recent again (real LRU, not FIFO)', async () => {
    const { maxEntries } = pdfBytesCacheStats();
    const hits = [];
    for (let i = 0; i < maxEntries; i++) {
      await getPdfBytes(`/api/${i}.pdf`, async () => bytes(32));
    }
    await getPdfBytes('/api/0.pdf', async () => { hits.push('refetch-0'); return bytes(32); });
    expect(hits).toEqual([]);                      // still cached
    await getPdfBytes('/api/new.pdf', async () => bytes(32));   // forces one eviction
    await getPdfBytes('/api/0.pdf', async () => { hits.push('refetch-0'); return bytes(32); });
    expect(hits).toEqual([]);                      // 0 survived: it was touched
  });

  it('enforces a total BYTE ceiling so five big PDFs cannot pin the tab', async () => {
    const { maxBytes } = pdfBytesCacheStats();
    const big = Math.floor(maxBytes / 2) + 1;
    await getPdfBytes('/api/x.pdf', async () => bytes(big));
    await getPdfBytes('/api/y.pdf', async () => bytes(big));
    expect(pdfBytesCacheStats().bytes).toBeLessThanOrEqual(maxBytes);
  });

  it('a single document larger than the whole ceiling is served but NOT cached', async () => {
    const { maxBytes } = pdfBytesCacheStats();
    const huge = await getPdfBytes('/api/huge.pdf', async () => bytes(maxBytes + 1));
    expect(huge.byteLength).toBe(maxBytes + 1);
    expect(pdfBytesCacheStats().entries).toBe(0);
  });

  it('invalidate drops exactly one URL; clear drops everything', async () => {
    await getPdfBytes('/api/a.pdf', async () => bytes(10));
    await getPdfBytes('/api/b.pdf', async () => bytes(10));
    invalidatePdfBytes('/api/a.pdf');
    expect(pdfBytesCacheStats().entries).toBe(1);
    expect(pdfBytesCacheStats().bytes).toBe(10);
    invalidatePdfBytes('/api/nonexistent.pdf');       // no throw, no bookkeeping drift
    expect(pdfBytesCacheStats().bytes).toBe(10);
    clearPdfBytesCache();
    expect(pdfBytesCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('after invalidation the next mount really refetches (the §74 replace path)', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(bytes(4, 1))
      .mockResolvedValueOnce(bytes(4, 2));
    await getPdfBytes('/api/doc.pdf', fetcher);
    invalidatePdfBytes('/api/doc.pdf');
    const after = await getPdfBytes('/api/doc.pdf', fetcher);
    expect(new Uint8Array(after)[0]).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('degrades to a bare fetch when there is no URL to key on', async () => {
    const fetcher = vi.fn(async () => bytes(2));
    await getPdfBytes('', fetcher);
    await getPdfBytes('', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pdfBytesCacheStats().entries).toBe(0);
  });

  /**
   * 116.md §95 (r3) — the byte ACCOUNTING. An entry can leave the map while its
   * promise is still in flight (a replace calls `invalidate`, or a concurrent load
   * pushes it past the LRU cap). Adding its size to the running total afterwards
   * leaked the whole document into a counter nothing could ever subtract from again,
   * and once the leak passed MAX_BYTES `evict()` emptied the map on EVERY call — the
   * cache stopped working for the rest of the session while still looking present.
   */
  describe('the running byte total can never outlive its entries', () => {
    const inFlight = () => {
      let settle;
      const p = new Promise((res) => { settle = res; });
      return { fetcher: () => p, settle };
    };

    it('an invalidate DURING a fetch leaves no phantom bytes behind', async () => {
      const { fetcher, settle } = inFlight();
      const p = getPdfBytes('/api/doc.pdf', fetcher);
      await Promise.resolve();
      invalidatePdfBytes('/api/doc.pdf');       // the replace path, mid-download
      settle(bytes(4 * 1024 * 1024));
      await p;
      expect(pdfBytesCacheStats()).toMatchObject({ entries: 0, bytes: 0 });
    });

    it('an eviction DURING a fetch leaves no phantom bytes behind', async () => {
      const { maxEntries } = pdfBytesCacheStats();
      const { fetcher, settle } = inFlight();
      const p = getPdfBytes('/api/slow.pdf', fetcher);
      await Promise.resolve();
      for (let i = 0; i <= maxEntries; i++) await getPdfBytes(`/api/${i}.pdf`, async () => bytes(8));
      settle(bytes(4 * 1024 * 1024));           // resolves after it was evicted
      await p;
      expect(pdfBytesCacheStats().bytes).toBe(pdfBytesCacheStats().entries * 8);
    });

    it('repeated replaces-while-loading never disable the cache', async () => {
      const { maxBytes } = pdfBytesCacheStats();
      const big = Math.ceil(maxBytes / 4);
      for (let i = 0; i < 8; i++) {
        const { fetcher, settle } = inFlight();
        const p = getPdfBytes(`/api/big${i}.pdf`, fetcher);
        await Promise.resolve();
        invalidatePdfBytes(`/api/big${i}.pdf`);
        settle(bytes(big));
        await p;
      }
      expect(pdfBytesCacheStats().bytes).toBeLessThanOrEqual(maxBytes);
      // …and the cache still caches, which is the point of §95.
      const fetcher = vi.fn(async () => bytes(1024));
      await getPdfBytes('/api/after.pdf', fetcher);
      await getPdfBytes('/api/after.pdf', fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('a late FAILURE cannot evict a newer successful load of the same URL', async () => {
      let reject;
      const first = getPdfBytes('/api/x.pdf', () => new Promise((_, rej) => { reject = rej; }));
      const failed = first.catch(() => 'failed');
      await Promise.resolve();
      invalidatePdfBytes('/api/x.pdf');
      await getPdfBytes('/api/x.pdf', async () => bytes(32));   // a successful retry
      reject(new Error('network'));
      expect(await failed).toBe('failed');
      expect(pdfBytesCacheStats()).toMatchObject({ entries: 1, bytes: 32 });
    });
  });

  /**
   * 116.md §74/§95 (r3) — a STUDY-DOCUMENT URL is stable across a replace, so
   * `invalidate` (which only runs in the tab that performed the replace) cannot be
   * the whole answer. Serving the old bytes here is not a stale-cache annoyance: the
   * annotation layer re-resolves the NEW content hash from the server and paints the
   * new document's rectangles over the OLD document's pages — the "coordinates from
   * a different document" state §74 exists to prevent.
   */
  describe('version pins keep a stable URL honest across a replace', () => {
    const H1 = 'a'.repeat(64);
    const H2 = 'b'.repeat(64);
    const URL = '/api/projects/p1/studies/s1/document/download';

    it('a revisit is still a cache hit while the document is unchanged', async () => {
      const fetcher = vi.fn(async () => bytes(64, 1));
      pinPdfBytesVersion(URL, H1);
      await getPdfBytes(URL, fetcher);
      pinPdfBytesVersion(URL, H1);              // the next mount re-resolves the same hash
      await getPdfBytes(URL, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('another member replacing the file forces a refetch on the next mount', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(bytes(64, 1))
        .mockResolvedValueOnce(bytes(64, 2));
      pinPdfBytesVersion(URL, H1);
      const before = await getPdfBytes(URL, fetcher);
      expect(new Uint8Array(before)[0]).toBe(1);

      pinPdfBytesVersion(URL, H2);              // the panel resolved a NEW hash
      const after = await getPdfBytes(URL, fetcher);
      expect(new Uint8Array(after)[0]).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(pdfBytesCacheStats().entries).toBe(1);   // no accounting drift either
      expect(pdfBytesCacheStats().bytes).toBe(64);
    });

    it('an explicit version argument beats the standing pin', async () => {
      const fetcher = vi.fn(async () => bytes(16));
      pinPdfBytesVersion(URL, H1);
      await getPdfBytes(URL, fetcher, { version: H1 });
      await getPdfBytes(URL, fetcher, { version: H2 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('URLs nobody pins behave exactly as before (screening attachments)', async () => {
      const fetcher = vi.fn(async () => bytes(16));
      const att = '/api/screening/projects/p/records/r/pdf/att-1/download';
      await getPdfBytes(att, fetcher);
      await getPdfBytes(att, fetcher);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(pdfBytesCacheStats().pins).toBe(0);
    });

    it('an empty url or version is a no-op, never a silent cache wipe', async () => {
      await getPdfBytes('/api/a.pdf', async () => bytes(8));
      pinPdfBytesVersion('', H1);
      pinPdfBytesVersion('/api/a.pdf', '');
      expect(pdfBytesCacheStats()).toMatchObject({ entries: 1, bytes: 8, pins: 0 });
    });
  });

  it('stores nothing outside memory — no persistent storage API is referenced', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync('src/frontend/components/pdfBytesCache.js', 'utf8'));
    // Strip comments first: the header NAMES those APIs to explain what it does not use.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|fs\./);
  });
});
