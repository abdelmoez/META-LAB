/**
 * seoPublic.js — the one unauthenticated SEO endpoint:
 *
 *   POST /api/seo/pageview   { path, referrer }  →  204, always
 *
 * Fired by the public marketing pages (src/frontend/website/useSeoBeacon.js) so
 * Ops › SEO › Landing analytics can show whether the new pages are being landed
 * on at all, and roughly where from. It exists because the alternative was a
 * third-party analytics script — a cookie banner, an external origin in the CSP,
 * and a per-visitor profile we do not want to hold.
 *
 * CONTRACT, in order of importance:
 *   1. ALWAYS 204, empty body. Not 400 on a junk path, not 404 on an unknown
 *      one, not 500 when the database is down. A beacon that answers anything
 *      else becomes a red line in a visitor's console (or a probe for which
 *      paths exist), and the page it fires from must never look broken because
 *      telemetry is unhappy.
 *   2. The write is DETACHED. The response is sent first; the service call is
 *      fire-and-forget and swallows its own errors, so a slow database never
 *      holds a socket open on a public page.
 *   3. Nothing about the caller is read. No session, no cookie, no IP, no user
 *      agent. The Host header is used only to recognise our OWN hostname when
 *      classifying the referrer.
 *
 * Rate limiting is applied at the mount in server/index.js, like every other
 * public router — and its over-limit handler also answers 204.
 */

import express from 'express';
import { recordPageView } from '../services/seoPageviewService.js';

const router = express.Router();

/**
 * Tiny, dedicated body parser. `text/plain` is accepted because
 * navigator.sendBeacon sends a Blob and some browsers/extensions downgrade the
 * declared type; 2kb is far more than `{path, referrer}` can legitimately need.
 * body-parser is a no-op when the global JSON parser already ran.
 */
const beaconParser = express.json({ type: ['application/json', 'text/plain'], limit: '2kb' });

/** Exported for direct unit testing (no supertest, no live server). */
export function handlePageViewBeacon(req, res) {
  res.status(204).end();

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    void recordPageView({
      path: body.path,
      referrer: body.referrer,
      host: req.get ? req.get('host') : undefined,
    });
  } catch {
    /* never throw from a telemetry sink */
  }
}

router.post('/pageview', (req, res) => {
  beaconParser(req, res, () => handlePageViewBeacon(req, res));
});

export default router;
