/**
 * ThemeContext.jsx — night/day theme state for the whole app.
 *
 * Night is the default. The current theme lives on
 * `<html data-theme="...">`; switching repaints via CSS variables
 * (see tokens.js) with no component re-render needed — the context
 * exists so UI (the account-menu toggle) can read/flip the value.
 *
 * Persistence: localStorage immediately + best-effort PUT
 * /api/profile { themePreference } so the preference follows the
 * account across devices.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { applyTheme, getSavedTheme, buildThemeCss } from './tokens.js';

const ThemeContext = createContext({ theme: 'night', setTheme: () => {}, toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => getSavedTheme() || document.documentElement.dataset.theme || 'night');

  // Keep the attribute consistent on mount (index.html bootstraps it pre-paint).
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow out-of-band changes (adoptServerTheme after login).
  useEffect(() => {
    const onChange = (e) => setThemeState(e.detail);
    window.addEventListener('metalab:theme-change', onChange);
    return () => window.removeEventListener('metalab:theme-change', onChange);
  }, []);

  // Site-wide default theme (prompt9): for FIRST-VISIT users with no stored
  // preference, adopt appSettings.defaultTheme from the public settings.
  // Non-blocking — the current default renders immediately and only swaps
  // when the key is present and valid (no flash regression; key absent →
  // behave exactly as before). Deliberately NOT persisted to localStorage:
  // it is a site default, not a user choice, so an explicit per-user pick
  // (localStorage or adoptServerTheme after login) always wins over it.
  useEffect(() => {
    if (getSavedTheme()) return undefined; // explicit local choice wins
    let alive = true;
    fetch('/api/settings/public', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        const dt = data?.appSettings?.defaultTheme;
        if (dt !== 'night' && dt !== 'day') return; // defensive: key may be absent until Wave B2 stores it
        if (getSavedTheme()) return; // user chose while the fetch was in flight
        document.documentElement.dataset.theme = dt;
        setThemeState(dt);
        window.dispatchEvent(new CustomEvent('metalab:theme-change', { detail: dt }));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  function setTheme(next) {
    const t = applyTheme(next); // sets attribute + localStorage + fires event
    setThemeState(t);
    // Best-effort server sync; 401 (logged out) is fine.
    fetch('/api/profile', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ themePreference: t }),
    }).catch(() => {});
  }

  const toggleTheme = () => setTheme(theme === 'night' ? 'day' : 'night');

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      <style>{buildThemeCss()}</style>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
