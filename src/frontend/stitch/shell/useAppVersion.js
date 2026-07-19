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
// 93.md §3.3 round 2 — deployment environment for the staging badge. Only ever
// non-null for authenticated sessions ('staging' | 'production' | 'development'
// per the server's APP_ENV/NODE_ENV); anonymous responses omit the field.
let _appEnvCache = null;

function fetchVersionOnce(onValue) {
  fetch('/api/version', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => {
      if (v && v.version) {
        _appVersionCache = v.version;
        _appEnvCache = typeof v.env === 'string' ? v.env : null;
        onValue(v);
      }
    })
    .catch(() => {}); // silent: a missing label is better than a fake one
}

export function useAppVersion() {
  const [version, setVersion] = useState(_appVersionCache);
  useEffect(() => {
    if (_appVersionCache) return undefined;
    let alive = true;
    fetchVersionOnce(() => { if (alive) setVersion(_appVersionCache); });
    return () => { alive = false; };
  }, []);
  return version; // string like "3.49.1" or null
}

/**
 * useAppEnvironment() — 'staging' | 'production' | 'development' | null.
 * null until known (or for anonymous sessions, where the server omits env).
 * Chrome components render a STAGING badge when this returns a non-production
 * value so an administrator can never mistake the staging box for production.
 */
export function useAppEnvironment() {
  const [env, setEnv] = useState(_appEnvCache);
  useEffect(() => {
    if (_appVersionCache) { setEnv(_appEnvCache); return undefined; }
    let alive = true;
    fetchVersionOnce(() => { if (alive) setEnv(_appEnvCache); });
    return () => { alive = false; };
  }, []);
  return env;
}

/** Test seam: reset the module cache (used by unit tests / hot reload). */
export function __resetAppVersionCache() { _appVersionCache = null; _appEnvCache = null; }
