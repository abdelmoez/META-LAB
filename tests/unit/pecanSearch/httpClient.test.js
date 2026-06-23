import { describe, it, expect } from 'vitest';
import { createHttpClient, parseRetryAfter } from '../../../server/pecanSearch/httpClient.js';
import { PecanError } from '../../../server/pecanSearch/errors.js';
import { makeMock } from './_harness.js';

const base = (fetchImpl, extra = {}) => createHttpClient({ fetch: fetchImpl, now: () => 1000, sleep: () => Promise.resolve(), random: () => 0.5, logger: { debug() {}, warn() {} }, ...extra });

describe('httpClient', () => {
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('5', 0)).toBe(5000);
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('returns parsed JSON on 200', async () => {
    const c = base(makeMock([{ match: /./, json: { ok: 1 } }]));
    const r = await c.requestJson('https://x.test/a');
    expect(r.json).toEqual({ ok: 1 });
  });

  it('retries on 429 then succeeds', async () => {
    let n = 0;
    const c = base((url) => Promise.resolve(n++ === 0
      ? { ok: false, status: 429, headers: { get: (k) => (k === 'retry-after' ? '1' : null) }, text: () => Promise.resolve('') }
      : { ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"ok":1}') }));
    const r = await c.requestJson('https://x.test/a', { retryLimit: 3 });
    expect(r.json).toEqual({ ok: 1 });
    expect(n).toBe(2);
  });

  it('throws a typed PecanError on a non-retryable 400', async () => {
    const c = base(makeMock([{ match: /./, status: 400, text: 'bad' }]));
    await expect(c.requestJson('https://x.test/a', { retryLimit: 2 })).rejects.toBeInstanceOf(PecanError);
  });

  it('classifies auth failures (401) as non-retryable', async () => {
    let calls = 0;
    const c = base((url) => { calls++; return Promise.resolve({ ok: false, status: 401, headers: { get: () => null }, text: () => Promise.resolve('') }); });
    await expect(c.requestJson('https://x.test/a', { retryLimit: 3 })).rejects.toMatchObject({ code: 'PROVIDER_AUTH_FAILED' });
    expect(calls).toBe(1); // not retried
  });

  it('enforces the max response size guard', async () => {
    const big = 'x'.repeat(50);
    const c = base(makeMock([{ match: /./, text: big }]));
    await expect(c.requestText('https://x.test/a', { maxBytes: 10 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('opens the circuit breaker after repeated failures', async () => {
    const c = base((url) => Promise.resolve({ ok: false, status: 500, headers: { get: () => null }, text: () => Promise.resolve('') }), { breaker: { threshold: 2, cooldownMs: 60000 } });
    // First call exhausts retries (threshold reached); second should fail fast (circuit open).
    await expect(c.requestJson('https://h.test/a', { retryLimit: 1 })).rejects.toBeTruthy();
    const state = c.breakerState();
    expect(state['h.test']).toBeTruthy();
  });

  it('throws PROVIDER_MALFORMED_RESPONSE on invalid JSON', async () => {
    const c = base(makeMock([{ match: /./, text: '{not json' }]));
    await expect(c.requestJson('https://x.test/a')).rejects.toMatchObject({ code: 'PROVIDER_MALFORMED_RESPONSE' });
  });
});
