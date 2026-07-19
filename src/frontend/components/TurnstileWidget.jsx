/**
 * TurnstileWidget.jsx (94.md §3.10) — Cloudflare Turnstile, rendered only when a
 * public site key is configured. The SECRET key stays on the server, which is the
 * sole authority: it verifies the token on every protected POST. This widget only
 * PRODUCES a token and lifts it to the parent form via onToken.
 *
 * Contract we hold up:
 *   • Load challenges.cloudflare.com/turnstile/api.js ONCE (module-level promise
 *     guard) with explicit-render mode, then render into our own div.
 *   • onToken(token) when solved; onToken(null) on expiry / error / load-failure.
 *   • FAIL OPEN: if the script can't load we show a one-line unobtrusive notice and
 *     call onToken(null) — the form must still submit (the server fails open when
 *     Cloudflare is unreachable; we never hard-block the user in the client).
 *   • resetSignal — bump this number from the parent after a failed submit to mint
 *     a fresh single-use token.
 *
 * Props: { siteKey, onToken, action?, theme?, resetSignal? }
 */
import { useEffect, useRef, useState } from 'react';
import { C, FONT } from '../theme/tokens.js';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/api.js';

let _scriptPromise = null;

/** Inject the Turnstile script exactly once and resolve with window.turnstile. */
function loadTurnstile() {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { reject(new Error('no-window')); return; }
    if (window.turnstile) { resolve(window.turnstile); return; }
    const cb = `__turnstileOnLoad_${Math.random().toString(36).slice(2)}`;
    window[cb] = () => {
      try { delete window[cb]; } catch { /* ignore */ }
      resolve(window.turnstile);
    };
    const s = document.createElement('script');
    s.src = `${SCRIPT_SRC}?render=explicit&onload=${cb}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      try { delete window[cb]; } catch { /* ignore */ }
      _scriptPromise = null; // allow a later retry (e.g. transient CDN blip)
      reject(new Error('turnstile-load-failed'));
    };
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

/** Map the app's legacy day/night theme onto Turnstile's light/dark/auto. */
function resolveTheme(explicit) {
  if (explicit) return explicit;
  try {
    const t = document.documentElement.dataset.theme;
    if (t === 'night') return 'dark';
    if (t === 'day') return 'light';
  } catch { /* ignore */ }
  return 'auto';
}

export default function TurnstileWidget({ siteKey, onToken, action, theme, resetSignal = 0 }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken; // always call the latest callback without re-rendering the widget
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current || widgetIdRef.current != null) return;
        try {
          widgetIdRef.current = turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: resolveTheme(theme),
            action: action || undefined,
            callback: (token) => onTokenRef.current && onTokenRef.current(token),
            'expired-callback': () => onTokenRef.current && onTokenRef.current(null),
            'error-callback': () => { onTokenRef.current && onTokenRef.current(null); },
          });
        } catch {
          setFailed(true);
          onTokenRef.current && onTokenRef.current(null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        onTokenRef.current && onTokenRef.current(null); // fail open
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current != null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current); } catch { /* ignore */ }
      }
      widgetIdRef.current = null;
    };
    // Re-render only when the site key changes; onToken is read via a ref.
  }, [siteKey, action, theme]);

  // Parent bumps resetSignal after a failed submit → fresh single-use token.
  useEffect(() => {
    if (!resetSignal) return;
    if (widgetIdRef.current != null && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current); } catch { /* ignore */ }
      onTokenRef.current && onTokenRef.current(null);
    }
  }, [resetSignal]);

  if (!siteKey) return null;

  if (failed) {
    return (
      <div style={{ fontSize: 12, color: C.muted, fontFamily: FONT, lineHeight: 1.5, margin: '6px 0' }}>
        Couldn't load the verification check. You can still continue.
      </div>
    );
  }

  return <div ref={containerRef} style={{ margin: '6px 0', minHeight: 65 }} />;
}
