/**
 * useAppVersion.js — the real, safe product version for Stitch chrome.
 *
 * design2.md Part 1 ("subtle application version label"): reuse the existing
 * automatic version system — NEVER hard-code a version — and do NOT expose git
 * commit hashes / server / framework versions to ordinary users.
 *
 * Source: GET /api/version (the canonical, intentional version endpoint;
 * server/index.js). It returns the build metadata (commit/dates) only to an
 * authenticated caller, but we deliberately read ONLY `.version` (e.g. "3.49.1"),
 * so the commit hash is never shown regardless of role. A module-level cache means
 * we fetch at most once per session (the endpoint is `no-store`, so the browser
 * will not cache it — the JS cache is what avoids refetching on remount). On any
 * failure we render nothing rather than a stale hard-coded number.
 */
import { useEffect, useState } from 'react';

let _appVersionCache = null;

export function useAppVersion() {
  const [version, setVersion] = useState(_appVersionCache);
  useEffect(() => {
    if (_appVersionCache) return undefined;
    let alive = true;
    fetch('/api/version', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (alive && v && v.version) {
          _appVersionCache = v.version;
          setVersion(v.version);
        }
      })
      .catch(() => {}); // silent: a missing label is better than a fake one
    return () => { alive = false; };
  }, []);
  return version; // string like "3.49.1" or null
}

/** Test seam: reset the module cache (used by unit tests / hot reload). */
export function __resetAppVersionCache() { _appVersionCache = null; }
