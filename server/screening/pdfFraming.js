/**
 * pdfFraming.js — framing headers for the authenticated inline-PDF stream.
 *
 * The global helmet middleware (server/index.js) sets `frame-ancestors 'none'`
 * on every API response, which blocks ALL framing — even same-origin — so the
 * screening PDF preview <iframe> shows "<host> refused to connect." while
 * "Open in new tab" (a top-level navigation, not framing) works fine.
 *
 * We mirror helmet's strict policy but relax frame-ancestors to 'self': the
 * minimal change that lets the app embed its own authenticated PDF route in an
 * <iframe>. Kept in a dependency-free module so it is unit-testable without the
 * controller's Prisma/multer imports.
 */

// CSP for the inline-PDF stream — strict like the global policy, but same-origin
// framing is permitted so the SPA can embed it.
export const INLINE_PDF_CSP =
  "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/**
 * Set the framing headers that allow the inline-PDF route to be embedded by the
 * same-origin SPA. Overwrites the strict defaults the global helmet middleware
 * already placed on the response.
 */
export function setInlinePdfFramingHeaders(res) {
  res.setHeader('Content-Security-Policy', INLINE_PDF_CSP);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}
