/**
 * useSeoBeacon.js — 113.md phase 19 — the public-page view beacon.
 *
 * ONE fire-and-forget POST per public page view, so Ops › SEO can show whether
 * the marketing pages are being landed on and roughly from where. It exists
 * instead of a third-party analytics script, which would have meant a cookie
 * banner, an external origin punched through the CSP, and a per-visitor profile
 * held by someone else.
 *
 * WHAT IT SENDS: `{ path, referrer }`. Nothing else. The referrer is classified
 * into one of five labels SERVER-SIDE and the raw value is discarded there, and
 * the path is allowlisted against the public-page registry before anything is
 * written.
 *
 * WHAT IT NEVER DOES:
 *   - never sets or reads a cookie, localStorage, sessionStorage or any id;
 *   - never runs inside the authenticated app — it is called from the public
 *     page frame only, so a project URL can never reach the endpoint;
 *   - never blocks, retries, or surfaces anything. Every failure path is a
 *     swallowed no-op, because a marketing page must not depend on telemetry.
 *
 * SSR SAFETY: the send lives entirely inside useEffect, which never runs under
 * renderToString/renderToStaticMarkup — the prerenderer and the SSR pins render
 * PageShell with no window and no network.
 */
import { useEffect } from 'react';

export const SEO_BEACON_ENDPOINT = '/api/seo/pageview';

/** The exact request body. PURE — exported so a test can pin the wire shape. */
export function seoBeaconPayload(pathname, referrer) {
  return JSON.stringify({
    path: typeof pathname === 'string' ? pathname : '',
    referrer: typeof referrer === 'string' ? referrer : '',
  });
}

/**
 * Send one beacon. Exported for testing; returns true when a transport was
 * invoked. Never throws.
 */
export function sendSeoBeacon(pathname, { referrer = '', nav, fetchImpl } = {}) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  const body = seoBeaconPayload(pathname, referrer);
  const navigator_ = nav !== undefined ? nav : (typeof navigator !== 'undefined' ? navigator : null);
  const fetch_ = fetchImpl !== undefined ? fetchImpl : (typeof fetch !== 'undefined' ? fetch : null);

  try {
    // sendBeacon survives the page being closed mid-navigation, which is exactly
    // the case a landing-page counter cares about.
    if (navigator_ && typeof navigator_.sendBeacon === 'function' && typeof Blob !== 'undefined') {
      navigator_.sendBeacon(SEO_BEACON_ENDPOINT, new Blob([body], { type: 'application/json' }));
      return true;
    }
    if (typeof fetch_ === 'function') {
      const p = fetch_(SEO_BEACON_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
        credentials: 'omit',
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    }
  } catch {
    /* telemetry must never break a page */
  }
  return false;
}

/**
 * Fire the beacon once per public path. Pass the canonical, slash-stripped path;
 * a falsy value is a deliberate no-op (an unregistered route sends nothing).
 */
export function useSeoBeacon(pathname) {
  useEffect(() => {
    if (typeof window === 'undefined' || !pathname) return;
    sendSeoBeacon(pathname, {
      referrer: typeof document !== 'undefined' ? document.referrer : '',
    });
  }, [pathname]);
}

export default useSeoBeacon;
