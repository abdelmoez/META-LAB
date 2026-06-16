import { describe, it, expect } from 'vitest';
import { INLINE_PDF_CSP, setInlinePdfFramingHeaders } from '../../../server/screening/pdfFraming.js';

/**
 * The screening PDF preview <iframe> showed "<host> refused to connect." because
 * the global helmet middleware sends `frame-ancestors 'none'` on every API
 * response, blocking even same-origin framing. The inline-PDF route must relax
 * that to 'self' so the SPA can embed its own authenticated PDF.
 */
function fakeRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) { headers[name] = value; },
  };
}

describe('inline PDF framing headers', () => {
  it('relaxes frame-ancestors to same-origin (not none)', () => {
    expect(INLINE_PDF_CSP).toContain("frame-ancestors 'self'");
    expect(INLINE_PDF_CSP).not.toContain("frame-ancestors 'none'");
  });

  it('keeps the rest of the policy strict', () => {
    expect(INLINE_PDF_CSP).toContain("default-src 'none'");
    expect(INLINE_PDF_CSP).toContain("base-uri 'none'");
    expect(INLINE_PDF_CSP).toContain("form-action 'none'");
  });

  it('sets CSP + X-Frame-Options on the response so same-origin embedding works', () => {
    const res = fakeRes();
    setInlinePdfFramingHeaders(res);
    expect(res.headers['Content-Security-Policy']).toBe(INLINE_PDF_CSP);
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('overwrites a previously-set strict CSP (helmet default) on the same response', () => {
    const res = fakeRes();
    // Simulate the global helmet middleware having already run.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    setInlinePdfFramingHeaders(res);
    expect(res.headers['Content-Security-Policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['Content-Security-Policy']).not.toContain("frame-ancestors 'none'");
    expect(res.headers['X-Frame-Options']).toBe('SAMEORIGIN');
  });
});
