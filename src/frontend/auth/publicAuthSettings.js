/**
 * publicAuthSettings.js (94.md §2.8/3.10) — tiny cached reader for the two PUBLIC
 * auth-related flags the login/registration surfaces need:
 *   • googleAuthEnabled — is the "Continue with Google" button available?
 *   • turnstileSiteKey  — the Cloudflare Turnstile SITE key (public; the secret
 *                         key never leaves the server), or null when unset.
 *
 * Both live at the TOP LEVEL of `/api/settings/public` (the same unauthenticated
 * endpoint every feature flag reads, e.g. features/livingReview/flag.js). We keep
 * one module-level promise so N mounted forms share a single network round-trip,
 * and never throw: on any failure the button hides and Turnstile is skipped, which
 * degrades to plain email/password + the server's own fail-open behaviour.
 */
import { useEffect, useState } from 'react';

const FALLBACK = { googleAuthEnabled: false, turnstileSiteKey: null };

let _cache = null;

/** Fetch (once) and normalize the two public auth flags. Never rejects. */
export function loadPublicAuthSettings() {
  if (_cache) return _cache;
  _cache = fetch('/api/settings/public', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => ({
      googleAuthEnabled: !!(d && d.googleAuthEnabled),
      turnstileSiteKey:
        d && typeof d.turnstileSiteKey === 'string' && d.turnstileSiteKey.trim()
          ? d.turnstileSiteKey.trim()
          : null,
    }))
    .catch(() => ({ ...FALLBACK }));
  return _cache;
}

/**
 * Hook form. Returns { googleAuthEnabled, turnstileSiteKey, loaded }. `loaded`
 * flips true after the first resolve so callers can avoid a flash of the Google
 * button before the flag is known (render it only when loaded && googleAuthEnabled).
 */
export function usePublicAuthSettings() {
  const [state, setState] = useState({ ...FALLBACK, loaded: false });
  useEffect(() => {
    let alive = true;
    loadPublicAuthSettings().then((s) => { if (alive) setState({ ...s, loaded: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}

export default usePublicAuthSettings;
