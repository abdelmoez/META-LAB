/**
 * 86.md P1.19 — the OA PDF download must stream and abort once the size cap is
 * exceeded, instead of buffering the whole (possibly multi-GB) body first.
 */
import { describe, it, expect } from 'vitest';
import { readBodyCapped, FT_DOWNLOAD_TIMEOUT_MS } from '../../server/fullText/fullTextService.js';

// Minimal web-ReadableStream-shaped body that yields fixed-size chunks.
function bodyOf(chunks) {
  let i = 0;
  return {
    getReader() {
      return {
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
        cancel: async () => {},
      };
    },
  };
}
const chunk = (n) => new Uint8Array(n);

describe('readBodyCapped (P1.19)', () => {
  it('returns the full buffer when under the cap', async () => {
    const res = { body: bodyOf([chunk(100), chunk(100), chunk(50)]) };
    const buf = await readBodyCapped(res, 1000, null);
    expect(buf.length).toBe(250);
  });

  it('aborts with TOO_LARGE as soon as the cap is exceeded (does not buffer the rest)', async () => {
    let cancelled = false;
    const res = {
      body: {
        getReader() {
          let i = 0; const chunks = [chunk(600), chunk(600), chunk(600)];
          return {
            read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
            cancel: async () => { cancelled = true; },
          };
        },
      },
    };
    let aborted = false;
    const controller = { abort: () => { aborted = true; } };
    await expect(readBodyCapped(res, 1000, controller)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(cancelled).toBe(true); // reader was cancelled, not drained
    expect(aborted).toBe(true);   // fetch was aborted
  });

  it('falls back to arrayBuffer when the body is not streamable', async () => {
    const res = { body: null, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    const buf = await readBodyCapped(res, 1000, null);
    expect(buf.length).toBe(3);
  });

  it('exposes a bounded download timeout', () => {
    expect(FT_DOWNLOAD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FT_DOWNLOAD_TIMEOUT_MS).toBeLessThanOrEqual(300000);
  });
});
