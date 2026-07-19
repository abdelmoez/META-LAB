/**
 * GoogleAuthButton.jsx (94.md §2.8) — the "Continue with Google" button.
 *
 * Self-contained and brand-correct per Google's Sign-In branding guidelines:
 *   • Neutral surface (white in day / dark slate in night), neutral border — it
 *     deliberately does NOT use the admin-brandable accent (C.acc). Google's mark
 *     must sit on a fixed neutral chrome, not a tenant's brand colour.
 *   • The official four-colour "G" is drawn inline as SVG (no network asset, so it
 *     survives the strict CSP and offline builds).
 *   • Redirect flow only — NO popups. Activation is a full-page navigation to the
 *     server's /api/auth/google/start, which owns the OAuth state/nonce/PKCE and
 *     the session cookie. `returnTo` is an INTERNAL path the server sends the user
 *     back to on success (it validates/whitelists it server-side).
 *   • Double-activation guarded: once clicked we disable and swap the label; the
 *     page is about to unload, but a determined double-tap can't fire two nav's.
 *
 * Props: { returnTo?: string, disabled?: boolean, label?: string }
 */
import { useState } from 'react';
import { C, FONT } from '../theme/tokens.js';

/* Official Google "G" — the standard four-colour mark (48×48 artboard). Drawn
   inline; identical paths Google publishes for the Sign-In button. Exported so the
   Profile → Security "Connected accounts" row can show the same mark. */
export function GoogleG({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
      <path fill="none" d="M2 2h44v44H2z" />
    </svg>
  );
}

/* Small neutral spinner (currentColor) for the connecting state. */
function Spinner({ size = 16 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: '50%', display: 'inline-block',
        border: '2px solid currentColor', borderTopColor: 'transparent',
        opacity: 0.7, animation: 'googleBtnSpin 0.7s linear infinite',
      }}
    />
  );
}

export default function GoogleAuthButton({ returnTo, disabled = false, label = 'Continue with Google' }) {
  const [activating, setActivating] = useState(false);
  const busy = activating || disabled;

  function activate() {
    if (busy) return;               // guard against double-activation
    setActivating(true);
    const qs = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    // Full-page redirect (NOT fetch): the server 302s to Google and later back to
    // returnTo | /app, setting the normal session cookie along the way.
    window.location.assign(`/api/auth/google/start${qs}`);
  }

  return (
    <button
      type="button"
      onClick={activate}
      disabled={busy}
      aria-busy={activating || undefined}
      aria-label={label}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: '11px 14px',
        background: C.card,
        border: `1.5px solid ${C.brd2}`,
        borderRadius: 10,
        color: C.txt,
        fontSize: 14.5,
        fontWeight: 600,
        fontFamily: FONT,
        cursor: busy ? 'not-allowed' : 'pointer',
        opacity: busy ? 0.7 : 1,
        letterSpacing: '0.01em',
        transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
        boxSizing: 'border-box',
      }}
    >
      {activating ? <Spinner /> : <GoogleG />}
      <span>{activating ? 'Connecting…' : label}</span>
      <style>{`@keyframes googleBtnSpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { button[aria-busy="true"] span[aria-hidden="true"] { animation: none; } }`}</style>
    </button>
  );
}
