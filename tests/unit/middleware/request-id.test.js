/**
 * request-id.test.js — unit tests for the per-request correlation id middleware
 * (93.md §4.11, server/middleware/requestId.js).
 *
 * Contract under test:
 *   - with no inbound header, a UUID is minted onto req.id;
 *   - a sane inbound X-Request-Id (8–64 chars of [A-Za-z0-9_-], e.g. nginx
 *     $request_id 32-hex) is honoured so one id spans proxy → app → response;
 *   - garbage inbound values (too short, too long, spaces, newlines — log
 *     injection vectors) are REJECTED and a fresh UUID is minted instead;
 *   - the chosen id is echoed in the X-Request-Id response header;
 *   - next() is always called exactly once.
 */
import { describe, it, expect } from 'vitest';
import { requestId } from '../../../server/middleware/requestId.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function run(inbound) {
  const req = { headers: {} };
  if (inbound !== undefined) req.headers['x-request-id'] = inbound;
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  let nextCalls = 0;
  requestId(req, res, () => { nextCalls += 1; });
  return { req, headers, nextCalls };
}

describe('requestId — minting', () => {
  it('mints a UUID when no X-Request-Id header is present', () => {
    const { req, nextCalls } = run();
    expect(req.id).toMatch(UUID_RE);
    expect(nextCalls).toBe(1);
  });

  it('mints a distinct id per request', () => {
    expect(run().req.id).not.toBe(run().req.id);
  });
});

describe('requestId — honouring a sane inbound proxy id', () => {
  it('keeps a 32-hex nginx-style $request_id', () => {
    const inbound = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const { req } = run(inbound);
    expect(req.id).toBe(inbound);
  });

  it('keeps ids with the full allowed alphabet [A-Za-z0-9_-]', () => {
    const inbound = 'Trace_ID-2026-abcXYZ_09';
    const { req } = run(inbound);
    expect(req.id).toBe(inbound);
  });
});

describe('requestId — rejecting garbage inbound headers (mints instead)', () => {
  it.each([
    ['too short (<8)', 'abc123'],
    ['too long (>64)', 'x'.repeat(65)],
    ['embedded space', 'bad header value'],
    ['newline (log injection)', 'evil\nX-Fake: 1'],
    ['non-alphanumeric symbols', 'id;rm -rf /tmp'],
    ['empty string', ''],
  ])('%s → fresh UUID', (_label, inbound) => {
    const { req } = run(inbound);
    expect(req.id).not.toBe(inbound);
    expect(req.id).toMatch(UUID_RE);
  });

  it('a repeated header (array value) is not a string → fresh UUID', () => {
    const { req } = run(['aaaaaaaaaa', 'bbbbbbbbbb']);
    expect(req.id).toMatch(UUID_RE);
  });
});

describe('requestId — response echo', () => {
  it('echoes the minted id in the X-Request-Id response header', () => {
    const { req, headers } = run();
    expect(headers['X-Request-Id']).toBe(req.id);
  });

  it('echoes the honoured inbound id unchanged', () => {
    const inbound = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const { headers } = run(inbound);
    expect(headers['X-Request-Id']).toBe(inbound);
  });
});
