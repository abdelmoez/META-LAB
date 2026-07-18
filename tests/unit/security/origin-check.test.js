/**
 * origin-check.test.js — unit tests for the CSRF defense-in-depth middleware
 * (93.md §4.6, server/security/originCheck.js).
 *
 * Contract under test:
 *   - state-changing methods (POST/PUT/PATCH/DELETE) with an allowlisted Origin pass;
 *   - a cross-site Origin is rejected 403 { code: 'ORIGIN_FORBIDDEN' };
 *   - `Sec-Fetch-Site: cross-site` is rejected 403 even when Origin looks allowlisted
 *     (browser fetch metadata is authoritative);
 *   - requests WITHOUT an Origin header pass (curl / same-origin navigations /
 *     legacy clients — SameSite=Strict cookies remain the defense there);
 *   - non-mutating methods (GET/HEAD/OPTIONS) are ignored entirely;
 *   - same-host fallback: Origin whose scheme://host equals the request Host
 *     passes even when absent from the allowlist (dev deployments).
 *
 * Pure middleware — exercised with hand-rolled req/res mocks, no HTTP server.
 */
import { describe, it, expect } from 'vitest';
import { originCheck } from '../../../server/security/originCheck.js';

const ALLOW = ['https://app.example.com', 'http://localhost:3000'];

function mockReq({ method = 'POST', origin, fetchSite, host = 'api.internal:3001' } = {}) {
  const headers = { host };
  if (origin !== undefined) headers.origin = origin;
  if (fetchSite !== undefined) headers['sec-fetch-site'] = fetchSite;
  return { method, headers };
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

/** Run the middleware once; returns { passed, res }. */
function run(mw, req) {
  const res = mockRes();
  let passed = false;
  mw(req, res, () => { passed = true; });
  return { passed, res };
}

describe('originCheck — allowlisted origins pass', () => {
  it('POST with an allowlisted Origin calls next()', () => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed, res } = run(mw, mockReq({ origin: 'https://app.example.com' }));
    expect(passed).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('normalizes case and trailing slash before comparing', () => {
    const mw = originCheck({ allowlist: ['https://App.Example.com/'] });
    const { passed } = run(mw, mockReq({ origin: 'HTTPS://APP.EXAMPLE.COM' }));
    expect(passed).toBe(true);
  });
});

describe('originCheck — cross-site requests are rejected', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s with a foreign Origin → 403 ORIGIN_FORBIDDEN', (method) => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed, res } = run(mw, mockReq({ method, origin: 'https://evil.example' }));
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('Sec-Fetch-Site: cross-site → 403 even when the Origin itself is allowlisted', () => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed, res } = run(mw, mockReq({ origin: 'https://app.example.com', fetchSite: 'cross-site' }));
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('ORIGIN_FORBIDDEN');
  });

  it('an unparseable Origin value is rejected, not silently allowed (fail closed)', () => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed, res } = run(mw, mockReq({ origin: 'not a url at all' }));
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

describe('originCheck — requests that must keep passing', () => {
  it('POST without an Origin header passes (curl / legacy / same-origin navigation)', () => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed } = run(mw, mockReq({}));
    expect(passed).toBe(true);
  });

  it("the opaque 'null' Origin passes (fetch metadata covers sandboxed iframes)", () => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed } = run(mw, mockReq({ origin: 'null' }));
    expect(passed).toBe(true);
  });

  it('Sec-Fetch-Site: same-origin / same-site / none do NOT reject on their own', () => {
    const mw = originCheck({ allowlist: ALLOW });
    for (const fetchSite of ['same-origin', 'same-site', 'none']) {
      const { passed } = run(mw, mockReq({ fetchSite }));
      expect(passed).toBe(true);
    }
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('%s is ignored even with a foreign Origin', (method) => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed, res } = run(mw, mockReq({ method, origin: 'https://evil.example' }));
    expect(passed).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('same-host fallback: Origin matching the request Host passes without an allowlist entry', () => {
    const mw = originCheck({ allowlist: ALLOW });
    const { passed } = run(mw, mockReq({ origin: 'http://myhost:8080', host: 'myhost:8080' }));
    expect(passed).toBe(true);
  });

  it('same-host fallback is host-exact — a foreign host with matching suffix still 403s', () => {
    const mw = originCheck({ allowlist: ALLOW });
    // Host is myhost:8080 but Origin's host is evil-myhost:8080 → no match.
    const { passed, res } = run(mw, mockReq({ origin: 'http://evil-myhost:9999', host: 'myhost:8080' }));
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});
