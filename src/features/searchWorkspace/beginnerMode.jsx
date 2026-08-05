/**
 * beginnerMode.jsx — 98.md §5. ONE Beginner Mode for the whole Search Engine.
 *
 * 85.md A2 introduced a beginner/expert toggle that lived INSIDE SearchBuilderTab
 * (localStorage 'sb-beginner', default ON) and therefore only existed on the two
 * builder stages. 98.md §5 makes Beginner Mode an engine-wide concern: the DEFAULT
 * experience is the focused professional tool (beginner OFF), and educational
 * content across ALL Search Engine stages is revealed only when Beginner Mode is
 * on. This module is the single owner of that state:
 *
 *  - `BeginnerModeProvider` mounts once in SearchWorkspace; every stage component
 *    (and the embedded SearchBuilderTab) reads the same value via
 *    `useBeginnerMode()`.
 *  - Persistence stays the proven per-browser localStorage key 'sb-beginner'
 *    (users who explicitly chose a mode keep it — only the UNSET default flips
 *    from ON to OFF per 98.md §5 "remove nonessential text from the default
 *    experience"). Cross-device server persistence is a documented follow-up:
 *    the existing profile JSON blobs (dashboardPreferences) are replaced whole
 *    by their current writers, so piggybacking would risk clobbering.
 *  - Fail-safe: `useBeginnerMode()` without a provider returns {beginner:false}
 *    and a working local toggle, so unit tests / standalone mounts never crash.
 */
import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { C, FONT, alpha } from '../../frontend/theme/tokens.js';

const KEY = 'sb-beginner';

/** Read the persisted preference. 98.md §5 — unset defaults to OFF (professional). */
export function readBeginnerPref() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

function writeBeginnerPref(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

const BeginnerModeContext = createContext(null);

export function BeginnerModeProvider({ children }) {
  const [beginner, setBeginner] = useState(readBeginnerPref);
  const toggleBeginner = useCallback(() => {
    setBeginner((b) => { const next = !b; writeBeginnerPref(next); return next; });
  }, []);
  const value = useMemo(() => ({ beginner, toggleBeginner }), [beginner, toggleBeginner]);
  return <BeginnerModeContext.Provider value={value}>{children}</BeginnerModeContext.Provider>;
}

/**
 * The engine-wide Beginner Mode state. Without a provider (tests, standalone
 * mounts) this degrades to a component-local toggle seeded from localStorage —
 * same contract, no crash.
 */
export function useBeginnerMode() {
  const ctx = useContext(BeginnerModeContext);
  const [localBeginner, setLocalBeginner] = useState(readBeginnerPref);
  const localToggle = useCallback(() => {
    setLocalBeginner((b) => { const next = !b; writeBeginnerPref(next); return next; });
  }, []);
  if (ctx) return ctx;
  return { beginner: localBeginner, toggleBeginner: localToggle };
}

/** The shared toggle control (rendered once in the SearchWorkspace header). */
export function BeginnerModeToggle({ style }) {
  const { beginner, toggleBeginner } = useBeginnerMode();
  return (
    <button type="button" onClick={toggleBeginner} role="switch" aria-checked={beginner} aria-label="Beginner mode"
      data-testid="sw-beginner-toggle"
      title={beginner ? 'Beginner mode is on — contextual explanations are shown. Click to hide them.' : 'Show contextual explanations across the Search Engine'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
        border: `1px solid ${beginner ? C.grn : C.brd2}`,
        background: beginner ? alpha(C.grn, '14') : 'transparent',
        fontFamily: FONT, ...(style || {}),
      }}>
      <span aria-hidden="true" style={{ width: 26, height: 14, borderRadius: 9, background: beginner ? C.grn : C.brd2, position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: beginner ? 14 : 2, width: 10, height: 10, borderRadius: '50%', background: '#fff', transition: 'all .15s' }} />
      </span>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: beginner ? C.grn : C.muted }}>Beginner mode</span>
    </button>
  );
}
