/**
 * fetchTimeout.test.js — 93.md Phase 10 outbound-fetch bounds.
 * Pure unit tests (no network): the streaming size cap, the buffered fallback
 * for mock responses without a web-stream body, and timeout-error mapping.
 */
import { describe, it, expect } from 'vitest';
import {
  METADATA_TIMEOUT_MS, DOWNLOAD_TIMEOUT_MS,
  timeoutSignal, describeFetchError, readBodyCapped,
} from '../../server/utils/fetchTimeout.js';

/** Build a mock Response whose body is a web ReadableStream of `chunks`. */
function streamResponse(chunks) {
  let i = 0;
  let cancelled = false;
  const body = {
    getReader() {
      return {
        async read() {
          if (cancelled || i >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[i++] };
        },
        async cancel() { cancelled = true; },
      };
    },
  };
  return { body, wasCancelled: () => cancelled };
}

describe('timeoutSignal', () => {
  it('returns an AbortSignal with a deadline', () => {
    const s = timeoutSignal(5000);
    expect(s).toBeTruthy();
    expect(s.aborted).toBe(false);
  });
  it('defaults are sane (metadata < download)', () => {
    expect(METADATA_TIMEOUT_MS).toBeLessThan(DOWNLOAD_TIMEOUT_MS);
  });
});

describe('describeFetchError', () => {
  it('maps TimeoutError/AbortError to a readable timeout message', () => {
    expect(describeFetchError({ name: 'TimeoutError', message: 'noise' }, 60000)).toBe('timed out after 60s');
    expect(describeFetchError({ name: 'AbortError', message: 'noise' }, 15000)).toBe('timed out after 15s');
  });
  it('nested cause (undici wraps aborts) is also detected', () => {
    expect(describeFetchError({ name: 'FetchError', cause: { name: 'TimeoutError' } }, 30000)).toBe('timed out after 30s');
  });
  it('other errors keep their own message', () => {
    expect(describeFetchError(new Error('ECONNRESET'), 60000)).toBe('ECONNRESET');
  });
});

describe('readBodyCapped — streaming cap', () => {
  it('reads an under-cap stream fully', async () => {
    const res = streamResponse([Buffer.from('%PDF-'), Buffer.from('rest')]);
    const r = await readBodyCapped(res, 100);
    expect(r.ok).toBe(true);
    expect(r.buffer.toString()).toBe('%PDF-rest');
  });

  it('aborts DURING streaming once the cap is crossed (does not buffer the rest)', async () => {
    const big = Buffer.alloc(60, 'x');
    const res = streamResponse([big, big, big]); // 180 bytes total, cap 100
    const r = await readBodyCapped(res, 100);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('PDF exceeds size limit'); // exact legacy message preserved
    expect(res.wasCancelled()).toBe(true);          // the connection was released
  });

  it('falls back to arrayBuffer for bodyless mock responses, keeping the cap', async () => {
    const small = { arrayBuffer: async () => Buffer.from('%PDF-1.7').buffer.slice(0, 8) };
    const okRes = await readBodyCapped(small, 100);
    expect(okRes.ok).toBe(true);

    const bigBytes = new Uint8Array(200);
    const big = { arrayBuffer: async () => bigBytes.buffer };
    const bigRes = await readBodyCapped(big, 100);
    expect(bigRes.ok).toBe(false);
    expect(bigRes.error).toBe('PDF exceeds size limit');
  });

  it('a mid-stream read error returns ok:false instead of throwing', async () => {
    const res = {
      body: {
        getReader() {
          return {
            async read() { throw new Error('socket hang up'); },
            async cancel() {},
          };
        },
      },
    };
    const r = await readBodyCapped(res, 100);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('socket hang up');
  });
});
