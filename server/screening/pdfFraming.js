/**
 * pdfFraming.js — framing headers for the authenticated inline-PDF stream.
 *
 * The central CSP middleware (server/security/csp.js) sets `frame-ancestors
 * 'none'` on every API response, which blocks ALL framing — even same-origin — so
 * the screening PDF preview <iframe> would show "<host> refused to connect."
 * while "Open in new tab" (a top-level navigation, not framing) works fine.
 *
 * We mirror the strict policy but relax frame-ancestors to 'self': the minimal
 * change that lets the app embed its own authenticated PDF route in an <iframe>.
 * The relaxed policy is emitted under the SAME header name the CSP middleware is
 * currently using (report-only vs enforce) so it OVERWRITES the app policy rather
 * than coexisting with it — otherwise, in report-only mode the two differently-
 * named headers would both apply and every legit same-origin embed would file a
 * spurious frame-ancestors 'none' violation. Kept dependency-light so it stays
 * unit-testable without the controller's Prisma/multer imports.
 */
import { cspMode, cspHeaderName } from '../security/csp.js';

// CSP for the inline-PDF stream — strict like the global policy, but same-origin
// framing is permitted so the SPA can embed it.
export const INLINE_PDF_CSP =
  "default-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

/**
 * Set the framing headers that allow the inline-PDF route to be embedded by the
 * same-origin SPA. Replaces the strict app-level CSP (under whichever header name
 * is active) with the relaxed one, leaving exactly ONE CSP header on the response.
 */
export function setInlinePdfFramingHeaders(res) {
  // Drop any app-level CSP under either name, then re-set under the active name.
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  const name = cspHeaderName(cspMode());
  if (name) res.setHeader(name, INLINE_PDF_CSP);
  // X-Frame-Options legacy fallback: SAMEORIGIN so older browsers also allow the
  // same-origin embed (overrides the global DENY for this route only).
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
}
