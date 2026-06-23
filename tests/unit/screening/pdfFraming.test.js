import { describe, it, expect, afterEach } from 'vitest';
import { INLINE_PDF_CSP, setInlinePdfFramingHeaders } from '../../../server/screening/pdfFraming.js';

/**
 * The screening PDF preview <iframe> showed "<host> refused to connect." because
 * the central CSP middleware sends `frame-ancestors 'none'` on every API
 * response, blocking even same-origin framing. The inline-PDF route must relax
 * that to 'self' so the SPA can embed its own authenticated PDF — emitted under
 * the ACTIVE CSP header name so there is never a second, contradictory header
 * (prompt 51 review fix).
 */
function fakeRes(initial = {}) {
  const headers = { ...initial };
  return {
    headers,
    setHeader(name, value) { headers[name] = value; },
    getHeader(name) { return headers[name]; },
    removeHeader(name) { delete headers[name]; },
  };
}

const prevMode = process.env.CSP_MODE;
afterEach(() => { if (prevMode === undefined) delete process.env.CSP_MODE; else process.env.CSP_MODE = prevMode; });

describe('inline PDF framing headers', () => {
  it('relaxes frame-ancestors to same-origin (not none) but stays otherwise strict', () => {
    expect(INLINE_PDF_CSP).toContain("frame-ancestors 'self'");
    expect(INLINE_PDF_CSP).not.toContain("frame-ancestors 'none'");
    expect(INLINE_PDF_CSP).toContain("default-src 'none'");
    expect(INLINE_PDF_CSP).toContain("base-uri 'none'");
    expect(INLINE_PDF_CSP).toContain("form-action 'none'");
  });

  it('in enforce mode emits exactly one CSP header (Content-Security-Policy)', () => {
    process.env.CSP_MODE = 'enforce';
    const res = fakeRes({ 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
    setInlinePdfFramingHeaders(res);
    expect(res.headers['Content-Security-Policy']).toBe(INLINE_PDF_CSP);
    expect(res.headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('in report-only mode overwrites the report-only header (no duplicate/contradiction)', () => {
    process.env.CSP_MODE = 'report-only';
    // Simulate the central middleware having set the report-only header.
    const res = fakeRes({ 'Content-Security-Policy-Report-Only': "default-src 'none'; frame-ancestors 'none'" });
    setInlinePdfFramingHeaders(res);
    expect(res.headers['Content-Security-Policy-Report-Only']).toBe(INLINE_PDF_CSP);
    expect(res.headers['Content-Security-Policy']).toBeUndefined();
    // exactly one CSP header present
    const cspHeaders = Object.keys(res.headers).filter((k) => /^content-security-policy/i.test(k));
    expect(cspHeaders.length).toBe(1);
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('in disabled mode emits no CSP header but still relaxes X-Frame-Options', () => {
    process.env.CSP_MODE = 'disabled';
    const res = fakeRes();
    setInlinePdfFramingHeaders(res);
    expect(res.headers['Content-Security-Policy']).toBeUndefined();
    expect(res.headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });
});
